/** Korean prose rules and length limits based on measured Korean artifacts. */
import * as EN from './en.mjs'

/** Detect Korean documents. Report other languages as lang-unsupported. */
export const script = {
  test: /[가-힣]/g,
  against: /[A-Za-z]/g,
  minRatio: 0.3,
  /** Skip short documents because their language ratio is unstable. */
  minChars: 200,
  name: '한국어',
}

export const acSentence = /(?:다|다\.)$/

/** Substrings, so a word list entry also matches inside a longer word. 되도록 is the one entry where
 *  that turned a precise sentence red: the adverb («되도록 한 번에») is vague, but «기록되도록» ·
 *  «저장되도록» (the passive 되다) and «완료가 되도록» · «0 이 되도록» (a purpose clause) say exactly
 *  what happens. The pattern takes 되도록 only where it starts a word and does not follow 이 · 가 ·
 *  게 · 안. Lines with numbers and code spans are exempt, as in every bundle. */
export const vague = ['빠르게', '빠른', '신속', '적절히', '적절한', '적당히', '쉽게', '편하게',
  '간편하', '사용하기 쉬', '최적화', '개선한다', '개선된다', '향상', '안정적', '효율적',
  '유연하', '확장 가능', '충분히', '대부분', '종종', '가능한 한', /(?<![가-힣])(?<!(?:[이가게]|안)\s)되도록/, '원활',
  '매끄럽', '직관적', '깔끔', '잘 동작', '문제없', '등등']

export const translationese = [
  ['되어지', '이중 피동이다. «되다» 하나면 된다'],
  ['지게 된다', '이중 피동이다. «된다» 로 충분하다'],
  ['에 있어서', '«~에서» 나 «~할 때»'],
  ['에 의해', '누가 하는지를 주어로 세운다 — «A 에 의해 처리된다» → «A 가 처리한다»'],
  ['에 의하여', '누가 하는지를 주어로 세운다'],
  ['필요로 한다', '«~이 필요하다»'],
  ['을 가진다', '«~이 있다»'],
  ['를 가진다', '«~이 있다»'],
  ['을 갖는다', '«~이 있다»'],
  ['를 갖는다', '«~이 있다»'],
  ['제공한다', '«~한다» 로 바로 쓴다 — «검색 기능을 제공한다» → «검색한다»'],
  ['수행한다', '«~한다» 로 바로 쓴다'],
  ['라고 할 수 있다', '«~이다»'],
  ['가능하게 한다', '«~할 수 있다»'],
  ['로 하여금', '주어를 바꿔 쓴다'],
]

export const meta = [
  [/이 문서(는|에서는)[^.\n]{0,40}(설명|기술|정의|다룬다|살펴|소개)/, '문서가 자기를 설명한다. 내용을 바로 쓴다'],
  [/본 문서/, '«이 문서» 도 대개 필요 없다'],
  [/(아래에서는|위에서 설명|앞서 언급|앞에서 살펴|다음 절|이 절에서는|이 장에서는)/, '차례를 서술하지 않는다 — 제목이 이미 그 일을 한다'],
  [/참고로,/, '본문이면 그냥 쓰고, 아니면 뺀다'],
]

export const budget = {
  intent: { doc: 1200, section: 500, entity: 250 },
  spec: { doc: 2000, section: 800, entity: 400 },
  plan: { doc: 3000, section: 1200, entity: 350 },
  finding: { doc: 2000, section: 600, entity: 250 },
  /** Do not apply risk-tier multipliers to ADRs. */
  adr: { doc: 2600, section: 900, entity: 400 },
  /** Research takes no tier multiplier either: evidence carries no risk tier. The budgets are the
   *  spec's, not the intent's: a source is quoted with what it measured, and a data table sits in
   *  prose lines. Fenced blocks — diagrams, excerpts, benchmark output — are outside every budget,
   *  so the budget prices only what was written about the material, never the material itself. */
  research: { doc: 4000, section: 1200, entity: 400 },
}

