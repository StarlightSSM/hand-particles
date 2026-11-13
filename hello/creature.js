// creature.js — 흰 수면 아래 사는 아이. 애니풍 두 눈 + 잉크 글씨를 2D 캔버스에 그린다.
// 이 캔버스는 water.js가 텍스처로 받아 물결에 굴절시킨다 (눈과 글씨가 수면 위 그림처럼 일렁임).

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - (1 - x) ** 3;

// 표정 프리셋 — open: 눈 뜬 정도, pupil: 동공, happy: ^^, squeeze: ><, low: 아래 눈꺼풀(눈웃음),
//   brow: 눈썹 높이, inner: 눈썹 안쪽 올림(걱정), asym: 한쪽 눈썹만 올림(갸웃), blush: 볼터치
const MOODS = {
  neutral:   { open: 1.0,  pupil: 1.0,  happy: 0, squeeze: 0, low: 0,    brow: 0.0,  inner: 0,    asym: 0,    blush: 0 },
  curious:   { open: 1.08, pupil: 1.28, happy: 0, squeeze: 0, low: 0,    brow: 0.25, inner: 0.1,  asym: 0.5,  blush: 0 },
  wonder:    { open: 1.12, pupil: 1.38, happy: 0, squeeze: 0, low: 0,    brow: 0.45, inner: 0.25, asym: 0,    blush: 0.1 },
  surprised: { open: 1.22, pupil: 0.72, happy: 0, squeeze: 0, low: 0,    brow: 0.9,  inner: 0.2,  asym: 0,    blush: 0 },
  happy:     { open: 1.0,  pupil: 1.15, happy: 1, squeeze: 0, low: 0,    brow: 0.3,  inner: 0,    asym: 0,    blush: 0.55 },
  smile:     { open: 1.0,  pupil: 1.2,  happy: 0, squeeze: 0, low: 0.38, brow: 0.2,  inner: 0,    asym: 0,    blush: 0.3 },
  shy:       { open: 0.78, pupil: 1.25, happy: 0, squeeze: 0, low: 0.35, brow: -0.05, inner: 0.45, asym: 0,   blush: 1 },
  sleepy:    { open: 0.32, pupil: 0.95, happy: 0, squeeze: 0, low: 0.1,  brow: -0.2, inner: 0.1,  asym: 0,    blush: 0 },
  sad:       { open: 0.82, pupil: 1.1,  happy: 0, squeeze: 0, low: 0.15, brow: 0.1,  inner: 0.8,  asym: 0,    blush: 0 },
  thinking:  { open: 0.9,  pupil: 0.95, happy: 0, squeeze: 0, low: 0.1,  brow: 0.2,  inner: 0.1,  asym: -0.6, blush: 0 },
  squeeze:   { open: 0.0,  pupil: 1.0,  happy: 0, squeeze: 1, low: 0,    brow: -0.25, inner: 0.5, asym: 0,    blush: 0.2 },
};
const KEYS = Object.keys(MOODS.neutral);

