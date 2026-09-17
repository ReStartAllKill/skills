/** Trailers must identify the same task and plan within one commit record. */
export const parseCommitRecords = (output) => output.split('\x1e').map((record) => {
  const [hash, ...body] = record.trim().split('\x1f')
  return hash ? { hash, body: body.join('\x1f') } : null
}).filter(Boolean)

/** Task ids named by one `SDLC-Task:` trailer line, or null when the line is not that trailer.
 *
 * The harness writes one id per line, but a squash merge folds every task commit of a PR into one
 * message and GitHub joins the values: `SDLC-Task: WP-001, WP-003, WP-008`. Reading only the
 * one-id form made every task in a squashed PR lose its commit at once, and `mark` then refused
 * all of them for «no attributed commit» — work that was done and merged read as never started.
 * Commas and whitespace both separate; anything that is not a task id disqualifies the line
 * rather than being skipped, so a garbled trailer is not read as a partial match. */
export const taskTrailerIds = (line) => {
  const m = /^SDLC-Task:\s*(.*?)\s*$/i.exec(line)
  if (!m) return null
  const ids = m[1].split(/[\s,]+/).filter(Boolean)
  return ids.length && ids.every((x) => /^WP-\d{1,4}$/i.test(x)) ? ids.map((x) => x.toUpperCase()) : null
}

export const ownsTaskCommit = (record, id, planPath) => {
  const lines = record.body.split('\n')
  const want = id.toUpperCase()
  return lines.some((line) => (taskTrailerIds(line) ?? []).includes(want)) &&
    lines.some((line) => line === `SDLC-Plan: ${planPath}`)
}
