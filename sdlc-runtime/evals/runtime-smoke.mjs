#!/usr/bin/env node
/** 임시 저장소에서 작업 귀속·완료 증거·승인 가드·훅 설치·런타임 연동을 검증한다. */
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

  // 실행 기록과 테스트 문장 누락을 각각 확인한다.
  let r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  let got = JSON.parse(r.out)
  let row = got.rows.find((x) => x.id === 'WP-001')
  assert(row.tests.missing.length === 1 && row.tests.missing[0].includes('질의가 비면'), `tests 대조가 틀렸다: ${JSON.stringify(row.tests)}`)
  assert(got.notes.some((n) => n.msg.includes('tests 문장')), 'tests 문장 누락을 경고하지 않는다')
  assert(got.notes.some((n) => n.msg.includes('verify 기록이 없다')), 'verify 기록 부재를 경고하지 않는다')

  // 실패한 검증은 종료 코드와 로그에 반영돼야 한다.
  r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', 'echo boom; exit 3'])
  assert(r.code === 3, `실패 종료 코드를 삼켰다 (${r.code})`)
  const logs = () => readdirSync(join(d, '.sdlc/verify/2026-09-05-v'))
  assert(logs().length === 1 && readFileSync(join(d, '.sdlc/verify/2026-09-05-v', logs()[0]), 'utf8').includes('exit: 3'), '실패 로그가 없거나 exit 가 안 남았다')
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  assert(JSON.parse(r.out).rows[0].verified.length === 0, '실패한 verify 를 검증으로 셌다')

  put(join(d, 'src/a.test.js'), "test('보관 문서가 함께 걸리면 일반 문서만 반환된다', () => {})\ntest('질의가 비면 빈 목록을 반환한다', () => {})\n")
  // 검증 성공과 테스트 문장 일치를 확인한다.
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

  // 두 작업에 의존하는 작업은 다음 레벨에 배치한다.
  let r = run(process.execPath, [tool('plan-levels.mjs'), spec, '--json'])
  assert(r.code === 0, r.out)
  const lv = JSON.parse(r.out)
  assert(lv.levels.length === 2 && lv.levels[0].mode === 'parallel' && lv.levels[1].mode === 'main', JSON.stringify(lv.levels.map((l) => [l.n, l.mode])))
  assert(lv.next === 1 && lv.target_branch === 'feat/tw', `next/target_branch 가 틀렸다: ${lv.next} ${lv.target_branch}`)

  // AC 전문과 적용되는 규칙을 전달해야 한다.
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
  // 기본 템플릿의 자리표시자가 모두 치환돼야 한다.
  r = run(process.execPath, [tool('task-brief.mjs'), spec, 'WP-001', '--worktree', '.wt/x'])
  assert(r.code === 0 && !/\{[a-z_]+\}/.test(r.out) && !r.out.includes('채우지 못한 자리') && r.out.includes('커밋하지 마라'), `기본 템플릿이 안 채워졌다:\n${r.out.slice(0, 400)}`)

  // add는 대상 브랜치에서 분기하고 bootstrap을 실행한다.
  const twt = (...a) => run(process.execPath, [tool('task-worktree.mjs'), spec, ...a])
  r = twt('add', 'WP-001')
  assert(r.code === 0 && existsSync(join(d, '.wt/2026-09-05-tw-WP-001/.bootstrapped')), `add 실패:\n${r.out}`)
  assert(git(d, 'branch', '--list', 'task/2026-09-05-tw-WP-001').trim() !== '', '작업 브랜치가 없다')
  // commit은 files만 포함하고 트레일러를 추가한다.
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
  // 병합 후 워크트리와 브랜치를 제거한다.
  r = twt('merge', 'WP-001')
  assert(r.code === 0 && git(d, 'log', '-1', '--format=%B').includes('SDLC-Task: WP-001'), `merge 실패:\n${r.out}`)
  r = twt('remove', 'WP-001')
  assert(r.code === 2 && r.out.includes('stray.js'), `남은 스코프 밖 변경을 조용히 버렸다:\n${r.out}`)
  r = twt('remove', 'WP-001', '--force')
  assert(r.code === 0 && !existsSync(wt) && git(d, 'branch', '--list', 'task/2026-09-05-tw-WP-001').trim() === '', `remove 실패:\n${r.out}`)
  // 커밋의 작업 귀속을 확인한다.
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  assert(JSON.parse(r.out).rows.find((x) => x.id === 'WP-001').commits.length === 1, '합류된 커밋이 귀속되지 않았다')
  // 충돌 시 병합을 취소하고 중단해야 한다.
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
  /** 문서 승인 편집은 ask를 반환하고 Bash 승인 편집은 차단한다. */
  const asks = (r) => (r.out ?? '').includes('"permissionDecision":"ask"')

  r = invoke({ tool_name: 'Write', tool_input: { file_path: intent, content: 'status: accepted\napproved_by: "agent"' } })
  assert(asks(r), 'Write 자기승인을 사람에게 안 물어본다')
  r = invoke({ tool_name: 'Bash', tool_input: { command: `sed -i '' 's/status: .*/status: accepted/' '${intent}'` } })
  assert(r.code === 2, 'Bash 자기승인을 막지 못했다')
  put(intent, '---\nartifact: intent\nstatus: accepted\napproved_by: "human"\n---\n\n승인된 의미\n')
  r = invoke({ tool_name: 'Edit', tool_input: { file_path: intent, old_string: '승인된 의미', new_string: '바뀐 의미' } })
  assert(asks(r), 'accepted 본문 변경을 상태 하향 없이 조용히 허용했다')

  // 자율 경로에서 사람 명의 승인은 차단한다.
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
  /** 경고가 없어도 게이트가 정상 종료해야 한다. */
  const d = temp('sdlc-gate-clean')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: ".sdlc/specs"\n')
  const chain = join(d, '.sdlc/specs/change')
  cpSync(join(findSkill('create-plan', HERE), 'evals/cases/clean-light/docs'), chain, { recursive: true })

  const r = spawnSync(tool('gate-artifacts.sh'), [], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { file_path: join(chain, 'intent.md') } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: d },
  })
  assert(r.status === 0, `깨끗한 산출물 세트에서 게이트가 실패했다 (code ${r.status})\n${r.stdout}\n${r.stderr}`)
  assert(!/unbound|command not found/.test(r.stderr ?? ''), `게이트가 셸 오류를 냈다:\n${r.stderr}`)
})

