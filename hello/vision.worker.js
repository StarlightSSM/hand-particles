// vision.worker.js — 손·얼굴 인식을 화면 그리기와 분리된 스레드에서
//  메인 스레드에서 MediaPipe를 동기로 돌리면 프레임마다 ~35ms씩 화면이 멈췄다.
//  여기서는 ImageBitmap 한 장을 받아 손(21점 + 3D)과 얼굴(478점 + 표정 블렌드셰이프 52개)을 돌려준다.
import { FilesetResolver, HandLandmarker, FaceLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

// MediaPipe는 워커에서 wasm 로더를 importScripts()로 부르는데, 모듈 워커에는 그 함수가 없다.
// 같은 역할(동기 로드 → 전역 실행)을 하는 대체 함수를 넣어 준다.
self.importScripts = (...urls) => {
  for (const u of urls) {
    const x = new XMLHttpRequest();
    x.open('GET', u, false);
    x.send();
    if (x.status >= 400) throw new Error(`load failed: ${u}`);
    (0, eval)(`${x.responseText}\n//# sourceURL=${u}`);
  }
};

let hand = null, face = null;

// CPU(XNNPACK)로 돌린다: 워커 스레드의 CPU만 쓰고 GPU는 화면(물결·눈) 전용으로 비워 둔다.
// (GPU 모드는 내장 그래픽에서 화면 렌더링과 GPU를 두고 다퉈 1초 넘게 멈추는 일이 있었다)
async function make(Task, files, opts, delegate = 'CPU') {
  try { return await Task.createFromOptions(files, { ...opts, baseOptions: { ...opts.baseOptions, delegate } }); }
  catch { return Task.createFromOptions(files, { ...opts, baseOptions: { ...opts.baseOptions, delegate: delegate === 'CPU' ? 'GPU' : 'CPU' } }); }
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks(m.wasm);
      hand = await make(HandLandmarker, files, {
        baseOptions: { modelAssetPath: m.handModel },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.45, minTrackingConfidence: 0.45,
      });
      try {
        face = await make(FaceLandmarker, files, {
          baseOptions: { modelAssetPath: m.faceModel },
          runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        });
      } catch (err) { face = null; }
      self.postMessage({ type: 'ready', face: !!face });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) });
    }
    return;
  }
  if (m.type === 'frame') {
    const { bitmap, ts, doFace } = m;
    const out = { type: 'result', ts, hand: null, face: undefined };
    try {
      const h = hand.detectForVideo(bitmap, ts);
      out.hand = { landmarks: h.landmarks, worldLandmarks: h.worldLandmarks, handedness: h.handedness };
    } catch (err) { out.hand = null; }
    if (doFace && face) {
      try {
        const f = face.detectForVideo(bitmap, ts + 0.5);
        const L = f.faceLandmarks?.[0];
        if (L) {
          let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
          for (const p of L) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
          const bs = {};
          for (const c of f.faceBlendshapes?.[0]?.categories || []) bs[c.categoryName] = c.score;
          // 고개 기울기(roll): 두 눈 바깥꼬리(33, 263)
          const roll = Math.atan2(L[263].y - L[33].y, L[263].x - L[33].x);
          out.face = { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, bs, roll };
        } else out.face = null;
      } catch (err) { out.face = null; }
    }
    bitmap.close();
    self.postMessage(out);
  }
};
