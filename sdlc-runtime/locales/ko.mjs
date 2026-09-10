/** Korean prose rules and length limits based on measured Korean artifacts. */

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

export const vague = ['빠르게', '빠른', '신속', '적절히', '적절한', '적당히', '쉽게', '편하게',
  '간편하', '사용하기 쉬', '최적화', '개선한다', '개선된다', '향상', '안정적', '효율적',
  '유연하', '확장 가능', '충분히', '대부분', '종종', '가능한 한', '되도록', '원활',
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
  /** Research takes no tier multiplier either: evidence carries no risk tier. The item budget is
   *  the intent's — a source that needs a long paragraph is being summarized, not cited. */
  research: { doc: 2500, section: 800, entity: 250 },
}

/** Limits for titles, fields, and sentence counts based on Korean text density.
 * `logNote` is an execution-log deviation note. It sits between `ac` and `field` because the line
 * is scanned in a list: only what differed and how. Cause, attempts and log excerpts already live
 * in the commit message and the verify log, and copying them here is what makes the section grow. */
export const limits = { sentences: 4, title: 40, field: 200, ac: 100, logNote: 120 }

/** Detect whether an ADR consequences section names a cost. */
export const tradeoff = /감수|대가|비용|포기|제약을 진다|trade-?off|cost|give up|sacrifice/i
/** Detect revisit conditions that specify only a deadline. */
export const deadlineOnly = /\d\s*(?:개월|달|주|분기|년|months?|weeks?|quarters?|years?)|다음 분기|next quarter|뒤에 재검토|정기 검토|periodic review/i

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
