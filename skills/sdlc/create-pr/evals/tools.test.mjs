/** Regression tests for create-pr scripts. Usage: node --test skills/sdlc/create-pr/evals/tools.test.mjs
 *
 * These differ from artifact cases under evals/cases: that runner compares check-artifacts and
 * lint-prose output with expected.json and cannot inspect shell-tool exit codes or output. */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))
const script = (name) => join(SKILL, 'scripts', name)

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}
function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error((r.stdout ?? '') + (r.stderr ?? ''))
  return r.stdout.trim()
}
function temp(t, prefix) {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  return d
}
function put(path, body, mode) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  if (mode) chmodSync(path, mode)
}

/** A repository whose branch contains profile pr_* keys and one artifact set. */
function prRepo(t) {
  const d = temp(t, 'pr-tools')
  git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  put(join(d, '.claude/spec-profile.yml'), `sdlc_version: 5
spec_dir: ".sdlc/specs"
pr_base: "main"
pr_workspace_dirs: "apps packages"
pr_split_dir: "apps"
pr_split_hint: "앱 2개 이상 변경 — 분할 여부를 먼저 물어라"
pr_review_focus:
  - "^packages/db/ => DB 스키마"   # 주석은 값에서 잘려야 한다
  - "(authz|permission) => 권한 경계"
`)
  put(join(d, 'README.md'), '# fixture\n')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')

  git(d, 'checkout', '-q', '-b', 'feat/cancel')
  put(join(d, 'apps/api/handler.ts'), 'export const handler = () => null\n')
  put(join(d, 'apps/worker/job.ts'), 'export const job = () => null\n')
  put(join(d, 'packages/db/schema.sql'), 'alter table loan add column cancelled_at timestamptz;\n')
  put(join(d, '.sdlc/specs/2026-09-08-cancel/intent.md'), `---
status: accepted
tier: standard
---

## 목표 결과

### OUT-001 — 신청자가 집행 전에 스스로 취소한다
`)
  put(join(d, '.sdlc/specs/2026-09-08-cancel/plan.md'), `---
status: in_progress
pr_strategy: 단일 PR
---

## 위험

### RISK-001 — 잘못된 상태 전이

## 작업

- [x] **WP-001 — 취소 핸들러**
  - files: \`apps/api/handler.ts\`, \`packages/db\`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: 취소된다
  - verify: true

## 실행 기록

- 2026-09-08 WP-001 — 완료 · PR 없음 · 계획과의 차이: 없음
`)
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'feat: cancel')
  return d
}

test('pr-context derives split signals, risk areas, and artifact sets from profile pr_* keys', (t) => {
  const d = prRepo(t)
  const r = run('bash', [script('pr-context.sh')], { cwd: d })
  assert.equal(r.code, 0, r.out)
  assert.ok(r.out.includes('SPLIT_HINT: 앱 2개 이상'), `분할 신호가 없다:\n${r.out}`)
  assert.ok(r.out.includes('review-focus: DB 스키마'), `위험 축 신호가 없다 — 블록 시퀀스를 못 읽었다:\n${r.out}`)
  assert.doesNotMatch(r.out, /#\s*주석/, `규칙 값에 주석이 딸려 왔다:\n${r.out}`)
  assert.ok(!r.out.includes('권한 경계'), `걸리지 않은 축까지 냈다:\n${r.out}`)
  assert.ok(r.out.includes('artifact-set: .sdlc/specs/2026-09-08-cancel'), `산출물 세트를 찾지 못했다:\n${r.out}`)
  assert.match(r.out, /intent\.md\s+status=accepted/, `산출물 문서의 상태를 안 냈다:\n${r.out}`)
  assert.ok(r.out.includes('OUT-001'), `산출물 문서의 ID 를 안 냈다:\n${r.out}`)
  assert.ok(r.out.includes('pr_strategy: 단일 PR'), `plan 의 pr_strategy 를 안 냈다:\n${r.out}`)
  assert.ok(r.out.includes('apps/api') && r.out.includes('apps/worker'), `영역을 두 단계로 안 묶었다:\n${r.out}`)
  // A file no task declared is where behaviour the spec never asked for arrives; a declared file
  // and a file under a declared directory are planned.
  assert.match(r.out, /unplanned-files:[^\n]*\n\s+apps\/worker\/job\.ts/, `계획 밖 파일을 안 냈다:\n${r.out}`)
  assert.doesNotMatch(r.out, /^\s+apps\/api\/handler\.ts$/m, `작업이 선언한 파일을 계획 밖으로 냈다:\n${r.out}`)
  assert.doesNotMatch(r.out, /^\s+packages\/db\/schema\.sql$/m, `선언한 디렉터리 밑의 파일을 계획 밖으로 냈다:\n${r.out}`)
  assert.doesNotMatch(r.out, /^\s+\.sdlc\/specs/m, `산출물 자체를 계획 밖 파일로 냈다:\n${r.out}`)

  // The other two outcomes must be told apart: nothing unplanned, and nothing to measure against.
  // «none» from a plan with no files would be a check that is off reading as a check that passed.
  const plan = join(d, '.sdlc/specs/2026-09-08-cancel/plan.md')
  put(plan, readFileSync(plan, 'utf8').replace('`apps/api/handler.ts`, `packages/db`', '`apps`, `packages`'))
  git(d, 'commit', '-qam', 'plan: widen')
  const all = run('bash', [script('pr-context.sh')], { cwd: d })
  assert.ok(all.out.includes('unplanned-files: none'), `계획 밖 파일이 없는데 none 을 안 냈다:\n${all.out}`)
  put(plan, readFileSync(plan, 'utf8').replace(/^\s+- files:.*\n/m, ''))
  git(d, 'commit', '-qam', 'plan: drop files')
  const bare = run('bash', [script('pr-context.sh')], { cwd: d })
  assert.ok(bare.out.includes('unplanned-files: 못 잰다'), `files 없는 plan 에서 못 잰다고 말하지 않았다:\n${bare.out}`)
  assert.ok(!bare.out.includes('unplanned-files: none'), `files 없는 plan 이 none 으로 읽혔다 — 꺼진 검사가 통과처럼 보인다:\n${bare.out}`)
})

test('pr-context runs without a profile and reports disabled features', (t) => {
  const d = temp(t, 'pr-tools-bare')
  git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  put(join(d, 'src/a.ts'), 'export const a = 1\n')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')
  git(d, 'checkout', '-q', '-b', 'feat/x')
  put(join(d, 'src/b.ts'), 'export const b = 2\n')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'feat: b')

  const r = run('bash', [script('pr-context.sh')], { cwd: d })
  assert.equal(r.code, 0, r.out)
  assert.ok(r.out.includes('profile: 없음'), `꺼진 검사를 안 알린다 — 미검사가 통과로 읽힌다:\n${r.out}`)
  assert.ok(r.out.includes('artifact-set: none'), `산출물 세트 없음을 알리지 않았다:\n${r.out}`)
})

