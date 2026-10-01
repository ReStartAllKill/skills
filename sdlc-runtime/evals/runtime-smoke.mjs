#!/usr/bin/env node
/** Verify task attribution, completion evidence, approval guards, hook installation, and runtime integration in temporary repositories. */
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
import { findSkill } from './skills.mjs'
import { driftInReport } from '../tools/rules.mjs'
import { taskFingerprint, repositoryFingerprint, taskFingerprintV1, repositoryFingerprintV1 } from '../tools/task-evidence.mjs'
import { loadDir } from '../tools/artifact-parse.mjs'
const tool = (name) => join(ROOT, 'tools', name)
const results = []

/** Every report a case reads from a checker — text or `--json` — is held to the rule registry here,
 *  in the one function every case runs a tool through, rather than case by case. Drift fails the
 *  case that produced it and, collected, the whole run: a case that catches the error itself must
 *  not swallow it. The tools only print drift to stderr; this is where it is enforced. */
const CHECKERS = new Set(['check-artifacts.mjs', 'adr-bindings.mjs'])
const audited = { reports: 0, problems: 0, drift: [] }
function run(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (cmd === process.execPath && CHECKERS.has(basename(String(args[0] ?? '')))) {
    const a = driftInReport(r.stdout ?? '')
    if (a) {
      audited.reports++; audited.problems += a.problems
      if (a.drift.length) {
        audited.drift.push(...a.drift)
        throw new Error(`${basename(args[0])} 의 보고가 규칙 등록부와 어긋난다: ${a.drift.join(' | ')}`)
      }
    }
  }
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}
function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error((r.stdout ?? '') + (r.stderr ?? ''))
  return r.stdout.trim()
}

function temp(prefix) { return mkdtempSync(join(tmpdir(), `${prefix}-`)) }
function put(path, body, mode) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  if (mode) chmodSync(path, mode)
}
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }) }
  catch (e) { results.push({ name, ok: false, error: e.message }) }
}
function assert(value, message) { if (!value) throw new Error(message) }

await test('plan-progress attributes WP commits through trailers', () => {
  const d = temp('sdlc-progress')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: .\n')
  put(join(d, 'plan.md'), `---
artifact: plan
schema_version: 4
status: in_progress
---

## 작업 \`[필수 · 모든 티어]\`

- [ ] **WP-001 — 첫 변경**
  - files: \`search/query.ts\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 첫 기준
  - verify: true

- [ ] **WP-002 — 후속 변경**
  - files: \`search/query.ts\`
  - depends: WP-001
  - covers: FR-002 (AC-002)
  - tests: 둘째 기준
  - verify: true

## 실행 기록

해당 없음 — 아직 실행 전.
`)
  put(join(d, 'search/query.ts'), 'export const value = 0\n')
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'plan born')
  put(join(d, 'search/query.ts'), 'export const value = 1\n')
  git(d, 'add', 'search/query.ts'); git(d, 'commit', '-qm', 'first change', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: plan.md')
  const r = run(process.execPath, [tool('plan-progress.mjs'), d, '--json'])
  assert(r.code === 0, r.out)
  const got = JSON.parse(r.out)
  assert(got.rows.find((x) => x.id === 'WP-001').commits.length === 1, 'WP-001 귀속 커밋을 못 찾았다')
  assert(got.rows.find((x) => x.id === 'WP-002').commits.length === 0, 'WP-001 커밋을 WP-002에 잘못 귀속했다')
})

const PROGRESS_PLAN = `---
artifact: plan
schema_version: 4
status: in_progress
---

## 작업 \`[필수 · 모든 티어]\`

- [ ] **WP-001 — 첫 변경**
  - files: \`search/query.ts\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 첫 기준
  - verify: true

- [ ] **WP-002 — 후속 변경**
  - files: \`search/query.ts\`
  - depends: WP-001
  - covers: FR-002 (AC-002)
  - tests: 둘째 기준
  - verify: true

- [ ] **WP-003 — 셋째 변경**
  - files: \`search/query.ts\`
  - depends: WP-002
  - covers: FR-003 (AC-003)
  - tests: 셋째 기준
  - verify: true

## 실행 기록

해당 없음 — 아직 실행 전.
`

await test('plan-progress finds task commits made before the plan was tracked', () => {
  // A repository that ignored its artifact directory and starts tracking it later: the plan's first
  // commit is the newest one, so a lower bound at that commit holds nothing. This is what every
  // plan in a real repository looked like the day after `.sdlc/` left .gitignore.
  const d = temp('sdlc-progress-late')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: .\n')
  put(join(d, '.gitignore'), 'plan.md\n')
  put(join(d, 'plan.md'), PROGRESS_PLAN)
  put(join(d, 'search/query.ts'), 'export const value = 0\n')
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'code without the plan')
  put(join(d, 'search/query.ts'), 'export const value = 1\n')
  git(d, 'add', 'search/query.ts'); git(d, 'commit', '-qm', 'first change', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: plan.md')
  put(join(d, '.gitignore'), '')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'start tracking the plan')

  const r = run(process.execPath, [tool('plan-progress.mjs'), d, '--json'])
  assert(r.code === 0, r.out)
  const got = JSON.parse(r.out)
  assert(got.rows.find((x) => x.id === 'WP-001').commits.length === 1, 'plan 추적 이전의 WP-001 귀속 커밋을 못 찾았다')
  assert(got.rows.find((x) => x.id === 'WP-002').commits.length === 0, 'WP-001 커밋을 WP-002에 잘못 귀속했다')
})

await test('plan-progress reads a squash-merged trailer that names several tasks', async () => {
  // GitHub's squash merge concatenates every task commit's message, and the joined trailer reads
  // `SDLC-Task: WP-001, WP-002`. Reading only the one-id form lost every task in the PR at once.
  const d = temp('sdlc-progress-squash')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: .\n')
  put(join(d, 'plan.md'), PROGRESS_PLAN)
  put(join(d, 'search/query.ts'), 'export const value = 0\n')
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'plan born')
  put(join(d, 'search/query.ts'), 'export const value = 1\n')
  git(d, 'add', 'search/query.ts')
  git(d, 'commit', '-qm', 'feat: squashed PR (#1)', '-m',
    'first task\n\nSDLC-Task: WP-001, WP-002\nSDLC-Plan: plan.md\n\nsecond task\n\nSDLC-Task: WP-003 WP-999\nSDLC-Plan: plan.md\n\nSDLC-Task: not-a-task, WP-002\nSDLC-Plan: plan.md')

  const r = run(process.execPath, [tool('plan-progress.mjs'), d, '--json'])
  assert(r.code === 0, r.out)
  const got = JSON.parse(r.out)
  const commits = (id) => got.rows.find((x) => x.id === id).commits.length
  assert(commits('WP-001') === 1, 'WP-001 — 쉼표로 합친 트레일러를 못 읽었다')
  assert(commits('WP-002') === 1, 'WP-002 — 쉼표로 합친 트레일러의 둘째 id 를 못 읽었다')
  assert(commits('WP-003') === 1, 'WP-003 — 공백으로 합친 트레일러를 못 읽었다')
  // The third trailer line is garbled; a partial match would make garbage count as attribution.
  const { taskTrailerIds } = await import(tool('commit-records.mjs'))
  assert(taskTrailerIds('SDLC-Task: not-a-task, WP-002') === null, '깨진 트레일러 줄을 부분 일치로 읽었다')
  assert(taskTrailerIds('SDLC-Plan: plan.md') === null, 'SDLC-Plan 줄을 작업 트레일러로 읽었다')
})

await test('verify-run records output and exit codes, and plan-progress compares tests with verification logs', () => {
  const d = temp('sdlc-verify')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: .sdlc/specs\nverify: echo ok\n')
  const spec = join(d, '.sdlc/specs/2026-09-05-v')
  put(join(spec, 'plan.md'), `---
artifact: plan
schema_version: 4
status: in_progress
---

## 작업 \`[필수 · 모든 티어]\`

- [x] **WP-001 — 첫 변경**
  - files: \`src/a.js\`, \`src/a.test.js\`
  - depends: 없음
  - covers: FR-001 (AC-001, AC-002)
  - tests: 보관 문서가 함께 걸리면 일반 문서만 반환된다 · 질의가 비면 빈 목록을 반환한다
  - verify: true

## 실행 기록

- 2026-09-05 WP-001 — 완료
`)
  put(join(d, 'src/a.js'), 'export const a = 1\n')
  put(join(d, 'src/a.test.js'), "test('보관 문서가 함께 걸리면 일반 문서만 반환된다', () => {})\n")
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'plan born')
  put(join(d, 'src/a.js'), 'export const a = 2\n')
  git(d, 'add', 'src/a.js'); git(d, 'commit', '-qm', 'change', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: .sdlc/specs/2026-09-05-v/plan.md')

  let r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  let got = JSON.parse(r.out)
  let row = got.rows.find((x) => x.id === 'WP-001')
  assert(row.tests.missing.length === 1 && row.tests.missing[0].includes('질의가 비면'), `tests 대조가 틀렸다: ${JSON.stringify(row.tests)}`)
  assert(got.notes.some((n) => n.msg.includes('tests 문장')), 'tests 문장 누락을 경고하지 않는다')
  assert(got.notes.some((n) => n.msg.includes('verify 기록이 없다')), 'verify 기록 부재를 경고하지 않는다')

  r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', 'echo boom; exit 3'])
  assert(r.code === 3, `실패 종료 코드를 삼켰다 (${r.code})`)
  const logs = () => readdirSync(join(d, '.sdlc/verify/2026-09-05-v'))
  assert(logs().length === 1 && readFileSync(join(d, '.sdlc/verify/2026-09-05-v', logs()[0]), 'utf8').includes('exit: 3'), '실패 로그가 없거나 exit 가 안 남았다')
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  assert(JSON.parse(r.out).rows[0].verified.length === 0, '실패한 verify 를 검증으로 셌다')

  put(join(d, 'src/a.test.js'), "test('보관 문서가 함께 걸리면 일반 문서만 반환된다', () => {})\ntest('질의가 비면 빈 목록을 반환한다', () => {})\n")
  r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', 'echo ok'])
  assert(r.code === 0 && r.out.includes('통과'), r.out)
  assert(logs().length === 2, '통과 로그가 실패 로그 옆에 서지 않았다')
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  got = JSON.parse(r.out); row = got.rows[0]
  assert(row.tests.missing.length === 0 && row.verified.length === 1, `대조가 안 풀렸다: ${JSON.stringify({ tests: row.tests, verified: row.verified })}`)
  assert(!got.notes.some((n) => n.msg.includes('tests 문장') || n.msg.includes('verify 기록')), '경고가 남아 있다')
  put(join(d, 'src/a.js'), 'export const a = 99\n')
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  assert(JSON.parse(r.out).rows[0].verified.length === 0, '검증 뒤 바뀐 코드를 과거 로그로 통과시켰다')

})

await test('plan-levels, task-worktree, and task-brief produce deterministic levels, plumbing, and prompts', () => {
  const d = temp('sdlc-tw')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: .sdlc/specs\nworktree_dir: .wt\ntask_branch: "task/{slug}-{task}"\nbootstrap: "echo bootstrapped > .bootstrapped"\nverify: true\n')
  put(join(d, '.claude/rules/api.md'), '---\npaths: ["src/api/**"]\n---\n# API 규칙\n')
  put(join(d, '.claude/rules/global.md'), '---\ndescription: 전역\n---\n# 전역 규칙\n')
  put(join(d, '.gitignore'), '.wt/\n.bootstrapped\n')
  const spec = join(d, '.sdlc/specs/2026-09-05-tw')
  put(join(spec, 'spec.md'), `---
artifact: spec
schema_version: 4
status: accepted
---

## 요구사항

### FR-001 — 검색은 보관 문서를 뺀다 \`Must\`

근거: OUT-001

검색 질의는 보관 문서를 결과에서 제외한다.

수용 기준:

- [ ] AC-001 — 보관 문서가 함께 걸리면 일반 문서만 반환된다
- [ ] AC-002 — 질의가 비면 빈 목록을 반환한다
`)
  put(join(spec, 'plan.md'), `---
artifact: plan
schema_version: 4
status: accepted
---

## 릴리스 영향

target_branch: feat/tw
pr_strategy: 단일 PR

## 작업

- [ ] **WP-001 — 필터를 만든다**
  - files: \`src/api/filter.js\`, \`src/api/filter.test.js\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 보관 문서가 함께 걸리면 일반 문서만 반환된다
  - verify: true

- [ ] **WP-002 — 빈 질의를 다룬다**
  - files: \`src/core/empty.js\`
  - depends: 없음
  - covers: FR-001 (AC-002)
  - tests: 질의가 비면 빈 목록을 반환한다
  - verify: true

- [ ] **WP-003 — 둘을 잇는다**
  - files: \`src/api/filter.js\`
  - depends: WP-001, WP-002
  - covers: FR-001
  - tests: 보관 문서가 함께 걸리면 일반 문서만 반환된다 · 질의가 비면 빈 목록을 반환한다
  - verify: true

## 실행 기록

해당 없음 — 아직 실행 전.
`)
  put(join(d, 'src/api/filter.js'), 'export const f = 0\n')
  git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'plan born'); git(d, 'switch', '-qc', 'feat/tw')

  let r = run(process.execPath, [tool('plan-levels.mjs'), spec, '--json'])
  assert(r.code === 0, r.out)
  const lv = JSON.parse(r.out)
  assert(lv.levels.length === 2 && lv.levels[0].mode === 'parallel' && lv.levels[1].mode === 'main', JSON.stringify(lv.levels.map((l) => [l.n, l.mode])))
  assert(lv.next === 1 && lv.target_branch === 'feat/tw', `next/target_branch 가 틀렸다: ${lv.next} ${lv.target_branch}`)

  const tpl = join(temp('sdlc-tpl'), 'writer.md')
  put(tpl, '{task_id}|{worktree}|{bootstrap}\n{files}\n{requirements}\n{rules}\n{parallel_note}\n')
  r = run(process.execPath, [tool('task-brief.mjs'), spec, 'WP-001', '--template', tpl, '--worktree', '.wt/x'])
  assert(r.code === 0, r.out)
  assert(r.out.includes('AC-001 — 보관 문서가 함께 걸리면 일반 문서만 반환된다'), 'covers 의 AC 문장이 안 실렸다')
  assert(!r.out.includes('AC-002'), 'covers 에 없는 AC 가 실렸다')
  assert(r.out.includes('rules/api.md') && r.out.includes('rules/global.md'), `규칙 매칭이 틀렸다:\n${r.out}`)
  assert(r.out.includes('WP-002') && r.out.includes('병렬'), '병렬 주의가 없다')
  r = run(process.execPath, [tool('task-brief.mjs'), spec, 'WP-002', '--template', tpl])
  assert(!r.out.includes('rules/api.md') && r.out.includes('rules/global.md'), 'paths 가 안 맞는 규칙이 실렸다')
  r = run(process.execPath, [tool('task-brief.mjs'), spec, 'WP-001', '--worktree', '.wt/x'])
  assert(r.code === 0 && !/\{[a-z_]+\}/.test(r.out) && !r.out.includes('채우지 못한 자리') && r.out.includes('Do not commit'), `기본 템플릿이 안 채워졌다:\n${r.out.slice(0, 400)}`)

  const twt = (...a) => run(process.execPath, [tool('task-worktree.mjs'), spec, ...a])
  r = twt('add', 'WP-001')
  assert(r.code === 0 && existsSync(join(d, '.wt/2026-09-05-tw-WP-001/.bootstrapped')), `add 실패:\n${r.out}`)
  assert(git(d, 'branch', '--list', 'task/2026-09-05-tw-WP-001').trim() !== '', '작업 브랜치가 없다')
  const wt = join(d, '.wt/2026-09-05-tw-WP-001')
  put(join(wt, 'src/api/filter.js'), 'export const f = 1\n')
  put(join(wt, 'src/api/filter.test.js'), "test('보관 문서가 함께 걸리면 일반 문서만 반환된다', () => {})\n")
  put(join(wt, 'src/stray.js'), 'stray\n')
  git(wt, 'add', 'src/stray.js')
  const stagedBefore = git(wt, 'diff', '--cached')
  r = twt('commit', 'WP-001', '-m', 'feat(search): 거절되어야 함')
  assert(r.code === 2 && git(wt, 'diff', '--cached') === stagedBefore, '기존 인덱스를 섞거나 변경했다')
  git(wt, 'restore', '--staged', 'src/stray.js')
  r = twt('commit', 'WP-001', '-m', 'feat(search): 필터')
  assert(r.code === 0 && r.out.includes('files 밖의 변경 1개'), `commit 이 스코프 밖을 경고하지 않았다:\n${r.out}`)
  const body = git(wt, 'log', '-1', '--format=%B')
  assert(/SDLC-Task: WP-001/.test(body), 'trailer 가 없다')
  assert(!git(wt, 'show', '--name-only', '--format=', 'HEAD').includes('stray.js'), '스코프 밖 파일이 실렸다')
  r = twt('merge', 'WP-001')
  assert(r.code === 0 && git(d, 'log', '-1', '--format=%B').includes('SDLC-Task: WP-001'), `merge 실패:\n${r.out}`)
  r = twt('remove', 'WP-001')
  assert(r.code === 2 && r.out.includes('stray.js'), `남은 스코프 밖 변경을 조용히 버렸다:\n${r.out}`)
  r = twt('remove', 'WP-001', '--force')
  assert(r.code === 0 && !existsSync(wt) && git(d, 'branch', '--list', 'task/2026-09-05-tw-WP-001').trim() === '', `remove 실패:\n${r.out}`)
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  assert(JSON.parse(r.out).rows.find((x) => x.id === 'WP-001').commits.length === 1, '합류된 커밋이 귀속되지 않았다')
  twt('add', 'WP-002'); put(join(d, '.wt/2026-09-05-tw-WP-002/src/api/filter.js'), 'export const f = 2\n'); put(join(d, '.wt/2026-09-05-tw-WP-002/src/core/empty.js'), 'x\n')
  git(join(d, '.wt/2026-09-05-tw-WP-002'), 'add', '-A'); git(join(d, '.wt/2026-09-05-tw-WP-002'), 'commit', '-qm', 'conflict')
  put(join(d, 'src/api/filter.js'), 'export const f = 3\n'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'main moved')
  r = twt('merge', 'WP-002')
  assert(r.code === 2 && r.out.includes('충돌') && r.out.includes('src/api/filter.js'), `충돌을 되돌리지 않았다:\n${r.out}`)
  assert(git(d, 'status', '--porcelain', '--untracked-files=no') === '', '충돌 뒤 메인 트리가 더럽다')
})

await test('completed rejects open tasks', () => {
  const d = temp('sdlc-completed')
  put(join(d, 'plan.md'), `---
artifact: plan
schema_version: 4
status: completed
---

## 작업 \`[필수 · 모든 티어]\`

- [ ] **WP-001 — 남은 작업**
  - files: \`src/a.ts\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 기준
  - verify: true

## 실행 기록

해당 없음 — 아직 실행 전.
`)
  const r = run(process.execPath, [tool('plan-progress.mjs'), d])
  assert(r.code !== 0 && r.out.includes('completed 인데 미완료 작업'), r.out)
  const structural = run(process.execPath, [tool('check-artifacts.mjs'), d])
  assert(structural.code !== 0 && structural.out.includes('completed') && structural.out.includes('미완료 작업'), structural.out)
})

await test('the approval guard rejects self-approval and changes to accepted content', () => {
  const d = temp('sdlc-guard')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 4\nsdlc_runtime: "${ROOT}"\nspec_dir: ".claude/specs"\n`)
  const intent = join(d, '.claude/specs/change/intent.md')
  put(intent, '---\nartifact: intent\nstatus: in_review\napproved_by: null\n---\n\n초안\n')
  const env = { ...process.env, CLAUDE_PROJECT_DIR: d }
  const invoke = (payload) => run(tool('guard-approval.sh'), [], { env, input: JSON.stringify(payload) })
  let r = invoke({ tool_name: 'Write', tool_input: { file_path: intent, content: 'status: draft\napproved_by: null' } })
  assert(r.code === 0, '정상 draft Write를 과잉 차단했다')
  const asks = (r) => (r.out ?? '').includes('"permissionDecision":"ask"')

  r = invoke({ tool_name: 'Write', tool_input: { file_path: intent, content: 'status: accepted\napproved_by: "agent"' } })
  assert(asks(r), 'Write 자기승인을 사람에게 안 물어본다')
  r = invoke({ tool_name: 'Bash', tool_input: { command: `sed -i '' 's/status: .*/status: accepted/' '${intent}'` } })
  assert(r.code === 2, 'Bash 자기승인을 막지 못했다')
  put(intent, '---\nartifact: intent\nstatus: accepted\napproved_by: "human"\n---\n\n승인된 의미\n')
  r = invoke({ tool_name: 'Edit', tool_input: { file_path: intent, old_string: '승인된 의미', new_string: '바뀐 의미' } })
  assert(asks(r), 'accepted 본문 변경을 상태 하향 없이 조용히 허용했다')

  r = run(tool('guard-approval.sh'), [], {
    env: { ...env, SDLC_AUTONOMY_ROUTE: 'triage' },
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: intent, content: 'status: accepted\napproved_by: "agent"' } }),
  })
  assert(r.code === 2, '자율 실행이 자기 문서를 승인할 수 있다')
})

await test('hook installation is idempotent and registers the Bash approval guard', () => {
  const d = temp('sdlc-hook')
  for (let i = 0; i < 2; i++) {
    const r = run(process.execPath, [tool('install-hook.mjs'), d])
    assert(r.code === 0, r.out)
  }
  const s = JSON.parse(readFileSync(join(d, '.claude/settings.json'), 'utf8'))
  const count = (event, matcher, file) => (s.hooks[event] ?? [])
    .filter((e) => e.matcher === matcher)
    .flatMap((e) => e.hooks ?? [])
    .filter((h) => String(h.command).includes(file)).length
  assert(count('PreToolUse', 'Edit|Write', 'sdlc-approval.sh') === 1, 'Edit|Write 승인 가드가 중복되거나 없다')
  assert(count('PreToolUse', 'Bash', 'sdlc-approval.sh') === 1, 'Bash 승인 가드가 중복되거나 없다')
  assert(count('PostToolUse', 'Edit|Write', 'sdlc-gate.sh') === 1, '산출물 게이트가 중복되거나 없다')
})

await test('the gate passes cleanly when a document has no warnings', () => {
  const d = temp('sdlc-gate-clean')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: ".sdlc/specs"\n')
  const chain = join(d, '.sdlc/specs/change')
  cpSync(join(findSkill('create-plan', HERE), 'evals/cases/clean-light/docs'), chain, { recursive: true })

  const r = spawnSync(tool('gate-artifacts.sh'), [], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { file_path: join(chain, 'intent.md') } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: d, SDLC_RUNTIME: ROOT },
  })
  assert(r.status === 0, `깨끗한 산출물 세트에서 게이트가 실패했다 (code ${r.status})\n${r.stdout}\n${r.stderr}`)
  assert(!/unbound|command not found/.test(r.stderr ?? ''), `게이트가 셸 오류를 냈다:\n${r.stderr}`)
})

await test('the shim finds the runtime in either supported plugin layout', () => {
  const d = temp('sdlc-shim')
  run(process.execPath, [tool('install-hook.mjs'), d])
  const shim = join(d, '.claude/hooks/sdlc-gate.sh')

  for (const rel of ['.claude/skills/restart-harness/sdlc-runtime',
                     '.claude/plugins/cache/mkt/restart-harness/0.1.0/sdlc-runtime']) {
    const home = temp('sdlc-home')
    const tools = join(home, rel, 'tools')
    mkdirSync(tools, { recursive: true })
    const marker = join(tools, 'gate-artifacts.sh')
    writeFileSync(marker, '#!/usr/bin/env bash\necho FOUND\n')
    chmodSync(marker, 0o755)

    const r = spawnSync('bash', [shim], {
      encoding: 'utf8', input: '{}',
      env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: d },
    })
    assert((r.stdout ?? '').includes('FOUND'), `${rel} 에 있는 런타임을 shim 이 못 찾는다 — 훅이 조용히 꺼진다`)
  }
})

await test('check-all promotes a plan-progress failure to a CI failure', () => {
  const d = temp('sdlc-check-all')
  const fake = join(d, '.runtime/tools')
  for (const name of ['check-artifacts.mjs', 'lint-prose.mjs']) put(join(fake, name), '#!/usr/bin/env node\nprocess.exit(0)\n')
  put(join(fake, 'plan-progress.mjs'), '#!/usr/bin/env node\nconsole.error("progress sentinel")\nprocess.exit(1)\n')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: ".claude/specs"\nsdlc_runtime: ".runtime"\n')
  put(join(d, '.claude/specs/change/plan.md'), '---\nartifact: plan\nschema_version: 4\n---\n')
  const r = run(process.execPath, [tool('check-all.mjs'), d])
  assert(r.code !== 0 && r.out.includes('progress sentinel'), r.out)
})

await test('the vendor check detects content drift at the same version', () => {
  const d = temp('sdlc-vendor')
  git(d, 'init', '-q')
  let r = run(tool('vendor-runtime.sh'), [d])
  assert(r.code === 0, r.out)
  assert(existsSync(join(d, '.claude/sdlc/tools/plan-progress.mjs')), 'plan-progress가 벤더되지 않았다')
  r = run(tool('vendor-runtime.sh'), ['--check', d])
  assert(r.code === 0, r.out)
  appendFileSync(join(d, '.claude/sdlc/conventions.md'), '\n로컬 드리프트\n')
  r = run(tool('vendor-runtime.sh'), ['--check', d])
  assert(r.code !== 0 && r.out.includes('내용이 글로벌과 다르다'), r.out)
})

// A vendored copy is the only runtime a team's CI has, so it must run on its own. The copy list
// once lacked `locales/`, added in 0.2.0, and every vendored tool died in useLocale while the
// global copy kept passing — exactly the drift the vendor exists to prevent.
await test('a vendored runtime runs its checker without the global copy', () => {
  const d = temp('sdlc-vendor-standalone')
  git(d, 'init', '-q')
  let r = run(tool('vendor-runtime.sh'), [d])
  assert(r.code === 0, r.out)
  const vendored = join(d, '.claude/sdlc/tools/check-artifacts.mjs')
  r = run(process.execPath, [vendored, '--version'])
  assert(r.code === 0 && r.out.includes(`sdlc-runtime ${readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()}`),
    `벤더 사본의 검사기가 혼자 돌지 않는다:\n${r.out}`)
  rmSync(join(d, '.claude/sdlc/locales'), { recursive: true, force: true })
  r = run(tool('vendor-runtime.sh'), ['--check', d])
  assert(r.code !== 0, 'locales 가 빠진 사본을 --check 가 일치로 읽는다')
})

await test('migration safely raises only the profile to the runtime version', () => {
  const d = temp('sdlc-migrate')
  const profile = join(d, '.claude/spec-profile.yml')
  put(profile, 'sdlc_version: 3\nspec_dir: ".claude/specs"\n')
  let r = run(process.execPath, [tool('migrate-schema.mjs'), d])
  assert(r.code === 0 && r.out.includes('v4 작업 귀속·완료 증거'), r.out)
  r = run(process.execPath, [tool('migrate-schema.mjs'), d, '--profile'])
  const cur = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()
  assert(r.code === 0 && new RegExp(`^sdlc_version: ${cur}$`, 'm').test(readFileSync(profile, 'utf8')), r.out)
})

await test('migration does not automatically upgrade a v3 plan with execution history', () => {
  const d = temp('sdlc-migrate-plan')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 3\nspec_dir: ".claude/specs"\n')
  const chain = join(d, '.claude/specs/change')
  cpSync(join(findSkill('create-plan', HERE), 'evals/cases/clean-light/docs'), chain, { recursive: true })
  const plan = join(chain, 'plan.md')
  writeFileSync(plan, readFileSync(plan, 'utf8')
    .replace('status: accepted', 'status: in_progress')
    .replace('- [ ] **WP-001', '- [x] **WP-001'))
  const r = run(process.execPath, [tool('migrate-schema.mjs'), d, '--chains'])
  assert(r.code === 0 && r.out.includes('v4 작업 증거') && r.out.includes('건너뜀'), r.out)
  assert(/^schema_version: 3$/m.test(readFileSync(plan, 'utf8')), '실행 중인 v3 plan을 자동 승격했다')
})

await test('migrate-schema raises the profile and skips artifact sets that fail validation', () => {
  const d = temp('sdlc-migrate')
  const cur = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\n')

  const chain = join(d, '.claude/specs/2026-09-04-a')
  put(join(chain, 'intent.md'), `---
artifact: intent
id: "CHG-2026-001"
title: "제목"
status: accepted
tier: light
owner: "팀"
created: 2026-09-04
updated: 2026-09-04
generated_by: "claude-opus-5"
---

# Intent: 제목

## 문제 \`[필수 · 모든 티어]\`

지금은 안 된다.

## 목표 결과 \`[필수 · 모든 티어]\`

### OUT-001 — 된다 \`Should\`

된다.

확인: 본다.

## 비목표 \`[필수 · 모든 티어]\`

- 다른 것은 안 한다.

## 제약 \`[필수 · 모든 티어]\`

해당 없음 — 제약이 없다.

## 열린 질문 \`[필수 · 모든 티어]\`

해당 없음 — 질문이 없다.
`)

  let r = run('node', [tool('migrate-schema.mjs'), d])
  assert(r.code === 0, r.out)
  assert(r.out.includes('프로필 없음'), r.out)
  assert(!readFileSync(join(d, '.claude/spec-profile.yml'), 'utf8').includes('sdlc_version'),
    '보고만 하는데 프로필을 바꿨다')

  r = run('node', [tool('migrate-schema.mjs'), d, '--profile'])
  assert(r.code === 0, r.out)
  assert(readFileSync(join(d, '.claude/spec-profile.yml'), 'utf8').includes(`sdlc_version: ${cur}`), r.out)

  r = run('node', [tool('migrate-schema.mjs'), d, '--artifact-sets'])
  assert(r.code === 0, r.out)
  assert(r.out.includes('건너뜀'), r.out)
  assert(!readFileSync(join(chain, 'intent.md'), 'utf8').includes('schema_version'),
    '검사에 실패하는 산출물 세트를 올려버렸다')

  writeFileSync(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 99\nspec_dir: .claude/specs\n')
  r = run('node', [tool('migrate-schema.mjs'), d, '--profile'])
  assert(r.code !== 0 && r.out.includes('런타임보다 높다'), r.out)
  assert(readFileSync(join(d, '.claude/spec-profile.yml'), 'utf8').includes('sdlc_version: 99'),
    '프로필 버전을 내렸다')
})

await test('the approval guard permits plan execution-state transitions', () => {
  const d = temp('sdlc-trans')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\n')
  const plan = join(d, '.claude/specs/2026-09-05-a/plan.md')
  const guard = tool('guard-approval.sh')

  const attempt = (from, to, env = {}, permission_mode = undefined) => {
    put(plan, `---\nartifact: plan\nschema_version: 4\nstatus: ${from}\n---\n\n# Plan\n`)
    const r = spawnSync(guard, [], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: d, ...env },
      input: JSON.stringify({
        tool_name: 'Edit', permission_mode,
        tool_input: { file_path: plan, new_string: `status: ${to}` },
      }),
    })
    if ((r.status ?? 1) === 2) return 'deny'
    if ((r.stdout ?? '').includes('"permissionDecision":"ask"')) return 'ask'
    return 'pass'
  }

  assert(attempt('accepted', 'in_progress') === 'pass', 'accepted → in_progress 가 막혔다 — 구현이 시작조차 못 한다')
  assert(attempt('in_progress', 'completed') === 'pass', 'in_progress → completed 가 막혔다')
  assert(attempt('accepted', 'in_review') === 'pass', 'accepted → in_review 가 막혔다')
  assert(attempt('in_review', 'accepted') === 'ask', 'in_review → accepted 가 사람에게 안 물어본다')
  assert(attempt('in_review', 'accepted', { SDLC_AUTONOMY_ROUTE: 'triage' }) === 'deny',
    '자율 실행이 자기 문서를 승인할 수 있다 — 정책 승인 설계가 무너진다')
  assert(attempt('accepted', 'completed') === 'ask', '실행을 건너뛴 completed 가 조용히 통과한다')

  for (const m of ['default', 'plan', 'acceptEdits', 'auto', 'bypassPermissions']) {
    assert(attempt('in_review', 'accepted', {}, m) === 'ask', `permission_mode=${m} 에서 승인 전이가 다이얼로그로 가지 않는다`)
  }
  assert(attempt('in_review', 'accepted', {}, 'dontAsk') === 'deny', 'dontAsk 에서 이유 없이 거부된다')
  assert(attempt('accepted', 'in_progress', {}, 'bypassPermissions') === 'pass',
    'bypassPermissions 에서 구현 시작이 막혔다')
})

