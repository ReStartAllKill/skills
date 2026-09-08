/** 상류 문서 레포와의 이음매. 프로필 키와 사슬 폴더의 `upstream.lock.json` 을 읽는다.
 *
 *  검사기의 시야는 폴더 하나다. 상류가 다른 레포에 있으면 그 사실이 폴더 안에 **파일로**
 *  있어야 검사기가 볼 수 있다. 락파일이 그 파일이다 — 벤더한 사본이 어디서 왔고(경로),
 *  어느 시점을 보고 있으며(커밋), 그 뒤로 손을 탔는지(해시)를 한 자리에 적는다.
 *
 *  사본을 규율로 지키던 것을 기계가 지키게 바꾸는 것이 요점이다. package-lock 과 같다. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, basename } from 'node:path'

export const LOCK_FILE = 'upstream.lock.json'
/** 상류에서 끌어오는 문서. plan 은 언제나 소비 레포가 쓰므로 대상이 아니다. */
export const VENDORED = ['intent.md', 'spec.md']

/** `<owner>/<name>` 을 마지막 경로 요소로 비교한다. 소유자 표기가 달라도 같은 레포다. */
export const sameRepo = (a, b) =>
  !!a && !!b && String(a).trim().split('/').pop() === String(b).trim().split('/').pop()

const yamlList = (raw) => String(raw).replace(/^\[|\]$/g, '')
  .split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)

/** 프로필의 레포 경계 키를 읽는다. `spec_consumers` 가 있으면 이 레포가 상류다. */
export function upstreamSeam(repoRoot) {
  const path = repoRoot && resolve(repoRoot, '.claude/spec-profile.yml')
  if (!path || !existsSync(path)) return { self: null, upstream: null, consumers: [], isUpstream: false }
  const text = readFileSync(path, 'utf8')
  const yml = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(text)?.[1] ?? '')
    .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
  // 블록 시퀀스(`spec_consumers:` 다음 줄부터 `- item`)와 인라인 목록을 모두 읽는다.
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

/** 내용 해시. 줄끝만 정규화하고 나머지는 바이트 그대로 본다 — 공백 한 칸도 손댄 것이다. */
export const hashOf = (text) =>
  'sha256:' + createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex')

/** 락파일을 읽는다. 없으면 null, 깨졌으면 `{ broken }`. */
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

/** 벤더한 사본이 락파일과 같은지 본다. 다르면 사본을 손으로 고친 것이다. */
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

/** 상류 체크아웃에서 그 파일을 마지막으로 바꾼 커밋. 못 읽으면 null. */
export function headOf(upstreamRoot, path) {
  try {
    return execFileSync('git', ['-C', upstreamRoot, 'log', '-1', '--format=%H', '--', path],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch { return null }
}

/** 상류 체크아웃을 찾는다. 명시 경로 → 환경변수 → 형제 디렉터리 순.
 *  네트워크를 쓰지 않는다 — 옆에 받아둔 체크아웃이 있으면 신선도까지 보고, 없으면 건너뛴다. */
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

/** 형제 디렉터리 이름만으로 믿지 않는다 — remote 가 그 레포를 가리키는지 본다. */
function sameRepoCheckout(path, repo) {
  try {
    const url = execFileSync('git', ['-C', path, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return sameRepo(url.replace(/\.git$/, ''), repo)
  } catch {
    // remote 가 없는 체크아웃(로컬 전용)은 디렉터리 이름으로 받아들인다.
    return basename(path) === String(repo).split('/').pop()
  }
}
