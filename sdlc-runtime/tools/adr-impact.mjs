#!/usr/bin/env node
/** What retiring or replacing one decision touches — read-only, a report and not a check.
 *
 * The save hook checks only the folder that was edited. When an ADR is superseded, the sets that pin
 * it, the open plans whose tasks reach its scope and, in a consumer, the binding to it surfaced only
 * when CI ran `check-all`, after the fact and as failures. This asks the same questions before the
 * edit. It is a query over what the checkers already use — `idSpaces` and `keyOf` for pins and
 * mentions, `touches` for task files — so «pins it» and «mentions it» mean what they mean in the
 * warnings. `touches` is applied to the decision's paths directly rather than through
 * `adrsForFiles` / `boundForFiles`, which keep only accepted decisions: the question is also asked
 * after a decision was retired, from `/iterate-spec`, and then those would find nothing.
 *
 * Exit 0 for any readable repository, whatever it finds; 2 for no profile, no decision seam, or an ID
 * neither space knows.
 *
 * Usage: node adr-impact.mjs <repo-root> <ADR-id | owner/repo#ADR-id> [--json] */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { loadDir, loadAdr, wpFiles, isNull, BODY_PIN } from './artifact-parse.mjs'
import { adrSeam, idSpaces, PIN, CLOSED, successorsOf, mentionsIn, scopeEntry } from './adr-check.mjs'
import { loadBindings, touches } from './adr-bindings.mjs'
import { digestPin } from './adr-text.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const [startArg, target] = argv.filter((a) => !a.startsWith('--'))
const die = (msg) => {
  if (JSON_OUT) console.log(JSON.stringify({ version: 1, error: msg }))
  else console.error(msg)
  process.exit(2)
}
if (!startArg || !target) die('사용법: adr-impact.mjs <저장소 루트> <ADR-id | owner/repo#ADR-id> [--json]')

let ROOT = null
for (let d = resolve(startArg), prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
  if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { ROOT = d; break }
}
if (!ROOT) die(`프로필을 못 찾았다 — ${resolve(startArg)} 의 조상에 .claude/spec-profile.yml 이 없다.`)
const seam = adrSeam(ROOT)
if (!seam.configured) die('프로필에 `adr_dir` 도 `adr_repo` 도 없다 — 이 레포는 결정을 두지 않는다.')

const ids = idSpaces(seam)
const g = PIN.exec(target.trim())?.groups
if (!g) die(`\`${target}\` 를 읽을 수 없다 — \`ADR-005\` 나 \`<owner>/<repo>#ADR-005\` 다.`)
const { space } = ids.spaceOf(g)
if (!space) die(`${target} 는 이 레포가 모르는 레포의 결정이다 — 그 레포에서 돌린다.`)
const src = ids[space]
const entry = src.byId.get(g.id)
if (!entry) die(`${g.id} 가 ${src.where || space} 에 없다${space === 'up' ? ' — 매니페스트가 낡았으면 pull-adr.mjs 로 다시 끌어온다' : ''}.`)
const key = `${space}:${g.id}`
const show = (id) => (space === 'up' ? `${ids.upRepo}#${id}` : id)

// ── the decision ────────────────────────────────────────────────────────────────────────────────
const manifestEntry = space === 'up' ? (ids.manifest?.decisions ?? []).find((d) => String(d.id) === g.id) : null
const adrDoc = space === 'local' && entry.path ? loadAdr(entry.path) : null
const title = String((adrDoc?.fm?.title ?? manifestEntry?.title) ?? '')
const bindings = space === 'up' ? loadBindings(seam.bindings) : null
const bound = bindings?.bindings?.[g.id] ?? null
const paths = space === 'local'
  ? [].concat(adrDoc?.fm?.scope ?? []).map(String).filter((v) => !isNull(v)).map((s) => scopeEntry(s, seam.self)).filter((e) => e.mine).map((e) => e.path)
  : bound?.paths ?? []
