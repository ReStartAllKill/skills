/** The verification policy `/implement-spec` follows, pinned against the tools that enforce it.
 *
 * The procedure now runs the task-scoped command at intermediate join points and the profile's
 * full `verify` only at the final level. That is only safe because of three properties of
 * `plan-progress.mjs`: a labelled log is never completion evidence, the newest full log is the
 * only candidate considered, and `plan-check mark` refuses a task that log does not cover. If any
 * of the three changed, the procedure would be claiming evidence it does not have — so they are
 * asserted here rather than left to the prose.
 *
 * Every fixture log is written by running `verify-run.mjs`, not by hand: a change to the header
 * format must break this file instead of quietly changing what the procedure may claim. The full
 * verify command is `test ! -f .verify-fail` over a git-ignored file, because the repository
 * fingerprint covers tracked and non-ignored files — flipping the result through a tracked script
 * would invalidate the earlier log for the wrong reason and the "newest wins" test would pass
 * without testing anything. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const tool = (name) => resolve(HERE, '../tools', name)

const SLUG = '2026-09-10-verify-policy'
const SPEC_REL = `.sdlc/specs/${SLUG}`
const PLAN_REL = `${SPEC_REL}/plan.md`
/** The profile's full `verify`. Its exit code follows a git-ignored file, so the repository
 *  fingerprint is identical whether it passes or fails. */
const FULL = 'test ! -f .verify-fail'
const SCOPED = 'test ! -f .scoped-fail'

const temp = (prefix) => mkdtempSync(join(tmpdir(), `${prefix}-`))
const put = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body) }

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}\n${r.stdout}${r.stderr}`)
  return r.stdout.trim()
}
function run(name, ...args) {
  const r = spawnSync(process.execPath, [tool(name), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? ''), stdout: r.stdout ?? '' }
}
function progress(dir) {
  const r = run('plan-progress.mjs', dir, '--json')
  return JSON.parse(r.stdout)
}
const row = (dir, id) => progress(dir).rows.find((x) => x.id === id)

const PROFILE = [
  'sdlc_version: 7',
  'lang: en',
  'spec_dir: ".sdlc/specs"',
  'verify_log_dir: ".sdlc/verify"',
  `verify: ${FULL}`,
  `verify_scoped: ${SCOPED}`,
  '',
].join('\n')

const PLAN = `---
artifact: plan
schema_version: 7
id: "PLAN-2026-001"
title: "Two tasks on two levels"
status: in_progress
tier: standard
approved_by: "owner"
---

# Plan: two tasks on two levels

## Release impact

target_branch: main
pr_strategy: one PR

## Tasks

- [ ] **WP-001 — First change**
  - files: \`src/a.js\`, \`src/a.test.js\`
  - depends: none
  - covers: FR-001 (AC-001)
  - tests: the first criterion holds
  - verify: ${SCOPED}

- [ ] **WP-002 — Second change**
  - files: \`src/b.js\`, \`src/b.test.js\`
  - depends: WP-001
  - covers: FR-002 (AC-002)
  - tests: the second criterion holds
  - verify: ${SCOPED}

## Execution log

N/A — not started.
`

/** A repository whose plan has WP-001 on level 1 and WP-002 on level 2, both implemented and
 *  committed with their trailers, and nothing verified yet. */
