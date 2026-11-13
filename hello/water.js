// water.js — 흰 종이 같은 수면
//  파동 방정식(높이장 ping-pong)은 sirxemic/jquery.ripples(MIT)의 drop/update 셰이더 구조를 three.js로 옮긴 것.
//  그 위에: 종이 결, 잉크 레이어(눈·글씨) 굴절 + 색 분산, 물결 음영/하이라이트, 손끝 그림자, 잉크 구름, 비네트, 필름 그레인.
import * as THREE from 'three';

const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MAX_DROPS = 16;
const DROP_FS = /* glsl */`
  // 물방울 여러 개를 한 번의 패스로 (예전엔 물방울마다 전체 화면 패스 1번)
  uniform sampler2D tex; uniform float aspect; uniform int count;
  uniform vec4 drops[${MAX_DROPS}];   // xy 중심(uv), z 반경, w 세기
  varying vec2 vUv;
  void main(){
    vec4 info = texture2D(tex, vUv);
    for (int i = 0; i < ${MAX_DROPS}; i++) {
      if (i >= count) break;
      vec4 dr = drops[i];
      vec2 d = (vUv - dr.xy) * vec2(aspect, 1.0);
      float k = max(0.0, 1.0 - length(d) / dr.z);
      info.r += (0.5 - cos(k * 3.14159265) * 0.5) * dr.w;
    }
    gl_FragColor = info;
  }`;

// 종이 결 — 화면 크기가 바뀔 때만 한 번 그려 두고 재사용 (예전엔 매 픽셀 매 프레임 노이즈 10옥타브)
const PAPER_FS = /* glsl */`
  uniform float uAspect;
  varying vec2 vUv;
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main(){
    vec2 q = vUv * vec2(uAspect, 1.0);
    gl_FragColor = vec4(fbm(q * 210.0), fbm(q * 2.6 + 3.0), 0.0, 1.0);
  }`;

const UPDATE_FS = /* glsl */`
  uniform sampler2D tex; uniform vec2 delta; uniform float damping;
  varying vec2 vUv;
  void main(){
    vec4 info = texture2D(tex, vUv);
    vec2 dx = vec2(delta.x, 0.0), dy = vec2(0.0, delta.y);
    float avg = (texture2D(tex, vUv - dx).r + texture2D(tex, vUv - dy).r +
                 texture2D(tex, vUv + dx).r + texture2D(tex, vUv + dy).r) * 0.25;
    info.g += (avg - info.r) * 2.0;
    info.g *= damping;
    info.r += info.g;
    info.r *= 0.9995;
    gl_FragColor = info;
  }`;