await test('an autonomous route can use only its own policy approval', () => {
  const d = temp('sdlc-polguard')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\n')
  const doc = join(d, '.claude/specs/2026-09-05-a/intent.md')
  const guard = tool('guard-approval.sh')

  const attempt = (edit, { was = 'in_review', had = 'null', route } = {}) => {
    put(doc, `---\nartifact: intent\nschema_version: 4\nstatus: ${was}\ngenerated_by: claude\napproved_by: ${had}\n---\n\n# Intent\n`)
    const r = spawnSync(guard, [], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: d, ...(route ? { SDLC_AUTONOMY_ROUTE: route } : {}) },
      input: JSON.stringify({
        tool_name: 'Edit', permission_mode: 'acceptEdits',
        tool_input: { file_path: doc, new_string: edit },
      }),
    })
    if ((r.status ?? 1) === 2) return 'deny'
    if ((r.stdout ?? '').includes('"permissionDecision":"ask"')) return 'ask'
    return 'pass'
  }

  const R = { route: 'triage' }
  assert(attempt('status: accepted\napproved_by: policy:triage', R) === 'pass',
    '자율 루트가 자기 정책 승인을 못 쓴다 — 정책 승인 설계가 발화하지 않는다')
  assert(attempt('approved_by: policy:triage', R) === 'pass', '승인자만 먼저 쓰는 편집이 막혔다')
  assert(attempt('status: accepted', { ...R, had: 'policy:triage' }) === 'pass',
    '이미 정책 승인된 문서의 상태 전이가 막혔다')

  assert(attempt('approved_by: policy:wider', R) === 'deny', '자율 루트가 남의 위임을 빌려 썼다')
  assert(attempt('approved_by: 한지우', R) === 'deny', '자율 루트가 사람 이름으로 승인했다')
  assert(attempt('status: accepted', R) === 'deny', '자율 루트가 승인자 없이 accepted 로 올렸다')
  assert(attempt('approved_by: policy:triage') === 'deny', '사람 세션에서 policy: 승인이 조용히 통과했다')
})

await test('an autonomous route enforces all four delegation boundaries at runtime', () => {
  const d = temp('sdlc-auto')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .sdlc/specs\nautonomy: .claude/autonomy.yml\n')
  const policy = (expires, extra = '') => `version: 1
owner: "플랫폼팀"

routes:
  triage:
    trigger: band_breach
    max_tier: light
    advance_to: intent
    tools: "Read,Grep,Glob,Edit,Write"
    expires: ${expires}
${extra}`
  put(join(d, '.claude/autonomy.yml'), policy('2099-12-31'))

  const dispatch = (...a) => spawnSync('node', [tool('dispatch-auto.mjs'), d, ...a], { encoding: 'utf8' })

  let r = dispatch('--route', 'triage', '--signal', 'CI 실패율 12.4%', '--dry-run')
  assert(r.status !== 0 && (r.stderr + r.stdout).includes('승인 가드'), '가드 없는 레포에서 자율 실행이 돌았다')
  assert(spawnSync(process.execPath, [tool('install-hook.mjs'), d], { encoding: 'utf8' }).status === 0, '훅 설치 실패')

  r = dispatch('--route', 'triage', '--signal', 'CI 실패율 12.4%', '--dry-run')
  assert(r.status === 0, r.stdout + r.stderr)
  const allowed = /--allowedTools "([^"]+)"/.exec(r.stdout)?.[1] ?? ''
  for (const t of ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Skill', 'Bash(git log:*)'])
    assert(allowed.split(',').includes(t), `허용 도구에 ${t} 가 없다: ${allowed}`)
  assert(!allowed.split(',').includes('Bash'), '정책이 주지 않은 Bash 전체가 실렸다')

  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\nautonomy: .claude/autonomy.yml\n')
  r = dispatch('--route', 'triage', '--signal', 'CI 실패율 12.4%', '--dry-run')
  assert(r.status !== 0 && (r.stderr + r.stdout).includes('.claude/'), '.claude/ 아래 spec_dir 로 자율 실행이 돌았다')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .sdlc/specs\nautonomy: .claude/autonomy.yml\n')

  put(join(d, '.claude/autonomy.yml'), policy('2020-01-01'))
  r = dispatch('--route', 'triage', '--signal', 'x', '--dry-run')
  assert(r.status === 3, `만료 위임이 실행됐다: ${r.stdout}${r.stderr}`)

  put(join(d, '.claude/autonomy.yml'), policy('2099-12-31'))
  r = dispatch('--route', 'triage', '--dry-run')
  assert(r.status !== 0, '관측 없이 발화했다')

  put(join(d, '.claude/autonomy.yml'), `version: 1
owner: "팀"

routes:
  reckless:
    trigger: ticket
    max_tier: full
    advance_to: implement
    tools: "Bash"
    expires: 2099-12-31
`)
  r = spawnSync('node', [tool('autonomy.mjs'), d], { encoding: 'utf8' })
  assert(r.status !== 0, '`max_tier: full` 자율 경로가 통과했다')
  assert(r.stdout.includes('max_tier: full'), r.stdout)
  assert(r.stdout.includes('target_branch'), 'implement 인데 브랜치 없는 것을 안 잡았다')
})

await test('policy approval accepts only an existing unexpired delegation', () => {
  const d = temp('sdlc-polapp')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\nautonomy: .claude/autonomy.yml\n')
  put(join(d, '.claude/autonomy.yml'), `version: 1
owner: "팀"

routes:
  triage:
    trigger: band_breach
    max_tier: light
    advance_to: intent
    tools: "Read"
    expires: 2099-12-31
`)
  const chain = join(d, '.claude/specs/2026-09-05-a')
  const intent = (approver, tier) => `---
artifact: intent
schema_version: 4
id: "CHG-2026-001"
title: "제목"
status: accepted
tier: ${tier}
owner: "팀"
created: 2026-09-05
updated: 2026-09-05
approved_by: "${approver}"
generated_by: "claude-opus-5"
---

# Intent: 제목

## 문제 \`[필수 · 모든 티어]\`

지금은 안 된다.

## 목표 결과 \`[필수 · 모든 티어]\`

### OUT-001 — 된다 \`Should\`

된다.

확인: 본다.

## 비목표 \`[필수 · 모든 티어]\`

- 다른 것은 안 한다.

## 제약 \`[필수 · 모든 티어]\`

해당 없음 — 제약이 없다.

## 열린 질문 \`[필수 · 모든 티어]\`

해당 없음 — 질문이 없다.
`
  const check = () => spawnSync('node', [tool('check-artifacts.mjs'), chain], { encoding: 'utf8' })

  put(join(chain, 'intent.md'), intent('policy:triage', 'light'))
  assert(check().status === 0, '살아 있는 정책 승인이 막혔다: ' + check().stdout)

  put(join(chain, 'intent.md'), intent('policy:nope', 'light'))
  assert(check().stdout.includes('가리키는 자율 경로가 정책에 없다'), '없는 경로가 통과했다')

  put(join(chain, 'intent.md'), intent('policy:triage', 'standard'))
  assert(check().stdout.includes('max_tier'), '위임을 넘는 티어가 통과했다')

  put(join(d, '.claude/autonomy.yml'), readFileSync(join(d, '.claude/autonomy.yml'), 'utf8')
    .replace('advance_to: intent', 'advance_to: finding'))
  put(join(chain, 'intent.md'), intent('policy:triage', 'light'))
  assert(check().stdout.includes('까지 맡았는데'), '위임의 끝을 넘은 문서가 그 위임으로 승인됐다')
})

await test('check-all validates policies with no artifact sets and rejects missing required settings', () => {
  const d = temp('sdlc-required')
  const check = (...args) => run(process.execPath, [tool('check-all.mjs'), d, ...args])
  assert(check().code === 0 && check('--required').code !== 0, '프로필 누락의 필수 모드를 구분하지 않았다')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: missing\n')
  assert(check().code !== 0, '없는 spec_dir를 통과시켰다')
  mkdirSync(join(d, 'missing'))
  assert(check().code === 0 && check('--required').code !== 0, '빈 디렉터리의 필수 모드를 구분하지 않았다')
  put(join(d, '.claude/autonomy.yml'), 'version: 1\nroutes:\n  bad:\n    expires: 2099-01-01\n')
  assert(check().code !== 0, '산출물 체계가 없다는 이유로 잘못된 정책 검사를 생략했다')
})

await test('task attribution excludes commits for another plan with the same ID', () => {
  const d = temp('sdlc-scope')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: specs\n')
  const spec = join(d, 'specs/a')
  put(join(spec, 'plan.md'), '---\nartifact: plan\nschema_version: 4\nstatus: in_progress\n---\n\n## 작업\n\n- [ ] **WP-001 — 변경**\n  - files: `a.txt`\n  - depends: 없음\n  - covers: FR-001\n  - tests: 기준\n  - verify: true\n')
  put(join(d, 'a.txt'), 'before')
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'born')
  put(join(d, 'a.txt'), 'after')
  git(d, 'add', 'a.txt'); git(d, 'commit', '-qm', 'other plan', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: specs/b/plan.md')
  let got = JSON.parse(run(process.execPath, [tool('plan-progress.mjs'), spec, '--json']).out)
  assert(got.rows[0].commits.length === 0, '다른 계획의 WP-001을 귀속했다')
  git(d, 'commit', '--allow-empty', '-qm', 'this plan', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: specs/a/plan.md')
  got = JSON.parse(run(process.execPath, [tool('plan-progress.mjs'), spec, '--json']).out)
  assert(got.rows[0].commits.length === 1, '해당 계획 커밋을 못 찾았다')
})

await test('full verification reflects dependency changes and the latest failure while preserving completion evidence', () => {
  const d = temp('sdlc-evidence-final')
  const spec = join(d, 'specs/a')
  const plan = join(spec, 'plan.md')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: specs\nverify: node verify.cjs\n')
  put(plan, '---\nartifact: plan\nschema_version: 4\nstatus: in_progress\n---\n\n## 작업\n\n- [x] **WP-001 — 변경**\n  - files: `app.cjs`, `app.test.cjs`\n  - depends: 없음\n  - covers: FR-001\n  - tests: 결과가 참이다\n  - verify: node verify.cjs\n\n## 실행 기록\n\n- WP-001 완료\n')
  put(join(d, 'app.cjs'), 'module.exports = 0\n')
  put(join(d, 'app.test.cjs'), '// 결과가 참이다\n')
  put(join(d, 'shared.cjs'), 'module.exports = true\n')
  put(join(d, 'verify.cjs'), "process.exit(process.env.SDLC_TEST_FAIL || !require('./shared.cjs') ? 1 : 0)\n")
  git(d, 'init', '-q'); git(d, 'config', 'user.name', 'eval'); git(d, 'config', 'user.email', 'eval@local')
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'born')
  put(join(d, 'app.cjs'), 'module.exports = 1\n')
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'work', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: specs/a/plan.md')
  const verify = (fail = false) => run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', 'node verify.cjs'], {env: {...process.env, SDLC_TEST_FAIL: fail ? '1' : ''}})
  const progress = () => run(process.execPath, [tool('plan-progress.mjs'), spec, '--strict', '--json'])
  assert(verify().code === 0 && progress().code === 0, '정상 검증 실패')
  assert(verify(true).code === 1 && progress().code === 1, '같은 코드의 최신 실패를 무시했다')
  assert(verify().code === 0 && progress().code === 0, '재검증 성공을 인정하지 않았다')
  put(join(d, 'shared.cjs'), 'module.exports = false\n')
  git(d, 'add', 'shared.cjs'); git(d, 'commit', '-qm', 'dependency regression')
  assert(progress().code === 1, '작업 files 밖 의존 변경을 놓쳤다')
  assert(verify().code === 1 && progress().code === 1, '실패 로그 뒤 과거 성공을 인정했다')
  put(join(d, 'shared.cjs'), 'module.exports = true\n')
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'restore dependency')
  assert(verify().code === 0, '복구 검증 실패')
  put(plan, readFileSync(plan, 'utf8').replace('in_progress', 'completed'))
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'completed')
  assert(progress().code === 0, '완료 기록을 못 읽었다')
  put(join(d, 'app.test.cjs'), '// later test\n')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: specs\nverify: false\nverify_log_dir: moved-logs\n')
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'later independent changes')
  put(join(d, 'app.cjs'), 'uncommitted future work\n')
  assert(progress().code === 0, '후속 파일·프로필 변경이 완료 증거를 깨뜨렸다')
})

await test('autonomous execution excludes its own log but blocks other changes', () => {
  const d = temp('sdlc-repeat')
  const bin = temp('sdlc-stub')
  put(join(bin, 'claude'), '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"result","subtype":"error","is_error":true}\'\nexit 1\n', 0o755)
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: specs\n')
  put(join(d, '.claude/autonomy.yml'), 'version: 1\nowner: eval\nroutes:\n  triage:\n    trigger: manual\n    max_tier: light\n    advance_to: finding\n    tools: Read\n    expires: 2099-12-31\n')
  run(process.execPath, [tool('install-hook.mjs'), d])
  git(d, 'init', '-q'); git(d, 'config', 'user.name', 'eval'); git(d, 'config', 'user.email', 'eval@local')
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'initial')
  const dispatch = () => run(process.execPath, [tool('dispatch-auto.mjs'), d, '--route', 'triage', '--signal', 'test'], {env: {...process.env, PATH: bin + ':' + process.env.PATH}, timeout: 10000})
  const log = join(d, '.claude/autonomy-runs.jsonl')
  dispatch(); dispatch()
  assert(readFileSync(log, 'utf8').trim().split('\n').length === 2, '자기 로그 때문에 두 번째 실행이 막혔다')
  put(join(d, 'unrelated.txt'), 'user change')
  assert(dispatch().out.includes('변경이 없는 Git'), '다른 변경도 함께 무시했다')
  assert(readFileSync(log, 'utf8').trim().split('\n').length === 2, '사용자 변경이 있는데 실행했다')
})


const CASES = resolve(ROOT, '../skills/sdlc/create-plan/evals/cases/clean-light/docs')

await test('plan-levels prints a slice per prioritised scenario with the level at which it completes', () => {
  // Levels say what runs first; slices say where a release becomes possible. The checker case
  // `slice-order` proves the warning; this proves the view that lets a person see the same thing
  // before the warning fires — a Must scenario with no task, and one that ends on the last level.
  const docs = resolve(ROOT, '../skills/sdlc/create-plan/evals/cases/slice-order/docs')
  const r = run(process.execPath, [tool('plan-levels.mjs'), docs, '--json'])
  assert(r.code === 0, `plan-levels 가 실패했다:\n${r.out}`)
  const { slices } = JSON.parse(r.out)
  const by = Object.fromEntries(slices.map((s) => [s.id, s]))
  assert(slices.length === 3 && by['SCN-001'].priority === 'Must', `슬라이스가 시나리오마다 서지 않았다: ${JSON.stringify(slices)}`)
  assert(by['SCN-001'].tasks.join() === 'WP-002' && by['SCN-001'].last_level === 2, `Must 슬라이스가 끝나는 레벨이 틀렸다: ${JSON.stringify(by['SCN-001'])}`)
  assert(by['SCN-003'].tasks.length === 0 && by['SCN-003'].last_level === null, `작업 없는 시나리오가 «작업 없음» 으로 서지 않았다: ${JSON.stringify(by['SCN-003'])}`)
  const text = run(process.execPath, [tool('plan-levels.mjs'), docs]).out
  assert(text.includes('슬라이스') && text.includes('SCN-003 (Must)') && text.includes('작업 없음'), `텍스트 보기에 슬라이스가 없다:\n${text}`)
  const plain = run(process.execPath, [tool('plan-levels.mjs'), CASES, '--json']).out
  assert(JSON.parse(plain).slices.length === 0, '우선순위 없는 spec 에 슬라이스가 섰다 — 슬라이스는 선택이다')
})

function seedRepo(dir, profile) {
  put(join(dir, '.claude/spec-profile.yml'), profile)
  git(dir, 'init', '-q'); git(dir, 'config', 'user.name', 'eval'); git(dir, 'config', 'user.email', 'eval@local')
}
const edit = (path, fn) => writeFileSync(path, fn(readFileSync(path, 'utf8')))

function twoRepos() {
  const slug = '2026-09-08-archive'
  const up = temp('sdlc-docs')
  seedRepo(up, 'sdlc_version: 5\nspec_dir: docs/specs\nrepo: "acme/docs"\nspec_consumers:\n  - acme/backend\n  - acme/web\n')
  const upChain = join(up, 'docs/specs', slug)
  mkdirSync(upChain, { recursive: true })
  for (const f of ['intent.md', 'spec.md']) {
    cpSync(join(CASES, f), join(upChain, f))
    edit(join(upChain, f), (s) => s.replace('schema_version: 3', 'schema_version: 6'))
  }
  edit(join(upChain, 'spec.md'), (s) => s
    .replace('- [ ] AC-001 — 보관 문서와 일반 문서가 함께 걸리는 질의에서 일반 문서만 반환된다',
      '- [ ] AC-001 — 보관 문서와 일반 문서가 함께 걸리는 질의에서 일반 문서만 반환된다 `scope: acme/backend`')
    .replace('- [ ] AC-002 — 보관 필드가 없는 문서는 결과에 그대로 남는다',
      '- [ ] AC-002 — 보관 필드가 없는 문서는 결과에 그대로 남는다 `scope: acme/web`')
    .replace('- [ ] AC-003 — 플래그가 켜지면 보관 문서와 일반 문서가 모두 반환된다',
      '- [ ] AC-003 — 플래그가 켜지면 보관 문서와 일반 문서가 모두 반환된다 `scope: acme/backend`'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'intent')
  const intentSha = git(up, 'log', '-1', '--format=%h', '--', `docs/specs/${slug}/intent.md`)
  edit(join(upChain, 'spec.md'), (s) => s.replace('@INTENT_SHA@', intentSha))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'spec')

  const code = temp('sdlc-backend')
  seedRepo(code, 'sdlc_version: 5\nspec_dir: .sdlc/specs\nrepo: "acme/backend"\nupstream_repo: "acme/docs"\n')
  const chain = join(code, '.sdlc/specs', slug)
  mkdirSync(chain, { recursive: true })
  return { up, upChain, code, chain, slug }
}

const check = (dir, up) => run(process.execPath, [tool('check-artifacts.mjs'), dir],
  { env: { ...process.env, ...(up ? { SDLC_UPSTREAM: up } : {}) } })

await test('pull-spec imports only approved upstream artifacts and records the upstream commit', () => {
  const { up, upChain, chain } = twoRepos()
  edit(join(upChain, 'spec.md'), (s) => s.replace('status: accepted', 'status: in_review'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'unapprove')
  let r = run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up])
  assert(r.code !== 0 && r.out.includes('승인된 것만'), `승인 전 spec 을 끌어왔다: ${r.out}`)

  edit(join(upChain, 'spec.md'), (s) => s.replace('status: in_review', 'status: accepted'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'approve')
  r = run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up])
  assert(r.code === 0, `pull-spec 이 실패했다: ${r.out}`)
  const lock = JSON.parse(readFileSync(join(chain, 'upstream.lock.json'), 'utf8'))
  assert(lock.repo === 'acme/docs', '락이 상류 레포를 적지 않았다')
  assert(lock.files['spec.md'].sha === git(up, 'log', '-1', '--format=%H', '--', lock.files['spec.md'].path),
    '락의 SHA 가 상류의 마지막 커밋이 아니다')
  assert(existsSync(join(chain, 'spec.md')) && existsSync(join(chain, 'intent.md')), '사본이 놓이지 않았다')
})

await test('a consumer repository need cover only Must criteria in its own scope', () => {
  const { up, chain } = twoRepos()
  run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up])
  const lock = JSON.parse(readFileSync(join(chain, 'upstream.lock.json'), 'utf8'))
  cpSync(join(CASES, 'plan.md'), join(chain, 'plan.md'))
  edit(join(chain, 'plan.md'), (s) => s.replace('schema_version: 3', 'schema_version: 6'))
  edit(join(chain, 'plan.md'), (s) => s
    .replace('@SPEC_SHA@', lock.files['spec.md'].sha.slice(0, 7))
    .replace('covers: FR-001 (AC-001, AC-002)', 'covers: AC-001'))
  git(chain, 'add', '-A')

  const r = check(chain, up)
  assert(!r.out.includes('AC-002'), `다른 레포 몫인 AC-002 를 이 레포에 물렸다:\n${r.out}`)
  assert(r.code === 0, `두 레포로 갈린 정상 산출물 세트가 실패했다:\n${r.out}`)

  edit(join(chain, 'plan.md'), (s) => s.replace('covers: AC-001', 'covers: AC-001, AC-002'))
  const foreign = check(chain, up)
  assert(foreign.code !== 0 && foreign.out.includes('다른 레포 몫'), `남의 몫을 덮는 작업을 통과시켰다:\n${foreign.out}`)
})

await test('plan-progress does not warn about a criterion that belongs to another repository', () => {
  // 소비자 레포에서 남의 몫(AC-002, scope: acme/web)을 덮으면 check-artifacts 가 막는다. 그런데
  // plan-progress 는 그 기준을 아무도 안 덮는다고 경고했고 check-all 은 그것을 --strict 로 돌려,
  // 소비자는 check-all 을 영영 통과할 수 없었다.
  const { up, chain } = twoRepos()
  run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up])
  const lock = JSON.parse(readFileSync(join(chain, 'upstream.lock.json'), 'utf8'))
  cpSync(join(CASES, 'plan.md'), join(chain, 'plan.md'))
  edit(join(chain, 'plan.md'), (s) => s.replace('schema_version: 3', 'schema_version: 6')
    .replace('@SPEC_SHA@', lock.files['spec.md'].sha.slice(0, 7))
    .replace('covers: FR-001 (AC-001, AC-002)', 'covers: AC-001'))
  git(chain, 'add', '-A')
  assert(check(chain, up).code === 0, `정상 소비자 세트가 check-artifacts 에서 실패했다:\n${check(chain, up).out}`)

  const r = run(process.execPath, [tool('plan-progress.mjs'), chain, '--strict'])
  assert(r.code === 0, `남의 몫 때문에 plan-progress --strict 가 실패했다:\n${r.out}`)
  assert(/· AC-002\s+다른 레포 몫이다 \(scope: acme\/web\)/.test(r.out), `남의 몫이라고 말하지 않았다:\n${r.out}`)
  assert(/이 계획 몫이 아닌 기준 1개/.test(r.out) && /AC-002\s+다른 레포 몫 \(acme\/web\)/.test(r.out), `남의 몫을 분모에서 가르지 않았다:\n${r.out}`)
  const a2 = JSON.parse(run(process.execPath, [tool('plan-progress.mjs'), chain, '--json']).out).acceptance.find((a) => a.id === 'AC-002')
  assert(a2.owed === false && a2.reason === 'foreign', JSON.stringify(a2))
})

await test('hashes reject manual copy edits and the checker detects newer upstream content', () => {
  const { up, upChain, chain } = twoRepos()
  run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up])
  const lock = JSON.parse(readFileSync(join(chain, 'upstream.lock.json'), 'utf8'))
  cpSync(join(CASES, 'plan.md'), join(chain, 'plan.md'))
  edit(join(chain, 'plan.md'), (s) => s.replace('schema_version: 3', 'schema_version: 6'))
  edit(join(chain, 'plan.md'), (s) => s
    .replace('@SPEC_SHA@', lock.files['spec.md'].sha.slice(0, 7))
    .replace('covers: FR-001 (AC-001, AC-002)', 'covers: AC-001'))

  edit(join(chain, 'spec.md'), (s) => s.replace('보관된 문서를 결과에서 제외한다', '보관된 문서를 살짝 다르게 제외한다'))
  const tampered = check(chain, up)
  assert(tampered.code !== 0 && tampered.out.includes('락의 해시와 다르다'), `사본 변조를 통과시켰다:\n${tampered.out}`)

  run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up])
  assert(check(chain, up).code === 0, '다시 끌어왔는데도 실패한다')

  edit(join(upChain, 'spec.md'), (s) => s.replace('## 오류와 경계', '## 오류와 경계'))
  edit(join(upChain, 'spec.md'), (s) => s.replace('빈 결과를 그대로 낸다', '빈 결과를 그대로 낸다. 경고 문구를 함께 낸다'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'spec 개정')
  const stale = check(chain, up)
  assert(stale.code !== 0 && stale.out.includes('상류가 이 사본보다 앞서 있다'), `상류 드리프트를 놓쳤다:\n${stale.out}`)
})

// The lock once carried `pulled_at`, so every re-pull was a diff and two branches that both
// re-pulled conflicted on it. git already records when the lock changed.
await test('pull-spec twice with nothing changed upstream leaves the lock byte-identical, and an old lock with pulled_at still passes', () => {
  const { up, chain } = twoRepos()
  const lockPath = join(chain, 'upstream.lock.json')
  assert(run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up]).code === 0, 'first pull failed')
  const first = readFileSync(lockPath, 'utf8')
  assert(!/pulled_at/.test(first), `the lock still records when it was pulled:\n${first}`)
  assert(run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up]).code === 0, 'second pull failed')
  assert(readFileSync(lockPath, 'utf8') === first, `a re-pull with nothing changed upstream rewrote the lock:\n${first}\n---\n${readFileSync(lockPath, 'utf8')}`)

  const lock = JSON.parse(first)
  cpSync(join(CASES, 'plan.md'), join(chain, 'plan.md'))
  edit(join(chain, 'plan.md'), (s) => s.replace('schema_version: 3', 'schema_version: 6')
    .replace('@SPEC_SHA@', lock.files['spec.md'].sha.slice(0, 7))
    .replace('covers: FR-001 (AC-001, AC-002)', 'covers: AC-001'))
  writeFileSync(lockPath, JSON.stringify({ repo: lock.repo, slug: lock.slug, pulled_at: '2026-09-01T00:00:00Z', files: lock.files }, null, 2) + '\n')
  const r = check(chain, up)
  assert(r.code === 0, `a lock written before pulled_at was dropped no longer passes:\n${r.out}`)
  assert(run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up]).code === 0, 're-pull over an old lock failed')
  assert(readFileSync(lockPath, 'utf8') === first, 'a re-pull did not drop pulled_at from an old lock')
})

// A schema-7 upstream has no lock, so /create-spec pins the intent by body hash. The consumer
// pulls that pair verbatim; the lock must not turn the pin inside the pair into an error.
function v7Consumer() {
  const r = twoRepos()
  for (const f of ['intent.md', 'spec.md']) {
    edit(join(r.upChain, f), (s) => s.replace('schema_version: 6', 'schema_version: 7'))
  }
  const pin = run(process.execPath, [tool('pin.mjs'), join(r.upChain, 'intent.md')]).out.trim()
  edit(join(r.upChain, 'spec.md'), (s) => s.replace(/^intent_version: .*$/m, `intent_version: "${pin}"`))
  git(r.up, 'add', '-A'); git(r.up, 'commit', '-qm', 'schema 7 with a body pin')
  const plan = () => {
    const lock = JSON.parse(readFileSync(join(r.chain, 'upstream.lock.json'), 'utf8'))
    cpSync(join(CASES, 'plan.md'), join(r.chain, 'plan.md'))
    edit(join(r.chain, 'plan.md'), (s) => s.replace('schema_version: 3', 'schema_version: 7')
      .replace('@SPEC_SHA@', lock.files['spec.md'].sha.slice(0, 7))
      .replace('covers: FR-001 (AC-001, AC-002)', 'covers: AC-001'))
    git(r.chain, 'add', '-A')
  }
  return { ...r, pin, plan }
}
const strict = (dir, up) => run(process.execPath, [tool('check-artifacts.mjs'), dir, '--strict'],
  { env: { ...process.env, SDLC_UPSTREAM: up } })

await test('a consumer accepts the body pin inside a vendored schema-7 pair', () => {
  const { up, chain, plan } = v7Consumer()
  assert(check(join(up, 'docs/specs/2026-09-08-archive')).code === 0, '상류 v7 세트가 자기 레포에서 실패했다')
  run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up])
  plan()
  const r = strict(chain, up)
  assert(!r.out.includes('본문 해시인데'), `벤더한 spec 의 본문 해시를 락 때문에 거부했다:\n${r.out}`)
  assert(r.code === 0, `v7 상류를 끌어온 정상 소비자 세트가 실패했다:\n${r.out}`)

  // The consumer's own pin keeps the old rule: a body hash of a copy cannot see upstream move on.
  edit(join(chain, 'plan.md'), (s) => s.replace(/^spec_version: .*$/m,
    `spec_version: "${run(process.execPath, [tool('pin.mjs'), join(chain, 'spec.md')]).out.trim()}"`))
  const own = strict(chain, up)
  assert(own.code !== 0 && /plan\.md[\s\S]*`spec_version` 가 본문 해시인데/.test(own.out), `소비자 plan 의 본문 해시를 통과시켰다:\n${own.out}`)

  // A draft pulled with --force before upstream ever committed it: the lock has no sha, and the
  // body pin still checks against the copy next to it. The schema-6 form in the same spot cannot
  // be compared at all, and must say so rather than measure an upstream SHA against local history.
  for (const [schema, wantWarn] of [[7, false], [6, true]]) {
    const { up: up2, upChain: src, code } = schema === 7 ? v7Consumer() : twoRepos()
    const drafts = join(up2, 'docs/specs/2026-09-09-draft')
    cpSync(src, drafts, { recursive: true })
    edit(join(drafts, 'spec.md'), (s) => s.replace('status: accepted', 'status: in_review'))
    const chain2 = join(code, '.sdlc/specs/2026-09-09-draft')
    mkdirSync(chain2, { recursive: true })
    const forced = run(process.execPath, [tool('pull-spec.mjs'), chain2, '--from', up2, '--force'])
    assert(forced.code === 0 && forced.out.includes('미커밋'), `--force 로 미커밋 초안을 끌어오지 못했다:\n${forced.out}`)
    git(code, 'add', '-A'); git(code, 'commit', '-qm', 'draft pulled')
    const draft = check(chain2, up2)
    assert(!/✗[^\n]*spec\.md[^\n]*intent_version|spec\.md[^\n]*`intent_version` 가/.test(draft.out.split('\n').filter((l) => !l.includes('⚠')).join('\n')),
      `schema ${schema}: 락 sha 가 없는 초안 짝의 핀을 오류로 냈다:\n${draft.out}`)
    assert(draft.out.includes('상류 커밋이 없어 `intent_version` 를 대조하지 못했다') === wantWarn,
      `schema ${schema}: 대조하지 못한 핀을 말하는 방식이 틀렸다:\n${draft.out}`)
  }
})

