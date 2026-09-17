#!/usr/bin/env node
/** Derive the AI-native SDLC playbook's leading and lagging indicators from the repository alone.
 *
 * Nothing in an artifact set records how long a stage took; the frontmatter status, the commit
 * history of each document, the `SDLC-Task` / `SDLC-Plan` trailers and the verify logs together
 * do. This tool reconstructs the indicators from those, the way plan-progress.mjs reconstructs
 * completion evidence — it never trusts a document's own claim about its history.
 *
 * It reports; it never judges. Exit 0 whenever it ran, 2 only on an environment failure.
 *
 * ## The rule this file is built around
 *
 * A value that cannot be measured is `{ unmeasured: "<reason>" }`, never 0 and never blank.
 * A zero that means "measured, and it was zero" and a zero that means "we could not look" are
 * indistinguishable once they are in the same column, and the second one silently drags every
 * median it lands in. Every metric therefore carries either a value or a reason, and the text
 * view prints the reason.
 *
 * ## JSON shape (`--json`), version 1 — keep this stable
 *
 * {
 *   "version": 1,
 *   "root": "<absolute repository root>",
 *   "spec_dir": "<path relative to root>",
 *   "verify_log_dir": "<path relative to root>",
 *   "generated_at": "<ISO 8601, UTC>",
 *   "sets": [
 *     {
 *       "dir": "<set directory relative to root>",
 *       "id": "<intent/finding frontmatter id, else the directory name>",
 *       "docs": {
 *         "intent": { "status": "accepted", "commits": 3, "chars": 812, "tracked": true },
 *         ...                                       // only for documents present on disk
 *       },
 *       "metrics": { "<key>": <metric>, ... }       // keys listed in METRICS below
 *     }
 *   ],
 *   "aggregate": { "<key>": <aggregate>, ... }
 * }
 *
 * A <metric> is exactly one of:
 *   { "seconds": 172800 }                           // duration; `note` may accompany it
 *   { "count": 2 }                                  // whole number; usage_cost counts micro-USD
 *   { "share": 0.333, "numerator": 1, "denominator": 3 }
 *   { "unmeasured": "<reason>" }                    // never null, never 0, never absent
 *
 * An <aggregate> is one of:
 *   { "sets": 4, "median_seconds": 90000 }          // duration metrics
 *   { "sets": 4, "median": 1, "total": 5 }          // count metrics
 *   { "sets": 3, "median_share": 0.5, "numerator": 4, "denominator": 9 }
 *   { "share": 0.8, "numerator": 4, "denominator": 5 }   // intent_survival
 *   { "routes": { "intent": 1, "patch": 0, "dismiss": 2, "other": 0 }, "findings": 3 }
 *   { "unmeasured": "<reason>" }
 *
 * `seconds` are wall-clock differences between git committer timestamps (`%ct`, epoch seconds),
 * so no timezone is involved anywhere in the computation. `--since` alone is parsed as a date,
 * and it is read as UTC midnight so the same command gives the same answer on every machine.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadDir, frontmatter, stripComments, isNull, idsIn } from './artifact-parse.mjs'
import { SECTION, sectionBlock, RE_DIVERGENCE, NO_DIVERGENCE, RE_NA, hasAlias } from './keywords.mjs'
import { ledgerFor, total as usageTotal } from './usage-ledger.mjs'
import { formatUsd } from '../pricing.mjs'

const DOCS = ['intent.md', 'spec.md', 'plan.md', 'finding.md']
const CHAIN = ['intent', 'spec', 'plan']

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null }
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))
const ROOT = resolve(positional[0] ?? process.cwd())
const SINCE_ARG = flag('since')
const SET_ARG = flag('set')

const die = (msg) => { console.error(msg); process.exit(2) }

let SINCE = null
if (SINCE_ARG != null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE_ARG)) die(`--since takes YYYY-MM-DD — got \`${SINCE_ARG}\`.`)
  SINCE = Math.floor(Date.parse(`${SINCE_ARG}T00:00:00Z`) / 1000)
  if (Number.isNaN(SINCE)) die(`--since is not a real date — \`${SINCE_ARG}\`.`)
}

/** Same one-key regex reader check-all.mjs uses; a YAML parser is not worth a dependency here. */
const yml = (key, file) => {
  if (!existsSync(file)) return ''
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(readFileSync(file, 'utf8'))
  return m ? m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : ''
}

