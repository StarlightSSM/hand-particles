// faceid.js — 얼굴로 "누구인지" 알아보기 (전부 이 기기 안에서만)
//  · @vladmandic/face-api (MIT): 얼굴 찾기 → 68 랜드마크로 정렬 → 128차원 얼굴 특징값(descriptor)
//  · 같은 사람이면 특징값 사이 거리가 가깝고(≈0.3~0.45), 다른 사람이면 멀다(≈0.6 이상)
//  · 저장하는 것: 특징값 몇 개 + 작은 흑백 썸네일 + 그 사람과의 기억. 원본 영상은 저장하지 않음.
import * as faceapi from '../vendor/face-api/face-api.esm.js';

const KEY = 'hello-stranger.faces.v1';
const MODEL = './vendor/face-api/model';
export const KNOWN = 0.47;   // 이보다 가까우면 "아는 사람"
export const UNSURE = 0.58;  // 이보다 가까우면 "혹시…?" (확인 질문)
const MAX_SAMPLES = 8;

const dist = (a, b) => { let s = 0; for (let i = 0; i < 128; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };
const mean = (arr) => {
  const m = new Array(128).fill(0);
  for (const a of arr) for (let i = 0; i < 128; i++) m[i] += a[i] / arr.length;
  return m;
};

export function createFaceId(video) {
  const F = { ready: false, loading: null, err: '', last: null };

  F.load = () => {
    if (!F.loading) {
      F.loading = (async () => {
        try {
          await faceapi.tf.setBackend('webgl');
          await faceapi.tf.ready();
          await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL);
          await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL);
          await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL);
          // 예열: 첫 추론 때 GPU 셰이더 컴파일로 20초 가까이 걸리므로, 빈 그림으로 미리 한 번 돌려 둔다
          const c = document.createElement('canvas'); c.width = c.height = 160;
          await faceapi.detectSingleFace(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }));
          await faceapi.nets.faceLandmark68Net.detectLandmarks(c);
          await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(c);
          F.ready = true;
        } catch (e) { F.err = String(e); console.warn('faceid load failed', e); }
        return F.ready;
      })();
    }
    return F.loading;
  };

  // 지금 화면의 얼굴 하나 → { d: number[128], score, w, thumb? }
  async function sampleOnce(withThumb) {
    if (!F.ready || video.readyState < 2) return null;
    const r = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!r) return null;
    const box = r.detection.box;
    if (r.detection.score < 0.6 || box.width < video.videoWidth * 0.12) return null; // 너무 멀거나 흐릿하면 버림
    return { d: Array.from(r.descriptor), score: r.detection.score, w: box.width, box, thumb: withThumb ? thumb(box) : null };
  }

  // 얼굴 부분만 96×96 흑백 썸네일 (거울처럼 좌우 반전)
  function thumb(box) {
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d');
    const m = box.width * 0.35, s = Math.max(box.width, box.height) + m * 2;
    const sx = box.x + box.width / 2 - s / 2, sy = box.y + box.height / 2 - s / 2;
    g.translate(96, 0); g.scale(-1, 1);
    g.filter = 'grayscale(1) contrast(1.15)';
    g.drawImage(video, sx, sy, s, s, 0, 0, 96, 96);
    return c.toDataURL('image/jpeg', 0.72);
  }

  // n장 모으기 (얼굴이 안 보이면 timeout까지 기다림)
  F.collect = async (n = 5, timeout = 6, onProgress) => {
    const out = [];
    const t0 = performance.now();
    while (out.length < n && performance.now() - t0 < timeout * 1000) {
      const s = await sampleOnce(out.length === 0).catch(() => null);
      if (s) { out.push(s); onProgress?.(out.length / n); }
      await new Promise((r) => setTimeout(r, s ? 140 : 220));
    }
    return out;
  };

  /* ───────── 저장된 사람들 ───────── */
  F.list = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const save = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { console.warn(e); } };
  F.get = (id) => F.list().find((p) => p.id === id) || null;
  F.patch = (id, fn) => { const L = F.list(); const p = L.find((x) => x.id === id); if (p) { fn(p); save(L); } return p; };
  F.remove = (id) => save(F.list().filter((p) => p.id !== id));
  F.clear = () => { try { localStorage.removeItem(KEY); } catch { /* */ } };

  // 누구인지 판단 → { status: 'known'|'unsure'|'stranger'|'noface', person, d, samples }
  F.identify = (samples) => {
    if (!samples.length) return { status: 'noface', person: null, d: null, samples };
    const q = mean(samples.map((s) => s.d));
    let best = null, bd = Infinity;
    for (const p of F.list()) {
      const d = Math.min(...p.samples.map((s) => dist(q, s)), dist(q, mean(p.samples)));
      if (d < bd) { bd = d; best = p; }
    }
    const status = !best ? 'stranger' : bd < KNOWN ? 'known' : bd < UNSURE ? 'unsure' : 'stranger';
    F.last = { status, d: bd, who: best?.callName ?? null, at: Date.now() };
    return { status, person: best, d: bd, samples };
  };

  // 새 친구로 기억
  F.enroll = (samples, extra = {}) => {
    const L = F.list();
    const p = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      callName: null, created: Date.now(), lastSeen: Date.now(), visits: 1, mem: {},
      thumb: samples.find((s) => s.thumb)?.thumb ?? null,
      samples: samples.slice(0, MAX_SAMPLES).map((s) => s.d.map((v) => +v.toFixed(4))),
      ...extra,
    };
    L.push(p); save(L);
    return p;
  };

  // 다시 본 사람: 새 모습도 조금씩 배워 둠 (안경, 머리 모양, 조명 변화에 적응)
  F.learn = (id, samples) => F.patch(id, (p) => {
    for (const s of samples.slice(0, 2)) p.samples.push(s.d.map((v) => +v.toFixed(4)));
    while (p.samples.length > MAX_SAMPLES) p.samples.splice(1, 1); // 첫 등록 샘플은 남김
    if (!p.thumb) p.thumb = samples.find((s) => s.thumb)?.thumb ?? null;
  });

  return F;
}
