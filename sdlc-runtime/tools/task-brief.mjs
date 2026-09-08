#!/usr/bin/env node
/** 작성 에이전트에게 줄 프롬프트를 **plan 과 spec 에서 뽑아** 만든다.
 *
 *  작성 에이전트의 정확도는 프롬프트의 정확도다. 모델이 spec.md 에서 AC 를 골라 옮겨 적고
 *  규칙 경로를 눈으로 대조하면 AC 누락·오타·규칙 누락이 거기서 난다. 여기서는 그 셋을
 *  결정론으로 뽑고 템플릿에 채운다.
 *
 *    node task-brief.mjs <스펙 폴더> <WP-id> [--worktree <경로>] [--snippets <파일>] [--template <경로>]
 *
 *  템플릿의 자리표시자: {task_id} {task_title} {spec_dir} {worktree} {bootstrap} {files} {requirements}
 *  {tests} {rules} {verify} {snippets} {decisions} {parallel_note}. 템플릿은 런타임 `references/writer-prompt.md`
 *  하나다 — 여기 내장본을 두면 정본이 둘이 된다.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDir, levelsOf, wpFiles, wpField, frontmatter, loadAdrDir } from './artifact-parse.mjs'
import { adrSeam, adrDigest, adrsForFiles } from './adr-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null }
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))
const DIR = resolve(positional[0] ?? '.')
const TASK = positional[1]
/** 템플릿은 런타임의 `references/writer-prompt.md` 하나다 — 벤더한 레포는 그 사본을 쓰므로
 *  팀이 같은 프롬프트로 에이전트를 띄운다. `--template` 은 실험용 덮어쓰기다. */
const TEMPLATE = flag('template') ?? join(HERE, '../references/writer-prompt.md')
if (!TASK) {
  console.error('사용법: task-brief.mjs <스펙 폴더> <WP-id> [--worktree <경로>] [--snippets <파일>] [--template <경로>]')
  process.exit(2)
}
if (!existsSync(TEMPLATE)) { console.error(`템플릿이 없다 — ${TEMPLATE}`); process.exit(2) }

const docs = loadDir(DIR, () => {})
if (!docs.plan) { console.error(`plan.md 가 없다 — ${DIR}`); process.exit(2) }
const w = docs.plan.ents.get(TASK)
if (!w || w.kind !== 'wp') { console.error(`${TASK} 가 plan.md 의 작업이 아니다`); process.exit(2) }

let ROOT = null
for (let d = DIR, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
  if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { ROOT = d; break }
}
const profile = ROOT ? readFileSync(join(ROOT, '.claude/spec-profile.yml'), 'utf8') : ''
const yml = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(profile)?.[1] ?? '')
  .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()

// ── 요구사항: covers 의 FR/NFR 과 그 밑 AC 문장 전문 ─────────────────────────
/** `covers: FR-001 (AC-001, AC-002)` — 괄호 안에 AC 를 짚었으면 그것만, 아니면 그 요구사항의
 *  AC 전부. spec 이 없으면(옛 사슬) covers 줄만 그대로 싣고 그 사실을 적는다. */
const covers = wpField(w, 'covers')
const reqIds = [...covers.matchAll(/\b(FR|NFR)-\d{1,4}\b/g)].map((m) => m[0])
const acIds = new Set([...covers.matchAll(/\bAC-\d{1,4}\b/g)].map((m) => m[0]))
const reqLines = []
const missing = []
if (docs.spec) {
  const acs = [...docs.spec.ents.values()].filter((e) => e.kind === 'ac')
  for (const id of reqIds) {
    const req = docs.spec.ents.get(id)
    if (!req) { missing.push(id); continue }
    reqLines.push(`- **${id} — ${req.title}**${req.priority ? ` \`${req.priority}\`` : ''}`)
    const body = req.bodyLines.filter((l) => l.trim() && !/^\s*(근거|수용 기준)\s*:/.test(l) && !/^\s*[-*]\s+\[[ xX]\]/.test(l))
    for (const l of body) reqLines.push(`  ${l.trim()}`)
    const mine = acs.filter((a) => a.parent === id && (acIds.size === 0 || acIds.has(a.id)))
    for (const a of mine) reqLines.push(`  - [ ] ${a.id} — ${a.title}`)
    for (const id2 of acIds) if (!acs.some((a) => a.id === id2)) missing.push(id2)
  }
} else {
  reqLines.push(`- covers: ${covers}  (spec.md 가 없어 문장을 못 실었다 — 상위 문서를 직접 읽는다)`)
}
if (!reqLines.length) reqLines.push('- (covers 가 비었다 — plan.md 를 고친다)')
if (missing.length) reqLines.push(`- ⚠ spec.md 에 없는 ID: ${[...new Set(missing)].join(', ')}`)

// ── 규칙: .claude/rules/*.md 의 paths: 가 이 작업의 files 와 맞는 것 ───────────
const files = wpFiles(w)
// 글롭 → 정규식. 이중 별표 뒤에 슬래시면 «0개 이상의 디렉터리», 끝의 이중 별표는 «그 밑 전부», 별표 하나는 한 층.
const globToRe = (g) => {
  const s = g.trim()
  let re = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '*' && s[i + 1] === '*') {
      if (s[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}
const rulePaths = (fm) => {
  const v = fm?.paths
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string') return v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  return []
}
const rules = []
const rulesDir = ROOT ? join(ROOT, '.claude/rules') : null
if (rulesDir && existsSync(rulesDir)) {
  for (const f of readdirSync(rulesDir).filter((f) => f.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(join(rulesDir, f), 'utf8')) ?? {}
    const globs = rulePaths(fm)
    const hit = globs.length === 0 || globs.some((g) => { const re = globToRe(g); return files.some((p) => re.test(p)) })
    if (hit) rules.push(`- \`.claude/rules/${f}\`${globs.length ? ` (${globs.join(', ')})` : ' (전역)'}`)
  }
}

