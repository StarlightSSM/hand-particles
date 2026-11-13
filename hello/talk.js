// talk.js — 아이의 대화 로그 (일상 대화 · 사담 · 기억)
//
// ✏️ 아이에게 새 질문을 가르치려면 아래 TOPICS 배열에 항목을 하나 추가하세요.
//
//   {
//     id: 'snack',                          // 고유 이름 (기억 저장 키로도 쓰임)
//     type: 'yesno',                        // 대답 방식: 'mood' | 'yesno' | 'choice' | 'free' | 'muse'(혼잣말, 대답 없음)
//     when: (c) => c.hour >= 14,            // (선택) 이 조건일 때만 물어봄
//     ask: '간식 먹었어?',                   // 질문 — 문자열, 배열(질문은 랜덤 1개 / 혼잣말은 차례대로), 또는 (c) => …
//     options: [...],                       // type 'choice' 일 때 보기 (☝ 1 / ✌ 2 / 🤟 3)
//     reply: {                              // 대답별 아이의 반응 — 줄 배열, 각 줄은 '문장' 또는 ['문장', '표정']
//       yes: [['맛있었어?', 'happy']],
//       no:  ['나중에 꼭 먹어!'],
//     },
//     remember: (ans, c) => ({ snack: ans.kind }),   // (선택) 다음 방문 때 기억할 것
//   }
//
// 표정: neutral curious wonder surprised happy smile shy sleepy sad thinking squeeze
// 줄 안의 {name} → 아이 이름, {you} → 내가 키보드로 적은 말(짧게), {n} → 오늘 물결 수