const chain = successorsOf(ids, key)?.ids ?? []
const statusOf = (id) => src.byId.get(id)?.status ?? '?'
const inForce = entry.status === 'accepted' ? g.id : chain.find((n) => statusOf(n) === 'accepted') ?? null

let binding = null
if (space === 'up') {
  const now = manifestEntry?.digest ? digestPin(manifestEntry.digest) : manifestEntry?.sha ? manifestEntry.sha.slice(0, 12) : null
  if (bound) {
    const bodyAt = BODY_PIN.exec(bound.at ?? '')?.[1]?.toLowerCase()
    const current = !bound.at ? false
      : bodyAt ? !!manifestEntry?.digest?.startsWith(bodyAt)
      : !!manifestEntry?.sha?.startsWith(bound.at)
    binding = { file: relative(ROOT, seam.bindings), at: bound.at, now, current, paths: bound.paths ?? null, reason: bound.reason }
  } else binding = { file: seam.bindings ? relative(ROOT, seam.bindings) : null, at: null, now, current: null, paths: null, reason: null, missing: true }
}

// ── the sets ────────────────────────────────────────────────────────────────────────────────────
const profile = readFileSync(join(ROOT, '.claude/spec-profile.yml'), 'utf8')
const specRaw = (/^spec_dir:[ \t]*(.*)$/m.exec(profile)?.[1] ?? '').replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
const specDir = resolve(ROOT, specRaw || '.sdlc/specs')
const DOCS = ['intent.md', 'spec.md', 'plan.md', 'finding.md', 'research.md']
const sets = []
const walk = (dir) => {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  if (entries.some((e) => e.isFile() && DOCS.includes(e.name))) sets.push(dir)
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name))
}
if (existsSync(specDir)) walk(specDir)

const pinned = { open: [], closed: [] }
const touching = []
const mentioned = []
for (const dir of sets.sort()) {
  const docs = loadDir(dir, () => {})
  const set = relative(ROOT, dir)
  const statusIn = (d) => String(d?.fm?.status ?? '')
  const lead = docs.plan ?? docs.intent ?? Object.values(docs)[0]
  const status = `${lead.kind} ${statusIn(lead) || '?'}`
  // The same «closed» `checkPins` reads: a completed plan, or a plan or intent replaced or turned down.
  const closed = [docs.plan, docs.intent].some((x) => CLOSED.includes(statusIn(x)))
  const running = statusIn(docs.plan) === 'in_progress'
  const pinDocs = Object.values(docs).filter((d) => [].concat(d.fm?.decisions ?? []).map(String)
    .some((p) => { const m = PIN.exec(p.trim()); return m && ids.keyOf(m.groups) === key })).map((d) => d.name)
  if (pinDocs.length) (closed ? pinned.closed : pinned.open).push({ set, status, running, docs: pinDocs })
  if (docs.plan && !closed && paths.length) {
    const tasks = [...docs.plan.ents.values()].filter((e) => e.kind === 'wp')
      .filter((w) => wpFiles(w).some((f) => paths.some((p) => touches(p, f)))).map((w) => w.id)
    if (tasks.length) touching.push({ set, status, running, tasks, pinned: pinDocs.length > 0 })
  }
  if (!pinDocs.length) {
    const names = Object.values(docs).filter((d) => mentionsIn(ids, d).has(key)).map((d) => d.name)
    if (names.length) mentioned.push({ set, status, closed, docs: names })
  }
}

