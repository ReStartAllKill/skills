/** Recover the committed delegation for an unchanged approved contract.
 * Git history is the audit source, not an authenticated identity or signature. */
import { relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { frontmatter, bodyOf } from './artifact-parse.mjs'
import { SECTION, sectionBlock } from './keywords.mjs'
import { parsePolicy } from './autonomy.mjs'

function contract(text, plan) {
  const fm = { ...(frontmatter(text) ?? {}) }
  delete fm.status; delete fm.created; delete fm.updated
  let body = bodyOf(text)
  if (plan) body = body.replace(sectionBlock(SECTION.executionLog), '').replace(/^(\s*[-*]\s*)\[[ xX]\]/gm, '$1[]').trim()
  return JSON.stringify({ fm: Object.entries(fm).sort(([a], [b]) => a.localeCompare(b)), body })
}

export function historicalPolicy(root, doc) {
  if (!root) return null
  const git = (...args) => {
    try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd() }
    catch { return null }
  }
  const file = relative(root, doc.path), plan = doc.kind === 'plan'
  const want = contract(doc.text, plan)
  for (const sha of (git('log', '--format=%H', '--', file) ?? '').split('\n').filter(Boolean)) {
    const text = git('show', `${sha}:${file}`)
    if (!text || frontmatter(text)?.status !== 'accepted' || contract(text, plan) !== want) continue
    const profile = frontmatter(`---\n${git('show', `${sha}:.claude/spec-profile.yml`) ?? ''}\n---`) ?? {}
    const path = relative(root, resolve(root, profile.autonomy || '.claude/autonomy.yml'))
    if (path.startsWith('../')) return null
    const policy = git('show', `${sha}:${path}`)
    const at = new Date(git('show', '-s', '--format=%cI', sha))
    if (!policy || Number.isNaN(at.getTime())) return null
    return { policy: { missing: false, ...parsePolicy(policy) }, at, sha }
  }
  return null
}
