#!/usr/bin/env node
/** Record what an artifact cost in model tokens, next to the verify logs that record what it did.
 *
 * Usage:
 *   usage-ledger.mjs record --set <set dir> --doc <file> [--transcript <jsonl>] [--session <id>]
 *   usage-ledger.mjs report [root] [--set <set dir>] [--json]
 *
 * ## Why this is a ledger and not a field in the document
 *
 * conventions.md's rule is that evidence is derived, never written down: `plan-progress.mjs`
 * reconstructs what happened from trailers and log headers rather than believing §Execution log.
 * A token count cannot be derived from the repository — it exists only in the session transcript,
 * which is not in git and is deleted on its own schedule. So it is captured, not derived. Putting
 * it in the artifact's frontmatter would make the document assert its own cost, which is exactly
 * the claim the harness refuses to trust anywhere else. It goes beside the verify logs instead:
 * the same place, the same lifetime, the same "written once when it happened" rule.
 *
 * ## Why a snapshot copies its rates
 *
 * Rates change. Repricing old tokens with today's table rewrites what last quarter cost, silently
 * and with no way to notice. Every snapshot copies the rate rows it applied, so `report` only ever
 * adds up numbers that were computed when the work happened. `pricing.mjs` is read for new
 * snapshots and never for old ones.
 *
 * ## Why deltas need a cursor outside the ledger
 *
 * A transcript's usage is cumulative for the whole session, so the number that belongs to one
 * artifact is the growth since that session was last recorded. If the base were "the last snapshot
 * in this set's ledger", a session that touched two sets would have its whole cumulative charged
 * to both. The base is therefore the session's last recorded point *anywhere* in the repository,
 * kept in `.sessions.json` beside the ledgers.
 *
 * ## JSON shape, version 1 — keep this stable
 *
 * { "version": 1, "set": "<dir basename>", "snapshots": [ <snapshot>, ... ] }
 *
 * A <snapshot> is either measured:
 *   { "at": "<ISO 8601, UTC>", "doc": "spec.md", "session": "<id>", "messages": 12,
 *     "tokens": { "<rate key>": { "input": n, "output": n, "cache_5m": n, "cache_1h": n, "cache_read": n } },
 *     "micro_usd": 12345 | null, "by_model_micro_usd": { "<rate key>": n },
 *     "rates": { "<rate key>": { ... } }, "rates_as_of": "<date>",
 *     "unpriced_models": [ ... ], "assumptions": [ ... ] }
 * or not:
 *   { "at": "...", "doc": "spec.md", "unmeasured": "<reason>" }
 *
 * `micro_usd` is null exactly when `unpriced_models` is non-empty — a total that quietly left a
 * model out would be indistinguishable from a complete one.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs'
import { resolve, join, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RATES, RATES_AS_OF, BUCKETS, costMicroUsd, formatUsd } from '../pricing.mjs'

/** Nearest ancestor holding a profile, so `record` can be called from a hook with any cwd. */
export function findRoot(from) {
  for (let root = resolve(from), previous = null; root !== previous; previous = root, root = resolve(root, '..')) {
    if (existsSync(join(root, '.claude/spec-profile.yml'))) return root
  }
  return null
}

/** Same one-key regex reader the other tools use; a YAML parser is not worth a dependency. */
const yml = (key, file) => {
  if (!existsSync(file)) return ''
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(readFileSync(file, 'utf8'))
  return m ? m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : ''
}

/** Where a repository's ledgers live. Exported so sdlc-metrics.mjs resolves it the one way.
 *
 * Nothing here reads argv or exits: this module is imported by the metrics tool, and a tool that
 * dies on import would take the whole report down over a directory that is allowed to be absent. */
export const usageDir = (root) =>
  join(resolve(root, yml('verify_log_dir', join(root, '.claude/spec-profile.yml')) || '.sdlc/verify'), 'usage')

const readJson = (path, fallback) => {
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

/** Write through a temp file: the gate fires on every artifact edit, and a half-written ledger
 * would be read back as "no usage recorded" rather than as a broken file. */
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(tmp, path)
}

// ── transcript ─────────────────────────────────────────────────────────────────────────────────

const ZERO = () => ({ input: 0, output: 0, cache_5m: 0, cache_1h: 0, cache_read: 0 })

/** Cumulative token buckets of one session transcript, keyed by rate key (`<model>` or
 * `<model>#fast`).
 *
 * `usage` repeats on every content block of the same message, so a naive sum multiplies a long
 * message by its block count. Counting one value per `message.id` is what makes the total match
 * what was billed. */
