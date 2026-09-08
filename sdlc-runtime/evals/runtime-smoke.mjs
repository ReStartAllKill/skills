#!/usr/bin/env node
/** 검사기 바깥의 런타임 배관을 검증한다: 진행 귀속, 완료 게이트, 승인 가드,
 *  훅 설치, check-all 연결, 벤더 드리프트. 외부 상태를 건드리지 않고 임시 레포만 쓴다. */
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
import { findSkill } from './skills.mjs'
const tool = (name) => join(ROOT, 'tools', name)
const results = []

function run(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
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
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }) }
  catch (e) { results.push({ name, ok: false, error: e.message }) }
}
function assert(value, message) { if (!value) throw new Error(message) }

test('plan-progress는 trailer로 WP 커밋을 귀속한다', () => {
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

test('verify-run은 출력과 종료 코드를 남기고 plan-progress가 tests 문장과 verify 기록을 대조한다', () => {
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

  // 기록 없음 + tests 문장 하나 없음 → 둘 다 경고
  let r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  let got = JSON.parse(r.out)
  let row = got.rows.find((x) => x.id === 'WP-001')
  assert(row.tests.missing.length === 1 && row.tests.missing[0].includes('질의가 비면'), `tests 대조가 틀렸다: ${JSON.stringify(row.tests)}`)
  assert(got.notes.some((n) => n.msg.includes('tests 문장')), 'tests 문장 누락을 경고하지 않는다')
  assert(got.notes.some((n) => n.msg.includes('verify 기록이 없다')), 'verify 기록 부재를 경고하지 않는다')

  // 실패한 verify 는 종료 코드를 그대로 내고 기록에 exit 가 남는다 — 통과로 세지 않는다
  r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', 'echo boom; exit 3'])
  assert(r.code === 3, `실패 종료 코드를 삼켰다 (${r.code})`)
  const logs = () => readdirSync(join(d, '.sdlc/verify/2026-09-05-v'))
  assert(logs().length === 1 && readFileSync(join(d, '.sdlc/verify/2026-09-05-v', logs()[0]), 'utf8').includes('exit: 3'), '실패 로그가 없거나 exit 가 안 남았다')
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  assert(JSON.parse(r.out).rows[0].verified.length === 0, '실패한 verify 를 검증으로 셌다')

  put(join(d, 'src/a.test.js'), "test('보관 문서가 함께 걸리면 일반 문서만 반환된다', () => {})\ntest('질의가 비면 빈 목록을 반환한다', () => {})\n")
  // 통과한 verify + 테스트 이름을 맞추면 경고가 사라진다
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

test('plan-levels·task-worktree·task-brief가 레벨·배관·프롬프트를 결정론으로 낸다', () => {
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

  // 레벨 — 검사기와 같은 함수. WP-003 은 둘에 의존하니 레벨 2. 레벨 1 은 둘이라 parallel.
  let r = run(process.execPath, [tool('plan-levels.mjs'), spec, '--json'])
  assert(r.code === 0, r.out)
  const lv = JSON.parse(r.out)
  assert(lv.levels.length === 2 && lv.levels[0].mode === 'parallel' && lv.levels[1].mode === 'main', JSON.stringify(lv.levels.map((l) => [l.n, l.mode])))
  assert(lv.next === 1 && lv.target_branch === 'feat/tw', `next/target_branch 가 틀렸다: ${lv.next} ${lv.target_branch}`)

  // 프롬프트 — AC 문장 전문과 걸리는 규칙만 실린다
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
  // 기본 템플릿은 런타임 references 의 것 — 자리표시자가 하나도 안 남아야 한다
  r = run(process.execPath, [tool('task-brief.mjs'), spec, 'WP-001', '--worktree', '.wt/x'])
  assert(r.code === 0 && !/\{[a-z_]+\}/.test(r.out) && !r.out.includes('채우지 못한 자리') && r.out.includes('커밋하지 마라'), `기본 템플릿이 안 채워졌다:\n${r.out.slice(0, 400)}`)

  // 배관 — add 는 target_branch 에서 분기하고 bootstrap 을 돌린다
  const twt = (...a) => run(process.execPath, [tool('task-worktree.mjs'), spec, ...a])
  r = twt('add', 'WP-001')
  assert(r.code === 0 && existsSync(join(d, '.wt/2026-09-05-tw-WP-001/.bootstrapped')), `add 실패:\n${r.out}`)
  assert(git(d, 'branch', '--list', 'task/2026-09-05-tw-WP-001').trim() !== '', '작업 브랜치가 없다')
  // commit 은 files 만 싣고 trailer 를 붙인다 — 스코프 밖 파일은 경고만
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
  // merge 는 하나씩, remove 는 워크트리와 브랜치를 치운다
  r = twt('merge', 'WP-001')
  assert(r.code === 0 && git(d, 'log', '-1', '--format=%B').includes('SDLC-Task: WP-001'), `merge 실패:\n${r.out}`)
  r = twt('remove', 'WP-001')
  assert(r.code === 2 && r.out.includes('stray.js'), `남은 스코프 밖 변경을 조용히 버렸다:\n${r.out}`)
  r = twt('remove', 'WP-001', '--force')
  assert(r.code === 0 && !existsSync(wt) && git(d, 'branch', '--list', 'task/2026-09-05-tw-WP-001').trim() === '', `remove 실패:\n${r.out}`)
  // plan-progress 가 그 커밋을 WP-001 에 귀속한다
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  assert(JSON.parse(r.out).rows.find((x) => x.id === 'WP-001').commits.length === 1, '합류된 커밋이 귀속되지 않았다')
  // 충돌은 되돌리고 멈춘다
  twt('add', 'WP-002'); put(join(d, '.wt/2026-09-05-tw-WP-002/src/api/filter.js'), 'export const f = 2\n'); put(join(d, '.wt/2026-09-05-tw-WP-002/src/core/empty.js'), 'x\n')
  git(join(d, '.wt/2026-09-05-tw-WP-002'), 'add', '-A'); git(join(d, '.wt/2026-09-05-tw-WP-002'), 'commit', '-qm', 'conflict')
  put(join(d, 'src/api/filter.js'), 'export const f = 3\n'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'main moved')
  r = twt('merge', 'WP-002')
  assert(r.code === 2 && r.out.includes('충돌') && r.out.includes('src/api/filter.js'), `충돌을 되돌리지 않았다:\n${r.out}`)
  assert(git(d, 'status', '--porcelain', '--untracked-files=no') === '', '충돌 뒤 메인 트리가 더럽다')
})

test('completed는 열린 작업을 거부한다', () => {
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

test('승인 가드는 자기승인과 accepted 본문 변경을 막는다', () => {
  const d = temp('sdlc-guard')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 4\nsdlc_runtime: "${ROOT}"\nspec_dir: ".claude/specs"\n`)
  const intent = join(d, '.claude/specs/change/intent.md')
  put(intent, '---\nartifact: intent\nstatus: in_review\napproved_by: null\n---\n\n초안\n')
  const env = { ...process.env, CLAUDE_PROJECT_DIR: d }
  const invoke = (payload) => run(tool('guard-approval.sh'), [], { env, input: JSON.stringify(payload) })
  let r = invoke({ tool_name: 'Write', tool_input: { file_path: intent, content: 'status: draft\napproved_by: null' } })
  assert(r.code === 0, '정상 draft Write를 과잉 차단했다')
  /** 문서 편집은 이제 **승인 요청**이 된다 — 사람이 다이얼로그에서 답하므로 판단은
   *  여전히 사람이 하고, 승인 명령을 손으로 칠 필요는 없다. Bash 우회는 그대로 차단이다:
   *  거기에는 사람이 확인할 편집 내용이 없고, 셸 한 줄은 다이얼로그로 보여줄 것이 못 된다. */
  const asks = (r) => (r.out ?? '').includes('"permissionDecision":"ask"')

  r = invoke({ tool_name: 'Write', tool_input: { file_path: intent, content: 'status: accepted\napproved_by: "agent"' } })
  assert(asks(r), 'Write 자기승인을 사람에게 안 물어본다')
  r = invoke({ tool_name: 'Bash', tool_input: { command: `sed -i '' 's/status: .*/status: accepted/' '${intent}'` } })
  assert(r.code === 2, 'Bash 자기승인을 막지 못했다')
  put(intent, '---\nartifact: intent\nstatus: accepted\napproved_by: "human"\n---\n\n승인된 의미\n')
  r = invoke({ tool_name: 'Edit', tool_input: { file_path: intent, old_string: '승인된 의미', new_string: '바뀐 의미' } })
  assert(asks(r), 'accepted 본문 변경을 상태 하향 없이 조용히 허용했다')

  // 자율 실행에는 물어볼 사람이 없다 — 거기서는 차단이어야 한다.
  r = run(tool('guard-approval.sh'), [], {
    env: { ...env, SDLC_AUTONOMY_ROUTE: 'triage' },
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: intent, content: 'status: accepted\napproved_by: "agent"' } }),
  })
  assert(r.code === 2, '자율 실행이 자기 문서를 승인할 수 있다')
})

test('훅 설치는 멱등이고 Bash 승인 가드를 등록한다', () => {
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

test('게이트는 경고가 하나도 없는 문서에서도 조용히 통과한다', () => {
  /** «다 통과» 경로가 가장 늦게 발견되는 자리다. 캐시 변수를 경고 갈래 안에서만 정하면
   *  경고 0건인 문서에서 `set -u` 로 죽는데, 그 실패는 문서가 깨끗해진 뒤에야 나온다. */
  const d = temp('sdlc-gate-clean')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: ".sdlc/specs"\n')
  const chain = join(d, '.sdlc/specs/change')
  cpSync(join(findSkill('create-plan', HERE), 'evals/cases/clean-light/docs'), chain, { recursive: true })

  const r = spawnSync(tool('gate-artifacts.sh'), [], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { file_path: join(chain, 'intent.md') } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: d },
  })
  assert(r.status === 0, `깨끗한 사슬에서 게이트가 실패했다 (code ${r.status})\n${r.stdout}\n${r.stderr}`)
  assert(!/unbound|command not found/.test(r.stderr ?? ''), `게이트가 셸 오류를 냈다:\n${r.stderr}`)
})

test('shim 은 플러그인이 두 모양 중 어디에 있어도 런타임을 찾는다', () => {
  /** 플러그인은 `skills/<name>/`(제자리 로드)에도 `plugins/cache/`(설치본)에도 산다.
   *  shim 이 한쪽만 훑으면 다른 설치 방식에서 훅이 **조용히 꺼진다** — 종료코드 0 에 출력이
   *  없어 통과와 구분되지 않는다. 그래서 모양마다 실제로 exec 되는지 본다. */
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

test('check-all은 plan-progress 실패를 CI 실패로 올린다', () => {
  const d = temp('sdlc-check-all')
  const fake = join(d, '.runtime/tools')
  for (const name of ['check-artifacts.mjs', 'lint-prose.mjs']) put(join(fake, name), '#!/usr/bin/env node\nprocess.exit(0)\n')
  put(join(fake, 'plan-progress.mjs'), '#!/usr/bin/env node\nconsole.error("progress sentinel")\nprocess.exit(1)\n')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: ".claude/specs"\nsdlc_runtime: ".runtime"\n')
  put(join(d, '.claude/specs/change/plan.md'), '---\nartifact: plan\nschema_version: 4\n---\n')
  const r = run(process.execPath, [tool('check-all.mjs'), d])
  assert(r.code !== 0 && r.out.includes('progress sentinel'), r.out)
})

test('벤더 검사는 같은 버전의 내용 드리프트도 잡는다', () => {
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

test('마이그레이션은 프로필만 안전하게 런타임 버전으로 올린다', () => {
  const d = temp('sdlc-migrate')
  const profile = join(d, '.claude/spec-profile.yml')
  put(profile, 'sdlc_version: 3\nspec_dir: ".claude/specs"\n')
  let r = run(process.execPath, [tool('migrate-schema.mjs'), d])
  assert(r.code === 0 && r.out.includes('v4 작업 귀속·완료 증거'), r.out)
  r = run(process.execPath, [tool('migrate-schema.mjs'), d, '--profile'])
  // **목표 버전을 박지 않는다.** 박으면 런타임이 오른 날부터 이 테스트만 빨갛게 남는데,
  // 도구가 아니라 테스트가 낡은 빨강은 아무도 안 고치고 배경이 된다.
  const cur = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()
  assert(r.code === 0 && new RegExp(`^sdlc_version: ${cur}$`, 'm').test(readFileSync(profile, 'utf8')), r.out)
})

test('마이그레이션은 실행 이력이 있는 v3 plan을 자동 승격하지 않는다', () => {
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

test('migrate-schema는 프로필만 올리고 깨지는 사슬은 건너뛴다', () => {
  const d = temp('sdlc-migrate')
  const cur = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\n')

  // 승인자 없이 accepted 인 v1 사슬 — 올리면 v3 승인 규칙에 걸린다.
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

  // 1) 보고만 — 아무것도 안 바꾼다
  let r = run('node', [tool('migrate-schema.mjs'), d])
  assert(r.code === 0, r.out)
  assert(r.out.includes('프로필 없음'), r.out)
  assert(!readFileSync(join(d, '.claude/spec-profile.yml'), 'utf8').includes('sdlc_version'),
    '보고만 하는데 프로필을 바꿨다')

  // 2) --profile 은 새 사슬에만 영향하므로 안전하다
  r = run('node', [tool('migrate-schema.mjs'), d, '--profile'])
  assert(r.code === 0, r.out)
  assert(readFileSync(join(d, '.claude/spec-profile.yml'), 'utf8').includes(`sdlc_version: ${cur}`), r.out)

  // 3) --chains 는 깨지는 사슬을 건너뛴다 — 소급 적용이 옛 계약을 부수면 안 된다
  r = run('node', [tool('migrate-schema.mjs'), d, '--chains'])
  assert(r.code === 0, r.out)
  assert(r.out.includes('건너뜀'), r.out)
  assert(!readFileSync(join(chain, 'intent.md'), 'utf8').includes('schema_version'),
    '깨지는 사슬을 올려버렸다')

  // 4) 프로필이 런타임보다 높으면 내리지 않는다 — 낡은 것은 런타임 쪽이다
  writeFileSync(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 99\nspec_dir: .claude/specs\n')
  r = run('node', [tool('migrate-schema.mjs'), d, '--profile'])
  assert(r.code !== 0 && r.out.includes('런타임보다 높다'), r.out)
  assert(readFileSync(join(d, '.claude/spec-profile.yml'), 'utf8').includes('sdlc_version: 99'),
    '프로필 버전을 내렸다')
})

test('승인 가드의 plan 상태 전이 표가 실행 흐름을 막지 않는다', () => {
  const d = temp('sdlc-trans')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\n')
  const plan = join(d, '.claude/specs/2026-09-05-a/plan.md')
  const guard = tool('guard-approval.sh')

  /** 가드는 이제 «차단» 이 아니라 «승인 요청» 을 낸다 — 사람이 다이얼로그에서 답한다.
   *  그래서 판정은 종료코드가 아니라 permissionDecision 이다. 통과는 조용한 exit 0. */
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

  // 실행 흐름은 막히면 안 된다 — `/implement-spec` 이 이 둘을 스스로 한다.
  assert(attempt('accepted', 'in_progress') === 'pass', 'accepted → in_progress 가 막혔다 — 구현이 시작조차 못 한다')
  assert(attempt('in_progress', 'completed') === 'pass', 'in_progress → completed 가 막혔다')
  // 되돌리기는 열려 있어야 한다.
  assert(attempt('accepted', 'in_review') === 'pass', 'accepted → in_review 가 막혔다')
  // 사람의 판정은 막혀야 한다.
  // 사람이 있는 세션: 모델이 조용히 통과하지 못하고 반드시 사람에게 물어야 한다.
  assert(attempt('in_review', 'accepted') === 'ask', 'in_review → accepted 가 사람에게 안 물어본다')
  // 자율 실행: 물어볼 사람이 없다. acceptEdits 때문에 ask 는 자동 승인되므로 차단이어야 한다.
  assert(attempt('in_review', 'accepted', { SDLC_AUTONOMY_ROUTE: 'triage' }) === 'deny',
    '자율 실행이 자기 문서를 승인할 수 있다 — 정책 승인 설계가 무너진다')
  assert(attempt('accepted', 'completed') === 'ask', '실행을 건너뛴 completed 가 조용히 통과한다')

  /** **«ask» 는 권한 모드보다 세다.** 대화형 acceptEdits · auto · bypassPermissions 에서 훅의
   *  ask 는 다이얼로그를 띄우고, 비대화형 -p 에서는 거부된다. 그래서 이 모드들에서도 ask 를
   *  낸다 — 직접 막으면 사용자가 모드를 오가게 만드는 마찰뿐이다. 예외는 물음을 자동으로
   *  «아니오» 로 만드는 dontAsk 하나다: 거기서는 왜 거부됐는지 남기려고 직접 막는다. */
  for (const m of ['default', 'plan', 'acceptEdits', 'auto', 'bypassPermissions']) {
    assert(attempt('in_review', 'accepted', {}, m) === 'ask', `permission_mode=${m} 에서 승인 전이가 다이얼로그로 가지 않는다`)
  }
  assert(attempt('in_review', 'accepted', {}, 'dontAsk') === 'deny', 'dontAsk 에서 이유 없이 거부된다')
  // 실행 전이는 승인이 아니다 — 어느 모드에서도 조용히 통과해야 한다.
  assert(attempt('accepted', 'in_progress', {}, 'bypassPermissions') === 'pass',
    'bypassPermissions 에서 구현 시작이 막혔다')
})

test('자율 루트는 자기 경로의 정책 승인만 쓸 수 있다', () => {
  const d = temp('sdlc-polguard')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\n')
  const doc = join(d, '.claude/specs/2026-09-05-a/intent.md')
  const guard = tool('guard-approval.sh')

  /** 정책 승인은 자율 루트의 **승인 방식**이다. 가드가 그것까지 막으면 자율 경로는
   *  «승인이 필요 없는 데까지만» 도는 초안기가 되고, expires·max_tier·advance_to 는
   *  한 번도 발화하지 않는 장식이 된다. */
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
  // 승인자를 먼저 쓰고 상태를 나중에 올리는 두 번의 편집도 통과해야 한다.
  assert(attempt('approved_by: policy:triage', R) === 'pass', '승인자만 먼저 쓰는 편집이 막혔다')
  assert(attempt('status: accepted', { ...R, had: 'policy:triage' }) === 'pass',
    '이미 정책 승인된 문서의 상태 전이가 막혔다')

  // **자기 경로만.** 더 넓은 위임을 스스로 빌려오면 max_tier 가 경계가 아니게 된다.
  assert(attempt('approved_by: policy:wider', R) === 'deny', '자율 루트가 남의 위임을 빌려 썼다')
  assert(attempt('approved_by: 한지우', R) === 'deny', '자율 루트가 사람 이름으로 승인했다')
  assert(attempt('status: accepted', R) === 'deny', '자율 루트가 승인자 없이 accepted 로 올렸다')
  // 사람 세션의 에이전트는 정책 승인을 참칭할 수 없다.
  assert(attempt('approved_by: policy:triage') === 'deny', '사람 세션에서 policy: 승인이 조용히 통과했다')
})

test('자율 루트는 위임의 네 경계를 실행 시점에 지킨다', () => {
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

  // 가드가 없는 레포는 돌리지 않는다 — 정책 승인 경계를 지키는 것이 그 훅이다.
  let r = dispatch('--route', 'triage', '--signal', 'CI 실패율 12.4%', '--dry-run')
  assert(r.status !== 0 && (r.stderr + r.stdout).includes('승인 가드'), '가드 없는 레포에서 자율 실행이 돌았다')
  assert(spawnSync(process.execPath, [tool('install-hook.mjs'), d], { encoding: 'utf8' }).status === 0, '훅 설치 실패')

  // 살아 있는 위임은 실행 명령을 낸다 — 정책 도구에 사슬 배관만 더해 실려야 한다.
  r = dispatch('--route', 'triage', '--signal', 'CI 실패율 12.4%', '--dry-run')
  assert(r.status === 0, r.stdout + r.stderr)
  const allowed = /--allowedTools "([^"]+)"/.exec(r.stdout)?.[1] ?? ''
  for (const t of ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Skill', 'Bash(git log:*)'])
    assert(allowed.split(',').includes(t), `허용 도구에 ${t} 가 없다: ${allowed}`)
  assert(!allowed.split(',').includes('Bash'), '정책이 주지 않은 Bash 전체가 실렸다')

  // .claude/ 아래 spec_dir 는 자율로 쓸 수 없다 — Claude Code 가 그 폴더의 쓰기를 언제나 묻는다.
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\nautonomy: .claude/autonomy.yml\n')
  r = dispatch('--route', 'triage', '--signal', 'CI 실패율 12.4%', '--dry-run')
  assert(r.status !== 0 && (r.stderr + r.stdout).includes('.claude/'), '.claude/ 아래 spec_dir 로 자율 실행이 돌았다')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .sdlc/specs\nautonomy: .claude/autonomy.yml\n')

  // 만료된 위임으로는 아예 돌지 않는다 — 만료일이 장식이 되면 안 된다.
  put(join(d, '.claude/autonomy.yml'), policy('2020-01-01'))
  r = dispatch('--route', 'triage', '--signal', 'x', '--dry-run')
  assert(r.status === 3, `만료 위임이 실행됐다: ${r.stdout}${r.stderr}`)

  // 신호 없이는 발화할 수 없다.
  put(join(d, '.claude/autonomy.yml'), policy('2099-12-31'))
  r = dispatch('--route', 'triage', '--dry-run')
  assert(r.status !== 0, '관측 없이 발화했다')

  // 정책 자체의 안전선: full 티어와 브랜치 없는 implement 는 거부된다.
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

test('정책 승인은 실재하고 살아 있는 위임만 통과한다', () => {
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

  // 위임보다 위험한 티어는 그 위임으로 통과할 수 없다.
  put(join(chain, 'intent.md'), intent('policy:triage', 'standard'))
  assert(check().stdout.includes('max_tier'), '위임을 넘는 티어가 통과했다')

  /** **`advance_to` 밖은 그 위임의 승인 대상이 아니다.** 이 대조가 없으면 `finding` 까지만
   *  맡긴 위임이 intent 를, `intent` 까지 맡긴 위임이 plan 을 승인한다 — 경계가 문서 안의
   *  선언일 뿐이 된다. */
  put(join(d, '.claude/autonomy.yml'), readFileSync(join(d, '.claude/autonomy.yml'), 'utf8')
    .replace('advance_to: intent', 'advance_to: finding'))
  put(join(chain, 'intent.md'), intent('policy:triage', 'light'))
  assert(check().stdout.includes('까지 맡았는데'), '위임의 끝을 넘은 문서가 그 위임으로 승인됐다')
})

test('check-all은 빈 사슬에서도 정책을 검사하고 필수 설정 누락을 거부한다', () => {
  const d = temp('sdlc-required')
  const check = (...args) => run(process.execPath, [tool('check-all.mjs'), d, ...args])
  assert(check().code === 0 && check('--required').code !== 0, '프로필 누락의 필수 모드를 구분하지 않았다')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: missing\n')
  assert(check().code !== 0, '없는 spec_dir를 통과시켰다')
  mkdirSync(join(d, 'missing'))
  assert(check().code === 0 && check('--required').code !== 0, '빈 디렉터리의 필수 모드를 구분하지 않았다')
  put(join(d, '.claude/autonomy.yml'), 'version: 1\nroutes:\n  bad:\n    expires: 2099-01-01\n')
  assert(check().code !== 0, '사슬이 없다는 이유로 잘못된 정책 검사를 생략했다')
})

test('작업 귀속은 같은 ID라도 다른 계획의 커밋을 제외한다', () => {
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

test('전체 검증은 의존 변경과 최신 실패를 반영하고 완료 시점 증거를 유지한다', () => {
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

test('자율 실행은 자기 로그만 제외하고 다른 변경은 차단한다', () => {
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

console.log('\n런타임 스모크 평가\n')
for (const r of results) {
  console.log(`  ${r.ok ? '통과' : '✗ 실패'}  ${r.name}`)
  if (r.error) console.log(`        ${r.error}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 통과\n`)
process.exit(failed ? 1 : 0)
