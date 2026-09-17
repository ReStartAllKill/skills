/** sdlc-metrics.mjs against temporary git repositories with controlled commit timestamps.
 *
 * Every indicator here is a difference between two commit times, so a test that let git stamp
 * "now" would only ever measure 0 seconds and would pass no matter how the arithmetic broke.
 * GIT_AUTHOR_DATE/GIT_COMMITTER_DATE are therefore set per commit, and the assertions are on
 * exact second counts. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = resolve(HERE, '../tools/sdlc-metrics.mjs')

const DAY = 86400
const HOUR = 3600
/** A fixed epoch keeps every expected duration a literal rather than a computed value. */
const T0 = Math.floor(Date.parse('2026-01-05T00:00:00Z') / 1000)
const iso = (t) => new Date(t * 1000).toISOString()

const temp = (prefix) => mkdtempSync(join(tmpdir(), `${prefix}-`))
const put = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body) }

function git(dir, args, at) {
  const env = { ...process.env }
  if (at != null) { env.GIT_AUTHOR_DATE = iso(at); env.GIT_COMMITTER_DATE = iso(at) }
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { encoding: 'utf8', env })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}\n${r.stdout}${r.stderr}`)
  return r.stdout.trim()
}
const commit = (dir, msg, at, extra = []) => { git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', msg, ...extra], at) }

function tool(dir, ...args) {
  const r = spawnSync(process.execPath, [TOOL, dir, ...args], { encoding: 'utf8' })
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? ''), stdout: r.stdout ?? '' }
}
function json(dir, ...args) {
  const r = tool(dir, '--json', ...args)
  assert.equal(r.code, 0, r.out)
  return JSON.parse(r.stdout)
}
const only = (report) => { assert.equal(report.sets.length, 1, JSON.stringify(report.sets.map((s) => s.dir))); return report.sets[0] }

function repo(prefix, profile = 'sdlc_version: 5\nlang: en\nspec_dir: ".sdlc/specs"\nverify: "true"\n') {
  const d = temp(prefix)
  put(join(d, '.claude/spec-profile.yml'), profile)
  git(d, ['init', '-q', '-b', 'main'])
  return d
}

const doc = (kind, fields, body = '') =>
  `---\nartifact: ${kind}\nschema_version: 5\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}`

// ── 1. a chain that ran to completion ──────────────────────────────────────────────────────────

test('lead times, commit count and wall span of a completed chain', () => {
  const d = repo('m-complete')
  const set = join(d, '.sdlc/specs/2026-01-05-search')
  put(join(set, 'intent.md'), doc('intent', { id: 'INT-2026-001', status: 'draft' }, 'Make search faster.\n'))
  commit(d, 'intent born', T0)

  put(join(set, 'intent.md'), doc('intent', { id: 'INT-2026-001', status: 'accepted', approved_by: 'owner' }, 'Make search faster.\n'))
  commit(d, 'intent accepted', T0 + 2 * DAY)

  put(join(set, 'spec.md'), doc('spec', { status: 'accepted', approved_by: 'owner' }, 'Behaviour.\n'))
  commit(d, 'spec accepted', T0 + 3 * DAY)

  put(join(set, 'plan.md'), doc('plan', { status: 'accepted', approved_by: 'owner' }, 'Tasks.\n'))
  commit(d, 'plan accepted', T0 + 4 * DAY)

  put(join(set, 'plan.md'), doc('plan', { status: 'in_progress', approved_by: 'owner' }, 'Tasks.\n'))
  commit(d, 'plan in progress', T0 + 5 * DAY)

  put(join(d, 'src/a.js'), 'export const a = 1\n')
  commit(d, 'first task', T0 + 5 * DAY + HOUR, ['-m', 'SDLC-Task: WP-001\nSDLC-Plan: .sdlc/specs/2026-01-05-search/plan.md'])
  put(join(d, 'src/b.js'), 'export const b = 1\n')
  commit(d, 'second task', T0 + 5 * DAY + 2 * HOUR, ['-m', 'SDLC-Task: WP-002\nSDLC-Plan: .sdlc/specs/2026-01-05-search/plan.md'])

  put(join(set, 'plan.md'), doc('plan', { status: 'completed', approved_by: 'owner' }, 'Tasks.\n'))
  commit(d, 'plan completed', T0 + 6 * DAY)

  const s = only(json(d))
  assert.equal(s.id, 'INT-2026-001')
  assert.deepEqual(s.metrics.intent_lead, { seconds: 2 * DAY })
  assert.deepEqual(s.metrics.spec_lead, { seconds: 1 * DAY })
  assert.deepEqual(s.metrics.plan_lead, { seconds: 1 * DAY })
  assert.deepEqual(s.metrics.build_lead, { seconds: 2 * DAY })
  assert.deepEqual(s.metrics.review_returns, { count: 0 })
  assert.deepEqual(s.metrics.set_commits, { count: 6 })
  assert.equal(s.metrics.wall_days.seconds, 6 * DAY)
})

// ── 2. rework and review returns ───────────────────────────────────────────────────────────────

test('spec rework after build, intent rework after spec, and one review return', () => {
  const d = repo('m-rework')
  const set = join(d, '.sdlc/specs/2026-01-05-rework')
  put(join(set, 'intent.md'), doc('intent', { id: 'INT-2026-002', status: 'draft' }, 'First idea.\n'))
  put(join(set, 'spec.md'), doc('spec', { status: 'draft' }, 'First behaviour.\n'))
  commit(d, 'chain born', T0)

  put(join(set, 'intent.md'), doc('intent', { id: 'INT-2026-002', status: 'draft' }, 'A wider idea.\n'))
  commit(d, 'intent edited after spec exists', T0 + 1 * DAY)

  put(join(set, 'spec.md'), doc('spec', { status: 'accepted', approved_by: 'owner' }, 'First behaviour.\n'))
  commit(d, 'spec accepted', T0 + 2 * DAY)
  put(join(set, 'spec.md'), doc('spec', { status: 'in_review' }, 'First behaviour.\n'))
  commit(d, 'spec returned to review', T0 + 3 * DAY)
  put(join(set, 'spec.md'), doc('spec', { status: 'accepted', approved_by: 'owner' }, 'First behaviour.\n'))
  commit(d, 'spec accepted again', T0 + 4 * DAY)

  put(join(set, 'plan.md'), doc('plan', { status: 'in_progress', approved_by: 'owner' }, 'Tasks.\n'))
  commit(d, 'build starts', T0 + 5 * DAY)

  put(join(set, 'spec.md'), doc('spec', { status: 'accepted', approved_by: 'owner' }, 'Behaviour, corrected.\n'))
  commit(d, 'spec reworked during build', T0 + 6 * DAY)

  const s = only(json(d))
  assert.deepEqual(s.metrics.spec_rework_after_build, { count: 1 })
  assert.deepEqual(s.metrics.intent_rework, { count: 1 })
  assert.deepEqual(s.metrics.review_returns, { count: 1 })
})

// ── 3. execution-log deviation ─────────────────────────────────────────────────────────────────

const EXEC_LOG = `## Tasks

