#!/usr/bin/env node
/** 합류점 검증을 돌리고 **출력을 남긴다.**
 *
 *  `/implement-spec` 의 합류점 verify 는 «통과했다» 는 한 줄로만 §실행 기록에 남았다.
 *  그 한 줄은 모델의 주장이고, 나중에 «정말 통과했나» 를 확인할 길은 커밋을 되짚어
 *  다시 돌리는 것뿐이었다. 여기서는 명령을 이 프로세스가 돌리고, 출력과 종료 코드를
 *  헤더와 함께 파일로 남긴다 — 통과의 증거가 저장소에 들어간다.
 *
 *  로그는 산출물 폴더 **밖**에 둔다. 산출물은 계약이고 기계가 그 안에 끼어들면 안 된다.
 *  자리는 프로필의 `verify_log_dir`(기본 `.sdlc/verify`) 밑 `<slug>/` 이고,
 *  `plan-progress.mjs` 가 체크된 작업마다 이 기록이 있는지 대조한다.
 *
 *    node verify-run.mjs <스펙 폴더> --level <N> --tasks WP-003,WP-004 [--label <게이트>] -- "<명령>"
 *
 *  종료 코드는 명령의 것을 그대로 낸다 — 실패를 삼키면 로그가 «통과» 로 읽힌다.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
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

/** 레포 뿌리는 프로필이 있는 가장 가까운 조상이다 — 검사기·plan-progress 와 같은 규칙. */
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

/** 같은 초에 두 번 돌면(실패 → 바로 재실행) 파일이 덮이고 실패 기록이 사라진다.
 *  밀리초까지 쓰고, 그래도 겹치면 번호를 단다 — 실패한 로그는 지워지지 않아야 한다. */
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

/** 헤더는 `키: 값` 한 줄씩이다 — plan-progress 가 이것만 읽는다. 출력은 `---` 아래다. */
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
  '---',
  out,
].join('\n'))

console.log(`\n${code === 0 ? '통과' : `실패 (exit ${code})`} — 기록: ${relative(ROOT, file)}`)
process.exit(code)
