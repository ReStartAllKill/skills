/** Trailers must identify the same task and plan within one commit record. */
export const parseCommitRecords = (output) => output.split('\x1e').map((record) => {
  const [hash, ...body] = record.trim().split('\x1f')
  return hash ? { hash, body: body.join('\x1f') } : null
}).filter(Boolean)

export const ownsTaskCommit = (record, id, planPath) => {
  const lines = record.body.split('\n')
  return lines.some((line) => new RegExp(`^SDLC-Task:\\s*${id}\\s*$`, 'i').test(line)) &&
    lines.some((line) => line === `SDLC-Plan: ${planPath}`)
}