export function scanTranscript(path) {
  const seen = new Set()
  const tokens = {}
  const assumptions = new Set()
  let messages = 0
  let session = null

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    const message = rec.message
    const usage = message?.usage
    if (!usage) continue
    session ??= rec.sessionId ?? null
    const id = message.id ?? `${rec.uuid ?? messages}`
    if (seen.has(id)) continue
    seen.add(id)
    messages++

    const model = message.model ?? 'unknown'
    const key = usage.speed === 'fast' ? `${model}#fast` : model
    const bucket = (tokens[key] ??= ZERO())
    bucket.input += usage.input_tokens ?? 0
    bucket.output += usage.output_tokens ?? 0
    bucket.cache_read += usage.cache_read_input_tokens ?? 0

    const created = usage.cache_creation
    if (created && ('ephemeral_1h_input_tokens' in created || 'ephemeral_5m_input_tokens' in created)) {
      bucket.cache_1h += created.ephemeral_1h_input_tokens ?? 0
      bucket.cache_5m += created.ephemeral_5m_input_tokens ?? 0
    } else if (usage.cache_creation_input_tokens) {
      // Older transcripts report one cache-creation number with no TTL. The 1-hour rate is the
      // higher of the two, so this never under-reports a cost — but it is an assumption about an
      // input, not a measurement, and it says so in the snapshot.
      bucket.cache_1h += usage.cache_creation_input_tokens
      assumptions.add('cache_creation reported without a TTL split; priced at the 1-hour write rate')
    }
  }
  return { session, messages, tokens, assumptions: [...assumptions] }
}

/** Per-rate-key cost. `micro_usd` is null when any key has no published rate — see the header. */
export function price(tokens) {
  const rates = {}
  const byModel = {}
  const unpriced = []
  let total = 0
  for (const [key, buckets] of Object.entries(tokens)) {
    const row = RATES[key]
    if (!row) { unpriced.push(key); continue }
    rates[key] = row
    byModel[key] = Object.keys(BUCKETS).reduce((sum, b) => sum + costMicroUsd(buckets[b], row[b]), 0)
    total += byModel[key]
  }
  return { micro_usd: unpriced.length ? null : total, by_model_micro_usd: byModel, rates, unpriced_models: unpriced.sort() }
}

const subtract = (now, before) => {
  const out = {}
  let rewound = false
  for (const [key, buckets] of Object.entries(now)) {
    const base = before?.[key] ?? ZERO()
    const delta = ZERO()
    for (const b of Object.keys(BUCKETS)) {
      const d = buckets[b] - (base[b] ?? 0)
      // A transcript that shrank was rotated or replaced; the session id no longer identifies the
      // same history, so the base is meaningless and the whole current value is the honest delta.
      if (d < 0) { rewound = true; delta[b] = buckets[b] } else delta[b] = d
    }
    if (Object.values(delta).some((n) => n > 0)) out[key] = delta
  }
  return { delta: out, rewound }
}

// ── record ─────────────────────────────────────────────────────────────────────────────────────

const ledgerPath = (root, setName) => join(usageDir(root), `${setName}.json`)
const cursorPath = (root) => join(usageDir(root), '.sessions.json')

/** Append one snapshot for `setDir`. Returns null on success, or the reason nothing was measured.
 *
 * It never throws for a missing or unreadable transcript: this runs from a PostToolUse hook, and
 * failing an artifact edit over bookkeeping would be a worse bug than a gap in the ledger. The gap
 * is still written down — an absent snapshot and a zero-cost one must not read the same. */
export function record(root, { setDir, doc, transcript, session: sessionArg, now = new Date() }) {
  const setName = basename(resolve(root, setDir))
  const path = ledgerPath(root, setName)
  const ledger = readJson(path, { version: 1, set: setName, snapshots: [] })
  const at = now.toISOString()
  const docName = doc ? basename(doc) : null

  const note = (reason) => {
    ledger.snapshots.push({ at, doc: docName, unmeasured: reason })
    writeJson(path, ledger)
    return reason
  }

  if (!transcript) return note('no transcript path was supplied')
  if (!existsSync(transcript)) return note(`transcript not found — ${transcript}`)

  let scan
  try { scan = scanTranscript(transcript) } catch (e) { return note(`transcript could not be read — ${e.message}`) }
  const session = sessionArg ?? scan.session
  if (!session) return note('transcript carries no session id, so a delta has no base')

  const cursors = readJson(cursorPath(root), { version: 1, sessions: {} })
  const { delta, rewound } = subtract(scan.tokens, cursors.sessions?.[session]?.cumulative)
  if (!Object.keys(delta).length) return note('no token usage since this session was last recorded')

  const priced = price(delta)
  const assumptions = [...scan.assumptions]
  if (rewound) assumptions.push('the transcript shrank since the last snapshot; charged in full rather than as a delta')

  ledger.snapshots.push({
    at, doc: docName, session, messages: scan.messages,
    tokens: delta, ...priced, rates_as_of: RATES_AS_OF, assumptions,
  })
  writeJson(path, ledger)

  cursors.sessions ??= {}
  cursors.sessions[session] = { at, cumulative: scan.tokens }
  writeJson(cursorPath(root), cursors)
  return null
}

