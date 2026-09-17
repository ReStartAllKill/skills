/** usage-ledger.mjs and pricing.mjs against hand-written transcripts.
 *
 * The transcripts here are minimal but shaped exactly like a real one, because every bug this
 * tool can have is a shape bug: `usage` repeating per content block, the cache-creation TTL split
 * being absent on older lines, a session's cumulative total being charged twice. A test that fed
 * it tidy pre-summed numbers would pass while the tool double-counted every long message. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { RATES, costMicroUsd, formatUsd } from '../pricing.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = resolve(HERE, '../tools/usage-ledger.mjs')

const temp = () => mkdtempSync(join(tmpdir(), 'usage-'))
const put = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body) }

/** A repository with a profile and one artifact set directory. */
function repo() {
  const dir = temp()
  put(join(dir, '.claude/spec-profile.yml'), 'sdlc_version: 7\nspec_dir: ".sdlc/specs"\nverify_log_dir: ".sdlc/verify"\n')
  mkdirSync(join(dir, '.sdlc/specs/set-a'), { recursive: true })
  return dir
}

/** One assistant line. `blocks` repeats the same usage object, the way a multi-block message does. */
const line = (id, model, usage, session = 's1', blocks = 1) =>
  Array.from({ length: blocks }, () =>
    JSON.stringify({ type: 'assistant', sessionId: session, message: { id, model, usage } })).join('\n')

const usage = (o = {}) => ({
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0,
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }, ...o,
})

function tool(...args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', out: (r.stdout ?? '') + (r.stderr ?? '') }
}
const ledger = (root) => JSON.parse(readFileSync(join(root, '.sdlc/verify/usage/set-a.json'), 'utf8'))
const record = (root, transcript, doc = 'spec.md') =>
  tool('record', '--root', root, '--set', join(root, '.sdlc/specs/set-a'), '--doc', doc, ...(transcript ? ['--transcript', transcript] : []))

test('usage repeated across content blocks is counted once per message', () => {
  const root = repo()
  const t = join(root, 't.jsonl')
  put(t, [
    line('m1', 'claude-opus-5', usage({ input_tokens: 10, output_tokens: 100 }), 's1', 4),
    line('m2', 'claude-opus-5', usage({ input_tokens: 5, output_tokens: 50 }), 's1', 1),
  ].join('\n'))

  assert.equal(record(root, t).code, 0)
  const snap = ledger(root).snapshots.at(-1)
  assert.equal(snap.messages, 2)
  assert.deepEqual(snap.tokens['claude-opus-5'], { input: 15, output: 150, cache_5m: 0, cache_1h: 0, cache_read: 0 })
})

test('the two cache-write TTLs are priced apart, not lumped together', () => {
  const root = repo()
  const t = join(root, 't.jsonl')
  put(t, line('m1', 'claude-opus-5', usage({
    cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 1_000_000 },
  })))

  assert.equal(record(root, t).code, 0)
  const snap = ledger(root).snapshots.at(-1)
  assert.equal(snap.tokens['claude-opus-5'].cache_1h, 1_000_000)
  assert.equal(snap.tokens['claude-opus-5'].cache_5m, 1_000_000)
  // $10.00 for the 1h write plus $6.25 for the 5m one. Pricing both at one rate would give
  // $20.00 or $12.50, and either would look like a plausible total.
  assert.equal(snap.micro_usd, 16_250_000)
  assert.equal(formatUsd(snap.micro_usd), '$16.25')
  assert.deepEqual(snap.assumptions, [])
})

test('a transcript without the TTL split is priced at the 1h rate and says so', () => {
  const root = repo()
  const t = join(root, 't.jsonl')
  put(t, JSON.stringify({
    type: 'assistant', sessionId: 's1',
    message: { id: 'm1', model: 'claude-opus-5', usage: { cache_creation_input_tokens: 1_000_000 } },
  }))

  assert.equal(record(root, t).code, 0)
  const snap = ledger(root).snapshots.at(-1)
  assert.equal(snap.tokens['claude-opus-5'].cache_1h, 1_000_000)
  assert.match(snap.assumptions[0], /without a TTL split/)
})

test('fast mode is priced as its own rate row', () => {
  const root = repo()
  const t = join(root, 't.jsonl')
  put(t, line('m1', 'claude-opus-5', usage({ output_tokens: 1_000_000, speed: 'fast' })))

  assert.equal(record(root, t).code, 0)
  const snap = ledger(root).snapshots.at(-1)
  assert.ok(snap.tokens['claude-opus-5#fast'], Object.keys(snap.tokens).join(','))
  assert.equal(snap.micro_usd, 50_000_000)
})

