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
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
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
  creature.resize();
  water.resize();
}
addEventListener('resize', resize);
resize();

/* ───────── 루프 ───────── */
let last = performance.now(), started = false, debug = false;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (started) {
    sense.update(sense.t + dt, dt);
    director.update(dt);
  }
  creature.update(dt, sense);
  creature.draw();
  water.step(dt);
  water.render(now / 1000, started ? sense.tips : []);
  if (debug) drawDebug();
}
requestAnimationFrame(loop);

/* ───────── 시작 ───────── */
async function start() {
  if (started) return;
  started = true;
  sound.init();
  document.body.classList.add('started');
  try { await document.fonts.load('700 40px "Gaegu"'); await document.fonts.load('400 20px "Gowun Batang"'); } catch { /* */ }
  sense.start().then(() => { if (sense.cam) faces.load(); }).catch((e) => console.warn(e));
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
    `gesture ${sense.gesture ?? '—'}  asking ${director.asking}\n` +
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

window.__hello = { creature, director, sense, water, sound, faces };