const profile = join(ROOT, '.claude/spec-profile.yml')
if (!existsSync(profile)) die(`No SDLC profile — ${relative(ROOT, profile) || '.claude/spec-profile.yml'} does not exist.`)

const git = (...a) => {
  try { return execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }) }
  catch { return null }
}
if (git('rev-parse', '--git-dir') == null) die(`Not a git repository — ${ROOT}. Every indicator here is derived from history.`)
/** An empty repository has no HEAD; git log would fail on every path and look like "no history". */
const HAS_HEAD = git('rev-parse', '--verify', 'HEAD') != null

const specDir = resolve(ROOT, yml('spec_dir', profile) || '.sdlc/specs')
const logDir = resolve(ROOT, yml('verify_log_dir', profile) || '.sdlc/verify')

const sets = []
const walk = (dir) => {
  if (!existsSync(dir)) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch (e) { die(e.message) }
  if (entries.some((e) => e.isFile() && DOCS.includes(e.name))) sets.push(dir)
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name))
}
walk(specDir)

if (SET_ARG) {
  const want = resolve(ROOT, SET_ARG)
  const keep = sets.filter((d) => d === want)
  if (!keep.length) die(`--set ${SET_ARG} is not an artifact set under ${relative(ROOT, specDir)}.`)
  sets.length = 0
  sets.push(...keep)
}

// ── history ────────────────────────────────────────────────────────────────────────────────────

/** Commit history of one document, oldest first.
 *
 * `--follow` is deliberate: an artifact set that was renamed keeps one lifetime, so "first commit"
 * means the first commit of the file's *content lineage*, not of its current path. That is the
 * number a lead time wants — a directory rename must not restart the clock. `--name-only` gives
 * the path as of each commit so the blob can still be read after a rename.
 *
 * The reversal is done here rather than with `--reverse`: git's rename following is part of the
 * revision walk, and `--follow --reverse` together emit only the oldest commit. That silently
 * truncated every history to its birth, which made every status transition invisible and every
 * lead time «never accepted» — a wrong answer that looked exactly like a correct one. */
function history(path) {
  if (!HAS_HEAD) return []
  const rel = relative(ROOT, path)
  const out = git('log', '--format=%H%x09%ct', '--follow', '--name-only', '--', rel)
  if (out == null) return []
  const commits = []
  let cur = null
  for (const line of out.split('\n')) {
    const head = /^([0-9a-f]{7,64})\t(\d+)$/.exec(line)
    if (head) { cur = { sha: head[1], at: Number(head[2]), path: rel }; commits.push(cur); continue }
    if (cur && line.trim() && !cur.named) { cur.path = line.trim(); cur.named = true }
  }
  /** `--follow` turns on copy detection at the commit that adds the file, so a spec.md born next
   * to an intent.md it resembles — two short documents whose frontmatter is most of their bytes —
   * inherits the intent's history and reports a lead time of 0. A chain document's filename is
   * fixed (artifact-parse's CHAIN_FILES), so a followed path with a different basename is never
   * this document's past. Keep the rename following, drop the copies. */
  const name = basename(rel)
  const own = commits.filter((c) => basename(c.path) === name)
  own.reverse()
  for (const c of own) c.fm = frontmatter(git('show', `${c.sha}:${c.path}`) ?? '') ?? {}
  return own
}

/** Timestamp of the first commit whose frontmatter status equals `status`, or null. */
const firstAt = (commits, status) => commits.find((c) => c.fm.status === status)?.at ?? null
/** True when the document's very first commit already carried the status — the transition into it
 * happened before the document entered git, so a lead time computed from it is 0 by construction
 * rather than by measurement. Reported as 0 with a note instead of hidden, because "the work
 * predates the document" is itself a finding about the process. */
