/** 계약 낱말 — 검사기가 «읽는» 글자의 전부.
 *
 * 산출물에서 사람이 쓰는 말은 자유고, 여기 적힌 것만 기계가 본다. 절 제목조차 자유다 — 구조는
 * ID 접두(OUT-·FR-·AC-)와 티어 표식으로 판정하므로, 이 파일이 곧 «언어에 묶인 표면» 의 전체 목록이다.
 *
 * **영어가 정본이고 한국어는 별칭이다. 둘 다 언제나 받는다.**
 * 프로필의 `lang` 과 무관하다 — lang 은 문체 검사의 기준을 고르는 키이지 계약을 고르는 키가 아니다.
 * 계약을 lang 으로 가르면 한국어 레포의 문서를 영어 레포에서 못 읽고, 이행기에 섞인 사슬이 통째로
 * 막힌다. 별칭으로 두면 기존 문서를 한 글자도 안 고쳐도 되고, 두 낱말이 같은 뜻이라는 사실이
 * 이 파일 한 곳에만 적힌다.
 */

/** 공백을 없애고 소문자로. `모든 티어`·`모든티어`, `All Tiers`·`all tiers` 를 같게 본다. */
const squash = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase()
/** 별칭 중 하나라도 들어 있으면 참. 표식·라벨처럼 «포함» 으로 판정하는 자리에 쓴다. */
export const hasAlias = (text, aliases) => aliases.some((a) => squash(text).includes(squash(a)))
/** 별칭 중 하나와 같으면 참. CLI 인자처럼 «일치» 로 판정하는 자리에 쓴다. */
export const isAlias = (text, aliases) => aliases.some((a) => squash(text) === squash(a))
/** 별칭을 정본으로 되돌린다. 없으면 null. */
export const canonical = (text, table) =>
  Object.entries(table).find(([, aliases]) => isAlias(text, aliases))?.[0] ?? null

/** 항목의 필드 키. `근거:` 처럼 줄 앞에 선다. WP 필드(files·depends·covers·tests·verify)는 처음부터 영어다. */
export const FIELD = {
  basis: ['basis', '근거'],
  acceptance: ['acceptance', '수용 기준'],
}

/** 절의 필수 여부를 정하는 표식. `[required · all tiers]` · `[필수 · 모든 티어]`.
 *  standard+ 와 full 은 티어 이름이라 처음부터 영어다. */
export const MARKER = {
  conditional: ['conditional', '조건부'],
  optional: ['optional', '선택'],
  allTiers: ['all tiers', '모든 티어'],
}

/** 작업 결과. plan-check --result 와 §실행 기록의 줄에 함께 쓴다. */
export const RESULT = {
  done: ['done', '완료'],
  partial: ['partial', '부분'],
  failed: ['failed', '실패'],
}

/** 열린 질문이 진행을 막는다는 표시. */
export const BLOCKED = ['blocked', '막힘']
/** ADR 대안 중 채택안 표시. */
export const CHOSEN = ['chosen', '채택']

/** 절 제목을 문자열로 찾는 자리 — plan 의 두 절과 ADR 의 다섯 절뿐이다. */
export const SECTION = {
  executionLog: ['Execution log', '실행 기록'],
  releaseImpact: ['Release impact', '릴리스 영향'],
  decision: ['Decision', '결정'],
  forces: ['Context and forces', '문맥과 결정 요인'],
  alternatives: ['Alternatives', '대안'],
  consequences: ['Consequences', '결과'],
  revisit: ['Review and revisit', '확인과 재검토'],
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** `## <절 이름>` 부터 다음 `##` 앞까지. 별칭 전부를 받는다. */
export const sectionBlock = (aliases) =>
  new RegExp(`##\\s*(?:${aliases.map(esc).join('|')})[\\s\\S]*?(?=\\n##\\s|\\n*$)`)
/** `## <절 이름>` 줄 하나. */
export const sectionHeading = (aliases) =>
  new RegExp(`^##\\s*(?:${aliases.map(esc).join('|')}).*$`, 'm')

/** 필수 절을 «정말 없다» 로 면제하는 말. 근거를 요구하는 것이 요점이라 두 형태를 함께 본다. */
export const RE_NA = /^\s*(?:N\/A|해당\s*없음)/i
export const RE_NA_WITH_BASIS = /(?:N\/A|해당\s*없음)\s*[—–-]\s*\S/i

/** ADR 의 결과 절이 대가를 말하는지. 여기만 낱말 목록이 문체 쪽에 가깝다 — lang 번들로 옮길 후보다. */
export const RE_TRADEOFF = /감수|대가|비용|포기|제약을 진다|trade-?off|cost|give up|sacrifice/i
/** 재검토 조건이 기한일 뿐인지. 위와 같은 이유로 번들 후보다. */
export const RE_DEADLINE_ONLY = /\d\s*(?:개월|달|주|분기|년|months?|weeks?|quarters?|years?)|다음 분기|next quarter|뒤에 재검토|정기 검토|periodic review/i