await test('a vendored pair that disagrees upstream is reported as upstream inconsistency', () => {
  const { up, upChain, chain, plan } = v7Consumer()
  // Upstream revises the intent after the spec was pinned and pulls happen anyway.
  edit(join(upChain, 'intent.md'), (s) => s.replace('## 목표 결과', '상류에서 나중에 덧붙인 문장.\n\n## 목표 결과'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'intent revised after the spec')
  run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up])
  plan()
  const r = strict(chain, up)
  assert(r.code !== 0 && r.out.includes('함께 끌어온 intent.md 의 본문과 다르다'), `어긋난 상류 짝을 통과시켰다:\n${r.out}`)
  assert(r.out.includes('읽기 전용 사본') && r.out.includes('pull-spec.mjs') && !r.out.includes('이 문서를 갱신한 다음'),
    `읽기 전용 사본을 고치라고 안내했다:\n${r.out}`)

  // The schema-6 form in the same position: the spec's commit SHA is compared with the lock's
  // intent sha, and a mismatch gets the same read-only hint.
  const { up: up6, upChain: upChain6, chain: chain6 } = twoRepos()
  edit(join(upChain6, 'intent.md'), (s) => s.replace('## 목표 결과', '상류에서 나중에 덧붙인 문장.\n\n## 목표 결과'))
  git(up6, 'add', '-A'); git(up6, 'commit', '-qm', 'intent revised after the spec')
  run(process.execPath, [tool('pull-spec.mjs'), chain6, '--from', up6])
  const sha6 = check(chain6, up6)
  assert(sha6.code !== 0 && /`intent_version` 가 acme\/docs 의 intent\.md 의 현재 커밋과 다르다/.test(sha6.out) && sha6.out.includes('읽기 전용 사본'),
    `v6 커밋 SHA 핀의 상류 불일치를 놓쳤거나 사본을 고치라고 했다:\n${sha6.out}`)
})

await test('enabling an upstream profile does not apply assignment checks to older schemas', () => {
  const { upChain } = twoRepos()
  for (const f of ['intent.md', 'spec.md']) {
    edit(join(upChain, f), (s) => s.replace('schema_version: 6', 'schema_version: 5'))
  }
  edit(join(upChain, 'spec.md'), (s) => s.replace(/ `scope: [^`]+`/g, ''))
  const r = check(upChain)
  assert(!r.out.includes('`scope` 가 없다'), `v5 산출물 세트에 v6 배정 검사가 걸렸다:\n${r.out}`)
})

await test('an upstream documentation repository rejects unassigned Must acceptance criteria', () => {
  const { up, upChain } = twoRepos()
  assert(check(upChain).code === 0, `배정이 끝난 상류 spec 이 실패했다:\n${check(upChain).out}`)

  edit(join(upChain, 'spec.md'), (s) => s.replace(' `scope: acme/backend`\n- [ ] AC-002', '\n- [ ] AC-002'))
  const unassigned = check(upChain)
  assert(unassigned.code !== 0 && unassigned.out.includes('`scope` 가 없다'), `아무에게도 배정되지 않은 Must 를 통과시켰다:\n${unassigned.out}`)

  edit(join(upChain, 'spec.md'), (s) => s.replace('- [ ] AC-001 — 보관 문서와 일반 문서가 함께 걸리는 질의에서 일반 문서만 반환된다',
    '- [ ] AC-001 — 보관 문서와 일반 문서가 함께 걸리는 질의에서 일반 문서만 반환된다 `scope: acme/mobile`'))
  const stray = check(upChain)
  assert(stray.code !== 0 && stray.out.includes('등록되지 않은 레포'), `등록되지 않은 소비 레포를 통과시켰다:\n${stray.out}`)
})


await test('lang selects the prose bundle and a missing bundle never passes silently', () => {
  const d = temp('sdlc-lang')
  const chain = join(d, '.sdlc/specs/change')
  cpSync(join(findSkill('create-plan', HERE), 'evals/cases/clean-light/docs'), chain, { recursive: true })
  const profile = (lang) => put(join(d, '.claude/spec-profile.yml'),
    `sdlc_version: 5\nspec_dir: ".sdlc/specs"\n${lang ? `lang: ${lang}\n` : ''}`)
  const lint = () => run(process.execPath, [tool('lint-prose.mjs'), chain])

  profile(null)
  const bare = lint()
  assert(bare.code === 0, `lang 이 없으면 ko 로 읽어야 한다:\n${bare.out}`)

  profile('ko')
  const ko = lint()
  assert(ko.code === 0 && ko.out === bare.out, `lang: ko 가 기본값과 다른 결과를 냈다:\n${ko.out}`)

  profile('fr')
  const missing = lint()
  assert(missing.code === 2 && /문체 번들이 없다/.test(missing.out),
    `번들이 없는 언어를 통과시켰다 — 미검사가 통과로 읽힌다:\n${missing.out}`)
})


await test('locale bundles have matching shapes so a missing key cannot silently disable a rule', async () => {
  const [ko, en] = await Promise.all([
    import(`file://${join(ROOT, 'locales/ko.mjs')}`),
    import(`file://${join(ROOT, 'locales/en.mjs')}`),
  ])
  const keys = (m) => Object.keys(m).sort().join(' ')
  assert(keys(ko) === keys(en), `번들의 export 가 다르다:\n  ko  ${keys(ko)}\n  en  ${keys(en)}`)
  for (const [name, m] of [['ko', ko], ['en', en]]) {
    assert(m.vague.length > 10 && m.translationese.length > 5 && m.meta.length > 2, `${name}: 낱말 목록이 비었다`)
    for (const kind of ['intent', 'spec', 'plan', 'finding', 'adr']) {
      assert(m.budget[kind]?.doc > 0, `${name}: budget.${kind} 이 없다`)
    }
    assert(m.limits.sentences > 0 && m.limits.title > 0 && m.limits.ac > 0 && m.limits.logNote > 0, `${name}: limits 가 비었다`)
    // executionLog 은 `plan-check mark` 가 절을 새로 만들 때 쓰는 제목이다. 한쪽 번들에만 있으면
    // 그 언어의 계획서에 `## undefined` 가 박히고, 그 절은 검사기도 린터도 못 읽는다.
    for (const k of ['divergence', 'none', 'noPr', 'executionLog']) assert(typeof m.written[k] === 'string' && m.written[k], `${name}: written.${k} 이 없다`)
    for (const k of ['done', 'partial', 'failed']) assert(typeof m.written.result[k] === 'string' && m.written.result[k], `${name}: written.result.${k} 이 없다`)
    for (const w of m.vague) assert(!(w instanceof RegExp) || !w.flags.includes('g'), `${name}: vague 에 /g 정규식이 있다 — ${w}`)
    for (const [w] of m.translationese) assert(!(w instanceof RegExp) || !w.flags.includes('g'), `${name}: translationese 에 /g 정규식이 있다 — ${w}`)
  }
})


await test('prose rules leave code, foreign names and measured durations alone and still catch their target', async () => {
  const [ko, en, parse] = await Promise.all([
    import(`file://${join(ROOT, 'locales/ko.mjs')}`),
    import(`file://${join(ROOT, 'locales/en.mjs')}`),
    import(`file://${join(ROOT, 'tools/artifact-parse.mjs')}`),
  ])
  const { outsideCode, prefixTypo } = parse
  const ph = (s) => /<[^<>\n]{1,120}>/.test(outsideCode(s))
  assert(!ph('The handler returns `Promise<Quota>`.'), '코드 스팬의 제네릭 타입을 placeholder 로 읽었다')
  assert(ph('<What was decided.>') && ph('- `<path>:<line>` — what it does now') && ph('reproduce: `<query or command>`'),
    '템플릿의 placeholder 를 놓쳤다 — 백틱 안에서 `<` 로 시작하는 것도 미작성이다')

  for (const [typo, like] of [['FRR', 'FR'], ['ACC', 'AC'], ['WPP', 'WP'], ['OUTT', 'OUT'], ['NRF', 'NFR']]) {
    assert(prefixTypo(typo) === like, `${typo} 를 ${like} 의 오타로 못 봤다 (${prefixTypo(typo)})`)
  }
  for (const name of ['RWA', 'CVE', 'ERC', 'EIP', 'RSA', 'ENG', 'PR', 'QA', 'SQL', 'DEV', 'FR', 'AC']) {
    assert(prefixTypo(name) === null, `${name} 을 접두의 오타로 읽었다 (${prefixTypo(name)})`)
  }

  const vagueHit = (L, s) => L.vague.map((w) => (w instanceof RegExp ? outsideCode(s).match(w)?.[0] : outsideCode(s).includes(w) ? w : null)).find(Boolean)
  for (const s of ['keeps its place under the `stable sort`.', 'When the branch can fast-forward, the tool merges.', 'The parser is fail-fast on a bad header.', 'The job cleans up the temp directory and the clean-room build stays.']) {
    assert(!vagueHit(en, s), `정확한 말을 모호어로 읽었다 — «${vagueHit(en, s)}» in ${s}`)
  }
  for (const s of ['The search returns fast.', 'It keeps its place under the stable sort.', 'The flow is easy-to-use.']) {
    assert(vagueHit(en, s), `모호어를 놓쳤다 — ${s}`)
  }
  for (const s of ['로그에 기록되도록 한다.', '상태가 완료가 되도록 바꾼다.', '`안정적` 정렬을 쓴다.']) {
    assert(!vagueHit(ko, s), `정확한 말을 모호어로 읽었다 — «${vagueHit(ko, s)}» in ${s}`)
  }
  assert(vagueHit(ko, '되도록 한 번에 처리한다.') === '되도록', '부사 «되도록» 을 놓쳤다')

  for (const [L, cond, reminder] of [
    [ko, ['적재 오류율이 3주 연속 1% 를 넘는다', '사내 볼륨만 쓰는 워크스페이스가 생긴다'], ['6개월 뒤 재검토', '다음 분기에 다시 본다', '정기 검토', '한 달 뒤 다시 연다']],
    [en, ['Error rate stays above 1% for 3 days', 'p99 rises above 200 ms within 2 weeks of a release'], ['Revisit in 6 months', 'Review after two quarters', 'Periodic review', 'Next quarter']],
  ]) {
    for (const s of cond) assert(!L.deadlineOnly.test(s), `측정 조건을 시한으로 읽었다 — ${s}`)
    for (const s of reminder) assert(L.deadlineOnly.test(s), `달력 알림을 놓쳤다 — ${s}`)
  }
  for (const [L, cost, gainOnly] of [
    [ko, ['받아들인 제약: 사내 볼륨만 쓰는 워크스페이스는 업로드 앞에서 멈춘다.', '- 감수하는 제약: 기다린다.', '단점: 하루를 기다린다.'],
      '- 얻는 것: 자격 없는 그룹에는 문서가 안 걸린다.\n- 얻는 것: API 가 멈춰도 열람 판정은 계속 선다.\n- 얻는 것: 운영 부담이 줄어든다.'],
    [en, ['- What it costs: a day of waiting.', 'Accepted constraint: workspaces stop at upload.', 'The drawback is a day of waiting.'],
      '- What this buys: an unentitled group cannot see it.\n- What this buys: operators no longer push by hand.'],
  ]) {
    for (const s of cost) assert(L.tradeoff.test(s), `대가를 적은 문장을 놓쳤다 — ${s}`)
    assert(!L.tradeoff.test(gainOnly), `얻는 것만 적은 결과를 대가로 읽었다:\n${gainOnly}`)
  }

  // A document a person wrote has no `generated_by`. That is a note, not a warning: CI runs
  // `--strict`, and the hint used to tell the author to leave the warning in place.
  const d = temp('sdlc-handwritten')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 7\nspec_dir: "."\n')
  put(join(d, 'set/intent.md'), readFileSync(join(findSkill('create-spec', HERE), 'evals/cases/english-precise-terms/docs/intent.md'), 'utf8'))
  const r = run(process.execPath, [tool('check-artifacts.mjs'), join(d, 'set'), '--strict'])
  assert(r.code === 0, `손으로 쓴 문서가 --strict 에서 실패했다:\n${r.out}`)
  assert(r.out.includes('`generated_by` 가 비었다'), `빈 generated_by 가 보고서에서 사라졌다 — 노트로 남아야 한다:\n${r.out}`)
})


await test('the approval guard protects ADRs even though they live outside artifact sets', () => {
  const d = temp('sdlc-guard-adr')
  put(join(d, '.claude/spec-profile.yml'),
    `sdlc_version: 5\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\nadr_dir: "docs/adr"\n`)
  const adr = join(d, 'docs/adr/ADR-001-something-hard-to-reverse.md')
  put(adr, '---\nartifact: adr\nid: "ADR-001"\nstatus: in_review\napproved_by: null\n---\n\n## 결정\n\n초안\n')
  const env = { ...process.env, CLAUDE_PROJECT_DIR: d }
  const invoke = (payload) => run(tool('guard-approval.sh'), [], { env, input: JSON.stringify(payload) })
  const asks = (r) => (r.out ?? '').includes('"permissionDecision":"ask"')

  let r = invoke({ tool_name: 'Write', tool_input: { file_path: adr, content: 'status: in_review\napproved_by: null' } })
  assert(r.code === 0, '초안 편집을 과잉 차단했다')

  r = invoke({ tool_name: 'Write', tool_input: { file_path: adr, content: 'status: accepted\napproved_by: "agent"' } })
  assert(asks(r), 'ADR 자기승인을 사람에게 안 물어본다 — 승인이 조용히 통과한다')

  put(adr, '---\nartifact: adr\nid: "ADR-001"\nstatus: accepted\napproved_by: "human"\n---\n\n## 결정\n\n정해진 것\n')
  r = invoke({ tool_name: 'Edit', tool_input: { file_path: adr, old_string: '정해진 것', new_string: '뒤집은 것' } })
  assert(asks(r), 'accepted ADR 의 본문 변경을 조용히 허용했다 — 결정의 불변성이 무너진다')

  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 5\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\n`)
  r = invoke({ tool_name: 'Write', tool_input: { file_path: adr, content: 'status: accepted\napproved_by: "agent"' } })
  assert(r.code === 0 && !asks(r), 'adr_dir 이 없는데도 ADR 경로를 붙잡았다')
})

// A waiver turns a warning off, so on an accepted decision it is a change to what was approved. The
// guard needs no rule of its own for it — any edit of an accepted document goes to the dialog — and
// this pins that down: if the guard ever learned to let frontmatter-only edits through, a waiver
// could be slipped into an approved ADR with nobody asked.
await test('adding a waiver to an accepted ADR goes to the approval dialog', () => {
  const d = temp('sdlc-guard-waiver')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 7\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\nadr_dir: "docs/adr"\n`)
  const adr = join(d, 'docs/adr/ADR-001-managed-postgres.md')
  put(adr, '---\nartifact: adr\nid: "ADR-001"\nstatus: accepted\napproved_by: "human"\ngenerated_by: "agent"\nscope: []\nconfirms: []\n---\n\n## 결정\n\n관리형 Postgres 를 쓴다.\n')
  const r = run(tool('guard-approval.sh'), [], { env: { ...process.env, CLAUDE_PROJECT_DIR: d }, input: JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: adr, old_string: 'confirms: []\n', new_string: 'confirms: []\nwaive:\n  - "adr-confirms-empty — a vendor choice; no test can confirm it"\n' },
  }) })
  assert((r.out ?? '').includes('"permissionDecision":"ask"'), `accepted ADR 에 면제를 더하는 편집이 다이얼로그 없이 통과했다:\n${r.out}`)
})

// The guard used to protect only `accepted`, with the intent/spec exemptions for everything: pulling
// a document back to in_review or superseded passed silently. For an ADR that is the act of retiring
// a decision — and the same edit could rewrite its text — and a plan stopped being protected the
// moment it went in_progress. Every row is one edit and the verdict it must get; each «ask» row that
// is new passed silently before.
await test('the approval guard asks for retiring a decision, editing its history, and changing a running plan', () => {
  const d = temp('sdlc-guard-matrix')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 7\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\nadr_dir: "docs/adr"\n`)
  const adr = join(d, 'docs/adr/ADR-005-object-store.md')
  const plan = join(d, '.sdlc/specs/2026-09-05-a/plan.md')
  const intent = join(d, '.sdlc/specs/2026-09-05-a/intent.md')
  const ADR = (status, { by = 'human' } = {}) => `---\nartifact: adr\nid: "ADR-005"\nstatus: ${status}\ngenerated_by: "agent"\napproved_by: "${by}"\nsuperseded_by: null\n---\n\n## 결정\n\n본문은 오브젝트 스토어에만 적재한다.\n`
  const PLAN = (status, { by = 'human' } = {}) => `---\nartifact: plan\nstatus: ${status}\ngenerated_by: "agent"\napproved_by: "${by}"\nupdated: 2026-09-01\ntier: light\n---\n\n# Plan\n\n## 작업\n\n`
    + '- [x] **WP-001 — 첫 작업**\n  - files: src/a.js\n  - depends: 없음\n  - covers: FR-001 (AC-001)\n'
    + '- [ ] **WP-002 — 둘째 작업**\n  - files: src/b.js\n  - depends: WP-001\n  - covers: FR-001 (AC-001)\n\n'
    + '## 실행 기록\n\n- 2026-09-02 WP-001 — 완료 · PR 없음 · 계획과의 차이: 없음\n'
  const INTENT = (status) => `---\nartifact: intent\nstatus: ${status}\ngenerated_by: "agent"\napproved_by: "human"\n---\n\n# Intent\n\n승인된 의미\n`
  const s = (from, to) => ({ old_string: `status: ${from}\n`, new_string: `status: ${to}\n` })
  const decisionText = { old_string: '오브젝트 스토어에만', new_string: '아무 데나' }
  const taskFiles = { old_string: 'files: src/b.js', new_string: 'files: src/c.js' }
  const removeTask = { old_string: '- [ ] **WP-002 — 둘째 작업**\n  - files: src/b.js\n  - depends: WP-001\n  - covers: FR-001 (AC-001)\n', new_string: '' }
  const pinDecision = { old_string: 'tier: light\n', new_string: 'tier: light\ndecisions: ["ADR-005"]\n' }
  const box = { old_string: '- [ ] **WP-002', new_string: '- [x] **WP-002' }
  const bump = { old_string: 'updated: 2026-09-01', new_string: 'updated: 2026-09-03' }
  const changeLog = { old_string: '계획과의 차이: 없음\n', new_string: '계획과의 차이: 없음\n\n### 변경 기록\n\n- 2026-09-03 WP-002 의 범위를 줄였다 — 리뷰 RV-001\n' }
  const rewriteLog = { old_string: '계획과의 차이: 없음', new_string: '계획과의 차이: 대부분 다시 짰다' }
  const approve = (from) => [s(from, 'accepted'), { old_string: 'approved_by: "human"', new_string: 'approved_by: "lee"' }]

  const verdict = ([file, text], edits, { route, mode = 'default' } = {}) => {
    put(file, text)
    const env = { ...process.env, CLAUDE_PROJECT_DIR: d }
    if (route) env.SDLC_AUTONOMY_ROUTE = route; else delete env.SDLC_AUTONOMY_ROUTE
    const r = run(tool('guard-approval.sh'), [], { env, input: JSON.stringify({
      tool_name: 'Edit', permission_mode: mode, tool_input: { file_path: file, edits } }) })
    if (r.code === 2) return 'deny'
    if (r.code !== 0) return `exit ${r.code}: ${r.out}`
    return r.out.includes('"permissionDecision":"ask"') ? 'ask' : 'pass'
  }
  const A = (status, o) => [adr, ADR(status, o)], P = (status, o) => [plan, PLAN(status, o)], I = (status) => [intent, INTENT(status)]

  const rows = [
    // ADR: leaving accepted is the act that needs a person, whatever the target.
    ['ask', 'accepted ADR → superseded with its decision rewritten', A('accepted'),
      [s('accepted', 'superseded'), { old_string: 'superseded_by: null', new_string: 'superseded_by: "ADR-009"' }, decisionText]],
    ['ask', 'accepted ADR → in_review with its decision rewritten', A('accepted'), [s('accepted', 'in_review'), decisionText]],
    ['ask', 'accepted ADR → in_review, status only', A('accepted'), [s('accepted', 'in_review')]],
    ['ask', 'accepted ADR → deprecated', A('accepted'), [s('accepted', 'deprecated')]],
    ['ask', 'accepted ADR → rejected', A('accepted'), [s('accepted', 'rejected')]],
    ['ask', 'accepted ADR → draft', A('accepted'), [s('accepted', 'draft')]],
    ['ask', 'accepted ADR: decision text edited', A('accepted'), [decisionText]],
    // A closed decision is history: rewriting it happens in front of a person or not at all.
    ['ask', 'superseded ADR: decision text edited', A('superseded'), [decisionText]],
    ['ask', 'deprecated ADR: decision text edited', A('deprecated'), [decisionText]],
    ['ask', 'rejected ADR: decision text edited', A('rejected'), [decisionText]],
    ['ask', 'superseded ADR → accepted (reinstated)', A('superseded'), [s('superseded', 'accepted')]],
    ['pass', 'draft ADR: decision text edited', A('draft'), [decisionText]],
    ['pass', 'in_review ADR: decision text edited', A('in_review'), [decisionText]],
    ['pass', 'in_review ADR → draft', A('in_review'), [s('in_review', 'draft')]],
    ['ask', 'in_review ADR → accepted (approval)', A('in_review'), approve('in_review')],
    ['deny', 'accepted ADR → superseded in dontAsk mode', A('accepted'), [s('accepted', 'superseded')], { mode: 'dontAsk' }],
    ['deny', 'accepted ADR whose approver is its writer → superseded', A('accepted', { by: 'agent' }), [s('accepted', 'superseded')]],
    // No autonomy route delegates a decision: before, a route could approve or retire one with its
    // own policy approval.
    ['deny', 'route: accepted ADR → superseded', A('accepted', { by: 'policy:triage' }), [s('accepted', 'superseded')], { route: 'triage' }],
    ['deny', 'route: in_review ADR → accepted by policy', A('in_review'),
      [s('in_review', 'accepted'), { old_string: 'approved_by: "human"', new_string: 'approved_by: "policy:triage"' }], { route: 'triage' }],
    ['pass', 'route: draft ADR edited', A('draft'), [decisionText], { route: 'triage' }],

    // A running plan: the tasks are what was approved; execution only adds to it.
    ['ask', 'in_progress plan: task files changed', P('in_progress'), [taskFiles]],
    ['ask', 'in_progress plan: a task removed', P('in_progress'), [removeTask]],
    ['ask', 'in_progress plan: decisions pinned in frontmatter', P('in_progress'), [pinDecision]],
    ['ask', 'in_progress plan: an execution-log entry rewritten', P('in_progress'), [rewriteLog]],
    ['ask', 'in_progress → in_review with a task changed in the same edit', P('in_progress'), [s('in_progress', 'in_review'), taskFiles]],
    ['ask', 'in_progress → completed with a task changed in the same edit', P('in_progress'), [s('in_progress', 'completed'), taskFiles]],
    ['ask', 'completed plan: task files changed', P('completed'), [taskFiles]],
    ['ask', 'completed → in_progress (reopened)', P('completed'), [s('completed', 'in_progress')]],
    // Back into execution without the re-approval: in_review → in_progress used to pass.
    ['ask', 'in_review → in_progress, skipping the re-approval', P('in_review'), [s('in_review', 'in_progress')]],
    ['ask', 'in_review → completed', P('in_review'), [s('in_review', 'completed')]],
    ['ask', 'accepted → in_progress with decisions pinned in the same edit', P('accepted'), [s('accepted', 'in_progress'), pinDecision]],
    ['ask', 'accepted → completed, skipping execution', P('accepted'), [s('accepted', 'completed')]],
    ['pass', 'in_progress plan: checkbox only', P('in_progress'), [box]],
    ['pass', 'in_progress plan: change-log entry added under the execution log', P('in_progress'), [changeLog]],
    ['pass', 'in_progress plan: checkbox and log entry together', P('in_progress'), [box, changeLog]],
    ['pass', 'accepted → in_progress, status and date only', P('accepted'), [s('accepted', 'in_progress'), bump]],
    ['pass', 'in_progress → completed, status only', P('in_progress'), [s('in_progress', 'completed'), bump]],
    ['pass', 'in_progress → in_review, status only', P('in_progress'), [s('in_progress', 'in_review')]],
    ['pass', 'in_progress → superseded, status only', P('in_progress'), [s('in_progress', 'superseded')]],
    ['pass', 'completed → rejected, status only', P('completed'), [s('completed', 'rejected')]],
    ['pass', 'in_review plan: task files changed', P('in_review'), [taskFiles]],
    ['ask', 'in_review plan → accepted (re-approval)', P('in_review'), approve('in_review')],
    ['deny', 'in_progress plan: task changed in dontAsk mode', P('in_progress'), [taskFiles], { mode: 'dontAsk' }],
    ['deny', 'route: human-approved running plan, task changed', P('in_progress'), [taskFiles], { route: 'triage' }],
    ['pass', 'route: running plan under its own policy approval, task changed', P('in_progress', { by: 'policy:triage' }), [taskFiles], { route: 'triage' }],

    // intent/spec are unchanged: pulling back is the reviewer-friendly direction.
    ['ask', 'accepted intent: body edited', I('accepted'), [{ old_string: '승인된 의미', new_string: '바뀐 의미' }]],
    ['pass', 'accepted intent → in_review with its body edited', I('accepted'), [s('accepted', 'in_review'), { old_string: '승인된 의미', new_string: '바뀐 의미' }]],
    ['pass', 'accepted intent → superseded', I('accepted'), [s('accepted', 'superseded')]],
    ['pass', 'in_review intent: body edited', I('in_review'), [{ old_string: '승인된 의미', new_string: '바뀐 의미' }]],
    ['ask', 'in_review intent → accepted', I('in_review'), approve('in_review')],
  ]
  const failures = []
  for (const [want, label, doc, edits, opts] of rows) {
    const got = verdict(doc, edits, opts)
    if (got !== want) failures.push(`${want} 이어야 하는데 ${got}: ${label}`)
  }
  assert(!failures.length, `승인 가드 판정이 어긋났다:\n  ${failures.join('\n  ')}`)

  // The dialog says what is being approved; «accepted → accepted» told a person nothing.
  const reason = (doc, edits) => {
    put(doc[0], doc[1])
    const r = run(tool('guard-approval.sh'), [], { env: { ...process.env, CLAUDE_PROJECT_DIR: d }, input: JSON.stringify({
      tool_name: 'Edit', tool_input: { file_path: doc[0], edits } }) })
    return /"permissionDecisionReason":"([^"]*)"/.exec(r.out)?.[1] ?? r.out
  }
  for (const [doc, edits, words] of [
    [A('accepted'), [s('accepted', 'superseded')], '결정 은퇴'],
    [A('accepted'), [decisionText], '효력 있는 결정의 내용 변경'],
    [A('superseded'), [decisionText], '종료된 결정 기록'],
    [P('in_progress'), [taskFiles], '실행 중인 계획의 내용 변경'],
    [P('in_review'), [s('in_review', 'in_progress')], '실행 상태로 건너뛰는 전이'],
    [I('accepted'), [{ old_string: '승인된 의미', new_string: '바뀐 의미' }], '승인된 문서의 내용 변경'],
    [I('in_review'), approve('in_review'), '승인 — in_review → accepted'],
  ]) {
    const got = reason(doc, edits)
    assert(got.includes(words) && !got.includes('accepted → accepted'), `다이얼로그 이유가 무엇을 묻는지 말하지 않는다 — «${words}» 가 없다:\n${got}`)
  }
})

// /iterate-spec on a running plan, edit by edit, in the order the skill now prescribes: exactly one
// dialog — the re-approval — for the meaning change, not one per edit.
await test('iterate-spec on a running plan meets one dialog: the re-approval', () => {
  const d = temp('sdlc-guard-iterate')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 7\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\n`)
  const plan = join(d, '.sdlc/specs/2026-09-05-a/plan.md')
  put(plan, '---\nartifact: plan\ngenerated_by: "agent"\nstatus: in_progress\napproved_by: "human"\n---\n\n# Plan\n\n## 작업\n\n'
    + '- [x] **WP-001 — 첫 작업**\n  - files: src/a.js\n\n## 실행 기록\n\n- 2026-09-02 WP-001 — 완료 · PR 없음 · 계획과의 차이: 없음\n')
  const env = { ...process.env, CLAUDE_PROJECT_DIR: d }
  delete env.SDLC_AUTONOMY_ROUTE
  const steps = [
    ['status → in_review', 'status: in_progress\n', 'status: in_review\n'],
    ['new task', '  - files: src/a.js\n', '  - files: src/a.js\n- [ ] **WP-002 — 롤백**\n  - files: src/b.js\n'],
    ['change log', '계획과의 차이: 없음\n', '계획과의 차이: 없음\n\n### 변경 기록\n\n- 2026-09-03 WP-002 추가 — 리뷰 RV-001\n'],
    ['re-approval', 'status: in_review\napproved_by: "human"', 'status: accepted\napproved_by: "lee"'],
    ['restore in_progress', 'status: accepted\n', 'status: in_progress\n'],
  ]
  const dialogs = []
  for (const [label, old_string, new_string] of steps) {
    const r = run(tool('guard-approval.sh'), [], { env, input: JSON.stringify({
      tool_name: 'Edit', permission_mode: 'default', tool_input: { file_path: plan, old_string, new_string } }) })
    assert(r.code === 0, `${label} 가 거부됐다:\n${r.out}`)
    if (r.out.includes('"permissionDecision":"ask"')) dialogs.push(label)
    writeFileSync(plan, readFileSync(plan, 'utf8').replace(old_string, new_string))
  }
  assert(dialogs.join() === 're-approval', `다이얼로그가 재승인 한 번이 아니다: ${dialogs.join(', ') || '없음'}`)
})

await test('check-all passes a waived ADR and prints each waiver with its basis', () => {
  const d = temp('sdlc-waiver')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 7\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\nadr_dir: "docs/adr"\n`)
  mkdirSync(join(d, '.sdlc/specs'), { recursive: true })
  const name = 'ADR-014-reindex-batch-after-cutoff.md'
  const waived = readFileSync(join(findSkill('create-adr', HERE), 'evals/cases/waiver-applied/docs', name), 'utf8')
  const adr = join(d, 'docs/adr', name)
  put(adr, waived)
  let r = run(process.execPath, [tool('adr-index.mjs'), d])
  assert(r.code === 0, `adr-index failed:\n${r.out}`)

  const after = (out, head) => { const ls = out.split('\n'); const at = ls.findIndex((l) => l.startsWith(head)); return at < 0 ? null : ls.slice(at + 1) }
  r = run(process.execPath, [tool('check-all.mjs'), d])
  assert(r.code === 0, `면제한 ADR 하나뿐인 저장소에서 check-all 이 실패했다:\n${r.out}`)
  const notes = after(r.out, '결정 기록 통과')
  assert(notes, `결정 기록 통과 줄이 없다:\n${r.out}`)
  assert(notes[0].includes('`adr-confirms-empty` 면제 1건: 회차 구성은 운영 기록이 판정한다') &&
    notes[1].includes('`adr-scope-empty` 면제 1건: 제약 대상: 운영 절차, 코드 한 자리가 아니다'),
    `통과한 결정 기록 아래에 면제와 근거가 없다 — 면제가 조용한 통과가 됐다:\n${r.out}`)

  r = run(process.execPath, [tool('check-artifacts.mjs'), join(d, 'docs/adr'), '--json'])
  const json = JSON.parse(r.out)
  assert(json.counts.warnings === 0 && json.waived.map((w) => w.rule).join() === 'adr-confirms-empty,adr-scope-empty',
    `--json 에 면제가 \`waived\` 로 실리지 않았다:\n${r.out}`)

  // The Non-goals warning does not fire on this decision, so a waiver for it is spent on nothing:
  // a note says so, and the check still passes — removing it from an accepted ADR costs an approval.
  put(adr, waived.replace('waive:\n', 'waive:\n  - "adr-non-goals-missing — 범위가 좁아 정하지 않는 것이 없다"\n'))
  r = run(process.execPath, [tool('check-all.mjs'), d])
  assert(r.code === 0, `쓰이지 않은 면제가 check-all 을 실패시켰다:\n${r.out}`)
  assert(r.out.includes('쓰이지 않은 면제 `adr-non-goals-missing`'), `쓰이지 않은 면제를 알리지 않았다:\n${r.out}`)

  // Without the waivers the same decision fails, and every problem carries its rule ID.
  put(adr, waived.replace(/waive:\n(?: {2}- .*\n)+/, ''))
  r = run(process.execPath, [tool('check-artifacts.mjs'), join(d, 'docs/adr'), '--json', '--strict'])
  const bare = JSON.parse(r.out)
  assert(r.code === 1 && bare.problems.map((p) => p.rule).sort().join() === 'adr-confirms-empty,adr-scope-empty',
    `면제를 지운 결정이 두 규칙 ID 로 실패하지 않았다:\n${r.out}`)
})