const bornAt = (commits, status) => commits.length > 0 && commits[0].fm.status === status

/** Count of accepted → in_review transitions: the harness's rework cycle. Only a direct pair
 * counts — plan's accepted → in_progress → in_review is execution, not a review return. */
function reviewReturns(commits) {
  let n = 0
  for (let i = 1; i < commits.length; i++) {
    if (commits[i - 1].fm.status === 'accepted' && commits[i].fm.status === 'in_review') n++
  }
  return n
}

/** Commits carrying `SDLC-Plan: <this set's plan>`, oldest first. The plan path pins the trailer
 * to this set — the same WP id in another set is a different task, per references/tasks.md. */
function taskCommits(planRel) {
  if (!HAS_HEAD) return []
  const out = git('log', '--reverse', '--format=%H%x09%ct%x1f%B%x1e')
  if (out == null) return []
  const want = `SDLC-Plan: ${planRel}`
  return out.split('\x1e').map((rec) => {
    const [head, body = ''] = rec.trim().split('\x1f')
    const m = /^([0-9a-f]{7,64})\t(\d+)$/.exec((head ?? '').trim())
    if (!m) return null
    if (!body.split('\n').some((l) => l.trim() === want)) return null
    return { sha: m[1], at: Number(m[2]) }
  }).filter(Boolean)
}

/** Every commit touching anything inside the set directory, oldest first. */
function setCommits(dir) {
  if (!HAS_HEAD) return []
  const out = git('log', '--reverse', '--format=%H%x09%ct', '--', relative(ROOT, dir))
  if (out == null) return []
  return out.split('\n').map((l) => /^([0-9a-f]{7,64})\t(\d+)$/.exec(l)).filter(Boolean)
    .map((m) => ({ sha: m[1], at: Number(m[2]) }))
}

/** Verify logs for the set. The header above `---` is verify-run.mjs's contract: `label:` is
 * present only for an extra gate, so its absence marks a full-verify run, and `exit:` is the
 * result. Reading the body would be reading truncated debugging material. */
function verifyLogs(dir) {
  const d = join(logDir, basename(dir))
  if (!existsSync(d)) return []
  let names
  try { names = readdirSync(d) } catch { return [] }
  return names.filter((n) => n.endsWith('.log')).map((n) => {
    const head = readFileSync(join(d, n), 'utf8').split('\n---\n')[0]
    const kv = Object.fromEntries(head.split('\n').map((l) => l.split(/:\s(.*)/s)).filter((a) => a.length > 1)
      .map(([k, v]) => [k.trim(), v.trim()]))
    return { file: n, label: kv.label ?? null, exit: Number(kv.exit ?? NaN), date: kv.date ?? '' }
  })
}

// ── metric constructors ────────────────────────────────────────────────────────────────────────

const secs = (from, to, note) => (note ? { seconds: to - from, note } : { seconds: to - from })
const count = (n) => ({ count: n })
const share = (num, den) => ({ share: den === 0 ? 0 : num / den, numerator: num, denominator: den })
const no = (reason) => ({ unmeasured: reason })
const isValue = (m) => m != null && !('unmeasured' in m)

const KIND = {
  intent_lead: 'duration', spec_lead: 'duration', plan_lead: 'duration', build_lead: 'duration',
  finding_route_lead: 'duration', wall_days: 'duration',
  intent_rework: 'count', spec_rework_after_build: 'count', review_returns: 'count',
  set_commits: 'count', doc_chars: 'count', usage_tokens: 'count', usage_cost: 'count',
  plan_deviation_share: 'share', verify_first_pass: 'share',
}

/** Output order and the playbook stage each indicator belongs to. */
const METRICS = [
  ['intent_lead', 'Plan / intent-to-commit time'],
  ['intent_rework', 'Plan / intent rework after spec'],
  ['spec_lead', 'Design / spec lead time'],
  ['spec_rework_after_build', 'Design / spec rework after build starts'],
  ['plan_lead', 'Build / plan lead time'],
  ['build_lead', 'Build / plan-to-completion time'],
  ['plan_deviation_share', 'Build / diff-to-plan deviation'],
  ['review_returns', 'Build / review returns'],
  ['verify_first_pass', 'Test / first-pass verify success'],
  ['finding_route_lead', 'Maintain / breach-to-route time'],
  ['doc_chars', 'Cost / document characters'],
  ['usage_tokens', 'Cost / model tokens recorded'],
  ['usage_cost', 'Cost / recorded token spend'],
  ['set_commits', 'Cost / commits in the set'],
  ['wall_days', 'Cost / wall-clock span'],
]