/* ───────────────────────── 질문 목록 ───────────────────────── */
export const TOPICS = [
  // ── 오늘 / 어제 / 계획 ──
  {
    id: 'today', type: 'mood',
    ask: (c) => (c.hour >= 18 ? '오늘 하루는 어땠어?' : '오늘은 어때?'),
    reply: {
      good: [['정말? 다행이다!', 'happy'], '네가 좋으면, 나도 물결이 반짝반짝해.'],
      soso: [['그럭저럭이구나…', 'thinking'], '그런 날도 있지. 그럼 여기서 조금 쉬다 가.'],
      bad: [['…힘들었구나.', 'sad'], ['내가 할 수 있는 건 별로 없지만…', 'sad'], ['여기 잠깐 있다 가. 물결 소리 들려줄게.', 'smile']],
      text: [['{you}…', 'thinking'], '그렇구나. 말해 줘서 고마워.'],
    },
    remember: (a) => ({ lastMood: a.kind === 'text' ? a.sent ?? 'soso' : a.kind }),
  },
  {
    id: 'yesterday', type: 'mood',
    when: (c) => c.days === 1,
    ask: (c) => (c.mem.plan ? `어제 '${c.mem.plan}' 한다고 했잖아. 어땠어?` : '어제는 어땠어?'),
    reply: {
      good: [['우와, 좋았구나!', 'happy'], '어제의 너도, 오늘의 너도 좋아.'],
      soso: [['음… 평범한 하루였구나.', 'smile'], '평범한 게 제일 어려운 거래. 어디서 들었더라?'],
      bad: [['어제 많이 힘들었어?', 'sad'], ['그래도 오늘 다시 와 줬잖아.', 'smile']],
      text: [['어제 {you}…', 'thinking'], '나는 어제 계속 잠만 잤어. 꿈에 네가 나왔나?'],
    },
  },
  {
    id: 'lastBad', type: 'mood',
    when: (c) => c.days >= 1 && c.mem.lastMood === 'bad',
    ask: '지난번엔 좀 힘들어 보였는데… 오늘은 괜찮아?',
    reply: {
      good: [['다행이다…!', 'happy'], '계속 마음에 걸렸거든.'],
      soso: [['조금은 나아졌어?', 'curious'], '천천히 괜찮아지면 돼.'],
      bad: [['아직 힘들구나…', 'sad'], ['그럼 오늘은 내가 옆에 있을게. 아무것도 안 해도 돼.', 'smile']],
      text: ['그랬구나…', ['말해 줘서 고마워.', 'smile']],
    },
    remember: (a) => ({ lastMood: a.kind === 'text' ? a.sent ?? 'soso' : a.kind }),
  },
  {
    id: 'plan', type: 'choice',
    when: (c) => c.hour < 18,
    ask: ['오늘은 뭐 하면서 하루를 보낼 거야?', '오늘은 어떤 걸 하며 지낼 예정이야?'],
    options: [
      { label: '공부·일', words: /공부|일|회사|학교|과제|숙제|출근|업무|시험|작업|코딩|개발/ },
      { label: '놀기·쉬기', words: /놀|쉬|게임|영화|드라마|산책|여행|친구|잠|자|낮잠|운동/ },
      { label: '아직 모르겠어', words: /몰라|모르|글쎄|아직|그냥/ },
    ],
    reply: {
      0: [['열심히 하는구나!', 'wonder'], '머리 아프면 나 보러 와. 물결 보면 좀 나아질 거야.'],
      1: [['좋겠다~!', 'happy'], '나도 데려가 줘. …아, 나는 여기서 못 나가지.'],
      2: [['정해진 게 없는 날이구나.', 'smile'], '그런 날이 제일 자유로운 날이야.'],
      text: [["'{you}'… 멋지다!", 'wonder'], '나중에 어땠는지 꼭 말해 줘.'],
    },
    remember: (a) => ({ plan: a.text ? short(a.text) : ['공부랑 일', '쉬기', null][a.kind] }),
  },
  {
    id: 'tonight', type: 'choice',
    when: (c) => c.hour >= 18 || c.hour < 4,
    ask: '오늘은 뭐 하면서 보냈어?',
    options: [
      { label: '공부·일', words: /공부|일|회사|학교|과제|숙제|업무|시험|작업|코딩|개발/ },
      { label: '놀았어', words: /놀|게임|영화|드라마|친구|여행|산책|운동/ },
      { label: '그냥 쉬었어', words: /쉬|잠|잤|누워|그냥|아무것도/ },
    ],
    reply: {
      0: [['하루 종일? 수고 많았어.', 'sad'], ['오늘 하루 정말 잘했어.', 'smile']],
      1: [['재밌었겠다!', 'happy'], '나도 언젠가 놀러 가 보고 싶어.'],
      2: [['쉬는 것도 중요해.', 'smile'], '물결도 가끔은 가만히 있어야 예쁘거든.'],
      text: [["'{you}'… 그렇구나!", 'wonder'], '내일도 이야기해 줘.'],
    },
    remember: (a) => ({ plan: a.text ? short(a.text) : null }),
  },

  // ── 몸과 마음 ──
  {
    id: 'meal', type: 'yesno',
    ask: (c) => `${c.meal} 먹었어?`,
    reply: {
      yes: [['잘했어!', 'happy'], '뭐 먹었어? …아, 나는 맛을 모르지만 궁금해.'],
      no: [['안 먹었어?', 'surprised'], ['꼭 챙겨 먹어. 배고프면 물결도 슬퍼 보여.', 'sad']],
      maybe: ['조금은 먹었구나. 그래도 다행이야.'],
      text: [['{you}!', 'wonder'], '맛있었겠다…'],
    },
  },
  {
    id: 'sleep', type: 'yesno',
    when: (c) => c.hour >= 5 && c.hour < 13,
    ask: '어젯밤엔 잘 잤어?',
    reply: {
      yes: [['다행이다~', 'happy'], '나도 잘 잤어. 꿈에서 커다란 물방울을 봤어.'],
      no: [['못 잤어?', 'sad'], ['오늘은 일찍 자. 내가 조용히 있을게.', 'smile']],
      maybe: ['그럭저럭이구나. 오늘 밤엔 푹 자길.'],
    },
  },
  {
    id: 'tired', type: 'yesno',
    ask: '요즘 피곤하지는 않아?',
    reply: {
      yes: [['역시…', 'sad'], ['잠깐 눈 감고 숨 한 번 쉬어 볼래? 나도 같이 할게.', 'sleepy']],
      no: [['그럼 다행이야!', 'happy'], '나는 가끔 졸려. 물결이 자장가 같거든.'],
      maybe: ['조금 피곤하구나. 무리하지 마.'],
    },
  },
  {
    id: 'weather', type: 'choice',
    ask: '밖에 날씨는 어때? 나는 여기서 물결밖에 못 봐서.',
    options: [
      { label: '맑아', words: /맑|해|화창|좋아|따뜻/ },
      { label: '흐려·비', words: /흐|비|구름|눈|우중충/ },
      { label: '춥거나 더워', words: /추|더|덥|쌀쌀|바람/ },
    ],
    reply: {
      0: [['해가 떴구나!', 'happy'], '해는 어떻게 생겼어? 엄청 큰 물방울 같아?'],
      1: [['비가 와?', 'wonder'], '그럼 세상 전부가 톡톡 물결이겠다. 부럽다…'],
      2: [['감기 조심해!', 'surprised'], '나는 물이라서, 추우면 얼어 버릴지도 몰라.'],
      text: [["'{you}'… 그런 날씨구나.", 'thinking'], '언젠가 직접 보고 싶다.'],
    },
  },

  // ── 너에 대해 ──
  {
    id: 'likes', type: 'free',
    ask: '너는 뭘 좋아해?',
    reply: {
      text: [["'{you}'!", 'wonder'], ['기억해 둘게. 다음에 또 물어볼 거야.', 'smile']],
      none: ['말하기 어려우면 괜찮아. 나는 네 손가락이 좋아.'],
    },
    remember: (a) => (a.text ? { likes: short(a.text) } : {}),
  },
  {
    id: 'likesAgain', type: 'yesno',
    when: (c) => !!c.mem.likes,
    ask: (c) => `지난번에 '${c.mem.likes}' 좋아한다고 했지? 요즘도 좋아해?`,
    reply: {
      yes: [['역시!', 'happy'], '좋아하는 게 계속 좋은 건 멋진 일이야.'],
      no: [['바뀌었구나.', 'surprised'], '그럼 요즘은 뭐 좋아해? …다음에 알려 줘.'],
      maybe: ['헤헤, 그럴 때도 있지.'],
    },
  },
  {
    id: 'dream', type: 'free',
    ask: '너는 꿈이 뭐야? 커서 되고 싶은 거.',
    reply: {
      text: [["'{you}'…", 'wonder'], ['멋지다. 나는 그 꿈 응원할게.', 'happy']],
      none: [['아직 모르겠구나.', 'smile'], '나도 몰라. 우리 같이 찾아보자.'],
    },
    remember: (a) => (a.text ? { dream: short(a.text) } : {}),
  },
  {
    id: 'friend', type: 'yesno',
    ask: '있잖아… 나 말고 다른 친구도 있어?',
    reply: {
      yes: [['그렇구나…', 'thinking'], ['조금 질투 나. 히히, 농담이야.', 'smile']],
      no: [['그럼…', 'shy'], ['내가 친구 할게!', 'happy']],
      maybe: ['헤헤, 그럼 나는 친구 후보 1번이야.'],
    },
  },
  {
    id: 'secret', type: 'yesno', mood: 'shy',
    ask: '비밀 하나 알려 줄까?',
    reply: {
      yes: [['사실은…', 'shy'], ['네가 안 올 때, 혼자 물결 세면서 기다려.', 'shy'], ['…아무한테도 말하면 안 돼!', 'happy']],
      no: [['치…', 'sad'], ['나중에 궁금해도 안 알려 줄 거야.', 'smile']],
      maybe: ['그럼 다음에 알려 줄게. 꼭 물어봐야 해.'],
    },
  },
  {
    id: 'game', type: 'yesno', mood: 'happy',
    ask: '우리 가위바위보 할래?',
    reply: {
      yes: [['좋아!', 'happy']],
      no: [['힝…', 'sad'], '그럼 다음에 하자.'],
      maybe: [['그럼 한 판만!', 'happy']],
    },
    then: { yes: 'rps', maybe: 'rps' },
  },

  // ── 혼잣말 (대답 없음) ──
  { id: 'muse1', type: 'muse', ask: ['있잖아, 물결은 왜 동그랄까?', '…네모난 물결은 없을까?'] },
  { id: 'muse2', type: 'muse', ask: (c) => [`오늘 물결 세어 봤는데, ${c.n}번이었어.`, c.n > 10 ? '네가 많이 놀아 줬네!' : '내일은 더 많이 만들자.'] },
  { id: 'muse3', type: 'muse', ask: ['너 손가락 다섯 개지?', '나는 눈이 두 개야.', '합치면… 일곱! 헤헤.'] },
  { id: 'muse4', type: 'muse', ask: ['나는 잠들면 어디로 가는 걸까…', '물 밑에는 뭐가 있을까?'] },
  { id: 'muse5', type: 'muse', when: (c) => c.hour >= 22 || c.hour < 5, ask: ['벌써 밤이네.', '오늘 하루도 정말 수고했어.'] },
  { id: 'muse6', type: 'muse', ask: ['{name}… 내 이름, 아직도 좀 신기해.', '네가 지어 준 거나 마찬가지야.'] },
];