await test('the Bash approval guard blocks approval rewrites of artifacts and nothing else', () => {
  // The old guard matched tool words as substrings of the whole command: «superseded» and
  // «closed» contain sed, and a commit message or a read-only grep that mentioned the approval
  // fields was refused. Every row is one command and the verdict it must get.
  const repo = (adr) => {
    const d = temp('sdlc-guard-bash')
    put(join(d, '.claude/spec-profile.yml'),
      `sdlc_version: 7\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\n${adr ? 'adr_dir: "docs/adr"\n' : ''}`)
    return d
  }
  const verdict = (d, command, { project = d, cwd = d } = {}) => {
    const env = { ...process.env }
    if (project) env.CLAUDE_PROJECT_DIR = project; else delete env.CLAUDE_PROJECT_DIR
    const r = run(tool('guard-approval.sh'), [], { env, input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }) })
    if (r.code === 2 && r.out.includes('승인 필드를 Bash 로 바꾸려는')) return 'block'
    return r.code === 0 ? 'pass' : `exit ${r.code}: ${r.out}`
  }
  const sedTo = (target) => `sed -i '' 's/status: in_review/status: accepted/' ${target}`
  const heredocCommit = 'git commit -m "$(cat <<\'EOF\'\nfix(sdlc): a closed set keeps its pin; status accepted\n\n'
    + 'sed -i was what wrote .sdlc/specs/s/intent.md\nEOF\n)"'
  const rows = [
    ['pass', 'git commit -m "docs(adr): ADR-005 supersedes ADR-004; status accepted after review"'],
    ['pass', 'git commit -m "fix: closed set keeps its pin when the decision status is no longer accepted"'],
    ['pass', heredocCommit],
    ['pass', `grep -rn "status: accepted" .sdlc/specs | awk -F: '{print $1}'`],
    ['pass', 'git log --oneline | grep -i "approved_by: hanjiwoo"; echo done'],
    ['pass', 'grep "status: accepted" .sdlc/specs/s/intent.md > /tmp/hits.txt 2>/dev/null'],
    ['pass', `perl -ne 'print if /approved_by: lee/' .sdlc/specs/s/intent.md`],
    ['pass', 'echo "status: accepted"'],
    // An interpreter running a named script is not a writer: if the script rewrote an approval,
    // the words would be in the file, not here. Skills run exactly these shapes.
    ['pass', 'node sdlc-runtime/tools/pin.mjs .sdlc/specs/s/intent.md && grep -n "status: accepted" .sdlc/specs/s/spec.md'],
    ['pass', 'node sdlc-runtime/tools/check-artifacts.mjs .sdlc/specs/s/plan.md | grep "status: accepted"'],
    ['pass', 'python3 scripts/report.py .sdlc/specs/s/plan.md --filter "status: accepted"'],
    ['pass', sedTo('/tmp/x/fixture.md')],
    ['pass', sedTo('skills/sdlc/create-spec/evals/cases/clean-spec/docs/spec.md')],
    // finding's accepted is a routing decision, not an approval; the Edit branch exempts it too.
    ['pass', `sed -i '' 's/status: open/status: accepted/' .sdlc/specs/s/finding.md`],
    // A value starting with a metacharacter is sed's search side; resetting to null is no approval.
    ['pass', `sed -i '' 's/approved_by: .*/approved_by: null/' .sdlc/specs/s/intent.md`],
    ['pass', `printf 'status: accepted\\n' | tee docs/adr/ADR-005-dual-store.md`],
    ['block', sedTo('.sdlc/specs/2026-09-06-x/intent.md')],
    ['block', sedTo('.claude/worktrees/wp-1/.sdlc/specs/s/plan.md')],
    ['block', `echo 'approved_by: "hanjiwoo"' >> .sdlc/specs/2026-09-06-x/plan.md`],
    // The same value written inside double quotes arrives with its quotes escaped.
    ['block', `echo "approved_by: \\"hanjiwoo\\"" >> .sdlc/specs/2026-09-06-x/plan.md`],
    ['pass', `sed -i '' 's/approved_by: \\(.*\\)/approved_by: null/' .sdlc/specs/s/intent.md`],
    ['block', `python3 -c "open('.sdlc/specs/s/spec.md','w').write('status: accepted')"`],
    ['block', `perl -pi -e 's/approved_by: null/approved_by: lee/' .sdlc/specs/s/intent.md`],
    ['block', `node -e "require('fs').writeFileSync('.sdlc/specs/s/intent.md', 'approved_by: lee\\n')"`],
    ['block', `python3 - <<'EOF'\nopen('.sdlc/specs/s/spec.md','w').write('status: accepted\\n')\nEOF`],
    ['block', `python3 <<< "open('.sdlc/specs/s/spec.md','w').write('status: accepted')"`],
    // A pipe into a bare interpreter runs whatever the pipe carries; that cannot be told apart.
    ['block', 'cat patch.txt | python3 # status: accepted for .sdlc/specs/s/plan.md'],
    // The null of the search side must not excuse the value written.
    ['block', `sed -i '' 's/approved_by: null/approved_by: 이름/' .sdlc/specs/s/intent.md`],
    ['block', 'cat > .sdlc/specs/s/intent.md <<EOF\n---\nstatus: accepted\n---\nEOF'],
    ['block', `bash -c "${sedTo('.sdlc/specs/s/intent.md')}"`],
    ['block', `f=.sdlc/specs/s/intent.md; ${sedTo('"$f"')}`],
    // A writer and the pattern with no file named at all: the target is unknown, so refused as before.
    ['block', sedTo('"$f"')],
    // Files handed over by xargs or find are just as unknown, whatever else the command names.
    ['block', `xargs ${sedTo('')} < list.txt`],
    ['block', `find .sdlc/specs -name intent.md -exec ${sedTo('{}')} \\;`],
  ]
  const plain = repo(false)
  const failures = []
  for (const [want, command] of rows) {
    const got = verdict(plain, command)
    if (got !== want) failures.push(`${want} 이어야 하는데 ${got}: ${command}`)
  }
  assert(verdict(plain, sedTo(`'${join(plain, '.sdlc/specs/s/plan.md')}'`)) === 'block', '절대 경로로 쓴 산출물 승인을 통과시켰다')

  const withAdr = repo(true)
  if (verdict(withAdr, `printf 'status: accepted\\n' | tee docs/adr/ADR-005-dual-store.md`) !== 'block') failures.push('adr_dir 이 있는데 ADR 승인을 통과시켰다')
  if (verdict(withAdr, `printf 'status: accepted\\n' | tee docs/adr/notes.md`) !== 'pass') failures.push('ADR 이 아닌 문서를 막았다')

  // Without CLAUDE_PROJECT_DIR the repository comes from the hook's cwd through git.
  git(withAdr, 'init', '-q')
  if (verdict(withAdr, sedTo('.sdlc/specs/s/intent.md'), { project: null }) !== 'block') failures.push('CLAUDE_PROJECT_DIR 없이 cwd 로 저장소를 찾지 못했다')
  // A repository with no profile has nothing for the guard to protect.
  const bare = temp('sdlc-guard-bash-bare')
  if (verdict(bare, sedTo('.sdlc/specs/s/intent.md')) !== 'pass') failures.push('프로필 없는 저장소를 막았다')
  assert(!failures.length, failures.join('\n'))
})

await test('the shim prefers the runtime selected by the profile over the installed copy', () => {
  const d = temp('sdlc-shim-profile')
  run(process.execPath, [tool('install-hook.mjs'), d])
  const shim = join(d, '.claude/hooks/sdlc-gate.sh')

  const marker = (dir, text) => {
    const t = join(dir, 'tools')
    mkdirSync(t, { recursive: true })
    writeFileSync(join(t, 'gate-artifacts.sh'), `#!/usr/bin/env bash\necho ${text}\n`)
    chmodSync(join(t, 'gate-artifacts.sh'), 0o755)
  }
  marker(join(d, 'vendor/rt'), 'PROFILE')
  const home = temp('sdlc-shim-home')
  marker(join(home, '.claude/plugins/cache/mkt/restart-harness/0.1.0/sdlc-runtime'), 'INSTALLED')

  const call = () => spawnSync('bash', [shim], {
    encoding: 'utf8', input: '{}', env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: d },
  }).stdout ?? ''

  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\n')
  assert(call().includes('INSTALLED'), `프로필이 안 지목했으면 설치본을 써야 한다:\n${call()}`)

  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nsdlc_runtime: "vendor/rt"   # 주석은 잘려야 한다\n')
  assert(call().includes('PROFILE'), `프로필이 지목했는데 설치본을 썼다 — 훅이 다른 사본으로 검사한다:\n${call()}`)
})

await test('the guard reports a missing Node executable instead of passing silently', () => {
  const d = temp('sdlc-node')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 5\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\n`)
  const intent = join(d, '.sdlc/specs/change/intent.md')
  put(intent, '---\nartifact: intent\nstatus: in_review\napproved_by: null\n---\n\n초안\n')
  const selfApproval = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: intent, content: ['status:', 'accepted'].join(' ') + '\n' + ['approved_by:', '"agent"'].join(' ') },
  })
  const sys = '/usr/bin:/bin'
  const empty = temp('sdlc-nopath')

  const found = spawnSync(tool('guard-approval.sh'), [], {
    encoding: 'utf8', input: selfApproval,
    env: { ...process.env, PATH: sys, HOME: empty, SDLC_NODE: process.execPath, CLAUDE_PROJECT_DIR: d },
  })
  assert((found.stdout ?? '').includes('"permissionDecision":"ask"'),
    `PATH 에 node 가 없다고 자기승인을 통과시켰다:\n${found.stdout}${found.stderr}`)

  if (['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].some((f) => existsSync(f))) return
  const missing = spawnSync(tool('guard-approval.sh'), [], {
    encoding: 'utf8', input: selfApproval,
    env: { ...process.env, PATH: sys, HOME: empty, CLAUDE_PROJECT_DIR: d, SDLC_NODE: '' },
  })
  assert(/node 를 못 찾았다/.test(missing.stderr ?? ''), `node 가 없는데 아무 말도 없이 통과했다:\n${missing.stderr}`)
})

await test('sentence counting ignores periods in decimals and file extensions', () => {
  const d = temp('sdlc-sentences')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: "."\n')
  const body = 'The ratio is 2.16 on average, 2.21 at the median, and it ranges from 1.90 to 2.49. '
    + 'It is recorded in locales/en.mjs and in references/prose.md. Nothing else uses it.'
  put(join(d, 'intent.md'), `---
artifact: intent
id: "CHG-2026-001"
title: "Measure it"
status: draft
tier: light
owner: "someone"
created: 2026-09-08
updated: 2026-09-08
generated_by: "test"
---

# Intent: Measure it

## Problem \`[required · all tiers]\`

The numbers are not written down anywhere a reader can find them.

## Outcomes \`[required · all tiers]\`

### OUT-001 — The ratio is recorded beside the values \`Must\`

${body}
`)
  const r = run(process.execPath, [tool('lint-prose.mjs'), d])
  assert(!/long-item/.test(r.out), `세 문장짜리 항목을 길다고 했다 — 마침표를 종결부호로 세고 있다:\n${r.out}`)
})

await test('a long execution-log note is caught even when the section total fits', () => {
  // The fixture name must not contain the rule name — the linter prints the directory in its title.
  const d = temp('sdlc-logline')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: "."\n')
  const entry = (note) => `- 2026-09-08 WP-001 — 부분 · PR 없음 · 계획과의 차이: ${note}`
  const plan = (note) => `---
artifact: plan
id: "CHG-2026-001"
status: in_progress
schema_version: 5
---

## 작업 \`[필수 · 모든 티어]\`

- [x] **WP-001 — 캐시를 지운다**
  - files: \`src/a.js\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 캐시가 비어 있다
  - verify: true

## 실행 기록 \`[필수 · 모든 티어]\`

${entry(note)}

### 변경 기록

- 2026-09-08 eval — 초안 작성. ${'묶인 변경을 적는다. '.repeat(12)}
`
  put(join(d, 'plan.md'), plan('캐시 무효화를 뒤로 미뤘다'))
  let r = run(process.execPath, [tool('lint-prose.mjs'), d])
  assert(!/long-log/.test(r.out), `한 문장짜리 기록을 길다고 했다:\n${r.out}`)

  put(join(d, 'plan.md'), plan(`캐시 무효화를 뒤로 미뤘다. ${'그렇게 한 까닭은 다음과 같다. '.repeat(6)}`))
  r = run(process.execPath, [tool('lint-prose.mjs'), d])
  assert(/long-log/.test(r.out), `장황한 기록이 절 예산 안에 숨었다 — 항목 한도가 실행 기록에 닿지 않는다:\n${r.out}`)
  assert(!/변경 기록|묶인 변경/.test(r.out), `§변경 기록까지 재고 있다 — allEnd 로 훑었다:\n${r.out}`)
})


await test('a vendored intent and spec are still read for the tier and the acceptance criteria', () => {
  const d = temp('sdlc-vendored')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: "."\n')
  put(join(d, 'upstream.lock.json'), JSON.stringify({ repo: 'x/rwa-docs', files: { 'intent.md': {}, 'spec.md': {} } }))
  put(join(d, 'intent.md'), `---
artifact: intent
id: "CHG-2026-001"
status: draft
tier: full
schema_version: 5
---

# Intent: 풀을 둘 이상 세운다

## 문제 \`[필수 · 모든 티어]\`

풀이 하나라는 전제가 배포 스크립트에 박혀 있다.
`)
  put(join(d, 'spec.md'), `---
artifact: spec
id: "SPEC-2026-001"
status: draft
schema_version: 5
---

## 요구사항 \`[필수 · 모든 티어]\`

### FR-001 — 풀마다 좌수 토큰을 세운다 \`Must\`

- [ ] AC-001 — 풀을 둘 세우면 좌수 토큰이 풀마다 하나씩 선다
`)
  // Long enough to clear the full budget too, so a tier is named either way — which one it names
  // is the assertion.
  const filler = '풀별 배포 경로를 그대로 옮겨 적는다. '.repeat(500)
  put(join(d, 'plan.md'), `---
artifact: plan
id: "PLAN-2026-001"
status: in_progress
tier: full
schema_version: 5
---

## 입력과 범위 \`[필수 · 모든 티어]\`

${filler}

## 작업 \`[필수 · 모든 티어]\`

- [ ] **WP-001 — 풀마다 토큰을 세운다**
  - files: \`script/a.sol\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 볼트 수수료 정산이 반올림된다
  - verify: true
`)
  const r = run(process.execPath, [tool('lint-prose.mjs'), d])
  assert(/full 한도/.test(r.out) && !/standard 한도/.test(r.out),
    `벤더한 intent 를 빼면서 tier 도 잃었다 — 계획서가 남의 예산으로 재였다:\n${r.out}`)
  assert(/test-drift/.test(r.out),
    `벤더한 spec 의 수용 기준을 못 읽어 tests 표류 검사가 조용히 꺼졌다:\n${r.out}`)
  assert(/상호 참조/.test(r.out), `벤더 사본을 어떻게 다뤘는지 말하지 않는다:\n${r.out}`)
})


await test('test drift reports once that it cannot measure rather than firing on every task', () => {
  const d = temp('sdlc-drift-lang')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: "."\n')
  put(join(d, 'spec.md'), `---
artifact: spec
id: "SPEC-2026-001"
status: draft
schema_version: 5
---

## 요구사항 \`[필수 · 모든 티어]\`

### FR-001 — 풀마다 좌수 토큰을 세운다 \`Must\`

- [ ] AC-001 — 풀을 둘 세우면 좌수 토큰이 풀마다 하나씩 선다
`)
  const wp = (id) => `- [ ] **${id} — 풀마다 토큰을 세운다**
  - files: \`script/${id}.sol\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: test_DeployAll_BindsEachPoolsUnitsTokenToThatPoolAlone_${id}
  - verify: true
`
  put(join(d, 'plan.md'), `---
artifact: plan
id: "PLAN-2026-001"
status: in_progress
tier: light
schema_version: 5
---

## 작업 \`[필수 · 모든 티어]\`

${wp('WP-001')}
${wp('WP-002')}
${wp('WP-003')}
`)
  const r = run(process.execPath, [tool('lint-prose.mjs'), d])
  const drift = (r.out.match(/\[test-drift\]/g) ?? []).length
  assert(drift === 0, `잴 수 없는 겹침을 작업마다 표류로 불렀다 (${drift}건) — 늘 걸리는 검사는 꺼진 것과 같다:\n${r.out}`)
  assert((r.out.match(/test-drift-lang/g) ?? []).length === 1,
    `잴 수 없다는 사실을 한 번 말하지 않았다 — 조용히 건너뛰면 통과와 구분되지 않는다:\n${r.out}`)
})


await test('localized templates have matching structures so sections cannot disappear silently', () => {
  const shape = (file) => readFileSync(file, 'utf8').split('\n')
    .filter((l) => /^#{2,3} /.test(l))
    .map((l) => `${l.match(/^#+/)[0]} ${(l.match(/\b(OUT|CON|Q|SCN|FR|NFR|EDGE|SQ|SD|TD|WP|RISK|PQ|EV|HYP|FQ|ALT|RV|ASM|CRIT|SRC|OPT|REC|RQ)-\d+/) ?? ['prose'])[0]}`)

  for (const [skill, file] of [['create-intent', 'intent-template.md'], ['create-spec', 'spec-template.md'],
                               ['create-plan', 'plan-template.md'], ['create-adr', 'adr-template.md'],
                               ['create-finding', 'finding-template.md'], ['create-research', 'research-template.md'],
                               ['implement-spec', 'report-templates.md'], ['create-pr', 'pr-body-template.md']]) {
    const dir = join(findSkill(skill, HERE), 'assets')
    const langs = readdirSync(dir).filter((l) => existsSync(join(dir, l, file)))
    assert(langs.includes('ko'), `${skill}: ko 의 ${file} 이 없다`)
    const base = shape(join(dir, 'ko', file))
    for (const lang of langs) {
      const other = shape(join(dir, lang, file))
      assert(base.length === other.length && base.every((v, i) => v === other[i]),
        `${skill} 의 ko 와 ${lang} 이 어긋난다 (${base.length}절 vs ${other.length}절):\n  ko  ${base.join(' | ')}\n  ${lang}  ${other.join(' | ')}`)
    }
  }
})

await test('mark omits derived fields and groups tasks completed as planned', () => {
  const d = temp('sdlc-mark')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: .sdlc/specs\nverify: echo ok\n')
  const spec = join(d, '.sdlc/specs/2026-09-08-m')
  const plan = join(spec, 'plan.md')
  const wp = (id, file) => `- [ ] **${id} — 변경 ${id}**\n` +
    `  - files: \`${file}\`\n  - depends: 없음\n  - covers: FR-001 (AC-001)\n` +
    `  - tests: 결과가 참이다\n  - verify: true\n`
  put(plan, `---
artifact: plan
schema_version: 4
status: in_progress
---

## 작업 \`[필수 · 모든 티어]\`

${wp('WP-001', 'src/a.js')}
${wp('WP-002', 'src/b.js')}
${wp('WP-003', 'src/c.js')}
## 실행 기록

해당 없음 — 아직 실행 전

### 변경 기록

- 2026-09-08 eval — 초안 작성.
`)
  for (const f of ['a', 'b', 'c']) put(join(d, `src/${f}.js`), `test('결과가 참이다', () => {})\n`)
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '.claude', '.sdlc'); git(d, 'commit', '-qm', 'plan born')
  const planPath = '.sdlc/specs/2026-09-08-m/plan.md'
  for (const [id, f] of [['WP-001', 'a'], ['WP-002', 'b'], ['WP-003', 'c']]) {
    git(d, 'add', `src/${f}.js`); git(d, 'commit', '-qm', `feat: ${f}`, '-m', `SDLC-Task: ${id}\nSDLC-Plan: ${planPath}`)
  }
  let r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001,WP-002,WP-003', '--', 'echo ok'])
  assert(r.code === 0, r.out)

  const mark = (id, ...rest) => run(process.execPath, [tool('plan-check.mjs'), spec, 'mark', id, ...rest])
  const logLines = () => readFileSync(plan, 'utf8').split('## 실행 기록')[1].split('### 변경 기록')[0]
    .split('\n').filter((l) => l.startsWith('- '))

  r = mark('WP-001', '--note', '없음')
  assert(r.code === 0, r.out)
  assert(!/commit:|verify:/.test(logLines().join('\n')), `파생 필드를 적었다:\n${logLines().join('\n')}`)

  r = mark('WP-002', '--note', '없음')
  assert(r.code === 0, r.out)
  assert(logLines().length === 1, `계획대로 끝난 두 작업이 두 줄이 됐다:\n${logLines().join('\n')}`)
  assert(/WP-001 WP-002/.test(logLines()[0]), `앞줄에 ID 를 안 보탰다:\n${logLines()[0]}`)

  r = mark('WP-003', '--note', `캐시 무효화를 뒤로 미뤘다. ${'덧붙인 설명. '.repeat(20)}`)
  assert(r.code === 2 && /한도 120/.test(r.out), `장황한 --note 를 그대로 적었다 — 실행 기록은 훑는 줄이다:\n${r.out}`)
  assert(!/덧붙인 설명/.test(readFileSync(plan, 'utf8')), '거부해 놓고 계획서에는 썼다')

  r = mark('WP-003', '--note', '캐시 무효화를 뒤로 미뤘다')
  assert(r.code === 0, r.out)
  assert(logLines().length === 2 && /캐시 무효화/.test(logLines()[1]), `차이 있는 줄을 따로 안 세웠다:\n${logLines().join('\n')}`)

  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  const notes = JSON.parse(r.out).notes.filter((n) => n.msg.includes('§실행 기록'))
  assert(notes.length === 0, `묶인 줄을 기록 없음으로 읽었다: ${JSON.stringify(notes)}`)
})


await test('passing logs truncate output while failing logs preserve it', () => {
  const d = temp('sdlc-trunc')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: .sdlc/specs\nverify: echo ok\n')
  const spec = join(d, '.sdlc/specs/2026-09-08-t')
  put(join(spec, 'plan.md'), `---
artifact: plan
schema_version: 4
status: in_progress
---

## 작업 \`[필수 · 모든 티어]\`

- [ ] **WP-001 — 변경**
  - files: \`src/a.js\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 결과가 참이다
  - verify: true

## 실행 기록

해당 없음 — 아직 실행 전
`)
  put(join(d, 'src/a.js'), "test('결과가 참이다', () => {})\n")
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'plan born')

  const noisy = 'for i in $(seq 1 600); do echo "line $i"; done'
  const logs = () => readdirSync(join(d, '.sdlc/verify/2026-09-08-t')).sort()
  const read = (f) => readFileSync(join(d, '.sdlc/verify/2026-09-08-t', f), 'utf8')

  let r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', noisy])
  assert(r.code === 0, r.out)
  assert(r.out.split('\n').filter((l) => /^line \d+$/.test(l)).length === 600, '실행 중 출력까지 줄였다 — 자르는 것은 기록이지 화면이 아니다')
  const passed = read(logs()[0])
  const [header, kept] = passed.split('\n---\n')
  assert(/^sha256: [0-9a-f]{64}$/m.test(header), `전체 출력의 해시가 헤더에 없다 — 자른 로그를 지킬 것이 없다:\n${header}`)
  assert(/^output: tail 40 of 600 lines$/m.test(header), `무엇을 잘랐는지 헤더가 말하지 않는다:\n${header}`)
  assert(kept.split('\n').length < 60 && kept.includes('line 600') && !kept.includes('line 100'),
    `통과 로그 본문을 안 줄였다 (${kept.split('\n').length}줄)`)
  assert(/560 lines omitted/.test(kept), `자른 사실을 본문에 안 남겼다:\n${kept.slice(0, 200)}`)

  r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', `${noisy}; exit 3`])
  assert(r.code === 3, `실패 종료 코드를 삼켰다 (${r.code})`)
  const failed = read(logs().find((f) => read(f).includes('exit: 3')))
  assert(/^output: full 600 lines$/m.test(failed.split('\n---\n')[0]), `실패 로그를 잘랐다:\n${failed.split('\n---\n')[0]}`)
  assert(failed.includes('line 1\n') && failed.includes('line 300') && failed.includes('line 600'), '실패 로그에서 출력이 사라졌다')

  put(join(d, 'src/a.js'), "test('결과가 참이다', () => {})\nexport const a = 1\n")
  git(d, 'add', 'src/a.js'); git(d, 'commit', '-qm', 'feat: a', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: .sdlc/specs/2026-09-08-t/plan.md')
  r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', 'echo ok'])
  assert(r.code === 0, r.out)
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  assert(JSON.parse(r.out).rows[0].verified.length === 1, `헤더를 못 읽었다:\n${r.out}`)
})

await test('a verify log that is not evidence says which condition it failed', () => {
  // Every way of failing the evidence conjunction used to read «no verify record — run verify-run
  // first». For a test run that writes an un-ignored report file that advice loops forever.
  const repo = (prefix, verify) => {
    const d = temp(prefix)
    put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 4\nspec_dir: .sdlc/specs\nverify: "${verify}"\n`)
    const spec = join(d, '.sdlc/specs/2026-09-08-why')
    put(join(spec, 'plan.md'), `---
artifact: plan
schema_version: 4
status: in_progress
---

## 작업 \`[필수 · 모든 티어]\`

- [ ] **WP-001 — 변경**
  - files: \`src/a.js\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 결과가 참이다
  - verify: true

## 실행 기록

해당 없음 — 아직 실행 전
`)
    put(join(d, 'README.md'), 'readme\n')
    put(join(d, 'src/a.js'), "test('결과가 참이다', () => {})\n")
    git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
    git(d, 'add', '.claude', '.sdlc', 'README.md'); git(d, 'commit', '-qm', 'plan born')
    git(d, 'add', 'src/a.js'); git(d, 'commit', '-qm', 'feat: a', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: .sdlc/specs/2026-09-08-why/plan.md')
    const verifyRun = (command) => run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', command])
    const mark = () => run(process.execPath, [tool('plan-check.mjs'), spec, 'mark', 'WP-001', '--note', '없음'])
    const row = () => JSON.parse(run(process.execPath, [tool('plan-progress.mjs'), spec, '--json']).out).rows[0]
    return { d, spec, verifyRun, mark, row }
  }

  // No log at all: the old message is the right one, and the only case that keeps it.
  let c = repo('sdlc-why-none', 'echo ok')
  let r = c.mark()
  assert(r.code !== 0 && /기록이 없다/.test(r.out) && /먼저 돌린다/.test(r.out), `로그가 없을 때의 안내가 바뀌었다:\n${r.out}`)
  assert(c.row().unverified === null, `로그가 없는데 이유를 지어냈다: ${JSON.stringify(c.row().unverified)}`)

  // The command writes a file git does not ignore: unstable on every run.
  c = repo('sdlc-why-unstable', 'echo $$ >> coverage.tmp')
  r = c.verifyRun('echo $$ >> coverage.tmp')
  assert(r.code === 0, `불안정한 통과의 종료 코드를 바꿨다 (${r.code}):\n${r.out}`)
  assert(!/\n통과 —/.test(r.out) && /증거로 쓸 수 없다/.test(r.out) && /stable: false/.test(r.out) && /coverage\.tmp/.test(r.out) && /\.gitignore/.test(r.out),
    `verify-run 이 불안정한 실행을 그냥 «통과» 로 말했다:\n${r.out}`)
  const logDir = join(c.d, '.sdlc/verify/2026-09-08-why')
  const logFile = join(logDir, readdirSync(logDir)[0])
  assert(/^changed: \["coverage\.tmp"\]$/m.test(readFileSync(logFile, 'utf8')), `바뀐 경로를 헤더에 안 남겼다:\n${readFileSync(logFile, 'utf8')}`)
  r = c.mark()
  assert(r.code !== 0 && /stable: false/.test(r.out) && /coverage\.tmp/.test(r.out) && /\.gitignore/.test(r.out) && !/먼저 돌린다/.test(r.out),
    `mark 가 불안정을 말하지 않거나 «verify-run 을 먼저» 로 돌려보냈다:\n${r.out}`)
  assert(c.row().unverified?.code === 'unstable' && c.row().verified.length === 0, JSON.stringify(c.row().unverified))
  // A log written before `changed:` existed still reads as unstable, just without the paths.
  writeFileSync(logFile, readFileSync(logFile, 'utf8').replace(/^changed(_total)?: .*\n/gm, ''))
  const old = c.row().unverified
  assert(old?.code === 'unstable' && old.changed.length === 0 && /\.gitignore/.test(old.hint), `옛 로그를 못 읽었다: ${JSON.stringify(old)}`)

  // A command that differs from the profile's `verify` by one space is not a candidate at all.
  c = repo('sdlc-why-command', 'echo ok')
  r = c.verifyRun('echo  ok')
  assert(r.code === 0 && /증거로 쓸 수 없다/.test(r.out) && r.out.includes('"echo  ok"') && r.out.includes('"echo ok"'), `verify-run 이 명령 불일치를 말하지 않는다:\n${r.out}`)
  const u = c.row().unverified
  assert(u?.code === 'command' && u.msg.includes('"echo  ok"') && u.msg.includes('"echo ok"'), `명령 불일치를 두 문자열로 말하지 않는다: ${JSON.stringify(u)}`)
  r = c.mark()
  assert(r.code !== 0 && r.out.includes('"echo  ok"') && r.out.includes('"echo ok"') && !/먼저 돌린다/.test(r.out), `mark 가 명령 불일치를 말하지 않는다:\n${r.out}`)

  // A passing, stable run, then an unrelated edit: the repository changed since the run.
  c = repo('sdlc-why-changed', 'echo ok')
  r = c.verifyRun('echo ok')
  assert(r.code === 0 && /\n통과 —/.test(r.out) && !/증거로 쓸 수 없다/.test(r.out), `증거가 되는 실행을 의심했다:\n${r.out}`)
  assert(c.row().verified.length === 1 && c.row().unverified === null, JSON.stringify(c.row()))
  put(join(c.d, 'README.md'), 'edited after the run\n')
  assert(c.row().unverified?.code === 'repository-changed', JSON.stringify(c.row().unverified))
  r = c.mark()
  assert(r.code !== 0 && /저장소가 바뀌었다/.test(r.out) && !/먼저 돌린다/.test(r.out), `mark 가 실행 뒤 바뀐 저장소를 말하지 않는다:\n${r.out}`)
  r = run(process.execPath, [tool('plan-progress.mjs'), c.spec])
  assert(/최신 verify 로그가 완료 증거가 못 된다 — verify 뒤에 저장소가 바뀌었다/.test(r.out), `plan-progress 텍스트 보고에 이유가 없다:\n${r.out}`)
})

