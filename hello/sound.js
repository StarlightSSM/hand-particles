// sound.js — 모든 소리를 Web Audio로 합성 (외부 음원 없음 → 라이선스 걱정 없음)
//  물방울 · 아이의 옹알이 목소리 · 공간 잔향 · 앰비언트 패드 · 이름을 찾았을 때의 종소리

const PENTA = [0, 2, 4, 7, 9, 12];

export function createSound() {
  const S = { ctx: null, out: null, wet: null, pad: null, padGain: null, padFilter: null, noise: null, muted: false, vol: 0.9 };

  function init() {
    if (S.ctx) { S.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (S.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    S.out = ctx.createGain(); S.out.gain.value = S.vol;
    S.out.connect(comp); comp.connect(ctx.destination);
    const rev = ctx.createConvolver(); rev.buffer = impulse(3.4, 2.4);
    S.wet = ctx.createGain(); S.wet.gain.value = 0.55;
    S.wet.connect(rev); rev.connect(S.out);
    const n = ctx.sampleRate;
    S.noise = ctx.createBuffer(1, n, n);
    const d = S.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  function impulse(dur, decay) {
    const ctx = S.ctx, n = Math.floor(ctx.sampleRate * dur);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** decay * (i < 200 ? i / 200 : 1);
    }
    return b;
  }

  // 소리 하나를 팬 + 드라이/웻으로 내보냄
  function route(node, pan = 0, wet = 0.4, dry = 1) {
    const ctx = S.ctx;
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    const dg = ctx.createGain(); dg.gain.value = dry; p.connect(dg); dg.connect(S.out);
    const wg = ctx.createGain(); wg.gain.value = wet; p.connect(wg); wg.connect(S.wet);
  }
  const ok = () => S.ctx && S.ctx.state === 'running' && !S.muted;
  function env(g, t, peak, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  /* 물방울: 올라가는 기포 공명 + 낮은 몸통 + 작은 클릭 */
  // 물방울이 몰릴 때 소리 노드가 폭증하지 않게: 0.4초 안에 6개까지, 넘치면 점점 작게/생략
  const recentDrops = [];
  function drop(x01 = 0.5, strength = 1) {
    if (!ok()) return;
    const now = S.ctx.currentTime;
    while (recentDrops.length && now - recentDrops[0] > 0.4) recentDrops.shift();
    if (recentDrops.length >= 6) return;
    recentDrops.push(now);
    strength *= 1 - recentDrops.length * 0.08;
    const ctx = S.ctx, t = ctx.currentTime + 0.005;
    const f0 = 480 + Math.random() * 420;
    const g = ctx.createGain(); env(g, t, 0.22 * strength, 0.004, 0.3);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2.3, t + 0.085);
    o.connect(g);
    const g2 = ctx.createGain(); env(g2, t, 0.1 * strength, 0.003, 0.18);
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(f0 * 0.42, t); o2.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + 0.06);
    o2.connect(g2);
    const nz = ctx.createBufferSource(); nz.buffer = S.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.2;
    const g3 = ctx.createGain(); env(g3, t, 0.05 * strength, 0.001, 0.025);
    nz.connect(bp); bp.connect(g3);
    const pan = (x01 - 0.5) * 1.3;
    route(g, pan, 0.6); route(g2, pan, 0.4); route(g3, pan, 0.3);
    o.start(t); o.stop(t + 0.4); o2.start(t); o2.stop(t + 0.3); nz.start(t, Math.random()); nz.stop(t + 0.05);
  }

  /* 아이 목소리: 글자마다 짧은 옹알이 (펜타토닉, 물음표면 끝이 올라감) */
  let voiceBase = 0;
  function blip(ch, i, n, text) {
    if (!ok() || /[\s….,~]/.test(ch)) return;
    const ctx = S.ctx, t = ctx.currentTime + 0.002;
    const code = ch.charCodeAt(0);
    let f = 430 * 2 ** ((PENTA[code % 6] + voiceBase) / 12);
    const q = text.trim().endsWith('?');
    const last = i >= n - 2;
    if (ch === '?' || (q && last)) f *= 1.38;
    if (ch === '!') f *= 1.22;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.94, t); o.frequency.exponentialRampToValueAtTime(f * (q && last ? 1.2 : 1.04), t + 0.06);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.01;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300 + (code % 5) * 260; bp.Q.value = 1.4;
    const g = ctx.createGain(); env(g, t, 0.11, 0.008, 0.075);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(bp); o2.connect(g2); g2.connect(bp); bp.connect(g);
    route(g, (Math.random() - 0.5) * 0.15, 0.22);
    o.start(t); o.stop(t + 0.11); o2.start(t); o2.stop(t + 0.11);
  }
  function setVoice(semi) { voiceBase = semi; }

  /* 움찔 */
  function flinch() {
    if (!ok()) return;
    const ctx = S.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1150, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.13);
    const g = ctx.createGain(); env(g, t, 0.1, 0.005, 0.14);
    o.connect(g); route(g, 0, 0.35);
    o.start(t); o.stop(t + 0.2);
  }
  function giggle() {
    if (!ok()) return;
    [0, 0.085, 0.17].forEach((d, k) => setTimeout(() => blip('하', 0, 3, ''), d * 1000 + k));
  }

  /* 쓰다듬을 때: 낮고 부드러운 그르릉 */
  function purr() {
    if (!ok()) return;
    const ctx = S.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 92;
    const trem = ctx.createOscillator(), tg = ctx.createGain();
    trem.frequency.value = 23; tg.gain.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    const am = ctx.createGain(); am.gain.value = 0.5;
    trem.connect(tg); tg.connect(am.gain);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    o.connect(lp); lp.connect(am); am.connect(g); route(g, 0, 0.3);
    o.start(t); trem.start(t); o.stop(t + 1.4); trem.stop(t + 1.4);
    [0, 0.12].forEach((d) => setTimeout(() => blip('응', 0, 2, ''), 350 + d * 1000));
  }

  /* 찰칵 — 두 번의 짧은 기계음 */
  function shutter() {
    if (!ok()) return;
    const ctx = S.ctx, t = ctx.currentTime;
    for (const [d, f, v] of [[0, 3200, 0.16], [0.075, 2100, 0.11]]) {
      const nz = ctx.createBufferSource(); nz.buffer = S.noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 2.5;
      const g = ctx.createGain(); env(g, t + d, v, 0.001, 0.045);
      nz.connect(bp); bp.connect(g); route(g, 0, 0.25);
      nz.start(t + d, Math.random()); nz.stop(t + d + 0.06);
    }
  }

  /* 종소리 아르페지오 */
  function chime(notes = [74, 78, 81, 86, 88], gap = 0.13, vol = 0.07) {
    if (!ok()) return;
    const ctx = S.ctx, t0 = ctx.currentTime + 0.02;
    notes.forEach((m, k) => {
      const t = t0 + k * gap, f = 440 * 2 ** ((m - 69) / 12);
      for (const [mul, a, dur] of [[1, 1, 2.6], [2.76, 0.28, 1.2], [5.4, 0.1, 0.6]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
        const g = ctx.createGain(); env(g, t, vol * a, 0.004, dur);
        o.connect(g); route(g, (k / notes.length - 0.5) * 0.8, 0.8, 0.8);
        o.start(t); o.stop(t + dur + 0.1);
      }
    });
  }

  /* 물속에서 먹이 번질 때의 낮은 숨 */
  function swell(dur = 3) {
    if (!ok()) return;
    const ctx = S.ctx, t = ctx.currentTime;
    const nz = ctx.createBufferSource(); nz.buffer = S.noise; nz.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(120, t); lp.frequency.exponentialRampToValueAtTime(900, t + dur * 0.6); lp.frequency.exponentialRampToValueAtTime(200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    nz.connect(lp); lp.connect(g); route(g, 0, 0.8, 0.6);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 73.4;
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.5); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og); route(og, 0, 0.5);
    nz.start(t); nz.stop(t + dur + 0.1); o.start(t); o.stop(t + dur + 0.1);
  }

  /* 앰비언트: 아주 옅은 D add9 패드 + 방 소리 */
  function ambient(level = 1, bright = 0.3, time = 4) {
    if (!S.ctx) return;
    const ctx = S.ctx, t = ctx.currentTime;
    if (!S.pad) {
      S.padGain = ctx.createGain(); S.padGain.gain.value = 0.0001;
      S.padFilter = ctx.createBiquadFilter(); S.padFilter.type = 'lowpass'; S.padFilter.frequency.value = 700; S.padFilter.Q.value = 0.4;
      S.padFilter.connect(S.padGain);
      route(S.padGain, 0, 0.7, 0.7);
      S.pad = [146.83, 220.0, 277.18, 329.63, 440.0, 659.25].map((f, k) => {
        const o = ctx.createOscillator(); o.type = k % 2 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 8;
        const g = ctx.createGain(); g.gain.value = 0.16 / (1 + k * 0.4);
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 0.04 + Math.random() * 0.08; lg.gain.value = g.gain.value * 0.7;
        lfo.connect(lg); lg.connect(g.gain);
        o.connect(g); g.connect(S.padFilter); o.start(); lfo.start();
        return o;
      });
      const nz = ctx.createBufferSource(); nz.buffer = S.noise; nz.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      const ng = ctx.createGain(); ng.gain.value = 0.012;
      nz.connect(lp); lp.connect(ng); ng.connect(S.padGain); nz.start();
    }
    S.padGain.gain.cancelScheduledValues(t);
    S.padGain.gain.setValueAtTime(Math.max(0.0001, S.padGain.gain.value), t);
    S.padGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.11 * level), t + time);
    S.padFilter.frequency.cancelScheduledValues(t);
    S.padFilter.frequency.setValueAtTime(S.padFilter.frequency.value, t);
    S.padFilter.frequency.exponentialRampToValueAtTime(350 + bright * 2600, t + time);
  }

  function setMuted(m) {
    S.muted = m;
    if (S.out) S.out.gain.setTargetAtTime(m ? 0 : S.vol, S.ctx.currentTime, 0.1);
  }

  return Object.assign(S, { init, drop, blip, setVoice, flinch, giggle, purr, shutter, chime, swell, ambient, setMuted });
}