test('pr-body-lint rejects missing risk areas and artifact-set citations', (t) => {
  const d = prRepo(t)
  const env = { ...process.env, PR_BODY_LINT_BASE: 'main' }

  const bare = join(d, 'bare.md')
  put(bare, '## 🎯 Intent\n\n집행 전 취소를 허용한다.\n\n## 🔍 Problem\n\n취소 창구가 CS 뿐이라 1건에 2.3영업일이 든다.\n')
  const r1 = run('bash', [script('pr-body-lint.sh'), bare], { cwd: d, env })
  assert.equal(r1.code, 1, `위험 축과 산출물 세트 인용이 없는 본문을 통과시켰다:\n${r1.out}`)
  assert.ok(r1.out.includes('DB 스키마'), `어느 축이 걸렸는지 안 알려준다:\n${r1.out}`)
  assert.ok(r1.out.includes('[추적성]'), `산출물을 변경했는데 근거 ID 누락을 잡지 못했다:\n${r1.out}`)

  const full = join(d, 'full.md')
  put(full, `## 🎯 Intent

집행 전 취소를 허용한다 (근거: OUT-001).

## 🔍 Problem

취소 창구가 CS 뿐이라 1건에 2.3영업일이 든다.

## ⚠️ Risks & Review Points

Risk 는 확률이 아니라 틀렸을 때 치르는 대가다.

| Area | Risk | Review Point |
| --- | --- | --- |
| Business Logic | 🔴 High | 잘못된 상태 전이가 발생하지 않는가 |

> **Reviewer Focus:** 전이표는 한 곳에서만 정의된다 (RISK-001).
`)
  const r2 = run('bash', [script('pr-body-lint.sh'), full], { cwd: d, env })
  assert.equal(r2.code, 0, `제대로 쓴 본문을 막았다:\n${r2.out}`)
})

test('pr-body-lint performs format checks outside a Git repository', (t) => {
  const d = temp(t, 'pr-tools-nogit')
  const f = join(d, 'body.md')
  put(f, '## Intent\n\n검사를 통과합니다.\n')
  const r = run('bash', [script('pr-body-lint.sh'), f], { cwd: d })
  assert.equal(r.code, 1, `합쇼체를 통과시켰다:\n${r.out}`)
  assert.ok(r.out.includes('[문체]'), `형식 검사가 안 돌았다:\n${r.out}`)
})

test('pr-body-lint selects prose rules from the profile language', (t) => {
  /** Applying Korean lists to English prose produces no findings, which is indistinguishable from a pass. */
  const d = temp(t, 'pr-tools-lang')
  git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 'eval@local'); git(d, 'config', 'user.name', 'eval')
  put(join(d, 'a.txt'), 'x\n')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base')
  const body = join(d, 'body.md')
  put(body, '## 🎯 Intent\n\nAfter some discussion we changed it.\n\nIn order to fix it we utilize a cache.\n')
  const lint = () => run('bash', [script('pr-body-lint.sh'), body], { cwd: d })

  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nlang: ko\n')
  const asKo = lint()
  assert.equal(asKo.code, 0, `한국어 규칙이 영문 본문에 걸렸다:\n${asKo.out}`)

  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nlang: en\n')
  const asEn = lint()
  assert.equal(asEn.code, 1, `lang: en 인데 영어 규칙이 안 돌았다:\n${asEn.out}`)
  assert.ok(asEn.out.includes('[경위]'), `영어 경위 서술을 안 잡는다 — 대소문자일 수 있다:\n${asEn.out}`)
  assert.ok(asEn.out.includes('[군더더기]'), `영어 군더더기를 안 잡는다:\n${asEn.out}`)
  assert.ok(!asEn.out.includes('우리말로'), `영문 본문에 «우리말로 바꾼다» 라고 지적했다:\n${asEn.out}`)
})

test('PR body templates pass only after instructional comments are removed', (t) => {
  const d = temp(t, 'pr-tools-template')
  const raw = join(d, 'raw.md')
  const template = join(SKILL, 'assets/ko/pr-body-template.md')
  const body = spawnSync('cat', [template], { encoding: 'utf8' }).stdout
  writeFileSync(raw, body)
  const r = run('bash', [script('pr-body-lint.sh'), raw], { cwd: d })
  assert.equal(r.code, 1, '주석과 빈 표 행이 남은 템플릿을 통과시켰다')
  assert.ok(r.out.includes('[템플릿]'), `템플릿 잔재를 안 잡는다:\n${r.out}`)
})