// ── per-set measurement ────────────────────────────────────────────────────────────────────────

/** Characters without whitespace, the same measure lint-prose.mjs budgets against: lines outside
 * code fences, frontmatter removed, template comments removed. */
const docChars = (d) =>
  stripComments(d.lines.filter((_, i) => d.live[i]).join('').replace(/^---[\s\S]*?---/, '')).replace(/\s+/g, '').length

/** §Execution log deviation share.
 *
 * The denominator is every WP id named in the section, because `mark` groups the ids of tasks that
 * went to plan onto one line — counting lines would make a well-behaved day look like a single
 * task. The numerator is the ids on lines whose note after the deviation label is not a
 * "none" alias, for the same reason. */
function deviationShare(planDoc) {
  if (!planDoc) return no('no plan.md')
  const body = stripComments(planDoc.lines.filter((_, i) => planDoc.live[i]).join('\n'))
  const block = sectionBlock(SECTION.executionLog).exec(body)?.[0]
  if (!block) return no('no §Execution log section')
  const lines = block.split('\n').slice(1)
  if (lines.some((l) => RE_NA.test(l))) return no('§Execution log is N/A — nothing executed yet')
  const all = new Set()
  const deviated = new Set()
  for (const line of lines) {
    const ids = idsIn(line).filter((x) => x.startsWith('WP-'))
    if (!ids.length) continue
    for (const id of ids) all.add(id)
    const m = RE_DIVERGENCE.exec(line)
    if (!m) continue
    const note = line.slice(m.index + m[0].length).trim()
    if (note && !hasAlias(note, NO_DIVERGENCE)) for (const id of ids) deviated.add(id)
  }
  if (!all.size) return no('§Execution log names no WP task')
  return share(deviated.size, all.size)
}