await test('the v2 fingerprint of a working tree equals that of its commit, and only a real change moves it', () => {
  // verify-run fingerprints the working tree; plan-progress recomputes a completed set from its
  // commit. The two must agree for an unchanged tree, including for content git rewrites on the way
  // in (a CRLF file under a `text` rule), a symlink, an executable and a path git has to quote.
  const d = temp('sdlc-fp2')
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  put(join(d, '.gitattributes'), '*.txt text\n')
  put(join(d, 'crlf.txt'), 'a\r\nb\r\n')
  put(join(d, 'run.sh'), '#!/bin/sh\n', 0o755)
  symlinkSync('crlf.txt', join(d, 'link'))
  put(join(d, 'we"ird\nname.js'), 'x\n')
  put(join(d, 'src/a.js'), '1\n')
  put(join(d, '.sdlc/verify/s/L1.log'), 'excluded\n')
  put(join(d, '.git/info/exclude'), 'ignored.log\n')
  const dirs = { specDir: '.sdlc/specs', logDir: '.sdlc/verify' }
  const task = { fields: new Map([['files', '`src/`, `crlf.txt`, `link`, `run.sh`, `missing.js`']]) }
  const tree = repositoryFingerprint(d, dirs), taskTree = taskFingerprint(d, task)
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'tree')
  const head = git(d, 'rev-parse', 'HEAD')
  assert(repositoryFingerprint(d, dirs, head) === tree, '같은 트리의 작업 트리 지문과 커밋 지문이 다르다')
  assert(taskFingerprint(d, task, head) === taskTree, '같은 트리의 작업 지문이 작업 트리와 커밋에서 다르다')
  const moves = (label, change, undo) => {
    change()
    const moved = repositoryFingerprint(d, dirs) !== tree
    undo?.()
    return moved
  }
  assert(moves('byte', () => appendFileSync(join(d, 'src/a.js'), '2'), () => writeFileSync(join(d, 'src/a.js'), '1\n')), '한 바이트 변경을 놓쳤다')
  assert(moves('mode', () => chmodSync(join(d, 'run.sh'), 0o644), () => chmodSync(join(d, 'run.sh'), 0o755)), '실행 비트 변경을 놓쳤다')
  assert(moves('rename', () => renameSync(join(d, 'src/a.js'), join(d, 'src/b.js')), () => renameSync(join(d, 'src/b.js'), join(d, 'src/a.js'))), '이름 바꾸기를 놓쳤다')
  assert(moves('untracked', () => put(join(d, 'new.js'), ''), () => rmSync(join(d, 'new.js'))), '새 파일을 놓쳤다')
  assert(repositoryFingerprint(d, dirs) === tree, '되돌린 트리의 지문이 처음과 다르다')
  assert(!moves('ignored', () => put(join(d, 'ignored.log'), 'x')), 'git 이 무시하는 파일이 지문을 바꿨다')
  assert(!moves('log', () => put(join(d, '.sdlc/verify/s/L2.log'), 'x')), 'verify_log_dir 의 파일이 지문을 바꿨다')
})

await test('a completed set keeps v1 log evidence, and checking a v2 one costs a constant number of git calls', () => {
  // Recomputing at a ref used to run two git processes per file of the repository: 151 s for one
  // completed set in a repository of 1,500 files. A log names its algorithm; one without the key is
  // version 1, and a completed set's old logs are never rewritten, so they must keep verifying.
  const completed = (prefix, extra, rewrite) => {
    const d = temp(prefix)
    const spec = join(d, 'specs/a'), plan = join(spec, 'plan.md')
    put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 4\nspec_dir: specs\nverify: "true"\n')
    put(plan, '---\nartifact: plan\nschema_version: 4\nstatus: in_progress\n---\n\n## 작업\n\n- [x] **WP-001 — 변경**\n  - files: `app.cjs`, `lib/`\n  - depends: 없음\n  - covers: FR-001\n  - tests: 결과가 참이다\n  - verify: true\n\n## 실행 기록\n\n- WP-001 완료\n')
    put(join(d, 'app.cjs'), '// 결과가 참이다\n')
    put(join(d, 'lib/b.cjs'), 'module.exports = 0\n')
    for (let i = 0; i < extra; i++) put(join(d, `assets/f${i}.txt`), `${i}\n`)
    git(d, 'init', '-q'); git(d, 'config', 'user.name', 'eval'); git(d, 'config', 'user.email', 'eval@local')
    git(d, 'add', '.'); git(d, 'commit', '-qm', 'born')
    put(join(d, 'lib/b.cjs'), 'module.exports = 1\n')
    git(d, 'add', '.'); git(d, 'commit', '-qm', 'work', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: specs/a/plan.md')
    assert(run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', 'true']).code === 0, '검증 실행 실패')
    const logDir = join(d, '.sdlc/verify/a')
    const log = join(logDir, readdirSync(logDir)[0])
    assert(/^fingerprint: 2$/m.test(readFileSync(log, 'utf8')), `새 로그가 지문 방식을 적지 않았다:\n${readFileSync(log, 'utf8')}`)
    rewrite?.(d, spec, log)
    put(plan, readFileSync(plan, 'utf8').replace('in_progress', 'completed'))
    git(d, 'add', '.'); git(d, 'commit', '-qm', 'completed')
    return { d, spec }
  }
  const row = (spec, env) => JSON.parse(run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'], env ? { env } : {}).out).rows[0]

  // A log as the previous verify-run wrote it: no `fingerprint:` key, version-1 hashes.
  const v1 = completed('sdlc-fp-v1', 3, (d, spec, log) => {
    const task = [...loadDir(spec, () => {}).plan.ents.values()].find((e) => e.id === 'WP-001')
    const dirs = { specDir: 'specs', logDir: '.sdlc/verify' }
    writeFileSync(log, readFileSync(log, 'utf8')
      .replace(/^fingerprint: 2\n/m, '')
      .replace(/^fingerprints: .*$/m, `fingerprints: ${JSON.stringify({ 'WP-001': taskFingerprintV1(d, task) })}`)
      .replace(/^repository: .*$/m, `repository: ${repositoryFingerprintV1(d, dirs)}`))
  })
  let r = row(v1.spec)
  assert(r.verified.length === 1 && r.unverified === null, `v1 로그를 가진 완료 세트가 증거를 잃었다: ${JSON.stringify(r.unverified)}`)

  // Count the git processes, not the seconds: a timing bound is either loose enough to pass on a
  // slow CI runner or tight enough to catch the regression, rarely both. The same set in a
  // repository of 3 and of 300 files must cost the same number of calls.
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  const spawned = (extra) => {
    const set = completed(`sdlc-fp-v2-${extra}`, extra)
    const shim = temp('sdlc-fp-shim'), calls = join(shim, 'calls')
    put(join(shim, 'git'), `#!/bin/sh\necho "$*" >> "${calls}"\nexec "${real}" "$@"\n`, 0o755)
    const got = row(set.spec, { ...process.env, PATH: `${shim}:${process.env.PATH}` })
    assert(got.verified.length === 1 && got.unverified === null, `v2 로그를 가진 완료 세트가 증거가 못 된다: ${JSON.stringify(got.unverified)}`)
    return readFileSync(calls, 'utf8').trim().split('\n')
  }
  const small = spawned(3), large = spawned(300)
  assert(large.length === small.length && large.length < 100,
    `완료 세트 하나를 보는 git 호출이 파일 3개에서 ${small.length}번, 300개에서 ${large.length}번이다 — 파일 수에 비례한다:\n${large.slice(0, 12).join('\n')}`)
  const trees = large.map((c) => /ls-tree -r -z ([0-9a-f]{40})$/.exec(c)?.[1]).filter(Boolean)
  assert(trees.length && new Set(trees).size === trees.length, `같은 커밋의 트리를 여러 번 읽었다:\n${trees.join('\n')}`)
})


await test('uncommitted profiles and ADRs are reported as local-only checks', () => {
  const d = temp('sdlc-tracked')
  const profile = join(d, '.claude/spec-profile.yml')
  put(profile, 'sdlc_version: 5\nspec_dir: ".sdlc/specs"\nadr_dir: "docs/adr"\n')
  mkdirSync(join(d, '.sdlc/specs'), { recursive: true })
  mkdirSync(join(d, 'docs/adr'), { recursive: true })
  put(join(d, 'docs/adr/index.md'), '# 결정 기록\n\n| ID | 제목 | 상태 |\n|---|---|---|\n')
  put(join(d, '.gitignore'), '.claude/\n')
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')

  const check = (...a) => run(process.execPath, [tool('check-all.mjs'), d, ...a])
  let r = check()
  assert(/프로필이 Git 에 없다/.test(r.out), `gitignore 된 프로필을 조용히 통과시켰다:\n${r.out}`)
  assert(/결정 기록이 Git 에 없다/.test(r.out), `커밋되지 않은 ADR 을 조용히 통과시켰다:\n${r.out}`)
  assert(/owner/.test(r.out), `사람마다 다른 키를 어떻게 하라는 말이 없다:\n${r.out}`)
  assert(r.code !== 2, `기본 모드에서 프로필 부재로 오해했다 (${r.code})`)

  assert(check('--required').code === 1, 'CI 모드에서 통과시켰다')

  git(d, 'add', '-f', '.claude/spec-profile.yml', 'docs/adr'); git(d, 'commit', '-qm', 'chore: profile')
  r = check()
  assert(!/Git 에 없다/.test(r.out), `추적되는 설정을 여전히 문제로 봤다:\n${r.out}`)
})



await test('English and Korean ADR indexes round-trip and normalize legacy statuses', async () => {
  const { loadAdr } = await import('../tools/artifact-parse.mjs')
  const { adrDigest } = await import('../tools/adr-check.mjs')
  for (const lang of ['ko', 'en']) {
    const d = temp('sdlc-index-language')
    put(join(d, '.claude/spec-profile.yml'), `lang: ${lang}\nadr_dir: docs/adr\n`)
    put(join(d, 'docs/adr/ADR-001-old.md'), '# ADR-001 — Old\n\n| Status | superseded |\n')
    // A bilingual label, `상태(Status)`, is how one repository actually wrote its header table; the
    // label is not contract and must not turn a known value into an unknown status.
    put(join(d, 'docs/adr/ADR-002-current.md'), '# ADR-002 — Current\n\n| 상태(Status) | 승인됨 |\n')
    const invoke = (...args) => run(process.execPath, [tool('adr-index.mjs'), d, ...args])
    assert(invoke().code === 0, 'index generation failed')
    assert(invoke('--check').code === 0, 'generated index failed its own check')
    const indexPath = join(d, 'docs/adr/index.md')
    const index = readFileSync(indexPath, 'utf8')
    const [live, past] = index.split(lang === 'en' ? '## Past decisions' : '## 지나간 결정')
    assert(!live.includes('[ADR-001]') && past.includes('[ADR-001]'), 'superseded legacy ADR classified as live')
    assert(live.includes('[ADR-002]'), 'Korean legacy alias not accepted')
    assert(index.startsWith(lang === 'en' ? '# Decision log' : '# 결정 로그'), 'wrong index language')
    put(indexPath, index + '\nmanual change\n')
    assert(invoke('--check').code === 1, 'stale index passed')
    put(join(d, 'docs/adr/ADR-003-unknown.md'), '# ADR-003 — Unknown\n\n| Status | mystery |\n')
    assert(invoke().code === 2 && invoke('--next').code === 2, 'unknown status silently accepted')
    assert(readFileSync(indexPath, 'utf8') === index + '\nmanual change\n', 'failed generation overwrote index')
    const path = join(d, 'docs/adr/ADR-004-choice.md')
    put(path, '---\nartifact: adr\nid: ADR-004\n---\n# Choice\n\n## DECISION\n\nUse storage.\n\n## ALTERNATIVES\n\n### ALT-001 — Storage (chosen)\n\n### ALT-002 — Memory\n')
    const digest = adrDigest(loadAdr(path))
    assert(digest.decision === 'Use storage.' && digest.chosen[0] === 'Storage', JSON.stringify(digest))
  }
})

// Cross-repository decisions: the document repository names repositories, the code repository
// names paths. Each fixture pair is a real `git init` because freshness is read from commits.
const bindAdr = (id, title, extra) => `---
artifact: adr
schema_version: 5
id: "${id}"
title: "${title}"
status: accepted
${extra}
supersedes: null
superseded_by: null
approved_by: "human"
generated_by: "agent"
revisit: []
---

# ${id} — ${title}

## Decision

Price at 1:1 on the first epoch.

### Non-goals

- Fee schedules.

## Context and forces

Pricing drift.

## Alternatives

### ALT-001 — Administrator sets the price

Flexible, and an input error persists.

### ALT-002 — Fixed 1:1 (chosen)

Nothing to misconfigure.

## Consequences

- What this buys: no configuration error.
- What it costs: no way to start at a premium.

## Review and revisit

- **Confirms:** the pool tests.
`
function bindUpstream() {
  const up = temp('sdlc-adr-docs')
  put(join(up, '.claude/spec-profile.yml'), 'adr_dir: "docs/adr"\nrepo: "acme/docs"\n')
  put(join(up, 'docs/adr/ADR-001-vault-pricing.md'), bindAdr('ADR-001', 'Vault pricing', 'applies_to: ["acme/contracts"]\nscope: []\nconfirms: []'))
  // The shape 8percent/rwa-docs PR 174 wrote: another repository's paths held upstream.
  put(join(up, 'docs/adr/ADR-002-nav-freshness.md'), bindAdr('ADR-002', 'NAV freshness', 'scope: ["contracts:src/nav"]\nconfirms: ["test_NavIsFresh"]'))
  git(up, 'init', '-q'); git(up, 'config', 'user.email', 'eval@local'); git(up, 'config', 'user.name', 'eval')
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'decisions')
  return up
}
function bindConsumer() {
  const d = temp('sdlc-adr-contracts')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 7\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\nrepo: "acme/contracts"\nadr_repo: "acme/docs"\n`)
  put(join(d, '.sdlc/specs/.keep'), '')
  put(join(d, 'src/vault/Pool.sol'), 'contract Pool {}\n')
  put(join(d, 'src/vault/Pool.t.sol'), 'function test_PoolPricesAtGenesis() {}\n')
  put(join(d, 'src/nav/Nav.t.sol'), 'function test_NavIsFresh() {}\n')
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'code')
  return d
}
const bindingsYml = (sha, vault = 'src/vault') => `source: "acme/docs"
bindings:
  ADR-001:
    at: "${sha.slice(0, 12)}"
    paths: ["${vault}"]
    confirms: ["test_PoolPricesAtGenesis"]
  ADR-002:
    at: "${sha.slice(0, 12)}"
    paths:
      - "src/nav"
    confirms: ["test_NavIsFresh"]
`
const bindCheck = (d, up) => {
  const r = run(process.execPath, [tool('adr-bindings.mjs'), d, '--json', ...(up ? ['--from', up] : [])])
  try { return { ...JSON.parse(r.out), code: r.code, raw: r.out } } catch { throw new Error(`adr-bindings did not print JSON (code ${r.code}):\n${r.out}`) }
}
const said = (rep, re) => rep.problems.some((p) => re.test(`${p.msg} ${p.hint ?? ''}`))

await test('a binding whose path is gone warns in the code repository', () => {
  const up = bindUpstream(), d = bindConsumer()
  let r = run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up])
  assert(r.code === 0, `pull-adr failed:\n${r.out}`)
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))
  let rep = bindCheck(d, up)
  assert(rep.counts.errors === 0 && rep.counts.warnings === 0, `a clean binding did not pass:\n${rep.raw}`)

  git(d, 'mv', 'src/vault', 'src/pool'); git(d, 'commit', '-qm', 'rename')
  rep = bindCheck(d, up)
  assert(said(rep, /`paths` 의 `src\/vault` 가 없다/), `a renamed path passed in the repository that renamed it:\n${rep.raw}`)
  r = run(process.execPath, [tool('check-all.mjs'), d])
  assert(r.code !== 0 && /결정 바인딩 실패/.test(r.out), `check-all let the broken binding through:\n${r.out}`)

  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD'), 'src/pool'))
  rep = bindCheck(d, up)
  assert(rep.counts.errors === 0 && rep.counts.warnings === 0, `fixing the binding in the same repository did not clear it:\n${rep.raw}`)
})

await test('an accepted ADR that applies to this repository and has no binding warns', () => {
  const up = bindUpstream(), d = bindConsumer()
  let rep = bindCheck(d, up)
  assert(said(rep, /결정 매니페스트가 없다/) && rep.counts.warnings > 0, `a missing manifest looked like a pass:\n${rep.raw}`)

  const r = run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up])
  assert(r.code === 0, r.out)
  // The old-form ADR hands its paths across; the new-form one leaves them for this repository.
  assert(/ADR-002:[\s\S]*paths: \["src\/nav"\][\s\S]*confirms: \["test_NavIsFresh"\]/.test(r.out), `no skeleton carried the legacy paths:\n${r.out}`)
  rep = bindCheck(d, up)
  for (const id of ['ADR-001', 'ADR-002']) {
    assert(said(rep, new RegExp(`${id}.*이 레포에 적용되는데 바인딩이 없다`)), `${id} went unbound silently:\n${rep.raw}`)
  }

  const sha = git(up, 'rev-parse', 'HEAD').slice(0, 12)
  const nav = `  ADR-002:\n    at: "${sha}"\n    paths: ["src/nav"]\n    confirms: ["test_NavIsFresh"]\n`
  put(join(d, '.claude/adr-bindings.yml'), `source: "acme/docs"\nbindings:\n  ADR-001:\n    at: "${sha}"\n    paths: []\n${nav}`)
  rep = bindCheck(d, up)
  assert(said(rep, /ADR-001 — `paths: \[\]` 인데 `reason` 이 없다/) && rep.counts.errors === 1, `an unexplained opt-out passed:\n${rep.raw}`)
  put(join(d, '.claude/adr-bindings.yml'), `source: "acme/docs"\nbindings:\n  ADR-001:\n    at: "${sha}"\n    paths: []\n    reason: "pricing lives in the backend here"\n${nav}`)
  rep = bindCheck(d, up)
  assert(rep.counts.errors === 0 && rep.counts.warnings === 0 && rep.notes.some((n) => /경로 없이 묶었다/.test(n)), `an explained opt-out was not accepted, or not shown:\n${rep.raw}`)
})

await test('a repo-prefixed scope is rejected from the schema that introduces bindings — `applies_to` marks it, since an ADR is always schema 5', () => {
  const up = bindUpstream()
  put(join(up, 'docs/adr/ADR-003-both-forms.md'), bindAdr('ADR-003', 'Both forms', 'applies_to: ["acme/contracts"]\nscope: ["contracts:src/vault"]\nconfirms: []'))
  const r = run(process.execPath, [tool('check-artifacts.mjs'), join(up, 'docs/adr'), '--json'])
  const rep = JSON.parse(r.out)
  const on = (name) => rep.problems.filter((p) => p.doc.startsWith(name))
  assert(on('ADR-003').some((p) => p.level === 'error' && /`applies_to` 를 쓰는데 `scope` 가 다른 레포의 경로를 짚는다/.test(p.msg)), `both forms at once passed:\n${r.out}`)
  assert(on('ADR-002').some((p) => p.level === 'warn' && /`scope` 가 다른 레포의 경로를 짚는다/.test(p.msg)), `the old form was not flagged as unchecked:\n${r.out}`)
  assert(on('ADR-002').every((p) => p.level !== 'error'), `the old form turned red — ADRs written before bindings must not:\n${r.out}`)
  assert(on('ADR-001').every((p) => !/`(scope|confirms)` 가 비었다/.test(p.msg)), `an ADR reaching code through applies_to was told to fill scope:\n${r.out}`)
})

await test('a cross-repository decision reaches the plan and the writer through bindings, and goes stale loudly', () => {
  const up = bindUpstream(), d = bindConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))
  const set = join(d, '.sdlc/specs/pool')
  const plan = (pins) => `---
artifact: plan
schema_version: 7
status: draft
decisions: [${pins}]
---

# Plan

## 작업

- [ ] **WP-001 — 첫 에포크 가격**
  - files: \`src/vault/Pool.sol\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 첫 에포크는 1:1 이다
  - verify: true
`
  put(join(set, 'plan.md'), plan(''))
  let r = run(process.execPath, [tool('check-artifacts.mjs'), set, '--json'])
  assert(/WP-001 의 files 가 ADR-001.*바인딩 paths 를 만지는데/.test(r.out), `the plan touched a bound decision unpinned, unnoticed:\n${r.out}`)
  // The hint names the value to copy — the decision's content hash — rather than a `<sha>` to look up.
  assert(/acme\/docs#ADR-001@body:[0-9a-f]{12}\b/.test(r.out), `the pin hint did not name the other repository with a copyable value:\n${r.out}`)

  r = run(process.execPath, [tool('task-brief.mjs'), set, 'WP-001'])
  assert(/Price at 1:1 on the first epoch/.test(r.out) && /Administrator sets the price/.test(r.out) && /Fee schedules/.test(r.out),
    `the writer never saw the decision from the other repository:\n${r.out}`)

  put(join(set, 'plan.md'), plan('"acme/docs#ADR-009@abcdef1"'))
  r = run(process.execPath, [tool('check-artifacts.mjs'), set, '--json'])
  assert(/핀한 ADR-009 가 없다/.test(r.out), `a pin into the manifest's repository passed without being found:\n${r.out}`)

  const adr = join(up, 'docs/adr/ADR-001-vault-pricing.md')
  put(adr, readFileSync(adr, 'utf8').replace('Price at 1:1', 'Price at 1:1.01'))
  git(up, 'commit', '-qam', 'change the decision')
  let rep = bindCheck(d, up)
  assert(said(rep, /ADR-001 가 끌어온 뒤 상류에서 바뀌었다/), `a stale manifest passed next to a checkout:\n${rep.raw}`)
  rep = bindCheck(d)
  assert(rep.notes.some((n) => /체크아웃이 없다/.test(n)), `freshness went unchecked without a word:\n${rep.raw}`)

  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 're-pull failed')
  rep = bindCheck(d, up)
  assert(said(rep, /ADR-001 — 묶은 뒤 결정이 바뀌었다/) && !said(rep, /ADR-002 — 묶은 뒤/), `a binding read at an older decision passed:\n${rep.raw}`)

  const mpath = join(d, '.claude/adr-manifest.json')
  put(mpath, readFileSync(mpath, 'utf8').replace('"accepted"', '"draft"'))
  rep = bindCheck(d, up)
  assert(said(rep, /매니페스트가 `pull-adr` 가 쓴 것과 다르다/), `a hand-edited manifest passed:\n${rep.raw}`)
})

await test('pull-adr twice with nothing changed upstream leaves the manifest byte-identical, and an old manifest with pulled_at still passes', () => {
  const up = bindUpstream(), d = bindConsumer()
  const mpath = join(d, '.claude/adr-manifest.json')
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'first pull failed')
  const first = readFileSync(mpath, 'utf8')
  assert(!/pulled_at/.test(first), `the manifest still records when it was pulled:\n${first}`)
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'second pull failed')
  assert(readFileSync(mpath, 'utf8') === first, `a re-pull with nothing changed upstream rewrote the manifest:\n${first}\n---\n${readFileSync(mpath, 'utf8')}`)

  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))
  const m = JSON.parse(first)
  put(mpath, JSON.stringify({ source: m.source, commit: m.commit, pulled_at: '2026-09-01T00:00:00Z', decisions: m.decisions, integrity: m.integrity }, null, 2) + '\n')
  const rep = bindCheck(d, up)
  assert(rep.counts.errors === 0 && rep.counts.warnings === 0, `a manifest written before pulled_at was dropped no longer passes:\n${rep.raw}`)
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 're-pull over an old manifest failed')
  assert(readFileSync(mpath, 'utf8') === first, 'a re-pull did not drop pulled_at from an old manifest')
})

// A binding and a pin are tied to what the decision says — its content hash — not to the commit that
// last touched the file. Keyed on the commit, every consumer went red on an upstream typo, an
// `applies_to` edit or a squash merge, and on any decision added for another repository.
const manifestOf = (d) => JSON.parse(readFileSync(join(d, '.claude/adr-manifest.json'), 'utf8'))
const bodyAt = (d, id) => `body:${manifestOf(d).decisions.find((x) => x.id === id).digest.slice(0, 12)}`
const bodyBindings = (d) => `source: "acme/docs"
bindings:
  ADR-001:
    at: "${bodyAt(d, 'ADR-001')}"
    paths: ["src/vault"]
    confirms: ["test_PoolPricesAtGenesis"]
  ADR-002:
    at: "${bodyAt(d, 'ADR-002')}"
    paths: ["src/nav"]
    confirms: ["test_NavIsFresh"]
`
const allChecks = (d, up) => run(process.execPath, [tool('check-all.mjs'), d], { env: { ...process.env, SDLC_UPSTREAM: up } })
const noted = (rep, re) => rep.notes.some((n) => re.test(n))
const clean = (rep) => rep.counts.errors === 0 && rep.counts.warnings === 0

await test('a content-hash binding survives an upstream typo, an applies_to edit and a squash merge, with a note', () => {
  const up = bindUpstream(), d = bindConsumer()
  let r = run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up])
  assert(r.code === 0 && /at: "body:[0-9a-f]{12}"/.test(r.out), `the skeleton did not print the content form:\n${r.out}`)
  assert(manifestOf(d).decisions.every((x) => /^[0-9a-f]{64}$/.test(x.digest ?? '')), 'pull-adr wrote no content hash')
  put(join(d, '.claude/adr-bindings.yml'), bodyBindings(d))
  let rep = bindCheck(d, up)
  assert(clean(rep), `a fresh content-hash binding did not pass:\n${rep.raw}`)

  const adr = join(up, 'docs/adr/ADR-001-vault-pricing.md')
  put(adr, readFileSync(adr, 'utf8').replace('Pricing drift.', 'Pricing drifts.'))
  git(up, 'commit', '-qam', 'typo outside the decision')
  rep = bindCheck(d, up)
  assert(clean(rep) && noted(rep, /ADR-001 — 상류에서 문구가 바뀌었다 — 묶은 내용은 그대로다/), `a typo outside the bound parts failed the consumer, or went unsaid:\n${rep.raw}`)
  r = allChecks(d, up)
  assert(r.code === 0, `check-all failed the consumer over an upstream typo:\n${r.out}`)

  put(adr, readFileSync(adr, 'utf8').replace('applies_to: ["acme/contracts"]', 'applies_to: ["acme/contracts", "acme/web"]'))
  git(up, 'commit', '-qam', 'also applies to web')
  rep = bindCheck(d, up)
  assert(clean(rep) && noted(rep, /ADR-001 — 상류에서 문구가 바뀌었다/), `a frontmatter-only edit failed the consumer:\n${rep.raw}`)
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 're-pull failed')
  rep = bindCheck(d, up)
  assert(clean(rep), `after re-pulling a frontmatter-only edit the content-hash binding went stale:\n${rep.raw}`)
  assert(allChecks(d, up).code === 0, 'check-all failed after a re-pull that changed nothing bound')

  // A draft pulled from a feature branch, then squash-merged: a new commit, the same text.
  const main = git(up, 'rev-parse', '--abbrev-ref', 'HEAD')
  git(up, 'checkout', '-qb', 'adr-003')
  put(join(up, 'docs/adr/ADR-003-retention.md'), bindAdr('ADR-003', 'Retention', 'applies_to: ["acme/contracts"]\nscope: []\nconfirms: []').replace('status: accepted', 'status: in_review'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'draft ADR-003')
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull from the feature branch failed')
  const branchSha = manifestOf(d).decisions.find((x) => x.id === 'ADR-003').sha
  git(up, 'checkout', '-q', main); git(up, 'merge', '-q', '--squash', 'adr-003'); git(up, 'commit', '-qm', 'ADR-003 (squashed)')
  assert(git(up, 'log', '-1', '--format=%H', '--', 'docs/adr/ADR-003-retention.md') !== branchSha, 'the squash kept the SHA — the fixture tests nothing')
  rep = bindCheck(d, up)
  assert(rep.counts.errors === 0 && !said(rep, /ADR-003 가 끌어온 뒤/), `a squash merge with identical text failed the consumer:\n${rep.raw}`)
})

await test('a content-hash binding goes stale when the Decision sentence changes, with the re-read hint', () => {
  const up = bindUpstream(), d = bindConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  put(join(d, '.claude/adr-bindings.yml'), bodyBindings(d))
  const before = bodyAt(d, 'ADR-001')
  const adr = join(up, 'docs/adr/ADR-001-vault-pricing.md')
  put(adr, readFileSync(adr, 'utf8').replace('Price at 1:1 on the first epoch.', 'Price at 1:1.01 on the first epoch.'))
  git(up, 'commit', '-qam', 'change the decision')
  let rep = bindCheck(d, up)
  assert(rep.problems.some((p) => p.rule === 'manifest-decision-changed' && /ADR-001 가 끌어온 뒤 상류에서 바뀌었다/.test(p.msg)), `a changed decision bound here passed next to a checkout:\n${rep.raw}`)
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 're-pull failed')
  rep = bindCheck(d, up)
  const after = bodyAt(d, 'ADR-001')
  const stale = rep.problems.find((p) => p.rule === 'binding-stale' && /^ADR-001 — 묶은 뒤 결정이 바뀌었다/.test(p.msg))
  assert(after !== before && stale && /다시 읽고/.test(stale.hint) && stale.hint.includes(`at: "${after}"`), `a binding read at an older decision passed, or the hint named no value:\n${rep.raw}`)
  assert(!said(rep, /ADR-002 — 묶은 뒤/), `the unchanged decision went stale too:\n${rep.raw}`)
})

