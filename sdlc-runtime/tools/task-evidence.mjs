import { readFileSync, lstatSync, readlinkSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const MAX_BUFFER = 512 * 1024 * 1024

import { taskFiles, normalizeTaskPath, containsTaskPath } from './task-paths.mjs'
export { taskFiles } from './task-paths.mjs'

const gitIn = (root) => (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER })

/** The algorithm verify-run records as `fingerprint:` in a log header. A log without the key was
 * written with version 1, and plan-progress recomputes every log with the algorithm it names: a
 * completed set is never re-verified, so its old logs must keep proving what they proved. */
export const FINGERPRINT_VERSION = 2

/** The paths the repository fingerprint covers. Exported so verify-run can say *which* of them a
 * command changed while it ran — the fingerprint alone only says that something did. */
export function repositoryFiles(root, dirs, ref = null) {
  const names = (ref ? gitIn(root)('ls-tree', '-r', '--name-only', '-z', ref)
    : gitIn(root)('ls-files', '-z', '--cached', '--others', '--exclude-standard')).toString()
  return [...new Set(names.split('\0').filter(Boolean))].filter(fingerprinted(root, dirs))
}

function fingerprinted(root, { specDir, logDir }) {
  const excluded = [specDir, logDir].map((p) => relative(root, resolve(root, p)))
  return (name) => name !== '.claude/autonomy-runs.jsonl' && !excluded.some((dir) => name === dir || name.startsWith(dir + '/'))
}

// ── Version 1 ──────────────────────────────────────────────────────────────────────────────────
// Kept byte for byte for logs without `fingerprint:`. It hashes file contents itself, and at a ref
// it runs `git ls-tree` and `git cat-file` once per file: a repository of 1,500 files took 151 s to
// check one completed set. Do not call it for new logs.

