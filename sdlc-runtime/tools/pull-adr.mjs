#!/usr/bin/env node
/** Pull the decisions of the `adr_repo` into `.claude/adr-manifest.json`.
 *
 * The manifest carries what this repository needs of each decision — status, `applies_to`, the
 * digest `task-brief` injects, and `digest`, the content hash (`decisionHash`) bindings and pins are
 * compared with — and never a path: paths are this repository's, in
 * `.claude/adr-bindings.yml`. Every decision is pulled whatever its status, because a pin to a
 * draft must read as «still a draft», not as «does not exist».
 *
 * An ADR written before `applies_to` names repositories only through `repo:path` scope entries.
 * Those repositories stand in for `applies_to` here, so a code repository learns which decisions
 * it has not bound yet before the document repository migrates, and the binding skeleton this
 * prints carries those paths across.
 *
 * Usage: node pull-adr.mjs [<repo-root>] [--from <upstream-checkout>] [--adr-dir <path in upstream>] */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { ADR_FILENAME, isNull, loadAdrDir, BODY_PIN } from './artifact-parse.mjs'
import { adrSeam } from './adr-bindings.mjs'
import { adrDigest, legacyMeta, scopeEntry, appliesToOf, decisionHash, digestPin } from './adr-text.mjs'
import { manifestIntegrity, loadBindings } from './adr-bindings.mjs'
import { hashOf, headOf, findUpstream, sameRepo } from './upstream.mjs'

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const start = resolve(argv.find((a, i) => !a.startsWith('--') && !['--from', '--adr-dir'].includes(argv[i - 1])) ?? process.cwd())
const die = (...lines) => { for (const l of lines) console.error(l); process.exit(2) }

let ROOT = null
for (let d = start, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
  if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { ROOT = d; break }
}
if (!ROOT) die('프로필을 찾지 못했다 — `.claude/spec-profile.yml` 이 있는 레포 안에서 돌린다.')

const seam = adrSeam(ROOT)
if (!seam.repo) die('프로필에 `adr_repo` 가 없다 — 결정이 사는 레포를 `adr_repo: "<owner>/<repo>"` 로 적는다.')

const upstream = findUpstream({ repo: seam.repo }, ROOT, flag('--from'))
if (!upstream) {
  die(`${seam.repo} 체크아웃을 찾지 못했다.`,
    '`--from <경로>` 로 지정하거나 `SDLC_UPSTREAM` 환경변수를 쓴다.',
    '형제 디렉터리에 받아뒀으면 origin remote 가 그 레포를 가리켜야 한다.')
}
// A document repository need not run this harness — rwa-docs keeps its own tooling and no
// profile. So the directory comes from the flag, then the upstream profile, then the conventional
// default, and the output says which one answered.
const upProfile = join(upstream, '.claude/spec-profile.yml')
const fromProfile = existsSync(upProfile)
  ? (/^adr_dir:[ \t]*(.*)$/m.exec(readFileSync(upProfile, 'utf8'))?.[1] ?? '').replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
  : ''
const adrDir = flag('--adr-dir') || fromProfile || (existsSync(join(upstream, 'docs/adr')) ? 'docs/adr' : '')
const dirSource = flag('--adr-dir') ? '--adr-dir' : fromProfile ? '상류 프로필의 adr_dir' : '기본값 — 상류 프로필에 adr_dir 이 없다'
if (!adrDir) die(`${seam.repo} 에서 ADR 폴더를 찾지 못했다 — 프로필에 \`adr_dir\` 이 없고 docs/adr 도 없다.`, '`--adr-dir <상류 기준 경로>` 로 지정한다.')

const { docs, malformed } = loadAdrDir(resolve(upstream, adrDir))
if (!docs.length) die(`${seam.repo} 의 ${adrDir} 에 ADR 이 없다.`)

