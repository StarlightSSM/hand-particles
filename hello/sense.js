// sense.js — 아이가 "나"를 느끼는 감각
//  · 손: 검지 끝 위치, 톡(앞으로 찌르기 / 검지 까딱 / 엄지-검지 맞대기 / 잠시 멈춰 있기), 손 흔들기
//  · 얼굴: 화면 속 내 얼굴 위치와 거리 (눈 맞춤용)
//  · 마우스: 카메라가 없을 때 대체 (클릭 = 톡, 좌우로 흔들기 = 손 흔들기)
import { FilesetResolver, HandLandmarker, FaceDetector } from '../vendor/mediapipe/vision_bundle.mjs';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GAIN = 1.15; // 손이 화면 가장자리까지 편하게 닿도록

export function createSense(emit) {
  const vid = document.createElement('video');
  vid.playsInline = true; vid.muted = true;
  let handLm = null, faceDet = null, VA = 16 / 9, lastVT = -1, frame = 0;

  const P = {
    cam: false, ready: false, err: '', vid,
    tips: [],        // [{x, y, hover(0=수면에 닿을 듯~1=멂), dwell(0~1), key}]
    handsN: 0,
    face: null,      // {x, y, size, nx, ny}
    gesture: null,   // 지금 손 모양: thumbsUp thumbsDown peace open fist one three
    hiding: false,   // 두 손으로 얼굴을 가린 중 (까꿍 준비)
    faceT: 0,        // 얼굴이 연속으로 보인 시간
    motion: 0,       // 손 움직임 에너지 0~1
    still: 0,        // 손을 보인 채 가만히 있은 시간
    away: 0,         // 손도 얼굴도 마우스도 없는 시간
    idle: 0,         // 손 조작이 없는 시간
    t: 0,
  };

  const mk = (key) => ({
    key, present: false, miss: 99, raw: null, init: false, since: 0,
    tip: { x: 0, y: 0 }, palm: { x: 0, y: 0 }, v: { x: 0, y: 0 }, scale: 0.2, hover: 1,
    hist: [], lastTap: -9, pinch: false,
    dwellT: 0, dwellAt: null, armed: true,
    lastSign: 0, lastRevT: -9, wave: 0, lastWave: -9,
    gCand: null, gT: 0, gStable: null, gMiss: 0,
  });
  const slots = { a: mk('a'), b: mk('b') };
  const mouse = { ...mk('m'), seen: -99, down: false };

  const W = () => innerWidth, H = () => innerHeight;
  function toS(x, y) {
    const cw = Math.max(W(), H() * VA), ch = cw / VA;
    return { x: W() / 2 + ((1 - x) - 0.5) * cw * GAIN, y: H() / 2 + (y - 0.5) * ch * GAIN };
  }

  /* ───────── 시작: 카메라 + 모델 ───────── */
  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' }, audio: false,
      });
      vid.srcObject = stream;
      await vid.play();
      VA = vid.videoWidth / vid.videoHeight || 16 / 9;
      P.cam = true;
    } catch (e) {
      P.err = 'no-camera'; console.warn(e); return;
    }
    const files = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const handOpts = (delegate) => ({
      baseOptions: { modelAssetPath: './vendor/models/hand_landmarker.task', delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { handLm = await HandLandmarker.createFromOptions(files, handOpts('GPU')); }
    catch { handLm = await HandLandmarker.createFromOptions(files, handOpts('CPU')); }
    try {
      faceDet = await FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: './vendor/models/blaze_face_short_range.tflite', delegate: 'CPU' },
        runningMode: 'VIDEO', minDetectionConfidence: 0.5,
      });
    } catch (e) { console.warn('face detector unavailable', e); }
    P.ready = true;
  }

  /* ───────── 손 결과 배정 ───────── */
  function assign(res) {
    const lms = res.landmarks || [], hd = res.handedness || res.handednesses || [];
    const got = {};
    lms.forEach((lm, i) => {
      let k = hd[i]?.[0]?.categoryName === 'Left' ? 'a' : 'b';
      if (got[k]) k = k === 'a' ? 'b' : 'a';
      got[k] = lm;
    });
    for (const k of ['a', 'b']) {
      const s = slots[k];
      if (got[k]) {
        if (!s.present) { s.init = false; s.since = P.t; s.hist.length = 0; }
        s.raw = got[k]; s.miss = 0; s.present = true;
      } else if (++s.miss > 6 && s.present) {
        s.present = false; s.pinch = false; s.dwellT = 0; s.gStable = s.gCand = null;
      }
    }
  }

  function faceRes(res) {
    const d = res.detections?.[0];
    if (!d || !vid.videoWidth) {
      P.faceMiss = (P.faceMiss || 0) + 1;
      if (P.faceMiss > 8 && P.face) {
        P.face = null; emit('faceOut');
        if (P.handsN > 0) { P.hiding = true; P.hideT = P.t; emit('hide'); }
      }
      return;
    }
    P.faceMiss = 0;
    const b = d.boundingBox;
    const c = toS((b.originX + b.width / 2) / vid.videoWidth, (b.originY + b.height / 2) / vid.videoHeight);
    const size = b.width / vid.videoWidth;
    if (!P.face) {
      P.face = { x: c.x, y: c.y, size }; P.faceT = 0; emit('faceIn');
      if (P.hiding && P.t - P.hideT > 0.5 && P.t - P.hideT < 8) emit('peekaboo');
      P.hiding = false;
    }
    const f = P.face;
    f.x += (c.x - f.x) * 0.35; f.y += (c.y - f.y) * 0.35; f.size += (size - f.size) * 0.3;
    f.nx = clamp((f.x - W() / 2) / (W() / 2), -1.2, 1.2);
    f.ny = clamp((f.y - H() / 2) / (H() / 2), -1.2, 1.2);
  }

  /* ───────── 톡 / 흔들기 / 머무르기 판정 (손 하나) ───────── */
  function track(s, dt, R) {
    const VAx = VA;
    const d = (i, j) => Math.hypot((R[i].x - R[j].x) * VAx, R[i].y - R[j].y);
    const tip = toS(R[8].x, R[8].y);
    let px = 0, py = 0;
    for (const j of [0, 5, 9, 13, 17]) { const p = toS(R[j].x, R[j].y); px += p.x / 5; py += p.y / 5; }
    if (!s.init) { s.tip = tip; s.palm = { x: px, y: py }; s.v = { x: 0, y: 0 }; s.init = true; }
    const k = 0.55;
    s.tip = { x: s.tip.x + (tip.x - s.tip.x) * k, y: s.tip.y + (tip.y - s.tip.y) * k };
    const nvx = (px - s.palm.x) / Math.max(dt, 1e-3), nvy = (py - s.palm.y) / Math.max(dt, 1e-3);
    s.v.x += (nvx - s.v.x) * 0.5; s.v.y += (nvy - s.v.y) * 0.5;
    s.palm = { x: px, y: py };

    const scale = d(0, 9) + 1e-6;
    const idx = d(8, 5) / scale;           // 검지 길이(손 크기 대비) — 앞으로 까딱하면 짧아 보임
    const pinchR = d(4, 8) / scale;
    s.scale = scale;
    s.hover = clamp(1 - (scale - 0.1) / 0.26, 0, 1);

    // 손 모양
    const ext = (tip, pip) => d(tip, 0) > d(pip, 0) * 1.12;
    const iE = ext(8, 6), mE = ext(12, 10), rE = ext(16, 14), pE = ext(20, 18);
    const n4 = iE + mE + rE + pE;
    const thumbOut = d(4, 5) / scale > 0.55 && d(4, 0) > d(3, 0);
    let gname = null;
    if (n4 === 0) {
      const dy = (R[4].y - R[2].y) / scale;
      gname = thumbOut && dy < -0.4 ? 'thumbsUp' : thumbOut && dy > 0.4 ? 'thumbsDown' : 'fist';
    } else if (n4 === 4) gname = 'open';
    else if (iE && mE && !rE && !pE) gname = 'peace';
    else if (iE && !mE && !rE && !pE) gname = 'one';
    else if (iE && mE && rE && !pE) gname = 'three';
    if (gname === s.gCand) s.gT += dt; else { s.gCand = gname; s.gT = 0; }
    if (s.gT > 0.32 && gname !== s.gStable) {
      s.gStable = gname;
      if (gname) emit('gesture', { name: gname, x: s.palm.x, y: s.palm.y });
    }
    const pointing = iE && !mE && !rE && !pE;
    s.hist.push({ t: P.t, scale, idx, x: s.tip.x, y: s.tip.y, pointing });
    while (s.hist.length && P.t - s.hist[0].t > 0.45) s.hist.shift();

    // 1) 톡
    const settled = P.t - s.since > 0.45 && s.hist.length >= 5;
    if (settled && P.t - s.lastTap > 0.45) {
      const win = s.hist.filter((h) => P.t - h.t <= 0.22);
      let minScale = 9, maxIdx = 0;
      for (const h of win) { minScale = Math.min(minScale, h.scale); maxIdx = Math.max(maxIdx, h.idx); }
      const jab = scale / minScale > 1.13;
      // 까딱: 검지만 편 상태에서 시작했을 때만 (주먹 쥐는 동작과 구분)
      const flick = win[0]?.pointing && maxIdx > 0.62 && (maxIdx - idx) / maxIdx > 0.32;
      // 엄지-검지 맞대기: 나머지 손가락이 펴져 있을 때만 (주먹·엄지척과 구분)
      const pinchTap = !s.pinch && pinchR < 0.22 && (mE || rE || pE);
      if (jab || flick || pinchTap) {
        const ref = win[0] || s.hist[s.hist.length - 1];
        tap(ref.x, ref.y, jab ? 'jab' : flick ? 'flick' : 'pinch', s);
      }
    }
    if (pinchR < 0.22) s.pinch = true; else if (pinchR > 0.36) s.pinch = false;

    // 2) 머무르기 — 검지를 편 채 잠시 멈추면 손끝에 물방울이 맺혀 떨어짐
    if (!s.dwellAt) s.dwellAt = { ...s.tip };
    const moved = Math.hypot(s.tip.x - s.dwellAt.x, s.tip.y - s.dwellAt.y);
    if (moved > 42) { s.dwellAt = { ...s.tip }; s.dwellT = 0; s.armed = true; }
    else if (moved < 22 && pointing && s.armed) {
      s.dwellT += dt;
      if (s.dwellT > 1.25) { tap(s.tip.x, s.tip.y, 'dwell', s); s.armed = false; s.dwellT = 0; }
    } else s.dwellT = Math.max(0, s.dwellT - dt * 2);

    // 3) 흔들기 — 좌우 방향 전환이 빠르게 반복되면
    wave(s, s.v.x);
  }

  function wave(s, vx) {
    const thr = W() * 0.35;
    const sign = vx > thr ? 1 : vx < -thr ? -1 : 0;
    if (sign && sign !== s.lastSign) {
      if (s.lastSign && P.t - s.lastRevT < 0.75) s.wave += 0.45;
      s.lastSign = sign; s.lastRevT = P.t;
    }
    s.wave = Math.max(0, s.wave - 0.45 * (1 / 60));
    if (s.wave > 1.0 && P.t - s.lastWave > 2.2) {
      s.lastWave = P.t; s.wave = 0.25;
      emit('wave', { x: s.palm.x, y: s.palm.y });
    }
  }

  function tap(x, y, kind, s) {
    if (s) { s.lastTap = P.t; s.hist.length = 0; }
    P.idle = 0;
    emit('tap', { x, y, kind, gesture: s?.gStable ?? null });
  }

  /* ───────── 마우스 ───────── */
  addEventListener('pointermove', (e) => {
    const dt = Math.max(1 / 240, P.t - (mouse.lastMoveT ?? P.t - 1 / 60));
    const vx = (e.clientX - mouse.tip.x) / dt;
    mouse.tip = { x: e.clientX, y: e.clientY }; mouse.palm = mouse.tip;
    mouse.v.x += (vx - mouse.v.x) * 0.5;
    mouse.lastMoveT = P.t; mouse.seen = P.t;
    wave(mouse, mouse.v.x);
  });
  addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('.ui')) return;
    mouse.seen = P.t;
    tap(e.clientX, e.clientY, 'click', null);
  });

  /* ───────── 매 프레임 ───────── */
  function update(t, dt) {
    P.t = t;
    if (handLm && vid.readyState >= 2 && vid.currentTime !== lastVT) {
      lastVT = vid.currentTime; frame++;
      const now = performance.now();
      try { assign(handLm.detectForVideo(vid, now)); } catch (e) { console.warn(e); }
      if (faceDet && frame % 3 === 0) { try { faceRes(faceDet.detectForVideo(vid, now)); } catch (e) { console.warn(e); } }
    }
    const tips = [];
    let speed = 0, n = 0;
    for (const s of [slots.a, slots.b]) {
      if (!s.present || !s.raw) continue;
      track(s, dt, s.raw);
      n++;
      speed = Math.max(speed, Math.hypot(s.v.x, s.v.y));
      tips.push({ x: s.tip.x, y: s.tip.y, hover: s.hover, dwell: s.armed ? clamp((s.dwellT - 0.25) / 1.0, 0, 1) : 0, key: s.key });
    }
    const mouseLive = P.t - mouse.seen < 3.5;
    if (!n && mouseLive) {
      const ms = Math.abs(mouse.v.x);
      mouse.v.x *= 0.85;
      speed = ms;
      tips.push({ x: mouse.tip.x, y: mouse.tip.y, hover: 0.55, dwell: 0, key: 'm' });
    }
    if (n !== P.handsN) {
      if (n > 0 && P.handsN === 0) emit('handIn');
      if (n === 0 && P.handsN > 0) emit('handOut');
      if (n === 2) emit('twoHands');
      P.handsN = n;
    }
    P.tips = tips;
    const gs = [slots.a, slots.b].filter((s) => s.present && s.gStable);
    P.gesture = gs.length ? gs[gs.length - 1].gStable : null;
    const m = clamp(speed / (W() * 0.9), 0, 1);
    P.motion += (m - P.motion) * 0.15;
    if (tips.length && speed < W() * 0.05) P.still += dt; else P.still = 0;
    if (P.motion > 0.06) P.idle = 0; else P.idle += dt;
    if (tips.length || P.face) P.away = 0; else P.away += dt;
    if (P.face) P.faceT += dt; else P.faceT = 0;
  }

  return Object.assign(P, { start, update });
}