await test('a commit-SHA binding behaves as before and suggests the content form only while it is current', () => {
  const up = bindUpstream(), d = bindConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))
  let rep = bindCheck(d, up)
  assert(clean(rep) && noted(rep, new RegExp(`ADR-001 — \`at\` 이 커밋 SHA 다.*at: "${bodyAt(d, 'ADR-001')}"`)), `no suggestion of the content form, or it failed:\n${rep.raw}`)
  const adr = join(up, 'docs/adr/ADR-001-vault-pricing.md')
  put(adr, readFileSync(adr, 'utf8').replace('Pricing drift.', 'Pricing drifts.'))
  git(up, 'commit', '-qam', 'typo')
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 're-pull failed')
  rep = bindCheck(d, up)
  assert(said(rep, /ADR-001 — 묶은 뒤 결정이 바뀌었다 — `at: [0-9a-f]{7}`/) && !noted(rep, /ADR-001 — `at` 이 커밋 SHA 다/), `a stale SHA binding passed, or was offered a hash nobody re-read:\n${rep.raw}`)
})

await test('an upstream decision the manifest does not know fails only when it applies here', () => {
  const up = bindUpstream(), d = bindConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  put(join(d, '.claude/adr-bindings.yml'), bodyBindings(d))
  put(join(up, 'docs/adr/ADR-003-web-cache.md'), bindAdr('ADR-003', 'Web cache', 'applies_to: ["acme/web"]\nscope: []\nconfirms: []'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'ADR-003 for web')
  let rep = bindCheck(d, up)
  assert(clean(rep) && noted(rep, /매니페스트가 모르는 결정이 있다 — ADR-003 — 이 레포를 제약하지 않아/), `a decision for another repository failed this one, or went unsaid:\n${rep.raw}`)

  // Known, then changed: still another repository's business.
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 're-pull failed')
  const adr3 = join(up, 'docs/adr/ADR-003-web-cache.md')
  put(adr3, readFileSync(adr3, 'utf8').replace('Price at 1:1', 'Cache for a day'))
  git(up, 'commit', '-qam', 'change ADR-003')
  rep = bindCheck(d, up)
  assert(clean(rep) && noted(rep, /ADR-003 가 끌어온 뒤 상류에서 바뀌었다.*이 레포를 제약하지 않아/), `a change to another repository's decision failed this one:\n${rep.raw}`)

  put(join(up, 'docs/adr/ADR-004-vault-fees.md'), bindAdr('ADR-004', 'Vault fees', 'applies_to: ["acme/contracts"]\nscope: []\nconfirms: []'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'ADR-004 for contracts')
  rep = bindCheck(d, up)
  assert(rep.problems.some((p) => p.level === 'error' && p.rule === 'manifest-decision-unknown' && /ADR-004/.test(p.msg)), `a new decision for this repository passed:\n${rep.raw}`)

  // Without `repo` nothing can tell what applies here, so every change stays an error.
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 7\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\nadr_repo: "acme/docs"\n`)
  rep = bindCheck(d, up)
  assert(rep.problems.some((p) => p.rule === 'manifest-decision-changed' && /ADR-003/.test(p.msg)), `without repo a change upstream was read as not applying:\n${rep.raw}`)
})

await test('a manifest pulled before content hashes loads and is checked by commit, with a note', async () => {
  const { manifestIntegrity } = await import('../tools/adr-bindings.mjs')
  const up = bindUpstream(), d = bindConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  const m = manifestOf(d)
  const decisions = m.decisions.map(({ digest, ...rest }) => rest)
  put(join(d, '.claude/adr-manifest.json'), JSON.stringify({ ...m, decisions, integrity: manifestIntegrity(decisions) }, null, 2) + '\n')
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))
  let rep = bindCheck(d, up)
  assert(clean(rep) && noted(rep, /결정 해시\(`digest`\)가 없다/), `an old manifest did not load cleanly, or did not say how it was compared:\n${rep.raw}`)
  const adr = join(up, 'docs/adr/ADR-001-vault-pricing.md')
  put(adr, readFileSync(adr, 'utf8').replace('Pricing drift.', 'Pricing drifts.'))
  git(up, 'commit', '-qam', 'typo')
  rep = bindCheck(d, up)
  assert(said(rep, /ADR-001 가 끌어온 뒤 상류에서 바뀌었다 — [0-9a-f]{7} → [0-9a-f]{7}/), `an old manifest was not compared by commit:\n${rep.raw}`)
})

await test('the @ suffix of a pin into the manifest repository is optional, and checked at the level it can tell', () => {
  const up = bindUpstream(), d = bindConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  put(join(d, '.claude/adr-bindings.yml'), bodyBindings(d))
  const oldSha = manifestOf(d).decisions.find((x) => x.id === 'ADR-001').sha.slice(0, 7)
  const set = join(d, '.sdlc/specs/pool')
  const pinned = (pin, status = 'draft') => {
    put(join(set, 'plan.md'), `---\nartifact: plan\nschema_version: 7\nstatus: ${status}\ndecisions: ["${pin}"]\n---\n\n# Plan\n\n## 작업\n\n- [ ] **WP-001 — 첫 에포크 가격**\n  - files: \`src/vault/Pool.sol\`\n  - depends: 없음\n  - covers: FR-001 (AC-001)\n  - tests: 첫 에포크는 1:1 이다\n  - verify: true\n`)
    const out = run(process.execPath, [tool('check-artifacts.mjs'), set, '--json']).out
    try { return { ...JSON.parse(out), raw: out } } catch { throw new Error(`check-artifacts did not print JSON:\n${out}`) }
  }
  const pinProblems = (rep) => rep.problems.filter((p) => /^(decision-pin|pin-dead|task-adr-unpinned)/.test(p.rule ?? ''))
  let rep = pinned('acme/docs#ADR-001')
  assert(!pinProblems(rep).length, `a pin without a suffix into the manifest's repository was questioned:\n${rep.raw}`)
  rep = pinned(`acme/docs#ADR-001@${bodyAt(d, 'ADR-001')}`)
  assert(!pinProblems(rep).length, `a matching @body: pin was questioned:\n${rep.raw}`)
  rep = pinned(`acme/docs#ADR-001@${oldSha}`)
  assert(!pinProblems(rep).length, `a current @sha pin was questioned:\n${rep.raw}`)

  const adr = join(up, 'docs/adr/ADR-001-vault-pricing.md')
  put(adr, readFileSync(adr, 'utf8').replace('Price at 1:1 on the first epoch.', 'Price at 1:1.01 on the first epoch.'))
  git(up, 'commit', '-qam', 'change the decision')
  const oldBody = bodyAt(d, 'ADR-001')
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 're-pull failed')
  const now = bodyAt(d, 'ADR-001')
  // A content hash behind on an open set: the decision now says something else — a warning.
  rep = pinned(`acme/docs#ADR-001@${oldBody}`)
  const w = rep.problems.find((p) => p.rule === 'decision-pin-behind')
  assert(w && w.level === 'warn' && w.msg.includes(`acme/docs#ADR-001@${now}`), `a stale @body: pin on an open set passed, or did not name the current value:\n${rep.raw}`)
  // The same pin on a finished set is history: a note.
  rep = pinned(`acme/docs#ADR-001@${oldBody}`, 'completed')
  assert(!pinProblems(rep).length && rep.notes.some((n) => /끝난 세트는 그때의 결정문 아래에서 끝났다/.test(n) && n.includes(now)),
    `a stale @body: pin turned a finished set red, or went unsaid:\n${rep.raw}`)
  // A SHA cannot tell a reworded file from a changed decision, so behind is a note on any set.
  for (const status of ['draft', 'completed']) {
    rep = pinned(`acme/docs#ADR-001@${oldSha}`, status)
    assert(!pinProblems(rep).length && rep.notes.some((n) => /SHA 는 파일의 어느 커밋에나 움직여/.test(n) && n.includes(`acme/docs#ADR-001@${now}`)),
      `a stale @sha pin on a ${status} set warned, or did not offer the @body: value:\n${rep.raw}`)
  }
  rep = pinned(`acme/docs#ADR-001@${now}`)
  assert(!pinProblems(rep).length, `a current @body: pin was questioned after the re-pull:\n${rep.raw}`)
  // A repository with no manifest is still asked for its SHA.
  rep = pinned('acme/other#ADR-009')
  assert(rep.problems.some((p) => p.rule === 'decision-pin-sha-missing'), `a pin into an unknown repository lost its SHA check:\n${rep.raw}`)
  // A third repository's pin is not read against the manifest, even when the manifest has the number:
  // with ADR-001 draft upstream, the status of acme/docs#ADR-001 must not be pinned on acme/other.
  put(adr, readFileSync(adr, 'utf8').replace('status: accepted', 'status: draft'))
  git(up, 'commit', '-qam', 'back to draft')
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 're-pull failed')
  rep = pinned('acme/other#ADR-001')
  assert(rep.problems.some((p) => p.rule === 'decision-pin-sha-missing') && !rep.problems.some((p) => p.rule === 'decision-pin-unaccepted'),
    `a pin into a third repository was read against the manifest of another:\n${rep.raw}`)
})

// Service-local decisions next to the code, organisation-wide ones in a document repository. Both
// keys were accepted, and everything past pull-adr then read only the local folder: the binding
// check never ran and an upstream pin was judged by its SHA's shape alone. The local ADR-001 and the
// upstream ADR-001 are different decisions on purpose — the two ID spaces overlap.
function dualConsumer() {
  const d = bindConsumer()
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 7\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\nrepo: "acme/contracts"\nadr_dir: "docs/adr"\nadr_repo: "acme/docs"\n`)
  put(join(d, 'src/local/store.ts'), 'export const store = 1 // test_LocalStore\n')
  put(join(d, 'docs/adr/ADR-001-local-store.md'), bindAdr('ADR-001', 'Local store', 'scope: ["src/local"]\nconfirms: ["test_LocalStore"]')
    .replace('Price at 1:1 on the first epoch.', 'Keep the store in process.'))
  assert(run(process.execPath, [tool('adr-index.mjs'), d]).code === 0, 'adr-index failed')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'local decision')
  return d
}
const dualPlan = (pins, prose = '') => `---
artifact: plan
schema_version: 7
status: draft
decisions: [${pins}]
---

# Plan
${prose}
## 작업

- [ ] **WP-001 — 첫 에포크 가격**
  - files: \`src/vault/Pool.sol\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 첫 에포크는 1:1 이다
  - verify: true

- [ ] **WP-002 — 로컬 저장**
  - files: \`src/local/store.ts\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 로컬에 저장한다
  - verify: true

- [ ] **WP-003 — 둘 다**
  - files: \`src/vault/Pool.sol\`, \`src/local/store.ts\`
  - depends: WP-001, WP-002
  - covers: FR-001 (AC-001)
  - tests: 둘 다 지킨다
  - verify: true
`

await test('a repository with its own ADRs and an upstream adr_repo checks both, each in its own ID space', () => {
  const up = bindUpstream(), d = dualConsumer()
  let r = run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up])
  assert(r.code === 0 && existsSync(join(d, '.claude/adr-manifest.json')), `pull-adr wanted adr_manifest spelled out next to adr_dir:\n${r.out}`)
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'pull decisions')

  r = run(process.execPath, [tool('check-all.mjs'), d], { env: { ...process.env, SDLC_UPSTREAM: up } })
  assert(/결정 기록 통과/.test(r.out) && /결정 바인딩 통과/.test(r.out) && r.code === 0, `check-all did not run both decision checks:\n${r.out}`)
  // A path a commit took away: one no commit ever had is a directory still to be written, a note.
  put(join(d, 'src/gone/x.sol'), 'contract X {}\n'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'gone soon')
  git(d, 'rm', '-rq', 'src/gone'); git(d, 'commit', '-qm', 'gone')
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD'), 'src/gone'))
  r = run(process.execPath, [tool('check-all.mjs'), d], { env: { ...process.env, SDLC_UPSTREAM: up } })
  assert(/결정 기록 통과/.test(r.out) && /결정 바인딩 실패/.test(r.out) && r.code !== 0, `a broken binding hid behind the local folder:\n${r.out}`)
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))

  const set = join(d, '.sdlc/specs/pool')
  const sha = git(up, 'rev-parse', 'HEAD').slice(0, 7)
  const planCheck = (pins, prose) => {
    put(join(set, 'plan.md'), dualPlan(pins, prose))
    const out = run(process.execPath, [tool('check-artifacts.mjs'), set, '--json']).out
    try { return { ...JSON.parse(out), raw: out } } catch { throw new Error(`check-artifacts did not print JSON:\n${out}`) }
  }
  const scopeWarn = (rep, re) => rep.problems.find((p) => p.level === 'warn' && re.test(p.msg))
  const upWarn = (rep) => scopeWarn(rep, /WP-001·WP-003 의 files 가 acme\/docs#ADR-001\(«Vault pricing»\) 의 바인딩 paths/)
  const localWarn = (rep) => scopeWarn(rep, /WP-002·WP-003 의 files 가 ADR-001\(«Local store»\) 의 scope/)

  let rep = planCheck('"acme/docs#ADR-999@abcdef1"')
  assert(rep.problems.some((p) => p.level === 'error' && /핀한 ADR-999 가 없다/.test(p.msg)), `a pin to a missing upstream decision passed on its SHA's shape:\n${rep.raw}`)

  rep = planCheck('')
  assert(/"acme\/docs#ADR-001@body:[0-9a-f]{12}"/.test(upWarn(rep)?.hint ?? ''), `a task on a bound upstream path went unpinned without the prefixed pin form:\n${rep.raw}`)
  assert(/decisions: \["ADR-001"\]/.test(localWarn(rep)?.hint ?? ''), `a task in a local ADR's scope went unpinned without the bare pin form:\n${rep.raw}`)

  rep = planCheck('"ADR-001"')
  assert(!localWarn(rep) && upWarn(rep), `a local ADR-001 pin stood in for the upstream ADR-001:\n${rep.raw}`)
  rep = planCheck(`"acme/docs#ADR-001@${sha}"`, '\nThis plan follows ADR-001.\n')
  assert(localWarn(rep) && !upWarn(rep), `an upstream ADR-001 pin stood in for the local ADR-001:\n${rep.raw}`)
  assert(rep.problems.some((p) => p.level === 'warn' && /본문이 ADR-001 를 부르는데/.test(p.msg) && /acme\/docs#ADR-001/.test(p.hint ?? '')),
    `a bare mention was satisfied by the upstream pin of the same number:\n${rep.raw}`)
  rep = planCheck(`"ADR-001", "acme/docs#ADR-001@${sha}"`, '\nThis plan follows ADR-001 and acme/docs#ADR-001.\n')
  // The plan is a bare fixture, so it has errors of its own; none may be about a decision.
  assert(!localWarn(rep) && !upWarn(rep) && !rep.problems.some((p) => /ADR-|본문이/.test(p.msg)), `both pins did not satisfy both decisions:\n${rep.raw}`)

  r = run(process.execPath, [tool('task-brief.mjs'), set, 'WP-003'])
  assert(/### ADR-001 — Local store\n\nKeep the store in process\./.test(r.out) && /### acme\/docs#ADR-001 — Vault pricing\n\nPrice at 1:1/.test(r.out),
    `the writer did not get both the local and the upstream decision:\n${r.out}`)

  // A superseded upstream decision, pulled honestly, is an error to pin — not a shape check.
  const adr2 = join(up, 'docs/adr/ADR-002-nav-freshness.md')
  put(adr2, readFileSync(adr2, 'utf8').replace('status: accepted', 'status: superseded').replace('superseded_by: null', 'superseded_by: "ADR-001"'))
  git(up, 'commit', '-qam', 'supersede')
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 're-pull failed')
  rep = planCheck(`"ADR-001", "acme/docs#ADR-001@${sha}", "acme/docs#ADR-002@${sha}"`)
  assert(rep.problems.some((p) => p.level === 'error' && /핀한 ADR-002 의 상태가 `superseded`/.test(p.msg)), `a pin to a superseded upstream decision passed:\n${rep.raw}`)
})

// A change that migrates to a successor has to say what it migrates from. Upstream the chain comes
// from the manifest's `superseded_by`, which every manifest pull-adr has written carries; and with
// two ID spaces a local pin of the same number must not stand in for the upstream successor.
await test('a set that pins the successor may name the upstream decision it replaced, within one ID space', () => {
  const up = bindUpstream()
  const adr2 = join(up, 'docs/adr/ADR-002-nav-freshness.md')
  put(adr2, readFileSync(adr2, 'utf8').replace('status: accepted', 'status: superseded').replace('superseded_by: null', 'superseded_by: "ADR-001"'))
  git(up, 'commit', '-qam', 'supersede')
  const sha = git(up, 'rev-parse', 'HEAD').slice(0, 7)
  const mentionWarn = (rep, re) => rep.problems.find((p) => p.level === 'warn' && /본문이 .* 를 부르는데/.test(p.msg) && re.test(p.msg))
  const check = (d, pins, prose) => {
    put(join(d, '.sdlc/specs/pool/plan.md'), dualPlan(pins, prose))
    const out = run(process.execPath, [tool('check-artifacts.mjs'), join(d, '.sdlc/specs/pool'), '--json']).out
    try { return { ...JSON.parse(out), raw: out } } catch { throw new Error(`check-artifacts did not print JSON:\n${out}`) }
  }

  const d = bindConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  const prose = '\nThe vault moves to ADR-001, which replaced ADR-002.\n'
  let rep = check(d, `"acme/docs#ADR-001@${sha}"`, prose)
  assert(!mentionWarn(rep, /ADR-002/), `naming the decision the pinned successor replaced still warned:\n${rep.raw}`)
  rep = check(d, '', prose)
  const w = mentionWarn(rep, /ADR-002/)
  assert(w && /ADR-002 는 ADR-001 가 대체했다/.test(w.hint ?? ''), `the warning did not name the upstream successor to pin:\n${rep.raw}`)

  // A manifest without `superseded_by` cannot excuse the mention; it does not fail to load either.
  const mpath = join(d, '.claude/adr-manifest.json')
  const m = JSON.parse(readFileSync(mpath, 'utf8'))
  put(mpath, JSON.stringify({ ...m, decisions: m.decisions.map(({ superseded_by, ...rest }) => rest) }, null, 2) + '\n')
  rep = check(d, `"acme/docs#ADR-001@${sha}"`, prose)
  assert(mentionWarn(rep, /ADR-002/) && !rep.problems.some((p) => /ADR-001/.test(p.msg) && p.level === 'error'),
    `a manifest with no superseded_by excused the mention, or stopped reading:\n${rep.raw}`)

  const dual = dualConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), dual, '--from', up]).code === 0, 'pull-adr failed')
  const upProse = '\nThe vault moves to acme/docs#ADR-001, which replaced acme/docs#ADR-002.\n'
  rep = check(dual, '"ADR-001"', upProse)
  assert(mentionWarn(rep, /acme\/docs#ADR-002/), `a local ADR-001 pin excused the upstream decision the upstream ADR-001 replaced:\n${rep.raw}`)
  rep = check(dual, `"ADR-001", "acme/docs#ADR-001@${sha}"`, upProse)
  assert(!rep.problems.some((p) => /본문이/.test(p.msg)), `the upstream successor pin did not excuse its predecessor in the dual layout:\n${rep.raw}`)
})

// A finished set is judged against the decisions in force when it closed, read from git: the edit
// that writes `completed` is checked with `completed` already in it, so «closed» alone would let a
// set close on top of a dead decision.
function closedRepo() {
  const d = temp('sdlc-closed-set')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 7\nspec_dir: ".sdlc/specs"\nadr_dir: "docs/adr"\n')
  put(join(d, 'src/a/x.ts'), 'export const x = 1\n')
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  return d
}
const closedPlan = (status, pins) => `---
artifact: plan
schema_version: 7
status: ${status}
decisions: [${pins}]
---

# Plan

## 작업

- [x] **WP-001 — 첫 변경**
  - files: \`src/a/x.ts\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 첫 변경이 된다
  - verify: true
`
const adrAt = (d, id, slug, status, extra = '') => {
  let text = bindAdr(id, slug, `scope: ["src/a"]\nconfirms: []${extra}`)
  if (status !== 'accepted') text = text.replace('status: accepted', `status: ${status}`)
  if (status === 'superseded') text = text.replace('superseded_by: null', 'superseded_by: "ADR-002"')
  put(join(d, `docs/adr/${id}-${slug}.md`), text)
}
const setCheck = (d) => {
  const r = run(process.execPath, [tool('check-artifacts.mjs'), join(d, '.sdlc/specs/s'), '--json'])
  try { return { ...JSON.parse(r.out), raw: r.out } } catch { throw new Error(`check-artifacts did not print JSON:\n${r.out}`) }
}
const pinError = (rep, id) => rep.problems.find((p) => p.level === 'error' && p.msg.includes(`핀한 ${id} 의 상태가`))

await test('a closed set keeps a pin to a decision superseded after it closed, and only that', () => {
  // Superseded after the set closed: history, so a note.
  let d = closedRepo()
  adrAt(d, 'ADR-001', 'store', 'accepted')
  put(join(d, '.sdlc/specs/s/plan.md'), closedPlan('completed', '"ADR-001"'))
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'close the set')
  adrAt(d, 'ADR-001', 'store', 'superseded')
  adrAt(d, 'ADR-002', 'store-again', 'accepted')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'supersede')
  let rep = setCheck(d)
  assert(!pinError(rep, 'ADR-001'), `a set closed under a live decision turned red when the decision was superseded later:\n${rep.raw}`)
  assert(rep.notes.some((n) => /끝난 세트가 핀한 ADR-001 는 .* `accepted` 였고 그 뒤 `superseded`/.test(n)), `the later supersession went unsaid:\n${rep.raw}`)

  // Closed on top of a decision already superseded: the error stands, and says why.
  d = closedRepo()
  adrAt(d, 'ADR-001', 'store', 'superseded')
  adrAt(d, 'ADR-002', 'store-again', 'accepted')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'supersede first')
  put(join(d, '.sdlc/specs/s/plan.md'), closedPlan('completed', '"ADR-001"'))
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'close the set on a dead decision')
  rep = setCheck(d)
  assert(/이미 `superseded` 였다/.test(pinError(rep, 'ADR-001')?.hint ?? ''), `a set closed on a dead decision passed as history:\n${rep.raw}`)

  // The closing edit itself, not yet committed — what the hook sees.
  d = closedRepo()
  adrAt(d, 'ADR-001', 'store', 'superseded')
  adrAt(d, 'ADR-002', 'store-again', 'accepted')
  put(join(d, '.sdlc/specs/s/plan.md'), closedPlan('in_progress', '"ADR-001"'))
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'open set')
  put(join(d, '.sdlc/specs/s/plan.md'), closedPlan('completed', '"ADR-001"'))
  rep = setCheck(d)
  assert(/커밋되지 않았거나/.test(pinError(rep, 'ADR-001')?.hint ?? ''), `writing completed let a dead pin through:\n${rep.raw}`)
})

await test('a closed plan is not asked to pin a decision accepted after it closed', () => {
  const scopeWarn = (rep) => rep.problems.some((p) => p.level === 'warn' && /의 files 가 ADR-003/.test(p.msg))
  let d = closedRepo()
  put(join(d, '.sdlc/specs/s/plan.md'), closedPlan('completed', ''))
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'close the set')
  adrAt(d, 'ADR-003', 'later', 'accepted')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'a decision after the plan')
  let rep = setCheck(d)
  assert(!scopeWarn(rep) && rep.notes.some((n) => /ADR-003 의 범위에 들지만.*없었다/.test(n)), `a finished plan was told to pin a decision that came after it:\n${rep.raw}`)

  d = closedRepo()
  adrAt(d, 'ADR-003', 'earlier', 'accepted')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'the decision first')
  put(join(d, '.sdlc/specs/s/plan.md'), closedPlan('completed', ''))
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'close the set')
  rep = setCheck(d)
  assert(scopeWarn(rep), `a plan that closed past a decision already in force was excused:\n${rep.raw}`)
})

// The history is read only when a verdict turns on it. A closed set whose pins are live and whose
// tasks meet no unpinned decision never reads it, and must be judged exactly as an open one.
await test('a closed set with only live pins is judged as an open one', () => {
  const d = closedRepo()
  adrAt(d, 'ADR-001', 'store', 'accepted')
  put(join(d, '.sdlc/specs/s/plan.md'), closedPlan('completed', '"ADR-001"'))
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'close the set')
  const closed = setCheck(d)
  put(join(d, '.sdlc/specs/s/plan.md'), closedPlan('in_progress', '"ADR-001"'))
  const open = setCheck(d)
  const adrSaid = (rep) => [...rep.notes, ...rep.problems.map((p) => p.msg)].filter((m) => /ADR-001/.test(m))
  assert(adrSaid(closed).length === 0 && adrSaid(open).length === 0, `a live pin drew a word:\n${closed.raw}\n${open.raw}`)
})

// check-all printed a child's output only on failure, so a passing check's notes never reached CI —
// a freshness check that did not run read as one that passed.
await test('check-all prints a passing binding check\'s note that freshness went unchecked', () => {
  const up = bindUpstream()
  // Nested two deep in a fresh directory: findUpstream also looks at ../docs and ../../docs, and
  // neither may exist here, or the freshness check would run and the note would never appear.
  const d = join(temp('sdlc-adr-nocheckout'), 'a', 'contracts')
  cpSync(bindConsumer(), d, { recursive: true })
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))
  const r = run(process.execPath, [tool('check-all.mjs'), d], { env: { ...process.env, SDLC_UPSTREAM: '' } })
  assert(r.code === 0, `check-all failed on a clean binding:\n${r.out}`)
  assert(/결정 바인딩 통과[^\n]*\n\s+· [^\n]*체크아웃이 없다/.test(r.out), `the unchecked freshness read as a plain pass:\n${r.out}`)
})

await test('check-all prints the note of a closed set whose pin was superseded after it closed', () => {
  const d = closedRepo()
  // check-all runs the ADR folder under --strict too, so the pair must be clean on its own:
  // a test to confirm and the supersession written on both sides.
  put(join(d, 'src/a/x.ts'), 'export const x = 1 // test_Store\n')
  const adr = (id, slug, status) => put(join(d, `docs/adr/${id}-${slug}.md`), bindAdr(id, slug, 'scope: ["src/a"]\nconfirms: ["test_Store"]')
    .replace('status: accepted', `status: ${status}`)
    .replace('superseded_by: null', id === 'ADR-001' && status === 'superseded' ? 'superseded_by: "ADR-002"' : 'superseded_by: null')
    .replace('supersedes: null', id === 'ADR-002' ? 'supersedes: "ADR-001"' : 'supersedes: null'))
  adr('ADR-001', 'store', 'accepted')
  // A rejected intent closes a set as a completed plan does, and the clean v7 fixture passes every
  // other check, so whatever check-all says here is the pin alone.
  const intent = readFileSync(join(ROOT, '..', 'skills/sdlc/create-intent/evals/cases/clean-intent-v7/docs/intent.md'), 'utf8')
    .replace('status: accepted', 'status: rejected\ndecisions: ["ADR-001"]')
  put(join(d, '.sdlc/specs/s/intent.md'), intent)
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'close the set')
  adr('ADR-001', 'store', 'superseded')
  adr('ADR-002', 'store-again', 'accepted')
  assert(run(process.execPath, [tool('adr-index.mjs'), d]).code === 0, 'adr-index failed')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'supersede')
  const r = run(process.execPath, [tool('check-all.mjs'), d])
  assert(r.code === 0, `a set closed under a live decision failed check-all:\n${r.out}`)
  assert(/통과  \.sdlc\/specs\/s\n(\s+· [^\n]*\n)*\s+· [^\n]*끝난 세트가 핀한 ADR-001/.test(r.out), `the closed-set note never reached check-all:\n${r.out}`)
  assert(!/산출물 schema v/.test(r.out), `the per-set schema line was repeated:\n${r.out}`)
})

// ── ADR lookups that need history or reach outside `scope` ───────────────────────────────────
function adrRepo({ init = true } = {}) {
  const d = temp('sdlc-adr-paths')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 7\nspec_dir: ".sdlc/specs"\nadr_dir: "docs/adr"\n')
  put(join(d, 'src/a/x.ts'), 'export const x = 1 // test_Store\n')
  if (init) { git(d, 'init', '-q'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval') }
  return d
}
const adrFolderCheck = (d) => {
  const r = run(process.execPath, [tool('check-artifacts.mjs'), join(d, 'docs/adr'), '--json'])
  try { return { ...JSON.parse(r.out), raw: r.out } } catch { throw new Error(`check-artifacts did not print JSON:\n${r.out}`) }
}
const ruled = (rep, rule) => rep.problems.filter((p) => p.rule === rule)

await test('a scope path no commit ever had is a note; one a commit took away, or one without history, warns', () => {
  // «ADR first»: the decision is accepted before the plan that creates its directory.
  const write = (d) => put(join(d, 'docs/adr/ADR-001-ledger.md'), bindAdr('ADR-001', 'ledger', 'scope: ["src/ledger"]\nconfirms: ["test_LedgerIsAppendOnly"]'))
  let d = adrRepo()
  write(d)
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'decide first')
  let rep = adrFolderCheck(d)
  assert(rep.counts.warnings === 0 && rep.counts.errors === 0, `a decision written before its code turned CI red:\n${rep.raw}`)
  assert(rep.notes.some((n) => /`scope` 의 `src\/ledger` 가 아직 없다.*confirms 찾기는 돌지 않았다/.test(n)), `the check that did not run went unsaid:\n${rep.raw}`)

  put(join(d, 'src/ledger/ledger.ts'), 'test_LedgerIsAppendOnly\n')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'the code')
  git(d, 'rm', '-rq', 'src/ledger'); git(d, 'commit', '-qm', 'delete it')
  rep = adrFolderCheck(d)
  const gone = ruled(rep, 'adr-scope-missing-path')
  assert(gone.length === 1 && /바뀌었거나 지워졌다/.test(gone[0].hint) && !/이력을 읽지 못해/.test(gone[0].hint), `a deleted scope path passed as not yet written:\n${rep.raw}`)

  // A shallow clone cannot tell «never» from «before the cut»; the warning stays and says why.
  const shallow = temp('sdlc-adr-shallow')
  git(shallow, 'clone', '-q', '--depth', '1', `file://${d}`, 'c')
  rep = adrFolderCheck(join(shallow, 'c'))
  assert(ruled(rep, 'adr-scope-missing-path').some((p) => /얕은 클론/.test(p.hint)), `a shallow clone read the missing path leniently:\n${rep.raw}`)

  d = adrRepo({ init: false })
  write(d)
  rep = adrFolderCheck(d)
  assert(ruled(rep, 'adr-scope-missing-path').some((p) => /git 이력을 읽지 못해\(git 저장소가 아니다\)/.test(p.hint)), `without history the path was not warned with the reason:\n${rep.raw}`)
})

await test('a binding to a path no commit ever had is a note', () => {
  const up = bindUpstream(), d = bindConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD'), 'src/ledger'))
  const rep = bindCheck(d, up)
  assert(rep.counts.warnings === 0 && rep.counts.errors === 0, `binding before the directory exists turned red:\n${rep.raw}`)
  assert(rep.notes.some((n) => /ADR-001 — `paths` 의 `src\/ledger` 가 아직 없다.*confirms 찾기는 돌지 않았다/.test(n)), `the unchecked binding went unsaid:\n${rep.raw}`)
})

