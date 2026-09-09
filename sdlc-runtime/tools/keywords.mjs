/** English artifact contract keywords and Korean aliases. Accept both regardless of profile.lang. */

/** Remove whitespace and lowercase so spacing and case variants compare equally. */
const squash = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase()
/** Return true when the value contains an alias. Used for markers and labels. */
export const hasAlias = (text, aliases) => aliases.some((a) => squash(text).includes(squash(a)))
/** Return true when the value equals an alias. Used for CLI arguments. */
export const isAlias = (text, aliases) => aliases.some((a) => squash(text) === squash(a))
/** Return the canonical value for an alias, or null. */
export const canonical = (text, table) =>
  Object.entries(table).find(([, aliases]) => isAlias(text, aliases))?.[0] ?? null

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Field-key aliases. WP fields use English keys. */
export const FIELD = {
  basis: ['basis', '근거'],
  acceptance: ['acceptance', '수용 기준'],
}

/** Markers for required sections and applicable tiers. */
export const MARKER = {
  conditional: ['conditional', '조건부'],
  optional: ['optional', '선택'],
  allTiers: ['all tiers', '모든 티어'],
}

/** Task results used by plan-check --result and execution-log entries. */
export const RESULT = {
  done: ['done', '완료'],
  partial: ['partial', '부분'],
  failed: ['failed', '실패'],
}

/** Deviation labels in execution-log entries, read by mark when grouping entries. */
export const DIVERGENCE = ['differs from plan', '계획과의 차이']
/** Values that indicate no deviation, allowing task IDs to share the day's preceding entry. */
export const NO_DIVERGENCE = ['none', '없음', 'N/A']
/** Placeholder used until /create-pr replaces it with a PR link. */
export const NO_PR = ['no PR', 'PR 없음']

/** Marker for an open question that blocks progress. */
export const BLOCKED = ['blocked', '막힘']
/** Marker for the selected ADR alternative. */
export const CHOSEN = ['chosen', '채택']

/** Section-title aliases for the two plan sections and five ADR sections parsed as text. */
export const SECTION = {
  executionLog: ['Execution log', '실행 기록'],
  releaseImpact: ['Release impact', '릴리스 영향'],
  decision: ['Decision', '결정'],
  forces: ['Context and forces', '문맥과 결정 요인'],
  alternatives: ['Alternatives', '대안'],
  consequences: ['Consequences', '결과'],
  revisit: ['Review and revisit', '확인과 재검토'],
}

/** Match a section from `## <name>` to the next `##`, accepting every alias. */
export const sectionBlock = (aliases) =>
  new RegExp(`##\\s*(?:${aliases.map(esc).join('|')})[\\s\\S]*?(?=\\n##\\s|\\n*$)`)
/** Match a single `## <name>` heading. */
export const sectionHeading = (aliases) =>
  new RegExp(`^##\\s*(?:${aliases.map(esc).join('|')}).*$`, 'm')

/** Reason-bearing notation used to omit a required section. */
export const RE_NA = /^\s*(?:N\/A|해당\s*없음)/i
export const RE_NA_WITH_BASIS = /(?:N\/A|해당\s*없음)\s*[—–-]\s*\S/i

/** Convert an alias to a regular-expression fragment with optional interword whitespace. */
const loose = (aliases) => aliases.map((a) => esc(a).replace(/\\?\s+/g, '\\s*')).join('|')

/** Notation that explains why dismissing a finding does not adjust the band. */
export const BAND_ADJUSTMENT = ['band adjustment', '밴드 조정']
export const NO_ADJUSTMENT = ['no adjustment', '조정 없음']
export const RE_BAND_NO_CHANGE = new RegExp(
  `(?:${loose(BAND_ADJUSTMENT)})\\s*:\\s*«?\\s*(?:${loose(NO_ADJUSTMENT)})\\s*[—–-]\\s*\\S`, 'i')
