// sense.js — 아이가 "나"를 느끼는 감각
//  · 손: 검지 끝 위치, 톡(앞으로 찌르기 / 검지 까딱 / 엄지-검지 맞대기 / 잠시 멈춰 있기), 손 흔들기
//  · 얼굴: 화면 속 내 얼굴 위치와 거리 (눈 맞춤용) + 표정 블렌드셰이프 52개 (expression.js가 해석)
//  인식은 vision.worker.js(별도 스레드)에서 — 화면이 인식 때문에 멈추지 않게. 워커가 안 되면 메인 스레드로 대체.
//  · 마우스: 카메라가 없을 때 대체 (클릭 = 톡, 좌우로 흔들기 = 손 흔들기)
import { FilesetResolver, HandLandmarker, FaceLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GAIN = 1.15; // 손이 화면 가장자리까지 편하게 닿도록

export function createSense(emit) {
  const vid = document.createElement('video');
  vid.playsInline = true; vid.muted = true;
  let handLm = null, faceLm = null, VA = 16 / 9, lastVT = -1, frame = 0;
  let worker = null, inflight = false, inflightAt = 0;

  const P = {
    cam: false, ready: false, err: '', vid,
    tips: [],        // [{x, y, hover(0=수면에 닿을 듯~1=멂), dwell(0~1), key}]
    handsN: 0,
    face: null,      // {x, y, size, nx, ny}
    blend: null,     // 얼굴 블렌드셰이프 { browInnerUp: 0.1, mouthSmileLeft: 0.6, ... } (0~1)
    faceRoll: 0,     // 고개 기울기(rad)
    mode: '',        // 'worker' | 'main'
    gesture: null,   // 지금 손 모양: thumbsUp thumbsDown peace open fist one three
    gestureHeld: 0,  // 그 손 모양을 유지한 시간(s)
    gestures: [],    // 손마다 [{ name, held, since, key }]
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
    gCand: null, gT: 0, gStable: null, gMiss: 0, world: null, votes: [], gHeld: 0, gSince: 0, gLost: 0,
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
    const abs = (u) => new URL(u, location.href).href;
    const cfg = {
      wasm: abs('./vendor/mediapipe/wasm'),
      handModel: abs('./vendor/models/hand_landmarker.task'),
      faceModel: abs('./vendor/models/face_landmarker.task'),
    };
    // 1) 워커 (화면과 분리)
    const ok = await new Promise((res) => {
      try {
        worker = new Worker(new URL('./vision.worker.js', import.meta.url), { type: 'module' });
      } catch (e) { console.warn('worker unavailable', e); res(false); return; }
      const to = setTimeout(() => res(false), 30000);
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { clearTimeout(to); res(true); }
        else if (m.type === 'error') { clearTimeout(to); console.warn('worker init failed', m.error); res(false); }
        else if (m.type === 'result') {
          inflight = false;
          if (m.hand) assign(m.hand);
          if (m.face !== undefined) faceRes(m.face);
        }
      };
      worker.onerror = (e) => { console.warn('worker error', e.message); clearTimeout(to); res(false); };
      worker.postMessage({ type: 'init', ...cfg });
    });
    if (ok) { P.mode = 'worker'; P.ready = true; return; }
    worker?.terminate(); worker = null;
    // 2) 대체: 메인 스레드
    const files = await FilesetResolver.forVisionTasks(cfg.wasm);
    const handOpts = (delegate) => ({
      baseOptions: { modelAssetPath: cfg.handModel, delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.45, minTrackingConfidence: 0.45,
    });
    try { handLm = await HandLandmarker.createFromOptions(files, handOpts('GPU')); }
    catch { handLm = await HandLandmarker.createFromOptions(files, handOpts('CPU')); }
    try {
      faceLm = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: cfg.faceModel, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
      });
    } catch (e) { console.warn('face landmarker unavailable', e); }
    P.mode = 'main';
    P.ready = true;
  }

  /* ───────── 손 결과 배정 ───────── */
  function assign(res) {
    const lms = res.landmarks || [], hd = res.handedness || res.handednesses || [];
    const wl = res.worldLandmarks || [];
    const got = {}, gotW = {};
    lms.forEach((lm, i) => {
      let k = hd[i]?.[0]?.categoryName === 'Left' ? 'a' : 'b';
      if (got[k]) k = k === 'a' ? 'b' : 'a';
      got[k] = lm; gotW[k] = wl[i] || null;
    });
    for (const k of ['a', 'b']) {
      const s = slots[k];
      if (got[k]) {
        if (!s.present) { s.init = false; s.since = P.t; s.hist.length = 0; }
        s.raw = got[k]; s.world = gotW[k]; s.miss = 0; s.present = true;
      } else if (++s.miss > 6 && s.present) {
        s.present = false; s.pinch = false; s.dwellT = 0; s.gStable = s.gCand = null; s.votes.length = 0; s.gHeld = 0;
      }
    }
  }

  function faceRes(fr) {
    if (!fr || !vid.videoWidth) {
      P.faceMiss = (P.faceMiss || 0) + 1;
      if (P.faceMiss > 8 && P.face) {
        P.face = null; P.blend = null; emit('faceOut');
        if (P.handsN > 0) { P.hiding = true; P.hideT = P.t; emit('hide'); }
      }
      return;
    }
    P.faceMiss = 0;
    const b = fr.box;
    const c = toS(b.x + b.w / 2, b.y + b.h / 2);
    const size = b.w;
    P.blend = fr.bs; P.faceRoll = fr.roll || 0;
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

    // 손 모양 — 매 프레임 분류한 뒤 최근 8프레임 다수결로 안정화
    const shape = classify(R, s.world, d, scale);
    const { iE, mE, rE, pE } = shape;
    P.shapeDbg = shape.dbg;
    s.votes.push(shape.name);
    if (s.votes.length > 8) s.votes.shift();
    const tally = {};
    let mode = null, mc = 0;
    for (const v of s.votes) { const c = (tally[v] = (tally[v] || 0) + 1); if (c > mc) { mc = c; mode = v; } }
    if (s.votes.length >= 5 && mc >= 5 && mode !== 'null') {
      s.gLost = 0;
      if (mode !== s.gStable) {
        s.gStable = mode; s.gHeld = 0; s.gSince = P.t;
        emit('gesture', { name: mode, x: s.palm.x, y: s.palm.y });
      } else s.gHeld += dt;
    } else if ((s.gLost += dt) > 0.35) { s.gStable = null; s.gHeld = 0; }
    const pointing = iE && !mE && !rE && !pE;
    s.hist.push({ t: P.t, scale, idx, x: s.tip.x, y: s.tip.y, pointing });
    while (s.hist.length && P.t - s.hist[0].t > 0.45) s.hist.shift();

    // 1) 톡
    const settled = P.t - s.since > 0.45 && s.hist.length >= 5;
    // 👍👎✌✋✊ 같은 손 모양을 보여 주는 중이면 톡으로 보지 않음 (유지하는 동안의 흔들림이 '찌르기'로 읽히던 문제)
    // (✋는 하이파이브가 '손바닥으로 찌르기'라 허용, ☝는 톡 자세라 허용)
    const SIGNS = ['thumbsUp', 'thumbsDown', 'peace', 'fist', 'three'];
    const posing = SIGNS.includes(s.gStable) || SIGNS.includes(shape.name);
    if (settled && !posing && P.t - s.lastTap > 0.45) {
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

  /* 손 모양 분류
   *  3D(world) 좌표가 있으면 관절 각도로: 손가락 PIP 관절이 곧으면 편 것, 굽으면 접은 것.
   *  화면 각도·손 방향이 바뀌어도 안정적 (엄지척처럼 주먹을 옆으로 세운 자세에 특히 강함).
   */
  function classify(R, Wd, d, scale) {
    let fing, thumbExt, dbg = '';
    if (Wd && Wd.length === 21) {
      const ang = (a, b, c) => {
        const ux = Wd[a].x - Wd[b].x, uy = Wd[a].y - Wd[b].y, uz = Wd[a].z - Wd[b].z;
        const vx = Wd[c].x - Wd[b].x, vy = Wd[c].y - Wd[b].y, vz = Wd[c].z - Wd[b].z;
        const cos = (ux * vx + uy * vy + uz * vz) / (Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz) + 1e-9);
        return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      };
      const wd = (a, b) => Math.hypot(Wd[a].x - Wd[b].x, Wd[a].y - Wd[b].y, Wd[a].z - Wd[b].z);
      const palm = wd(0, 9) + 1e-9;
      // 편 손가락: PIP·DIP 둘 다 곧음 / 끝이 손목에서 멀리
      const ext = (m, p, q, t) => ang(m, p, q) > 150 && ang(p, q, t) > 135 && wd(t, 0) > wd(p, 0) * 1.05;
      fing = [ext(5, 6, 7, 8), ext(9, 10, 11, 12), ext(13, 14, 15, 16), ext(17, 18, 19, 20)];
      // 엄지: 관절이 곧고 손바닥에서 조금이라도 떨어져 있으면 편 것 (손등 쪽에서 본 👎는 거리가 짧게 잡힘)
      thumbExt = ang(1, 2, 3) > 135 && ang(2, 3, 4) > 125 && wd(4, 5) / palm > 0.3;
      dbg = `pip ${[6, 10, 14, 18].map((j) => ang(j - 1, j, j + 1) | 0).join('/')} th ${ang(1, 2, 3) | 0}/${ang(2, 3, 4) | 0} t5 ${(wd(4, 5) / palm).toFixed(2)}`;
    } else { // 2D 대체
      const ext = (tip, pip) => d(tip, 0) > d(pip, 0) * 1.12;
      fing = [ext(8, 6), ext(12, 10), ext(16, 14), ext(20, 18)];
      thumbExt = d(4, 5) / scale > 0.4 && d(4, 0) > d(3, 0);
    }
    const [iE, mE, rE, pE] = fing;
    const n4 = iE + mE + rE + pE;
    // 엄지 방향: 화면에서 위/아래 (엄지 MCP → 끝)
    const tx = (R[4].x - R[2].x) * VA, ty = R[4].y - R[2].y;
    const dirY = ty / (Math.hypot(tx, ty) + 1e-9);
    // 엄지 끝이 검지 뿌리(5)보다 위(👍) / 아래(👎)에 있는지 — 각도가 흔들려도 확실한 단서
    // (가까이 찍힌 👎는 엄지 끝 랜드마크가 실제보다 위로 잡혀, "가장 아래" 조건은 너무 엄격했음)
    // 👎: 엄지 마디가 MCP(2) → IP(3) → 끝(4) 순서로 차례대로 아래로 — 랜드마크 하나가 튀어도 덜 흔들림
    const maxY = Math.max(R[5].y, R[2].y);
    const up = thumbExt && dirY < -0.5 && R[4].y < Math.min(R[5].y, R[2].y);
    // (손등 쪽에서 보면 엄지 끝이 IP 마디와 같은 높이로 납작하게 잡히는 일이 많아 끝은 '같거나 아래'까지 허용)
    const down = thumbExt && dirY > 0.4 && R[3].y > R[2].y + 0.01 && R[4].y >= R[3].y - 0.01 && R[4].y > R[5].y - 0.02;
    let name = null;
    if (n4 === 0) name = up ? 'thumbsUp' : down ? 'thumbsDown' : 'fist';
    else if (n4 === 1 && !iE && (up || down)) name = up ? 'thumbsUp' : 'thumbsDown'; // 새끼 등 하나가 덜 접혀도 허용
    else if (n4 === 4) name = 'open';
    else if (iE && mE && !rE && !pE) name = 'peace';
    else if (iE && !mE && !rE && !pE) name = 'one';
    else if (iE && mE && rE && !pE) name = 'three';
    return { name: name ?? 'null', iE, mE, rE, pE, dbg: `${dbg} dirY ${dirY.toFixed(2)} ext ${thumbExt ? 1 : 0} n4 ${n4} y2/3/4/5 ${[2, 3, 4, 5].map((j) => R[j].y.toFixed(2)).join('/')} → ${name ?? '—'}` };
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
    if (vid.readyState >= 2 && vid.currentTime !== lastVT) {
      const now = performance.now();
      if (worker && P.ready) {
        // 직전 프레임이 아직 처리 중이면 건너뜀 (밀리지 않게) — 1초 넘게 답이 없으면 다시 보냄
        // 손은 초당 최대 24번, 얼굴(표정)은 그 3번에 1번 — CPU를 화면과 나눠 쓰도록
        if ((!inflight && now - inflightAt > 41) || now - inflightAt > 1000) {
          lastVT = vid.currentTime; frame++;
          inflight = true; inflightAt = now;
          const doFace = frame % 3 === 0;
          createImageBitmap(vid).then((bitmap) => worker.postMessage({ type: 'frame', bitmap, ts: now, doFace }, [bitmap]))
            .catch(() => { inflight = false; });
        }
      } else if (handLm) {
        lastVT = vid.currentTime; frame++;
        try { assign(handLm.detectForVideo(vid, now)); } catch (e) { console.warn(e); }
        if (faceLm && frame % 3 === 0) {
          try {
            const r = faceLm.detectForVideo(vid, now + 0.5), L = r.faceLandmarks?.[0];
            if (!L) faceRes(null);
            else {
              let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
              for (const p of L) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
              const bs = {}; for (const c of r.faceBlendshapes?.[0]?.categories || []) bs[c.categoryName] = c.score;
              faceRes({ box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, bs, roll: Math.atan2(L[263].y - L[33].y, L[263].x - L[33].x) });
            }
          } catch (e) { console.warn(e); }
        }
      }
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
    P.gestures = [slots.a, slots.b].filter((s) => s.present && s.gStable)
      .map((s) => ({ name: s.gStable, held: s.gHeld, since: s.gSince, key: s.key }))
      .sort((a, b) => b.held - a.held);
    P.gesture = P.gestures[0]?.name ?? null;
    P.gestureHeld = P.gestures[0]?.held ?? 0;
    const m = clamp(speed / (W() * 0.9), 0, 1);
    P.motion += (m - P.motion) * 0.15;
    if (tips.length && speed < W() * 0.05) P.still += dt; else P.still = 0;
    if (P.motion > 0.06) P.idle = 0; else P.idle += dt;
    if (tips.length || P.face) P.away = 0; else P.away += dt;
    if (P.face) P.faceT += dt; else P.faceT = 0;
  }

  return Object.assign(P, { start, update });
}
