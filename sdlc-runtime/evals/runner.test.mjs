import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))

// Copy the real CLI into an isolated repository and replace only the checker to verify failure handling and execution branches.
function fixture(t, { expected = {}, check = '', lint = '', runtimeCode = 0, documents = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sdlc-runner-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, body) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
  }
  const evals = join(root, 'sdlc-runtime/evals')
  mkdirSync(evals, { recursive: true })
  for (const file of ['run.mjs', 'skills.mjs']) copyFileSync(join(HERE, file), join(evals, file))
  mkdirSync(join(root, 'sdlc-runtime/tools'), { recursive: true })
  copyFileSync(join(HERE, '../tools/rules.mjs'), join(root, 'sdlc-runtime/tools/rules.mjs'))
  put(join(evals, 'runtime-smoke.mjs'), `console.log('runtime sentinel'); process.exit(${runtimeCode})`)
  put(join(root, 'sdlc-runtime/tools/check-artifacts.mjs'), check)
  put(join(root, 'sdlc-runtime/tools/lint-prose.mjs'), lint)
  if (documents) {
    const skill = join(root, 'skills/create-intent')
    put(join(skill, 'SKILL.md'), '---\nname: create-intent\ndescription: fixture\n---\n')
    put(join(skill, 'evals/cases/sample/docs/intent.md'), 'fixture\n')
    put(join(skill, 'evals/cases/sample/expected.json'), JSON.stringify(expected))
  }
  // Also remove temporary Git repositories created by run.mjs after the test.
  const temp = join(root, 'tmp')
  mkdirSync(temp)
  return (...args) => {
    const result = spawnSync(process.execPath, [join(evals, 'run.mjs'), ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env, TMPDIR: temp },
    })
    assert.ifError(result.error)
    return { code: result.status, out: result.stdout + result.stderr }
  }
}

test('the runtime argument runs runtime checks without document cases', (t) => {
  const r = fixture(t, { documents: false })('runtime')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /runtime sentinel/)
  assert.doesNotMatch(r.out, /0\/0|산출물 도구 평가/)
})

test('runtime failures fail both standalone and full runs', (t) => {
  const run = fixture(t, { runtimeCode: 7 })
  for (const args of [['runtime'], []]) {
    const r = run(...args)
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /runtime sentinel/)
  }
})

test('an unknown case does not fall back to a runtime run', (t) => {
  const r = fixture(t)('unknown')
  assert.equal(r.code, 1, r.out)
  assert.doesNotMatch(r.out, /runtime sentinel/)
})

test('a checker exception is not counted as success when zero errors are expected', (t) => {
  const r = fixture(t, { check: "throw new Error('checker crashed')" })('sample')
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /종료 코드 1 \(기대 0\)/)
  assert.match(r.out, /checker crashed/)
})

test('a case can require a note, and a missing one fails it', (t) => {
  const check = "console.log('\\n제목\\n  · ADR-001.md — `adr-scope-empty` 면제 1건: no code path\\n\\n통과')"
  const pass = fixture(t, { expected: { check: { errors: 0, warns: 0, notes: ['`adr-scope-empty` 면제 1건: no code path'] } }, check })('sample')
  assert.equal(pass.code, 0, pass.out)
  const fail = fixture(t, { expected: { check: { errors: 0, warns: 0, notes: ['`adr-confirms-empty` 면제'] } }, check })('sample')
  assert.equal(fail.code, 1, fail.out)
  assert.match(fail.out, /노트에 «`adr-confirms-empty` 면제» 이 없다/)
})

test('a checker problem without a registered rule fails its case', (t) => {
  const report = (line) => `console.log('산출물 추적성 검사 — sample\\n\\n⚠ 경고 1건\\n\\n  intent.md  ${line}')`
  const expected = { check: { errors: 0, warns: 1 } }
  for (const [line, why] of [['[made-up-rule] x', /no registered rule \(made-up-rule\)/], ['[pin-dead] x', /pin-dead is registered as error but reported as warn/], ['x', /no registered rule \(none\)/]]) {
    const r = fixture(t, { expected, check: report(line) })('sample')
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, why)
  }
  const ok = fixture(t, { expected, check: report('[adr-scope-empty] x') })('sample')
  assert.equal(ok.code, 0, ok.out)
  assert.match(ok.out, /규칙 대조 — 검사 보고서 1개 · 지적 1건/)
})

test('a warning-only case passes with exit code zero', (t) => {
  const r = fixture(t, {
    expected: { lint: { errors: 0, warns: 1, matches: ['warning sentinel'] } },
    lint: "console.log('⚠ 경고 1건\\n  intent.md  warning sentinel')",
  })('sample')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /1\/1 통과/)
  assert.doesNotMatch(r.out, /runtime sentinel/)
})

test('an error case fails when its exit code differs even if problem counts match', (t) => {
  for (const code of [0, 1, 2]) {
    const r = fixture(t, {
      expected: { check: { errors: 1, warns: 0, matches: ['error sentinel'] } },
      check: `console.log('산출물 추적성 검사 — sample\\n\\n✗ 오류 1건\\n\\n  intent.md  [intent-missing] error sentinel'); process.exit(${code})`,
    })('sample')
    assert.equal(r.code, code === 1 ? 0 : 1, r.out)
  }
})

test('a checker terminated by signal is not accepted as the expected error exit', (t) => {
  const r = fixture(t, {
    expected: { check: { errors: 1, warns: 0 } },
    check: "process.stdout.write('산출물 추적성 검사 — sample\\n\\n✗ 오류 1건\\n\\n  intent.md  [intent-missing] error sentinel\\n', () => process.kill(process.pid, 'SIGTERM'))",
  })('sample')
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /시그널 종료/)
})

test('a run without arguments checks both documents and runtime', (t) => {
  const r = fixture(t)()
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /1\/1 통과/)
  assert.match(r.out, /runtime sentinel/)
})
