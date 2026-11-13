// expression.js — 얼굴 표정 읽기 (MediaPipe 블렌드셰이프 52개 → 표정 상태)
//
// 근거가 된 카탈로그
//  · FACS — Ekman & Friesen (1978), Ekman, Friesen & Hager (2002). 얼굴 근육 움직임 단위(AU) 코드표.
//  · 감정별 AU 조합(EMFACS 원형) — Matsumoto & Ekman (2008) Scholarpedia, doi:10.4249/scholarpedia.4237
//                                 Lucey et al. (2010) CK+ Table 2 (CVPR Workshops)
//  · 뒤센 미소 AU6+AU12 — Ekman, Davidson & Friesen (1990) JPSP, doi:10.1037/0022-3514.58.2.342
//      (단, 꾸민 미소에도 AU6이 나온다 — Krumhuber & Manstead 2009 → "진심"이 아니라 "강도"로만 씀)
//  · 학습 중 인지·정서 상태: 헷갈림 AU4+AU7(미소 없음), 즐거움 AU7+AU12+AU25/26
//      — McDaniel, D'Mello et al. (2007) CogSci; 좌절 AU4·AU14 — Grafsgaard et al. (2013) ACII
//  · 생각 중 같은 복합 상태는 머리 움직임·시선까지 봐야 함 — el Kaliouby & Robinson (2004) CVPR-W
//  · AU ↔ ARKit/MediaPipe 블렌드셰이프 대응 — Aldenhoven et al. (2026) Sensors 26(3):1060 (CC BY 4.0),
//      M. Ozel "ARKit to FACS Cheat Sheet"
//
// 꼭 지킬 것 — Barrett et al. (2019) "Emotional Expressions Reconsidered", PSPI, doi:10.1177/1529100619832930
//  표정 배열은 감정의 믿을 만한 지문이 아니다 (미소 = 행복이 아닐 수도). 그래서 아이는 단정하지 않고
//  "웃고 있네? 좋은 일 있어?"처럼 본 것을 말하고 물어본다. 판정값은 '얼굴 모양'이지 '마음'이 아니다.
//
// 블렌드셰이프의 Left/Right는 '찍힌 사람' 기준이라 거울 영상이면 뒤바뀐다 → 좌우는 평균하거나 차이(비대칭)만 쓴다.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// 카탈로그: 상태 → { AU, 식(블렌드셰이프 편차 b로 계산), 아이가 쓰는 이름 }
//  b(name) = 지금 값 - 이 사람의 평소(중립) 값, 0 이상.  L/R 이름은 평균.
export const CATALOG = {
  joy:       { au: 'AU6+AU12',            label: '웃음',      score: (b) => b('mouthSmile') * 0.75 + b('cheekSquint') * 0.25, gate: (b) => b('mouthSmile') > 0.22 && b('jawOpen') < 0.3 },
  laugh:     { au: 'AU6/7+AU12+AU25/26',  label: '크게 웃음', score: (b) => Math.min(b('mouthSmile'), 0.8) * 0.5 + b('jawOpen') * 0.35 + b('eyeSquint') * 0.15, gate: (b) => b('mouthSmile') > 0.3 && b('jawOpen') > 0.2 },
  sad:       { au: 'AU1+AU4+AU15',        label: '슬퍼 보임', score: (b) => b('browInnerUp') * 0.45 + b('mouthFrown') * 0.4 + b('mouthShrugLower') * 0.15 - b('mouthSmile') * 0.6, gate: (b) => b('browInnerUp') > 0.15 || b('mouthFrown') > 0.15 },
  surprise:  { au: 'AU1+AU2+AU5+AU26',    label: '놀람',      score: (b) => b('browInnerUp') * 0.2 + b('browOuterUp') * 0.3 + b('eyeWide') * 0.2 + b('jawOpen') * 0.3, gate: (b) => b('browOuterUp') > 0.2 && (b('jawOpen') > 0.15 || b('eyeWide') > 0.2) },
  anger:     { au: 'AU4+AU7+AU23/24',     label: '화나 보임', score: (b) => b('browDown') * 0.55 + b('mouthPress') * 0.25 + b('noseSneer') * 0.2 - b('mouthSmile') * 0.6, gate: (b) => b('browDown') > 0.25 && b('mouthSmile') < 0.1 },
  disgust:   { au: 'AU9+AU10',            label: '찡그림',    score: (b) => b('noseSneer') * 0.6 + b('mouthUpperUp') * 0.4, gate: (b) => b('noseSneer') > 0.2 },
  confusion: { au: 'AU4+AU7 (−AU12)',     label: '갸웃',      score: (b) => b('browDown') * 0.45 + b('eyeSquint') * 0.4 + b('browAsym') * 0.3 - b('mouthSmile') * 0.7, gate: (b) => b('browDown') > 0.12 && b('eyeSquint') > 0.1 && b('mouthSmile') < 0.12 },
  smirk:     { au: 'AU12+AU14 한쪽',      label: '피식',      score: (b) => b('smileAsym') * 0.7 + b('dimpleAsym') * 0.3, gate: (b) => b('smileAsym') > 0.2 },
  thinking:  { au: '약한 AU4 + AU24/28 + 시선 회피 + 고개 기울임 (경험칙)', label: '생각 중',
               score: (b) => b('browDown') * 0.25 + (b('mouthPress') + b('mouthRoll') + b('mouthPucker')) * 0.25 + b('lookAway') * 0.35 + b('tilt') * 0.15 - b('mouthSmile') * 0.5,
               gate: (b) => b('lookAway') > 0.25 && b('mouthSmile') < 0.15 },
  sleepy:    { au: 'AU43(눈 감김 지속)',  label: '졸려 보임', score: (b) => b('eyeBlink') * 0.8 + b('lookDown') * 0.2, gate: (b) => b('eyeBlink') > 0.4, hold: 2.0 },
  yawn:      { au: 'AU26/27+AU43',        label: '하품',      score: (b) => b('jawOpen') * 0.7 + b('eyeSquintOrBlink') * 0.3, gate: (b) => b('jawOpen') > 0.45 && b('mouthSmile') < 0.15, hold: 1.0 },
};