await test('confirms_in finds a test outside scope and widens nothing else', () => {
  const d = adrRepo()
  put(join(d, 'src/vault/Pool.ts'), 'export class Pool {}\n')
  put(join(d, 'test/vault/Pool.test.ts'), 'test("test_FirstEpochAtPar", () => {})\n')
  const adr = (extra) => put(join(d, 'docs/adr/ADR-001-pool.md'), bindAdr('ADR-001', 'pool', `scope: ["src/vault"]\nconfirms: ["test_FirstEpochAtPar"]${extra}`))
  adr('')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')
  let rep = adrFolderCheck(d)
  assert(ruled(rep, 'adr-confirms-not-found').length === 1, `a test outside scope was found without confirms_in:\n${rep.raw}`)
  adr('\nconfirms_in: ["test/vault"]')
  rep = adrFolderCheck(d)
  assert(rep.counts.warnings === 0 && rep.counts.errors === 0, `confirms_in did not reach the test tree:\n${rep.raw}`)

  // A task on the test tree alone meets no decision: confirms_in is a lookup, not reach.
  const set = join(d, '.sdlc/specs/s')
  const planOn = (file) => put(join(set, 'plan.md'), closedPlan('draft', '').replace('src/a/x.ts', file))
  planOn('test/vault/Pool.test.ts')
  let r = run(process.execPath, [tool('check-artifacts.mjs'), set, '--json'])
  assert(!/의 files 가 ADR-001/.test(r.out), `confirms_in pulled a test-only task into the decision's scope:\n${r.out}`)
  r = run(process.execPath, [tool('task-brief.mjs'), set, 'WP-001'])
  assert(!/Price at 1:1/.test(r.out), `confirms_in injected the decision into a test-only task:\n${r.out}`)
  planOn('src/vault/Pool.ts')
  r = run(process.execPath, [tool('check-artifacts.mjs'), set, '--json'])
  assert(/의 files 가 ADR-001/.test(r.out), `the control task inside scope was not asked to pin:\n${r.out}`)
})

await test('a binding\'s confirms_in finds a test outside its paths', () => {
  const up = bindUpstream(), d = bindConsumer()
  git(d, 'mv', 'src/vault/Pool.t.sol', 'src/nav/Pool.t.sol'); git(d, 'commit', '-qm', 'tests elsewhere')
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  const yml = bindingsYml(git(up, 'rev-parse', 'HEAD'))
  put(join(d, '.claude/adr-bindings.yml'), yml)
  let rep = bindCheck(d, up)
  assert(said(rep, /«test_PoolPricesAtGenesis» 를 `paths` 안에서 못 찾았다/), `a test outside paths was found without confirms_in:\n${rep.raw}`)
  put(join(d, '.claude/adr-bindings.yml'), yml.replace('    confirms: ["test_PoolPricesAtGenesis"]\n', '    confirms: ["test_PoolPricesAtGenesis"]\n    confirms_in:\n      - "src/nav"\n'))
  rep = bindCheck(d, up)
  assert(rep.counts.warnings === 0 && rep.counts.errors === 0, `confirms_in in a binding did not reach the test:\n${rep.raw}`)
})

await test('a confirms search cut short by its budget says so instead of «not found»', () => {
  const d = adrRepo()
  for (let i = 0; i < 405; i++) put(join(d, `src/big/f${String(i).padStart(3, '0')}.ts`), `export const v${i} = ${i}\n`)
  put(join(d, 'docs/adr/ADR-001-big.md'), bindAdr('ADR-001', 'big', 'scope: ["src/big"]\nconfirms: ["test_Somewhere"]'))
  let rep = adrFolderCheck(d)
  assert(ruled(rep, 'adr-confirms-search-cut').length === 1 && !ruled(rep, 'adr-confirms-not-found').length, `a cut-short search read as a missing test:\n${rep.raw}`)
  put(join(d, 'test/big/t.ts'), 'test_Somewhere\n')
  put(join(d, 'docs/adr/ADR-001-big.md'), bindAdr('ADR-001', 'big', 'scope: ["src/big"]\nconfirms: ["test_Somewhere"]\nconfirms_in: ["test/big"]'))
  rep = adrFolderCheck(d)
  assert(rep.counts.warnings === 0, `a narrow confirms_in did not settle a broad scope:\n${rep.raw}`)
})

await test('a decision retired for a successor not in force warns, along the whole chain', () => {
  const d = adrRepo()
  const adr = (id, status, { by = null, sup = null } = {}) => put(join(d, `docs/adr/${id}-x${id.slice(-1)}.md`),
    bindAdr(id, `x${id.slice(-1)}`, 'scope: ["src/a"]\nconfirms: ["test_Store"]')
      .replace('status: accepted', `status: ${status}`)
      .replace('approved_by: "human"', status === 'draft' ? 'approved_by: null' : 'approved_by: "human"')
      .replace('superseded_by: null', `superseded_by: ${by ? `"${by}"` : 'null'}`)
      .replace('supersedes: null', `supersedes: ${sup ? `"${sup}"` : 'null'}`))
  const gap = (rep) => ruled(rep, 'adr-successor-not-in-force')

  adr('ADR-001', 'superseded', { by: 'ADR-002' }); adr('ADR-002', 'draft', { sup: 'ADR-001' })
  let rep = adrFolderCheck(d)
  assert(gap(rep).length === 1 && gap(rep)[0].doc === 'ADR-001-x1.md' && /ADR-002\(draft\)/.test(gap(rep)[0].msg) && /후속을 승인하고, 그다음 선행을/.test(gap(rep)[0].hint),
    `a decision retired for a draft passed:\n${rep.raw}`)

  adr('ADR-002', 'accepted', { sup: 'ADR-001' })
  rep = adrFolderCheck(d)
  assert(!gap(rep).length, `an accepted successor still warned:\n${rep.raw}`)

  adr('ADR-002', 'superseded', { sup: 'ADR-001', by: 'ADR-003' }); adr('ADR-003', 'accepted', { sup: 'ADR-002' })
  rep = adrFolderCheck(d)
  assert(!gap(rep).length, `a chain ending at an accepted decision warned:\n${rep.raw}`)

  adr('ADR-003', 'draft', { sup: 'ADR-002' })
  rep = adrFolderCheck(d)
  assert(gap(rep).length === 2 && gap(rep).some((p) => /ADR-002\(superseded\) → ADR-003\(draft\)/.test(p.msg)), `a chain ending at a draft passed:\n${rep.raw}`)

  rmSync(join(d, 'docs/adr/ADR-003-x3.md'))
  adr('ADR-002', 'superseded', { sup: 'ADR-001', by: 'ADR-001' })
  rep = adrFolderCheck(d)
  assert(gap(rep).some((p) => /순환/.test(p.msg)), `a supersede cycle was not reported:\n${rep.raw}`)
})

await test('a binding to a decision retired for a draft says no decision is in force', () => {
  const up = bindUpstream(), d = bindConsumer()
  const a1 = join(up, 'docs/adr/ADR-001-vault-pricing.md')
  put(a1, readFileSync(a1, 'utf8').replace('status: accepted', 'status: superseded').replace('superseded_by: null', 'superseded_by: "ADR-003"'))
  put(join(up, 'docs/adr/ADR-003-vault-pricing-v2.md'), bindAdr('ADR-003', 'Vault pricing v2', 'applies_to: ["acme/contracts"]\nscope: []\nconfirms: []')
    .replace('status: accepted', 'status: draft').replace('approved_by: "human"', 'approved_by: null').replace('supersedes: null', 'supersedes: "ADR-001"'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'retire early')
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))
  const rep = bindCheck(d, up)
  const dead = rep.problems.find((p) => p.rule === 'binding-dead' && /ADR-001/.test(p.msg))
  assert(dead && /ADR-003\(draft\)/.test(dead.hint) && /효력 있는 결정이 없다/.test(dead.hint), `the binding hint sent the reader to a draft as if it held:\n${rep.raw}`)
})

// ── A decision that changes under work already planned ───────────────────────────────────────
await test('adr-impact lists who pins, touches and mentions a decision, open sets apart from closed', () => {
  const d = closedRepo()
  adrAt(d, 'ADR-001', 'store', 'accepted')
  const plan = (dir, status, pins, file, prose = '') =>
    put(join(d, '.sdlc/specs', dir, 'plan.md'), closedPlan(status, pins).replace('src/a/x.ts', file).replace('# Plan\n', `# Plan\n${prose}`))
  plan('open', 'draft', '"ADR-001"', 'src/b/y.ts')
  plan('running', 'in_progress', '', 'src/a/x.ts')
  plan('done', 'completed', '"ADR-001"', 'src/a/x.ts')
  plan('talk', 'draft', '', 'src/c/z.ts', '\nThe store follows ADR-001.\n')
  const impact = (...a) => run(process.execPath, [tool('adr-impact.mjs'), d, ...a])
  const j = impact('ADR-001', '--json')
  assert(j.code === 0, `a report exited non-zero:\n${j.out}`)
  const rep = JSON.parse(j.out)
  const sets = (rows) => rows.map((r) => r.set).sort().join(',')
  assert(sets(rep.pinned.open) === '.sdlc/specs/open' && sets(rep.pinned.closed) === '.sdlc/specs/done', `pins were not split open from closed:\n${j.out}`)
  assert(rep.touching.length === 1 && rep.touching[0].set === '.sdlc/specs/running' && rep.touching[0].running && !rep.touching[0].pinned && rep.touching[0].tasks.join() === 'WP-001',
    `the running plan that touches the scope unpinned was not named, or a closed one was:\n${j.out}`)
  assert(sets(rep.mentioned) === '.sdlc/specs/talk', `a prose-only mention was missed, or a pinning set counted as one:\n${j.out}`)
  assert(rep.in_force === 'ADR-001' && rep.paths.join() === 'src/a', `the decision itself was misread:\n${j.out}`)
  const t = impact('ADR-001')
  assert(t.code === 0 && /핀한 세트 — 열린 것 \(1\)\n  \.sdlc\/specs\/open/.test(t.out) && /핀한 세트 — 닫힌 것 \(1\)\n  \.sdlc\/specs\/done/.test(t.out)
    && /범위를 만지는 열린 계획 \(1\)\n  \.sdlc\/specs\/running .*핀 없음/.test(t.out) && /본문에서만 부르는 세트 \(1\)\n  \.sdlc\/specs\/talk/.test(t.out)
    && /후속 ADR 을 먼저 승인하고/.test(t.out) && /닫힌 세트 1개는 이력이다/.test(t.out), `the text report did not match the JSON:\n${t.out}`)
  assert(impact('ADR-009').code === 2, 'an unknown ID read as a decision nothing depends on')
  assert(run(process.execPath, [tool('adr-impact.mjs'), temp('sdlc-no-profile'), 'ADR-001']).code === 2, 'a repository without a profile read as one with nothing to report')

  // After the retirement: the chain is followed to the decision in force, and the running plan is
  // still found, though `adrsForFiles` would no longer see a superseded decision.
  adrAt(d, 'ADR-001', 'store', 'superseded')
  adrAt(d, 'ADR-002', 'store-again', 'accepted')
  const after = JSON.parse(impact('ADR-001', '--json').out)
  assert(after.superseded_by.join() === 'ADR-002' && after.in_force === 'ADR-002' && after.touching.length === 1, `the report lost track once the decision was retired:\n${JSON.stringify(after)}`)
})

await test('adr-impact reads an upstream decision in a consumer with its binding', () => {
  const up = bindUpstream(), d = bindConsumer()
  assert(run(process.execPath, [tool('pull-adr.mjs'), d, '--from', up]).code === 0, 'pull-adr failed')
  put(join(d, '.claude/adr-bindings.yml'), bindingsYml(git(up, 'rev-parse', 'HEAD')))
  put(join(d, '.sdlc/specs/pool/plan.md'), dualPlan('"acme/docs#ADR-001"'))
  const r = run(process.execPath, [tool('adr-impact.mjs'), d, 'acme/docs#ADR-001', '--json'])
  assert(r.code === 0, r.out)
  const rep = JSON.parse(r.out)
  assert(rep.space === 'up' && rep.shown === 'acme/docs#ADR-001' && rep.paths.join() === 'src/vault', `the upstream decision was not read through its binding:\n${r.out}`)
  assert(rep.binding?.current === true && rep.binding.paths.join() === 'src/vault', `the binding was not reported:\n${r.out}`)
  assert(rep.pinned.open[0]?.set === '.sdlc/specs/pool' && rep.touching.some((t) => t.pinned && t.tasks.includes('WP-001') && t.tasks.includes('WP-003')), `the pinning plan was not found:\n${r.out}`)
  assert(run(process.execPath, [tool('adr-impact.mjs'), d, 'acme/docs#ADR-009']).code === 2, 'an upstream ID the manifest lacks was not refused')
})

/** A plan running under one decision, at a point where plan-resume would say `implement`. */
function resumeRepo(pins) {
  const d = temp('sdlc-resume-adr')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: .sdlc/specs\nadr_dir: docs/adr\nworktree_dir: .wt\ntask_branch: "task/{slug}-{task}"\nverify: true\n')
  put(join(d, '.gitignore'), '.wt/\n')
  put(join(d, 'src/a/x.ts'), 'export const x = 1 // test_Store\n')
  put(join(d, 'docs/adr/ADR-001-store.md'), bindAdr('ADR-001', 'store', 'scope: ["src/a"]\nconfirms: ["test_Store"]'))
  put(join(d, 'docs/adr/ADR-003-draft.md'), bindAdr('ADR-003', 'draft', 'scope: ["src/z"]\nconfirms: []').replace('status: accepted', 'status: draft').replace('approved_by: "human"', 'approved_by: null'))
  put(join(d, '.sdlc/specs/s/plan.md'), `---
artifact: plan
schema_version: 5
status: in_progress
decisions: [${pins}]
---

## 릴리스 영향

target_branch: feat/s
pr_strategy: 단일 PR

## 작업

- [ ] **WP-001 — 저장소를 고친다**
  - files: \`src/a/x.ts\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 저장된다
  - verify: true

## 실행 기록

해당 없음 — 아직 실행 전.
`)
  git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'plan born')
  git(d, 'switch', '-qc', 'feat/s')
  return d
}
const resume = (d) => {
  const r = run(process.execPath, [tool('plan-resume.mjs'), join(d, '.sdlc/specs/s'), '--json'])
  try { return { ...JSON.parse(r.out), raw: r.out } } catch { throw new Error(`plan-resume did not print JSON:\n${r.out}`) }
}
const brief = (d) => spawnSync(process.execPath, [tool('task-brief.mjs'), join(d, '.sdlc/specs/s'), 'WP-001'], { encoding: 'utf8' })

await test('plan-resume and task-brief stop on a pinned decision superseded mid-plan, and only on that', () => {
  const d = resumeRepo('"ADR-001"')
  let next = resume(d)
  assert(next.action === 'implement', `the fixture is not at an implement step:\n${next.raw}`)
  let b = brief(d)
  assert(b.status === 0 && /Price at 1:1 on the first epoch/.test(b.stdout), `a live pin changed the brief:\n${b.stdout}${b.stderr}`)

  put(join(d, 'docs/adr/ADR-001-store.md'), bindAdr('ADR-001', 'store', 'scope: ["src/a"]\nconfirms: ["test_Store"]').replace('status: accepted', 'status: superseded').replace('superseded_by: null', 'superseded_by: "ADR-002"'))
  put(join(d, 'docs/adr/ADR-002-store-again.md'), bindAdr('ADR-002', 'store-again', 'scope: ["src/a"]\nconfirms: ["test_Store"]').replace('supersedes: null', 'supersedes: "ADR-001"')
    .replace('Price at 1:1 on the first epoch.', 'Price at a premium.'))
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'supersede between levels')
  next = resume(d)
  assert(next.action === 'blocked' && /ADR-001/.test(next.reason) && /ADR-002/.test(next.reason) && /\/iterate-spec/.test(next.reason),
    `a plan pinned to a superseded decision resumed:\n${next.raw}`)
  b = brief(d)
  assert(b.status !== 0 && b.stdout === '' && /ADR-001/.test(b.stderr), `task-brief briefed a writer under the successor's text:\nstdout:${b.stdout}\nstderr:${b.stderr}`)

  // A warning — a pin to a decision still in draft — is reported by the checker, not by resume.
  const w = resumeRepo('"ADR-001", "ADR-003"')
  next = resume(w)
  assert(next.action === 'implement', `a warning-level pin stopped resume:\n${next.raw}`)
  assert(brief(w).status === 0, 'a warning-level pin stopped task-brief')
})

await test('Execution log ignores change-history task IDs in either language', async () => {
  const { SECTION, sectionBlock, RE_CHANGE_LOG } = await import('../tools/keywords.mjs')
  for (const heading of ['Change log', 'Changelog', '변경 기록']) {
    const body = `## EXECUTION LOG\nWP-001\n### ${heading}\nWP-002\n`
    const log = sectionBlock(SECTION.executionLog).exec(body)?.[0].replace(RE_CHANGE_LOG, '')
    assert(log?.includes('WP-001') && !log.includes('WP-002'), `history counted as execution: ${heading}`)
  }
})

await test('Machine diagnostics and gate warning counts do not depend on prose', () => {
  const d = temp('sdlc-json-diagnostics')
  const chain = join(d, 'docs/change')
  cpSync(join(findSkill('create-plan', HERE), 'evals/cases/clean-light/docs'), chain, { recursive: true })
  for (const name of ['check-artifacts.mjs', 'lint-prose.mjs']) {
    const r = run(process.execPath, [tool(name), chain, '--json'])
    const result = JSON.parse(r.out)
    assert(result.version === 1 && result.exitCode === r.code, r.out)
    assert(result.counts.errors === result.problems.filter((p) => p.level === 'error').length, r.out)
    const strict = run(process.execPath, [tool(name), chain, '--json', '--strict'])
    const strictResult = JSON.parse(strict.out)
    assert(strict.code === (strictResult.counts.errors || strictResult.counts.warnings ? 1 : 0), strict.out)
  }
  // Run the real gate against a fixture checker: only structured counts can identify this warning.
  const runtime = join(d, 'runtime')
  put(join(runtime, 'VERSION'), '5')
  put(join(runtime, 'tools/check-artifacts.mjs'), 'process.exit(0)')
  put(join(runtime, 'tools/lint-prose.mjs'), `console.log(JSON.stringify({version:1, counts:{errors:0,warnings:1}, problems:[{level:'warn',doc:'intent.md',msg:'English warning'}]}))`)
  put(join(d, '.claude/spec-profile.yml'), `spec_dir: docs\nsdlc_runtime: "${runtime}"\nlang: en\n`)
  const env = { ...process.env, CLAUDE_PROJECT_DIR: d, XDG_CACHE_HOME: join(d, 'cache') }
  const gate = () => run(tool('gate-artifacts.sh'), [join(chain, 'intent.md')], { env })
  const first = gate(), second = gate()
  assert(first.code === 0 && first.out.includes('English warning'), first.out)
  assert(second.code === 0 && second.out.includes('1건') && !second.out.includes('English warning'), second.out)
  put(join(runtime, 'tools/lint-prose.mjs'), `console.log('not JSON')`)
  assert(gate().code === 2, 'unreadable diagnostics silently passed')
})

const V7_INTENT = (schema, body) => `---
artifact: intent
schema_version: ${schema}
id: "CHG-2026-070"
title: "표기를 뗀다"
status: draft
tier: light
owner: "팀"
created: 2026-09-09
updated: 2026-09-09
generated_by: "claude-opus-5"
---

# Intent: 표기를 뗀다

## 문제

제목마다 붙은 표기를 사람이 읽는다.

## 목표 결과

### OUT-001 — 표기 없이도 검사된다 \`Should\`

표기를 떼도 빈 절은 걸린다.

## 비목표
${body}`

await test('an unmarked section is required at v7 while the same document keeps passing at v6', () => {
  const d = temp('sdlc-unmarked')
  const chain = join(d, 'docs')
  const check = () => run(process.execPath, [tool('check-artifacts.mjs'), chain])
  const intent = (schema, body) => put(join(chain, 'intent.md'), V7_INTENT(schema, body))

  intent(6, '')
  assert(check().code === 0, `v6 에서 표기 없는 빈 절이 오류가 됐다 — 새 규칙이 옛 산출물 세트에 소급했다:\n${check().out}`)

  intent(7, '')
  let r = check()
  assert(r.code !== 0 && r.out.includes('«비목표» 이 비어 있다'),
    `v7 에서 표기 없는 빈 절을 통과시켰다 — 표기가 없으면 안 보는 검사는 꺼진 것과 같다:\n${r.out}`)

  intent(7, '\n<여기에 안 하는 일을 적는다>\n')
  r = check()
  assert(r.code !== 0 && r.out.includes('placeholder 뿐이다'), `표기 없는 절의 미작성을 통과시켰다:\n${r.out}`)

  intent(7, '\n해당 없음 — 범위를 좁히지 않는다.\n')
  assert(check().code === 0, `v7 에서 근거 있는 «해당 없음» 이 막혔다:\n${check().out}`)

  intent(7, '\n해당 없음\n')
  r = check()
  assert(r.code !== 0 && r.out.includes('근거가 없다'), `표기 없는 절의 근거 없는 «해당 없음» 을 통과시켰다:\n${r.out}`)
})

