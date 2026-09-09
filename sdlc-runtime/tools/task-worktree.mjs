#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const positional = argv.filter((a, i) => !a.startsWith('-') && !(i > 0 && ['-m', '--message'].includes(argv[i - 1])))
const [dirArg, CMD, TASK] = positional
const MAIN = argv.includes('--main')
const FORCE = argv.includes('--force')
const die = (msg, code = 2) => { console.error(msg); process.exit(code) }
if (!dirArg || !['add', 'commit', 'merge', 'remove'].includes(CMD) || !TASK) {
  die('사용법: task-worktree.mjs <스펙 폴더> add|commit|merge|remove <WP-id> [-m "<제목>"] [--main] [--force]')
}
const DIR = resolve(dirArg)

const lv = spawnSync(process.execPath, [join(HERE, 'plan-levels.mjs'), DIR, '--json'], { encoding: 'utf8' })
let plan
try { plan = JSON.parse(lv.stdout) } catch { die(`plan-levels 를 읽지 못했다:\n${lv.stdout}${lv.stderr}`) }
if (plan.problems?.length) die(`plan.md 의 실행 순서에 문제가 있다 — 먼저 고친다:\n  ${plan.problems.join('\n  ')}`)
const ROOT = plan.root
if (!ROOT) die('프로필을 못 찾았다 — 스펙 폴더의 조상에 .claude/spec-profile.yml 이 없다.')
const task = plan.levels.flatMap((l) => l.tasks).find((t) => t.id === TASK)
if (!task) die(`${TASK} 가 plan.md 의 작업이 아니다. 있는 것: ${plan.levels.flatMap((l) => l.tasks.map((t) => t.id)).join(' · ')}`)
if (!plan.target_branch) die('plan.md §릴리스 영향 에 target_branch 가 없다 — /iterate-spec 으로 채운다.')

const branch = plan.task_branch.replaceAll('{slug}', plan.slug).replaceAll('{task}', TASK)
const wt = resolve(ROOT, plan.worktree_dir, `${plan.slug}-${TASK}`)
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' })
const ok = (r) => r.status === 0
const out = (r) => ((r.stdout ?? '') + (r.stderr ?? '')).trim()
const stdout = (r) => (r.stdout ?? '').trim()
const current = () => stdout(git(ROOT, 'branch', '--show-current'))

if (CMD === 'add') {
  if (existsSync(wt)) die(`워크트리가 이미 있다 — ${relative(ROOT, wt)}. 재개면 그대로 쓰고, 아니면 remove 부터.`)
  if (current() !== plan.target_branch) die(`메인 트리가 ${current() || '(분리된 HEAD)'} 에 있다 — target_branch ${plan.target_branch} 로 먼저 옮긴다.`)
  const r = git(ROOT, 'worktree', 'add', wt, '-b', branch, plan.target_branch)
  if (!ok(r)) die(`worktree add 실패:\n${out(r)}`)
  console.log(`워크트리: ${relative(ROOT, wt)}  브랜치: ${branch}  (기준 ${plan.target_branch})`)
  if (plan.bootstrap) {
    console.log(`  $ ${plan.bootstrap}`)
    const b = spawnSync('sh', ['-c', plan.bootstrap], { cwd: wt, encoding: 'utf8' })
    if (b.status !== 0) die(`bootstrap 실패 (exit ${b.status}):\n${out(b)}`, 3)
    console.log('  bootstrap 통과')
  } else console.log('  bootstrap 없음 — 프로필에 bootstrap 이 없다. 순차 실행이 맞는지 확인한다.')
  console.log(`\n에이전트 프롬프트: node ${relative(ROOT, join(HERE, 'task-brief.mjs'))} ${relative(ROOT, DIR)} ${TASK} --worktree ${relative(ROOT, wt)}`)
}