export function createExpression() {
  const base = {};            // 이 사람의 평소(중립) 블렌드셰이프 값
  const score = {};           // 상태별 부드러운 점수
  let n = 0, cur = null, curSince = 0, lastBlend = null;
  const E = { state: null, score: 0, held: 0, scores: score, valence: 0, ready: false };

  // 원시 값 → 좌우 평균·파생 특징
  function features(bs, roll) {
    const g = (k) => bs[k] ?? 0;
    const lr = (k) => (g(k + 'Left') + g(k + 'Right')) / 2;
    return {
      mouthSmile: lr('mouthSmile'), cheekSquint: lr('cheekSquint'), jawOpen: g('jawOpen'),
      eyeSquint: lr('eyeSquint'), eyeWide: lr('eyeWide'), eyeBlink: lr('eyeBlink'),
      browInnerUp: g('browInnerUp'), browOuterUp: lr('browOuterUp'), browDown: lr('browDown'),
      mouthFrown: lr('mouthFrown'), mouthShrugLower: g('mouthShrugLower'), mouthPress: lr('mouthPress'),
      noseSneer: lr('noseSneer'), mouthUpperUp: lr('mouthUpperUp'),
      mouthRoll: (g('mouthRollLower') + g('mouthRollUpper')) / 2, mouthPucker: g('mouthPucker'),
      browAsym: Math.abs(g('browDownLeft') - g('browDownRight')) + Math.abs(g('browOuterUpLeft') - g('browOuterUpRight')),
      smileAsym: Math.abs(g('mouthSmileLeft') - g('mouthSmileRight')),
      dimpleAsym: Math.abs(g('mouthDimpleLeft') - g('mouthDimpleRight')),
      lookAway: Math.max(lr('eyeLookUp'), lr('eyeLookOut'), lr('eyeLookIn') * 0.7),
      lookDown: lr('eyeLookDown'),
      tilt: Math.min(1, Math.abs(roll || 0) / 0.35),
      eyeSquintOrBlink: Math.max(lr('eyeSquint'), lr('eyeBlink')),
    };
  }

  // 매 프레임: blend = sense.blend (얼굴 결과가 새로 올 때만 값이 바뀜)
  E.update = (blend, roll, dt, t) => {
    if (!blend) { E.state = null; E.held = 0; cur = null; return E; }
    if (blend === lastBlend) { // 같은 얼굴 결과 → 유지 시간만 갱신
      E.held = cur ? t - curSince : 0;
      E.state = cur && E.held >= (CATALOG[cur].hold ?? 0.7) ? cur : null;
      return E;
    }
    lastBlend = blend;
    const f = features(blend, roll);
    // 평소 얼굴 학습: 처음 몇 초는 빠르게, 그 뒤엔 천천히. 표정이 클 때는 거의 배우지 않음
    // (오래 웃고 있다고 웃음이 '평소'가 되지 않도록 — 아래로는 빨리, 위로는 아주 천천히 따라감)
    n++;
    const warm = n < 40;
    for (const k in f) {
      if (base[k] === undefined) { base[k] = f[k]; continue; }
      const up = f[k] > base[k];
      const rate = warm ? 0.15 : up ? 0.0008 : 0.06; // 위로는 아주 천천히 (몇 분은 웃어도 '평소'가 되지 않음)
      base[k] += (f[k] - base[k]) * rate;
    }
    E.ready = n > 20;
    const b = (k) => clamp01((f[k] ?? 0) - (k === 'tilt' || k.endsWith('Asym') || k === 'lookAway' ? 0 : base[k] ?? 0));
    let best = null, bv = 0;
    for (const k in CATALOG) {
      const c = CATALOG[k];
      const raw = c.gate(b) ? clamp01(c.score(b) * 1.6) : 0;
      score[k] = (score[k] ?? 0) + (raw - (score[k] ?? 0)) * 0.45;
      if (score[k] > bv) { bv = score[k]; best = k; }
    }
    const on = E.ready && best && bv > 0.32 ? best : null;
    if (on !== cur) { cur = on; curSince = t; }
    E.held = cur ? t - curSince : 0;
    const need = cur ? CATALOG[cur].hold ?? 0.7 : 0;
    E.state = cur && E.held >= need ? cur : null;
    E.score = E.state ? bv : 0;
    // 쾌–불쾌 대략값 (-1~1): 아이가 따라 짓는 표정에만 쓴다
    const pos = Math.max(score.joy ?? 0, score.laugh ?? 0);
    const neg = Math.max(score.sad ?? 0, score.anger ?? 0, score.disgust ?? 0);
    E.valence += ((pos - neg) - E.valence) * 0.2;
    return E;
  };
  E.reset = () => { for (const k in base) delete base[k]; for (const k in score) delete score[k]; n = 0; cur = null; E.state = null; };
  return E;
}
