// audio.js — 06 HUD 모드용 소리
//  · SYNTH: 손으로 연주하는 테레민 신스 (손 기울기 = 음높이, 엄지-검지 간격 = 필터, 속도 = 비브라토)
//  · MIC  : 마이크 입력
//  둘 다 AnalyserNode를 거쳐 FFT 스펙트럼을 HUD 막대(bars)에 넘긴다. 아무것도 켜지 않으면 손 움직임으로 만든 가짜 스펙트럼.
//  (아이디어 참고: collidingScopes/arpeggiator — 손 제스처 → 신스 → 오디오 리액티브 비주얼)

const PENTA = [0, 3, 5, 7, 10]; // 마이너 펜타토닉 → 아무렇게나 움직여도 음악적으로 들림
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createAudio() {
  const A = { ctx: null, an: null, buf: null, synth: false, mic: false, err: '' };
  let nodes = null, micSrc = null, micStream = null;

  function ensure() {
    if (!A.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { A.err = 'WebAudio 미지원'; return null; }
      A.ctx = new AC();
      A.an = A.ctx.createAnalyser();
      A.an.fftSize = 256;
      A.an.smoothingTimeConstant = 0.72;
      A.buf = new Uint8Array(A.an.frequencyBinCount);
      // 손 dwell 클릭(el.click)은 브라우저가 "사용자 동작"으로 인정하지 않을 수 있음 → 실제 클릭/키 입력 때 재개
      const unlock = () => { if (A.ctx.state !== 'running') A.ctx.resume().catch(() => {}); };
      addEventListener('pointerdown', unlock, true);
      addEventListener('keydown', unlock, true);
    }
    if (A.ctx.state !== 'running') A.ctx.resume().catch(() => {});
    return A.ctx;
  }

  function buildSynth(ctx) {
    const out = ctx.createGain(); out.gain.value = 0;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 7; filt.frequency.value = 600;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), sub = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth'; o2.detune.value = 11; sub.type = 'triangle';
    const subG = ctx.createGain(); subG.gain.value = 0.5;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 5.5; lfoG.gain.value = 0;
    lfo.connect(lfoG); lfoG.connect(o1.detune); lfoG.connect(o2.detune);
    o1.connect(filt); o2.connect(filt); sub.connect(subG); subG.connect(filt);
    filt.connect(out);
    // 공간감: 피드백 딜레이
    const dl = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain();
    dl.delayTime.value = 0.32; fb.gain.value = 0.35; wet.gain.value = 0.3;
    out.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet);
    out.connect(ctx.destination); wet.connect(ctx.destination);
    out.connect(A.an); wet.connect(A.an);
    [o1, o2, sub, lfo].forEach((o) => o.start());
    return { out, filt, o1, o2, sub, lfoG };
  }

  A.toggleSynth = () => {
    const ctx = ensure(); if (!ctx) return;
    A.synth = !A.synth;
    if (A.synth && !nodes) nodes = buildSynth(ctx);
    if (!A.synth && nodes) nodes.out.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  };

  A.toggleMic = async () => {
    const ctx = ensure(); if (!ctx) return;
    if (A.mic) {
      micSrc?.disconnect(); micStream?.getTracks().forEach((t) => t.stop());
      micSrc = micStream = null; A.mic = false; return;
    }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      micSrc = ctx.createMediaStreamSource(micStream);
      micSrc.connect(A.an); // 스피커로는 보내지 않음(하울링 방지)
      A.mic = true; A.err = '';
    } catch (e) {
      console.warn(e); A.err = '마이크 권한 거부됨';
    }
  };

  // 매 프레임 손 수치로 신스 갱신
  A.update = ({ on, pitch, cutoff, vel }) => {
    if (!nodes || !A.ctx) return;
    const now = A.ctx.currentTime;
    nodes.out.gain.setTargetAtTime(A.synth && on ? 0.07 + vel * 0.06 : 0, now, 0.08);
    if (!A.synth || !on) return;
    const idx = Math.round(clamp(pitch, 0, 1) * 11);
    const f = 110 * 2 ** ((Math.floor(idx / 5) * 12 + PENTA[idx % 5]) / 12);
    nodes.o1.frequency.setTargetAtTime(f, now, 0.04);
    nodes.o2.frequency.setTargetAtTime(f, now, 0.04);
    nodes.sub.frequency.setTargetAtTime(f / 2, now, 0.04);
    nodes.filt.frequency.setTargetAtTime(180 + cutoff * cutoff * 5200, now, 0.05);
    nodes.lfoG.gain.setTargetAtTime(vel * 40, now, 0.1);
  };
  A.silence = () => { if (nodes && A.ctx) nodes.out.gain.setTargetAtTime(0, A.ctx.currentTime, 0.08); };

  A.live = () => !!(A.ctx && A.ctx.state === 'running' && (A.synth || A.mic));

  // out: Float32Array(64), 0..1 로 채움
  A.spectrum = (out, energy, t) => {
    const n = out.length;
    if (A.live()) {
      A.an.getByteFrequencyData(A.buf);
      for (let i = 0; i < n; i++) {
        const b = A.buf[Math.min(A.buf.length - 1, 1 + Math.floor(i * 1.5))] / 255;
        out[i] += (Math.min(1, b * 1.15) - out[i]) * 0.5;
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const base = 0.1 + energy * 0.6 * (1 - (i / n) * 0.6);
      const w = 0.5 + 0.5 * Math.sin(t * 3.1 + i * 0.6) * Math.sin(t * 1.7 - i * 0.27);
      out[i] += (Math.min(1, base * (0.4 + w)) - out[i]) * 0.3;
    }
  };

  A.label = () => {
    if (A.err) return A.err;
    if (!A.ctx || (!A.synth && !A.mic)) return 'audio: sim';
    if (A.ctx.state !== 'running') return '화면을 한 번 클릭하면 소리 시작';
    return 'audio: ' + [A.synth && 'synth', A.mic && 'mic'].filter(Boolean).join('+');
  };

  return A;
}
