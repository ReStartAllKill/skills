import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawnSync } from 'node:child_process'
const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS = resolve(HERE, '../tools')
const SOURCE = resolve(HERE, '../../skills/sdlc/create-light/evals/cases/clean-light-v7/docs')
const put = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s) }
const run = (tool, args, opts = {}) => {
  const r = spawnSync(process.execPath, [join(TOOLS, tool), ...args], { encoding: 'utf8', ...opts })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), stdout: r.stdout }
}
const git = (d, ...args) => {
  const r = spawnSync('git', ['-C', d, '-c', 'user.name=eval', '-c', 'user.email=eval@local', ...args], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
function repo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  const spec = join(d, 'specs/change')
  cpSync(SOURCE, spec, { recursive: true })
  // Fixtures carry their own profiles; this test needs one repository-wide policy.
  put(join(spec, '.claude/spec-profile.yml'), 'sdlc_version: 7\nspec_dir: .\nlang: ko\napproval_mode: batch_light\n')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 7\nspec_dir: specs\nlang: ko\napproval_mode: batch_light\n')
  for (const name of ['intent', 'spec', 'plan']) {
    const p = join(spec, name + '.md')
    put(p, readFileSync(p, 'utf8').replace('status: accepted', 'status: in_review').replace(/^approved_by:.*$/m, 'approved_by: null'))
  }
  return { d, spec }
}
const prepare = (spec) => {
  const r = run('approve-set.mjs', [spec, '--approver', 'Reviewer', '--prepare'])
  assert.equal(r.code, 0, r.out)
  return JSON.parse(r.stdout)
}
const hook = (command, d) => {
  const r = spawnSync('bash', [join(TOOLS, 'guard-approval.sh')], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: d },
    input: JSON.stringify({ tool_name: 'Bash', cwd: d, tool_input: { command } }) })
  return { code: r.status, stdout: r.stdout, out: r.stdout + r.stderr }
}

test('one digest-bound light approval requests permission then applies the reviewed files', () => {
  const { d, spec } = repo('sdlc-batch-')
  const preview = prepare(spec)
  const command = `node '${join(TOOLS, 'approve-set.mjs')}' '${spec}' --approver Reviewer --apply ${preview.digest}`
  const r = hook(command, d)
  assert.equal(r.code, 0, r.out)
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask')
  assert.ok(preview.files.every((f) => readFileSync(join(spec, f.name), 'utf8') === f.before), 'prepare/hook changed documents')
  assert.equal(hook(command + '; echo surprise', d).code, 2)
  const applied = run('approve-set.mjs', [spec, '--approver', 'Reviewer', '--apply', preview.digest])
  assert.equal(applied.code, 0, applied.out)
  for (const f of preview.files) assert.equal(readFileSync(join(spec, f.name), 'utf8'), f.after)
  assert.equal(JSON.parse(readFileSync(join(spec, '.approval', preview.digest + '.json'))).status, 'approved')
  assert.equal(run('check-artifacts.mjs', [spec]).code, 0)
})

test('editing a reviewed document invalidates the approval digest without approving any file', () => {
  const { spec } = repo('sdlc-batch-stale-')
  const preview = prepare(spec)
  const plan = join(spec, 'plan.md')
  put(plan, readFileSync(plan, 'utf8') + '\n')
  const r = run('approve-set.mjs', [spec, '--approver', 'Reviewer', '--apply', preview.digest])
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /검토 이후/)
  for (const name of ['intent', 'spec', 'plan']) assert.match(readFileSync(join(spec, name + '.md'), 'utf8'), /status: in_review/)
})

test('advisory and error prose policy agree between save-time lint and CI', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdlc-lint-policy-'))
  const spec = join(d, 'specs/change')
  cpSync(resolve(HERE, '../../skills/sdlc/create-intent/evals/cases/intent-english/docs'), spec, { recursive: true })
  // Keep fixture language at its original default to produce the known language warning.
  for (const dir of [d, spec]) put(join(dir, '.claude/spec-profile.yml'), 'sdlc_version: 3\nspec_dir: specs\nlang: ko\nlint_warnings: advisory\n')
  let r = run('check-all.mjs', [d])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /⚠/)
  assert.equal(run('lint-prose.mjs', [spec]).code, 0)
  for (const dir of [d, spec]) put(join(dir, '.claude/spec-profile.yml'), 'sdlc_version: 3\nspec_dir: specs\nlang: ko\nlint_warnings: error\n')
  assert.equal(run('lint-prose.mjs', [spec]).code, 1)
  assert.equal(run('check-all.mjs', [d]).code, 1)
})