export function createCreature(canvas, hooks = {}) {
  const g = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, E = 100;

  const st = {
    t: 0,
    x: 0, y: 0, ox: 0, oy: 0, tilt: 0, tTilt: 0,
    presence: 0, tPresence: 0, presenceRate: 1.5,
    reveal: 0, tReveal: 0, revealRate: 0.6,
    lid: 0, tLid: 0, lidRate: 4,
    blink: 0, blinkT: -1, nextBlink: 3, blinkQueue: 0,
    gx: 0, gy: 0, saccadeT: 0, micro: { x: 0, y: 0 }, microT: 0,
    m: { ...MOODS.neutral }, base: 'neutral', mood: 'neutral', moodUntil: 0,
    hue: 225, sat: 0.06, lit: 0.34, tHue: 225, tSat: 0.06, tLit: 0.34,
    sparkle: 0, tSparkle: 0, bounceT: -9, bounceAmp: 0,
    attn: 'auto', lookPt: null, glance: null, glanceUntil: 0, wanderPt: null, wanderT: 0,
    interest: 0, autoBlink: true, alive: false,
    conv: 0, winkSide: 0, winkUntil: 0,
  };

  /* ───────────────────── 크기 ───────────────────── */
  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 1.5);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    E = clamp(Math.min(W, H * 1.25) * 0.165, 70, 260);
    st.x = W / 2; st.y = H * 0.44;
  }

  /* ───────────────────── 시선 ───────────────────── */
  function gazeTarget(sense) {
    const t = st.t;
    if (st.glance && t < st.glanceUntil) return st.glance;
    if (st.attn === 'down') return { x: st.x + st.gx * 4, y: st.y + E * 6 };
    if (st.attn === 'up') return { x: st.x + E * 2.5, y: st.y - E * 5 };
    if (st.attn === 'point' && st.lookPt) return st.lookPt;
    if (st.attn === 'around') {
      if (!st.wanderPt || t > st.wanderT) {
        const a = Math.random() * TAU;
        st.wanderPt = { x: st.x + Math.cos(a) * E * 5, y: st.y + Math.sin(a) * E * 2.5 };
        st.wanderT = t + 0.6 + Math.random() * 0.9;
      }
      return st.wanderPt;
    }
    if (st.attn === 'viewer') return 'viewer';
    // auto: 움직이는 손끝 > 내 얼굴 > 가끔 두리번
    const tip = sense.tips[0];
    if (tip) {
      const near = Math.hypot(tip.x - st.x, tip.y - st.y) < E * 3.2;
      if (sense.motion > 0.025 || near || tip.dwell > 0) return tip;
    }
    if (sense.face) return 'viewer';
    if (t > st.wanderT) {
      st.wanderPt = Math.random() < 0.6 ? 'viewer'
        : { x: st.x + (Math.random() - 0.5) * E * 8, y: st.y + (Math.random() - 0.5) * E * 3 };
      st.wanderT = t + 1.5 + Math.random() * 3;
    }
    return st.wanderPt || 'viewer';
  }

  function updateGaze(dt, sense) {
    const tg = gazeTarget(sense);
    let tx, ty;
    if (tg === 'viewer') {
      // 나를 바라본다: 내 얼굴이 카메라에서 어디 있는지에 따라 살짝 그쪽으로 (거의 정면 = 눈 맞춤)
      const f = sense.face;
      tx = f ? f.nx * 0.32 : 0; ty = f ? f.ny * 0.22 - 0.02 : 0.02;
      if (st.t > st.microT) { // 미세 단속운동 — 살아 있는 눈
        st.micro = { x: (Math.random() - 0.5) * 0.09, y: (Math.random() - 0.5) * 0.06 };
        st.microT = st.t + 0.35 + Math.random() * 1.1;
      }
      tx += st.micro.x; ty += st.micro.y;
    } else {
      tx = (tg.x - st.x) / (E * 4.2); ty = (tg.y - st.y) / (E * 3.2);
      const l = Math.hypot(tx, ty);
      if (l > 1) { tx /= l; ty /= l; }
    }
    const jump = Math.hypot(tx - st.gx, ty - st.gy) > 0.22;
    const rate = jump ? 28 : 9;
    st.gx = damp(st.gx, tx, rate, dt); st.gy = damp(st.gy, ty, rate, dt);
    // 손끝이 가까울수록 동공이 커짐 (관심)
    const tip = sense.tips[0];
    const near = tip ? clamp(1 - Math.hypot(tip.x - st.x, tip.y - st.y) / (E * 5), 0, 1) : 0;
    st.interest = damp(st.interest, near, 3, dt);
    const p = facePose();
    const dc = tip ? Math.hypot(tip.x - p.x, tip.y - p.y) : 1e9;
    st.conv = damp(st.conv, clamp(1 - dc / (E * 1.05), 0, 1), 6, dt);
  }

  /* ───────────────────── 갱신 ───────────────────── */
  function update(dt, sense) {
    st.t += dt;
    const t = st.t;
    st.presence = damp(st.presence, st.tPresence, st.presenceRate, dt);
    st.reveal = Math.min(st.tReveal, st.reveal + dt * st.revealRate);
    if (st.tReveal < st.reveal) st.reveal = st.tReveal;

    if (st.mood !== st.base && t > st.moodUntil) st.mood = st.base;
    const M = MOODS[st.mood] || MOODS.neutral;
    for (const k of KEYS) st.m[k] = damp(st.m[k], M[k], k === 'squeeze' ? 22 : 9, dt);

    st.lid = damp(st.lid, st.tLid, st.lidRate, dt);

    // 깜빡임
    if (st.autoBlink && st.alive && st.lid > 0.5 && t > st.nextBlink && st.blinkT < 0) {
      blink(Math.random() < 0.22);
    }
    if (st.blinkT >= 0) {
      st.blinkT += dt;
      const D1 = 0.075, D2 = 0.13;
      if (st.blinkT < D1) st.blink = easeOut(st.blinkT / D1);
      else if (st.blinkT < D1 + D2) st.blink = 1 - sstep(0, 1, (st.blinkT - D1) / D2);
      else {
        st.blink = 0; st.blinkT = -1;
        if (st.blinkQueue > 0) { st.blinkQueue--; st.blinkT = 0; hooks.onBlink?.(); }
        else st.nextBlink = t + 2.2 + Math.random() * 4;
      }
    }

    updateGaze(dt, sense);
    st.tilt = damp(st.tilt, st.tTilt + st.gx * 0.05, 3, dt);
    st.ox = damp(st.ox, st.gx * E * 0.18, 4, dt);
    st.oy = damp(st.oy, st.gy * E * 0.1, 4, dt);

    st.hue = lerpHue(st.hue, st.tHue, 1 - Math.exp(-1.2 * dt));
    st.sat = damp(st.sat, st.tSat, 1.2, dt);
    st.lit = damp(st.lit, st.tLit, 1.2, dt);
    st.sparkle = damp(st.sparkle, st.tSparkle, 3, dt);

    updateTexts(dt);
  }
  const lerpHue = (a, b, k) => { let d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };

  /* ───────────────────── 그리기 ───────────────────── */
  function draw() {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, W, H);
    if (st.presence > 0.003) drawFace();
    drawTexts();
  }

  function facePose() {
    const t = st.t;
    const bob = Math.sin(t * 0.9) * E * 0.035 + Math.sin(t * 0.37) * E * 0.02;
    const bt = t - st.bounceT;
    const bounce = bt < 0.9 ? -Math.abs(Math.sin(bt * 10)) * Math.exp(-bt * 4) * E * 0.22 * st.bounceAmp : 0;
    return { x: st.x + st.ox, y: st.y + st.oy + bob + bounce, s: 1 + Math.sin(t * 1.3) * 0.006 };
  }

  function drawFace() {
    const p = facePose();
    g.save();
    g.globalAlpha = st.presence;
    g.translate(p.x, p.y); g.rotate(st.tilt); g.scale(p.s, p.s);
    drawBlush();
    for (const side of [-1, 1]) {
      g.save();
      g.translate(side * E * 0.98, 0);
      const persp = 1 - side * st.gx * 0.07; // 옆을 보면 먼 쪽 눈이 살짝 좁아짐
      g.scale(persp, 1);
      drawEye(side);
      g.restore();
    }
    g.restore();
  }

  // 눈 윤곽: 위 눈꺼풀/아래 눈꺼풀 베지어 (같은 x 제어점 → 감으면 정확히 포개짐)
  function curves(side, o) {
    const low = st.m.low;
    const inner = { x: -side * 0.45 * E, y: 0.12 * E };
    const outer = { x: side * 0.5 * E, y: -0.03 * E };
    const lowY = 0.36 * E * (1 - low * 0.6);
    const c1x = -side * 0.34 * E, c2x = side * 0.2 * E;
    const u1 = lerp(lowY * 1.02, -0.36 * E, o), u2 = lerp(lowY, -0.56 * E, o);
    return {
      inner, outer, lowY, upY: Math.min(u1, u2),
      up: [inner, { x: c1x, y: u1 }, { x: c2x, y: u2 }, outer],
      lo: [outer, { x: c2x, y: lowY }, { x: c1x, y: lowY * 1.02 }, inner],
    };
  }
  const bez = (P, s) => {
    const u = 1 - s;
    return {
      x: u * u * u * P[0].x + 3 * u * u * s * P[1].x + 3 * u * s * s * P[2].x + s * s * s * P[3].x,
      y: u * u * u * P[0].y + 3 * u * u * s * P[1].y + 3 * u * s * s * P[2].y + s * s * s * P[3].y,
    };
  };
  const pathEye = (c) => {
    g.beginPath();
    g.moveTo(c.inner.x, c.inner.y);
    g.bezierCurveTo(c.up[1].x, c.up[1].y, c.up[2].x, c.up[2].y, c.outer.x, c.outer.y);
    g.bezierCurveTo(c.lo[1].x, c.lo[1].y, c.lo[2].x, c.lo[2].y, c.inner.x, c.inner.y);
    g.closePath();
  };

  const INK = () => `hsl(${st.hue}, ${(st.sat * 25).toFixed(1)}%, 11%)`;

  function drawEye(side) {
    const m = st.m;
    const wink = st.winkSide === side && st.t < st.winkUntil ? 1 : 0;
    const hap = Math.max(sstep(0.3, 0.85, m.happy), wink), sq = sstep(0.25, 0.8, m.squeeze);
    const vis = (1 - hap) * (1 - sq);
    const o = clamp(st.lid * m.open * (1 - st.blink), 0, 1.3) * (1 - sq);
    const c = curves(side, o);

    if (st.reveal < 1) { // 먹선이 그어지듯 감은 눈이 나타남
      g.save();
      const x0 = c.inner.x, x1 = c.outer.x + side * E * 0.2;
      const xr = lerp(x0, x1, easeOut(st.reveal));
      g.beginPath();
      g.rect(Math.min(x0, xr) - E * 0.05, -E, Math.abs(xr - x0) + E * 0.05, E * 2);
      g.clip();
      drawLashes(side, c, 0);
      g.restore();
      return;
    }

    if (vis > 0.01) {
      g.save(); g.globalAlpha *= vis;
      if (o > 0.02) drawOpen(side, c, o);
      drawLashes(side, c, o);
      g.restore();
    }
    if (hap > 0.01) drawHappy(side, hap);
    if (sq > 0.01) drawSqueeze(side, sq);
    drawBrow(side, o);
  }

  function drawOpen(side, c, o) {
    const m = st.m;
    g.save();
    pathEye(c);
    g.fillStyle = '#fefefc'; g.fill();
    g.clip();

    // 홍채
    const ix = (st.gx - side * st.conv * 0.55) * 0.2 * E, iy = st.gy * 0.13 * E + 0.03 * E;
    const rx = 0.245 * E, ry = 0.305 * E;
    const h = st.hue, s = st.sat * 100, l = st.lit * 100;
    const col = (dl, ds = 0, a = 1) => `hsla(${h}, ${clamp(s + ds, 0, 100)}%, ${clamp(l + dl, 3, 97)}%, ${a})`;
    const gr = g.createLinearGradient(0, iy - ry, 0, iy + ry);
    gr.addColorStop(0, col(-24, -4)); gr.addColorStop(0.42, col(-6)); gr.addColorStop(0.8, col(18, 6)); gr.addColorStop(1, col(30, 10));
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(ix, iy, rx, ry, 0, 0, TAU); g.fill();
    const rg = g.createRadialGradient(ix, iy + ry * 0.2, ry * 0.2, ix, iy, ry);
    rg.addColorStop(0, col(0, 0, 0)); rg.addColorStop(0.8, col(0, 0, 0)); rg.addColorStop(1, col(-30, -5, 0.6));
    g.fillStyle = rg;
    g.beginPath(); g.ellipse(ix, iy, rx, ry, 0, 0, TAU); g.fill();

    // 홍채 결 (은은하게)
    g.strokeStyle = col(22, 5, 0.13); g.lineWidth = E * 0.005;
    g.beginPath();
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * TAU + 0.1;
      const ca = Math.cos(a), sa = Math.sin(a), r0 = 0.42 + (k % 3) * 0.05;
      g.moveTo(ix + ca * rx * r0, iy + sa * ry * r0);
      g.lineTo(ix + ca * rx * 0.92, iy + sa * ry * 0.92);
    }
    g.stroke();
    // 아래쪽 빛 고임 (애니 눈의 상징)
    const lg = g.createRadialGradient(ix, iy + ry * 0.62, 0, ix, iy + ry * 0.62, rx * 0.9);
    lg.addColorStop(0, col(42, 12, 0.75)); lg.addColorStop(1, col(42, 12, 0));
    g.fillStyle = lg;
    g.beginPath(); g.ellipse(ix, iy + ry * 0.55, rx * 0.8, ry * 0.42, 0, 0, TAU); g.fill();
    // 테두리
    g.strokeStyle = col(-30, -5, 0.9); g.lineWidth = E * 0.013;
    g.beginPath(); g.ellipse(ix, iy, rx, ry, 0, 0, TAU); g.stroke();

    // 동공
    const pr = m.pupil * (1 + st.interest * 0.22) * (0.97 + 0.03 * Math.sin(st.t * 1.7));
    g.fillStyle = `hsl(${h}, ${clamp(s * 0.5, 0, 100)}%, 7%)`;
    g.beginPath(); g.ellipse(ix, iy + ry * 0.04, 0.1 * E * pr, 0.135 * E * pr, 0, 0, TAU); g.fill();

    // 위 눈꺼풀 그늘
    const top = c.upY * 0.75;
    const sg = g.createLinearGradient(0, top, 0, top + E * 0.32);
    sg.addColorStop(0, 'rgba(38,36,62,0.42)'); sg.addColorStop(1, 'rgba(38,36,62,0)');
    g.fillStyle = sg; g.fillRect(-E, top - E * 0.1, E * 2, E * 0.5);

    // 하이라이트 (시선보다 덜 움직임 = 각막 반사 느낌)
    const hx = ix * 0.82, hy = iy * 0.82;
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.beginPath(); g.ellipse(hx - 0.085 * E, hy - 0.115 * E, 0.072 * E, 0.094 * E, -0.5, 0, TAU); g.fill();
    g.beginPath(); g.arc(hx + 0.095 * E, hy + 0.105 * E, 0.03 * E, 0, TAU); g.fill();
    if (st.sparkle > 0.02) {
      const sp = st.sparkle, tw = 0.75 + 0.25 * Math.sin(st.t * 6 + side);
      g.globalAlpha *= sp;
      star(hx + 0.03 * E, hy - 0.2 * E, 0.07 * E * tw);
      g.beginPath(); g.arc(hx - 0.14 * E, hy + 0.04 * E, 0.016 * E, 0, TAU); g.fill();
      g.beginPath(); g.arc(hx + 0.05 * E, hy + 0.2 * E, 0.012 * E, 0, TAU); g.fill();
    }
    g.restore();
  }

  function star(x, y, r) {
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU - Math.PI / 2, rr = k % 2 ? r * 0.22 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }

  // 굵은 위 속눈썹 라인 + 바깥쪽 날개, 얇은 아래 라인
  function drawLashes(side, c, o) {
    const N = 26, pts = [];
    for (let i = 0; i <= N; i++) pts.push(bez(c.up, i / N));
    const wo = 0.85 + 0.15 * clamp(o, 0, 1);
    g.fillStyle = INK();
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const s = i / N, p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)];
      let nx = b.y - a.y, ny = -(b.x - a.x);
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      if (ny > 0) { nx = -nx; ny = -ny; }
      const th = E * (0.016 + 0.052 * sstep(0.12, 0.95, s)) * wo;
      const q = { x: p.x + nx * th, y: p.y + ny * th };
      i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y);
    }
    // 날개
    const end = pts[N];
    const op = sstep(0.12, 0.6, o);
    g.lineTo(end.x + side * E * (0.05 + 0.08 * op), end.y - E * (0.02 + 0.08 * op));
    g.lineTo(end.x + side * E * 0.02, end.y + E * 0.012);
    for (let i = N; i >= 0; i--) g.lineTo(pts[i].x, pts[i].y + E * 0.004);
    g.closePath(); g.fill();
    // 바깥 속눈썹 두 가닥
    for (const [s, len0, ang] of [[0.78, 0.13, -1.1], [0.9, 0.12, -0.6]]) {
      const len = len0 * op;
      if (len < 0.01) continue;
      const p = bez(c.up, s);
      const dx = Math.cos(ang) * side, dy = Math.sin(ang);
      g.beginPath();
      g.moveTo(p.x - E * 0.02, p.y - E * 0.01);
      g.quadraticCurveTo(p.x + dx * len * E * 0.5, p.y + dy * len * E * 0.7, p.x + dx * len * E, p.y + dy * len * E * 0.9);
      g.lineTo(p.x + E * 0.025 * side, p.y - E * 0.005);
      g.closePath(); g.fill();
    }
    if (o > 0.05) {
      // 아래 라인 (바깥쪽 절반만, 옅게)
      g.strokeStyle = INK(); g.lineCap = 'round';
      g.globalAlpha *= 0.16; g.lineWidth = E * 0.008;
      g.beginPath();
      for (let i = 0; i <= 20; i++) { const p = bez(c.lo, i / 20); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }
      g.stroke();
      g.globalAlpha *= 0.55 / 0.16; g.lineWidth = E * 0.013;
      g.beginPath();
      for (let i = 0; i <= 12; i++) { const p = bez(c.lo, 0.05 + (i / 12) * 0.5); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }
      g.stroke();
      // 눈 앞머리
      g.beginPath();
      g.moveTo(c.inner.x + side * E * 0.01, c.inner.y - E * 0.06);
      g.quadraticCurveTo(c.inner.x - side * E * 0.03, c.inner.y, c.inner.x + side * E * 0.03, c.inner.y + E * 0.05);
      g.stroke();
      g.globalAlpha /= 0.55;
    }
  }

  function drawHappy(side, k) {
    g.save();
    g.globalAlpha *= k;
    g.strokeStyle = INK(); g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = E * 0.062;
    g.beginPath();
    g.moveTo(-side * E * 0.4, E * 0.1);
    g.bezierCurveTo(-side * E * 0.22, -E * 0.26, side * E * 0.2, -E * 0.27, side * E * 0.42, E * 0.04);
    g.stroke();
    g.lineWidth = E * 0.03;
    g.beginPath(); g.moveTo(side * E * 0.4, E * 0.02); g.lineTo(side * E * 0.52, -E * 0.06); g.stroke();
    g.restore();
  }

  function drawSqueeze(side, k) {
    g.save();
    g.globalAlpha *= k;
    g.strokeStyle = INK(); g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = E * 0.06;
    const w = 0.34 * E * (0.7 + 0.3 * k);
    g.beginPath();
    g.moveTo(side * w, -E * 0.2); g.lineTo(-side * E * 0.22, 0); g.lineTo(side * w, E * 0.2);
    g.stroke();
    g.restore();
  }

  function drawBrow(side, o) {
    const m = st.m;
    const vis = st.reveal >= 1 ? 0.8 : 0;
    if (vis <= 0) return;
    const lift = m.brow + (side > 0 ? m.asym : -m.asym) * 0.35;
    const y = -E * (0.72 + lift * 0.2) - E * 0.06 * clamp(o - 1, 0, 0.3);
    g.save();
    g.globalAlpha *= vis;
    g.translate(side * E * 0.04, y);
    g.rotate(side * m.inner * 0.42 + side * -0.06);
    g.strokeStyle = INK(); g.lineCap = 'round';
    const L = E * 0.21;
    // 가운데가 굵은 붓 터치
    for (const [w, a] of [[E * 0.03, 1], [E * 0.05, 0.6]]) {
      g.lineWidth = w; g.globalAlpha *= a;
      g.beginPath(); g.moveTo(-L, E * 0.02); g.quadraticCurveTo(0, -E * 0.05, L, E * 0.01); g.stroke();
    }
    g.restore();
  }

  function drawBlush() {
    const b = st.m.blush;
    if (b < 0.02) return;
    for (const side of [-1, 1]) {
      const x = side * E * 1.12, y = E * 0.52;
      const gr = g.createRadialGradient(x, y, 0, x, y, E * 0.36);
      gr.addColorStop(0, `rgba(255,128,150,${0.32 * b})`); gr.addColorStop(1, 'rgba(255,128,150,0)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(x, y, E * 0.38, E * 0.2, 0, 0, TAU); g.fill();
      g.strokeStyle = `rgba(232,104,128,${0.55 * b})`; g.lineWidth = E * 0.014; g.lineCap = 'round';
      g.beginPath();
      for (let k = -1; k <= 1; k++) { g.moveTo(x + k * E * 0.1 - E * 0.03, y + E * 0.05); g.lineTo(x + k * E * 0.1 + E * 0.03, y - E * 0.05); }
      g.stroke();
    }
  }

  /* ───────────────────── 글씨 (말풍선 없이 잉크로) ───────────────────── */
  const texts = []; // {kind, text, t0, times[], shown, holdUntil, fadeT, res}
  const FONT = {
    say: () => `700 ${clamp(E * 0.34, 26, 62).toFixed(0)}px "Gaegu", "Malgun Gothic", sans-serif`,
    hint: () => `400 ${clamp(E * 0.13, 13, 18).toFixed(0)}px "Gowun Batang", serif`,
    title: () => `400 ${clamp(E * 0.26, 22, 40).toFixed(0)}px "Gowun Batang", serif`,
    sub: () => `400 ${clamp(E * 0.12, 12, 17).toFixed(0)}px "Gowun Batang", serif`,
    you: () => `400 ${clamp(E * 0.15, 15, 22).toFixed(0)}px "Gowun Batang", serif`,
  };

  function say(text, { speed = 1, hold, keep = false } = {}) {
    // 앞 대사가 아직 보이면 위로 빠지며 사라질 시간을 준 뒤 시작 (겹침 방지)
    let delay = 0;
    for (const x of texts) {
      if (x.kind !== 'say') continue;
      if (!x.fadeT) endText(x);
      delay = Math.max(delay, 0.45 - (st.t - x.fadeT));
    }
    const times = [];
    let tt = 0.05;
    for (const ch of text) {
      times.push(tt);
      tt += ch === '…' ? 0.42 : ch === '.' ? 0.22 : /[?!]/.test(ch) ? 0.2 : ch === ',' ? 0.18 : ch === ' ' ? 0.05 : 0.075;
    }
    const T = { kind: 'say', text, chars: [...text], t0: st.t + delay, times: times.map((x) => x / speed), shown: 0, res: null };
    T.typeEnd = T.t0 + tt / speed;
    T.holdUntil = keep ? Infinity : T.typeEnd + (hold ?? 1.3 + text.length * 0.07);
    T.keep = keep; // keep: 다 쓰면 바로 다음으로 넘어가되, 글씨는 다음 대사가 올 때까지 남김
    texts.push(T);
    return new Promise((res) => { T.res = res; });
  }
  function caption(kind, text, { hold = Infinity, y } = {}) {
    for (const x of texts) if (x.kind === kind && !x.fadeT) endText(x);
    const T = { kind, text, chars: [...text], t0: st.t, times: null, shown: text.length, typeEnd: st.t, holdUntil: st.t + hold, y };
    texts.push(T);
    return T;
  }
  function endText(T) { if (!T.fadeT) T.fadeT = st.t; T.res?.(); T.res = null; }
  function clearKind(kind) { for (const x of texts) if (x.kind === kind) endText(x); }

  function updateTexts() {
    for (let i = texts.length - 1; i >= 0; i--) {
      const T = texts[i];
      if (T.times) {
        while (T.shown < T.chars.length && st.t - T.t0 >= T.times[T.shown]) {
          hooks.onChar?.(T.chars[T.shown], T.shown, T.chars.length, T.text);
          T.shown++;
        }
      }
      if (T.keep && T.res && st.t > T.typeEnd + 0.3) { T.res(); T.res = null; }
      if (!T.fadeT && st.t > T.holdUntil) endText(T);
      if (T.fadeT && st.t - T.fadeT > 1.2) texts.splice(i, 1);
    }
  }

  function drawTexts() {
    for (const T of texts) {
      const fade = T.fadeT ? 1 - sstep(0, T.kind === 'say' ? 0.7 : 1.1, st.t - T.fadeT) : 1;
      const born = T.kind === 'say' ? 1 : sstep(0, 1.2, st.t - T.t0);
      const A = fade * born;
      if (A <= 0.003) continue;
      g.save();
      g.font = FONT[T.kind]();
      g.textBaseline = 'middle';
      let y, color;
      if (T.kind === 'say') { const p = facePose(); y = p.y + E * 1.32; color = INK(); }
      else if (T.kind === 'hint') { y = T.y ?? H * 0.87; color = 'rgba(70,70,82,0.62)'; g.letterSpacing = '0.18em'; }
      else if (T.kind === 'title') { y = T.y ?? H * 0.8; color = 'rgba(40,40,52,0.82)'; g.letterSpacing = '0.3em'; }
      else if (T.kind === 'you') { // 내가 적은 말 — 떠올랐다가 물속으로 가라앉음
        y = H * 0.79 + (T.fadeT ? (st.t - T.fadeT) * E * 0.5 : 0); color = 'rgba(52,64,104,0.78)'; g.letterSpacing = '0.06em';
      }
      else { y = T.y ?? H * 0.85; color = 'rgba(70,70,82,0.6)'; g.letterSpacing = '0.2em'; }
      if (T.fadeT) { g.filter = `blur(${((1 - fade) * 4).toFixed(2)}px)`; if (T.kind !== 'you') y -= (1 - fade) * E * (T.kind === 'say' ? 0.38 : 0.12); }
      g.fillStyle = color;
      const widths = T.chars.map((ch) => g.measureText(ch).width);
      const total = g.measureText(T.text).width;
      let x = W / 2 - total / 2;
      for (let i = 0; i < T.chars.length; i++) {
        if (i >= T.shown) break;
        let a = A;
        let dy = 0;
        if (T.times) {
          const k = sstep(0, 0.22, st.t - T.t0 - T.times[i]);
          a *= k; dy = (1 - k) * E * 0.08;
        }
        g.globalAlpha = a;
        g.fillText(T.chars[i], x, y + dy);
        if (T.kind === 'say') { g.lineWidth = E * 0.0055; g.strokeStyle = color; g.strokeText(T.chars[i], x, y + dy); }
        x += widths[i] + (T.kind === 'say' ? 0 : parseFloat(g.letterSpacing) || 0);
      }
      g.restore();
    }
  }

  /* ───────────────────── 조작 API (director가 사용) ───────────────────── */
  function blink(double = false) {
    if (st.blinkT >= 0) return;
    st.blinkT = 0; st.blinkQueue = double ? 1 : 0;
    hooks.onBlink?.();
  }
  const api = {
    st, resize, update, draw, say, caption, clearKind, blink,
    get E() { return E; },
    get center() { return facePose(); },
    eyes() {
      const p = facePose(), c = Math.cos(st.tilt), s = Math.sin(st.tilt);
      return [-1, 1].map((side) => ({ x: p.x + c * side * E * 0.98, y: p.y + s * side * E * 0.98 }));
    },
    near(x, y, k = 1.9) { const p = facePose(); return Math.hypot((x - p.x) / 1.6, y - p.y) < E * k; },
    show(rate = 1.5) { st.tPresence = 1; st.presenceRate = rate; },
    hide(rate = 1.5) { st.tPresence = 0; st.presenceRate = rate; },
    reveal(dur) { st.tReveal = 1; st.revealRate = 1 / dur; },
    unreveal() { st.reveal = st.tReveal = 0; },
    open(v = 1, rate = 4) { st.tLid = v; st.lidRate = rate; st.alive = v > 0.2; },
    mood(name, dur) {
      if (!MOODS[name]) return;
      if (dur) { st.mood = name; st.moodUntil = st.t + dur; } else { st.base = name; st.mood = name; st.moodUntil = 0; }
    },
    look(mode, pt) { st.attn = mode; st.lookPt = pt || null; st.wanderT = 0; },
    glance(pt, dur = 0.9) { st.glance = pt; st.glanceUntil = st.t + dur; },
    tiltTo(a) { st.tTilt = a; },
    bounce(a = 1) { st.bounceT = st.t; st.bounceAmp = a; },
    identity(h, s, l = 0.4) { st.tHue = h; st.tSat = s; st.tLit = l; },
    sparkle(v) { st.tSparkle = v; },
    wink(side = 1, dur = 0.7) { st.winkSide = side; st.winkUntil = st.t + dur; },
    get conv() { return st.conv; },
    reset() {
      Object.assign(st, {
        presence: 0, tPresence: 0, reveal: 0, tReveal: 0, lid: 0, tLid: 0, alive: false, blink: 0, blinkT: -1,
        mood: 'neutral', base: 'neutral', attn: 'auto', tTilt: 0, tilt: 0, sparkle: 0, tSparkle: 0, winkUntil: 0,
        hue: 225, tHue: 225, sat: 0.06, tSat: 0.06, lit: 0.34, tLit: 0.34,
      });
      texts.length = 0;
    },
  };
  return api;
}