test('a second snapshot of the same session charges only the growth', () => {
  const root = repo()
  const t = join(root, 't.jsonl')
  put(t, line('m1', 'claude-opus-5', usage({ output_tokens: 1_000_000 })))
  assert.equal(record(root, t, 'intent.md').code, 0)

  // The session continues: the transcript now holds both messages, cumulatively.
  put(t, [
    line('m1', 'claude-opus-5', usage({ output_tokens: 1_000_000 })),
    line('m2', 'claude-opus-5', usage({ output_tokens: 3_000_000 })),
  ].join('\n'))
  assert.equal(record(root, t, 'spec.md').code, 0)

  const snaps = ledger(root).snapshots
  assert.equal(snaps[0].micro_usd, 25_000_000)
  // Not 100_000_000: charging the cumulative again would bill the first message twice.
  assert.equal(snaps[1].micro_usd, 75_000_000)
})

test('a session that moves to another set is not charged to both', () => {
  const root = repo()
  mkdirSync(join(root, '.sdlc/specs/set-b'), { recursive: true })
  const t = join(root, 't.jsonl')
  put(t, line('m1', 'claude-opus-5', usage({ output_tokens: 1_000_000 })))
  assert.equal(record(root, t).code, 0)

  put(t, [
    line('m1', 'claude-opus-5', usage({ output_tokens: 1_000_000 })),
    line('m2', 'claude-opus-5', usage({ output_tokens: 1_000_000 })),
  ].join('\n'))
  const r = tool('record', '--root', root, '--set', join(root, '.sdlc/specs/set-b'), '--doc', 'intent.md', '--transcript', t)
  assert.equal(r.code, 0)

  const b = JSON.parse(readFileSync(join(root, '.sdlc/verify/usage/set-b.json'), 'utf8'))
  // The cursor is per session across the whole repository, not per ledger; a per-ledger base
  // would have started set-b from zero and charged it the first message as well.
  assert.equal(b.snapshots.at(-1).micro_usd, 25_000_000)
})

test('a missing transcript is written down as unmeasured, not skipped', () => {
  const root = repo()
  const r = record(root, join(root, 'nope.jsonl'))
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /not recorded/)
  const snap = ledger(root).snapshots.at(-1)
  assert.match(snap.unmeasured, /transcript not found/)
  assert.equal(snap.micro_usd, undefined)
})

test('an unpriced model leaves no total rather than a partial one', () => {
  const root = repo()
  const t = join(root, 't.jsonl')
  put(t, [
    line('m1', 'claude-opus-5', usage({ output_tokens: 1_000_000 })),
    line('m2', 'claude-from-the-future', usage({ output_tokens: 1_000_000 })),
  ].join('\n'))

  assert.equal(record(root, t).code, 0)
  const snap = ledger(root).snapshots.at(-1)
  assert.equal(snap.micro_usd, null)
  assert.deepEqual(snap.unpriced_models, ['claude-from-the-future'])
  // The priced part is still visible per model — the refusal is to present a partial sum as a
  // total, not to throw the measurement away.
  assert.equal(snap.by_model_micro_usd['claude-opus-5'], 25_000_000)

  const report = tool('report', root)
  assert.match(report.stdout, /unmeasured — no published rate for claude-from-the-future/)
})

test('an empty usage directory reports "not measured", never a zero total', () => {
  const report = tool('report', repo())
  assert.equal(report.code, 0, report.out)
  assert.match(report.stdout, /not measured/)
  assert.doesNotMatch(report.stdout, /\$0\.00/)
})

test('cost arithmetic stays exact past the range of a double', () => {
  // 2.78e9 cache-read tokens is one real project's quarter. tokens * rate overflows 2^53 long
  // before the divide brings it back, so the multiply happens in BigInt.
  const micro = costMicroUsd(2_779_310_813, RATES['claude-opus-5'].cache_read)
  assert.equal(micro, 1_389_655_407)
  assert.equal(Number.isSafeInteger(micro), true)
  assert.equal(costMicroUsd(0, RATES['claude-opus-5'].input), 0)
  assert.throws(() => costMicroUsd(-1, 5), /non-negative/)
  assert.throws(() => costMicroUsd(1.5, 5), /integer/)
})

test('every rate row prices all five buckets', () => {
  for (const [model, row] of Object.entries(RATES)) {
    for (const bucket of ['input', 'output', 'cache_5m', 'cache_1h', 'cache_read']) {
      assert.equal(typeof row[bucket], 'number', `${model}.${bucket}`)
      assert.ok(Number.isInteger(row[bucket]) && row[bucket] > 0, `${model}.${bucket} = ${row[bucket]}`)
    }
    // A derived rate that is not declared derived reads as published, which is the one thing a
    // reader of this table needs to be able to tell apart.
    assert.ok(Array.isArray(row.derived), `${model} has no derived list`)
  }
})