- [x] **WP-001 — One**
- [x] **WP-002 — Two**
- [x] **WP-003 — Three**

## Execution log

- 2026-01-06 WP-001 — done · no PR · differs from plan: the migration needed a second pass over the index.
- 2026-01-06 WP-002 WP-003 — done · no PR · differs from plan: none
`

test('plan deviation share counts deviating task IDs against every ID in the section', () => {
  const d = repo('m-dev')
  const set = join(d, '.sdlc/specs/2026-01-05-dev')
  put(join(set, 'plan.md'), doc('plan', { status: 'completed', approved_by: 'owner' }, EXEC_LOG))
  commit(d, 'plan', T0)
  const s = only(json(d))
  assert.deepEqual(s.metrics.plan_deviation_share, { share: 1 / 3, numerator: 1, denominator: 3 })
})

test('an N/A execution log is unmeasured, not a zero deviation rate', () => {
  const d = repo('m-dev-na')
  const set = join(d, '.sdlc/specs/2026-01-05-na')
  put(join(set, 'plan.md'), doc('plan', { status: 'accepted', approved_by: 'owner' },
    '## Tasks\n\n- [ ] **WP-001 — One**\n\n## Execution log\n\nN/A — execution has not started.\n'))
  commit(d, 'plan', T0)
  const s = only(json(d))
  assert.ok(s.metrics.plan_deviation_share.unmeasured, JSON.stringify(s.metrics.plan_deviation_share))
  assert.ok(/N\/A/.test(s.metrics.plan_deviation_share.unmeasured))
})

// ── 4. verify logs ─────────────────────────────────────────────────────────────────────────────

/** The header above `---` is verify-run.mjs's contract: `label:` appears only for an extra gate
 * and `exit:` carries the result. These fixtures are written by hand in exactly that shape, so a
 * change to verify-run.mjs's header must break this test rather than silently change the metric. */
const verifyLog = ({ exit, label, date }) => [
  '# sdlc verify',
  `date: ${date}`,
  'spec: .sdlc/specs/2026-01-05-verify',
  'level: 1',
  'tasks: WP-001',
  ...(label ? [`label: ${label}`] : []),
  'command: "true"',
  'fingerprints: {"WP-001":"abc"}',
  'repository: def',
  'stable: true',
  'head: 0000000000000000000000000000000000000000',
  `exit: ${exit}`,
  'bytes: 3',
  'output: full 1 lines',
  'sha256: 0',
  '---',
  'ok',
].join('\n')

test('first-pass verify counts full runs only and ignores labelled gate runs', () => {
  const d = repo('m-verify')
  const set = join(d, '.sdlc/specs/2026-01-05-verify')
  put(join(set, 'plan.md'), doc('plan', { status: 'completed', approved_by: 'owner' }, 'Tasks.\n'))
  const logs = join(d, '.sdlc/verify/2026-01-05-verify')
  put(join(logs, 'L1-a.log'), verifyLog({ exit: 0, date: '2026-01-06T00:00:00Z' }))
  put(join(logs, 'L1-b.log'), verifyLog({ exit: 0, date: '2026-01-06T01:00:00Z' }))
  put(join(logs, 'L1-c.log'), verifyLog({ exit: 1, date: '2026-01-06T02:00:00Z' }))
  put(join(logs, 'L1-gate-d.log'), verifyLog({ exit: 1, label: 'gate', date: '2026-01-06T03:00:00Z' }))
  commit(d, 'plan and logs', T0)

  const s = only(json(d))
  assert.deepEqual(s.metrics.verify_first_pass, { share: 2 / 3, numerator: 2, denominator: 3 })
  assert.match(tool(d).stdout, /Test \/ first-pass verify success\s+2\/3\s+\(67%\)\s+1 failed/)
})

// ── 5. finding routing ─────────────────────────────────────────────────────────────────────────

test('finding route lead time and the aggregate route breakdown', () => {
  const d = repo('m-finding')
  const set = join(d, '.sdlc/specs/findings/FND-2026-001-ci')
  put(join(set, 'finding.md'), doc('finding', { id: 'FND-2026-001', status: 'in_review', routed_to: '' }, 'CI went red.\n'))
  commit(d, 'finding born', T0)
  put(join(set, 'finding.md'), doc('finding',
    { id: 'FND-2026-001', status: 'accepted', routed_to: 'intent:../../2026-01-05-ci/intent.md' }, 'CI went red.\n'))
  commit(d, 'finding routed', T0 + 6 * HOUR)

  const report = json(d)
  const s = only(report)
  assert.deepEqual(s.metrics.finding_route_lead, { seconds: 6 * HOUR })
  assert.deepEqual(report.aggregate.finding_routes.routes, { intent: 1, patch: 0, dismiss: 0, other: 0, unrouted: 0 })
  assert.match(tool(d).stdout, /Maintain \/ breach-to-route time\s+6h/)
})

// ── 6. an uncommitted set ──────────────────────────────────────────────────────────────────────

test('an uncommitted set reports every time metric as unmeasured and still exits 0', () => {
  const d = repo('m-untracked')
  put(join(d, 'README.md'), 'repo\n')
  commit(d, 'repo born', T0)
  const set = join(d, '.sdlc/specs/2026-01-05-new')
  put(join(set, 'intent.md'), doc('intent', { id: 'INT-2026-009', status: 'accepted', approved_by: 'owner' }, 'Never committed.\n'))
  put(join(set, 'spec.md'), doc('spec', { status: 'accepted', approved_by: 'owner' }, 'Never committed.\n'))
  put(join(set, 'plan.md'), doc('plan', { status: 'completed', approved_by: 'owner' }, 'Never committed.\n'))

  const r = tool(d)
  assert.equal(r.code, 0, r.out)
  const s = only(json(d))
  for (const key of ['intent_lead', 'spec_lead', 'plan_lead', 'build_lead', 'wall_days', 'set_commits',
    'intent_rework', 'spec_rework_after_build', 'review_returns', 'finding_route_lead']) {
    assert.ok(s.metrics[key].unmeasured, `${key} should be unmeasured, got ${JSON.stringify(s.metrics[key])}`)
    assert.ok(s.metrics[key].unmeasured.length > 0, `${key} has no reason`)
  }
  // The cost of the prose is on disk, so it stays measurable even with no history.
  assert.ok(s.metrics.doc_chars.count > 0, JSON.stringify(s.metrics.doc_chars))
  assert.match(r.stdout, /unmeasured — not committed/)
})

// ── 7. JSON shape ──────────────────────────────────────────────────────────────────────────────

const VALUE_KEYS = ['seconds', 'count', 'share']

test('every metric in --json is a value or an unmeasured reason, never null or absent', () => {
  const d = repo('m-shape')
  const set = join(d, '.sdlc/specs/2026-01-05-shape')
  put(join(set, 'intent.md'), doc('intent', { id: 'INT-2026-003', status: 'accepted', approved_by: 'owner' }, 'Idea.\n'))
  put(join(set, 'spec.md'), doc('spec', { status: 'in_review' }, 'Behaviour.\n'))
  commit(d, 'chain born', T0)

  const report = json(d)
  assert.equal(report.version, 1)
  assert.equal(report.spec_dir, '.sdlc/specs')
  const s = only(report)
  const keys = Object.keys(s.metrics)
  assert.ok(keys.length >= 13, `too few metrics: ${keys.join(' ')}`)
  for (const [key, m] of Object.entries(s.metrics)) {
    assert.ok(m && typeof m === 'object', `${key} is not an object`)
    const value = VALUE_KEYS.filter((k) => k in m)
    if ('unmeasured' in m) {
      assert.equal(value.length, 0, `${key} carries both a value and a reason`)
      assert.equal(typeof m.unmeasured, 'string')
      assert.ok(m.unmeasured.length > 0, `${key} is unmeasured with no reason`)
    } else {
      assert.equal(value.length, 1, `${key} must carry exactly one value key: ${JSON.stringify(m)}`)
      assert.equal(typeof m[value[0]], 'number')
    }
  }
  for (const [key, a] of Object.entries(report.aggregate)) {
    assert.ok(a && typeof a === 'object', `aggregate ${key} is not an object`)
    if ('unmeasured' in a) assert.ok(a.unmeasured.length > 0, `aggregate ${key} has no reason`)
  }
  // An intent accepted with no rejected sibling makes survival 1/1, not an empty share.
  assert.deepEqual(report.aggregate.intent_survival, { share: 1, numerator: 1, denominator: 1 })
})

// ── 8. environment failures ────────────────────────────────────────────────────────────────────

test('no profile exits 2 with one line', () => {
  const d = temp('m-noprofile')
  git(d, ['init', '-q', '-b', 'main'])
  const r = tool(d)
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /profile/i)
})

test('a directory that is not a git repository exits 2', () => {
  const d = temp('m-nogit')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: ".sdlc/specs"\n')
  const r = tool(d)
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /git/i)
})

// ── selection flags ────────────────────────────────────────────────────────────────────────────

test('--set narrows to one directory and --since drops earlier sets', () => {
  const d = repo('m-select')
  const a = join(d, '.sdlc/specs/2026-01-05-a')
  put(join(a, 'intent.md'), doc('intent', { id: 'INT-A', status: 'accepted', approved_by: 'owner' }, 'A.\n'))
  commit(d, 'set a', T0)
  const b = join(d, '.sdlc/specs/2026-02-05-b')
  put(join(b, 'intent.md'), doc('intent', { id: 'INT-B', status: 'accepted', approved_by: 'owner' }, 'B.\n'))
  commit(d, 'set b', T0 + 31 * DAY)

  assert.equal(json(d).sets.length, 2)
  assert.equal(only(json(d, '--set', '.sdlc/specs/2026-02-05-b')).id, 'INT-B')
  assert.equal(only(json(d, '--since', '2026-01-20')).id, 'INT-B')
  assert.equal(json(d, '--since', '2026-01-01').sets.length, 2)
})

// ── usage ──────────────────────────────────────────────────────────────────────────────────────

/** The usage ledger is the one input here that git cannot supply, so these tests write it by hand
 * the way `usage-ledger.mjs record` would. Its own arithmetic is covered in usage-ledger.test.mjs;
 * what matters here is that a set with no ledger stays unmeasured rather than joining a median
 * at zero. */
const ledger = (root, setName, snapshots) =>
  put(join(root, '.sdlc/verify/usage', `${setName}.json`), JSON.stringify({ version: 1, set: setName, snapshots }))

const snapshot = (micro, tokens) => ({
  at: iso(T0), doc: 'spec.md', session: 's1', messages: 1,
  tokens: { 'claude-opus-5': { input: 0, output: 0, cache_5m: 0, cache_1h: 0, cache_read: 0, ...tokens } },
  micro_usd: micro, by_model_micro_usd: { 'claude-opus-5': micro }, rates: {}, rates_as_of: '2026-06-24',
  unpriced_models: [], assumptions: [],
})

test('recorded token spend is reported per set and totalled in dollars', () => {
  const d = repo('m-usage', 'sdlc_version: 5\nlang: en\nspec_dir: ".sdlc/specs"\nverify_log_dir: ".sdlc/verify"\nverify: "true"\n')
  const set = join(d, '.sdlc/specs/2026-01-05-usage')
  put(join(set, 'intent.md'), doc('intent', { id: 'INT-2026-020', status: 'accepted', approved_by: 'owner' }, 'An idea.\n'))
  commit(d, 'intent', T0)
  ledger(d, '2026-01-05-usage', [snapshot(25_000_000, { output: 1_000_000 }), snapshot(500_000, { cache_read: 1_000_000 })])

  const s = only(json(d))
  assert.equal(s.metrics.usage_tokens.count, 2_000_000)
  assert.equal(s.metrics.usage_cost.count, 25_500_000)

  const text = tool(d)
  assert.equal(text.code, 0, text.out)
  assert.match(text.out, /Cost \/ recorded token spend\s+\$25\.50/)
})

test('a set with no ledger is unmeasured, so it never joins the median at zero', () => {
  const d = repo('m-usage-none', 'sdlc_version: 5\nlang: en\nspec_dir: ".sdlc/specs"\nverify_log_dir: ".sdlc/verify"\nverify: "true"\n')
  const priced = join(d, '.sdlc/specs/2026-01-05-priced')
  const silent = join(d, '.sdlc/specs/2026-01-06-silent')
  put(join(priced, 'intent.md'), doc('intent', { id: 'INT-2026-021', status: 'accepted', approved_by: 'owner' }, 'One.\n'))
  put(join(silent, 'intent.md'), doc('intent', { id: 'INT-2026-022', status: 'accepted', approved_by: 'owner' }, 'Two.\n'))
  commit(d, 'two sets', T0)
  ledger(d, '2026-01-05-priced', [snapshot(10_000_000, { output: 400_000 })])

  const report = json(d)
  const bySet = Object.fromEntries(report.sets.map((s) => [s.id, s.metrics]))
  assert.equal(bySet['INT-2026-021'].usage_cost.count, 10_000_000)
  assert.match(bySet['INT-2026-022'].usage_cost.unmeasured, /no usage ledger/)
  // One set contributed, and the median is that set's value — not half of it.
  assert.equal(report.aggregate.usage_cost.sets, 1)
  assert.equal(report.aggregate.usage_cost.median, 10_000_000)
})

test('an unpriced model leaves the cost unmeasured while the token count survives', () => {
  const d = repo('m-usage-unpriced', 'sdlc_version: 5\nlang: en\nspec_dir: ".sdlc/specs"\nverify_log_dir: ".sdlc/verify"\nverify: "true"\n')
  const set = join(d, '.sdlc/specs/2026-01-05-unpriced')
  put(join(set, 'intent.md'), doc('intent', { id: 'INT-2026-023', status: 'accepted', approved_by: 'owner' }, 'An idea.\n'))
  commit(d, 'intent', T0)
  ledger(d, '2026-01-05-unpriced', [{
    ...snapshot(null, { output: 1_000_000 }), micro_usd: null, unpriced_models: ['claude-from-the-future'],
  }])

  const s = only(json(d))
  assert.equal(s.metrics.usage_tokens.count, 1_000_000)
  assert.match(s.metrics.usage_cost.unmeasured, /no published rate for claude-from-the-future/)
})