function repo(prefix, { second = true } = {}) {
  const d = temp(prefix)
  git(d, 'init', '-q', '-b', 'main')
  git(d, 'config', 'user.email', 'eval@local')
  git(d, 'config', 'user.name', 'eval')
  put(join(d, '.claude/spec-profile.yml'), PROFILE)
  put(join(d, '.gitignore'), '.verify-fail\n.scoped-fail\n')
  put(join(d, PLAN_REL), PLAN)
  put(join(d, 'src/a.js'), 'export const a = 0\n')
  put(join(d, 'src/a.test.js'), "test('the first criterion holds', () => {})\n")
  put(join(d, 'src/b.js'), 'export const b = 0\n')
  put(join(d, 'src/b.test.js'), "test('the second criterion holds', () => {})\n")
  git(d, 'add', '-A')
  git(d, 'commit', '-qm', 'plan born')

  const task = (id, file, body) => {
    put(join(d, file), body)
    git(d, 'add', file)
    git(d, 'commit', '-qm', `feat: ${id}`, '-m', `SDLC-Task: ${id}\nSDLC-Plan: ${PLAN_REL}`)
  }
  task('WP-001', 'src/a.js', 'export const a = 1\n')
  if (second) task('WP-002', 'src/b.js', 'export const b = 1\n')
  return { dir: d, spec: join(d, SPEC_REL) }
}

const verify = (spec, { level, tasks, label, command = FULL }) =>
  run('verify-run.mjs', spec, '--level', String(level), '--tasks', tasks.join(','),
    ...(label ? ['--label', label] : []), '--', command)

const logNames = (dir) => readdirSync(join(dir, '.sdlc/verify', SLUG)).sort()
const header = (dir, name) => readFileSync(join(dir, '.sdlc/verify', SLUG, name), 'utf8').split('\n---\n')[0]

// ── 1. a labelled log is never completion evidence ─────────────────────────────────────────────

test('a passing scoped log leaves the task unverified and mark refuses it', () => {
  const { dir, spec } = repo('vp-scoped')

  let r = verify(spec, { level: 1, tasks: ['WP-001'], label: 'scoped', command: SCOPED })
  assert.equal(r.code, 0, r.out)
  assert.equal(row(spec, 'WP-001').verified.length, 0,
    'a scoped log counted as completion evidence')

  // The label alone must disqualify it: the same command as the profile's `verify`, passing,
  // covering the task — and still not evidence, because it was recorded under a label.
  r = verify(spec, { level: 1, tasks: ['WP-001'], label: 'gate' })
  assert.equal(r.code, 0, r.out)
  assert.equal(row(spec, 'WP-001').verified.length, 0,
    'a labelled run of the full command counted as completion evidence')

  const notes = progress(spec).notes.filter((n) => n.id === 'WP-001')
  assert.ok(!notes.some((n) => n.level === 'error'), JSON.stringify(notes))

  const mark = run('plan-check.mjs', spec, 'mark', 'WP-001', '--note', 'none')
  assert.notEqual(mark.code, 0, `mark accepted a task with only labelled logs:\n${mark.out}`)
  assert.match(mark.out, /verify-run/)
  assert.equal(row(spec, 'WP-001').done, false, 'mark ticked the checkbox anyway')
})

// ── 2. the final full verify is what marks every task ──────────────────────────────────────────

test('one final full verify over every task lets both tasks be marked', () => {
  const { dir, spec } = repo('vp-final')

  // Level 1 ran scoped only; the final level runs the full command over every task in the plan.
  assert.equal(verify(spec, { level: 1, tasks: ['WP-001'], label: 'scoped', command: SCOPED }).code, 0)
  const r = verify(spec, { level: 2, tasks: ['WP-001', 'WP-002'] })
  assert.equal(r.code, 0, r.out)

  for (const id of ['WP-001', 'WP-002']) {
    assert.equal(row(spec, id).verified.length, 1, `${id} is not verified by the final full log`)
  }
  for (const id of ['WP-001', 'WP-002']) {
    const mark = run('plan-check.mjs', spec, 'mark', id, '--note', 'none')
    assert.equal(mark.code, 0, mark.out)
  }

  const after = progress(spec)
  for (const id of ['WP-001', 'WP-002']) {
    const w = after.rows.find((x) => x.id === id)
    assert.equal(w.done, true, `${id} was not ticked`)
    assert.equal(w.verified.length, 1, `${id} lost its evidence when the plan was edited`)
  }
  assert.ok(!after.notes.some((n) => /verify/.test(n.msg)), JSON.stringify(after.notes))
  assert.equal(logNames(dir).length, 2)
})