/* ───────────────────────── 대답 방법 안내 ───────────────────────── */
export const HINTS = {
  mood: '👍 좋아   ✋ 그저 그래   👎 별로',
  yesno: '👍 응   👎 아니',
  free: '⏎ Enter 를 눌러 적어 주세요',
};
export const hintFor = (topic) =>
  (topic.type === 'choice' ? topic.options.map((o, i) => `${['☝', '✌', '🤟'][i]} ${o.label}`).join('    ') : HINTS[topic.type] || '')
  + (topic.type !== 'free' ? '    ·    ⏎ 직접 말하기' : '');

/* ───────────────────────── 말 이해하기 (아주 작은 규칙 기반) ───────────────────────── */
const POS = /좋|행복|재밌|재미있|즐거|신나|최고|괜찮|기뻐|기쁘|설레|맛있|사랑|굿|good|ㅎㅎ|ㅋㅋ|굳|대박|완벽|편안|상쾌|뿌듯/;
const NEG = /힘들|피곤|슬퍼|슬프|우울|별로|싫|짜증|아파|아프|지쳐|지친|졸려|외로|걱정|스트레스|화나|화가|최악|망했|ㅠ|ㅜ|bad|불안|무서|속상/;
const SOSO = /그냥|그럭저럭|보통|몰라|글쎄|쏘쏘|soso|평범|무난/;
const YES = /^(응|어|네|예|웅|엉|그래|좋아|ㅇㅇ|당연|물론|맞아|yes|ok|오케|그럼|먹었|잤|했)/i;
const NO = /^(아니|아뇨|ㄴㄴ|싫어|안|못|no|nope)|안\s?(먹|잤|했)|못\s?(먹|잤|했)/i;
const RPS = [['rock', /바위|주먹|묵/], ['scissors', /가위|찌/], ['paper', /보|빠|보자기/]];