// ── 이미 정해진 것: 이 files 에 걸리는 ADR ──────────────────────────────────
/** **이 주입이 ADR 이 구현에 닿는 유일한 경로다.** 결정을 못 받은 에이전트는 그 자리에서
 *  기본값을 구현하고, 사람이 이미 기각한 안을 다시 고른다 — 리뷰에서야 드러나고 그때는
 *  왜 안 되는지 아무도 기억하지 못한다. 싣는 것은 결정 · Non-goals · 기각안 제목뿐이고
 *  전문은 링크로만 준다(§adr.md 에이전트 주입). */
const seam = { ...adrSeam(ROOT), root: ROOT }
const adrLines = []
if (seam.configured && seam.dir) {
  const all = loadAdrDir(seam.dir).docs
  const hit = adrsForFiles(all, files)
  // 사슬이 핀했는데 이 작업엔 안 걸리는 결정은 조용히 빠진다 — 그 사실을 러너에게만 알린다.
  const pinned = new Set(Object.values(docs).flatMap((d) => [].concat(d.fm?.decisions ?? []).map(String))
    .filter((p) => !p.includes('#'))
    .map((p) => /(ADR-\d{3,4})/.exec(p)?.[1]).filter(Boolean))
  for (const d of hit) {
    const g = adrDigest(d)
    adrLines.push(`### ${g.id} — ${g.title}`)
    if (g.decision) adrLines.push('', g.decision)
    if (g.nonGoals.length) adrLines.push('', '정하지 않은 것 (이 작업의 범위가 아니다):', ...g.nonGoals.map((n) => `- ${n}`))
    if (g.rejected.length) adrLines.push('', `이미 기각한 안 — 다시 고르지 마라: ${g.rejected.join(' · ')}`)
    adrLines.push('', `전문: \`${relative(ROOT, join(seam.dir, g.file))}\``, '')
  }
  const missed = [...pinned].filter((id) => !hit.some((d) => String(d.fm?.id) === id))
  if (missed.length) console.error(`· 사슬이 핀한 ${missed.join(' · ')} 는 이 작업의 files 에 안 걸려 싣지 않았다`)
}

// ── 채우기 ───────────────────────────────────────────────────────────────────
const { level } = levelsOf([...docs.plan.ents.values()].filter((e) => e.kind === 'wp'))
const siblings = [...docs.plan.ents.values()].filter((e) => e.kind === 'wp' && e.id !== w.id && level.get(e.id) === level.get(w.id))
const snippetsPath = flag('snippets')
const vars = {
  task_id: w.id, task_title: w.title,
  spec_dir: ROOT ? relative(ROOT, DIR) : DIR,
  worktree: flag('worktree') ?? (siblings.length
    ? '⚠ 워크트리 경로가 빠졌다 — 병렬 레벨이다. task-worktree add 뒤 --worktree 를 준다'
    : '(메인 트리 — 이 레벨은 작업 하나다)'),
  bootstrap: yml('bootstrap') || '(없음 — 의존성은 이미 있다)',
  files: files.map((f) => `- \`${f}\``).join('\n') || '- (files 가 비었다)',
  requirements: reqLines.join('\n'),
  tests: wpField(w, 'tests') || '(tests 줄이 없다 — plan.md 를 고친다)',
  rules: rules.join('\n') || '- (걸리는 규칙 없음)',
  verify: wpField(w, 'verify') || yml('verify') || '(verify 없음)',
  snippets: snippetsPath && existsSync(snippetsPath) ? readFileSync(snippetsPath, 'utf8').trim() : '(없음)',
  // 걸리는 결정이 없으면 절째 사라진다 — ADR 을 안 쓰는 레포에 빈 절이 서면 그 자리가
  // 「이 프롬프트에는 없어도 되는 것이 있다」는 신호가 되고, 다음 절도 그렇게 읽힌다.
  decisions: adrLines.length
    ? ['## 이미 정해진 것 — 다시 논의하지 않는다', '',
       '아래는 사람이 승인한 결정이다. 다른 안이 더 낫다고 느껴져도 그 자리에서 바꾸지 마라 —',
       '대안은 이미 검토됐고 기각 이유가 기록돼 있다. 결정과 코드의 제약이 정말 부딪히면',
       '밀어붙이지 말고 마지막 보고에 적고 멈춘다.', '',
       adrLines.join('\n').trim(), '', ''].join('\n')
    : '',
  parallel_note: siblings.length
    ? `이 레벨은 병렬이다 — ${siblings.map((s) => s.id).join('·')} 가 같은 시각 다른 워크트리에서 돈다. 네 files 밖의 파일을 고치지 마라. 전체 verify 는 돌리지 마라 (합류점에서 한 번 돈다).`
    : '이 레벨은 이 작업 하나다. 그래도 files 밖의 파일은 고치지 마라.',
}
let text = readFileSync(TEMPLATE, 'utf8')
for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v)
const left = [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1])
if (left.length) console.error(`⚠ 템플릿에 채우지 못한 자리: ${[...new Set(left)].join(', ')}`)
process.stdout.write(text)
