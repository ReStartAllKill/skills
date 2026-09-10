/** check-set.mjs, the guard's refusal of self-approval, and task-worktree's `finish`.
 *
 * All three exist to collapse tool calls that always follow each other, so what each test asserts
 * is the *seam*: that the merged report still carries both authorities and both exit codes, that
 * the guard's refusal happens before the dialog rather than after it, and that a `finish` which
 * stops halfway says where it stopped. Fixtures are written at schema 5 — the rules under test
 * predate v7 and a fixture pinned to the newest version would break whenever a v7 rule moves. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const tool = (name) => resolve(HERE, '../tools', name)

const temp = (prefix) => mkdtempSync(join(tmpdir(), `${prefix}-`))
const put = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body) }

function run(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', out: (r.stdout ?? '') + (r.stderr ?? '') }
}
function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}\n${r.stdout}${r.stderr}`)
  return r.stdout.trim()
}

// ── check-set.mjs ──────────────────────────────────────────────────────────────────────────────

const checkSet = (dir, ...args) => run(process.execPath, [tool('check-set.mjs'), dir, ...args])

/** «in order to» is on the linter's translationese list and nothing in the checker reads it. */
const LINTED = 'In order to keep the index small, no caller changes.'

/** The body line carries the linter's rule and the frontmatter carries the checker's
 *  (`approved_by` must differ from `generated_by`), so one document reaches both tools with
 *  something to say. */
const intentDoc = ({ status = 'draft', approver = 'null', prose = 'No caller changes.' } = {}) => `---
artifact: intent
schema_version: 5
id: "CHG-2026-001"
title: "Trim the archived index"
status: ${status}
tier: light
owner: "Han Jiu"
created: 2026-09-10
updated: 2026-09-10
generated_by: "claude-opus-5"
approved_by: ${approver}
---

## Outcomes \`[required · all tiers]\`

### OUT-001 — Archived documents leave the search index

A query over the index reads only active documents.

## Constraints \`[required · all tiers]\`

### CON-001 — The public search API keeps its shape

${prose}

## Assumptions \`[required · all tiers]\`

N/A — nothing is assumed.

## Open questions \`[required · all tiers]\`

N/A — nothing is open.
`

function setRepo(prefix, doc) {
  const d = temp(prefix)
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nlang: en\nspec_dir: "docs"\n')
  put(join(d, 'docs/intent.md'), doc)
  git(d, 'init', '-q', '-b', 'main')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'set born')
  return join(d, 'docs')
}

test('a clean set exits 0 and --strict turns the linter\'s warning into a failure', () => {
  const dir = setRepo('cs-clean', intentDoc())
  const clean = checkSet(dir)
  assert.equal(clean.code, 0, clean.out)

  const warned = setRepo('cs-warn', intentDoc({ prose: LINTED }))
  const loose = checkSet(warned)
  assert.equal(loose.code, 0, loose.out)
  const strict = checkSet(warned, '--strict')
  assert.equal(strict.code, 1, strict.out)
})

test('one report carries the checker\'s errors and the linter\'s warnings, and exits 1 for the errors', () => {
  const dir = setRepo('cs-both', intentDoc({
    status: 'accepted', approver: '"claude-opus-5"', prose: LINTED,
  }))
  const r = checkSet(dir)
  assert.equal(r.code, 1, r.out)

  const j = checkSet(dir, '--json')
  assert.equal(j.code, 1, j.out)
  const got = JSON.parse(j.stdout)
  assert.equal(got.version, 1)
  assert.match(got.title, /docs/)
  for (const p of got.problems) assert.ok(['check', 'lint'].includes(p.tool), `problem without a tool: ${JSON.stringify(p)}`)
  const byTool = (t, level) => got.problems.filter((p) => p.tool === t && p.level === level)
  assert.ok(byTool('check', 'error').length > 0, `no checker error in the merged report:\n${j.stdout}`)
  assert.ok(byTool('lint', 'warn').length > 0, `no linter warning in the merged report:\n${j.stdout}`)
  assert.equal(got.counts.errors, got.problems.filter((p) => p.level === 'error').length)
  assert.equal(got.exitCode, 1)
  // The checker is the authority when the two disagree, so its problems are read first.
  assert.equal(got.problems[0].tool, 'check')
})

test('a child that cannot produce a report exits 2 and names the tool that failed', () => {
  const d = temp('cs-broken')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nlang: en\nspec_dir: "docs"\n')
  // A directory where intent.md is itself a directory: both tools throw on read rather than
  // reporting. An unreadable set must never look like a set with nothing wrong in it.
  mkdirSync(join(d, 'docs/intent.md'), { recursive: true })
  const r = checkSet(join(d, 'docs'))
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /lint-prose\.mjs/)
  assert.match(r.out, /check-artifacts\.mjs/)
  assert.match(r.out, /미검사/)
})

// ── the guard refuses self-approval outright ───────────────────────────────────────────────────