function measure(dir) {
  const rel = relative(ROOT, dir)
  const docs = loadDir(dir, () => {})
  const commits = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, history(d.path)]))
  const all = setCommits(dir)
  const planRel = docs.plan ? relative(ROOT, docs.plan.path) : null
  const tasks = planRel ? taskCommits(planRel) : []
  const logs = verifyLogs(dir)

  const id = String(docs.intent?.fm?.id ?? docs.finding?.fm?.id ?? '').trim() || basename(dir)
  const docInfo = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, {
    status: String(d.fm.status ?? '') || null,
    approved_by: isNull(d.fm.approved_by) ? null : String(d.fm.approved_by),
    routed_to: isNull(d.fm.routed_to) ? null : String(d.fm.routed_to),
    commits: commits[k].length,
    chars: docChars(d),
    tracked: commits[k].length > 0,
  }]))

  const m = {}
  const uncommitted = (kind) => {
    const d = docs[kind]
    if (!d) return `no ${kind}.md`
    if (!commits[kind].length) return `${kind}.md is not committed`
    return null
  }

  // ── Plan stage
  const intentAccepted = docs.intent ? firstAt(commits.intent, 'accepted') : null
  m.intent_lead = (() => {
    const why = uncommitted('intent')
    if (why) return no(why)
    if (intentAccepted == null) return no(`intent is ${docInfo.intent.status ?? 'unset'}, never accepted`)
    return secs(commits.intent[0].at, intentAccepted,
      bornAt(commits.intent, 'accepted') ? 'created already accepted — the decision predates the document' : undefined)
  })()

  m.intent_rework = (() => {
    const why = uncommitted('intent') ?? uncommitted('spec')
    if (why) return no(why)
    const specBorn = commits.spec[0].at
    return count(commits.intent.filter((c) => c.at > specBorn).length)
  })()

  // ── Design stage
  const specAccepted = docs.spec ? firstAt(commits.spec, 'accepted') : null
  m.spec_lead = (() => {
    const why = uncommitted('intent') ?? uncommitted('spec')
    if (why) return no(why)
    if (intentAccepted == null) return no('intent was never accepted')
    if (specAccepted == null) return no(`spec is ${docInfo.spec.status ?? 'unset'}, never accepted`)
    return secs(intentAccepted, specAccepted)
  })()

  /** Build starts at whichever came first: the plan turning in_progress, or the first commit
   * attributed to one of its tasks. A repository that commits tasks before flipping the status
   * still has a real build start, and the earlier of the two is the honest one. */
  const buildStart = (() => {
    const byStatus = docs.plan ? firstAt(commits.plan ?? [], 'in_progress') : null
    const byTask = tasks.length ? tasks[0].at : null
    const both = [byStatus, byTask].filter((x) => x != null)
    return both.length ? Math.min(...both) : null
  })()

  m.spec_rework_after_build = (() => {
    const why = uncommitted('spec')
    if (why) return no(why)
    if (buildStart == null) return no('build has not started — no in_progress plan and no task commit')
    return count(commits.spec.filter((c) => c.at > buildStart).length)
  })()

  // ── Build stage
  const planAccepted = docs.plan ? firstAt(commits.plan, 'accepted') : null
  m.plan_lead = (() => {
    const why = uncommitted('spec') ?? uncommitted('plan')
    if (why) return no(why)
    if (specAccepted == null) return no('spec was never accepted')
    if (planAccepted == null) return no(`plan is ${docInfo.plan.status ?? 'unset'}, never accepted`)
    return secs(specAccepted, planAccepted)
  })()

  m.build_lead = (() => {
    const why = uncommitted('plan')
    if (why) return no(why)
    const done = firstAt(commits.plan, 'completed')
    if (planAccepted == null && done == null) return no(`plan is ${docInfo.plan.status ?? 'unset'}, never accepted`)
    if (done == null) {
      const s = docInfo.plan.status
      return no(s === 'in_progress' ? 'in progress' : s === 'accepted' ? 'not started' : `plan is ${s ?? 'unset'}, never completed`)
    }
    if (planAccepted == null) return no('plan was completed without an accepted commit in history')
    return secs(planAccepted, done)
  })()

  m.plan_deviation_share = deviationShare(docs.plan)

  m.review_returns = (() => {
    const present = CHAIN.filter((k) => docs[k])
    if (!present.length) return no('no intent.md, spec.md or plan.md')
    const tracked = present.filter((k) => commits[k].length)
    if (!tracked.length) return no('no chain document is committed')
    return count(tracked.reduce((n, k) => n + reviewReturns(commits[k]), 0))
  })()

  // ── Test stage
  m.verify_first_pass = (() => {
    const full = logs.filter((l) => !l.label)
    if (!logs.length) return no(`no verify log under ${relative(ROOT, join(logDir, basename(dir)))}`)
    if (!full.length) return no(`${logs.length} verify log(s), all labelled gate runs — no full verify`)
    return share(full.filter((l) => l.exit === 0).length, full.length)
  })()

  // ── Maintain stage
  m.finding_route_lead = (() => {
    const why = uncommitted('finding')
    if (why) return no(why)
    const routed = commits.finding.find((c) => !isNull(c.fm.routed_to))
    if (!routed) return no('finding has no routed_to yet')
    return secs(commits.finding[0].at, routed.at,
      routed === commits.finding[0] ? 'created already routed' : undefined)
  })()

  // ── Cost
  const chars = Object.fromEntries(CHAIN.filter((k) => docs[k]).map((k) => [k, docInfo[k].chars]))
  m.doc_chars = Object.keys(chars).length
    ? { count: Object.values(chars).reduce((a, b) => a + b, 0), by_doc: chars }
    : no('no intent.md, spec.md or plan.md (a finding size is under docs.finding.chars)')

  /** The one indicator here that is captured rather than derived. A session transcript is not in
   * the repository and does not survive, so there is nothing to reconstruct it from later; the
   * gate writes it down when the artifact is edited and this only reads it back. An absent ledger
   * is `unmeasured`, never 0 — a set whose usage was never recorded and a set that cost nothing
   * would otherwise land in the same median and drag it. */
  const usage = usageTotal(ledgerFor(ROOT, basename(dir)))
  m.usage_tokens = usage.unmeasured ? no(usage.unmeasured) : { count: usage.total_tokens, by_bucket: usage.tokens }
  m.usage_cost = usage.unmeasured
    ? no(usage.unmeasured)
    : usage.micro_usd == null
      ? no(`priced models only — no published rate for ${usage.unpriced_models.join(', ')}`)
      : { count: usage.micro_usd, ...(usage.assumptions.length ? { assumptions: usage.assumptions } : {}) }

  m.set_commits = all.length ? count(all.length) : no('not committed')
  m.wall_days = all.length
    ? secs(all[0].at, all[all.length - 1].at, all.length === 1 ? 'a single commit' : undefined)
    : no('not committed')

  return {
    dir: rel, id, docs: docInfo, metrics: m,
    _bornAt: all.length ? all[0].at : null,
    _routed: docInfo.finding?.routed_to ?? null,
    _isFinding: !!docs.finding,
    _intentStatus: docInfo.intent?.status ?? null,
  }
}