export function understand(text) {
  const t = (text || '').trim();
  const sent = NEG.test(t) ? 'bad' : POS.test(t) ? 'good' : SOSO.test(t) ? 'soso' : null;
  const yes = NO.test(t) ? false : YES.test(t) ? true : null;
  const rps = RPS.find(([, re]) => re.test(t))?.[0] ?? null;
  return { text: t, sent, yes, rps, question: /\?|까$|니$|어\?|야\?|뭐|왜|어떻게|누구|언제|어디/.test(t) };
}

export const short = (s) => {
  const t = (s || '').replace(/[.!?~…]+$/g, '').trim();
  return t.length > 14 ? t.slice(0, 13) + '…' : t;
};

// 키보드로 그냥 말을 걸었을 때 (질문 중이 아닐 때) — [문장, 표정] 배열 반환
const FREE = [
  [/^(안녕|하이|hi|hello|ㅎㅇ|반가)/i, [['안녕! 또 만났네.', 'happy']]],
  [/이름|누구야|넌 누구|너는 누구/, [['나는 {name}!', 'happy'], '네가 이름을 찾아 줬잖아.']],
  [/사랑해|좋아해|귀여|예뻐|이뻐/, [['에, 에…?', 'shy'], ['…나도.', 'shy']]],
  [/고마워|고맙|감사/, [['헤헤, 내가 더 고마워.', 'smile']]],
  [/미안/, [['괜찮아. 진짜 괜찮아.', 'smile']]],
  [/바보|멍청|못생/, [['…힝.', 'sad'], ['그래도 나는 너 좋아.', 'smile']]],
  [/잘\s?자|굿\s?나잇|자러/, [['벌써 자?', 'sad'], ['잘 자. 꿈에서 만나.', 'sleepy']]],
  [/배고|밥|먹/, [['나도 배고파!', 'happy'], '…근데 나는 뭘 먹지? 물결?']],
  [/졸려|졸리|피곤/, [['졸리구나…', 'sleepy'], '잠깐 눈 감아. 내가 지켜볼게.']],
  [/공부|시험|과제|숙제/, [['공부하는구나.', 'wonder'], '머리 아프면 나 한 번 톡 해. 기분 전환!']],
  [/회사|일|출근|퇴근|야근|업무/, [['일하는 거 힘들지?', 'sad'], ['오늘도 수고 많았어.', 'smile']]],
  [/게임/, [['게임?', 'wonder'], ['나랑도 해! 가위바위보 잘해.', 'happy']]],
  [/코딩|개발|프로그래밍|코드/, [['코딩?', 'surprised'], '…나를 만든 것도 그거야? 신기하다.']],
  [/비|눈|날씨|추워|더워|덥/, [['밖은 그렇구나.', 'thinking'], '여기는 언제나 고요한 물결뿐이야.']],
  [/심심/, [['심심해?', 'curious'], ['그럼 가위바위보 하자!', 'happy']], 'rps'],
  [/가위바위보/, [['좋아!', 'happy']], 'rps'],
  [/친구/, [['친구!', 'happy'], '나도 너의 친구야. 맞지?']],
  [/외로|쓸쓸|혼자/, [['…', 'sad'], ['혼자 아니야. 여기 내가 있잖아.', 'smile']]],
];
const FALLBACK = {
  good: [[['좋은 일이 있었구나!', 'happy'], '나까지 기분 좋아졌어.']],
  bad: [[['…그랬구나.', 'sad'], ['여기 잠깐 쉬다 가.', 'smile']]],
  question: [[['음…', 'thinking'], '나는 아직 모르는 게 많아. 네가 알려 줄래?'], [['글쎄…?', 'curious'], '물결한테 물어볼까?']],
  none: [[['{you}…', 'thinking'], '더 얘기해 줘.'], [['그렇구나!', 'wonder']], [['응응.', 'smile'], '듣고 있어.']],
};
export function freeReply(text) {
  const u = understand(text);
  for (const [re, lines, then] of FREE) if (re.test(u.text)) return { lines, then };
  const pool = u.sent === 'good' ? FALLBACK.good : u.sent === 'bad' ? FALLBACK.bad : u.question ? FALLBACK.question : FALLBACK.none;
  return { lines: pool[(Math.random() * pool.length) | 0] };
}

/* ───────────────────────── 어떤 질문을 할까 ───────────────────────── */
export function pickTopic(c, asked) {
  const ok = TOPICS.filter((t) => !asked.has(t.id) && (!t.when || t.when(c)));
  if (!ok.length) return null;
  // 기억에 기반한 질문을 먼저 (어제/지난번/좋아하는 것)
  const first = ok.find((t) => ['lastBad', 'yesterday', 'likesAgain'].includes(t.id));
  if (first) return first;
  // 처음 만난 날엔 '오늘'부터
  const today = ok.find((t) => t.id === 'today' || t.id === 'tonight');
  if (today && asked.size === 0) return today;
  // 질문과 혼잣말이 번갈아 나오도록
  const lastMuse = c.lastWasMuse;
  const pool = ok.filter((t) => (lastMuse ? t.type !== 'muse' : true));
  return (pool.length ? pool : ok)[(Math.random() * (pool.length || ok.length)) | 0];
}

export const fill = (s, c) => s.replace(/\{name\}/g, c.name || '나').replace(/\{you\}/g, c.you || '').replace(/\{n\}/g, String(c.n ?? 0));
export const lines = (x, c) => (typeof x === 'function' ? x(c) : x);
