// vfx.js — 웹캠 영상 위에 그리는 2D 합성 레이어 (TouchDesigner의 Composite TOP 역할)
//  04 BOX : 두 손 엄지·검지가 모서리가 되는 3D 상자. 상자 앞면 안쪽만 MOSAIC / DITHER / THERMAL / ASCII 필터
//  05 ORB : 엄지-검지 컨트롤 라인 + "Spin" / "Particles" 수치 라벨 (파티클 자체는 main.js의 three.js)
//  06 HUD : 손을 따라다니는 방사형 오디오 비주얼라이저 (bars · ticks · rings · labels)
import { createAudio } from './audio.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const FILTERS = ['mosaic', 'dither', 'thermal', 'ascii'];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const ASCII = ' .:-=+*#%@';
const RING_COLS = ['#ffffff', '#f4a8dc', '#ffd84a', '#3b7bff', '#b58cff', '#7fe0c4'];
const THERMAL = (() => {
  const st = [[0, 4, 6, 24], [0.22, 60, 10, 120], [0.45, 200, 30, 110], [0.68, 255, 120, 30], [0.86, 255, 220, 80], [1, 255, 255, 230]];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < st.length - 2 && v > st[k + 1][0]) k++;
    const a = st[k], b = st[k + 1], f = (v - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
  }
  return lut;
})();

/**
 * E: main.js 와 공유하는 상태
 *  { S, G, handList, vid, mouse, mouseActive(), camOK(), pal() }
 */