// ── 3. the newest full log wins, and an older pass does not replace it ─────────────────────────

test('a newer failing full log is not replaced by an older passing one', () => {
  const { dir, spec } = repo('vp-newest')

  assert.equal(verify(spec, { level: 2, tasks: ['WP-001', 'WP-002'] }).code, 0)
  assert.equal(row(spec, 'WP-001').verified.length, 1, 'the passing full log was not evidence')

  // A later run of the same command over the same tasks, failing. Removing the trigger
  // afterwards restores the repository to the state the passing log fingerprinted, so the only
  // reason the older log cannot be used is that a newer one exists.
  writeFileSync(join(dir, '.verify-fail'), '')
  const failed = verify(spec, { level: 2, tasks: ['WP-001', 'WP-002'] })
  assert.notEqual(failed.code, 0, 'the failing command exited 0')
  rmSync(join(dir, '.verify-fail'))

  for (const id of ['WP-001', 'WP-002']) {
    assert.equal(row(spec, id).verified.length, 0,
      `${id} used the older passing log after a newer full run failed`)
  }
  const mark = run('plan-check.mjs', spec, 'mark', 'WP-001', '--note', 'none')
  assert.notEqual(mark.code, 0, `mark accepted a task whose newest full verify failed:\n${mark.out}`)
})

// ── 4. what the header records ─────────────────────────────────────────────────────────────────

test('--label records the label in the header and an unlabelled run records none', () => {
  const { dir, spec } = repo('vp-header')

  assert.equal(verify(spec, { level: 1, tasks: ['WP-001'], label: 'scoped', command: SCOPED }).code, 0)
  const [scoped] = logNames(dir)
  assert.ok(scoped.startsWith('L1-scoped-'), `the level and label are not in the name: ${scoped}`)
  const scopedHead = header(dir, scoped)
  assert.match(scopedHead, /^label: scoped$/m)
  assert.match(scopedHead, new RegExp(`^command: ${JSON.stringify(SCOPED)}$`, 'm'))
  assert.match(scopedHead, /^exit: 0$/m)

  assert.equal(verify(spec, { level: 2, tasks: ['WP-001', 'WP-002'] }).code, 0)
  const full = logNames(dir).find((n) => n.startsWith('L2-'))
  assert.doesNotMatch(header(dir, full), /^label:/m, 'an unlabelled run wrote a label')
})

// ── 5. which logs `plan-check commit` stages ───────────────────────────────────────────────────

test('commit --level stages the logs of that level only, labelled ones included', () => {
  const { dir, spec } = repo('vp-commit')

  assert.equal(verify(spec, { level: 1, tasks: ['WP-001'], label: 'scoped', command: SCOPED }).code, 0)
  assert.equal(verify(spec, { level: 2, tasks: ['WP-001', 'WP-002'] }).code, 0)
  const names = logNames(dir)
  const scoped = names.find((n) => n.startsWith('L1-scoped-'))
  const full = names.find((n) => n.startsWith('L2-'))

  // The intermediate scoped log is reachable only through its own level, which is why the
  // procedure runs `commit` once per level at the end instead of once for the final level.
  const one = run('plan-check.mjs', spec, 'commit', '--level', '1', '--dry-run')
  assert.equal(one.code, 0, one.out)
  assert.ok(one.out.includes(scoped), `level 1 did not stage the scoped log:\n${one.out}`)
  assert.ok(!one.out.includes(full), `level 1 staged the final level's log:\n${one.out}`)
  assert.ok(one.out.includes(PLAN_REL), `the plan was not staged:\n${one.out}`)

  const two = run('plan-check.mjs', spec, 'commit', '--level', '2', '--dry-run')
  assert.equal(two.code, 0, two.out)
  assert.ok(two.out.includes(full), `level 2 did not stage the full log:\n${two.out}`)
  assert.ok(!two.out.includes(scoped), `level 2 staged level 1's log:\n${two.out}`)
})


