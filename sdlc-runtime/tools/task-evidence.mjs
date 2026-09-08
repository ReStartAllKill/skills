/** 작업 정의와 파일 내용의 지문을 계산한다. 체크박스·실행 기록은 제외한다. */
import { readFileSync, lstatSync, readlinkSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/** 큰 바이너리 파일도 읽을 수 있도록 자식 프로세스 출력 버퍼를 확장한다. */
const MAX_BUFFER = 512 * 1024 * 1024

export function taskFiles(task) {
  const value = task.fields.get('files') ?? ''
  const quoted = [...value.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())
  return (quoted.length ? quoted : value.split(',')).map((s) => s.trim()).filter(Boolean)
}

/** 디렉터리는 Git 파일 목록으로 확장하고 일반 파일은 null을 반환한다. ls-tree의 디렉터리 판정 전 끝의 /를 제거한다. */
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
      // 서브모듈은 고정된 커밋 ID를 지문에 반영한다.
      if (type === 'commit') { hash.update(JSON.stringify({ type: 'gitlink' })); hash.update(object); return }
      if (type !== 'blob') throw new Error(`파일이 아닌 작업 경로: ${name}`)
      hash.update(JSON.stringify({ type: mode === '120000' ? 'link' : 'file', executable: mode === '100755' }))
      hash.update(git('cat-file', 'blob', object))
      return
    }
    try {
      const stat = lstatSync(path)
      if (stat.isDirectory()) {
        // ls-files에 남은 디렉터리는 서브모듈이므로 인덱스의 커밋 ID를 사용한다.
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
    // 빈 디렉터리도 구분하도록 선언 경로를 지문에 포함한다.
    hash.update(JSON.stringify(declared))
    for (const member of members) one(member)
  }
  return hash.digest('hex')
}

/** 전체 저장소 지문에서 산출물·검증 로그·자체 실행 로그를 제외한다. */
export function repositoryFingerprint(root, { specDir, logDir }, ref = null) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER })
  const names = ref ? git('ls-tree', '-r', '--name-only', '-z', ref)
    : git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
  const excluded = [specDir, logDir].map((p) => relative(root, resolve(root, p)))
  const files = [...new Set(names.split('\0').filter(Boolean))].filter((name) =>
    name !== '.claude/autonomy-runs.jsonl' && !excluded.some((dir) => name === dir || name.startsWith(dir + '/')))
  return taskFingerprint(root, { fields: new Map([['files', files.map((f) => '`' + f + '`').join(', ')]]) }, ref)
}
