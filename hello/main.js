// hello, stranger — 진입점
import * as THREE from 'three';
import { createWater } from './water.js';
import { createCreature } from './creature.js';
import { createSound } from './sound.js';
import { createSense } from './sense.js';
import { createDirector } from './director.js';

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
director = createDirector({ C: creature, water, sound, sense });

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
  sense.start().catch((e) => console.warn(e));
  director.run();
}
$('#begin').addEventListener('click', start);
addEventListener('keydown', (e) => {
  if (!started && (e.key === 'Enter' || e.key === ' ')) { start(); return; }
  const k = e.key.toLowerCase();
  if (k === 'm') { sound.setMuted(!sound.muted); toast(sound.muted ? '소리 끔' : '소리 켬'); }
  else if (k === 'f') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
  else if (k === 'r' && started) { director.restart({ forget: e.shiftKey }); toast(e.shiftKey ? '처음부터 (기억 지움)' : '처음부터'); }
  else if (k === 'd') { debug = !debug; $('#debug').hidden = !debug; }
  else if (k === 'h' || k === '?') $('#keys').classList.toggle('show');
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
    `traits  warm ${tr.warm.toFixed(1)} play ${tr.play.toFixed(1)} calm ${tr.calm.toFixed(1)} gaze ${tr.gaze.toFixed(1)}\n` +
    `tips    ${sense.tips.map((t) => `${t.key}:${t.hover.toFixed(2)}/${t.dwell.toFixed(2)}`).join(' ')}`;
}

window.__hello = { creature, director, sense, water, sound };