test('shim 은 플러그인이 두 모양 중 어디에 있어도 런타임을 찾는다', () => {
  /** 개발용 링크와 플러그인 캐시 설치 모두에서 훅이 실행돼야 한다. */
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
  // 목표 스키마 버전은 런타임에서 읽는다.
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

test('migrate-schema는 프로필만 올리고 검사에 실패하는 산출물 세트는 건너뛴다', () => {
  const d = temp('sdlc-migrate')
  const cur = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\n')

  // 승인자가 없는 v1 문서는 v3 승인 규칙을 충족하지 못한다.
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

  // 기본 실행은 변경 없이 결과만 보고한다.
  let r = run('node', [tool('migrate-schema.mjs'), d])
  assert(r.code === 0, r.out)
  assert(r.out.includes('프로필 없음'), r.out)
  assert(!readFileSync(join(d, '.claude/spec-profile.yml'), 'utf8').includes('sdlc_version'),
    '보고만 하는데 프로필을 바꿨다')

  // --profile은 프로필만 갱신한다.
  r = run('node', [tool('migrate-schema.mjs'), d, '--profile'])
  assert(r.code === 0, r.out)
  assert(readFileSync(join(d, '.claude/spec-profile.yml'), 'utf8').includes(`sdlc_version: ${cur}`), r.out)

  // --artifact-sets는 새 스키마 검사를 통과하지 못한 문서를 제외한다.
  r = run('node', [tool('migrate-schema.mjs'), d, '--artifact-sets'])
  assert(r.code === 0, r.out)
  assert(r.out.includes('건너뜀'), r.out)
  assert(!readFileSync(join(chain, 'intent.md'), 'utf8').includes('schema_version'),
    '검사에 실패하는 산출물 세트를 올려버렸다')

  // 런타임보다 높은 프로필 버전은 낮추지 않는다.
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

  /** 승인 요청은 종료 코드뿐 아니라 permissionDecision으로 확인한다. */
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

  // 실행 상태 전이는 허용해야 한다.
  assert(attempt('accepted', 'in_progress') === 'pass', 'accepted → in_progress 가 막혔다 — 구현이 시작조차 못 한다')
  assert(attempt('in_progress', 'completed') === 'pass', 'in_progress → completed 가 막혔다')
  // 검토 상태로 되돌리는 전이는 허용해야 한다.
  assert(attempt('accepted', 'in_review') === 'pass', 'accepted → in_review 가 막혔다')
  // 사람의 승인이 필요한 편집은 ask를 반환해야 한다.
  assert(attempt('in_review', 'accepted') === 'ask', 'in_review → accepted 가 사람에게 안 물어본다')
  // 자율 실행에서 사람의 승인이 필요한 편집은 차단해야 한다.
  assert(attempt('in_review', 'accepted', { SDLC_AUTONOMY_ROUTE: 'triage' }) === 'deny',
    '자율 실행이 자기 문서를 승인할 수 있다 — 정책 승인 설계가 무너진다')
  assert(attempt('accepted', 'completed') === 'ask', '실행을 건너뛴 completed 가 조용히 통과한다')

  /** dontAsk는 직접 차단하고, 다른 권한 모드에는 ask를 반환한다. */
  for (const m of ['default', 'plan', 'acceptEdits', 'auto', 'bypassPermissions']) {
    assert(attempt('in_review', 'accepted', {}, m) === 'ask', `permission_mode=${m} 에서 승인 전이가 다이얼로그로 가지 않는다`)
  }
  assert(attempt('in_review', 'accepted', {}, 'dontAsk') === 'deny', 'dontAsk 에서 이유 없이 거부된다')
  // 실행 상태 전이는 권한 모드와 관계없이 허용한다.
  assert(attempt('accepted', 'in_progress', {}, 'bypassPermissions') === 'pass',
    'bypassPermissions 에서 구현 시작이 막혔다')
})

test('자율 루트는 자기 경로의 정책 승인만 쓸 수 있다', () => {
  const d = temp('sdlc-polguard')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\n')
  const doc = join(d, '.claude/specs/2026-09-05-a/intent.md')
  const guard = tool('guard-approval.sh')

  /** 현재 자율 경로의 정책 승인은 허용해야 한다. */
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
  // 승인자와 상태를 별도 편집해도 같은 정책 승인이 적용돼야 한다.
  assert(attempt('approved_by: policy:triage', R) === 'pass', '승인자만 먼저 쓰는 편집이 막혔다')
  assert(attempt('status: accepted', { ...R, had: 'policy:triage' }) === 'pass',
    '이미 정책 승인된 문서의 상태 전이가 막혔다')

  // 다른 경로의 정책 승인은 허용하지 않는다.
  assert(attempt('approved_by: policy:wider', R) === 'deny', '자율 루트가 남의 위임을 빌려 썼다')
  assert(attempt('approved_by: 한지우', R) === 'deny', '자율 루트가 사람 이름으로 승인했다')
  assert(attempt('status: accepted', R) === 'deny', '자율 루트가 승인자 없이 accepted 로 올렸다')
  // 사람 세션에서 정책 명의 승인은 허용하지 않는다.
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

  // 승인 가드가 없으면 자율 실행을 거부한다.
  let r = dispatch('--route', 'triage', '--signal', 'CI 실패율 12.4%', '--dry-run')
  assert(r.status !== 0 && (r.stderr + r.stdout).includes('승인 가드'), '가드 없는 레포에서 자율 실행이 돌았다')
  assert(spawnSync(process.execPath, [tool('install-hook.mjs'), d], { encoding: 'utf8' }).status === 0, '훅 설치 실패')

  // 정책 도구에 산출물 처리용 최소 도구만 추가한다.
  r = dispatch('--route', 'triage', '--signal', 'CI 실패율 12.4%', '--dry-run')
  assert(r.status === 0, r.stdout + r.stderr)
  const allowed = /--allowedTools "([^"]+)"/.exec(r.stdout)?.[1] ?? ''
  for (const t of ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Skill', 'Bash(git log:*)'])
    assert(allowed.split(',').includes(t), `허용 도구에 ${t} 가 없다: ${allowed}`)
  assert(!allowed.split(',').includes('Bash'), '정책이 주지 않은 Bash 전체가 실렸다')

  // .claude 아래 산출물 경로는 비대화형 실행에서 거부한다.
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .claude/specs\nautonomy: .claude/autonomy.yml\n')
  r = dispatch('--route', 'triage', '--signal', 'CI 실패율 12.4%', '--dry-run')
  assert(r.status !== 0 && (r.stderr + r.stdout).includes('.claude/'), '.claude/ 아래 spec_dir 로 자율 실행이 돌았다')
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: .sdlc/specs\nautonomy: .claude/autonomy.yml\n')

  // 만료된 정책은 실행하지 않는다.
  put(join(d, '.claude/autonomy.yml'), policy('2020-01-01'))
  r = dispatch('--route', 'triage', '--signal', 'x', '--dry-run')
  assert(r.status === 3, `만료 위임이 실행됐다: ${r.stdout}${r.stderr}`)

  // 관측 신호가 필요하다.
  put(join(d, '.claude/autonomy.yml'), policy('2099-12-31'))
  r = dispatch('--route', 'triage', '--dry-run')
  assert(r.status !== 0, '관측 없이 발화했다')

  // full 등급과 대상 브랜치 없는 implement 정책은 거부한다.
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

  // 위임 범위를 초과하는 위험 등급은 거부한다.
  put(join(chain, 'intent.md'), intent('policy:triage', 'standard'))
  assert(check().stdout.includes('max_tier'), '위임을 넘는 티어가 통과했다')

  /** advance_to 이후의 산출물은 해당 정책으로 승인할 수 없다. */
  put(join(d, '.claude/autonomy.yml'), readFileSync(join(d, '.claude/autonomy.yml'), 'utf8')
    .replace('advance_to: intent', 'advance_to: finding'))
  put(join(chain, 'intent.md'), intent('policy:triage', 'light'))
  assert(check().stdout.includes('까지 맡았는데'), '위임의 끝을 넘은 문서가 그 위임으로 승인됐다')
})

test('check-all은 빈 산출물 세트에서도 정책을 검사하고 필수 설정 누락을 거부한다', () => {
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


// 두 레포를 실제로 갈라 세운다. 이 하네스에서 가장 오래 «코드로만 읽고 돌려보지 않은» 자리다.
const CASES = resolve(ROOT, '../skills/sdlc/create-plan/evals/cases/clean-light/docs')

function seedRepo(dir, profile) {
  put(join(dir, '.claude/spec-profile.yml'), profile)
  git(dir, 'init', '-q'); git(dir, 'config', 'user.name', 'eval'); git(dir, 'config', 'user.email', 'eval@local')
}
const edit = (path, fn) => writeFileSync(path, fn(readFileSync(path, 'utf8')))

/** 상류 문서 레포 하나와 소비 코드 레포 하나를 세우고, 사본을 끌어온 상태까지 만든다. */
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
  // 수용 기준을 레포별로 배정한다 — 상류 spec 한 벌이 여러 레포의 몫을 함께 진다.
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

test('pull-spec 은 승인된 상류만 끌어오고 락에 상류 커밋을 찍는다', () => {
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

test('소비 레포는 자기 scope 의 Must 만 덮으면 된다', () => {
  const { up, chain } = twoRepos()
  run(process.execPath, [tool('pull-spec.mjs'), chain, '--from', up])
  const lock = JSON.parse(readFileSync(join(chain, 'upstream.lock.json'), 'utf8'))
  cpSync(join(CASES, 'plan.md'), join(chain, 'plan.md'))
  edit(join(chain, 'plan.md'), (s) => s.replace('schema_version: 3', 'schema_version: 6'))
  // WP-001 은 AC-001 만 문다. AC-002 는 acme/web 몫이라 이 레포에서 비어 있어도 된다.
  edit(join(chain, 'plan.md'), (s) => s
    .replace('@SPEC_SHA@', lock.files['spec.md'].sha.slice(0, 7))
    .replace('covers: FR-001 (AC-001, AC-002)', 'covers: AC-001'))
  git(chain, 'add', '-A')

  const r = check(chain, up)
  assert(!r.out.includes('AC-002'), `다른 레포 몫인 AC-002 를 이 레포에 물렸다:\n${r.out}`)
  assert(r.code === 0, `두 레포로 갈린 정상 산출물 세트가 실패했다:\n${r.out}`)

  // 남의 몫을 덮으면 막는다 — 두 레포가 같은 기준을 만들면 합류에서 갈린다.
  edit(join(chain, 'plan.md'), (s) => s.replace('covers: AC-001', 'covers: AC-001, AC-002'))
  const foreign = check(chain, up)
  assert(foreign.code !== 0 && foreign.out.includes('다른 레포 몫'), `남의 몫을 덮는 작업을 통과시켰다:\n${foreign.out}`)
})

test('사본을 손으로 고치면 해시가 막고, 상류가 앞서가면 검사기가 잡는다', () => {
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

  // 상류에서 spec 이 한 번 더 바뀌면 사본은 낡은다. 이것이 사본 규약이 못 잡던 붕괴다.
  edit(join(upChain, 'spec.md'), (s) => s.replace('## 오류와 경계', '## 오류와 경계'))
  edit(join(upChain, 'spec.md'), (s) => s.replace('빈 결과를 그대로 낸다', '빈 결과를 그대로 낸다. 경고 문구를 함께 낸다'))
  git(up, 'add', '-A'); git(up, 'commit', '-qm', 'spec 개정')
  const stale = check(chain, up)
  assert(stale.code !== 0 && stale.out.includes('상류가 이 사본보다 앞서 있다'), `상류 드리프트를 놓쳤다:\n${stale.out}`)
})

test('상류 프로필을 켜도 이전 스키마의 산출물 세트는 배정 검사에 걸리지 않는다', () => {
  // 새 오류 규칙은 도입된 스키마 이상에서만 적용한다(schema.md). 프로필 한 줄로 이전 산출물 세트가
  // 전부 빨개지면 아무도 상류를 선언하지 않는다.
  const { upChain } = twoRepos()
  for (const f of ['intent.md', 'spec.md']) {
    edit(join(upChain, f), (s) => s.replace('schema_version: 6', 'schema_version: 5'))
  }
  edit(join(upChain, 'spec.md'), (s) => s.replace(/ `scope: [^`]+`/g, ''))
  const r = check(upChain)
  assert(!r.out.includes('`scope` 가 없다'), `v5 산출물 세트에 v6 배정 검사가 걸렸다:\n${r.out}`)
})

test('상류 문서 레포는 배정되지 않은 Must 수용 기준을 막는다', () => {
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


test('lang 은 문체 번들을 고르고, 번들이 없으면 조용히 통과하지 않는다', () => {
  /** 번들이 없는 언어를 통과시키면 문체 검사가 0건인지 미실행인지 구분되지 않는다. */
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


test('번들은 같은 모양이어야 한다 — 키 하나가 빠지면 그 규칙이 조용히 꺼진다', async () => {
  /** en 에 vague 가 없으면 모호어 검사가 «0건» 으로 보인다. 그것이 이 하네스가 가장 싫어하는 실패다. */
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
    assert(m.limits.sentences > 0 && m.limits.title > 0 && m.limits.ac > 0, `${name}: limits 가 비었다`)
    // written 은 산출물에 그대로 들어간다 — 키가 빠지면 계획서에 `undefined` 가 적힌다.
    for (const k of ['divergence', 'none', 'noPr']) assert(typeof m.written[k] === 'string' && m.written[k], `${name}: written.${k} 이 없다`)
    for (const k of ['done', 'partial', 'failed']) assert(typeof m.written.result[k] === 'string' && m.written.result[k], `${name}: written.result.${k} 이 없다`)
    // /g 가 붙은 정규식은 .test 가 상태를 가져 한 줄 걸러 한 번씩만 걸린다.
    for (const w of m.vague) assert(!(w instanceof RegExp) || !w.flags.includes('g'), `${name}: vague 에 /g 정규식이 있다 — ${w}`)
    for (const [w] of m.translationese) assert(!(w instanceof RegExp) || !w.flags.includes('g'), `${name}: translationese 에 /g 정규식이 있다 — ${w}`)
  }
})


test('승인 가드는 ADR 도 본다 — 산출물 세트 밖에 산다고 예외가 아니다', () => {
  /** references/adr.md 가 «ADR 은 그 규칙의 예외가 아니다» 라고 적어 둔 자리다. 관문이 ADR 을
   *  걸러내면 가드의 ADR 처리(deprecated 전이까지 아는)가 통째로 죽은 코드가 된다. */
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

  // adr_dir 이 없는 레포는 ADR 을 안 쓴다. 무관한 파일까지 가드에 걸리면 안 된다.
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 5\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\n`)
  r = invoke({ tool_name: 'Write', tool_input: { file_path: adr, content: 'status: accepted\napproved_by: "agent"' } })
  assert(r.code === 0 && !asks(r), 'adr_dir 이 없는데도 ADR 경로를 붙잡았다')
})

test('shim 은 프로필이 지목한 런타임을 설치본보다 먼저 쓴다', () => {
  /** 안 그러면 훅만 설치본을 돌고 스킬·CI 는 지목된 사본을 돈다 — 같은 문서의 검사 결과가 갈리고,
   *  런타임을 개발하는 레포에서는 훅이 언제나 옛 하네스로 검사한다. */
  const d = temp('sdlc-shim-profile')
  run(process.execPath, [tool('install-hook.mjs'), d])
  const shim = join(d, '.claude/hooks/sdlc-gate.sh')

  // 프로필이 지목하는 사본과, 홈에 놓인 설치본을 각각 다른 표식으로 만든다.
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

test('node 를 못 찾으면 가드는 조용히 통과하지 않고 말한다', () => {
  /** 조용한 통과는 «가드가 꺼진 것» 과 «통과» 를 같은 것으로 만든다. */
  const d = temp('sdlc-node')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 5\nsdlc_runtime: "${ROOT}"\nspec_dir: ".sdlc/specs"\n`)
  const intent = join(d, '.sdlc/specs/change/intent.md')
  put(intent, '---\nartifact: intent\nstatus: in_review\napproved_by: null\n---\n\n초안\n')
  const selfApproval = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: intent, content: ['status:', 'accepted'].join(' ') + '\n' + ['approved_by:', '"agent"'].join(' ') },
  })
  // PATH 를 통째로 비우면 `#!/usr/bin/env bash` 가 bash 를 못 찾아 스크립트 자체가 안 뜬다.
  // 시스템 경로만 남기고 node 만 없는 상태를 만든다. HOME 은 비워 ~/.nvm 도 안 걸리게 한다.
  const sys = '/usr/bin:/bin'
  const empty = temp('sdlc-nopath')

  // PATH 에 없어도 SDLC_NODE 로 지목하면 판정한다.
  const found = spawnSync(tool('guard-approval.sh'), [], {
    encoding: 'utf8', input: selfApproval,
    env: { ...process.env, PATH: sys, HOME: empty, SDLC_NODE: process.execPath, CLAUDE_PROJECT_DIR: d },
  })
  assert((found.stdout ?? '').includes('"permissionDecision":"ask"'),
    `PATH 에 node 가 없다고 자기승인을 통과시켰다:\n${found.stdout}${found.stderr}`)

  // 정말 못 찾으면 그 사실을 말한다. 시스템 경로에 node 가 있는 장비에서는 이 갈래가 안 선다.
  if (['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].some((f) => existsSync(f))) return
  const missing = spawnSync(tool('guard-approval.sh'), [], {
    encoding: 'utf8', input: selfApproval,
    env: { ...process.env, PATH: sys, HOME: empty, CLAUDE_PROJECT_DIR: d, SDLC_NODE: '' },
  })
  assert(/node 를 못 찾았다/.test(missing.stderr ?? ''), `node 가 없는데 아무 말도 없이 통과했다:\n${missing.stderr}`)
})

test('문장 수는 종결부호만 센다 — 소수점과 확장자는 문장을 끝내지 않는다', () => {
  /** «2.2 배» 와 «prose.md» 가 각각 두 문장으로 세어지면, 세 문장짜리 항목이 아홉 문장이 된다.
   *  한국어 산문에는 소수와 확장자가 드물어 영문 산출물을 쓰기 전까지 드러나지 않았다. */
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

test('템플릿의 언어판은 같은 구조여야 한다 — 한쪽만 고치면 그 절이 조용히 사라진다', () => {
  /** 절 제목은 계약이 아니라 검사기가 안 본다. 그래서 en 템플릿에서 절 하나가 빠져도 아무도
   *  실패하지 않고, 그 언어로 쓰는 사람만 그 절을 영영 안 쓰게 된다. */
  const shape = (file) => readFileSync(file, 'utf8').split('\n')
    .filter((l) => /^#{2,3} /.test(l))
    .map((l) => `${l.match(/^#+/)[0]} ${(l.match(/\b(OUT|CON|Q|SCN|FR|NFR|EDGE|SQ|SD|TD|WP|RISK|PQ|EV|HYP|FQ|ALT|RV|ASM)-\d+/) ?? ['prose'])[0]}`)

  for (const [skill, file] of [['create-intent', 'intent-template.md'], ['create-spec', 'spec-template.md'],
                               ['create-plan', 'plan-template.md'], ['create-adr', 'adr-template.md'],
                               ['create-finding', 'finding-template.md'],
                               // SDLC 산출물은 아니지만 같은 이유로 언어판이 갈린다 — 보고 형식은
                               // 대화 언어가, PR 본문은 프로필의 lang 이 고른다.
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

test('mark 는 파생 필드를 안 적고 계획대로 끝난 작업을 한 줄에 묶는다', () => {
  /** 커밋 SHA·검증 로그 이름은 plan-progress 가 trailer 와 로그 폴더에서 직접 찾는다. 그 사본을
   *  줄에 적으면 아무도 안 읽는 글자가 작업 수만큼 쌓이고, 정작 이 줄에만 있는 값인
   *  «계획과의 차이» 가 그 사이에 묻힌다. */
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

  // 차이가 있는 작업은 제 줄을 가진다 — 묶으면 그 문장이 남의 줄에 얹힌다.
  r = mark('WP-003', '--note', '캐시 무효화를 뒤로 미뤘다')
  assert(r.code === 0, r.out)
  assert(logLines().length === 2 && /캐시 무효화/.test(logLines()[1]), `차이 있는 줄을 따로 안 세웠다:\n${logLines().join('\n')}`)

  // 묶인 줄도 검사기가 세 작업 모두의 기록으로 읽어야 한다.
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  const notes = JSON.parse(r.out).notes.filter((n) => n.msg.includes('§실행 기록'))
  assert(notes.length === 0, `묶인 줄을 기록 없음으로 읽었다: ${JSON.stringify(notes)}`)
})


test('통과 로그는 본문을 잘라 남기고 실패 로그는 그대로 둔다', () => {
  /** --- 위의 헤더가 증거다. 아래는 실패를 읽을 때 쓰는 재료라, 통과한 실행의 1000 줄은 아무도
   *  다시 열지 않으면서 레포에 영원히 남는다. 자른 자리는 전체 출력의 sha256 이 지킨다. */
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

  // 실패한 실행에서는 그 출력이 곧 용건이다.
  r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', `${noisy}; exit 3`])
  assert(r.code === 3, `실패 종료 코드를 삼켰다 (${r.code})`)
  const failed = read(logs().find((f) => read(f).includes('exit: 3')))
  assert(/^output: full 600 lines$/m.test(failed.split('\n---\n')[0]), `실패 로그를 잘랐다:\n${failed.split('\n---\n')[0]}`)
  assert(failed.includes('line 1\n') && failed.includes('line 300') && failed.includes('line 600'), '실패 로그에서 출력이 사라졌다')

  // 헤더만 읽는 쪽은 잘린 로그도 그대로 증거로 쓴다.
  put(join(d, 'src/a.js'), "test('결과가 참이다', () => {})\nexport const a = 1\n")
  git(d, 'add', 'src/a.js'); git(d, 'commit', '-qm', 'feat: a', '-m', 'SDLC-Task: WP-001\nSDLC-Plan: .sdlc/specs/2026-09-08-t/plan.md')
  r = run(process.execPath, [tool('verify-run.mjs'), spec, '--level', '1', '--tasks', 'WP-001', '--', 'echo ok'])
  assert(r.code === 0, r.out)
  r = run(process.execPath, [tool('plan-progress.mjs'), spec, '--json'])
  assert(JSON.parse(r.out).rows[0].verified.length === 1, `헤더를 못 읽었다:\n${r.out}`)
})


test('커밋되지 않은 프로필과 ADR 은 «나만 보는 검사» 라고 말한다', () => {
  /** 프로필이 Git 밖에 있으면 내 산출물 체계는 이 규칙으로, 남의 산출물 체계는 저마다의 규칙으로 통과하고 CI 는
   *  아무것도 안 본다. 셋 다 화면에서는 «통과» 로 보인다 — 이 하네스가 가장 싫어하는 모양이다. */
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

  // CI 모드에서는 실패다 — 경고로 두면 아무도 안 고친다.
  assert(check('--required').code === 1, 'CI 모드에서 통과시켰다')

  // 커밋하면 조용해진다. gitignore 에 남아 있어도 추적되면 남과 CI 가 같은 것을 본다.
  git(d, 'add', '-f', '.claude/spec-profile.yml', 'docs/adr'); git(d, 'commit', '-qm', 'chore: profile')
  r = check()
  assert(!/Git 에 없다/.test(r.out), `추적되는 설정을 여전히 문제로 봤다:\n${r.out}`)
})


console.log('\n런타임 스모크 평가\n')
for (const r of results) {
  console.log(`  ${r.ok ? '통과' : '✗ 실패'}  ${r.name}`)
  if (r.error) console.log(`        ${r.error}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 통과\n`)
process.exit(failed ? 1 : 0)