/** Limits for titles, fields, and sentence counts based on Korean text density.
 * `logNote` is an execution-log deviation note. It sits between `ac` and `field` because the line
 * is scanned in a list: only what differed and how. Cause, attempts and log excerpts already live
 * in the commit message and the verify log, and copying them here is what makes the section grow. */
export const limits = { sentences: 4, title: 40, field: 200, ac: 100, logNote: 120 }

/** Detect whether an ADR consequences section names a cost. «받아들인 제약» is the phrase
 *  `references/adr.md` itself uses, and it failed because only «제약을 진다» was listed. The
 *  template's label «감수하는 제약:» is matched by 감수. Left out on purpose, because a gain is
 *  phrased with them as often as a cost: 못 한다 · 불가 («자격 없는 그룹은 조회하지 못한다»),
 *  더 이상 («더 이상 손으로 밀어 넣지 않는다»), 부담 («운영 부담이 줄어든다»). With them in, the
 *  seeded costless decision would pass. English words are accepted too, as before. */
export const tradeoff = new RegExp(`감수|대가|비용|포기|제약|단점|잃는|잃게|느려|손해|희생|맞바꾸|맞바꾼|맞바꿨|${EN.tradeoff.source}`, 'i')
/** Detect revisit conditions that specify only a deadline: a review verb after a point in time, or a
 *  point in time on its own. «적재 오류율이 3주 연속 1% 를 넘는다» holds a duration as part of what is
 *  measured and is a condition; the rule once matched any digit followed by a unit and warned on it.
 *  The English shapes are accepted too, as before. */
const N = '(?:\\d+|한|두|세|네|다섯|여섯|아홉|열두|몇)'
const UNIT = '(?:개월|달|주일?|분기|반기|년|해|일)'
const WHEN = `(?:${N}\\s*${UNIT}\\s*(?:뒤|후|마다|[이가]\\s*지나|[이가]\\s*지난|경과)|반년\\s*(?:뒤|후|마다)|(?:다음|내년|이번|매)\\s*(?:분기|반기|해|달|주|년|스프린트|릴리스)|분기마다|매년|매달)`
const REVIEW = '(?:재검토|검토|다시\\s*(?:본|보|연|열)|재평가|점검|돌아본)'
export const deadlineOnly = new RegExp(
  `${WHEN}[^.]{0,30}?${REVIEW}|${REVIEW}[^.]{0,30}?${WHEN}|^\\s*${WHEN}\\s*\\.?\\s*$|(?:정기|주기적(?:으로)?)\\s*(?:재?검토|점검)|${EN.deadlineOnly.source}`, 'i')

/** Text written to artifacts when profile.lang is ko. */
export const written = {
  adrIndex: {
    title: '제목', status: '상태', legacy: '옛 형식', heading: '결정 로그',
    comment: '<!-- adr-index.mjs 가 만든다. 손으로 고치지 않는다 — 고치면 파일과 표가 갈리고,\n     믿을 것은 파일 쪽인데 사람이 보는 것은 표 쪽이 된다. -->',
    summary: (total, live, legacy) => `결정 ${total}장 · 효력 있는 것 ${live}장.${legacy ? ` 옛 형식 ${legacy}장은 H1 과 헤더 표에서 읽었다 — 프런트매터를 더하면 scope 도 선다.` : ''}`,
    live: '효력 있는 결정', past: '지나간 결정', empty: '아직 없다.',
    history: '대체·폐기·기각된 것. **번호는 재사용하지 않으므로 자리를 물고 남는다** — 같은 논의가 다시\n열리면 이 표가 «전에 왜 그렇게 정했나» 와 «왜 뒤집었나» 의 답이다.',
  },
  result: { done: '완료', partial: '부분', failed: '실패' },
  divergence: '계획과의 차이',
  none: '없음',
  noPr: 'PR 없음',
  // The title `plan-check mark` writes when the plan has no execution-log section yet. It must
  // stay one of SECTION.executionLog's aliases, or the section the tool creates would be invisible
  // to the `completed` rule and to the long-log linter — a section nobody but its author can read.
  executionLog: '실행 기록',
}
