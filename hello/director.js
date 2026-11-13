// director.js — 한 화면에서 아날로그처럼 흘러가는 이야기 연출
//  ink(inkle, MIT)의 "비트(knot) + 조건 분기" 사고방식을 빌려, 손 이벤트를 기다리는 코루틴으로 작성.
//
//  0 수면   : 아무것도 없는 흰 화면. 검지로 톡 → 물결
//  1 깨어남 : 물결이 잦아들면 먹이 번지고, 감은 눈이 그어지고, 처음 세상을 보듯 눈을 뜬다 → "안녕?"
//  2 호기심 : 내 손가락, 흔드는 손, 톡, 얼굴을 하나씩 알아간다
//  3 거울   : "너는 손이 있구나… 나는 눈만 있네. 나는 뭘까?" → 내가 가르쳐 주는 방식이 아이의 색이 된다
//  4 이름   : 아이가 처음으로 스스로 물결을 만들고, 자기 이름을 찾는다
//  5 함께   : 자유롭게 논다. 오래 떠나 있으면 잠들고, 돌아오면 깨어난다 (이름은 다음에도 기억)

import { TOPICS, pickTopic, hintFor, HINTS, understand, freeReply, short, fill, lines as linesOf } from './talk.js';

const TRAITS = {
  warm:  { hue: 352, sat: 0.62, lit: 0.5,  name: '토독', why: '네가 톡, 톡 두드려 줬잖아. 그 소리가 나야.' },
  play:  { hue: 178, sat: 0.55, lit: 0.42, name: '살랑', why: '네가 흔들어 준 물결… 그게 나야.' },
  calm:  { hue: 262, sat: 0.45, lit: 0.48, name: '고요', why: '가만히 곁에 있어 줬잖아. 그 조용함이 나야.' },
  gaze:  { hue: 38,  sat: 0.7,  lit: 0.47, name: '반짝', why: '계속 나를 바라봐 줬잖아. 그 눈빛이 나야.' },
};
const hasBatchim = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c <= 11171 && c % 28 !== 0; };
const iya = (w) => w + (hasBatchim(w) ? '이야' : '야');
const pick = (a) => a[(Math.random() * a.length) | 0];
const STORE = 'hello-stranger.v1';
const dayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysSince = (s) => (s ? Math.round((new Date(dayStr()) - new Date(s)) / 86400000) : null);
const RPS_ICON = { rock: '✊', scissors: '✌', paper: '✋' };
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const GEST_RPS = { fist: 'rock', peace: 'scissors', open: 'paper' };

// 이야기 밖에서도 언제든 나오는 반응 대사 — [문장, 표정]
const REACT = {
  tap: [['히히', 'happy'], ['또 해 줘!', 'smile'], ['톡!', 'happy'], ['간지러워~', 'shy']],
  wave: [['안녕, 안녕!', 'happy'], ['나도 흔들흔들~', 'happy']],
  close: [['너무 가까워…!', 'shy'], ['코, 코가 보여…!', 'surprised']],
  gazeHold: [['…헤헤.', 'shy'], ['뭘 그렇게 봐?', 'smile'], ['내 얼굴에 뭐 묻었어?', 'curious']],
  twoHands: [['와, 두 손!', 'surprised']],
  pet: [['기분 좋아…', 'happy'], ['헤헤, 쓰담쓰담.', 'happy'], ['더… 더 해 줘…', 'shy']],
  tickle: [['히히히, 그만~!', 'squeeze'], ['간지러워, 간지러워!', 'happy']],
  highfive: [['하이파이브!', 'happy'], ['짝!', 'happy']],
  hide: [['어? 어디 갔지?', 'curious']],
  peekaboo: [['까꿍! 찾았다!', 'happy'], ['으앗, 깜짝이야!', 'surprised'], ['히히, 또 해 줘!', 'happy']],
  'g:thumbsUp': [['칭찬이야? 헤헤.', 'shy'], ['나도 최고!', 'happy']],
  'g:thumbsDown': [['힝… 뭐가 별로야?', 'sad']],
  'g:peace': [['브이!', 'happy'], ['찰칵! 사진 찍는 거야?', 'surprised']],
  cross: [['으으, 눈이 몰려…', 'surprised']],
};