const list = (v) => [].concat(v ?? []).map(String).filter((x) => !isNull(x))
const decisions = []
const skeleton = []
for (const doc of docs) {
  const num = ADR_FILENAME.exec(doc.name)[1]
  const legacy = legacyMeta(doc)
  const g = adrDigest(doc)
  const id = legacy ? `ADR-${num}` : String(doc.fm.id ?? `ADR-${num}`)
  const scope = legacy ? [] : g.scope.map((s) => scopeEntry(s, seam.self))
  const path = relative(upstream, doc.path)
  const text = readFileSync(doc.path, 'utf8')
  const entry = {
    id,
    title: legacy ? legacy.title : g.title,
    status: legacy ? legacy.status : g.status,
    superseded_by: legacy ? null : (isNull(doc.fm.superseded_by) ? null : String(doc.fm.superseded_by)),
    applies_to: appliesToOf(doc),
    path,
    sha: headOf(upstream, path),
    hash: hashOf(text),
    // What a binding's `at: "body:…"` and a pin's `@body:…` are compared with; `hash` above stays the
    // whole file, so the checker can still tell a wording change from no change at all.
    digest: decisionHash(doc),
    decision: g.decision,
    non_goals: g.nonGoals,
    rejected: g.rejected,
  }
  decisions.push(entry)
  // Only an old-form ADR still carries this repository's paths upstream; hand them across.
  const mine = scope.filter((e) => e.repo && e.mine).map((e) => e.path)
  if (entry.status === 'accepted' && seam.self && entry.applies_to.some((r) => sameRepo(r, seam.self))) {
    skeleton.push({ id, title: entry.title, digest: entry.digest, paths: mine, confirms: mine.length ? list(doc.fm.confirms) : [] })
  }
}

// No `pulled_at`: a second pull with nothing changed upstream must leave the file byte-identical,
// or every re-pull is a diff and two branches that both re-pull conflict on that one line. When
// the file changed is git's to say — the same reason artifacts dropped `created`/`updated` in v7.
// Everything left is a function of the upstream commit, and `loadAdrDir` lists files sorted.
const manifest = {
  source: seam.repo,
  commit: headOf(upstream, adrDir),
  decisions,
  integrity: manifestIntegrity(decisions),
}
mkdirSync(dirname(seam.manifest), { recursive: true })
writeFileSync(seam.manifest, JSON.stringify(manifest, null, 2) + '\n')

console.log(`${seam.repo}:${adrDir} (${dirSource}) → ${relative(ROOT, seam.manifest)}  (${decisions.length}장)`)
for (const d of decisions) {
  const here = seam.self && d.applies_to.some((r) => sameRepo(r, seam.self)) ? '  ← 이 레포' : ''
  console.log(`  ${d.id}  ${d.sha ? d.sha.slice(0, 7) : '(미커밋)'}  ${d.status.padEnd(11)} ${d.title}${here}`)
}
for (const name of malformed) console.log(`  건너뜀 — ${name} (이름이 ADR 규칙과 다르다)`)
if (!seam.self) console.log('\n  프로필에 `repo` 가 없다 — 어느 결정이 이 레포에 적용되는지 가리지 못했다.')

const bindings = loadBindings(seam.bindings)
const unbound = skeleton.filter((s) => !bindings?.bindings[s.id])
// Each binding is compared in the form it was written in: a content-hash `at` against the digest,
// a commit `at` against the SHA, as the checker does.
const behind = (d) => {
  const at = bindings?.bindings[d.id]?.at
  if (!at) return null
  const body = BODY_PIN.exec(at)?.[1]?.toLowerCase()
  if (body) return d.digest.startsWith(body) ? null : { from: at, to: digestPin(d.digest) }
  return d.sha && !d.sha.startsWith(at) ? { from: at.slice(0, 7), to: d.sha.slice(0, 12) } : null
}
const moved = decisions.filter(behind)
if (unbound.length) {
  console.log(`\n  바인딩이 없는 결정 ${unbound.length}개 — ${relative(ROOT, seam.bindings)} 에 옮겨 적고 경로를 확인한다:\n`)
  if (!bindings) console.log(`source: "${seam.repo}"\nbindings:`)
  for (const s of unbound) {
    console.log(`  ${s.id}:   # ${s.title}`)
    // The content form: it moves only when the decision's text, Non-goals, alternatives or status
    // do, so a typo or an `applies_to` edit upstream does not stop this repository's CI.
    console.log(`    at: "${digestPin(s.digest)}"`)
    console.log(`    paths: [${s.paths.map((p) => `"${p}"`).join(', ')}]${s.paths.length ? '' : '   # 닿는 코드가 없으면 reason: 을 적는다'}`)
    console.log(`    confirms: [${s.confirms.map((c) => `"${c}"`).join(', ')}]`)
  }
}
if (moved.length) {
  console.log(`\n  묶은 뒤 바뀐 결정 ${moved.length}개 — 다시 읽고 \`at\` 을 올린다:`)
  for (const d of moved) { const m = behind(d); console.log(`    ${d.id}  ${m.from} → ${m.to}  ${d.path}`) }
}
console.log(`\n  ${relative(ROOT, seam.manifest)} 를 커밋한다. 손으로 고치지 않는다 — 고칠 일은 ${seam.repo} 에서 하고 다시 끌어온다.`)
