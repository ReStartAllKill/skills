/** The rule registry, the call sites that report its IDs, and the table that documents them.
 *
 * A consumer keys on a problem's `rule`, and a waiver names one, so an ID that drifts is a silent
 * break: a waiver with a stale ID turns into an error, a filter in CI stops matching. Three things
 * have to agree — the registry in `tools/rules.mjs`, every `R('…')` at a call site, and the tables in
 * `references/rules.md` — and nothing but this test holds them together. The call sites are read as
 * source rather than exercised: most rules fire only on a document built to break them, and a rule
 * no eval reaches is exactly the one whose ID would drift unnoticed. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { RULES, applyWaivers, problemsInReport, ruleDrift } from '../tools/rules.mjs'
import { frontmatter } from '../tools/artifact-parse.mjs'

const RUNTIME = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOOLS = join(RUNTIME, 'tools')
const sources = readdirSync(TOOLS).filter((f) => f.endsWith('.mjs')).map((f) => ({ f, text: readFileSync(join(TOOLS, f), 'utf8') }))
const uses = sources.flatMap(({ f, text }) => [...text.matchAll(/\bR\('([^']*)'\)/g)].map((m) => ({ f, id: m[1], at: m.index, text })))

test('every rule ID a tool reports is registered', () => {
  assert.ok(uses.length > 100, `found only ${uses.length} R('…') call sites — the pattern no longer matches the code`)
  const unknown = uses.filter((u) => !RULES[u.id]).map((u) => `${u.f}: ${u.id}`)
  assert.deepEqual(unknown, [])
})

test('every registered rule ID is reported somewhere', () => {
  const used = new Set(uses.map((u) => u.id))
  assert.deepEqual(Object.keys(RULES).filter((id) => !used.has(id)), [])
})

test('a call site reports a rule at its registered level', () => {
  // The nearest reporter before the ID decides the level. Nothing is skipped: the one call site
  // that picked its reporter with a ternary was split so each ID sits next to its own level, and an
  // ID chosen by a ternary inside one reporter (source-path-in-intent/-spec) shares that reporter.
  const reporter = /\b(err|warn|bad)\(|\bpush\('(error|warn)'|\blevel: '(error|warn)'/g
  const wrong = []
  for (const u of uses) {
    const before = u.text.slice(0, u.at)
    const all = [...before.matchAll(reporter)]
    const last = all[all.length - 1]
    assert.ok(last, `${u.f}: no reporter before R('${u.id}')`)
    const level = { err: 'error', bad: 'error', warn: 'warn' }[last[1]] ?? last[2] ?? last[3]
    if (level !== RULES[u.id].level) wrong.push(`${u.f}: ${u.id} reported as ${level}, registered as ${RULES[u.id].level}`)
  }
  assert.deepEqual(wrong, [])
})

test('the documented rule tables agree with the registry', () => {
  const doc = readFileSync(join(RUNTIME, 'references/rules.md'), 'utf8')
  const rows = [...doc.matchAll(/^\| `([a-z0-9-]+)` \| (error|warn) \| (yes|no) \|/gm)]
    .map((m) => ({ id: m[1], level: m[2], waivable: m[3] === 'yes' }))
  assert.ok(rows.length > 0, 'no rule rows found in references/rules.md')
  const documented = new Map(rows.map((r) => [r.id, r]))
  assert.equal(documented.size, rows.length, 'a rule is documented twice')
  const disagree = []
  for (const [id, r] of Object.entries(RULES)) {
    const d = documented.get(id)
    if (!d) { disagree.push(`${id}: not documented`); continue }
    if (d.level !== r.level || d.waivable !== r.waivable) disagree.push(`${id}: documented ${d.level}/${d.waivable}, registered ${r.level}/${r.waivable}`)
  }
  for (const id of documented.keys()) if (!RULES[id]) disagree.push(`${id}: documented but not registered`)
  assert.deepEqual(disagree, [])
})

test('only warnings can be marked waivable', () => {
  assert.deepEqual(Object.entries(RULES).filter(([, r]) => r.waivable && r.level !== 'warn').map(([id]) => id), [])
  assert.deepEqual(Object.entries(RULES).filter(([, r]) => r.waivable && !r.why).map(([id]) => id), [],
    'a waivable rule must say why in the registry')
})

const warnOf = (doc, rule) => ({ level: 'warn', doc, rule, msg: `${rule} fired` })

test('a waiver accepts the three separators and removes only its own rule in its own document', () => {
  const docs = [{ name: 'a.md', fm: { waive: ['adr-scope-empty — no code path', 'adr-confirms-empty – a vendor', 'adr-non-goals-missing - narrow'] } }]
  const problems = [warnOf('a.md', 'adr-scope-empty'), warnOf('a.md', 'adr-confirms-empty'), warnOf('a.md', 'adr-non-goals-missing'),
    warnOf('b.md', 'adr-scope-empty'), warnOf('a.md', 'adr-comment-left')]
  const r = applyWaivers(problems, docs)
  assert.deepEqual(r.problems.map((p) => `${p.doc}:${p.rule}`), ['b.md:adr-scope-empty', 'a.md:adr-comment-left'])
  assert.deepEqual(r.waived.map((w) => `${w.rule}=${w.basis}`), ['adr-scope-empty=no code path', 'adr-confirms-empty=a vendor', 'adr-non-goals-missing=narrow'])
  assert.equal(r.notes.length, 3)
})

test('a malformed waiver is an error and waives nothing', () => {
  const docs = [{ name: 'a.md', fm: { waive: ['adr-scope-empty', 'adr-scope-emtpy — typo', 'pin-dead — no', 'adr-comment-left — no', 'vague — prose'] } }]
  const problems = [warnOf('a.md', 'adr-scope-empty'), warnOf('a.md', 'adr-comment-left')]
  const r = applyWaivers(problems, docs)
  assert.deepEqual(r.problems.map((p) => p.rule).sort(), ['adr-comment-left', 'adr-scope-empty',
    'waiver-basis-missing', 'waiver-not-waivable', 'waiver-not-waivable', 'waiver-rule-unknown', 'waiver-rule-unknown'].sort())
  assert.deepEqual(r.waived, [])
})

test('a waiver that matched nothing is a note, not a problem', () => {
  const r = applyWaivers([], [{ name: 'a.md', fm: { waive: ['adr-scope-empty — operating policy'] } }])
  assert.deepEqual(r.problems, [])
  assert.match(r.notes[0], /쓰이지 않은 면제 `adr-scope-empty`/)
})

test('rule drift is reported as it was, never waived, and never throws', () => {
  // A slip in the registry is our defect; the tool must still print the document's problems as it
  // always did. The suites, not the user's save hook, are where it fails.
  const drifted = [{ level: 'warn', doc: 'a.md', msg: 'x' }, { level: 'warn', doc: 'a.md', rule: 'pin-dead', msg: 'y' }]
  const r = applyWaivers(drifted, [{ name: 'a.md', fm: { waive: ['adr-scope-empty — n/a'] } }])
  assert.deepEqual(r.problems, drifted)
  assert.equal(ruleDrift(drifted).length, 2)
  assert.deepEqual(ruleDrift([{ level: 'warn', doc: 'a.md', rule: 'adr-scope-empty', msg: 'z' }]), [])
})

test('the suites read a checker report in either output form', () => {
  const text = '\n결정 기록 검사 — 1장\n  · a note\n\n✗ 오류 1건\n\n  A.md  [self-approval] x\n      hint\n  B.md:3  y\n\n⚠ 경고 1건\n\n  A.md  [adr-scope-empty] z\n\n규칙은 …\n'
  assert.deepEqual(problemsInReport(text).map((p) => `${p.level}:${p.rule}`), ['error:self-approval', 'error:undefined', 'warn:adr-scope-empty'])
  assert.equal(problemsInReport('{"version":1,"problems":[{"level":"warn","rule":"pin-dead"}]}').length, 1)
  assert.equal(problemsInReport('plan-progress output'), null)
})

test('a waiver\'s basis is not read as artifact prose', () => {
  // The basis names a path, an undefined ID and a prefix-like token. Read as prose they warned about a
  // source path and failed on FR-009 and FRR-002 — problems the waiver itself was explaining.
  const d = mkdtempSync(join(tmpdir(), 'sdlc-waive-lines-'))
  cpSync(join(RUNTIME, '../skills/sdlc/create-spec/evals/cases/waiver-source-path/docs'), d, { recursive: true })
  const spec = join(d, 'spec.md')
  writeFileSync(spec, readFileSync(spec, 'utf8').replace(/waive:\n {2}- .*\n/,
    'waive:\n  - "source-path-in-spec — the contract is config/quota.py, see FR-001"\n  - "plan-in-upstream — see FR-009 and FRR-002 in config/x.py"\n'))
  const r = spawnSync(process.execPath, [join(TOOLS, 'check-artifacts.mjs'), d, '--json'], { encoding: 'utf8' })
  const j = JSON.parse(r.stdout)
  assert.deepEqual(j.problems, [], r.stdout)
  assert.deepEqual(j.waived.map((w) => `${w.rule}:${w.count}`), ['source-path-in-spec:1'], 'only the body line is a source path')
})

test('the frontmatter reader keeps a quoted block item with a dash and a colon whole', () => {
  // The documented form. An inline list is split on every comma, which is why the docs say to use this.
  const fm = frontmatter('---\nwaive:\n  - "adr-scope-empty — applies to: how the team operates, not code"\n---\n')
  assert.deepEqual(fm.waive, ['adr-scope-empty — applies to: how the team operates, not code'])
  const inline = frontmatter('---\nwaive: ["adr-scope-empty — one, two"]\n---\n')
  assert.deepEqual(inline.waive, ['adr-scope-empty — one', 'two'])
})
