/** Published Anthropic first-party token rates, and the arithmetic that turns tokens into money.
 *
 * ## Why the rates are integers of micro-USD
 *
 * A rate table written in dollars (`5.0`, `0.25`) makes every cost a float, and a float total is
 * not reproducible: summing the same snapshots in a different order gives a different last digit,
 * so two runs of the same report disagree and neither is wrong. Rates are therefore whole
 * micro-USD per million tokens, and `costMicroUsd` multiplies in BigInt — a single set can carry
 * billions of cache-read tokens, and `tokens * rate` passes 2^53 before it is divided back down.
 *
 * ## Why a recorded snapshot must copy the rates it used
 *
 * These numbers change. A ledger that stores only tokens and reprices at read time silently
 * rewrites what last quarter cost the moment this file is edited. `usage-ledger.mjs` copies the
 * rate rows it applied into every snapshot, and this table is only ever consulted for new ones.
 *
 * ## What is published and what is derived
 *
 * `input` and `output` are published per model. The three cache rates follow Anthropic's general
 * rule — 1.25x input for a 5-minute write, 2x input for a 1-hour write, 0.1x input for a read —
 * and are derived from `input` unless a model publishes its own, which `overrides` carries.
 * `derived: true` on a rate row is what tells a reader which is which; nothing here guesses a
 * number that has no published rule behind it.
 */

/** The date of the rate table this file was written from. Snapshots record it, so a cost can
 * always be traced back to the table that produced it rather than to whatever is current now. */
export const RATES_AS_OF = '2026-06-24'

const M = 1_000_000

/** One model's rates in micro-USD per million tokens. `overrides` names a published exception. */
const rate = (inputUsd, outputUsd, overrides = {}) => {
  const input = Math.round(inputUsd * M)
  return {
    input,
    output: Math.round(outputUsd * M),
    cache_5m: Math.round(input * 1.25),
    cache_1h: input * 2,
    cache_read: Math.round(input / 10),
    derived: ['cache_5m', 'cache_1h', 'cache_read'].filter((k) => !(k in overrides)),
    ...overrides,
  }
}

/** Keyed by the model id as it appears in a transcript. Fast mode is a separate price for the
 * same model, so it is a separate row under `<id>#fast` — the scanner keys on `usage.speed`. */
export const RATES = {
  'claude-opus-5': rate(5, 25),
  'claude-opus-5#fast': rate(10, 50),
  'claude-opus-4-8': rate(5, 25),
  'claude-opus-4-8#fast': rate(10, 50),
  'claude-opus-4-7': rate(5, 25),
  'claude-opus-4-6': rate(5, 25),
  // Claude Fable 5.1 and Claude Mythos 5.1 publish a flat cache-read rate that the 0.1x rule
  // does not produce; Claude Fable 5 does not, so it keeps the derived one.
  'claude-fable-5-1': rate(10, 50, { cache_read: Math.round(0.25 * M) }),
  'claude-mythos-5-1': rate(10, 50, { cache_read: Math.round(0.25 * M) }),
  'claude-fable-5': rate(10, 50),
  'claude-sonnet-5': rate(2, 10),
  'claude-sonnet-4-6': rate(3, 15),
  'claude-haiku-4-5': rate(1, 5),
}

/** The token buckets a rate row prices, and the rate key each one is charged at. */
export const BUCKETS = {
  input: 'input',
  output: 'output',
  cache_5m: 'cache_5m',
  cache_1h: 'cache_1h',
  cache_read: 'cache_read',
}

/** Cost of one bucket, in whole micro-USD, rounded half-up at the last step only.
 *
 * BigInt throughout: the multiply overflows a double long before the division brings it back. */
export const costMicroUsd = (tokens, ratePerM) => {
  if (!Number.isInteger(tokens) || tokens < 0) throw new Error(`token count must be a non-negative integer — got ${tokens}`)
  if (!Number.isInteger(ratePerM) || ratePerM < 0) throw new Error(`rate must be a non-negative integer of micro-USD — got ${ratePerM}`)
  const scaled = BigInt(tokens) * BigInt(ratePerM)
  const million = BigInt(M)
  return Number((scaled + million / 2n) / million)
}

/** Whole-dollar rendering of a micro-USD amount. Presentation only — never feed it back in. */
export const formatUsd = (microUsd) => `$${(microUsd / M).toFixed(2)}`