test('failed and partial attempts stay unchecked and can later complete with evidence', () => {
  const { spec } = repo('vp-attempt')
  for (const result of ['failed', 'partial']) {
    const r = run('plan-check.mjs', spec, 'mark', 'WP-001', '--result', result, '--note', 'criterion not met')
    assert.equal(r.code, 0, r.out)
    assert.equal(row(spec, 'WP-001').done, false)
    assert.match(readFileSync(join(spec, 'plan.md'), 'utf8'), new RegExp(`WP-001 — ${result}`))
  }
  assert.equal(verify(spec, { level: 2, tasks: ['WP-001', 'WP-002'] }).code, 0)
  assert.equal(run('plan-check.mjs', spec, 'mark', 'WP-001', '--note', 'none').code, 0)
  assert.equal(row(spec, 'WP-001').done, true)
})


const resume = (spec) => {
  const r = run('plan-resume.mjs', spec, '--json')
  const report = JSON.parse(r.stdout)
  assert.notEqual(r.code, 2, r.out)
  return report
}

test('resume advances after scoped verification without marking or reimplementing earlier work', () => {
  const { dir, spec } = repo('vp-resume', { second: false })
  assert.equal(resume(spec).action, 'verify_scoped')
  assert.equal(verify(spec, { level: 1, tasks: ['WP-001'], label: 'scoped', command: SCOPED }).code, 0)
  let next = resume(spec)
  assert.equal(next.action, 'implement')
  assert.equal(next.level, 2)
  assert.deepEqual(next.tasks, ['WP-002'])
  assert.equal(row(spec, 'WP-001').done, false)
  put(join(dir, 'src/b.js'), 'export const b = 1\n')
  assert.equal(resume(spec).action, 'blocked', 'uncommitted human edits were not preserved')
  git(dir, 'add', 'src/b.js')
  git(dir, 'commit', '-qm', 'second task', '-m', `SDLC-Task: WP-002\nSDLC-Plan: ${PLAN_REL}`)
  assert.equal(resume(spec).action, 'verify_full', 'historical scoped evidence was lost after a later task')
  assert.equal(verify(spec, { level: 2, tasks: ['WP-001', 'WP-002'] }).code, 0)
  assert.equal(resume(spec).action, 'record')
  for (const id of ['WP-001', 'WP-002']) assert.equal(run('plan-check.mjs', spec, 'mark', id, '--note', 'none').code, 0)
  assert.equal(resume(spec).action, 'record', 'pending plan/log edits should be committed, not block recovery')
  for (const level of ['1', '2']) assert.equal(run('plan-check.mjs', spec, 'commit', '--level', level).code, 0)
  assert.equal(resume(spec).action, 'review_completion')
  put(join(spec, 'plan.md'), readFileSync(join(spec, 'plan.md'), 'utf8').replace('status: in_progress', 'status: completed'))
  assert.equal(resume(spec).action, 'commit_completion')
  git(dir, 'add', PLAN_REL); git(dir, 'commit', '-qm', 'completed')
  assert.equal(resume(spec).action, 'complete')
})

test('resume does not use an older scoped pass after a newer failure', () => {
  const { dir, spec } = repo('vp-resume-fail', { second: false })
  assert.equal(verify(spec, { level: 1, tasks: ['WP-001'], label: 'scoped', command: SCOPED }).code, 0)
  put(join(dir, '.scoped-fail'), '')
  assert.equal(verify(spec, { level: 1, tasks: ['WP-001'], label: 'scoped', command: SCOPED }).code, 1)
  rmSync(join(dir, '.scoped-fail'))
  assert.equal(resume(spec).action, 'verify_scoped')
})
