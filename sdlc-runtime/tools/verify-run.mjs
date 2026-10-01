#!/usr/bin/env node
/** Record verification output, exit code, and file fingerprints in verify_log_dir. */
import { readFileSync, existsSync, mkdirSync, writeFileSync, lstatSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { loadDir } from './artifact-parse.mjs'
import { taskFingerprint, repositoryFingerprint, repositoryFiles, taskFiles, FINGERPRINT_VERSION } from './task-evidence.mjs'

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
if (sep < 0 || !argv.slice(sep + 1).length) {
  console.error('사용법: verify-run.mjs <스펙 폴더> --level <N> --tasks WP-001,WP-002 [--label <이름>] -- "<명령>"')
  process.exit(2)
}
const opts = argv.slice(0, sep)
const command = argv.slice(sep + 1).join(' ')
const flag = (n) => { const i = opts.indexOf(`--${n}`); return i >= 0 ? opts[i + 1] : null }
const DIR = resolve(opts.find((a, i) => !a.startsWith('--') && !(i > 0 && opts[i - 1].startsWith('--'))) ?? '.')
const LEVEL = flag('level')
const TASKS = (flag('tasks') ?? '').split(/[,\s]+/).filter(Boolean)
const LABEL = flag('label')
if (!/^[1-9]\d*$/.test(LEVEL ?? '')) { console.error('`--level` 이 없다 — 어느 합류점인지 없이 기록할 수 없다.'); process.exit(2) }
if (!TASKS.length) { console.error('`--tasks` 가 없다 — 어느 작업의 검증인지 없이 기록할 수 없다.'); process.exit(2) }

/** Use the nearest parent directory containing a profile as the repository root. */
let ROOT = null
for (let d = DIR, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
  if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { ROOT = d; break }
}
if (!ROOT) { console.error(`프로필을 못 찾았다 — ${DIR} 의 조상에 .claude/spec-profile.yml 이 없다.`); process.exit(2) }
const profile = readFileSync(join(ROOT, '.claude/spec-profile.yml'), 'utf8')
const yml = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(profile)?.[1] ?? '')
  .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
const docs = loadDir(DIR, () => {})
const tasks = [...(docs.plan?.ents.values() ?? [])].filter((t) => t.kind === 'wp')
const legacy = !docs.plan && existsSync(join(DIR, 'tasks.md')) && TASKS.every((id) => /^T-\d+$/.test(id))
if (!legacy && (!docs.plan || TASKS.some((id) => !tasks.some((t) => t.id === id)))) {
  console.error('plan.md에 없는 작업은 검증할 수 없다.'); process.exit(2)
}
const selected = tasks.filter((t) => TASKS.includes(t.id))
const fingerprints = () => Object.fromEntries(selected.map((t) => [t.id, taskFingerprint(ROOT, t)]))
const before = fingerprints()
const LOG_DIR_KEY = 'verify_log_dir'
const logRoot = resolve(ROOT, yml(LOG_DIR_KEY) || '.sdlc/verify')
const dirs = { specDir: yml('spec_dir') || '.sdlc/specs', logDir: logRoot }
const repository = () => repositoryFingerprint(ROOT, dirs)
const repositoryBefore = repository()
/** Size, mtime and mode of every fingerprinted path, so an unstable run can name what it changed.
 * The fingerprints are single hashes and cannot; a per-file content hash could, but would read the
 * whole repository a third time. A stat is cheap, and it is only consulted once the hashes already
 * disagree, so a file touched without being changed costs at most a spurious name in a list that is
 * printed for a run that is unstable anyway. */
const snapshot = () => {
  const names = new Set([...repositoryFiles(ROOT, dirs), ...selected.flatMap((t) => taskFiles(t))])
  return new Map([...names].map((n) => {
    try { const s = lstatSync(resolve(ROOT, n)); return [n, s.isDirectory() ? 'dir' : `${s.size}:${s.mtimeMs}:${s.mode}`] }
    catch { return [n, 'missing'] }
  }))
}
const statBefore = snapshot()
const slug = basename(DIR)
const dir = join(logRoot, slug)
mkdirSync(dir, { recursive: true })

/** Use milliseconds and a collision counter to avoid overwriting rerun logs. */
const stamp = new Date().toISOString().replace(/[-:.]/g, '')
const base = `L${LEVEL}${LABEL ? `-${LABEL.replace(/[^\w.-]+/g, '_')}` : ''}-${stamp}`
let file = join(dir, `${base}.log`)
for (let n = 2; existsSync(file); n++) file = join(dir, `${base}-${n}.log`)
const head = (() => { try { return spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() } catch { return '' } })()