if (CMD === 'commit') {
  const msg = flag('-m') ?? flag('--message')
  if (!msg) die('-m "<제목>" 이 없다 — 프로필의 commit 관례에 맞춘 제목을 준다.')
  const cwd = MAIN ? ROOT : wt
  if (!MAIN && !existsSync(wt)) die(`워크트리가 없다 — ${relative(ROOT, wt)}. --main 이면 메인 트리에서 커밋한다.`)
  if (MAIN && current() !== plan.target_branch) die(`메인 트리가 ${current()} 에 있다 — target_branch ${plan.target_branch} 가 아니다.`)
  const staged = git(cwd, 'diff', '--cached', '--name-only', '-z', '--no-renames')
  if (!ok(staged)) die(`인덱스를 읽지 못했다:\n${out(staged)}`)
  const outside = staged.stdout.split('\0').filter((f) => f && !task.files.includes(f))
  if (outside.length) die(`작업 범위 밖 파일이 이미 스테이징되어 있다 — 인덱스를 변경하지 않았다: ${outside.join(', ')}`)
  const tracked = git(cwd, 'ls-files', '-z')
  if (!ok(tracked)) die(`추적 파일을 읽지 못했다:\n${out(tracked)}`)
  const known = new Set(tracked.stdout.split('\0'))
  const present = task.files.filter((f) => existsSync(resolve(cwd, f)) || known.has(f))
  if (!present.length) die(`${TASK} 의 files 중 존재하거나 추적 중인 파일이 없다: ${task.files.join(', ')}`)
  const st = stdout(git(cwd, 'status', '--porcelain')).split('\n').filter(Boolean)
    .map((l) => l.trim().replace(/^\S+\s+/, '')).filter((p) => !task.files.includes(p))
  if (st.length) console.error(`⚠ files 밖의 변경 ${st.length}개는 싣지 않는다: ${st.slice(0, 5).join(', ')}${st.length > 5 ? ' …' : ''}`)
  let r = git(cwd, 'add', '-A', '--', ...present)
  if (!ok(r)) die(`git add 실패:\n${out(r)}`)
  if (!stdout(git(cwd, 'diff', '--cached', '--name-only'))) die(`${TASK} 의 files 에 커밋할 변경이 없다.`)
  r = git(cwd, 'commit', '-q', '-m', msg, '-m', `SDLC-Task: ${TASK}\nSDLC-Plan: ${relative(ROOT, join(DIR, 'plan.md'))}`)
  if (!ok(r)) die(`commit 실패:\n${out(r)}`)
  console.log(`커밋 ${out(git(cwd, 'rev-parse', '--short', 'HEAD'))}  ${TASK}  (${present.length}개 파일, trailer 포함)`)
}

if (CMD === 'merge') {
  if (current() !== plan.target_branch) die(`메인 트리가 ${current()} 에 있다 — target_branch ${plan.target_branch} 로 먼저 옮긴다.`)
  if (stdout(git(ROOT, 'status', '--porcelain', '--untracked-files=no'))) die('메인 트리가 더럽다 — 합류 전에 정리한다. 무엇이 누구 변경인지 갈라낼 수 없다.')
  if (!ok(git(ROOT, 'rev-parse', '--verify', '--quiet', branch))) die(`작업 브랜치가 없다 — ${branch}`)
  const r = git(ROOT, 'merge', '--no-edit', branch)
  if (!ok(r)) {
    const conflicts = out(git(ROOT, 'diff', '--name-only', '--diff-filter=U')).split('\n').filter(Boolean)
    git(ROOT, 'merge', '--abort')
    die(`${TASK} 합류에서 충돌 — 되돌렸다. 겹친 파일: ${conflicts.join(', ') || '(알 수 없음)'}\n` +
        '같은 레벨의 files 가 겹치지 않는다고 검사기가 봤으므로, 어느 작업이 files 줄 밖을 만졌다는 신호다. 손으로 풀지 말고 사용자에게 알린다.')
  }
  console.log(`합류 ${TASK} → ${plan.target_branch}  (${out(git(ROOT, 'rev-parse', '--short', 'HEAD'))})`)
}

if (CMD === 'remove') {
  if (existsSync(wt)) {
    const left = stdout(git(wt, 'status', '--porcelain')).split('\n').filter(Boolean)
    if (left.length && !FORCE) {
      die(`워크트리에 커밋되지 않은 변경 ${left.length}개가 남아 있다 — ${relative(ROOT, wt)}\n  ${left.slice(0, 8).join('\n  ')}\n` +
          'commit 이 싣지 않은 스코프 밖 편집이다. 버려도 되면 remove --force, 아니면 사용자에게 보인다.')
    }
    const r = git(ROOT, 'worktree', 'remove', ...(FORCE ? ['--force'] : []), wt)
    if (!ok(r)) die(`worktree remove 실패:\n${out(r)}`)
    console.log(`워크트리 제거: ${relative(ROOT, wt)}${left.length ? ` (변경 ${left.length}개 버림)` : ''}`)
  } else console.log('워크트리가 이미 없다.')
  if (ok(git(ROOT, 'rev-parse', '--verify', '--quiet', branch))) {
    const r = git(ROOT, 'branch', '-d', branch)
    if (!ok(r)) die(`브랜치 삭제 실패 — 머지되지 않은 커밋이 있다:\n${out(r)}`)
    console.log(`브랜치 삭제: ${branch}`)
  }
}
