/** 작업 정의와 파일 내용의 지문. 체크박스·실행 기록은 지문에 포함하지 않는다. */
import { readFileSync, lstatSync, readlinkSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/** `execFileSync` 의 기본 버퍼는 1MiB 다. 지문은 **파일 내용을 통째로** 읽으므로 아이콘·폰트·
 *  이미지가 든 레포에서는 그 한도를 넘고, 넘으면 ENOBUFS 로 죽는다 — 「어긋남 0건」을 재는
 *  도구가 레포에 큰 파일이 있다는 이유로 답을 못 내면 완료를 증명할 길이 사라진다. */
const MAX_BUFFER = 512 * 1024 * 1024

export function taskFiles(task) {
  const value = task.fields.get('files') ?? ''
  const quoted = [...value.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())
  return (quoted.length ? quoted : value.split(',')).map((s) => s.trim()).filter(Boolean)
}

/** `files` 의 한 항목이 폴더면 그 안의 파일로 편다. 아니면 `null` — 그 경우 **한 글자도
 *  다르지 않게** 접어야 한다(안 그러면 이미 기록된 지문이 전부 어긋난다).
 *
 *  목록은 두 갈래 다 **git 이 낸다.** 파일 시스템을 직접 훑으면 무시된 파일이 섞여, 같은
 *  커밋을 ref 로 잰 지문과 워크트리로 잰 지문이 갈린다.
 *
 *  ⚠ 폴더를 못 알아보면 **죽는 것보다 나쁜 일**이 일어난다. `git ls-tree <ref> -- <경로>/` 는
 *  끝의 빗금 하나 때문에 그 트리가 아니라 **그 안의 목록**을 낸다. 첫 줄만 읽으면 폴더
 *  하나를 그 안의 첫 파일로 조용히 재고, 나머지가 다 바뀌어도 지문이 안 움직인다.
 *  그래서 빗금을 먼저 떼고 종류를 묻는다. */
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
      // 서브모듈(gitlink)은 트리가 아니라 고정된 커밋이 지문이다.
      if (type === 'commit') { hash.update(JSON.stringify({ type: 'gitlink' })); hash.update(object); return }
      if (type !== 'blob') throw new Error(`파일이 아닌 작업 경로: ${name}`)
      hash.update(JSON.stringify({ type: mode === '120000' ? 'link' : 'file', executable: mode === '100755' }))
      hash.update(git('cat-file', 'blob', object))
      return
    }
    try {
      const stat = lstatSync(path)
      if (stat.isDirectory()) {
        // `git ls-files` 가 돌려준 디렉터리는 서브모듈(gitlink) 뿐이다 — 고정된 커밋을 지문으로 쓴다.
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
    // 선언한 이름을 먼저 물린다 — 폴더가 통째로 비면 그 사실도 지문에 남아야 한다.
    hash.update(JSON.stringify(declared))
    for (const member of members) one(member)
  }
  return hash.digest('hex')
}

/** 전체 검증은 작업 외 의존 파일도 포함한다. 산출물과 실행 로그만 제외한다. */
export function repositoryFingerprint(root, { specDir, logDir }, ref = null) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER })
  const names = ref ? git('ls-tree', '-r', '--name-only', '-z', ref)
    : git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
  const excluded = [specDir, logDir].map((p) => relative(root, resolve(root, p)))
  const files = [...new Set(names.split('\0').filter(Boolean))].filter((name) =>
    name !== '.claude/autonomy-runs.jsonl' && !excluded.some((dir) => name === dir || name.startsWith(dir + '/')))
  return taskFingerprint(root, { fields: new Map([['files', files.map((f) => '`' + f + '`').join(', ')]]) }, ref)
}