console.log(`합류점 검증 — 레벨 ${LEVEL} · ${TASKS.join(' ')}${LABEL ? ` · ${LABEL}` : ''}`)
console.log(`  $ ${command}`)
const started = new Date().toISOString()
const r = spawnSync('sh', ['-c', command], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const out = (r.stdout ?? '') + (r.stderr ?? '')
process.stdout.write(out)
const code = r.status ?? 1
const stable = JSON.stringify(before) === JSON.stringify(fingerprints()) && repositoryBefore === repository()
const changed = (() => {
  if (stable) return []
  const after = snapshot()
  return [...new Set([...statBefore.keys(), ...after.keys()])].filter((n) => (statBefore.get(n) ?? 'missing') !== (after.get(n) ?? 'missing')).sort()
})()
const CHANGED_MAX = 20

/** Keep only the output tail for successful runs and full output for failed runs.
 * Preserve the evidence header and SHA-256 of the complete output. */
const PASS_TAIL = 40
const FAIL_MAX = 2000
const FAIL_HEAD = 400

const lines = out.length ? out.replace(/\n$/, '').split('\n') : []
const elide = (n) => `[… ${n.toLocaleString('en-US')} lines omitted · sha256 in header …]`
const [body, shape] = (() => {
  if (code === 0 && lines.length > PASS_TAIL) {
    return [[elide(lines.length - PASS_TAIL), ...lines.slice(-PASS_TAIL)].join('\n'), `tail ${PASS_TAIL} of ${lines.length} lines`]
  }
  if (code !== 0 && lines.length > FAIL_MAX) {
    const tail = FAIL_MAX - FAIL_HEAD
    return [[...lines.slice(0, FAIL_HEAD), elide(lines.length - FAIL_MAX), ...lines.slice(-tail)].join('\n'),
      `head ${FAIL_HEAD} + tail ${tail} of ${lines.length} lines`]
  }
  return [out, `full ${lines.length} lines`]
})()

/** plan-progress reads only the header; command output follows the --- separator. */
writeFileSync(file, [
  '# sdlc verify',
  `date: ${started}`,
  `spec: ${relative(ROOT, DIR)}`,
  `level: ${LEVEL}`,
  `tasks: ${TASKS.join(' ')}`,
  ...(LABEL ? [`label: ${LABEL}`] : []),
  `command: ${JSON.stringify(command)}`,
  // The algorithm both fingerprints were taken with; plan-progress recomputes with the same one.
  // Its absence means version 1, which every log written before this key existed used.
  `fingerprint: ${FINGERPRINT_VERSION}`,
  `fingerprints: ${JSON.stringify(before)}`,
  `repository: ${repositoryBefore}`,
  `stable: ${stable}`,
  // Absent on a stable run and in every log written before it existed; plan-progress reads both.
  ...(stable ? [] : [`changed: ${JSON.stringify(changed.slice(0, CHANGED_MAX))}`, `changed_total: ${changed.length}`]),
  `head: ${head}`,
  `exit: ${code}`,
  `bytes: ${Buffer.byteLength(out)}`,
  `output: ${shape}`,
  `sha256: ${createHash('sha256').update(out).digest('hex')}`,
  '---',
  body,
].join('\n'))

/** A bare «통과» over a log that can never be evidence sent people to plan-check, which refused with
 * «no verify record — run verify-run first», which they had just done. Say here what plan-progress
 * will say later. The exit code stays the command's: callers read a non-zero exit as «the suite
 * failed», and an unstable pass did not fail — it only cannot be recorded as completion. */
const verifyCommand = yml('verify')
const unusable = []
if (!stable) {
  const more = changed.length > CHANGED_MAX ? ` 외 ${changed.length - CHANGED_MAX}개` : ''
  unusable.push([`실행 중에 명령이 추적되거나 git 이 무시하지 않는 파일을 바꿨다 (stable: false)${changed.length ? `: ${changed.slice(0, CHANGED_MAX).join(', ')}${more}` : ''}`,
    '테스트가 쓰는 보고서·커버리지·캐시 파일은 .gitignore 에 넣거나 저장소 밖에 쓰게 한 뒤 다시 돌린다 — 그대로 다시 돌리면 같은 결과다.'])
}
// Only an unlabelled run claims completion; a labelled one is never evidence and says so by its label.
if (!LABEL && !legacy && verifyCommand !== command) {
  unusable.push(verifyCommand
    ? [`명령이 프로필 verify 와 다르다 — 이번 ${JSON.stringify(command)} · 프로필 ${JSON.stringify(verifyCommand)}`, '프로필의 verify 를 공백·따옴표까지 그대로 넘긴다.']
    : ['프로필에 verify 가 없다 — 비교할 명령이 없어 어느 로그도 완료 증거가 못 된다', '.claude/spec-profile.yml 에 verify: 를 적는다.'])
}
const verdict = code !== 0 ? `실패 (exit ${code})` : unusable.length ? '통과했지만 증거로 쓸 수 없다' : '통과'
console.log(`\n${verdict} — 기록: ${relative(ROOT, file)} (${shape})`)
for (const [msg, hint] of unusable) console.log(`  ✗ ${msg}\n      ${hint}`)
process.exit(code)
