#!/usr/bin/env node
/** Record verification output, exit code, and file fingerprints in verify_log_dir. */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { loadDir } from './artifact-parse.mjs'
import { taskFingerprint, repositoryFingerprint } from './task-evidence.mjs'

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
const repository = () => repositoryFingerprint(ROOT, { specDir: yml('spec_dir') || '.sdlc/specs', logDir: logRoot })
const repositoryBefore = repository()
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
  `fingerprints: ${JSON.stringify(before)}`,
  `repository: ${repositoryBefore}`,
  `stable: ${JSON.stringify(before) === JSON.stringify(fingerprints()) && repositoryBefore === repository()}`,
  `head: ${head}`,
  `exit: ${code}`,
  `bytes: ${Buffer.byteLength(out)}`,
  `output: ${shape}`,
  `sha256: ${createHash('sha256').update(out).digest('hex')}`,
  '---',
  body,
].join('\n'))

console.log(`\n${code === 0 ? '통과' : `실패 (exit ${code})`} — 기록: ${relative(ROOT, file)} (${shape})`)
process.exit(code)