// ── read ───────────────────────────────────────────────────────────────────────────────────────

/** Every ledger under the repository's usage directory, oldest name first. */
export function ledgers(root) {
  const dir = usageDir(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort()
    .map((n) => readJson(join(dir, n), null)).filter((l) => l && l.version === 1)
}

/** One set's ledger by directory name, or null when it was never recorded. */
export const ledgerFor = (root, setName) => readJson(ledgerPath(root, setName), null)

/** Totals of one ledger. Returns `{ unmeasured }` when nothing in it carries a number, so a set
 * that was never recorded and a set that genuinely cost nothing stay distinguishable. */
export function total(ledger) {
  if (!ledger || ledger.version !== 1) return { unmeasured: 'no usage ledger for this set' }
  const measured = ledger.snapshots.filter((s) => !s.unmeasured)
  if (!measured.length) {
    return { set: ledger.set, unmeasured: ledger.snapshots.at(-1)?.unmeasured ?? 'the ledger holds no snapshot' }
  }
  const tokens = ZERO()
  const assumptions = new Set()
  const unpriced = new Set()
  let micro = 0
  for (const s of measured) {
    for (const buckets of Object.values(s.tokens)) for (const b of Object.keys(BUCKETS)) tokens[b] += buckets[b] ?? 0
    for (const a of s.assumptions ?? []) assumptions.add(a)
    for (const m of s.unpriced_models ?? []) unpriced.add(m)
    if (s.micro_usd != null) micro += s.micro_usd
  }
  return {
    set: ledger.set, snapshots: measured.length, skipped: ledger.snapshots.length - measured.length,
    tokens, total_tokens: Object.values(tokens).reduce((a, b) => a + b, 0),
    // A total that quietly left an unpriced model out would be indistinguishable from a complete
    // one, and it is the complete one a cost report is read as.
    micro_usd: unpriced.size ? null : micro,
    unpriced_models: [...unpriced].sort(), assumptions: [...assumptions],
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────

function main(argv) {
  const cmd = argv[0] === 'record' || argv[0] === 'report' ? argv.shift() : 'report'
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null }
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))
  const die = (msg) => { console.error(msg); process.exit(2) }

  const root = resolve(flag('root') ?? positional[0] ?? findRoot(process.cwd()) ?? process.cwd())
  if (!existsSync(join(root, '.claude/spec-profile.yml'))) die(`No SDLC profile under ${root} — nothing to record usage against.`)

  if (cmd === 'record') {
    const setDir = flag('set')
    if (!setDir) die('record needs --set <artifact set directory>.')
    const reason = record(root, { setDir, doc: flag('doc'), transcript: flag('transcript'), session: flag('session') })
    // Never fail a hook over bookkeeping, but never let a skipped recording pass in silence.
    if (reason) console.error(`sdlc usage: not recorded — ${reason}`)
    return
  }

  const only = flag('set') ? basename(resolve(root, flag('set'))) : null
  const totals = ledgers(root).filter((l) => !only || l.set === only).map(total)

  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      version: 1, root, usage_dir: relative(root, usageDir(root)),
      generated_at: new Date().toISOString(), sets: totals,
    }, null, 2))
    return
  }

  console.log(`sdlc usage — ${root}`)
  console.log(`  ${relative(root, usageDir(root))} · ${totals.length} ledger(s)${only ? ` · --set ${only}` : ''}`)
  if (!totals.length) {
    console.log('  nothing recorded yet — that is "not measured", not "cost nothing"')
    return
  }
  let grand = 0
  let complete = true
  for (const t of totals) {
    if (t.unmeasured) { console.log(`\n${t.set ?? '(unnamed)'}\n  unmeasured — ${t.unmeasured}`); complete = false; continue }
    console.log(`\n${t.set}  (${t.snapshots} snapshot(s)${t.skipped ? `, ${t.skipped} unmeasured` : ''})`)
    console.log(`  tokens   in ${t.tokens.input.toLocaleString()} · cache write ${(t.tokens.cache_5m + t.tokens.cache_1h).toLocaleString()}` +
      ` · cache read ${t.tokens.cache_read.toLocaleString()} · out ${t.tokens.output.toLocaleString()}`)
    if (t.micro_usd == null) { console.log(`  cost     unmeasured — no published rate for ${t.unpriced_models.join(', ')}`); complete = false }
    else { console.log(`  cost     ${formatUsd(t.micro_usd)}`); grand += t.micro_usd }
    for (const a of t.assumptions) console.log(`  assumed  ${a}`)
  }
  console.log(`\nTotal      ${formatUsd(grand)}${complete ? '' : '  — incomplete; some sets above are unmeasured'}`)
}

// Imported by sdlc-metrics.mjs for the read helpers above, so the CLI runs only when invoked.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
