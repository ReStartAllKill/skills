/** Which acceptance criteria a plan owes a covering task.
 *
 * check-artifacts makes an uncovered owed criterion an error, and covering another repository's
 * criterion an error; plan-progress reports progress against the same set. The rule used to live
 * inline in check-artifacts while plan-progress warned about every uncovered criterion, so a `Could`
 * left for later or a consumer's foreign criterion was clean under one tool and failed CI under the
 * other — a consumer could never pass check-all, and a priority below `Must` meant nothing. One
 * module, imported by both, keeps them from drifting apart again. It sits beside upstream.mjs rather
 * than inside it or artifact-parse.mjs because it needs both, and neither may import the other. */
import { scopeOf } from './artifact-parse.mjs'
import { sameRepo } from './upstream.mjs'

export const isMust = (e) => /^must$/i.test(e?.priority ?? '')

/** The repository a set builds for when it is a consumer, else null.
 *
 * Both halves are required: without a readable lock the set is not vendored, and without the
 * profile's `repo` nobody can tell which share is this repository's. Either gap is an error in
 * check-artifacts; here it falls back to «everything is mine», the reading that hides nothing. */
export const consumerSelf = (lock, seam) => (lock && !lock.broken && seam?.self ? seam.self : null)

/** Whether an entity's `scope` (its own, else its requirement's) includes this repository. */
export const inScope = (self, e, parent) => {
  if (!self) return true
  const sc = scopeOf(e, parent)
  return sc.length === 0 || sc.some((s) => sameRepo(s, self))
}

/** `owed` (a `Must`), `deferred` (the spec says `Should`, `Could` or `Won't`), `unprioritised`
 * (no priority, or no parent requirement) or `foreign` (another repository builds it).
 *
 * Foreign wins over everything: a `Could` assigned elsewhere is not something this plan may pick up
 * later, it is something this plan must not pick up at all. Unprioritised is kept apart from
 * deferred because deferral is something the spec says, not something inferred from a missing
 * marker — reading silence as «later» would take from a spec that uses no priorities the only
 * check telling it a criterion has no task. check-artifacts errors only on `owed`; plan-progress
 * warns on `owed` and `unprioritised`, as it did before this module existed. */
export const owes = (self, ac, parent) =>
  !inScope(self, ac, parent) ? 'foreign'
    : isMust(parent) ? 'owed'
    : parent?.priority ? 'deferred'
    : 'unprioritised'