const measured = sets.map(measure)
const kept = SINCE == null ? measured : measured.filter((s) => s._bornAt != null && s._bornAt >= SINCE)

// ── aggregation ────────────────────────────────────────────────────────────────────────────────

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const aggregate = {}
for (const [key] of METRICS) {
  const vals = kept.map((s) => s.metrics[key]).filter(isValue)
  if (!vals.length) { aggregate[key] = no('no set has this value'); continue }
  if (KIND[key] === 'duration') aggregate[key] = { sets: vals.length, median_seconds: median(vals.map((v) => v.seconds)) }
  else if (KIND[key] === 'count') aggregate[key] = { sets: vals.length, median: median(vals.map((v) => v.count)), total: vals.reduce((a, v) => a + v.count, 0) }
  else aggregate[key] = {
    sets: vals.length, median_share: median(vals.map((v) => v.share)),
    numerator: vals.reduce((a, v) => a + v.numerator, 0), denominator: vals.reduce((a, v) => a + v.denominator, 0),
  }
}

/** Intent survival is a share over sets, not a per-set value: a single intent either lived or did
 * not. Its denominator is only the intents that were actually decided — an intent still in review
 * has not survived anything yet, and counting it as a death would make the number improve simply
 * by leaving intents open. */
aggregate.intent_survival = (() => {
  const decided = kept.filter((s) => ['accepted', 'rejected'].includes(s._intentStatus ?? ''))
  if (!decided.length) return no('no set has an accepted or rejected intent')
  const alive = decided.filter((s) => s._intentStatus === 'accepted').length
  return { share: alive / decided.length, numerator: alive, denominator: decided.length }
})()

aggregate.finding_routes = (() => {
  const findings = kept.filter((s) => s._isFinding)
  if (!findings.length) return no('no finding in range')
  const routes = { intent: 0, patch: 0, dismiss: 0, other: 0, unrouted: 0 }
  for (const s of findings) {
    const r = s._routed
    if (!r) { routes.unrouted++; continue }
    const kind = ['intent', 'patch', 'dismiss'].find((k) => r.startsWith(`${k}:`))
    routes[kind ?? 'other']++
  }
  return { routes, findings: findings.length }
})()

// ── output ─────────────────────────────────────────────────────────────────────────────────────

for (const s of kept) { delete s._bornAt; delete s._routed; delete s._isFinding; delete s._intentStatus }

if (JSON_OUT) {
  console.log(JSON.stringify({
    version: 1, root: ROOT, spec_dir: relative(ROOT, specDir), verify_log_dir: relative(ROOT, logDir),
    generated_at: new Date().toISOString(), sets: kept, aggregate,
  }, null, 2))
  process.exit(0)
}

