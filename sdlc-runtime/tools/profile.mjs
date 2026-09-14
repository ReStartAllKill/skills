/** Locate the nearest repository profile and read the supported YAML subset once. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { frontmatter, isNull } from './artifact-parse.mjs'

export function readProfile(from = '.') {
  for (let root = resolve(from), previous = null; root !== previous; previous = root, root = resolve(root, '..')) {
    const path = join(root, '.claude/spec-profile.yml')
    if (!existsSync(path)) continue
    const values = frontmatter(`---\n${readFileSync(path, 'utf8')}\n---`) ?? {}
    return { root, path, values, get: (key, fallback = '') => isNull(values[key]) ? fallback : values[key] }
  }
  return { root: null, path: null, values: {}, get: (_key, fallback = '') => fallback }
}

export function lintWarningPolicy(from) {
  const value = readProfile(from).get('lint_warnings', 'legacy')
  if (!['legacy', 'advisory', 'error'].includes(value)) throw new Error('lint_warnings 는 advisory 또는 error 여야 한다.')
  return value
}