function guardRepo(prefix) {
  const d = temp(prefix)
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: ".sdlc/specs"\n')
  const doc = join(d, '.sdlc/specs/2026-09-10-a/intent.md')
  put(doc, '---\nartifact: intent\nschema_version: 5\nstatus: in_review\ngenerated_by: "claude-opus-5"\napproved_by: null\n---\n\n# Intent\n')
  return { d, doc }
}
const approveWith = ({ d, doc }, name) => run(tool('guard-approval.sh'), [], {
  env: { ...process.env, CLAUDE_PROJECT_DIR: d },
  input: JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: doc, old_string: 'status: in_review', new_string: `status: accepted\napproved_by: ${name}` },
  }),
})

test('an approval whose approved_by equals generated_by is refused before the dialog', () => {
  const r = approveWith(guardRepo('cs-guard-self'), 'claude-opus-5')
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /generated_by/)
  assert.ok(!r.stdout.includes('"permissionDecision":"ask"'), `it still asked a question nobody can answer:\n${r.stdout}`)
})

test('an approval by someone other than the writer still reaches the approval dialog', () => {
  const r = approveWith(guardRepo('cs-guard-human'), '한지우')
  assert.equal(r.code, 0, r.out)
  assert.match(r.stdout, /"permissionDecision":"ask"/)
})

// ── task-worktree finish ───────────────────────────────────────────────────────────────────────

const PLAN = `---
artifact: plan
schema_version: 5
status: in_progress
---

## 릴리스 영향

target_branch: feat/tw
pr_strategy: 단일 PR

## 작업

- [ ] **WP-001 — 필터를 만든다**
  - files: \`src/api/filter.js\`
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

## 실행 기록

해당 없음 — 아직 실행 전.
`

function planRepo(prefix) {
  const d = temp(prefix)
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 5\nspec_dir: .sdlc/specs\nworktree_dir: .wt\ntask_branch: "task/{slug}-{task}"\nverify: true\n')
  put(join(d, '.gitignore'), '.wt/\n')
  const spec = join(d, '.sdlc/specs/2026-09-10-tw')
  put(join(spec, 'plan.md'), PLAN)
  put(join(d, 'src/api/filter.js'), 'export const f = 0\n')
  put(join(d, 'src/core/empty.js'), 'export const e = 0\n')
  git(d, 'init', '-q', '-b', 'main')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'plan born')
  git(d, 'switch', '-qc', 'feat/tw')
  const twt = (...a) => run(process.execPath, [tool('task-worktree.mjs'), spec, ...a])
  return { d, spec, twt, wt: (task) => join(d, '.wt', `2026-09-10-tw-${task}`) }
}

test('finish commits, merges and removes one task in a single call', () => {
  const { d, twt, wt } = planRepo('cs-finish')
  assert.equal(twt('add', 'WP-001').code, 0)
  put(join(wt('WP-001'), 'src/api/filter.js'), 'export const f = 1\n')

  const r = twt('finish', 'WP-001', '-m', 'feat(search): filter archived documents')
  assert.equal(r.code, 0, r.out)

  const body = git(d, 'log', '-1', '--format=%B')
  assert.match(body, /SDLC-Task: WP-001/)
  assert.match(body, /SDLC-Plan: \.sdlc\/specs\/2026-09-10-tw\/plan\.md/)
  assert.equal(git(d, 'branch', '--show-current'), 'feat/tw')
  assert.match(git(d, 'show', 'feat/tw:src/api/filter.js'), /f = 1/)
  assert.ok(!existsSync(wt('WP-001')), 'the worktree survived finish')
  assert.equal(git(d, 'branch', '--list', 'task/2026-09-10-tw-WP-001'), '')
})

test('a finish whose merge conflicts stops there, keeps the branch and worktree, and names merge as the resume step', () => {
  const { d, twt, wt } = planRepo('cs-finish-conflict')
  assert.equal(twt('add', 'WP-002').code, 0)
  put(join(wt('WP-002'), 'src/core/empty.js'), 'export const e = 1\n')
  // The target branch moves under the same file, which is the one thing merge cannot resolve.
  put(join(d, 'src/core/empty.js'), 'export const e = 2\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'target branch moved')

  const r = twt('finish', 'WP-002', '-m', 'feat(search): empty query')
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /finish 가 merge 에서 멈췄다/)
  assert.match(r.out, /끝난 단계: commit/)
  assert.match(r.out, /merge WP-002/)
  assert.match(r.out, /remove WP-002/)

  assert.ok(existsSync(wt('WP-002')), 'the worktree was removed although the merge never landed')
  assert.notEqual(git(d, 'branch', '--list', 'task/2026-09-10-tw-WP-002'), '')
  assert.equal(git(d, 'status', '--porcelain', '--untracked-files=no'), '', 'the conflict was left in the main tree')
  assert.match(git(d, 'log', '-1', '--format=%B', 'task/2026-09-10-tw-WP-002'), /SDLC-Task: WP-002/)
})

test('finish refuses --main, where there is no worktree to merge or clean up', () => {
  const { twt } = planRepo('cs-finish-main')
  const r = twt('finish', 'WP-001', '-m', 'feat(search): filter', '--main')
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /--main/)
  assert.match(r.out, /commit WP-001/)
})