export function createDirector({ C, water, sound, sense }) {
  let T = 0, gen = 0;
  const timers = [], waiters = [], polls = [], tweens = [], afters = [];
  const later = (s, fn) => afters.push({ at: T + s, fn });
  const traits = { warm: 0, play: 0, calm: 0, gaze: 0 };
  const flags = {};
  let teach = 1;              // 3막에서 가르침 가중치 ↑
  let lastTapT = -99, lastLineT = -99, awake = false, phase = 'surface', name = null;
  let asking = false, tapCount = 0, days0 = null, lastWasMuse = false, petT = 0;
  const asked = new Set(), nearTaps = [];
  const cancel = () => { throw 'cancel'; };

  /* ───────── 코루틴 도구 ───────── */
  const wait = (s) => new Promise((res, rej) => timers.push({ at: T + s, res, rej, gen }));
  const waitFor = (types, timeout = Infinity) => new Promise((res, rej) =>
    waiters.push({ types: new Set(types), at: T + timeout, res, rej, gen }));
  const until = (pred, timeout = Infinity) => new Promise((res, rej) =>
    polls.push({ pred, at: T + timeout, res, rej, gen }));
  const tween = (obj, key, to, dur, ease = (x) => x * x * (3 - 2 * x)) => new Promise((res, rej) =>
    tweens.push({ obj, key, from: obj[key], to, t0: T, dur, ease, res, rej, gen }));
  const say = async (text, opt) => { lastLineT = T; await C.say(text, opt); if (gen !== myGen) cancel(); };
  let myGen = 0;

  function emit(type, data = {}) {
    reflex(type, data);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.types.has(type)) { waiters.splice(i, 1); w.res({ type, ...data }); }
    }
  }

  /* ───────── 반사 반응 (언제나) ───────── */
  function reflex(type, d) {
    if (type === 'tap') {
      lastTapT = T;
      const near = awake && C.near(d.x, d.y);
      const big = !awake || d.kind === 'jab' || d.kind === 'click';
      water.drop(d.x, d.y, big ? 38 : 30, d.kind === 'dwell' ? 0.07 : 0.1);
      sound.drop(d.x / innerWidth, d.kind === 'dwell' ? 0.7 : 1);
      // 튀어 오른 물방울이 다시 떨어지는 2차 낙수
      later(0.34, () => { water.drop(d.x + (Math.random() - 0.5) * 6, d.y, 14, 0.05); sound.drop(d.x / innerWidth, 0.35); });
      tapCount++;
      if (!awake) return;
      if (near && d.gesture === 'open' && d.kind === 'jab' && !asking) { // 손바닥으로 앞으로 → 하이파이브
        C.mood('happy', 1.4); C.bounce(1.2); C.sparkle(0.8); later(1.2, () => C.sparkle(0));
        sound.chime([79, 86], 0.06, 0.06); water.drop(d.x, d.y, 60, 0.12);
        emit('highfive', d); return;
      }
      if (near) {
        C.mood('squeeze', 0.55); sound.flinch(); C.bounce(0.6);
        traits.warm += 1.0 * teach;
        nearTaps.push(T);
        while (nearTaps.length && T - nearTaps[0] > 2.5) nearTaps.shift();
        if (nearTaps.length >= 4) { nearTaps.length = 0; sound.giggle(); emit('tickle'); }
      } else {
        C.glance({ x: d.x, y: d.y }, 0.9);
        traits.warm += 0.35 * teach;
      }
    }
    if (type === 'wave' && awake) { traits.play += 1.2 * teach; C.bounce(0.5); }
    if (type === 'still' && awake) traits.calm += 1.2 * teach;
    if (type === 'gazeHold' && awake && teach > 1) traits.gaze += 1.2; // 수동적인 행동: 3막에서만, 배수 없이
    if (type === 'text') { // 내가 적은 말이 물 위에 떨어진다
      C.caption('you', `“${d.text}”`, { hold: 2.4 });
      water.drop(innerWidth / 2, innerHeight * 0.79, 30, 0.05); sound.drop(0.5, 0.5);
      if (awake && !asking) { const u = understand(d.text); C.mood(u.sent === 'bad' ? 'sad' : u.sent === 'good' ? 'happy' : 'curious', 1.2); }
    }
    if (!awake) return;
    if (type === 'pet') { C.mood('happy', 2.2); sound.purr(); }
    if (type === 'hide') { C.look('around'); later(2.5, () => C.st.attn === 'around' && C.look('auto')); }
    if (type === 'peekaboo') { C.look('viewer'); C.mood('surprised', 0.5); later(0.5, () => { C.mood('happy', 1.5); sound.giggle(); C.bounce(1); }); later(2.2, () => C.look('auto')); }
    if (type === 'gesture' && !asking) {
      if (d.name === 'thumbsUp') { C.mood('happy', 1.2); C.sparkle(0.7); later(1.4, () => C.sparkle(0)); }
      if (d.name === 'thumbsDown') C.mood('sad', 1.4);
      if (d.name === 'peace') { C.wink(Math.random() < 0.5 ? -1 : 1, 0.8); C.bounce(0.5); }
    }
  }

  /* ───────── 매 프레임 ───────── */
  function update(dt) {
    T += dt;
    for (let i = timers.length - 1; i >= 0; i--) {
      const x = timers[i];
      if (x.gen !== gen) { timers.splice(i, 1); x.rej('cancel'); } else if (T >= x.at) { timers.splice(i, 1); x.res(); }
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      const x = waiters[i];
      if (x.gen !== gen) { waiters.splice(i, 1); x.rej('cancel'); } else if (T >= x.at) { waiters.splice(i, 1); x.res({ type: 'timeout' }); }
    }
    for (let i = polls.length - 1; i >= 0; i--) {
      const x = polls[i];
      if (x.gen !== gen) { polls.splice(i, 1); x.rej('cancel'); }
      else if (x.pred()) { polls.splice(i, 1); x.res(true); }
      else if (T >= x.at) { polls.splice(i, 1); x.res(false); }
    }
    for (let i = afters.length - 1; i >= 0; i--) if (T >= afters[i].at) afters.splice(i, 1)[0].fn();
    for (let i = tweens.length - 1; i >= 0; i--) {
      const x = tweens[i];
      if (x.gen !== gen) { tweens.splice(i, 1); x.rej('cancel'); continue; }
      const k = Math.min(1, (T - x.t0) / x.dur);
      x.obj[x.key] = x.from + (x.to - x.from) * x.ease(k);
      if (k >= 1) { tweens.splice(i, 1); x.res(); }
    }

    // 지속형 감각 → 특성 / 합성 이벤트
    if (awake) {
      if (teach > 1) { // 연속 점수는 "가르쳐 줘"라고 한 3막에서만 (대사를 듣는 동안 쌓이지 않게)
        if (sense.tips.length) traits.play += sense.motion * dt * 0.3;
        if (sense.still > 1.5) traits.calm += dt * 0.1;
      }
      if (sense.still > 4 && !flags.stillSent) { flags.stillSent = true; emit('still'); }
      if (sense.still < 0.5) flags.stillSent = false;
      // 바라보기 = 손을 내려놓고 얼굴만 보여 준 채 가만히 있을 때
      if (sense.faceT > 4.5 && sense.idle > 4 && !sense.tips.length && T - (flags.gazeT ?? -99) > 10) { flags.gazeT = T; emit('gazeHold'); }
      const close = sense.face && sense.face.size > 0.4;
      if (close && !flags.closeSent) { flags.closeSent = true; emit('close'); }
      if (sense.face && sense.face.size < 0.3) flags.closeSent = false;
      if (sense.motion > 0.12 && sense.tips.length && !flags.moveSent) { flags.moveSent = true; emit('move'); }
      if (sense.motion < 0.02) flags.moveSent = false;
      // 쓰다듬기: 아이 근처를 톡 없이 천천히 쓸어 줄 때
      const tip = sense.tips[0];
      const stroking = tip && C.near(tip.x, tip.y, 2.4) && sense.motion > 0.012 && sense.motion < 0.3 && T - lastTapT > 1;
      petT = stroking ? petT + dt : Math.max(0, petT - dt * 2);
      if (petT > 1.5 && T - (flags.petT ?? -99) > 9) { flags.petT = T; petT = 0; emit('pet'); }
      if (C.conv > 0.75 && T - (flags.crossT ?? -99) > 15) { flags.crossT = T; emit('cross'); }
      if (sense.away > 7 && !flags.awaySent) { flags.awaySent = true; emit('away'); }
      if (sense.away < 0.5 && flags.awaySent) { flags.awaySent = false; emit('back'); }
    }
    // 수면 안정화: 오래 조용하면 물결이 더 빨리 잦아든다
    water.damping = T - lastTapT > 2.4 ? 0.987 : 0.9955;
  }

  /* ───────── 정체성 ───────── */
  function dominant() {
    const k = Object.keys(traits).sort((a, b) => traits[b] - traits[a]);
    return k[0];
  }
  function tintFromTraits(strength) {
    // 원형 색상 평균 (특성 가중)
    let x = 0, y = 0, tot = 0;
    for (const k in traits) {
      const w = traits[k] + 0.01, a = (TRAITS[k].hue * Math.PI) / 180;
      x += Math.cos(a) * w; y += Math.sin(a) * w; tot += w;
    }
    const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, tot / 14) * strength;
    C.identity(hue, 0.06 + s * 0.55, 0.34 + s * 0.1);
  }

  /* ───────── 막(Act) ───────── */
  async function act0() {
    phase = 'surface';
    C.reset(); awake = false;
    sound.ambient(0.35, 0.15, 6);
    const first = await waitFor(['tap'], 3.5);
    if (first.type === 'timeout') {
      C.caption('hint', sense.cam ? '검지로, 톡.' : '클릭해서, 톡.');
      const r = await waitFor(['tap'], 9);
      if (r.type === 'timeout') {
        C.caption('hint', sense.cam ? '살짝 찌르듯이 — 아니면 손끝을 잠시 멈춰 두어도 돼요.' : '화면 아무 곳이나, 톡.');
        await waitFor(['tap']);
      }
    }
    C.clearKind('hint');
    // 물결이 잦아들 때까지 (더 톡 하면 그만큼 기다림)
    await until(() => T - lastTapT > 3.0);
  }

  async function act1() {
    phase = 'awaken';
    const c = C.center;
    const cl = water.cloud;
    cl.x = c.x / innerWidth; cl.y = 1 - c.y / innerHeight; cl.z = 0.02; cl.w = 0;
    sound.swell(4.2);
    sound.ambient(0.6, 0.25, 5);
    await Promise.all([tween(cl, 'w', 1, 2.4), tween(cl, 'z', 0.34, 3.4)]);
    // 먹이 모여 감은 눈이 그어진다
    C.show(0.8);
    C.reveal(1.7);
    tween(cl, 'z', 0.12, 2.4); tween(cl, 'w', 0, 3.0);
    await wait(2.6);
    awake = true;
    C.look('viewer');
    // 눈꺼풀 떨림
    for (const v of [0.18, 0, 0.12, 0]) { C.open(v, 30); await wait(0.16); }
    await wait(0.7);
    C.mood('sleepy'); C.open(1, 1.6);
    water.drop(C.eyes()[0].x, C.eyes()[0].y, 18, 0.02); water.drop(C.eyes()[1].x, C.eyes()[1].y, 18, 0.02);
    await wait(1.6);
    C.blink(); await wait(0.5);
    // 처음 보는 세상
    C.mood('wonder');
    C.look('point', { x: c.x - C.E * 6, y: c.y + C.E }); await wait(1.0);
    C.look('point', { x: c.x + C.E * 6, y: c.y - C.E * 0.5 }); await wait(1.1);
    C.look('down'); await wait(0.9);
    // 너를 발견
    C.look('viewer');
    C.mood('surprised', 0.6); sound.blip('?', 0, 1, '?');
    await wait(0.7);
    C.mood('curious'); C.tiltTo(0.13);
    await wait(1.3);
    C.blink(true); await wait(0.9);
    await say('…?');
    await wait(0.6);
    C.tiltTo(-0.06); C.mood('smile');
    C.bounce(0.4);
    await say('안녕?', { hold: 1.6 });
    C.mood('curious');
    C.look('auto');

    const mem = load();
    remember({ lastVisit: dayStr(), visits: (mem?.visits || 0) + 1 });
    if (mem?.name) {
      await wait(0.8);
      C.mood('thinking');
      await say('…어?');
      await say('너, 본 적 있어.');
      name = mem.name;
      const tr = TRAITS[mem.trait] || TRAITS.warm;
      C.identity(tr.hue, tr.sat, tr.lit); C.sparkle(0.8);
      C.mood('happy'); C.bounce(1); sound.chime();
      await say(`나야, ${name}!`);
      if (days0 === 0) await say('또 왔네! 헤헤.');
      else if (days0 === 1) await say('어제 보고 또 보네. 반가워!');
      else if (days0 > 1) { C.mood('shy', 2); await say(`${days0}일 만이야. 보고 싶었어.`); }
      else await say('다시 와 줬구나.');
      const h = new Date().getHours();
      C.mood('smile');
      await say(h >= 5 && h < 11 ? '좋은 아침!' : h >= 22 || h < 5 ? '이 시간까지 안 자? 헤헤.' : h >= 18 ? '좋은 저녁이야.' : '오늘도 와 줘서 고마워.');
      return 'remembered';
    }
    const r = await waitFor(['tap', 'wave', 'move', 'handIn'], 7);
    if (r.type === 'timeout') {
      C.mood('sad'); C.tiltTo(0.1);
      await say('…내 말, 들려?');
      C.mood('curious');
      const r2 = await waitFor(['tap', 'wave', 'move', 'handIn'], 10);
      return r2.type;
    }
    return r.type;
  }

  async function act2(first) {
    phase = 'curious';
    const react = {
      tap: async () => { await wait(0.4); C.mood('surprised', 0.5); await say('앗, 차가워!'); C.mood('smile'); sound.giggle(); await say('…한 번 더?'); },
      wave: async () => { C.mood('happy', 1.6); await say('와… 흔들흔들.'); C.mood('curious'); },
      move: async () => { C.look('auto'); C.mood('curious'); await wait(1.2); await say('그건… 뭐야?'); },
      handIn: async () => { C.mood('curious'); await say('그건… 뭐야?'); },
      timeout: async () => { C.mood('curious'); },
    };
    await (react[first] || react.timeout)();
    await wait(0.5);
    C.tiltTo(0.1);
    await say('너는… 누구야?');
    C.tiltTo(0);

    const seen = new Set([first]);
    const lines = {
      tap: async (d) => {
        if (C.near(d.x, d.y)) { await wait(0.5); C.mood('happy', 1.4); sound.giggle(); await say('히히, 간지러워.'); }
        else { await wait(0.6); await say('저기도 물결이…'); }
      },
      wave: async () => { C.mood('happy', 1.5); await say('나한테 손 흔드는 거야?'); C.mood('smile'); },
      move: async () => { C.look('auto'); await wait(1.5); C.mood('curious'); await say('따라가 볼래!'); },
      twoHands: async () => { C.mood('surprised', 0.8); await say('손이 두 개나!'); },
      close: async () => { C.mood('shy', 2.5); await say('우와… 가까워.'); },
      gazeHold: async () => { C.mood('shy', 2); await say('…계속 보고 있네.'); },
      text: async () => { C.mood('wonder', 2); await say('말…! 너는 말을 할 줄 아는구나!'); },
      peekaboo: async () => { await wait(0.6); await say('어디 갔다가… 나타났다! 그거 재밌다!'); },
      pet: async () => { await say('따뜻해… 이게 뭐야?'); },
      tickle: async () => { await say('히히히, 그만~!'); },
      gesture: async (d) => {
        if (d.name === 'thumbsUp') { await say('그 손 모양… 좋다는 뜻이야?'); }
        else if (d.name === 'peace') { await say('손가락 두 개! 나도 눈 두 개!'); }
      },
      away: async () => {
        C.look('around'); C.mood('sad');
        await say('…어디 갔어?');
        const r = await waitFor(['back'], 12);
        C.look('auto');
        if (r.type === 'back') { C.mood('happy', 1.4); C.bounce(1); await say('아! 거기 있었구나.'); }
      },
    };
    const start = T;
    let count = 0;
    while (count < 4 && T - start < 48) {
      const r = await waitFor(Object.keys(lines), 14);
      if (r.type === 'timeout') { if (T - start > 30) break; continue; }
      const key = r.type === 'gesture' ? `g:${r.name}` : r.type;
      if (r.type === 'gesture' && !['thumbsUp', 'peace'].includes(r.name)) continue;
      if (seen.has(key) && r.type !== 'away' && r.type !== 'tap') continue;
      seen.add(key);
      await lines[r.type](r);
      count++;
      await wait(1.2);
    }
  }

  async function act3() {
    phase = 'mirror';
    C.look('viewer'); C.mood('thinking');
    await wait(0.8);
    await say('너는 손이 있구나.');
    C.look('down'); await wait(1.4);
    C.mood('sad');
    await say('나는… 눈밖에 없네.');
    await wait(0.6);
    C.look('viewer'); C.mood('curious'); C.tiltTo(0.12);
    await say('나는 뭘까?');
    await wait(0.9);
    C.tiltTo(0); C.mood('wonder');
    await say('…알려 줄래?', { hold: 2 });
    C.caption('hint', sense.cam ? '톡   ·   손 흔들기   ·   가만히 바라보기' : '클릭   ·   좌우로 흔들기   ·   가만히 있기');
    C.look('auto');

    teach = 3;
    const taught = new Set();
    const lines = {
      tap: '톡… 이 느낌, 좋아.',
      wave: '살랑살랑… 이것도 나일까?',
      still: '조용히… 같이 있는 거, 따뜻해.',
      gazeHold: '네 눈… 반짝여.',
    };
    const trait = { tap: 'warm', wave: 'play', still: 'calm', gazeHold: 'gaze' };
    const start = T;
    while (taught.size < 3 && T - start < 40) {
      const r = await waitFor(Object.keys(lines), 12);
      if (r.type === 'timeout') {
        if (!taught.size) { C.mood('sad', 1.5); await say('…아무거나 괜찮아.'); }
        continue;
      }
      if (taught.has(r.type)) { tintFromTraits(0.6 + taught.size * 0.15); continue; }
      taught.add(r.type);
      traits[trait[r.type]] += [6, 3, 1.5][taught.size - 1]; // 먼저 가르쳐 준 것일수록 아이에게 깊이 남는다
      C.clearKind('hint');
      tintFromTraits(0.4 + taught.size * 0.2);
      C.sparkle(0.5); sound.chime([74 + taught.size * 2, 81 + taught.size * 2], 0.1, 0.05);
      C.mood(r.type === 'still' || r.type === 'gazeHold' ? 'smile' : 'happy', 1.4);
      if (r.type === 'wave') C.bounce(0.7);
      await wait(0.4);
      await say(lines[r.type]);
      C.sparkle(0);
      C.mood('curious');
      await wait(0.8);
    }
    C.clearKind('hint');
    teach = 1;
  }

  async function act4() {
    phase = 'naming';
    const key = dominant();
    const tr = TRAITS[key];
    C.look('viewer'); C.mood('surprised', 0.8);
    await say('아.');
    await wait(0.6);
    C.mood('thinking');
    await say('알 것 같아.');
    // 눈을 감고, 처음으로 스스로 물결을 만든다
    C.open(0, 3); C.mood('neutral');
    sound.ambient(0.8, 0.4, 3);
    await wait(1.4);
    const c = C.center, E = C.E;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3, r = E * (1.6 + (k % 2) * 0.8);
      water.drop(c.x + Math.cos(a) * r * 1.4, c.y + Math.sin(a) * r * 0.8, 22, 0.05);
      sound.drop(0.5 + Math.cos(a) * 0.3, 0.55);
      await wait(0.16);
    }
    C.identity(tr.hue, tr.sat, tr.lit);
    sound.chime([74, 78, 81, 86, 90], 0.14, 0.08);
    await wait(1.2);
    C.open(1, 2.2); C.sparkle(1); C.mood('wonder');
    sound.setVoice(1);
    await wait(1.4);
    C.mood('smile'); C.tiltTo(-0.08);
    name = tr.name;
    await say(`나는… ${iya(name)}.`, { hold: 2 });
    await say(tr.why, { hold: 2.4 });
    C.mood('shy');
    await say('너를 만나서, 내가 생겼어.', { hold: 2 });
    C.mood('happy'); C.bounce(0.8); sound.giggle();
    await say('고마워.', { hold: 1.8 });
    C.mood('smile'); C.tiltTo(0); C.sparkle(0.6);
    remember({ name, trait: key });
    sound.ambient(0.75, 0.55, 6);
    C.caption('title', 'hello, stranger', { hold: 7 });
    C.caption('sub', `— ${name}`, { hold: 7, y: innerHeight * 0.86 });
    await wait(4);
  }

  async function act5() {
    phase = 'together';
    C.look('auto');
    let nextTalk = T + 7;
    const cool = {};
    const types = [...Object.keys(REACT).filter((k) => !k.startsWith('g:')), 'gesture', 'text', 'away'];
    for (;;) {
      const r = await waitFor(types, Math.max(0.3, Math.min(9, nextTalk - T)));
      if (r.type === 'timeout') {
        if (T >= nextTalk) {
          if (sense.away < 3) { const tp = pickTopic(ctx(), asked); if (tp) await ask(tp); else asked.clear(); }
          nextTalk = T + 18 + Math.random() * 18;
        } else idleBit();
        continue;
      }
      if (r.type === 'away') {
        C.look('around'); C.mood('sad');
        const back = await waitFor(['back'], 9);
        if (back.type === 'back') { C.look('auto'); C.mood('happy', 1.2); C.bounce(1); await say(pick(['왔다!', '여기 있었네!'])); continue; }
        await sleep();
        nextTalk = T + 8;
        continue;
      }
      if (r.type === 'text') { await chat(r.text); nextTalk = Math.max(nextTalk, T + 12); continue; }
      const key = r.type === 'gesture' ? `g:${r.name}` : r.type;
      if (!REACT[key]) continue;
      if (T - (cool[key] ?? -99) < 8 || T - lastLineT < 3) continue;
      if (r.type === 'tap' && !C.near(r.x, r.y) && Math.random() < 0.6) continue;
      cool[key] = T;
      const [line, mood] = pick(REACT[key]);
      C.mood(mood, 1.6);
      await say(line);
    }
  }

  // 가끔 혼자 노는 모습
  function idleBit() {
    const k = Math.random();
    const c = C.center;
    if (k < 0.4) {
      water.drop(c.x + (Math.random() - 0.5) * C.E * 6, c.y + C.E * (1 + Math.random()), 18, 0.04);
      C.glance({ x: c.x, y: c.y + C.E * 2 }, 0.8); C.mood('smile', 1.5);
    } else if (k < 0.7) C.blink(true);
    else if (k < 0.85) { C.tiltTo((Math.random() - 0.5) * 0.25); later(1.6, () => C.tiltTo(0)); }
    else C.wink(Math.random() < 0.5 ? -1 : 1, 0.5);
  }

  /* ───────── 대화 ───────── */
  function ctx() {
    const h = new Date().getHours();
    return { hour: h, days: days0, meal: h < 10 ? '아침' : h < 15 ? '점심' : h < 21 ? '저녁' : '야식', mem: load() || {}, name, n: tapCount, lastWasMuse };
  }
  async function speak(rep, c) {
    for (const l of rep) {
      const [text, mood] = Array.isArray(l) ? l : [l, null];
      if (mood) { C.mood(mood, 3); if (mood === 'happy') C.bounce(0.5); }
      await say(fill(text, c));
    }
  }
  async function ask(topic) {
    const c = ctx();
    asked.add(topic.id);
    C.look('viewer');
    if (topic.type === 'muse') { // 혼잣말: 배열이면 차례대로
      let L = linesOf(topic.ask, c); if (!Array.isArray(L)) L = [L];
      C.mood(topic.mood || 'thinking');
      for (const l of L) await say(fill(l, c));
      lastWasMuse = true; C.mood('smile'); C.look('auto');
      return;
    }
    lastWasMuse = false;
    let q = linesOf(topic.ask, c); if (Array.isArray(q)) q = pick(q);
    C.mood(topic.mood || 'curious'); C.tiltTo(0.09);
    asking = true;
    try {
      await say(fill(q, c), { keep: true });   // 질문은 대답할 때까지 남겨 둠
      C.caption('hint', hintFor(topic));
      const ans = await getAnswer(topic, 16);
      C.clearKind('hint'); C.tiltTo(0);
      const c2 = { ...c, you: ans.text ? short(ans.text) : '' };
      const rep = topic.reply[ans.kind]
        ?? (ans.text ? topic.reply.text : null)
        ?? (ans.kind === null ? topic.reply.none ?? [['…대답하기 어려우면 괜찮아.', 'smile']] : null)
        ?? [['그렇구나.', 'smile']];
      await speak(rep, c2);
      if (topic.remember && ans.kind !== null) remember(topic.remember(ans, c2));
      if (topic.then?.[ans.kind] === 'rps') await rps();
    } finally {
      asking = false; C.clearKind('hint'); C.look('auto');
    }
  }
  // 손 모양 또는 키보드로 들어온 대답을 질문 종류에 맞게 해석
  async function getAnswer(topic, timeout) {
    const end = T + timeout;
    const G = {
      mood: { thumbsUp: 'good', open: 'soso', thumbsDown: 'bad' },
      yesno: { thumbsUp: 'yes', thumbsDown: 'no', open: 'maybe' },
      choice: { one: 0, peace: 1, three: 2 },
    }[topic.type] || {};
    for (;;) {
      const r = await waitFor(['gesture', 'text'], Math.max(0.1, end - T));
      if (r.type === 'timeout') return { kind: null };
      if (r.type === 'gesture') {
        if (!(r.name in G)) continue;
        // 톡 하려고 검지를 편 것 / 그냥 손바닥을 편 것과 구분: 손 모양을 잠깐 유지해야 대답으로 인정
        if (sense.cam) {
          await wait(0.4);
          if (sense.gesture !== r.name || sense.motion > 0.06) continue;
        }
        C.bounce(0.3);
        return { kind: G[r.name], gesture: r.name };
      }
      const u = understand(r.text);
      if (topic.type === 'mood') return { kind: u.sent ?? 'text', text: r.text, sent: u.sent };
      if (topic.type === 'yesno') return { kind: u.yes === true ? 'yes' : u.yes === false ? 'no' : 'text', text: r.text };
      if (topic.type === 'choice') {
        const i = topic.options.findIndex((o) => o.words.test(r.text));
        return { kind: i >= 0 ? i : 'text', text: r.text };
      }
      return { kind: 'text', text: r.text };
    }
  }
  // 질문 중이 아닐 때 그냥 말을 걸면
  async function chat(text) {
    asking = true;
    try {
      C.look('viewer');
      const { lines, then } = freeReply(text);
      await wait(0.5);
      await speak(lines, { ...ctx(), you: short(text) });
      if (then === 'rps') await rps();
    } finally { asking = false; C.look('auto'); }
  }

  /* ───────── 가위바위보 ───────── */
  async function rps() {
    asking = true;
    try {
      for (let round = 0; round < 3; round++) {
        C.look('viewer'); C.mood('happy', 1);
        C.caption('hint', '✊ 바위    ✌ 가위    ✋ 보    ·    ⏎ 직접 적기');
        await say('가위…', { hold: 0.12, speed: 1.3 });
        await say('바위…', { hold: 0.12, speed: 1.3 });
        await say('보!', { hold: 0.45 });
        const mine = pick(Object.keys(BEATS));
        let yours = GEST_RPS[sense.gesture] || null;
        if (!yours) {
          const r = await waitFor(['gesture', 'text'], 1.8);
          if (r.type === 'gesture') yours = GEST_RPS[r.name] || null;
          else if (r.type === 'text') yours = understand(r.text).rps;
        }
        C.clearKind('hint');
        if (!yours) { C.mood('sad', 2); await say('어? 손을 안 냈잖아~'); }
        else {
          await say(`나는 ${RPS_ICON[mine]}!`, { hold: 0.9 });
          if (mine === yours) { C.mood('surprised', 1.5); await say('비겼다! 우리 마음이 통했나 봐.'); }
          else if (BEATS[mine] === yours) { C.mood('happy', 2); C.bounce(1); sound.giggle(); await say(pick(['이겼다! 히히.', '내가 이겼지롱~'])); }
          else { C.mood('sad', 1.6); await say(pick(['졌다… 너 잘한다!', '으앙, 한 번만 봐주지…'])); }
        }
        if (round === 2) { C.mood('smile'); await say('재밌었다! 다음에 또 하자.'); break; }
        C.mood('curious');
        await say('한 판 더?', { keep: true });
        C.caption('hint', HINTS.yesno + '    ·    ⏎ 직접 말하기');
        const a = await getAnswer({ type: 'yesno' }, 9);
        C.clearKind('hint');
        if (a.kind !== 'yes' && a.kind !== 'maybe') { C.mood('smile'); await say('재밌었다! 다음에 또 하자.'); break; }
      }
    } finally { asking = false; C.clearKind('hint'); }
  }

  async function sleep() {
    C.look('viewer'); C.mood('sleepy');
    await say('또… 와 줄 거지?', { hold: 2.2 });
    C.open(0.25, 1); await wait(1.2);
    C.open(0, 0.8);
    sound.ambient(0.3, 0.1, 5);
    C.caption('title', 'hello, stranger', { hold: 6 });
    const r = await waitFor(['tap', 'handIn', 'faceIn', 'back']);
    C.clearKind('title');
    sound.ambient(0.7, 0.5, 3);
    C.open(1, 3); C.mood('surprised', 0.6);
    await wait(0.6);
    C.mood('happy'); C.bounce(1);
    await say('응? 왔어?');
    if (name) await say(`${name}, 여기 있어!`);
    C.mood('smile'); C.look('auto');
    return r;
  }

  /* ───────── 저장 ───────── */
  function load() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } }
  function remember(v) {
    if (!v) return;
    try { localStorage.setItem(STORE, JSON.stringify({ ...(load() || {}), ...v })); } catch { /* 저장 불가 환경 */ }
  }

  /* ───────── 실행 ───────── */
  function paperByHour() {
    const h = new Date().getHours();
    if (h >= 21 || h < 5) water.setPaper(0.925, 0.928, 0.945);       // 밤: 살짝 푸르고 어둡게
    else if (h >= 17) water.setPaper(0.972, 0.952, 0.925);            // 저녁: 따뜻하게
    else if (h < 8) water.setPaper(0.962, 0.962, 0.958);              // 새벽: 맑게
    else water.setPaper(0.968, 0.962, 0.948);
  }
  async function run() {
    myGen = gen;
    days0 = daysSince(load()?.lastVisit);
    paperByHour();
    try {
      await act0();
      const first = await act1();
      if (first !== 'remembered') {
        await act2(first);
        await act3();
        await act4();
      }
      await act5();
    } catch (e) {
      if (e !== 'cancel') console.error(e);
    }
  }
  function restart({ forget = false } = {}) {
    gen++;
    if (forget) { try { localStorage.removeItem(STORE); } catch { /* */ } }
    for (const k in traits) traits[k] = 0;
    for (const k in flags) delete flags[k];
    teach = 1; awake = false; name = null; lastTapT = -99;
    asking = false; tapCount = 0; lastWasMuse = false; asked.clear();
    water.clear(); water.cloud.w = 0;
    sound.setVoice(0);
    C.reset();
    // 이전 코루틴의 대기들이 다음 update에서 취소된 뒤 새로 시작
    setTimeout(run, 50);
  }

  return {
    update, emit, run, restart,
    get phase() { return phase; }, get traits() { return traits; }, get name() { return name; }, get teaching() { return teach > 1; }, get asking() { return asking; },
    ask: (id) => { const t = TOPICS.find((x) => x.id === id); return t ? ask(t) : null; }, rps: () => rps(),
  };
}