await test('a marker-free document below v7 says its section checks are off instead of passing quietly', () => {
  const d = temp('sdlc-marker-gap')
  const chain = join(d, 'docs')
  const check = () => run(process.execPath, [tool('check-artifacts.mjs'), chain])
  const NA = '\n해당 없음 — 범위를 좁히지 않는다.\n'
  const GAP = '절 표기가 하나도 없다'

  put(join(chain, 'intent.md'), V7_INTENT(6, NA))
  let r = check()
  assert(r.code === 0, `표기가 없다는 이유로 옛 문서를 막았다 — 손으로 쓴 문서는 경고 대상이지 차단 대상이 아니다:\n${r.out}`)
  assert(r.out.includes(GAP), `v7 템플릿으로 쓰고 v6 로 커밋한 문서가 조용히 통과했다 — 절 검사가 통째로 꺼져 있다:\n${r.out}`)
  assert(/sdlc_version/.test(r.out), `무엇을 올려야 하는지 말하지 않았다:\n${r.out}`)

  put(join(chain, 'intent.md'), V7_INTENT(7, NA))
  assert(!check().out.includes(GAP), `v7 에서도 경고가 남았다 — 검사가 켜진 문서를 꺼진 것처럼 말한다:\n${check().out}`)

  // 표기를 단 v6 문서는 그대로 검사받는다. 여기까지 경고가 번지면 옛 산출물 세트가 매번 시끄러워진다.
  put(join(chain, 'intent.md'), V7_INTENT(6, NA).replace(/^## (.+)$/gm, '## $1 `[필수 · 모든 티어]`'))
  r = check()
  assert(r.code === 0 && !r.out.includes(GAP), `표기가 있는 v6 문서까지 경고했다:\n${r.out}`)
})

await test('a body pin survives an approval, breaks on a body change, and is refused below v7', async () => {
  const { bodyPin } = await import('../tools/artifact-parse.mjs')
  const d = temp('sdlc-bodypin')
  const chain = join(d, 'docs')
  const intentPath = join(chain, 'intent.md')
  const check = () => run(process.execPath, [tool('check-artifacts.mjs'), chain])
  const spec = (schema, pin) => put(join(chain, 'spec.md'), `---
artifact: spec
schema_version: ${schema}
id: "SPEC-2026-070"
title: "표기를 뗀다"
status: draft
tier: light
owner: "팀"
created: 2026-09-09
updated: 2026-09-09
intent: "./intent.md"
intent_version: "${pin}"
generated_by: "claude-opus-5"
---

# Spec: 표기를 뗀다

## 범위

상위 intent: [CHG-2026-070](./intent.md)

## 요구사항

### FR-001 — 표기 없이도 검사된다 \`Should\`

근거: OUT-001

빈 절은 표기 없이도 걸린다.
`)

  put(intentPath, V7_INTENT(7, '\n해당 없음 — 범위를 좁히지 않는다.\n'))
  const pin = bodyPin(readFileSync(intentPath, 'utf8'))
  assert(/^body:[0-9a-f]{12}$/.test(pin), pin)
  spec(7, pin)
  assert(check().code === 0, `한 커밋에서 태어난 산출물 세트가 본문 해시로도 실패한다:\n${check().out}`)

  // 승인은 프런트매터만 바꾼다 — 상류 본문이 그대로인데 핀이 깨지면 아무도 핀을 안 쓴다.
  put(intentPath, readFileSync(intentPath, 'utf8')
    .replace('status: draft', 'status: accepted')
    .replace('generated_by:', 'approved_by: "한지우"\ngenerated_by:'))
  assert(check().code === 0, `상류 승인이 본문 해시 핀을 깨뜨렸다:\n${check().out}`)

  put(intentPath, readFileSync(intentPath, 'utf8')
    .replace('제목마다 붙은 표기를 사람이 읽는다.', '제목마다 붙은 표기를 기계만 읽는다.'))
  const drifted = check()
  assert(drifted.code !== 0 && drifted.out.includes('현재 본문과 다르다'), `상류 본문 변경을 놓쳤다:\n${drifted.out}`)
  assert(drifted.out.includes('pin.mjs'), `고치는 명령을 말하지 않았다:\n${drifted.out}`)

  put(intentPath, V7_INTENT(6, '\n해당 없음 — 범위를 좁히지 않는다.\n'))
  spec(6, pin)
  const old = check()
  assert(old.code !== 0 && old.out.includes('커밋 SHA 도 날짜도 아니다'),
    `v6 에서 본문 해시를 받아들였다 — 옛 런타임은 이 값을 조용히 잘못 읽는다:\n${old.out}`)
  assert(/schema 7/.test(old.out), `무엇이 모자란지 말하지 않았다:\n${old.out}`)
})

await test('pin.mjs prints the value the checker compares and refuses a file without frontmatter', async () => {
  const { bodyPin } = await import('../tools/artifact-parse.mjs')
  const d = temp('sdlc-pin')
  const doc = join(d, 'intent.md')
  put(doc, '---\nartifact: intent\nid: "CHG-2026-070"\n---\n\n본문.\n')
  const r = run(process.execPath, [tool('pin.mjs'), doc])
  assert(r.code === 0 && r.out.trim() === bodyPin(readFileSync(doc, 'utf8')),
    `검사기가 대조하는 값과 다른 값을 찍었다: ${r.out.trim()} != ${bodyPin(readFileSync(doc, 'utf8'))}`)

  put(join(d, 'plain.md'), '프런트매터가 없다.\n')
  const bad = run(process.execPath, [tool('pin.mjs'), join(d, 'plain.md')])
  assert(bad.code === 2 && bad.out.trim().split('\n').length === 1, `산출물이 아닌 파일에 핀을 찍어 줬다:\n${bad.out}`)
  assert(run(process.execPath, [tool('pin.mjs'), join(d, 'missing.md')]).code === 2, '없는 파일에 핀을 찍어 줬다')
})

await test('bilingual documents keep the same heading shape so a section cannot vanish in translation', () => {
  const shape = (file) => {
    const out = []
    let fence = false
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*```/.test(line)) { fence = !fence; continue }
      if (fence) continue
      const m = /^(#{2,3})\s/.exec(line)
      if (m) out.push(m[1])
    }
    return out
  }
  const REPO = resolve(ROOT, '..')
  for (const [a, b] of [[join(REPO, 'README.md'), join(REPO, 'README.ko.md')],
                        [join(ROOT, 'conventions.md'), join(ROOT, 'conventions.ko.md')]]) {
    const left = shape(a), right = shape(b)
    assert(left.length === right.length && left.every((v, i) => v === right[i]),
      `${basename(a)} 와 ${basename(b)} 의 절 구성이 어긋난다 (${left.length}개 vs ${right.length}개):\n  ${basename(a)}  ${left.join(' ')}\n  ${basename(b)}  ${right.join(' ')}`)
  }
})


// v7 의 트림된 템플릿이 남긴 절만 가진 산출물 세트. §범위·§입력과 범위·§완료 정의·§열린 질문·§실행
// 기록이 모두 빠져 있고, 아래 세 케이스가 같은 문서를 쓴다 — 템플릿에서 뺀 절 하나가 사실은 필수였다면
// 셋이 함께 빨개진다. 계약 낱말은 두 언어를 다 받으므로 프로필 lang 과 무관하게 이 한 벌을 쓴다.
const TRIM_INTENT = `---
artifact: intent
schema_version: 7
id: "CHG-2026-071"
title: "검색에서 보관 문서를 뺀다"
status: accepted
tier: light
owner: "검색팀"
approved_by: "한지우"
generated_by: "claude-opus-5"
---

# Intent: 검색에서 보관 문서를 뺀다

## 문제

운영자가 이미 보관 처리한 문서를 검색 결과에서 계속 만난다. 눈으로 걸러내느라 검색이 느려진다.

## 목표 결과

### OUT-001 — 기본 검색에 보관 문서가 안 뜬다 \`Must\`

운영자가 검색하면 보관되지 않은 문서만 결과에 선다.

확인: 보관 문서와 일반 문서를 하나씩 만들고 둘 다 걸리는 낱말로 검색한다.

## 비목표

- 보관 정책 자체는 바꾸지 않는다.

## 제약

### CON-001 — 검색 API 응답 형태를 바꾸지 않는다

다른 소비자가 이미 붙어 있다. 형태를 바꾸면 그쪽이 조용히 깨진다.
`

const TRIM_SPEC = (pin) => `---
artifact: spec
schema_version: 7
id: "SPEC-2026-071"
title: "보관 문서 검색 제외"
status: accepted
tier: light
owner: "검색팀"
intent: "./intent.md"
intent_version: "${pin}"
approved_by: "한지우"
generated_by: "claude-opus-5"
---

# Spec: 보관 문서 검색 제외

## 요구사항

### FR-001 — 기본 검색은 보관 문서를 뺀다 \`Must\`

근거: OUT-001

검색 질의는 별도 지시가 없으면 보관된 문서를 결과에서 제외한다.

수용 기준:

- [ ] AC-001 — 보관 문서와 일반 문서가 함께 걸리는 질의에서 일반 문서만 반환된다

## 오류와 경계

### EDGE-001 — 결과가 전부 보관 문서라 빈 결과가 된다

빈 결과를 그대로 낸다. 사용자에게: 보관 포함을 켜 볼 수 있다고 알린다. 복구: 자동
`

const TRIM_PLAN = (pin, status) => `---
artifact: plan
schema_version: 7
id: "PLAN-2026-071"
title: "보관 문서 검색 제외 구현"
status: ${status}
tier: light
owner: "검색팀"
intent: "./intent.md"
spec: "./spec.md"
spec_version: "${pin}"
approved_by: "한지우"
generated_by: "claude-opus-5"
---

# Plan: 보관 문서 검색 제외 구현

## 도달 상태와 변경 지점

검색 질의 조립부가 기본 필터에 «보관 아님» 을 더한다. 응답 형태는 그대로다.

- \`search/query.ts\` — 기본 필터에 보관 제외를 더한다 (FR-001)

## 릴리스 영향

target_branch: main
pr_strategy: 단일 PR
되돌리기: revert PR 한 장 — 데이터를 쓰지 않는다
마지막 롤백 리허설: 미실시 — 되돌리기가 순수 코드 revert 라 리허설 대상이 아니다
걸리는 게이트: 없음

## 작업

- [ ] **WP-001 — 기본 필터에 보관 제외를 더한다**
  - files: \`search/query.ts\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 보관 문서와 일반 문서가 함께 걸리는 질의에서 일반 문서만 반환된다
  - verify: echo ok

## 위험

### RISK-001 — 보관 필드가 빈 옛 문서가 함께 걸러진다

가능성 중 · 영향 중
조기 신호: 검색 결과 건수가 배포 직후 급감
대응: 필드가 없으면 «보관 아님» 으로 읽는다.
`

/** Write the trimmed v7 chain into a temporary repository, pinning each document to its upstream body. */
async function trimmedChain(prefix, { lang = 'ko', status = 'accepted' } = {}) {
  const { bodyPin } = await import('../tools/artifact-parse.mjs')
  const d = temp(prefix)
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 7\nspec_dir: .sdlc/specs\nlang: ${lang}\nverify: echo ok\n`)
  const dir = join(d, '.sdlc/specs/2026-09-10-log')
  put(join(dir, 'intent.md'), TRIM_INTENT)
  const spec = TRIM_SPEC(bodyPin(TRIM_INTENT))
  put(join(dir, 'spec.md'), spec)
  put(join(dir, 'plan.md'), TRIM_PLAN(bodyPin(spec), status))
  put(join(d, 'search/query.ts'), 'export const archived = false\n')
  return { d, dir, plan: join(dir, 'plan.md') }
}
const checked = (dir) => JSON.parse(run(process.execPath, [tool('check-artifacts.mjs'), dir, '--json']).out)

await test('a v7 plan from the trimmed template needs no boilerplate sections to pass', async () => {
  // 템플릿에서 뺀 절이 사실은 검사기가 요구하던 절이었다면, 새 템플릿으로 쓴 첫 문서가 첫 검사에서
  // 빨개진다 — 그 자리를 여기서 먼저 밟는다. 경고까지 0 이어야 한다: 새 템플릿이 경고를 기본값으로
  // 만들면 아무도 경고를 안 읽는다.
  const { dir } = await trimmedChain('sdlc-trimmed')
  const got = checked(dir)
  assert(got.counts.errors === 0 && got.counts.warnings === 0,
    `트림된 템플릿으로 쓴 산출물 세트가 깨끗하지 않다:\n${JSON.stringify(got.problems, null, 2)}`)
})

await test('mark creates the execution log section when the plan has none', async () => {
  // v7 템플릿은 §실행 기록을 싣지 않는다 — 실행 전에는 «해당 없음» 한 줄뿐인, 도구가 채울 때까지 빈
  // 절이었다. 절이 없으면 mark 가 죽던 자리이므로 도구가 절을 만드는지 보고, 만든 절을 검사기가 읽는지도
  // 같이 본다. 제목이 SECTION.executionLog 의 별칭에서 벗어나면 `completed` 규칙과 long-log 린터가 이
  // 절을 못 찾고, 꺼진 검사는 통과한 검사와 구별되지 않는다.
  const start = async (lang) => {
    const c = await trimmedChain(`sdlc-mklog-${lang}`, { lang, status: 'in_progress' })
    assert(!/^##\s*(?:실행 기록|Execution log)/mi.test(readFileSync(c.plan, 'utf8')),
      '준비한 계획서에 이미 §실행 기록이 있다 — 이 케이스가 볼 것이 없다')
    git(c.d, 'init', '-q'); git(c.d, 'config', 'user.email', 'eval@local'); git(c.d, 'config', 'user.name', 'eval')
    git(c.d, 'add', '.claude', '.sdlc'); git(c.d, 'commit', '-qm', 'chain born')
    git(c.d, 'add', 'search/query.ts')
    git(c.d, 'commit', '-qm', 'feat: 보관 제외', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: .sdlc/specs/2026-09-10-log/plan.md')
    const v = run(process.execPath, [tool('verify-run.mjs'), c.dir, '--level', '1', '--tasks', 'WP-001', '--', 'echo ok'])
    assert(v.code === 0, v.out)
    return c
  }

  const ko = await start('ko')
  let r = run(process.execPath, [tool('plan-check.mjs'), ko.dir, 'mark', 'WP-001', '--note', '없음'])
  assert(r.code === 0, `§실행 기록이 없는 계획서에서 mark 가 죽었다:\n${r.out}`)
  let text = readFileSync(ko.plan, 'utf8')
  assert(/^## 실행 기록$/m.test(text), `절을 안 만들었다:\n${text.slice(-400)}`)
  assert(/^- \d{4}-\d{2}-\d{2} WP-001 — 완료 · PR 없음 · 계획과의 차이: 없음$/m.test(text),
    `만든 절에 항목이 없다:\n${text.slice(-400)}`)

  // 검사기가 방금 만든 절을 읽는지는 `completed` 규칙이 답한다 — 못 읽으면 «실행 기록이 없는 작업» 이 된다.
  put(ko.plan, text.replace('status: in_progress', 'status: completed'))
  const got = checked(ko.dir)
  assert(got.counts.errors === 0,
    `도구가 만든 절을 검사기가 못 읽었다:\n${JSON.stringify(got.problems, null, 2)}`)

  const en = await start('en')
  r = run(process.execPath, [tool('plan-check.mjs'), en.dir, 'mark', 'WP-001', '--note', 'none'])
  assert(r.code === 0, r.out)
  text = readFileSync(en.plan, 'utf8')
  assert(/^## Execution log$/m.test(text), `프로필 언어의 제목을 안 썼다:\n${text.slice(-400)}`)
  assert(/^- \d{4}-\d{2}-\d{2} WP-001 — done · no PR · differs from plan: none$/m.test(text),
    `영문 프로필에서 항목이 어긋났다:\n${text.slice(-400)}`)
})

await test('acceptance criteria are derived from the plan and never written into spec.md', async () => {
  // spec.md 의 `- [ ] AC-…` 는 아무 도구도 켜 주지 않았고 켤 수도 없다 — v7 은 spec 본문을 plan 의
  // spec_version 에 바이트 단위로 핀하고, 승인 가드는 accepted 문서의 본문 편집을 막는다. 그래서 답은
  // plan 의 체크에서 파생한다. 세 가지를 본다: 파생 결과가 맞는지, spec.md 가 한 바이트도 안 바뀌어
  // 핀이 살아 있는지, 손으로 켠 spec 의 박스가 증거로 읽히지 않고 경고로 드러나는지.
  const c = await trimmedChain('sdlc-ac-derived', { status: 'in_progress' })
  git(c.d, 'init', '-q'); git(c.d, 'config', 'user.email', 'eval@local'); git(c.d, 'config', 'user.name', 'eval')
  git(c.d, 'add', '.claude', '.sdlc'); git(c.d, 'commit', '-qm', 'chain born')
  const specPath = join(c.dir, 'spec.md')
  const specBefore = readFileSync(specPath, 'utf8')

  const progress = () => JSON.parse(run(process.execPath, [tool('plan-progress.mjs'), c.dir, '--json']).out)
  let ac = progress().acceptance
  assert(Array.isArray(ac) && ac.length === 1 && ac[0].id === 'AC-001', `수용 기준을 못 읽었다: ${JSON.stringify(ac)}`)
  assert(ac[0].covered_by.join() === 'WP-001', `covers 를 못 읽었다: ${JSON.stringify(ac[0])}`)
  assert(ac[0].done === false, '아무것도 안 했는데 충족으로 읽었다')

  git(c.d, 'add', 'search/query.ts')
  git(c.d, 'commit', '-qm', 'feat: 보관 제외', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: .sdlc/specs/2026-09-10-log/plan.md')
  let r = run(process.execPath, [tool('verify-run.mjs'), c.dir, '--level', '1', '--tasks', 'WP-001', '--', 'echo ok'])
  assert(r.code === 0, r.out)
  r = run(process.execPath, [tool('plan-check.mjs'), c.dir, 'mark', 'WP-001', '--note', '없음'])
  assert(r.code === 0, r.out)
  assert(/수용 기준 충족: AC-001/.test(r.out), `mark 가 충족된 기준을 말하지 않았다:\n${r.out}`)

  ac = progress().acceptance
  assert(ac[0].done === true, `덮는 작업이 끝났는데 충족으로 읽지 않았다: ${JSON.stringify(ac[0])}`)
  assert(readFileSync(specPath, 'utf8') === specBefore, 'spec.md 가 바뀌었다 — 핀이 깨진다')
  assert(checked(c.dir).counts.errors === 0, 'mark 뒤 산출물 검사가 빨개졌다')
  const text = run(process.execPath, [tool('plan-progress.mjs'), c.dir]).out
  assert(/수용 기준 1\/1/.test(text) && /\[x\] AC-001\s+← WP-001/.test(text), `텍스트 출력에 파생 결과가 없다:\n${text}`)

  // A box ticked by hand in spec.md is a claim, not evidence. Untick the plan and tick the spec.
  put(c.plan, readFileSync(c.plan, 'utf8').replace('- [x] **WP-001', '- [ ] **WP-001'))
  put(specPath, specBefore.replace('- [ ] AC-001', '- [x] AC-001'))
  const got = progress()
  assert(got.acceptance[0].done === false && got.acceptance[0].claimed === true, JSON.stringify(got.acceptance[0]))
  assert(got.notes.some((n) => n.id === 'AC-001' && /손으로 체크/.test(n.msg)), `손으로 켠 박스를 경고하지 않았다:\n${JSON.stringify(got.notes)}`)

  // A criterion that no task covers must read as uncovered, not as merely open.
  put(specPath, specBefore.replace(/\n- \[ \] AC-001 — ([^\n]*)/, '\n- [ ] AC-001 — $1\n- [ ] AC-002 — 아무도 짓지 않는 기준'))
  const orphan = progress()
  const a2 = orphan.acceptance.find((a) => a.id === 'AC-002')
  assert(a2 && a2.covered_by.length === 0 && a2.done === false, JSON.stringify(orphan.acceptance))
  assert(orphan.notes.some((n) => n.id === 'AC-002' && /covers 에도 없다/.test(n.msg)), `덮는 작업 없는 기준을 경고하지 않았다:\n${JSON.stringify(orphan.notes)}`)
})

await test('a criterion of a requirement that is not Must may be left uncovered without failing plan-progress', async () => {
  // check-artifacts 는 Must 의 기준에만 덮는 작업을 요구하는데 plan-progress 는 모든 기준을 경고했고,
  // check-all 은 plan-progress 를 --strict 로 돌린다. 그러면 Could 하나 미뤄 둔 세트가 CI 에서 떨어지고
  // 우선순위는 아무 뜻이 없어진다. 두 도구가 같은 답을 내는지, 그리고 Must 는 여전히 걸리는지 본다.
  const { bodyPin } = await import('../tools/artifact-parse.mjs')
  const c = await trimmedChain('sdlc-ac-deferred')
  const specPath = join(c.dir, 'spec.md')
  const repin = (spec) => {
    put(specPath, spec)
    put(c.plan, readFileSync(c.plan, 'utf8').replace(/^spec_version: ".*"$/m, `spec_version: "${bodyPin(spec)}"`))
  }
  const could = readFileSync(specPath, 'utf8').replace('## 오류와 경계',
    '### FR-002 — 보관 포함 플래그 `Could`\n\n근거: OUT-001\n\n플래그가 켜지면 보관 문서도 결과에 넣는다.\n\n수용 기준:\n\n- [ ] AC-002 — 플래그가 켜지면 보관 문서와 일반 문서가 모두 반환된다\n\n## 오류와 경계')
  repin(could)
  const progress = (...a) => run(process.execPath, [tool('plan-progress.mjs'), c.dir, ...a])
  assert(checked(c.dir).counts.errors === 0, `Could 를 미룬 세트를 check-artifacts 가 막았다:\n${JSON.stringify(checked(c.dir).problems, null, 2)}`)
  let r = progress('--strict')
  assert(r.code === 0, `Could 를 미뤘는데 plan-progress --strict 가 실패했다:\n${r.out}`)
  assert(/AC-002\s+FR-002 이 Must 가 아니다 \(Could\) — 미뤘다/.test(r.out), `미룬 기준을 이유와 함께 말하지 않았다:\n${r.out}`)
  assert(/수용 기준 0\/1/.test(r.out) && /이 계획 몫이 아닌 기준 1개/.test(r.out), `미룬 기준을 분모에 넣었다:\n${r.out}`)
  const json = JSON.parse(progress('--json').out)
  const a2 = json.acceptance.find((a) => a.id === 'AC-002')
  assert(a2.owed === false && a2.reason === 'deferred' && a2.priority === 'Could' && Array.isArray(a2.covered_by),
    `JSON 이 미룬 기준을 가르지 않았다: ${JSON.stringify(a2)}`)
  assert(json.notes.some((n) => n.id === 'AC-002' && n.level === 'info'), JSON.stringify(json.notes))

  // No priority is not deferral: the spec never said FR-002 may wait, so its uncovered criterion
  // still warns and still counts. check-artifacts requires coverage only for Must and stays clean.
  repin(could.replace('### FR-002 — 보관 포함 플래그 `Could`', '### FR-002 — 보관 포함 플래그'))
  assert(checked(c.dir).counts.errors === 0, `우선순위 없는 요구사항을 check-artifacts 가 막았다:\n${JSON.stringify(checked(c.dir).problems, null, 2)}`)
  r = progress('--strict')
  assert(r.code === 1 && /⚠ AC-002\s+어느 작업의 covers 에도 없다/.test(r.out) && /수용 기준 0\/2/.test(r.out),
    `우선순위가 없는 것을 미룬 것으로 읽었다:\n${r.out}`)
  const bare = JSON.parse(progress('--json').out).acceptance.find((a) => a.id === 'AC-002')
  assert(bare.owed === true && bare.reason === 'unprioritised', JSON.stringify(bare))

  // The Must requirement's own criterion, left uncovered, still fails exactly as before.
  repin(could.replace(/(\n- \[ \] AC-001 — [^\n]*)/, '$1\n- [ ] AC-003 — 보관 필드가 없는 문서는 결과에 그대로 남는다'))
  r = progress('--strict')
  assert(r.code === 1 && /⚠ AC-003\s+어느 작업의 covers 에도 없다/.test(r.out), `덮이지 않은 Must 기준을 놓쳤다:\n${r.out}`)
})

await test('frontmatter without created and updated passes at every version', () => {
  // git 이 이미 쥔 두 날짜를 손으로 옮겨 적던 칸이라 뺐다. 모든 버전에서 푸는 완화여야 한다 — v7 에서만
  // 통과하면 옛 산출물 세트를 건드릴 때마다 두 줄을 도로 적어 넣게 된다.
  const bare = (schema) => {
    const doc = V7_INTENT(schema, '\n해당 없음 — 범위를 좁히지 않는다.\n')
      .replace(/^created:.*\nupdated:.*\n/m, '')
    return schema >= 7 ? doc : doc.replace(/^## (.+)$/gm, '## $1 `[필수 · 모든 티어]`')
  }
  for (const schema of [5, 7]) {
    const chain = join(temp(`sdlc-nodate-${schema}`), 'docs')
    put(join(chain, 'intent.md'), bare(schema))
    const got = checked(chain)
    const shown = JSON.stringify(got.problems, null, 2)
    assert(got.counts.errors === 0, `v${schema} 에서 created·updated 없는 프런트매터를 막았다:\n${shown}`)
    assert(!/created|updated/.test(shown), `없앤 키를 여전히 요구한다:\n${shown}`)
  }
})


// 조사(research)는 산출물 세트 밖에 살고 승인도 티어도 없다. 그래서 이 문서가 지키는 것은 «인용할 수
// 있는가» 뿐이고, 아래 케이스들은 전부 그 한 줄을 밟는다 — 출처가 어디를 가리키는지, 선택지가 어느
// 출처에 걸렸는지, 표가 기준과 선택지를 모두 덮는지, 그리고 다른 문서의 인용이 실제로 대조되는지.
const RESEARCH_MD = `---
artifact: research
schema_version: 7
id: "RSH-2026-001"
title: "작업 큐 라이브러리 비교"
status: reviewed
question: "작업 큐를 무엇으로 세울지 정하려고 두 라이브러리를 비교한다"
owner: "검색팀"
generated_by: "claude-opus-5"
reviewed_by: "박검토"
---

# Research: 작업 큐 라이브러리 비교

## 질문

작업 큐를 무엇으로 세울지 정한다. 이 문서를 읽는 것은 그 결정을 적을 ADR 이다.

## 기준

### CRIT-001 — 재시도 정책이 코드에 남는다

실패한 작업을 몇 번 어떻게 다시 세우는지가 설정이 아니라 코드에 있어야 한다.

### CRIT-002 — 새로 세울 서버가 없다

당직이 늘면 이 변경의 값이 달라진다.

## 출처

### SRC-001 — A 라이브러리 재시도 문서

- at: https://example.com/a/retry
- retrieved: 2026-09-01

지수 백오프가 기본이고 재시도 횟수를 코드에서 정한다고 적혀 있다.

### SRC-002 — B 라이브러리 배포 안내

- at: https://example.com/b/deploy
- retrieved: 2026-09-02

브로커 한 대를 따로 세워야 한다고 적혀 있다.

## 선택지

### OPT-001 — A 라이브러리를 쓴다

- 근거: SRC-001

프로세스 안에서 돌고 저장소는 이미 쓰는 것을 그대로 쓴다.

### OPT-002 — B 라이브러리를 쓴다

- 근거: SRC-002

브로커를 따로 세우고 그 위에서 큐를 굴린다.

## 비교

| 기준 | OPT-001 | OPT-002 |
|---|---|---|
| CRIT-001 | 코드에서 정한다 (SRC-001) | 설정 파일에서 정한다 (SRC-002) |
| CRIT-002 | 없다 | 브로커 한 대 (SRC-002) |

## 판단

### REC-001 — 지금 규모에서는 A 라이브러리다

- 근거: OPT-001

사실은 SRC-001 이 적은 재시도 방식이고, 추론은 당직이 늘지 않는다는 것이며, 가정은 하루 작업량이 지금보다 열 배 늘지 않는다는 것이다.
`

/** 프로필 하나와 조사 하나가 있는 레포를 세운다. 조사는 언제나 `<spec_dir>/research/` 밑이다. */
function researchRepo(prefix, body = RESEARCH_MD) {
  const d = temp(prefix)
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 7\nspec_dir: ".sdlc/specs"\n')
  const dir = join(d, '.sdlc/specs/research/RSH-2026-001-queue')
  put(join(dir, 'research.md'), body)
  return { d, dir }
}
const linted = (dir) => JSON.parse(run(process.execPath, [tool('lint-prose.mjs'), dir, '--json']).out)

await test('a research document with sourced options, a full comparison and a cited judgement passes', () => {
  const { dir } = researchRepo('sdlc-research')
  const got = checked(dir)
  assert(got.counts.errors === 0 && got.counts.warnings === 0,
    `근거를 갖춘 조사 문서가 깨끗하지 않다:\n${JSON.stringify(got.problems, null, 2)}`)
  const prose = linted(dir)
  assert(prose.counts.errors === 0 && prose.counts.warnings === 0,
    `린터가 조사 문서를 걸었다:\n${JSON.stringify(prose.problems, null, 2)}`)
})

await test('an unsourced option, an undated source and a comparison missing a criterion are each an error', () => {
  const cases = [
    ['근거 없는 선택지', (s) => s.replace('- 근거: SRC-002\n\n', ''), 'OPT-002'],
    ['조회 날짜 없는 출처', (s) => s.replace('- retrieved: 2026-09-02\n', ''), 'SRC-002'],
    ['비교표가 빠뜨린 기준', (s) => s.replace(/\| CRIT-002 \|[^\n]*\n/, ''), 'CRIT-002'],
  ]
  for (const [label, seed, id] of cases) {
    const { dir } = researchRepo('sdlc-research-bad', seed(RESEARCH_MD))
    const got = checked(dir)
    const shown = JSON.stringify(got.problems, null, 2)
    assert(got.counts.errors === 1, `${label}: 오류가 ${got.counts.errors}건이다 (기대 1건):\n${shown}`)
    assert(got.problems[0].msg.includes(id), `${label}: 어느 항목인지 말하지 않는다:\n${shown}`)
  }
})

await test('a chain document may cite research by id and item, and a dangling citation is an error', () => {
  const { d } = researchRepo('sdlc-research-cite')
  const chain = join(d, '.sdlc/specs/2026-09-10-queue')
  const cite = (text) => {
    put(join(chain, 'intent.md'), V7_INTENT(7, `\n해당 없음 — ${text}\n`))
    return checked(chain)
  }

  let got = cite('재시도 정책은 RSH-2026-001/SRC-002 가 적은 대로 따른다.')
  assert(got.counts.errors === 0, `있는 조사와 항목을 부르는 인용을 막았다:\n${JSON.stringify(got.problems, null, 2)}`)

  got = cite('재시도 정책은 RSH-2026-001/SRC-009 가 적은 대로 따른다.')
  assert(got.counts.errors === 1 && got.problems[0].msg.includes('SRC-009'),
    `없는 항목을 가리키는 인용을 통과시켰다:\n${JSON.stringify(got.problems, null, 2)}`)

  got = cite('재시도 정책은 RSH-2026-009 가 적은 대로 따른다.')
  assert(got.counts.errors === 1 && got.problems[0].msg.includes('RSH-2026-009'),
    `없는 조사 문서를 부르는 인용을 통과시켰다:\n${JSON.stringify(got.problems, null, 2)}`)

  // 프로필이 없으면 조사 문서가 어디 사는지 모른다. 조용히 넘기면 «대조했고 맞았다» 와 구분되지 않는다.
  const lone = join(temp('sdlc-research-noprofile'), 'docs')
  put(join(lone, 'intent.md'), V7_INTENT(7, '\n해당 없음 — RSH-2026-001/SRC-002 가 적은 범위만 본다.\n'))
  got = checked(lone)
  assert(got.counts.errors === 0, `프로필이 없다고 인용을 오류로 만들었다:\n${JSON.stringify(got.problems, null, 2)}`)
  assert(got.notes.some((n) => n.includes('RSH-*') && n.includes('대조하지 못했다')),
    `대조하지 못했다는 사실을 말하지 않았다 — 안 본 인용이 통과한 인용처럼 보인다:\n${JSON.stringify(got.notes)}`)
})

await test('the comparison table in a research document is not an entity table', () => {
  const { dir } = researchRepo('sdlc-research-table')
  const prose = linted(dir)
  assert(!prose.problems.some((p) => p.rule === 'entity-table'),
    `기준 × 선택지 표를 «항목을 행으로 접었다» 로 걸었다 — 이 규칙이 막는 것은 목록을 표로 접는 일이다:\n${JSON.stringify(prose.problems, null, 2)}`)

  // 예외가 조사 문서에만 걸리는지 본다. 규칙 자체가 꺼졌으면 이 대조군이 통과해 버린다.
  const chain = join(temp('sdlc-research-table-control'), 'docs')
  put(join(chain, 'intent.md'), V7_INTENT(7, '\n| 항목 | 내용 |\n|---|---|\n| OUT-002 | 표로 접은 항목 |\n'))
  assert(linted(chain).problems.some((p) => p.rule === 'entity-table'),
    'intent 의 ID 첫 열 표를 더는 걸지 않는다 — 예외가 규칙을 통째로 껐다')
})

// 조사가 담는 자료 — 도식·발췌·수치표 — 는 문장 예산 밖이어야 한다. 예산이 자료까지 세면 모델은
// 도식을 «A 가 B 를 부른다» 한 줄로 접고, 그 접힘이 이 산출물을 만든 이유를 지운다. 반대로 펜스 밖
// 산문은 여전히 재야 한다 — 그렇지 않으면 «펜스는 예산 밖» 이 «예산이 꺼졌다» 와 구분되지 않는다.
await test('fenced material in a research document is outside every budget, prose is not', () => {
  const diagram = '```mermaid\nsequenceDiagram\n' +
    Array.from({ length: 60 }, (_, k) => `  Worker->>Broker: OPT-001 이 재시도 ${k} 를 코드에서 정한다`).join('\n') + '\n```\n'
  const withFence = RESEARCH_MD.replace('지수 백오프가 기본이고 재시도 횟수를 코드에서 정한다고 적혀 있다.\n',
    '지수 백오프가 기본이고 재시도 횟수를 코드에서 정한다고 적혀 있다.\n\n' + diagram)
  let { dir } = researchRepo('sdlc-research-fence', withFence)
  let prose = linted(dir)
  assert(prose.counts.errors === 0 && prose.counts.warnings === 0,
    `펜스 안 도식을 문장 예산으로 쟀다:\n${JSON.stringify(prose.problems, null, 2)}`)
  let got = checked(dir)
  assert(got.counts.errors === 0 && got.counts.warnings === 0,
    `펜스 안의 OPT-001 을 정의나 인용으로 읽었다:\n${JSON.stringify(got.problems, null, 2)}`)

  // 같은 분량을 펜스 밖 산문으로 두면 걸려야 한다. 이 대조군이 없으면 위 통과는 예산이 꺼진 것과 같다.
  const paragraph = Array.from({ length: 16 }, (_, k) => `재시도 ${k} 번째는 지수 백오프로 기다린 뒤 같은 인자로 다시 부른다고 적혀 있다.`).join(' ')
  ;({ dir } = researchRepo('sdlc-research-fence-control', RESEARCH_MD.replace(
    '지수 백오프가 기본이고 재시도 횟수를 코드에서 정한다고 적혀 있다.', paragraph)))
  prose = linted(dir)
  assert(prose.problems.some((p) => p.rule === 'too-long' && p.msg.includes('SRC-001')),
    `펜스 밖 긴 산문을 예산 초과로 걸지 않았다 — 예산이 꺼졌다:\n${JSON.stringify(prose.problems, null, 2)}`)
})

await test('a data table with options as columns is not mistaken for the comparison table', () => {
  const data = '## 자료\n\n| 잰 것 | OPT-001 | OPT-002 | 출처 |\n|---|---:|---:|---|\n| 초당 처리량 (건) | 1200 | 3400 | SRC-001 |\n\n'
  const { dir } = researchRepo('sdlc-research-data', RESEARCH_MD.replace('## 비교\n', data + '## 비교\n'))
  const got = checked(dir)
  assert(got.counts.errors === 0 && got.counts.warnings === 0,
    `비교표 앞에 선 수치표를 비교표로 읽었다:\n${JSON.stringify(got.problems, null, 2)}`)
  const prose = linted(dir)
  assert(prose.counts.errors === 0 && prose.counts.warnings === 0,
    `수치표를 린터가 걸었다:\n${JSON.stringify(prose.problems, null, 2)}`)

  // 비교표를 빼면 오류는 남아야 한다. CRIT 가 선 표가 없으면 검사기는 남은 OPT 표로 물러나 기준마다
  // 하나씩 짚는다 — 예외가 비교표 검사를 통째로 끄지 않았는지 보는 대조군이다.
  const noCompare = RESEARCH_MD.replace(/## 비교\n[\s\S]*?(?=## 판단)/, data)
  const missing = checked(researchRepo('sdlc-research-data-only', noCompare).dir)
  assert(missing.counts.errors === 2 && missing.problems.every((p) => /CRIT-00[12]/.test(p.msg)),
    `비교표 없는 조사를 통과시켰다 — 수치표 예외가 비교표 검사를 껐다:\n${JSON.stringify(missing.problems, null, 2)}`)
})

await test('research is evidence, not a decision: the guard does not ask on reviewed', () => {
  const d = temp('sdlc-research-guard')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 7\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\n`)
  const research = join(d, '.sdlc/specs/research/RSH-2026-001-queue/research.md')
  put(research, RESEARCH_MD.replace('status: reviewed', 'status: in_review').replace('reviewed_by: "박검토"', 'reviewed_by: null'))
  const env = { ...process.env, CLAUDE_PROJECT_DIR: d }
  const invoke = (payload) => run(tool('guard-approval.sh'), [], { env, input: JSON.stringify(payload) })
  const asks = (r) => (r.out ?? '').includes('"permissionDecision":"ask"')

  const r = invoke({ tool_name: 'Edit', tool_input: {
    file_path: research,
    old_string: 'status: in_review\n',
    new_string: 'status: reviewed\n',
  } })
  assert(r.code === 0 && !asks(r), `조사의 \`reviewed\` 를 승인 전이로 물었다 — 읽었다는 기록은 승인이 아니다:\n${r.out}`)

  const r2 = invoke({ tool_name: 'Write', tool_input: {
    file_path: research, content: 'status: reviewed\nreviewed_by: "박검토"\n',
  } })
  assert(r2.code === 0 && !asks(r2), `\`reviewed_by\` 를 적었다고 승인으로 읽었다:\n${r2.out}`)

  // 이 레포에서 가드가 켜져 있는지 대조군으로 확인한다 — 안 그러면 위 두 줄은 «가드가 안 도는 레포» 를
  // 증명한 것이 된다.
  const intent = join(d, '.sdlc/specs/2026-09-10-queue/intent.md')
  put(intent, '---\nartifact: intent\nstatus: in_review\napproved_by: null\n---\n\n초안\n')
  assert(asks(invoke({ tool_name: 'Write', tool_input: { file_path: intent, content: 'status: accepted\napproved_by: "agent"' } })),
    '대조군인 intent 승인도 안 물었다 — 이 레포에서는 가드가 아예 돌지 않는다')
})

await test('the gate checks a research document as it is saved', () => {
  // CI 에서만 걸리는 종류가 하나라도 있으면 «쓰는 동안 검증한다» 가 그 종류에서만 조용히 꺼진다.
  const { d, dir } = researchRepo('sdlc-research-gate')
  const gate = (name) => spawnSync(tool('gate-artifacts.sh'), [], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { file_path: join(dir, name) } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: d, SDLC_RUNTIME: ROOT, XDG_CACHE_HOME: join(d, 'cache') },
  })

  let r = gate('research.md')
  assert(r.status === 0, `깨끗한 조사 문서에서 게이트가 실패했다 (code ${r.status})\n${r.stdout}\n${r.stderr}`)

  put(join(dir, 'research.md'), RESEARCH_MD.replace('- retrieved: 2026-09-02\n', ''))
  r = gate('research.md')
  assert(r.status === 2 && (r.stderr ?? '').includes('SRC-002'),
    `조사 문서를 저장하는 자리에서 결함을 안 잡았다 — 이 종류만 CI 에서야 걸린다 (code ${r.status}):\n${r.stdout}\n${r.stderr}`)
})

await test('check-all walks research directories', () => {
  const { d, dir } = researchRepo('sdlc-research-all')
  let r = run(process.execPath, [tool('check-all.mjs'), d])
  assert(r.code === 0, `조사 폴더만 있는 레포에서 실패했다:\n${r.out}`)
  assert(/통과\s+.*RSH-2026-001-queue/.test(r.out), `조사 폴더를 걷지 않았다 — 아무도 안 보는 문서를 다른 문서가 인용한다:\n${r.out}`)

  put(join(dir, 'research.md'), RESEARCH_MD.replace('- retrieved: 2026-09-02\n', ''))
  r = run(process.execPath, [tool('check-all.mjs'), d])
  assert(r.code !== 0 && r.out.includes('SRC-002'), `조사의 결함을 check-all 이 흘려보냈다:\n${r.out}`)
})


console.log('\n런타임 스모크 평가\n')
for (const r of results) {
  console.log(`  ${r.ok ? '통과' : '✗ 실패'}  ${r.name}`)
  if (r.error) console.log(`        ${r.error}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 통과 · 규칙 대조 — 검사 보고서 ${audited.reports}개 · 지적 ${audited.problems}건\n`)
// Zero reports read would mean the parser stopped matching the report format, not that every report
// was clean — a check that is off must not look like one that passed.
if (!audited.reports) console.log('규칙 대조가 검사 보고서를 하나도 읽지 못했다 — 미검사다. 통과가 아니다.\n')
if (audited.drift.length) console.log(`규칙 등록부와 어긋난 지적 ${audited.drift.length}건:\n  ${audited.drift.join('\n  ')}\n`)
process.exit(failed || !audited.reports || audited.drift.length ? 1 : 0)
