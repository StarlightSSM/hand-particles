import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FilesetResolver, HandLandmarker } from './vendor/mediapipe/vision_bundle.mjs';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const MAX = 26000;

/* ───────────────────────── 전역 상태 ───────────────────────── */
const S = {
  mode: 'text', pal: 'ice', text: 'A', trails: true, skel: true,
  W: innerWidth, H: innerHeight, t: 0, frame: 0,
};
const PALETTES = {
  ice:   { base: [0.50, 0.74, 1.00], hot: [1.00, 1.00, 1.00], acc: '#9fe0ff' },
  ember: { base: [1.00, 0.30, 0.07], hot: [1.00, 0.90, 0.55], acc: '#ff8a3d' },
  neon:  { base: [0.22, 0.32, 1.00], hot: [1.00, 0.22, 0.85], acc: '#c86bff' },
  mono:  { base: [0.62, 0.62, 0.62], hot: [1.00, 1.00, 1.00], acc: '#e8e8e8' },
};
let PAL = PALETTES.ice;
// 두 손 핀치로 조절하는 전역 변형 (text: 글자 크기/회전, cloud: 오브젝트 변형, flow: 빔)
const G = { scale: 1, rot: 0, two: null, cloudRX: 0, cloudRY: 0 };

/* ───────────────────────── three.js ───────────────────────── */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(S.W, S.H);
$('#stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040507);
const FOV = 45;
const camera = new THREE.PerspectiveCamera(FOV, S.W / S.H, 1, 20000);
// z=0 평면에서 1 world unit = 1 CSS px 이 되도록 카메라 거리 설정
const camDist = () => (S.H / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
camera.position.set(0, 0, camDist());

const pos = new Float32Array(MAX * 3);
const col = new Float32Array(MAX * 3);
const siz = new Float32Array(MAX);
const vel = new Float32Array(MAX * 3);
const home = new Float32Array(MAX * 3);
const rnd = new Float32Array(MAX);
for (let i = 0; i < MAX; i++) {
  rnd[i] = Math.random();
  pos[i * 3] = (Math.random() - 0.5) * S.W;
  pos[i * 3 + 1] = (Math.random() - 0.5) * S.H;
  pos[i * 3 + 2] = (Math.random() - 0.5) * 200;
}
const geo = new THREE.BufferGeometry();
const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
const aSiz = new THREE.BufferAttribute(siz, 1).setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('position', aPos);
geo.setAttribute('color', aCol);
geo.setAttribute('size', aSiz);

const mat = new THREE.ShaderMaterial({
  uniforms: { uPR: { value: renderer.getPixelRatio() }, uDist: { value: camDist() } },
  vertexShader: /* glsl */`
    attribute float size; attribute vec3 color;
    uniform float uPR; uniform float uDist;
    varying vec3 vColor;
    void main(){
      vColor = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = max(size * uPR * (uDist / -mv.z), 0.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      float a = smoothstep(0.5, 0.0, d);
      a *= a;
      gl_FragColor = vec4(vColor * a, a);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const points = new THREE.Points(geo, mat);
points.frustumCulled = false;
scene.add(points);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const after = new AfterimagePass(0.84);          // TouchDesigner의 Feedback TOP 같은 잔상
composer.addPass(after);
const bloom = new UnrealBloomPass(new THREE.Vector2(S.W, S.H), 0.8, 0.45, 0.12);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let N = 0; // 현재 활성 파티클 수

/* ───────────────────────── 카메라 / 손 인식 ───────────────────────── */
const vid = $('#vid');
let VA = 16 / 9;          // 비디오 가로세로비
let camOK = false;
let landmarker = null;
let lastVT = -1;

// 손 좌표 → 화면 world 좌표 (거울 모드, 화면을 cover로 덮고 1.25배 게인 → 화면 끝까지 쉽게 닿음)
const GAIN = 1.25;
function span() {
  const cw = Math.max(S.W, S.H * VA);
  return { x: cw * GAIN, y: (cw / VA) * GAIN };
}

const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

function newHand(key) {
  return {
    key, present: false, miss: 99, raw: null, init: false,
    lm: Array.from({ length: 21 }, () => ({ x: 0, y: 0 })),
    palm: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, px: 120,
    pinch: false, pinchR: 1, fingers: 0, fistN: 0, fist: false, gesture: '—',
    pp: { x: 0, y: 0 }, hoverEl: null, dwellT: 0, cool: 0, uiPinch: false, noBurst: false,
    lastRipple: 0, cursor: { x: 0, y: 0 },
  };
}
const hands = { a: newHand('A'), b: newHand('B') };
const handList = () => [hands.a, hands.b];

function onResults(res) {
  const lms = res.landmarks || [];
  const hd = res.handedness || res.handednesses || [];
  const got = {};
  lms.forEach((lm, i) => {
    let k = hd[i]?.[0]?.categoryName === 'Left' ? 'a' : 'b';
    if (got[k]) k = k === 'a' ? 'b' : 'a';
    got[k] = lm;
  });
  for (const k of ['a', 'b']) {
    const h = hands[k];
    if (got[k]) {
      if (!h.present) h.init = false;
      h.raw = got[k]; h.miss = 0; h.present = true;
    } else if (++h.miss > 5 && h.present) {
      loseHand(h);
    }
  }
}

function loseHand(h) {
  h.present = false; h.pinch = false; h.fist = false; h.fistN = 0; h.gesture = '—';
  if (h.hoverEl) { h.hoverEl.classList.remove('hhover'); h.hoverEl.style.setProperty('--dwell', 0); h.hoverEl = null; }
}

function updateHands(now) {
  const sp = span();
  for (const h of handList()) {
    if (!h.present || !h.raw) continue;
    const R = h.raw;
    // 1) 스무딩된 world 좌표
    for (let j = 0; j < 21; j++) {
      const wx = ((1 - R[j].x) - 0.5) * sp.x;
      const wy = (0.5 - R[j].y) * sp.y;
      if (!h.init) { h.lm[j].x = wx; h.lm[j].y = wy; }
      else { h.lm[j].x += (wx - h.lm[j].x) * 0.55; h.lm[j].y += (wy - h.lm[j].y) * 0.55; }
    }
    const L = h.lm;
    const px = (L[0].x + L[5].x + L[9].x + L[13].x + L[17].x) / 5;
    const py = (L[0].y + L[5].y + L[9].y + L[13].y + L[17].y) / 5;
    if (h.init) {
      h.vel.x = h.vel.x * 0.5 + (px - h.palm.x) * 0.5;
      h.vel.y = h.vel.y * 0.5 + (py - h.palm.y) * 0.5;
    } else { h.vel.x = h.vel.y = 0; }
    h.palm.x = px; h.palm.y = py; h.init = true;
    h.px = Math.hypot(L[0].x - L[9].x, L[0].y - L[9].y);

    // 2) 제스처 (원본 정규화 좌표, 가로세로비 보정)
    const d = (i, j) => Math.hypot((R[i].x - R[j].x) * VA, R[i].y - R[j].y);
    const sc = d(0, 9) + 1e-6;
    h.pinchR = d(4, 8) / sc;
    const tips = [8, 12, 16, 20], pips = [6, 10, 14, 18], mcps = [5, 9, 13, 17];
    let ext = 0, curled = 0;
    for (let k = 0; k < 4; k++) {
      const dt = d(tips[k], 0);
      if (dt > d(pips[k], 0) * 1.12) ext++;
      if (dt < d(mcps[k], 0) * 1.25) curled++;
    }
    h.fingers = ext;
    h.fistN = curled >= 4 ? h.fistN + 1 : 0;
    h.fist = h.fistN >= 3;

    const was = h.pinch;
    if (h.fist) h.pinch = false;
    else if (!h.pinch && h.pinchR < 0.28) h.pinch = true;
    else if (h.pinch && h.pinchR > 0.42) h.pinch = false;

    h.pp.x = (L[4].x + L[8].x) / 2; h.pp.y = (L[4].y + L[8].y) / 2;
    h.gesture = h.fist ? 'FIST' : h.pinch ? 'PINCH'
      : ext >= 4 ? 'OPEN' : (ext === 1 && d(8, 0) > d(6, 0) * 1.12) ? 'POINT' : `F${ext}`;

    // 3) 화면 UI(버튼)와 상호작용 — 검지 끝이 커서
    updateUI(h, now);

    if (h.pinch && !was) onPinchStart(h);
    if (!h.pinch && was) onPinchEnd(h);
  }
  updateTwoHand();
}

function onPinchStart(h) {
  if (h.hoverEl && !h.fist) {          // 버튼 위 핀치 = 즉시 클릭
    activate(h.hoverEl); h.cool = performance.now() + 900; h.uiPinch = true; return;
  }
  if (S.mode === 'cloud') addRipple(h.pp.x, h.pp.y, 150);
}
function onPinchEnd(h) {
  if (!h.uiPinch && !h.noBurst) {
    if (S.mode === 'cloud') addRipple(h.pp.x, h.pp.y, 220);
    else burst(h.pp.x, h.pp.y, 460, S.mode === 'text' ? 34 : 26);
  }
  h.uiPinch = false; h.noBurst = false;
}

function updateTwoHand() {
  const a = hands.a, b = hands.b;
  const both = a.present && b.present && a.pinch && b.pinch && !a.uiPinch && !b.uiPinch;
  if (both) {
    const dist = Math.hypot(a.pp.x - b.pp.x, a.pp.y - b.pp.y);
    const ang = Math.atan2(b.pp.y - a.pp.y, b.pp.x - a.pp.x);
    if (!G.two) G.two = { d0: dist, a0: ang, s0: G.scale, r0: G.rot };
    G.scale = clamp(G.two.s0 * dist / Math.max(G.two.d0, 30), 0.25, 3.2);
    let da = ang - G.two.a0;
    if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
    G.rot = G.two.r0 + da;
    a.noBurst = b.noBurst = true;
  } else {
    G.two = null;
    G.scale += (1 - G.scale) * 0.025;
    G.rot *= 0.975;
  }
}

/* ───────────────────────── 손으로 누르는 HTML 버튼 ───────────────────────── */
const DWELL = 850;
function updateUI(h, now) {
  const tip = h.lm[8];
  const cx = tip.x + S.W / 2, cy = S.H / 2 - tip.y;
  h.cursor.x = cx; h.cursor.y = cy;
  let el = (cx >= 0 && cy >= 0 && cx < S.W && cy < S.H && !h.fist) ? document.elementFromPoint(cx, cy) : null;
  el = el && el.closest ? el.closest('.hbtn') : null;
  if (document.body.classList.contains('noui')) el = null;
  if (el !== h.hoverEl) {
    if (h.hoverEl) { h.hoverEl.classList.remove('hhover'); h.hoverEl.style.setProperty('--dwell', 0); }
    h.hoverEl = el; h.dwellT = now;
    if (el) el.classList.add('hhover');
  }
  if (el) {
    if (now < h.cool) { el.style.setProperty('--dwell', 0); h.dwellT = now; return; }
    const p = Math.min(1, (now - h.dwellT) / DWELL);
    el.style.setProperty('--dwell', p.toFixed(3));
    if (p >= 1) { activate(el); h.cool = now + 1100; }
  }
}
function activate(el) {
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  el.style.setProperty('--dwell', 0);
  el.click();
}

/* ───────────────────────── 마우스 대체 입력 ───────────────────────── */
const mouse = { x: 0, y: 0, vx: 0, vy: 0, down: false, t: -1e9 };
addEventListener('pointermove', (e) => {
  const x = e.clientX - S.W / 2, y = S.H / 2 - e.clientY;
  mouse.vx = x - mouse.x; mouse.vy = y - mouse.y; mouse.x = x; mouse.y = y; mouse.t = performance.now();
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  mouse.down = true; mouse.t = performance.now();
  if (S.mode === 'cloud') addRipple(mouse.x, mouse.y, 150);
});
addEventListener('pointerup', () => {
  if (!mouse.down) return;
  mouse.down = false;
  if (S.mode === 'cloud') addRipple(mouse.x, mouse.y, 220);
  else burst(mouse.x, mouse.y, 460, 30);
});
const mouseActive = () => !hands.a.present && !hands.b.present && performance.now() - mouse.t < 2500;

/* ───────────────────────── 힘(force) 구성 ───────────────────────── */
// A: 밀어내는 점(손가락 마디), Wl: 끌어당기는 우물(핀치)
function buildForces() {
  const A = [], Wl = [];
  for (const h of handList()) {
    if (!h.present || !h.init) continue;
    const L = h.lm;
    const r = clamp(h.px * 0.5, 34, 130);
    let ids = h.gesture === 'POINT' ? [8] : [4, 8, 12, 16, 20, 3, 6, 10, 14, 18];
    if (h.pinch) ids = [12, 16, 20, 10, 14, 18];
    for (const j of ids) A.push({ x: L[j].x, y: L[j].y, r, r2: r * r, s: 5.5, vx: h.vel.x, vy: h.vel.y });
    if (h.gesture !== 'POINT') {
      const pr = clamp(h.px * 0.85, 60, 220);
      A.push({ x: h.palm.x, y: h.palm.y, r: pr, r2: pr * pr, s: 3.5, vx: h.vel.x, vy: h.vel.y });
    }
    if (h.pinch && !h.uiPinch && !G.two) Wl.push({ x: h.pp.x, y: h.pp.y, r: 420, r2: 420 * 420, s: 2.4 });
  }
  if (mouseActive()) {
    A.push({ x: mouse.x, y: mouse.y, r: 90, r2: 8100, s: 6, vx: mouse.vx, vy: mouse.vy });
    if (mouse.down) Wl.push({ x: mouse.x, y: mouse.y, r: 420, r2: 420 * 420, s: 2.4 });
    mouse.vx *= 0.8; mouse.vy *= 0.8;
  }
  return { A, Wl };
}
const anyFist = () => hands.a.fist || hands.b.fist;

function burst(x, y, R, pw) {
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const dx = pos[i3] - x, dy = pos[i3 + 1] - y;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
    if (d < R) {
      const f = (1 - d / R) * pw * (0.35 + rnd[i]);
      vel[i3] += dx / d * f; vel[i3 + 1] += dy / d * f; vel[i3 + 2] += (rnd[i] - 0.5) * f * 2.2;
    }
  }
}

function paint(i, k, g) {
  const b = PAL.base, h = PAL.hot, i3 = i * 3;
  col[i3] = (b[0] + (h[0] - b[0]) * k) * g;
  col[i3 + 1] = (b[1] + (h[1] - b[1]) * k) * g;
  col[i3 + 2] = (b[2] + (h[2] - b[2]) * k) * g;
}

/* ───────────────────────── MODE 1 — PARTICLE TEXT ───────────────────────── */
function sampleText(str) {
  const sc = 0.5;
  const cw = Math.ceil(S.W * sc), ch = Math.ceil(S.H * sc);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  const font = (fs) => `900 ${fs}px "Pretendard", "Malgun Gothic", "Arial Black", Impact, sans-serif`;
  let fs = ch * 0.62;
  g.font = font(fs);
  const tw = g.measureText(str).width;
  if (tw > cw * 0.74) { fs *= (cw * 0.74) / tw; g.font = font(fs); }
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(str, cw / 2, ch / 2 + fs * 0.04);
  const data = g.getImageData(0, 0, cw, ch).data;
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 128) lit++;
  const target = 15000;
  const step = Math.max(0.8, Math.sqrt(lit / target));
  const out = [];
  for (let y = 0; y < ch; y += step) {
    for (let x = 0; x < cw; x += step) {
      const xi = x | 0, yi = y | 0;
      if (data[(yi * cw + xi) * 4 + 3] > 128 && out.length < (MAX - 10) * 3) {
        out.push(
          (x + (Math.random() - 0.5) * step) / sc - S.W / 2,
          S.H / 2 - (y + (Math.random() - 0.5) * step) / sc,
          (Math.random() - 0.5) * 70,
        );
      }
    }
  }
  return out;
}

function setText(str) {
  S.text = (str || '').trim() || 'A';
  const pts = sampleText(S.text);
  const n = pts.length / 3;
  home.set(pts);
  // 새로 필요한 파티클은 화면 밖에서 날아오게
  for (let i = N; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.max(S.W, S.H) * (0.6 + Math.random() * 0.4);
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r; pos[i * 3 + 2] = (Math.random() - 0.5) * 400;
    vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0;
  }
  N = n;
  // 바뀔 때 살짝 흩어지는 맛
  for (let i = 0; i < N; i++) { vel[i * 3] += (Math.random() - 0.5) * 8; vel[i * 3 + 1] += (Math.random() - 0.5) * 8; }
}

function stepText() {
  const { A, Wl } = buildForces();
  const scatter = anyFist();
  const K = scatter ? 0 : 0.02;
  const damp = scatter ? 0.975 : 0.87;
  const cs = Math.cos(G.rot) * G.scale, sn = Math.sin(G.rot) * G.scale;
  const t = S.t;
  const nA = A.length, nW = Wl.length;
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
    const hx0 = home[i3], hy0 = home[i3 + 1];
    const hx = hx0 * cs - hy0 * sn, hy = hx0 * sn + hy0 * cs, hz = home[i3 + 2] * G.scale;
    let ax = 0, ay = 0, az = 0, kMul = 1;

    for (let w = 0; w < nW; w++) {
      const W = Wl[w];
      const dx = W.x - px, dy = W.y - py, d2 = dx * dx + dy * dy;
      if (d2 < W.r2) {
        const d = Math.sqrt(d2) + 0.5;
        const f = (1 - d / W.r) * W.s;
        ax += (dx / d) * f - (dy / d) * f * 0.7;
        ay += (dy / d) * f + (dx / d) * f * 0.7;
        az -= pz * 0.03;
        kMul = 0.12;
      }
    }
    for (let k = 0; k < nA; k++) {
      const a = A[k];
      const dx = px - a.x, dy = py - a.y, d2 = dx * dx + dy * dy;
      if (d2 < a.r2) {
        const d = Math.sqrt(d2) + 0.01;
        let f = 1 - d / a.r; f = f * f * a.s;
        ax += (dx / d) * f + a.vx * f * 0.09;
        ay += (dy / d) * f + a.vy * f * 0.09;
        az += f * (rnd[i] > 0.5 ? 1.6 : -1.6);
      }
    }
    if (scatter) {
      ax += Math.sin(py * 0.008 + t * 0.9 + rnd[i] * 6) * 0.12;
      ay += Math.cos(px * 0.008 - t * 0.7 + rnd[i] * 6) * 0.12;
      az += Math.sin(t + rnd[i] * 20) * 0.08;
    }
    const k2 = K * kMul;
    ax += (hx - px) * k2; ay += (hy - py) * k2; az += (hz - pz) * k2;

    const vx = (vel[i3] + ax) * damp, vy = (vel[i3 + 1] + ay) * damp, vz = (vel[i3 + 2] + az) * damp;
    vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    pos[i3] = px + vx; pos[i3 + 1] = py + vy; pos[i3 + 2] = pz + vz;

    const spd = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const heat = Math.min(1, spd / 14);
    paint(i, heat, 0.3 + rnd[i] * 0.2 + heat * 0.18);
    siz[i] = 1.8 + rnd[i] * 1.6 + heat * 1.6;
  }
}

/* ───────────────────────── MODE 2 — FLOW FIELD ───────────────────────── */
const FLOW_N = 15000;
let emitIdx = 0;
function initFlow() {
  for (let i = N; i < FLOW_N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * S.W; pos[i * 3 + 1] = (Math.random() - 0.5) * S.H;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 200;
    vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0;
  }
  N = FLOW_N;
}
const fieldAngle = (x, y, t) =>
  Math.sin(x * 0.0031 + Math.sin(y * 0.0047 + t * 0.21) * 1.7) * 2.1 +
  Math.cos(y * 0.0029 + Math.cos(x * 0.0041 - t * 0.17) * 1.9) * 2.1;

function stepFlow() {
  const { A, Wl } = buildForces();
  const freeze = anyFist();
  const t = S.t;
  const hw = S.W / 2 + 60, hh = S.H / 2 + 60;

  // 손가락 끝에서 파티클 방출 (손을 빠르게 움직일수록 많이)
  for (const h of handList()) {
    if (!h.present || !h.init || h.fist || h.pinch) continue;
    const sp = Math.hypot(h.vel.x, h.vel.y);
    if (sp < 2.5) continue;
    const k = Math.min(90, (sp * 3) | 0);
    const tips = [4, 8, 12, 16, 20];
    for (let e = 0; e < k; e++) {
      const i = emitIdx++ % N, i3 = i * 3, tp = h.lm[tips[e % 5]];
      pos[i3] = tp.x + (Math.random() - 0.5) * 10; pos[i3 + 1] = tp.y + (Math.random() - 0.5) * 10;
      pos[i3 + 2] = (Math.random() - 0.5) * 40;
      vel[i3] = h.vel.x * 0.55 + (Math.random() - 0.5) * 3;
      vel[i3 + 1] = h.vel.y * 0.55 + (Math.random() - 0.5) * 3;
      vel[i3 + 2] = (Math.random() - 0.5) * 3;
    }
  }

  // 두 손 핀치 = 손 사이에 빛의 줄(빔)
  let beam = null;
  if (G.two) {
    const a = hands.a.pp, b = hands.b.pp;
    const ex = b.x - a.x, ey = b.y - a.y;
    beam = { ax: a.x, ay: a.y, ex, ey, l2: ex * ex + ey * ey + 1e-6 };
  }
  const nA = A.length, nW = Wl.length;
  const damp = freeze ? 0.86 : 0.962;
  const move = freeze ? 0.2 : 1;

  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    let px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
    const ang = fieldAngle(px, py, t);
    let ax = Math.cos(ang) * 0.13, ay = Math.sin(ang) * 0.13, az = -pz * 0.004 + Math.sin(ang * 2 + t) * 0.04;

    for (let k = 0; k < nA; k++) {
      const a = A[k];
      const R = a.r * 1.7;
      const dx = px - a.x, dy = py - a.y, d2 = dx * dx + dy * dy;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) + 0.01;
        const f = (1 - d / R);
        ax += ((dx / d) * 0.6 - (dy / d) * 1.1) * f * a.s * 0.35 + a.vx * f * 0.06;
        ay += ((dy / d) * 0.6 + (dx / d) * 1.1) * f * a.s * 0.35 + a.vy * f * 0.06;
        az += f * 0.8 * (rnd[i] - 0.5);
      }
    }
    for (let w = 0; w < nW; w++) {
      const W = Wl[w];
      const dx = W.x - px, dy = W.y - py, d2 = dx * dx + dy * dy;
      const R = W.r * 1.1;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) + 2;
        const f = (1 - d / R) * W.s * 1.3;
        ax += (dx / d) * f - (dy / d) * f * 0.9;
        ay += (dy / d) * f + (dx / d) * f * 0.9;
        az -= pz * 0.04;
      }
    }
    if (beam) {
      let u = ((px - beam.ax) * beam.ex + (py - beam.ay) * beam.ey) / beam.l2;
      u = clamp(u, 0, 1);
      const cx = beam.ax + beam.ex * u, cy = beam.ay + beam.ey * u;
      const dx = cx - px, dy = cy - py, d2 = dx * dx + dy * dy;
      if (d2 < 360 * 360) {
        const d = Math.sqrt(d2) + 2;
        const f = (1 - d / 360) * 2.2;
        ax += (dx / d) * f + beam.ex / Math.sqrt(beam.l2) * 0.35 * (rnd[i] > 0.5 ? 1 : -1);
        ay += (dy / d) * f + beam.ey / Math.sqrt(beam.l2) * 0.35 * (rnd[i] > 0.5 ? 1 : -1);
      }
    }

    let vx = (vel[i3] + ax) * damp, vy = (vel[i3 + 1] + ay) * damp, vz = (vel[i3 + 2] + az) * damp;
    const spd = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (spd > 38) { const s = 38 / spd; vx *= s; vy *= s; vz *= s; }
    vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    px += vx * move; py += vy * move; pz += vz * move;
    if (px > hw) px -= hw * 2; else if (px < -hw) px += hw * 2;
    if (py > hh) py -= hh * 2; else if (py < -hh) py += hh * 2;
    pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;

    const heat = Math.min(1, spd / 11);
    paint(i, heat, 0.14 + rnd[i] * 0.14 + heat * 0.3);
    siz[i] = 1.4 + rnd[i] * 1.4 + heat * 1.8;
  }
}

/* ───────────────────────── MODE 3 — POINT CLOUD (웹캠 깊이 메쉬) ───────────────────────── */
const vc = document.createElement('canvas');
const vctx = vc.getContext('2d', { willReadFrequently: true });
let GW = 170, GH = 96;
const ripples = [];
function addRipple(x, y, amp) {
  ripples.push({ x, y, t0: S.t, amp });
  if (ripples.length > 14) ripples.shift();
}
function initCloud() {
  GW = 170; GH = Math.round(GW / VA);
  vc.width = GW; vc.height = GH;
  const n = GW * GH;
  for (let i = N; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * S.W; pos[i * 3 + 1] = (Math.random() - 0.5) * S.H; pos[i * 3 + 2] = 0;
  }
  N = Math.min(n, MAX);
}

function stepCloud(now) {
  const { A } = buildForces();
  let data = null;
  if (camOK && vid.readyState >= 2) {
    vctx.save(); vctx.translate(GW, 0); vctx.scale(-1, 1);
    vctx.drawImage(vid, 0, 0, GW, GH);
    vctx.restore();
    data = vctx.getImageData(0, 0, GW, GH).data;
  }
  const sp = span();
  const cx = sp.x / GW, cy = sp.y / GH;
  const cell = Math.min(cx, cy);
  const t = S.t;
  const nA = A.length;
  // 손가락이 빠르게 움직이면 작은 파문
  for (const h of handList()) {
    if (!h.present || !h.init || h.pinch) continue;
    const s = Math.hypot(h.vel.x, h.vel.y);
    if (s > 9 && now - h.lastRipple > 140) { addRipple(h.lm[8].x, h.lm[8].y, Math.min(120, s * 4)); h.lastRipple = now; }
  }
  const live = ripples.filter((r) => t - r.t0 < 3.2);
  ripples.length = 0; ripples.push(...live);
  const nR = live.length;

  // 주먹을 쥐고 움직이면 클라우드 회전
  let grab = null;
  for (const h of handList()) if (h.present && h.fist) grab = h;
  if (grab) { G.cloudRY += grab.vel.x * 0.004; G.cloudRX -= grab.vel.y * 0.004; }
  else { G.cloudRY *= 0.97; G.cloudRX *= 0.97; }
  G.cloudRX = clamp(G.cloudRX, -1.2, 1.2);
  points.rotation.set(G.cloudRX, G.cloudRY, G.rot);
  points.scale.setScalar(G.scale);

  for (let gy = 0, i = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++, i++) {
      if (i >= N) break;
      const i3 = i * 3;
      let lum;
      if (data) {
        const o = i * 4;
        lum = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
        lum = clamp((lum - 0.08) * 1.35, 0, 1);
      } else {
        lum = 0.5 + 0.25 * Math.sin(gx * 0.12 + t) * Math.cos(gy * 0.15 - t * 0.7) + 0.2 * Math.sin((gx + gy) * 0.05 + t * 0.5);
      }
      const bx = (gx + 0.5) * cx - sp.x / 2, by = sp.y / 2 - (gy + 0.5) * cy;
      let tz = (lum - 0.45) * 260, ox = 0, oy = 0;
      for (let k = 0; k < nA; k++) {
        const a = A[k], R = a.r * 1.6;
        const dx = bx - a.x, dy = by - a.y, d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) + 0.01;
          let f = 1 - d / R; f *= f;
          tz -= f * 120; ox += (dx / d) * f * 16; oy += (dy / d) * f * 16;
        }
      }
      for (let r = 0; r < nR; r++) {
        const R = live[r], age = t - R.t0;
        const dx = bx - R.x, dy = by - R.y, d = Math.sqrt(dx * dx + dy * dy);
        const front = age * 620, off = d - front;
        if (off > -180 && off < 180) {
          tz += R.amp * Math.cos(off * 0.045) * Math.exp(-age * 1.3) * (1 - Math.abs(off) / 180);
        }
      }
      pos[i3] += (bx + ox - pos[i3]) * 0.3;
      pos[i3 + 1] += (by + oy - pos[i3 + 1]) * 0.3;
      pos[i3 + 2] += (tz - pos[i3 + 2]) * 0.3;
      const zHeat = clamp(Math.abs(pos[i3 + 2] - (lum - 0.45) * 260) / 120, 0, 1);
      const k = Math.min(1, lum * lum + zHeat);
      paint(i, k, 0.1 + lum * 0.85 + zHeat * 0.5);
      siz[i] = cell * (0.3 + lum * 0.55) + zHeat * 3;
    }
  }
}

/* ───────────────────────── 오버레이 (커서, 골격, 수치) ───────────────────────── */
const fx = $('#fx'), fctx = fx.getContext('2d');
const camFx = $('#camFx'), cctx = camFx.getContext('2d');
function sizeOverlays() {
  const dpr = Math.min(devicePixelRatio, 2);
  fx.width = S.W * dpr; fx.height = S.H * dpr; fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = camFx.getBoundingClientRect();
  camFx.width = r.width * dpr; camFx.height = r.height * dpr; cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawOverlay(now) {
  fctx.clearRect(0, 0, S.W, S.H);
  const acc = PAL.acc;
  const toS = (p) => [p.x + S.W / 2, S.H / 2 - p.y];
  fctx.font = '10px ui-monospace, Consolas, monospace';
  for (const h of handList()) {
    if (!h.present || !h.init) continue;
    const L = h.lm;
    if (S.skel) {
      fctx.strokeStyle = 'rgba(200,225,255,0.22)'; fctx.lineWidth = 1;
      fctx.beginPath();
      for (const [a, b] of CONN) { const [x1, y1] = toS(L[a]); const [x2, y2] = toS(L[b]); fctx.moveTo(x1, y1); fctx.lineTo(x2, y2); }
      fctx.stroke();
      fctx.fillStyle = 'rgba(220,240,255,0.5)';
      for (let j = 0; j < 21; j++) { const [x, y] = toS(L[j]); fctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    }
    // 검지 커서
    const [cx, cy] = toS(L[8]);
    fctx.strokeStyle = acc; fctx.lineWidth = 1.2;
    fctx.beginPath(); fctx.arc(cx, cy, 9, 0, Math.PI * 2); fctx.stroke();
    fctx.beginPath(); fctx.moveTo(cx - 15, cy); fctx.lineTo(cx - 11, cy); fctx.moveTo(cx + 11, cy); fctx.lineTo(cx + 15, cy);
    fctx.moveTo(cx, cy - 15); fctx.lineTo(cx, cy - 11); fctx.moveTo(cx, cy + 11); fctx.lineTo(cx, cy + 15); fctx.stroke();
    if (h.hoverEl && now >= h.cool) {
      const p = Math.min(1, (now - h.dwellT) / DWELL);
      fctx.lineWidth = 2.5; fctx.beginPath();
      fctx.arc(cx, cy, 16, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); fctx.stroke();
    }
    if (h.pinch && !h.uiPinch) {
      const [px, py] = toS(h.pp);
      const pr = 22 + Math.sin(now * 0.012) * 5;
      fctx.strokeStyle = '#fff'; fctx.lineWidth = 1;
      fctx.beginPath(); fctx.arc(px, py, pr, 0, Math.PI * 2); fctx.stroke();
      fctx.setLineDash([2, 6]); fctx.beginPath(); fctx.arc(px, py, pr + 18, now * 0.003, now * 0.003 + Math.PI * 2); fctx.stroke(); fctx.setLineDash([]);
    }
    // 수치 라벨 (TouchDesigner CHOP 느낌)
    const [wx, wy] = toS(L[0]);
    fctx.fillStyle = 'rgba(214,222,230,0.75)';
    fctx.fillText(`${h.key} ${h.gesture.padEnd(5)} x${(h.palm.x | 0).toString().padStart(5)} y${(h.palm.y | 0).toString().padStart(5)}`, wx + 14, wy + 18);
    fctx.fillStyle = 'rgba(214,222,230,0.45)';
    fctx.fillText(`pinch ${h.pinchR.toFixed(2)}  v ${Math.hypot(h.vel.x, h.vel.y).toFixed(1)}`, wx + 14, wy + 31);
  }
  if (G.two) {
    const [x1, y1] = toS(hands.a.pp), [x2, y2] = toS(hands.b.pp);
    fctx.strokeStyle = acc; fctx.lineWidth = 1; fctx.setLineDash([4, 5]);
    fctx.beginPath(); fctx.moveTo(x1, y1); fctx.lineTo(x2, y2); fctx.stroke(); fctx.setLineDash([]);
    fctx.fillStyle = acc;
    fctx.fillText(`scale ${G.scale.toFixed(2)}  rot ${(G.rot * 57.3).toFixed(0)}°`, (x1 + x2) / 2 + 8, (y1 + y2) / 2 - 8);
  }
  if (mouseActive()) {
    const [mx, my] = toS(mouse);
    fctx.strokeStyle = 'rgba(255,255,255,0.35)'; fctx.beginPath(); fctx.arc(mx, my, mouse.down ? 26 : 12, 0, Math.PI * 2); fctx.stroke();
  }
}

function drawCam() {
  const w = camFx.clientWidth, h = camFx.clientHeight;
  cctx.clearRect(0, 0, w, h);
  const acc = PAL.acc;
  for (const hd of handList()) {
    if (!hd.present || !hd.raw) continue;
    const R = hd.raw;
    const P = (j) => [(1 - R[j].x) * w, R[j].y * h];
    cctx.strokeStyle = acc; cctx.lineWidth = 1.5; cctx.globalAlpha = 0.9;
    cctx.beginPath();
    for (const [a, b] of CONN) { const [x1, y1] = P(a), [x2, y2] = P(b); cctx.moveTo(x1, y1); cctx.lineTo(x2, y2); }
    cctx.stroke();
    cctx.fillStyle = '#fff';
    for (let j = 0; j < 21; j++) { const [x, y] = P(j); cctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    // 손 박스
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let j = 0; j < 21; j++) { const [x, y] = P(j); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    cctx.globalAlpha = 0.55; cctx.lineWidth = 1; cctx.strokeRect(x0 - 8, y0 - 8, x1 - x0 + 16, y1 - y0 + 16);
    cctx.globalAlpha = 1; cctx.font = '9px ui-monospace, Consolas, monospace';
    cctx.fillStyle = acc; cctx.fillText(`${hd.key}·${hd.gesture}`, x0 - 8, y0 - 12);
  }
}

/* ───────────────────────── UI 바인딩 ───────────────────────── */
function setMode(m) {
  if (!['text', 'flow', 'cloud'].includes(m)) return;
  S.mode = m;
  document.body.classList.remove('m-text', 'm-flow', 'm-cloud');
  document.body.classList.add('m-' + m);
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  points.rotation.set(0, 0, 0); points.scale.setScalar(1);
  G.cloudRX = G.cloudRY = 0;
  if (m === 'text') setText(S.text);
  if (m === 'flow') initFlow();
  if (m === 'cloud') initCloud();
  applyFx();
  $('#fistHint').textContent = { text: '흩어 놓기 (펴면 다시 모임)', flow: '시간 정지', cloud: '쥐고 움직여 회전' }[m];
  $('#twoHint').textContent = { text: '글자 크기·회전', flow: '손 사이 빛줄기', cloud: '확대·회전' }[m];
}
function applyFx() {
  const base = { text: 0.8, flow: 0.86, cloud: 0.5 }[S.mode];
  after.uniforms.damp.value = S.trails ? base : 0.0;
  bloom.strength = { text: 0.75, flow: 0.8, cloud: 0.65 }[S.mode];
  document.querySelector('[data-toggle="trails"]').classList.toggle('on', S.trails);
  document.querySelector('[data-toggle="skel"]').classList.toggle('on', S.skel);
}
function setPalette(p) {
  if (!PALETTES[p]) return;
  S.pal = p; PAL = PALETTES[p];
  document.documentElement.style.setProperty('--acc', PAL.acc);
  document.querySelectorAll('[data-pal]').forEach((b) => b.classList.toggle('on', b.dataset.pal === p));
}
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('[data-pal]').forEach((b) => b.addEventListener('click', () => setPalette(b.dataset.pal)));
document.querySelectorAll('[data-text]').forEach((b) => b.addEventListener('click', () => {
  if (S.mode !== 'text') setMode('text');
  setText(b.dataset.text);
  document.querySelectorAll('[data-text]').forEach((x) => x.classList.toggle('on', x === b));
}));
document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.toggle === 'trails') S.trails = !S.trails;
  if (b.dataset.toggle === 'skel') S.skel = !S.skel;
  applyFx();
}));
$('#txt').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    setText(e.target.value);
    document.querySelectorAll('[data-text]').forEach((x) => x.classList.remove('on'));
    e.target.blur();
  }
});
addEventListener('keydown', (e) => {
  if (e.key === '1') setMode('text');
  else if (e.key === '2') setMode('flow');
  else if (e.key === '3') setMode('cloud');
  else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('noui');
  else if (e.key === 'c' || e.key === 'C') document.body.classList.toggle('nocam');
  else if (e.key === ' ') { burst(0, 0, Math.max(S.W, S.H), 30); e.preventDefault(); }
});

function onResize() {
  S.W = innerWidth; S.H = innerHeight;
  renderer.setSize(S.W, S.H);
  composer.setSize(S.W, S.H);
  camera.aspect = S.W / S.H;
  camera.position.z = camDist();
  camera.updateProjectionMatrix();
  mat.uniforms.uDist.value = camDist();
  sizeOverlays();
  if (S.mode === 'text') setText(S.text);
}
addEventListener('resize', onResize);

/* ───────────────────────── 루프 ───────────────────────── */
const statusEl = $('#status');
const setStatus = (s) => { statusEl.textContent = s; };
let lastT = performance.now(), fps = 60, detMs = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now; S.t += dt; S.frame++;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  if (landmarker && camOK && vid.readyState >= 2 && vid.currentTime !== lastVT) {
    lastVT = vid.currentTime;
    const t0 = performance.now();
    try { onResults(landmarker.detectForVideo(vid, now)); } catch (e) { console.warn(e); }
    detMs += (performance.now() - t0 - detMs) * 0.1;
  }
  updateHands(now);

  if (S.mode === 'text') stepText();
  else if (S.mode === 'flow') stepFlow();
  else stepCloud(now);

  geo.setDrawRange(0, N);
  aPos.needsUpdate = aCol.needsUpdate = aSiz.needsUpdate = true;
  if (S.mode !== 'cloud') {
    // 아주 약한 카메라 흔들림 → 입체감
    camera.position.x = Math.sin(S.t * 0.23) * S.W * 0.015;
    camera.position.y = Math.cos(S.t * 0.19) * S.H * 0.012;
  } else { camera.position.x *= 0.9; camera.position.y *= 0.9; }
  camera.lookAt(0, 0, 0);
  composer.render();

  drawOverlay(now);
  drawCam();

  if (S.frame % 15 === 0) {
    const n = (hands.a.present ? 1 : 0) + (hands.b.present ? 1 : 0);
    $('#camInfo').textContent = `${n} hand${n === 1 ? '' : 's'} · ${fps.toFixed(0)}fps`;
    const foot = $('#camFoot').querySelectorAll('span');
    foot[0].textContent = hands.a.present ? `${hands.a.gesture} ${hands.a.pinchR.toFixed(2)}` : '—';
    foot[1].textContent = hands.b.present ? `${hands.b.gesture} ${hands.b.pinchR.toFixed(2)}` : '—';
    if (landmarker) setStatus(`${S.mode.toUpperCase()} · ${N.toLocaleString()} particles · detect ${detMs.toFixed(1)}ms`);
  }
}

/* ───────────────────────── 부팅 ───────────────────────── */
async function boot() {
  setMode('text');
  setPalette('ice');
  document.querySelector('[data-text="A"]').classList.add('on');
  sizeOverlays();
  requestAnimationFrame(loop);

  setStatus('카메라 권한 요청 중…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' }, audio: false,
    });
    vid.srcObject = stream;
    await vid.play();
    VA = vid.videoWidth / vid.videoHeight || 16 / 9;
    $('#camView').style.aspectRatio = `${vid.videoWidth} / ${vid.videoHeight}`;
    $('#camEmpty').style.display = 'none';
    camOK = true;
    sizeOverlays();
    if (S.mode === 'cloud') initCloud();
  } catch (e) {
    console.warn(e);
    $('#camEmpty').textContent = '카메라 없음 · 마우스로 조작';
    setStatus('카메라를 쓸 수 없어 마우스 모드로 동작합니다');
    return;
  }

  setStatus('손 인식 모델 로딩 중…');
  const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: './vendor/models/hand_landmarker.task', delegate },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
  } catch (e) {
    console.warn('GPU delegate 실패 → CPU', e);
    landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
  }
  setStatus('준비 완료 — 카메라에 손을 보여주세요');
}
boot().catch((e) => { console.error(e); setStatus('오류: ' + e.message); });

// 디버그용 훅 (콘솔에서 상태 확인/가짜 손 주입)
window.__hf = { S, G, hands, onResults, setMode, setText, setPalette, get landmarker() { return landmarker; }, get camOK() { return camOK; } };