test('autonomous execution preserves out-of-scope edits and refuses to commit', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdlc-outside-')), bin = mkdtempSync(join(tmpdir(), 'sdlc-cli-'))
  put(join(d, '.claude/spec-profile.yml'), 'spec_dir: specs\n')
  put(join(d, '.claude/autonomy.yml'), 'version: 1\nowner: reviewer\nroutes:\n  triage:\n    trigger: manual\n    max_tier: light\n    advance_to: finding\n    tools: Read,Edit,Write\n    expires: 2099-12-31\n')
  assert.equal(run('install-hook.mjs', [d]).code, 0)
  git(d, 'init', '-q'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'initial')
  const before = git(d, 'rev-parse', 'HEAD')
  put(join(bin, 'claude'), '#!/bin/sh\nprintf changed > unrelated.txt\nprintf \'%s\\n\' \'{"type":"result","subtype":"success","is_error":false}\'\n')
  chmodSync(join(bin, 'claude'), 0o755)
  const r = run('dispatch-auto.mjs', [d, '--route', 'triage', '--signal', 'test'], { env: { ...process.env, PATH: bin + ':' + process.env.PATH } })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /위임 범위 밖/)
  assert.equal(readFileSync(join(d, 'unrelated.txt'), 'utf8'), 'changed')
  assert.equal(git(d, 'rev-parse', 'HEAD'), before)
  const log = JSON.parse(readFileSync(join(d, '.claude/autonomy-runs.jsonl'), 'utf8').trim())
  assert.equal(log.scope, 'fail'); assert.equal(log.commit, null)
})

test('policy expiry preserves a committed approval but cannot authorize changed content', () => {
  const d = mkdtempSync(join(tmpdir(), 'sdlc-history-')), spec = join(d, 'specs/change')
  put(join(d, '.claude/spec-profile.yml'), 'sdlc_version: 7\nspec_dir: specs\nlang: ko\n')
  put(join(d, '.claude/autonomy.yml'), 'version: 1\nowner: reviewer\nroutes:\n  triage:\n    trigger: manual\n    max_tier: light\n    advance_to: intent\n    tools: Read,Edit,Write\n    expires: 2021-01-01\n')
  const text = readFileSync(join(SOURCE, 'intent.md'), 'utf8').replace(/^approved_by:.*$/m, 'approved_by: policy:triage')
  put(join(spec, 'intent.md'), text)
  git(d, 'init', '-q'); git(d, 'add', '.')
  const r = spawnSync('git', ['-C', d, '-c', 'user.name=eval', '-c', 'user.email=eval@local', 'commit', '-qm', 'accepted in 2020'], {
    encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T12:00:00Z' },
  })
  assert.equal(r.status, 0, r.stderr)
  const old = run('check-artifacts.mjs', [spec])
  assert.equal(old.code, 0, old.out)
  put(join(spec, 'intent.md'), text + '\nA new requirement changes the contract.\n')
  const changed = run('check-artifacts.mjs', [spec])
  assert.equal(changed.code, 1, changed.out)
  assert.match(changed.out, /만료/)
})


test('an approval lock preserves documents when another application is pending', () => {
  const { spec } = repo('sdlc-batch-locked-')
  const preview = prepare(spec)
  mkdirSync(join(spec, '.approval/lock'), { recursive: true })
  const r = run('approve-set.mjs', [spec, '--approver', 'Reviewer', '--apply', preview.digest])
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /다른 승인/)
  assert.equal(existsSync(join(spec, '.approval', preview.digest + '.json')), false)
  for (const f of preview.files) assert.equal(readFileSync(join(spec, f.name), 'utf8'), f.before)
})