export function initVfx(E) {
  const cv = document.getElementById('vfx');
  const g = cv.getContext('2d');
  const pc = document.createElement('canvas'); // 저해상도 픽셀 버퍼 (1px = 화면 cell px)
  const pg = pc.getContext('2d', { willReadFrequently: true });
  const audio = createAudio();
  const spec = new Float32Array(64);
  let W = innerWidth, H = innerHeight, dirty = true;

  function resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  const toS = (p) => ({ x: p.x + W / 2, y: H / 2 - p.y });
  const add = (p, v, k = 1) => ({ x: p.x + v.x * k, y: p.y + v.y * k });
  const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); };
  const live = () => E.handList().filter((h) => h.present && h.init);

  function hint(text) {
    g.font = '13px ui-monospace, Consolas, "Malgun Gothic", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillText(text, W / 2, H * 0.82);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }

  /* ─────────────────────────── 04 BOX ─────────────────────────── */
  const BOX = { filter: 'mosaic', cell: 20, info: '' };
  const sparks = Array.from({ length: 520 }, () => ({
    u: Math.random(),
    w: Math.random() < 0.62 ? Math.random() ** 4 : 1 - Math.random() ** 3,
    f: 0.5 + Math.random() * 3, ph: Math.random() * TAU, s: Math.random() < 0.85 ? 1 : 2,
  }));

  // 상자 앞면 4점(화면 좌표): [왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래] + 축 정보
  function boxQuad() {
    const hs = live();
    if (hs.length >= 2) {
      const [L, R] = hs[0].palm.x < hs[1].palm.x ? hs : [hs[1], hs[0]];
      const eL = [toS(L.lm[8]), toS(L.lm[4])], eR = [toS(R.lm[8]), toS(R.lm[4])];
      const mL = { x: (eL[0].x + eL[1].x) / 2, y: (eL[0].y + eL[1].y) / 2 };
      const mR = { x: (eR[0].x + eR[1].x) / 2, y: (eR[0].y + eR[1].y) / 2 };
      let ux = mR.x - mL.x, uy = mR.y - mL.y;
      const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const n = { x: uy, y: -ux }; // 화면에서 '위쪽' 법선
      const top = (e) => ((e[0].x - e[1].x) * n.x + (e[0].y - e[1].y) * n.y >= 0 ? e : [e[1], e[0]]);
      const [a0, a1] = top(eL), [b0, b1] = top(eR);
      const open = (Math.hypot(a0.x - a1.x, a0.y - a1.y) + Math.hypot(b0.x - b1.x, b0.y - b1.y)) / 2;
      return { q: [a0, b0, b1, a1], u: { x: ux, y: uy }, n, open, len: ul };
    }
    let a = null, b = null;
    if (hs.length === 1) { a = toS(hs[0].lm[8]); b = toS(hs[0].lm[4]); }
    else if (E.mouseActive() && E.mouse.down) { a = toS({ x: E.mouse.x0, y: E.mouse.y0 }); b = toS(E.mouse); }
    if (!a) return null;
    let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (x1 - x0 < 50) { const c = (x0 + x1) / 2; x0 = c - 25; x1 = c + 25; }
    if (y1 - y0 < 50) { const c = (y0 + y1) / 2; y0 = c - 25; y1 = c + 25; }
    return {
      q: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
      u: { x: 1, y: 0 }, n: { x: 0, y: -1 }, open: y1 - y0, len: x1 - x0,
    };
  }

  // 화면 전체를 cell 크기로 다운샘플한 거울 영상 → pc
  function renderPixels(cell, t) {
    const pw = Math.ceil(W / cell), ph = Math.ceil(H / cell);
    if (pc.width !== pw || pc.height !== ph) { pc.width = pw; pc.height = ph; }
    const v = E.vid;
    if (E.camOK() && v.readyState >= 2 && v.videoWidth) {
      const s = Math.max(W / v.videoWidth, H / v.videoHeight);
      const dw = (v.videoWidth * s) / cell, dh = (v.videoHeight * s) / cell;
      pg.setTransform(-1, 0, 0, 1, pw, 0);
      pg.drawImage(v, (pw - dw) / 2, (ph - dh) / 2, dw, dh);
      pg.setTransform(1, 0, 0, 1, 0, 0);
    } else { // 카메라 없을 때: 움직이는 그라디언트
      const gr = pg.createLinearGradient(0, 0, pw, ph);
      gr.addColorStop(0, `hsl(${(t * 40) % 360},60%,45%)`);
      gr.addColorStop(1, `hsl(${(t * 40 + 160) % 360},60%,20%)`);
      pg.fillStyle = gr; pg.fillRect(0, 0, pw, ph);
    }
    return { pw, ph };
  }

  function drawBoxMode(t) {
    const B = boxQuad();
    if (!B) { hint('두 손 엄지·검지로 상자 양 끝을 잡아보세요  ·  한 손이면 엄지-검지 사각형'); return; }
    const [p0, p1, p2, p3] = B.q;
    const f = BOX.filter;
    const cell = f === 'dither' ? 3 : f === 'ascii' ? 12 : f === 'thermal'
      ? Math.round(clamp(B.open * 0.08, 5, 18)) : Math.round(clamp(B.open * 0.2, 10, 46));
    BOX.cell = cell;

    // 깊이(위·뒤로 뻗는) 벡터 — 화면 중앙 쪽으로 살짝 기울여 원근감
    const dl = clamp(B.open * 0.55 + 18, 22, 170);
    const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
    const dv = { x: B.n.x * dl + ((W / 2 - cx) / W) * dl * 0.9, y: B.n.y * dl };
    const q0 = add(p0, dv), q1 = add(p1, dv), q2 = add(p2, dv), q3 = add(p3, dv);
    const rightEnd = dv.x * B.u.x + dv.y * B.u.y < 0;

    g.save();
    g.lineJoin = 'round';
    // 끝면
    poly(rightEnd ? [p1, p2, q2, q1] : [p0, p3, q3, q0]);
    g.fillStyle = 'rgba(14,14,16,0.92)'; g.fill();
    // 윗면 (검정 + 반짝이는 입자)
    poly([p0, p1, q1, q0]);
    g.fillStyle = '#000'; g.fill();
    g.save(); g.clip();
    g.fillStyle = '#fff';
    for (const s of sparks) {
      const u = s.u + Math.sin(t * 0.3 * s.f + s.ph) * 0.004;
      const w = clamp(s.w + Math.sin(t * s.f + s.ph) * 0.015, 0, 1);
      const x = p0.x + (p1.x - p0.x) * u + dv.x * w, y = p0.y + (p1.y - p0.y) * u + dv.y * w;
      g.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(t * s.f * 4 + s.ph));
      g.fillRect(x, y, s.s, s.s);
    }
    g.restore();

    // 앞면 — 필터 처리된 영상
    const { pw, ph } = renderPixels(cell, t);
    const xs = [p0.x, p1.x, p2.x, p3.x], ys = [p0.y, p1.y, p2.y, p3.y];
    const bx0 = clamp(Math.floor(Math.min(...xs) / cell) - 1, 0, pw), bx1 = clamp(Math.ceil(Math.max(...xs) / cell) + 1, 0, pw);
    const by0 = clamp(Math.floor(Math.min(...ys) / cell) - 1, 0, ph), by1 = clamp(Math.ceil(Math.max(...ys) / cell) + 1, 0, ph);
    const bw = bx1 - bx0, bh = by1 - by0;
    poly([p0, p1, p2, p3]);
    g.save(); g.clip();
    if (bw > 0 && bh > 0) {
      if (f === 'mosaic') {
        g.imageSmoothingEnabled = false;
        g.drawImage(pc, bx0, by0, bw, bh, bx0 * cell, by0 * cell, bw * cell, bh * cell);
      } else {
        const id = pg.getImageData(bx0, by0, bw, bh), d = id.data;
        if (f === 'ascii') {
          g.fillStyle = '#000'; g.fillRect(bx0 * cell, by0 * cell, bw * cell, bh * cell);
          g.fillStyle = E.pal().acc; g.font = `700 ${cell + 2}px ui-monospace, Consolas, monospace`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
              const o = (y * bw + x) * 4;
              const l = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255;
              const ch = ASCII[Math.min(9, (l * 10) | 0)];
              if (ch !== ' ') g.fillText(ch, (bx0 + x + 0.5) * cell, (by0 + y + 0.5) * cell);
            }
          }
          g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        } else {
          for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
              const o = (y * bw + x) * 4;
              const l = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255;
              if (f === 'dither') {
                const on = l > BAYER[((by0 + y) & 3) * 4 + ((bx0 + x) & 3)];
                d[o] = d[o + 1] = d[o + 2] = on ? 238 : 8;
              } else {
                const k = Math.min(255, (l * 255) | 0) * 3;
                d[o] = THERMAL[k]; d[o + 1] = THERMAL[k + 1]; d[o + 2] = THERMAL[k + 2];
              }
            }
          }
          pg.putImageData(id, bx0, by0);
          g.imageSmoothingEnabled = false;
          g.drawImage(pc, bx0, by0, bw, bh, bx0 * cell, by0 * cell, bw * cell, bh * cell);
        }
      }
    }
    g.restore();

    // 외곽선
    g.strokeStyle = '#fff'; g.lineWidth = 1.6;
    g.shadowColor = 'rgba(255,255,255,0.8)'; g.shadowBlur = 8;
    poly([p0, p1, p2, p3]); g.stroke();
    g.beginPath();
    g.moveTo(p0.x, p0.y); g.lineTo(q0.x, q0.y); g.lineTo(q1.x, q1.y); g.lineTo(p1.x, p1.y);
    if (rightEnd) { g.moveTo(q1.x, q1.y); g.lineTo(q2.x, q2.y); g.lineTo(p2.x, p2.y); }
    else { g.moveTo(q0.x, q0.y); g.lineTo(q3.x, q3.y); g.lineTo(p3.x, p3.y); }
    g.stroke();
    g.shadowBlur = 0;

    // 수치 라벨
    g.font = '10px ui-monospace, Consolas, monospace';
    g.fillStyle = E.pal().acc;
    const lx = Math.min(p2.x, p3.x), ly = Math.max(p2.y, p3.y) + 16;
    g.fillText(`box  len ${B.len | 0}  open ${B.open | 0}  cell ${cell}px  ${f.toUpperCase()}`, lx, ly);
    g.restore();
  }

  /* ─────────────────────────── 05 ORB ─────────────────────────── */
  function drawOrbMode() {
    const O = E.G.orb;
    if (!O || !O.ctrls.length) {
      hint(E.mouseActive() ? '마우스 x = Spin · y = Particles' : '왼손 엄지-검지 = Spin · 오른손 엄지-검지 = Particles');
      return;
    }
    for (const c of O.ctrls) {
      const a = toS(c.h.lm[4]), b = toS(c.h.lm[8]);
      g.save();
      g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5;
      g.shadowColor = 'rgba(255,255,255,0.7)'; g.shadowBlur = 14;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 6;
      g.font = '500 26px "Segoe UI", system-ui, sans-serif';
      g.fillStyle = '#fff';
      const label = `${c.name}: ${c.val.toFixed(2)}`;
      const top = a.y < b.y ? a : b;
      if (c.key === 'spin') { g.textAlign = 'right'; g.fillText(label, top.x - 14, top.y - 10); }
      else { g.textAlign = 'left'; g.fillText(label, Math.max(a.x, b.x) + 16, (a.y + b.y) / 2); }
      g.restore();
    }
  }

  /* ─────────────────────────── 06 HUD ─────────────────────────── */
  const layers = { bars: true, ticks: true, rings: true, labels: true };
  const barJit = Float32Array.from({ length: 121 }, () => 0.55 + Math.random() * 0.45);
  const rings = Array.from({ length: 6 }, (_, ri) => {
    const segs = [];
    let a = 0;
    while (a < TAU - 0.05) {
      const len = 0.15 + Math.random() * (ri < 2 ? 1.2 : 0.7);
      const gap = Math.random() < 0.35 ? 0.05 + Math.random() * 0.3 : 0.025;
      const a1 = Math.min(TAU - 0.02, a + len);
      segs.push({ a0: a, a1, c: RING_COLS[(Math.random() * RING_COLS.length) | 0], band: (Math.random() * 48) | 0 });
      a = a1 + gap;
    }
    return { segs, speed: (Math.random() - 0.5) * 1.6, dir: ri % 2 ? 1 : -1 };
  });

  function smooth(m, rot, vel, dist) {
    let dr = ((rot - m.rot + 540) % 360) - 180;
    m.rot += dr * 0.3; if (m.rot > 180) m.rot -= 360; if (m.rot < -180) m.rot += 360;
    m.vel += (vel - m.vel) * 0.25;
    m.dist += (dist - m.dist) * 0.3;
    return m;
  }
  function handMetrics(h) {
    const L = h.lm;
    const rot = (Math.atan2(L[9].x - L[0].x, L[9].y - L[0].y) * 180) / Math.PI; // 손가락이 위=0°, 오른쪽 기울임=+
    const vel = clamp(Math.hypot(h.vel.x, h.vel.y) / 28, 0, 1);
    const dist = clamp((h.pinchR - 0.15) / 1.0, 0, 1);
    return smooth(h.hud || (h.hud = { rot, vel, dist }), rot, vel, dist);
  }
  const mouseHud = { rot: 0, vel: 0, dist: 0.3 };

  function drawHud(cx, cy, R, m, t) {
    const rr = (m.rot * Math.PI) / 180;
    g.save();
    g.fillStyle = 'rgba(6,6,12,0.82)';
    g.beginPath(); g.arc(cx, cy, R * 0.97, 0, TAU); g.fill();

    if (layers.bars) {
      const nb = 120, inner = R * 0.99, pts = [];
      g.beginPath();
      for (let i = 0; i <= nb; i++) {
        const a = (i / nb) * TAU - Math.PI / 2 + rr * 0.25;
        const k = spec[Math.min(63, Math.round((Math.abs((i % nb) - nb / 2) / (nb / 2)) * 63))];
        const r = inner + R * (0.04 + k * 0.8 * barJit[i]) * (0.85 + 0.15 * Math.sin(t * 7 + i * 1.7));
        const c = Math.cos(a), s = Math.sin(a);
        pts.push([cx + c * inner, cy + s * inner, cx + c * r, cy + s * r]);
        i ? g.lineTo(cx + c * r, cy + s * r) : g.moveTo(cx + c * r, cy + s * r);
      }
      g.closePath();
      g.moveTo(cx + inner, cy); g.arc(cx, cy, inner, 0, TAU, true);
      g.fillStyle = 'rgba(190,140,255,0.32)'; g.fill('evenodd');
      g.strokeStyle = 'rgba(215,180,255,0.85)'; g.lineWidth = 1.5;
      g.beginPath();
      for (const p of pts) { g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); }
      g.stroke();
    }

    if (layers.rings) {
      const r0 = R * 0.16, r1 = R * 0.9, step = (r1 - r0) / rings.length;
      g.lineCap = 'butt';
      rings.forEach((ring, ri) => {
        const r = r0 + step * (ri + 0.5);
        const off = t * ring.speed * (0.4 + m.vel * 3) + rr * ring.dir * (0.4 + ri * 0.15);
        for (const s of ring.segs) {
          const e = spec[s.band];
          g.strokeStyle = s.c; g.globalAlpha = 0.5 + e * 0.5;
          g.lineWidth = step * (0.42 + e * 0.5);
          g.beginPath(); g.arc(cx, cy, r, s.a0 + off, s.a1 + off); g.stroke();
        }
      });
      g.globalAlpha = 1;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, R * 0.06, 0, TAU); g.fill();
      for (let k = 0; k < 5; k++) {
        const a = t * 2 + (k * TAU) / 5;
        g.fillStyle = RING_COLS[k + 1];
        g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.1, cy + Math.sin(a) * R * 0.1, R * 0.022, 0, TAU); g.fill();
      }
    }

    if (layers.ticks) {
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1;
      g.beginPath();
      for (let d = 0; d < 360; d += 5) {
        const a = (d * Math.PI) / 180 - rr, long = d % 30 === 0;
        const ra = R * 1.0, rb = R * (long ? 1.1 : 1.045);
        g.moveTo(cx + Math.cos(a) * ra, cy + Math.sin(a) * ra);
        g.lineTo(cx + Math.cos(a) * rb, cy + Math.sin(a) * rb);
      }
      g.stroke();
      g.lineWidth = 1.3;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU + rr * 0.6 + t * 0.15;
        const r = R * (1.32 + spec[(k * 4) % 64] * 0.35 + (k % 3) * 0.06);
        g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, k % 4 === 0 ? 5.5 : 3.5, 0, TAU);
        if (k % 5 === 0) { g.fillStyle = '#fff'; g.fill(); } else { g.strokeStyle = '#fff'; g.stroke(); }
      }
    }

    if (layers.labels) {
      const items = [['VELOCITY', m.vel.toFixed(2)], ['ROTATION', m.rot.toFixed(0)], ['DISTANCE', m.dist.toFixed(2)]];
      g.font = '12px ui-monospace, Consolas, monospace'; g.textBaseline = 'middle';
      const bw = 132, bh = 24, gap = Math.max(36, R * 0.42);
      const leftLimit = document.body.classList.contains('noui') ? 12 : 250; // 왼쪽 패널 피하기
      const side = cx - R * 1.6 - bw > leftLimit ? -1 : 1;
      items.forEach(([k, v], j) => {
        const by = cy + (j - 1) * gap - bh / 2;
        const bx = side < 0 ? cx - R * 1.6 - bw : cx + R * 1.6;
        const ang = side < 0 ? Math.PI + (j - 1) * 0.35 : -(j - 1) * 0.35;
        const ax = cx + Math.cos(ang) * R * 0.95, ay = cy + Math.sin(ang) * R * 0.95;
        g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(side < 0 ? bx + bw : bx, by + bh / 2); g.lineTo(ax, ay); g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(ax, ay, 2.2, 0, TAU); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(bx, by, bw, bh);
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.strokeRect(bx + 0.5, by + 0.5, bw, bh);
        g.fillStyle = '#fff'; g.fillText(`${k}: ${v}`, bx + 9, by + bh / 2 + 1);
      });
      g.textBaseline = 'alphabetic';
    }
    g.restore();
  }

  function drawHudMode(t) {
    const hs = live();
    const items = hs.map((h) => ({ c: toS(h.palm), R: clamp(h.px * 1.1, 60, 220), m: handMetrics(h) }));
    if (!items.length && E.mouseActive()) {
      const M = E.mouse;
      smooth(mouseHud, clamp(M.x / (W / 2), -1, 1) * 180, clamp(Math.hypot(M.vx, M.vy) / 30, 0, 1), M.down ? 1 : 0.3);
      items.push({ c: toS(M), R: 110, m: mouseHud });
    }
    const p = items[0];
    audio.update(p
      ? { on: true, pitch: (clamp(p.m.rot, -120, 120) + 120) / 240, cutoff: p.m.dist, vel: p.m.vel }
      : { on: false });
    audio.spectrum(spec, p ? 0.25 + p.m.vel * 0.75 + p.m.dist * 0.2 : 0.15, t);

    for (const it of items) drawHud(it.c.x, it.c.y, it.R * (0.75 + it.m.dist * 0.6), it.m, t);
    if (!items.length) {
      g.globalAlpha = 0.35;
      drawHud(W / 2, H / 2, Math.min(W, H) * 0.14, { rot: (t * 20) % 360 - 180, vel: 0.2, dist: 0.3 }, t);
      g.globalAlpha = 1;
      hint('손바닥을 카메라에 보여주세요 — 기울이면 ROTATION, 엄지-검지 벌리면 DISTANCE');
    }
    // 상단 캡션: 켜진 레이어
    const on = Object.keys(layers).filter((k) => layers[k]);
    g.font = '22px ui-monospace, Consolas, monospace'; g.fillStyle = '#fff'; g.textAlign = 'center';
    g.fillText(on.length ? on.join(', ') : 'no layers', W / 2, 52);
    g.font = '11px ui-monospace, Consolas, "Malgun Gothic", monospace'; g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillText(audio.label(), W / 2, 72);
    g.textAlign = 'left';
  }

  /* ─────────────────────────── 공통 ─────────────────────────── */
  function draw(t) {
    const mode = E.S.mode;
    const v = mode === 'box' || mode === 'orb' || mode === 'hud';
    if (mode !== 'hud') audio.silence();
    if (!v && !dirty) return;
    g.clearRect(0, 0, W, H);
    dirty = v;
    if (mode === 'box') drawBoxMode(t);
    else if (mode === 'orb') drawOrbMode();
    else if (mode === 'hud') drawHudMode(t);
  }

  function setFilter(f) { if (FILTERS.includes(f)) BOX.filter = f; }
  function cycleFilter() { setFilter(FILTERS[(FILTERS.indexOf(BOX.filter) + 1) % FILTERS.length]); }

  return { draw, resize, setFilter, cycleFilter, box: BOX, layers, audio };
}
