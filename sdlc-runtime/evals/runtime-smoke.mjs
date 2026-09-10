#!/usr/bin/env node
/** Verify task attribution, completion evidence, approval guards, hook installation, and runtime integration in temporary repositories. */
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
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
    .map((l) => `${l.match(/^#+/)[0]} ${(l.match(/\b(OUT|CON|Q|SCN|FR|NFR|EDGE|SQ|SD|TD|WP|RISK|PQ|EV|HYP|FQ|ALT|RV|ASM)-\d+/) ?? ['prose'])[0]}`)

  for (const [skill, file] of [['create-intent', 'intent-template.md'], ['create-spec', 'spec-template.md'],
                               ['create-plan', 'plan-template.md'], ['create-adr', 'adr-template.md'],
                               ['create-finding', 'finding-template.md'],
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
    put(join(d, 'docs/adr/ADR-002-current.md'), '# ADR-002 — Current\n\n| 상태 | 승인됨 |\n')
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


console.log('\n런타임 스모크 평가\n')
for (const r of results) {
  console.log(`  ${r.ok ? '통과' : '✗ 실패'}  ${r.name}`)
  if (r.error) console.log(`        ${r.error}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 통과\n`)
process.exit(failed ? 1 : 0)