function expandDirV1(root, name, ref) {
  const git = gitIn(root)
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

export function taskFingerprintV1(root, task, ref = null) {
  const git = gitIn(root)
  const hash = createHash('sha256')
  hash.update(JSON.stringify([...task.fields].sort(([a], [b]) => a.localeCompare(b))))
  const one = (name) => {
    const path = resolve(root, name)
    hash.update(JSON.stringify(name))
    if (ref) {
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
    const members = expandDirV1(root, declared, ref)
    if (members === null) { one(declared); continue }
    hash.update(JSON.stringify(declared))
    for (const member of members) one(member)
  }
  return hash.digest('hex')
}

export function repositoryFingerprintV1(root, dirs, ref = null) {
  const files = repositoryFiles(root, dirs, ref)
  return taskFingerprintV1(root, { fields: new Map([['files', files.map((f) => '`' + f + '`').join(', ')]]) }, ref)
}

// ── Version 2 ──────────────────────────────────────────────────────────────────────────────────
// A path set hashes to the sorted list of (path, mode, git object id). Git computes the ids, so the
// number of processes no longer grows with the number of files: at a ref one `ls-tree -r`, in the
// working tree one `ls-files` plus one `hash-object --stdin-paths`. The working-tree id must equal
// the id the same content gets once committed — verify-run records the working tree and
// plan-progress later recomputes a completed set from its commit — so hash-object runs *with*
// filters: `--stdin-paths` applies the path's attributes (eol, `text`, clean filters) exactly as
// `git add` does. `--no-filters` was rejected for that reason: a CRLF file under a `text` rule
// would hash differently from its committed blob, and every such set would read as changed.

const MISSING = ['missing', '']
const FULL_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/

/** A commit's tree never changes, so one listing per commit serves every log and task that names it
 * in this process. Symbolic refs are not cached: they move. */
const trees = new Map()
function treeEntries(root, ref) {
  const key = `${root}\0${ref}`
  if (trees.has(key)) return trees.get(key)
  const entries = new Map()
  for (const record of gitIn(root)('ls-tree', '-r', '-z', ref).toString().split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    const [mode, type, object] = record.slice(0, tab).split(' ')
    const name = record.slice(tab + 1)
    // The same normalisation git applies when it reads a legacy 100664 entry; v1 drew the same line.
    entries.set(name, type === 'commit' ? ['160000', object] : [mode === '120000' ? '120000' : mode === '100755' ? '100755' : '100644', object])
  }
  if (FULL_SHA.test(ref)) trees.set(key, entries)
  return entries
}

const formats = new Map()
function blobId(root, content) {
  if (!formats.has(root)) formats.set(root, gitIn(root)('rev-parse', '--show-object-format').toString().trim() || 'sha1')
  return createHash(formats.get(root) === 'sha256' ? 'sha256' : 'sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
}

/** `--stdin-paths` reads one path per line and unquotes a line that starts with `"` the way git
 * quotes paths (C style, octal for other control bytes); this git has no `-z` form. */
const cquote = (name) => /["\\\n\r\t\x00-\x1f\x7f]/.test(name) || name.startsWith('"')
  ? '"' + name.replace(/[\\"]/g, (c) => '\\' + c).replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
    .replace(/[\x00-\x1f\x7f]/g, (c) => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')) + '"'
  : name

function worktreeEntries(root, names) {
  const entries = new Map(), files = [], dirs = []
  for (const name of names) {
    const path = resolve(root, name)
    let stat
    try { stat = lstatSync(path) } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e
      entries.set(name, MISSING); continue
    }
    // hash-object follows a symlink and would hash its target's content; git stores the link text.
    if (stat.isSymbolicLink()) entries.set(name, ['120000', blobId(root, readlinkSync(path, { encoding: 'buffer' }))])
    else if (stat.isDirectory()) dirs.push(name)
    else if (stat.isFile()) { files.push(name); entries.set(name, [stat.mode & 0o100 ? '100755' : '100644', null]) }
    else throw new Error(`파일이 아닌 작업 경로: ${name}`)
  }
  if (dirs.length) {
    // A submodule is fingerprinted by the commit staged for it, as in v1. One listing of the whole
    // index rather than one call per directory, and no pathspec to quote.
    const staged = new Map(gitIn(root)('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean).map((r) => {
      const tab = r.indexOf('\t'); const [mode, object] = r.slice(0, tab).split(' ')
      return [r.slice(tab + 1), [mode, object]]
    }))
    for (const name of dirs) {
      const s = staged.get(name.replace(/\/+$/, ''))
      if (s?.[0] !== '160000') throw new Error(`파일이 아닌 작업 경로: ${name}`)
      entries.set(name, ['160000', s[1]])
    }
  }
  if (files.length) {
    const ids = execFileSync('git', ['-C', root, 'hash-object', '--stdin-paths'], {
      input: files.map(cquote).join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER,
    }).toString().split('\n').filter(Boolean)
    if (ids.length !== files.length) throw new Error(`git hash-object 가 ${files.length}개 중 ${ids.length}개만 답했다`)
    files.forEach((name, i) => { entries.get(name)[1] = ids[i] })
  }
  return entries
}

const worktreeNames = (root) => [...new Set(gitIn(root)('ls-files', '-z', '--cached', '--others', '--exclude-standard')
  .toString().split('\0').filter(Boolean))]

const entry = (hash, name, [mode, id]) => hash.update(JSON.stringify([name, mode, id]) + '\n')

/** The task's fields, then each declared path: the path itself when git lists it, else every listed
 * path under it (a directory), else `missing`. Matching against git's own listing rather than the
 * file system means a declared path is a directory at a ref exactly when it is one in the working
 * tree, and an ignored file counts as absent on both sides. */
export function taskFingerprint(root, task, ref = null) {
  const declared = taskFiles(task).sort()
  let entries
  if (ref) entries = treeEntries(root, ref)
  else {
    const scopes = declared.map(normalizeTaskPath)
    entries = worktreeEntries(root, worktreeNames(root).filter((name) => scopes.some((s) => containsTaskPath(s, name))))
  }
  const names = [...entries.keys()]
  const hash = createHash('sha256')
  hash.update(`fingerprint ${FINGERPRINT_VERSION}\n`)
  hash.update(JSON.stringify([...task.fields].sort(([a], [b]) => a.localeCompare(b))) + '\n')
  for (const d of declared) {
    const path = normalizeTaskPath(d)
    if (entries.has(path)) { entry(hash, d, entries.get(path)); continue }
    const members = names.filter((name) => containsTaskPath(path, name)).sort()
    if (!members.length) { entry(hash, d, MISSING); continue }
    hash.update(JSON.stringify(['dir', d]) + '\n')
    for (const name of members) entry(hash, name, entries.get(name))
  }
  return hash.digest('hex')
}

export function repositoryFingerprint(root, dirs, ref = null) {
  const entries = ref ? treeEntries(root, ref) : worktreeEntries(root, repositoryFiles(root, dirs))
  const keep = fingerprinted(root, dirs)
  const hash = createHash('sha256')
  hash.update(`fingerprint ${FINGERPRINT_VERSION}\n`)
  for (const name of [...entries.keys()].filter(keep).sort()) entry(hash, name, entries.get(name))
  return hash.digest('hex')
}

/** The pair plan-progress recomputes a log with, by the version its header names; null for a
 * version this code does not know, so a log from a newer verify-run is refused, not misread. */
export const fingerprinter = (version) => ({
  1: { task: taskFingerprintV1, repository: repositoryFingerprintV1 },
  2: { task: taskFingerprint, repository: repositoryFingerprint },
})[version] ?? null