const COMP_FS = /* glsl */`
  uniform sampler2D uWave, uInk, uPaperTex;
  uniform vec2 uDelta; uniform float uAspect, uTime, uRefract, uFade;
  uniform vec4 uTip[2];
  uniform vec3 uPaper, uInkTint;
  uniform vec4 uCloud;            // xy 중심(uv), z 반경, w 농도
  varying vec2 vUv;

  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

  void main(){
    float h  = texture2D(uWave, vUv).r;
    float hx = texture2D(uWave, vUv + vec2(uDelta.x, 0.0)).r;
    float hy = texture2D(uWave, vUv + vec2(0.0, uDelta.y)).r;
    vec3 dx = vec3(uDelta.x, hx - h, 0.0);
    vec3 dy = vec3(0.0, hy - h, uDelta.y);
    vec3 n = normalize(cross(dy, dx));
    vec2 off = -n.xz;
    vec2 o = off * uRefract;

    // 잉크(눈·글씨) — 굴절 + 약한 색 분산
    vec4 iR = texture2D(uInk, vUv + o * 1.10);
    vec4 iG = texture2D(uInk, vUv + o);
    vec4 iB = texture2D(uInk, vUv + o * 0.90);
    float a = iG.a;
    vec3 inkc = vec3(iR.r, iG.g, iB.b);

    // 종이
    float fib = texture2D(uPaperTex, vUv + o * 0.5).r;
    float blot = texture2D(uPaperTex, vUv).g;
    vec3 paper = uPaper * (0.986 + 0.018 * fib) * (0.993 + 0.012 * blot);

    // 잉크 구름 (깨어날 때 물속에 번지는 먹) — 도메인 워프로 먹물 가닥
    float cloud = 0.0;
    if (uCloud.w > 0.001) {
      vec2 cd = (vUv + o * 0.7 - uCloud.xy) * vec2(uAspect, 1.0);
      vec2 qd = cd / max(uCloud.z, 0.01) * 1.6;
      float tt = uTime * 0.06;
      vec2 w1 = vec2(fbm(qd + vec2(0.0, tt)), fbm(qd + vec2(5.2, 1.3 - tt)));
      vec2 w2 = vec2(fbm(qd + 3.0 * w1 + vec2(1.7, 9.2)), fbm(qd + 3.0 * w1 + vec2(8.3, 2.8) + tt));
      float f = fbm(qd + 3.2 * w2);
      float r = length(cd) / max(uCloud.z, 0.01);
      float fall = 1.0 - smoothstep(0.1, 1.0, r + (f - 0.5) * 0.55);
      float dens = fall * (0.5 + 0.5 * smoothstep(0.3, 0.7, f)) + fall * smoothstep(0.55, 0.75, f) * 0.35;
      cloud = dens * uCloud.w;
    }
    paper = mix(paper, uInkTint, clamp(cloud, 0.0, 1.0) * 0.62);

    vec3 col = paper * (1.0 - a) + inkc;

    // 물결 음영: 빛을 향한 면은 밝게, 반대 면은 차가운 그늘
    vec2 L = normalize(vec2(-0.55, 0.85));
    float d1 = dot(off, L);
    float slope = length(off);
    col += pow(max(d1, 0.0), 2.0) * 0.6;
    col -= vec3(0.25, 0.20, 0.12) * pow(max(-d1, 0.0), 1.35) * 1.15;
    col -= vec3(0.03, 0.025, 0.012) * slope;

    // 손끝 그림자 — 수면 위에 떠 있는 손가락
    for (int i = 0; i < 2; i++){
      vec4 tp = uTip[i];
      if (tp.w > 0.0){
        float d = length((vUv - tp.xy) * vec2(uAspect, 1.0));
        float sh = 1.0 - smoothstep(0.0, tp.z, d);
        col *= 1.0 - sh * sh * tp.w * 0.2;
      }
    }

    float v = length((vUv - 0.5) * vec2(uAspect, 1.0));
    col *= mix(1.0, 0.9, smoothstep(0.45, 1.3, v));
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.13) * 91.7) - 0.5) * 0.016;
    col = mix(col, vec3(1.0), uFade);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

export function createWater(renderer, inkCanvas) {
  const SIM = 400;
  const rtOpts = {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false,
  };
  let A = null, B = null, sw = SIM, sh = SIM, aspect = 1, acc = 0;
  const tipPres = [0, 0];
  const drops = [];

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);

  const dropMat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: DROP_FS,
    uniforms: {
      tex: { value: null }, aspect: { value: 1 }, count: { value: 0 },
      drops: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4()) },
    },
  });
  const paperMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: PAPER_FS, uniforms: { uAspect: { value: 1 } } });
  let paperRT = null;
  const updMat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: UPDATE_FS,
    uniforms: { tex: { value: null }, delta: { value: new THREE.Vector2() }, damping: { value: 0.994 } },
  });
  const inkTex = new THREE.CanvasTexture(inkCanvas);
  inkTex.premultiplyAlpha = true;
  inkTex.colorSpace = THREE.NoColorSpace;
  inkTex.generateMipmaps = false;
  inkTex.minFilter = THREE.LinearFilter;
  const compMat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: COMP_FS,
    uniforms: {
      uWave: { value: null }, uInk: { value: inkTex }, uPaperTex: { value: null },
      uDelta: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uTime: { value: 0 },
      uRefract: { value: 0.045 }, uFade: { value: 0 },
      uTip: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uPaper: { value: new THREE.Vector3(0.968, 0.962, 0.948) },
      uInkTint: { value: new THREE.Vector3(0.16, 0.17, 0.26) },
      uCloud: { value: new THREE.Vector4(0.5, 0.5, 0.2, 0) },
    },
  });

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  }
  function swap() { const t = A; A = B; B = t; }

  function resize() {
    aspect = innerWidth / innerHeight;
    sh = SIM; sw = Math.round(SIM * aspect);
    A?.dispose(); B?.dispose();
    A = new THREE.WebGLRenderTarget(sw, sh, rtOpts);
    B = new THREE.WebGLRenderTarget(sw, sh, rtOpts);
    clear();
    const d = new THREE.Vector2(1 / sw, 1 / sh);
    updMat.uniforms.delta.value.copy(d);
    compMat.uniforms.uDelta.value.copy(d);
    compMat.uniforms.uAspect.value = aspect;
    dropMat.uniforms.aspect.value = aspect;
    // 셰이더 예열: 첫 톡 순간에 컴파일하느라 멈추지 않도록 미리 한 번씩 돌려 둠 (물방울 0개라 결과는 그대로)
    dropMat.uniforms.count.value = 0; dropMat.uniforms.tex.value = A.texture; pass(dropMat, B);
    updMat.uniforms.tex.value = A.texture; pass(updMat, B);
    clear();
    resizePaper();
  }
  // 종이 결 텍스처 (화면 해상도) — 해상도만 바뀔 때는 이것만 다시 (물결은 유지)
  function resizePaper() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    paperRT?.dispose();
    paperRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    paperMat.uniforms.uAspect.value = aspect;
    pass(paperMat, paperRT);
    renderer.setRenderTarget(null);
    compMat.uniforms.uPaperTex.value = paperRT.texture;
  }
  function clear() {
    const prev = renderer.getClearColor(new THREE.Color()), pa = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const rt of [A, B]) { renderer.setRenderTarget(rt); renderer.clear(); }
    renderer.setClearColor(prev, pa);
    renderer.setRenderTarget(null);
  }

  // x, y: 화면 px / r: 반경(px) / s: 세기
  function drop(x, y, r = 26, s = 0.05) {
    drops.push({ x: x / innerWidth, y: 1 - y / innerHeight, r: r / innerHeight, s });
  }

  function step(dt) {
    const STEP = 1 / 100, MAX_STEPS = 4;
    acc += dt;
    let n = 0;
    if (drops.length) {
      // 한 프레임에 쌓인 물방울은 최대 16개까지 한 번에 (넘치면 가장 최근 것 위주)
      const batch = drops.splice(0, drops.length).slice(-MAX_DROPS);
      const u = dropMat.uniforms;
      batch.forEach((d, i) => u.drops.value[i].set(d.x, d.y, d.r, d.s));
      u.count.value = batch.length;
      u.tex.value = A.texture;
      pass(dropMat, B); swap();
    }
    while (acc >= STEP && n < MAX_STEPS) {
      updMat.uniforms.tex.value = A.texture;
      pass(updMat, B); swap();
      acc -= STEP; n++;
    }
    if (acc > STEP) acc = 0; // 밀린 시간은 버림 (물결이 아주 살짝 느려질 뿐, 화면은 매끄럽게)
  }

  let inkW = 0, inkH = 0;
  function render(t, tips) {
    // 잉크 캔버스 크기가 바뀌면 GPU 텍스처를 새로 만든다.
    // (WebGL2에서 three.js는 텍스처 크기를 처음 크기로 고정해 두어, 작아진 그림이 구석에만 그려져 아이가 점점 작아졌다)
    if (inkCanvas.width !== inkW || inkCanvas.height !== inkH) { inkTex.dispose(); inkW = inkCanvas.width; inkH = inkCanvas.height; }
    inkTex.needsUpdate = true;
    const u = compMat.uniforms;
    u.uWave.value = A.texture;
    u.uTime.value = t;
    for (let i = 0; i < 2; i++) {
      const tp = tips[i], v = u.uTip.value[i];
      if (!tp) { tipPres[i] = Math.max(0, tipPres[i] - 0.05); v.w = tipPres[i] * 0.6; continue; }
      const k = tp.hover, dw = tp.dwell || 0;
      if (tipPres[i] === 0) { v.x = tp.x / innerWidth; v.y = 1 - tp.y / innerHeight; }
      tipPres[i] = Math.min(1, tipPres[i] + 0.06);
      v.x += (tp.x / innerWidth - v.x) * 0.6;
      v.y += (1 - tp.y / innerHeight - v.y) * 0.6;
      v.z = (0.03 + k * 0.08) * (1 - dw * 0.55);
      v.w = tipPres[i] * (0.45 + (1 - k) * 0.4 + dw * 0.6);
    }
    renderer.setRenderTarget(null);
    pass(compMat, null);
  }

  const uni = compMat.uniforms;
  return {
    resize, resizePaper, step, render, drop, clear,
    set damping(v) { updMat.uniforms.damping.value = v; },
    get damping() { return updMat.uniforms.damping.value; },
    cloud: uni.uCloud.value, // x, y(uv), z 반경, w 농도 — director가 트윈
    get fade() { return uni.uFade.value; }, set fade(v) { uni.uFade.value = v; },
    setInkTint(r, g, b) { uni.uInkTint.value.set(r, g, b); },
    setPaper(r, g, b) { uni.uPaper.value.set(r, g, b); },
  };
}
