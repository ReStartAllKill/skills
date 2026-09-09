/** Read upstream repository settings and upstream.lock.json.
 * Use its source path, commit, and hash to verify provenance and local changes. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, basename } from 'node:path'

export const LOCK_FILE = 'upstream.lock.json'
/** Documents pulled from upstream. Plans always belong to the consumer repository. */
export const VENDORED = ['intent.md', 'spec.md']

/** Compare the final `<owner>/<name>` path components across remote URL formats. */
export const sameRepo = (a, b) =>
  !!a && !!b && String(a).trim().split('/').pop() === String(b).trim().split('/').pop()

const yamlList = (raw) => String(raw).replace(/^\[|\]$/g, '')
  .split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)

/** Read repository-boundary profile keys. spec_consumers marks an upstream repository. */
export function upstreamSeam(repoRoot) {
  const path = repoRoot && resolve(repoRoot, '.claude/spec-profile.yml')
  if (!path || !existsSync(path)) return { self: null, upstream: null, consumers: [], isUpstream: false }
  const text = readFileSync(path, 'utf8')
  const yml = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(text)?.[1] ?? '')
    .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
  // Read both block sequences and inline lists.
  const block = new RegExp('^spec_consumers:[ \\t]*$\\n((?:[ \\t]*-[ \\t]*.+\\n?)+)', 'm').exec(text)
  const consumers = block
    ? block[1].split('\n').map((l) => /^[ \t]*-[ \t]*(.+?)[ \t]*$/.exec(l)?.[1] ?? '')
        .map((s) => s.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()).filter(Boolean)
    : yamlList(yml('spec_consumers'))
  return {
    self: yml('repo') || null,
    upstream: yml('upstream_repo') || null,
    consumers,
    isUpstream: consumers.length > 0,
  }
}

/** Hash content after normalizing line endings only; every other byte is significant. */
export const hashOf = (text) =>
  'sha256:' + createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex')

/** Read the lock file. Return null when absent or `{ broken }` when invalid. */
export function loadLock(dir) {
  const path = join(dir, LOCK_FILE)
  if (!existsSync(path)) return null
  let json
  try { json = JSON.parse(readFileSync(path, 'utf8')) }
  catch (e) { return { broken: `JSON 을 읽을 수 없다 — ${e.message}` } }
  if (!json || typeof json !== 'object') return { broken: '최상위가 객체가 아니다' }
  if (!json.repo) return { broken: '`repo` 가 없다' }
  if (!json.files || typeof json.files !== 'object') return { broken: '`files` 가 없다' }
  return json
}

/** Verify that the vendored copy matches the lock file. */
export function verifyLock(dir, lock) {
  const out = []
  for (const [name, e] of Object.entries(lock.files)) {
    const local = join(dir, name)
    if (!existsSync(local)) {
      out.push({ level: 'error', doc: LOCK_FILE, msg: `\`${name}\` 이 락에 있는데 폴더에 없다`,
        hint: '`pull-spec.mjs` 로 다시 끌어온다. 지웠으면 락에서도 빼야 한다.' })
      continue
    }
    if (!e || !e.hash) {
      out.push({ level: 'error', doc: LOCK_FILE, msg: `\`${name}\` 항목에 \`hash\` 가 없다`,
        hint: '손으로 쓴 락이다. `pull-spec.mjs` 가 만들게 한다.' })
      continue
    }
    const actual = hashOf(readFileSync(local, 'utf8'))
    if (actual === e.hash) continue
    out.push({ level: 'error', doc: name, msg: '벤더한 사본이 락의 해시와 다르다',
      hint: `이 파일은 ${lock.repo} 가 정본이고 여기서는 읽기 전용이다. 고칠 일은 상류에서 \`/iterate-spec\` 으로 하고 \`pull-spec.mjs\` 로 다시 끌어온다.` })
  }
  return out
}

/** Return the upstream commit that last changed the file, or null. */
export function headOf(upstreamRoot, path) {
  try {
    return execFileSync('git', ['-C', upstreamRoot, 'log', '-1', '--format=%H', '--', path],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch { return null }
}

/** Find a local upstream checkout by explicit path, environment variable, then sibling directory. */
export function findUpstream(lock, repoRoot, explicit) {
  const ok = (p) => p && existsSync(join(p, '.git')) && statSync(p).isDirectory() ? resolve(p) : null
  const named = (p) => ok(p) && sameRepoCheckout(p, lock.repo) ? resolve(p) : null
  if (explicit) return ok(explicit)
  if (process.env.SDLC_UPSTREAM) return ok(process.env.SDLC_UPSTREAM)
  if (!repoRoot) return null
  const name = String(lock.repo).split('/').pop()
  for (const cand of [resolve(repoRoot, '..', name), resolve(repoRoot, '..', '..', name)]) {
    const hit = named(cand)
    if (hit) return hit
  }
  return null
}

/** Verify that a sibling checkout's remote points to the expected repository. */
function sameRepoCheckout(path, repo) {
  try {
    const url = execFileSync('git', ['-C', path, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return sameRepo(url.replace(/\.git$/, ''), repo)
  } catch {
    // Accept the directory name for local-only checkouts without a remote.
    return basename(path) === String(repo).split('/').pop()
  }
}