const human = (n) => {
  const s = Math.abs(n)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h` }
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600)
  return h ? `${d}d ${h}h` : `${d}d`
}

const show = (key, v) => {
  if (!isValue(v)) return `unmeasured — ${v.unmeasured}`
  if (KIND[key] === 'duration') return `${human(v.seconds)}${v.note ? `  (${v.note})` : ''}`
  if (KIND[key] === 'share') return `${v.numerator}/${v.denominator}  (${Math.round(v.share * 100)}%)` +
    (key === 'verify_first_pass' && v.denominator - v.numerator ? `  ${v.denominator - v.numerator} failed` : '')
  if (key === 'doc_chars') return `${v.count}  (${Object.entries(v.by_doc).map(([k, n]) => `${k} ${n}`).join(' · ')})`
  if (key === 'usage_tokens') return `${v.count.toLocaleString()}  (in ${v.by_bucket.input.toLocaleString()} · cache write ` +
    `${(v.by_bucket.cache_5m + v.by_bucket.cache_1h).toLocaleString()} · cache read ${v.by_bucket.cache_read.toLocaleString()} · ` +
    `out ${v.by_bucket.output.toLocaleString()})`
  // Micro-USD is what the ledger stores, because a float total is not reproducible. Only the
  // rendering turns it into money.
  if (key === 'usage_cost') return formatUsd(v.count) + (v.assumptions?.length ? `  (assumed: ${v.assumptions.join('; ')})` : '')
  return String(v.count)
}

const WIDTH = Math.max(...METRICS.map(([, l]) => l.length))
const pad = (s) => s + ' '.repeat(Math.max(0, WIDTH - s.length))

console.log(`sdlc metrics — ${ROOT}`)
console.log(`  spec_dir ${relative(ROOT, specDir)} · verify_log_dir ${relative(ROOT, logDir)} · ${kept.length} set(s)` +
  (SINCE_ARG ? ` since ${SINCE_ARG}` : '') + (SET_ARG ? ` · --set ${SET_ARG}` : ''))
if (kept.length !== measured.length) console.log(`  ${measured.length - kept.length} set(s) filtered out`)

for (const s of kept) {
  console.log(`\n${s.dir}  (${s.id})`)
  const states = Object.entries(s.docs).map(([k, d]) => `${k} ${d.status ?? '(no status)'}${d.tracked ? '' : ' [uncommitted]'}`)
  console.log(`  ${pad('docs')}  ${states.join(' · ')}`)
  for (const [key, label] of METRICS) console.log(`  ${pad(label)}  ${show(key, s.metrics[key])}`)
}

console.log('\nAggregate')
if (!kept.length) console.log('  no artifact set in range — nothing to aggregate')
for (const [key, label] of METRICS) {
  const a = aggregate[key]
  if (!isValue(a)) { console.log(`  ${pad(label)}  unmeasured — ${a.unmeasured}`); continue }
  if (KIND[key] === 'duration') console.log(`  ${pad(label)}  median ${human(a.median_seconds)}  (${a.sets} set(s))`)
  else if (key === 'usage_cost') console.log(`  ${pad(label)}  median ${formatUsd(a.median)}  total ${formatUsd(a.total)}  (${a.sets} set(s))`)
  else if (KIND[key] === 'count') console.log(`  ${pad(label)}  median ${a.median.toLocaleString()}  total ${a.total.toLocaleString()}  (${a.sets} set(s))`)
  else console.log(`  ${pad(label)}  median ${Math.round(a.median_share * 100)}%  ${a.numerator}/${a.denominator} overall  (${a.sets} set(s))`)
}
const surv = aggregate.intent_survival
console.log(`  ${pad('Plan / intent survival')}  ` + (isValue(surv)
  ? `${surv.numerator}/${surv.denominator}  (${Math.round(surv.share * 100)}%)` : `unmeasured — ${surv.unmeasured}`))
const routes = aggregate.finding_routes
console.log(`  ${pad('Maintain / finding routes')}  ` + (isValue(routes)
  ? Object.entries(routes.routes).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'none routed'
  : `unmeasured — ${routes.unmeasured}`))

process.exit(0)
