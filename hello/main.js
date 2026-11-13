// hello, stranger — 진입점
import * as THREE from 'three';
import { createWater } from './water.js';
import { createCreature } from './creature.js';
import { createSound } from './sound.js';
import { createSense } from './sense.js';
import { createDirector } from './director.js';
import { createFaceId } from './faceid.js';

const $ = (s) => document.querySelector(s);

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
// 렌더 해상도 단계 — 느린 GPU에서는 자동으로 낮춰 프레임을 지킨다 (물결·먹은 부드러운 그림이라 티가 거의 안 남)
const QUALITY = [1.5, 1.25, 1.0, 0.8];
let qi = QUALITY.findIndex((q) => q <= Math.min(devicePixelRatio, 1.5));
if (qi < 0) qi = QUALITY.length - 1;
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[qi]));
renderer.setSize(innerWidth, innerHeight);
$('#app').appendChild(renderer.domElement);

const inkCanvas = document.createElement('canvas');
const sound = createSound();
let water;
const creature = createCreature(inkCanvas, {
  onChar: (ch, i, n, text) => sound.blip(ch, i, n, text),
  onBlink: () => { // 깜빡일 때 수면에 아주 작은 떨림
    for (const e of creature.eyes()) water?.drop(e.x, e.y + creature.E * 0.1, 10, 0.006);
  },
});
water = createWater(renderer, inkCanvas);
let director = null;
const sense = createSense((type, data) => director?.emit(type, data));
const faces = createFaceId(sense.vid);
director = createDirector({ C: creature, water, sound, sense, faces });

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  creature.resize(QUALITY[qi]);
  water.resize();
}
addEventListener('resize', resize);
resize();

/* ───────── 루프 ───────── */
let last = performance.now(), started = false, debug = false;
// 구간별 시간(ms, 지수 평균) — D 센서 화면에 표시
const perf = { sense: 0, director: 0, draw: 0, step: 0, render: 0, frame: 16 };
const lap = (k, t0) => { const t = performance.now(); perf[k] += (t - t0 - perf[k]) * 0.1; return t; };
let qT = 0, qGood = 0, qPrevMs = 0, qFloor = QUALITY.length - 1;
function adaptQuality(dt) {
  qT += dt;
  if (qT < 1.5) return;
  qT = 0;
  const ms = perf.frame;
  if (qPrevMs && ms > qPrevMs * 0.9) {
    // 낮췄는데 빨라지지 않았다 → GPU가 병목이 아님. 되돌리고 더는 낮추지 않음 (괜히 흐려지지 않게)
    qi--; qFloor = qi; qPrevMs = 0;
  } else {
    qPrevMs = 0;
    if (ms > 22 && qi < qFloor) { qPrevMs = ms; qi++; qGood = 0; }      // 45fps 미만 → 한 단계 낮춤
    else if (ms < 13 && qi > 0 && ++qGood >= 6) { qi--; qGood = 0; }    // 9초 넘게 여유 → 한 단계 올림
    else return;
  }
  applyQuality();
  perf.frame = 16;
}
function applyQuality() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[qi]));
  renderer.setSize(innerWidth, innerHeight);
  creature.resize(QUALITY[qi]);
  water.resizePaper();
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  perf.frame += (now - last - perf.frame) * 0.1;
  if (started) adaptQuality(dt);
  last = now;
  let t = performance.now();
  if (started) {
    sense.update(sense.t + dt, dt); t = lap('sense', t);
    director.update(dt); t = lap('director', t);
  }
  creature.update(dt, sense);
  creature.draw(); t = lap('draw', t);
  water.step(dt); t = lap('step', t);
  water.render(now / 1000, started ? sense.tips : []); lap('render', t);
  if (debug) drawDebug();
}
requestAnimationFrame(loop);

// 얼굴 식별 모델은 무겁고 첫 실행 때 GPU 준비로 몇 초 멈추므로, 시작 화면에 있을 때 미리 불러 둔다
(window.requestIdleCallback || ((f) => setTimeout(f, 600)))(() => faces.load());

/* ───────── 시작 ───────── */
async function start() {
  if (started) return;
  started = true;
  sound.init();
  document.body.classList.add('started');
  try { await document.fonts.load('700 40px "Gaegu"'); await document.fonts.load('400 20px "Gowun Batang"'); } catch { /* */ }
  sense.start().catch((e) => console.warn(e));
  director.run();
}
$('#begin').addEventListener('click', start);

/* ───────── 말 걸기 (키보드) ───────── */
const talkForm = $('#talk'), talkIn = $('#talkIn');
const openTalk = () => { talkForm.classList.add('open'); talkIn.focus(); };
const closeTalk = () => { talkForm.classList.remove('open'); talkIn.value = ''; talkIn.blur(); };
talkForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = talkIn.value.trim();
  closeTalk();
  if (text) director.emit('text', { text });
});
talkIn.addEventListener('keydown', (e) => {
  e.stopPropagation(); // 입력 중에는 단축키 무시
  if (e.key === 'Escape') closeTalk();
});
talkIn.addEventListener('blur', () => { if (!talkIn.value.trim()) talkForm.classList.remove('open'); });

