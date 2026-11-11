// director.js — 한 화면에서 아날로그처럼 흘러가는 이야기 연출
//  ink(inkle, MIT)의 "비트(knot) + 조건 분기" 사고방식을 빌려, 손 이벤트를 기다리는 코루틴으로 작성.
//
//  0 수면   : 아무것도 없는 흰 화면. 검지로 톡 → 물결
//  1 깨어남 : 물결이 잦아들면 먹이 번지고, 감은 눈이 그어지고, 처음 세상을 보듯 눈을 뜬다 → "안녕?"
//  2 호기심 : 내 손가락, 흔드는 손, 톡, 얼굴을 하나씩 알아간다
//  3 거울   : "너는 손이 있구나… 나는 눈만 있네. 나는 뭘까?" → 내가 가르쳐 주는 방식이 아이의 색이 된다
//  4 이름   : 아이가 처음으로 스스로 물결을 만들고, 자기 이름을 찾는다
//  5 함께   : 자유롭게 논다. 오래 떠나 있으면 잠들고, 돌아오면 깨어난다 (이름은 다음에도 기억)

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

export function createDirector({ C, water, sound, sense }) {
  let T = 0, gen = 0;
  const timers = [], waiters = [], polls = [], tweens = [], afters = [];
  const later = (s, fn) => afters.push({ at: T + s, fn });
  const traits = { warm: 0, play: 0, calm: 0, gaze: 0 };
  const flags = {};
  let teach = 1;              // 3막에서 가르침 가중치 ↑
  let lastTapT = -99, lastLineT = -99, awake = false, phase = 'surface', name = null;
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
      if (!awake) return;
      if (near) {
        C.mood('squeeze', 0.55); sound.flinch(); C.bounce(0.6);
        traits.warm += 1.0 * teach;
      } else {
        C.glance({ x: d.x, y: d.y }, 0.9);
        traits.warm += 0.35 * teach;
      }
    }
    if (type === 'wave' && awake) { traits.play += 1.2 * teach; C.bounce(0.5); }
    if (type === 'still' && awake) traits.calm += 1.2 * teach;
    if (type === 'gazeHold' && awake && teach > 1) traits.gaze += 1.2; // 수동적인 행동: 3막에서만, 배수 없이
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
      await say('다시 와 줬구나.');
      C.mood('smile');
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
      if (seen.has(r.type) && r.type !== 'away' && r.type !== 'tap') continue;
      seen.add(r.type);
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
    save({ name, trait: key });
    sound.ambient(0.75, 0.55, 6);
    C.caption('title', 'hello, stranger', { hold: 7 });
    C.caption('sub', `— ${name}`, { hold: 7, y: innerHeight * 0.86 });
    await wait(4);
  }

  async function act5() {
    phase = 'together';
    C.look('auto');
    const pool = {
      tap: [['히히', 'happy'], ['또 해 줘!', 'smile'], ['톡!', 'happy'], ['간지러워~', 'shy']],
      wave: [['안녕, 안녕!', 'happy'], ['나도 흔들흔들~', 'happy']],
      close: [['너무 가까워…!', 'shy']],
      gazeHold: [['…헤헤.', 'shy'], ['뭘 그렇게 봐?', 'smile']],
      twoHands: [['와, 두 손!', 'surprised']],
    };
    for (;;) {
      const r = await waitFor([...Object.keys(pool), 'away'], 9);
      if (r.type === 'away') {
        C.look('around'); C.mood('sad');
        const back = await waitFor(['back'], 9);
        if (back.type === 'back') { C.look('auto'); C.mood('happy', 1.2); C.bounce(1); await say(pick(['왔다!', '여기 있었네!'])); continue; }
        await sleep();
        continue;
      }
      if (r.type === 'timeout') {
        // 가끔 스스로 물결을 만들며 논다
        if (Math.random() < 0.5) {
          const c = C.center;
          water.drop(c.x + (Math.random() - 0.5) * C.E * 6, c.y + C.E * (1 + Math.random()), 18, 0.04);
          C.glance({ x: c.x, y: c.y + C.E * 2 }, 0.8);
          C.mood('smile', 1.5);
        } else C.blink(true);
        continue;
      }
      if (T - lastLineT < 4) continue;
      if (r.type === 'tap' && !C.near(r.x, r.y) && Math.random() < 0.6) continue;
      const [line, mood] = pick(pool[r.type]);
      C.mood(mood, 1.5);
      await say(line);
    }
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
  function save(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } }

  /* ───────── 실행 ───────── */
  async function run() {
    myGen = gen;
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
    water.clear(); water.cloud.w = 0;
    sound.setVoice(0);
    C.reset();
    // 이전 코루틴의 대기들이 다음 update에서 취소된 뒤 새로 시작
    setTimeout(run, 50);
  }

  return {
    update, emit, run, restart,
    get phase() { return phase; }, get traits() { return traits; }, get name() { return name; }, get teaching() { return teach > 1; },
  };
}