// ── what a retirement would ask of each ─────────────────────────────────────────────────────────
const actions = []
const live = entry.status === 'accepted'
if (live) actions.push('순서: 후속 ADR 을 먼저 승인하고, 그다음 이 결정을 superseded 로 돌린다 — 반대로 하면 그 사이 이 범위에 효력 있는 결정이 없다.')
else if (!inForce) actions.push(`${show(g.id)} 는 \`${entry.status}\` 이고 효력 있는 후속이 없다 — 이 범위에는 지금 효력 있는 결정이 없다.`)
for (const s of pinned.open.filter((s) => s.running)) actions.push(`${s.set} — 실행 중이다(${s.status}). plan 의 status 를 먼저 in_review 로 돌리고 /iterate-spec 으로 후속을 읽어 설계·작업이 서는지 본 뒤 핀을 옮긴다. plan-resume·task-brief 는 핀이 효력을 잃으면 멈춘다.`)
for (const s of pinned.open.filter((s) => !s.running)) actions.push(`${s.set} — 핀을 후속으로 옮기고(${s.docs.join(' · ')}) 계획을 다시 읽는다.`)
for (const t of touching.filter((t) => !t.pinned)) actions.push(`${t.set} — ${t.tasks.join('·')} 가 이 결정의 ${space === 'local' ? 'scope' : '바인딩 paths'} 를 만지는데 핀이 없다${t.running ? ' — 실행 중이다' : ''}. 후속을 읽고 설계가 그 안에 서는지 본다.`)
for (const m of mentioned.filter((m) => !m.closed)) actions.push(`${m.set} — 본문이 부른다(${m.docs.join(' · ')}). 바뀐 결정을 인용하고 있지 않은지 본다.`)
if (binding && !binding.missing) actions.push(`${binding.file} — ${g.id} 바인딩. 상류에서 바뀌면 pull-adr.mjs 로 다시 끌어오고, 결정을 다시 읽은 뒤 \`at\` 을 올리거나 후속으로 옮긴다.`)
if (pinned.closed.length) actions.push(`닫힌 세트 ${pinned.closed.length}개는 이력이다 — 고치지 않는다.`)

const report = {
  version: 1, id: g.id, shown: show(g.id), space, title, status: entry.status,
  superseded_by: chain, in_force: inForce, paths, pinned, touching, mentioned, binding, actions,
}
if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); process.exit(0) }

const out = []
out.push(`${show(g.id)} — ${title || '(제목 없음)'}  \`${entry.status}\``)
if (chain.length) out.push(`  후속: ${[g.id, ...chain].map((n) => `${n}(${n === g.id ? entry.status : statusOf(n)})`).join(' → ')}`)
out.push(`  효력: ${inForce ? show(inForce) : '없음'}`)
out.push(`  ${space === 'local' ? 'scope' : '바인딩 paths'}: ${paths.length ? paths.join(' · ') : '(없음 — 작업 범위로는 아무 계획에도 닿지 않는다)'}`)
const list = (head, rows, fmt) => { out.push('', `${head} (${rows.length})`); for (const r of rows) out.push(`  ${fmt(r)}`); if (!rows.length) out.push('  없음') }
list('핀한 세트 — 열린 것', pinned.open, (s) => `${s.set}  [${s.status}]  ${s.docs.join(' · ')}`)
list('핀한 세트 — 닫힌 것', pinned.closed, (s) => `${s.set}  [${s.status}]  ${s.docs.join(' · ')}`)
list('범위를 만지는 열린 계획', touching, (t) => `${t.set}  [${t.status}]  ${t.tasks.join('·')}  ${t.pinned ? '핀 있음' : '핀 없음'}`)
list('본문에서만 부르는 세트', mentioned, (m) => `${m.set}  [${m.status}]  ${m.docs.join(' · ')}`)
if (binding) {
  out.push('', '바인딩')
  out.push(binding.missing ? `  없음 — ${binding.file ?? '.claude/adr-bindings.yml'} 에 ${g.id} 가 없다`
    : `  ${binding.file}  at: ${binding.at ?? '(없음)'}${binding.now ? ` · 지금 ${binding.now}` : ''}${binding.current === false ? ' — 뒤처졌다' : ''}  paths: ${(binding.paths ?? []).join(' · ') || binding.reason || '(없음)'}`)
}
out.push('', '이 결정을 대체·폐기하면')
for (const a of actions) out.push(`  - ${a}`)
if (!actions.length) out.push('  - 걸리는 것이 없다.')
console.log(out.join('\n'))