addEventListener('keydown', (e) => {
  if (!started && (e.key === 'Enter' || e.key === ' ')) { start(); return; }
  if (e.key === 'Enter' && started && !e.isComposing) { e.preventDefault(); openTalk(); return; }
  // 한글 입력 상태에서도 동작하도록 키 위치(code) 기준
  const k = ({ KeyF: 'f', KeyM: 'm', KeyR: 'r', KeyD: 'd', KeyH: 'h', KeyL: 'l' })[e.code] ?? e.key.toLowerCase();
  if (k === 'm') { sound.setMuted(!sound.muted); toast(sound.muted ? '소리 끔' : '소리 켬'); }
  else if (k === 'f') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
  else if (k === 'r' && started) { director.restart({ forget: e.shiftKey }); toast(e.shiftKey ? '처음부터 (기억 지움)' : '처음부터'); }
  else if (k === 'd') { debug = !debug; $('#debug').hidden = !debug; }
  else if (k === 'h' || k === '?') $('#keys').classList.toggle('show');
  else if (k === 'l') toggleFaces();
  else if (e.key === 'Escape') $('#faces').hidden = true;
});

let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1400);
}

/* ───────── 디버그 (D) ───────── */
const dbg = $('#debug canvas'), dctx = dbg.getContext('2d');
function drawDebug() {
  const v = sense.vid;
  dctx.clearRect(0, 0, dbg.width, dbg.height);
  if (v.readyState >= 2) {
    dctx.save(); dctx.translate(dbg.width, 0); dctx.scale(-1, 1);
    dctx.drawImage(v, 0, 0, dbg.width, dbg.height); dctx.restore();
  }
  const tr = director.traits;
  $('#debug pre').textContent =
    `phase   ${director.phase}\nhands   ${sense.handsN}  motion ${sense.motion.toFixed(2)}  still ${sense.still.toFixed(1)}\n` +
    `face    ${sense.face ? `${sense.face.size.toFixed(2)} (${sense.face.nx.toFixed(2)}, ${sense.face.ny.toFixed(2)})` : '—'}\n` +
    `away    ${sense.away.toFixed(1)}  idle ${sense.idle.toFixed(1)}\n` +
    `gesture ${sense.gesture ?? '—'} (${(sense.gestureHeld ?? 0).toFixed(1)}s)  asking ${director.asking}\n` +
    `shape   ${sense.shapeDbg ?? ''}\n` +
    `expr    ${director.expr.state ?? '—'}  v ${director.expr.valence.toFixed(2)}  ${Object.entries(director.expr.scores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' ')}\n` +
    `perf    ${(1000 / perf.frame).toFixed(0)}fps x${QUALITY[qi]}  sense ${perf.sense.toFixed(1)} dir ${perf.director.toFixed(1)} draw ${perf.draw.toFixed(1)} step ${perf.step.toFixed(1)} render ${perf.render.toFixed(1)}ms\n` +
    `faceid  ${faces.ready ? 'ready' : faces.err ? 'error' : 'loading'}  ${faces.last ? `${faces.last.status} d=${faces.last.d?.toFixed?.(3)} ${faces.last.who ?? ''}` : ''}  now ${director.person?.callName ?? (director.person ? '(이름 없음)' : '—')}\n` +
    `traits  warm ${tr.warm.toFixed(1)} play ${tr.play.toFixed(1)} calm ${tr.calm.toFixed(1)} gaze ${tr.gaze.toFixed(1)}\n` +
    `tips    ${sense.tips.map((t) => `${t.key}:${t.hover.toFixed(2)}/${t.dwell.toFixed(2)}`).join(' ')}`;
}

/* ───────── 기억하는 얼굴 목록 (L) ───────── */
function toggleFaces(show = $('#faces').hidden) {
  const box = $('#faces');
  box.hidden = !show;
  if (!show) return;
  const L = faces.list();
  const ul = box.querySelector('ul');
  ul.innerHTML = '';
  if (!L.length) ul.innerHTML = '<li class="empty">아직 기억하는 얼굴이 없어요.</li>';
  for (const p of L) {
    const li = document.createElement('li');
    const img = document.createElement('img'); img.alt = ''; if (p.thumb) img.src = p.thumb;
    const info = document.createElement('div');
    const nm = document.createElement('b'); nm.textContent = p.callName || '이름 모를 친구';
    const meta = document.createElement('span');
    meta.textContent = `${p.visits || 1}번 만남 · 마지막 ${new Date(p.lastSeen).toLocaleDateString('ko-KR')} · 얼굴 ${p.samples.length}장`;
    info.append(nm, meta);
    const del = document.createElement('button'); del.textContent = '잊기';
    del.addEventListener('click', () => { faces.remove(p.id); toggleFaces(true); });
    li.append(img, info, del);
    ul.append(li);
  }
}
$('#facesClose').addEventListener('click', () => toggleFaces(false));
$('#facesClear').addEventListener('click', () => { faces.clear(); toggleFaces(true); });

window.__hello = { creature, director, sense, water, sound, faces, perf, get quality() { return QUALITY[qi]; },
  __setQuality(q) { qi = Math.max(0, QUALITY.indexOf(q)); applyQuality(); } };
