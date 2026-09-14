import { readFileSync, lstatSync, readlinkSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const MAX_BUFFER = 512 * 1024 * 1024

import { taskFiles } from './task-paths.mjs'
export { taskFiles } from './task-paths.mjs'

function expandDir(root, name, ref) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER })
  const bare = name.replace(/\/+$/, '')
  if (ref) {
    const entry = git('ls-tree', ref, '--', bare).toString().trim()
    if (entry.split('\n').length !== 1 || entry.split(/[\t ]/)[1] !== 'tree') return null
    return [...new Set(git('ls-tree', '-r', '--name-only', '-z', ref, '--', bare).toString().split('\0').filter(Boolean))].sort()
  }
  try {
    if (!lstatSync(resolve(root, bare)).isDirectory()) return null
  } catch { return null }
  return [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', bare).toString().split('\0').filter(Boolean))].sort()
}

export function taskFingerprint(root, task, ref = null) {
  const hash = createHash('sha256')
  hash.update(JSON.stringify([...task.fields].sort(([a], [b]) => a.localeCompare(b))))
  const one = (name) => {
    const path = resolve(root, name)
    hash.update(JSON.stringify(name))
    if (ref) {
      const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER })
      const entry = git('ls-tree', ref, '--', name).toString().trim()
      if (!entry) { hash.update('missing'); return }
      const [mode, type, object] = entry.split(/[\t ]/)
      if (type === 'commit') { hash.update(JSON.stringify({ type: 'gitlink' })); hash.update(object); return }
      if (type !== 'blob') throw new Error(`파일이 아닌 작업 경로: ${name}`)
      hash.update(JSON.stringify({ type: mode === '120000' ? 'link' : 'file', executable: mode === '100755' }))
      hash.update(git('cat-file', 'blob', object))
      return
    }
    try {
      const stat = lstatSync(path)
      if (stat.isDirectory()) {
        const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER })
        const staged = git('ls-files', '--stage', '--', name).toString().trim().split(/[\t ]/)
        if (staged[0] !== '160000') throw new Error(`파일이 아닌 작업 경로: ${name}`)
        hash.update(JSON.stringify({ type: 'gitlink' })); hash.update(staged[1]); return
      }
      hash.update(JSON.stringify({ type: stat.isSymbolicLink() ? 'link' : 'file', executable: !!(stat.mode & 0o111) }))
      hash.update(stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path))
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      hash.update('missing')
    }
  }
  for (const declared of taskFiles(task).sort()) {
    const members = expandDir(root, declared, ref)
    if (members === null) { one(declared); continue }
    hash.update(JSON.stringify(declared))
    for (const member of members) one(member)
  }
  return hash.digest('hex')
}

export function repositoryFingerprint(root, { specDir, logDir }, ref = null) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER })
  const names = ref ? git('ls-tree', '-r', '--name-only', '-z', ref)
    : git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
  const excluded = [specDir, logDir].map((p) => relative(root, resolve(root, p)))
  const files = [...new Set(names.split('\0').filter(Boolean))].filter((name) =>
    name !== '.claude/autonomy-runs.jsonl' && !excluded.some((dir) => name === dir || name.startsWith(dir + '/')))
  return taskFingerprint(root, { fields: new Map([['files', files.map((f) => '`' + f + '`').join(', ')]]) }, ref)
}
