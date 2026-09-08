import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))

// 실제 CLI를 격리된 레포에 복사하고 검사기만 교체해 실패 처리와 실행 분기를 검증한다.
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
  put(join(evals, 'runtime-smoke.mjs'), `console.log('runtime sentinel'); process.exit(${runtimeCode})`)
  put(join(root, 'sdlc-runtime/tools/check-artifacts.mjs'), check)
  put(join(root, 'sdlc-runtime/tools/lint-prose.mjs'), lint)
  if (documents) {
    const skill = join(root, 'skills/create-intent')
    put(join(skill, 'SKILL.md'), '---\nname: create-intent\ndescription: fixture\n---\n')
    put(join(skill, 'evals/cases/sample/docs/intent.md'), 'fixture\n')
    put(join(skill, 'evals/cases/sample/expected.json'), JSON.stringify(expected))
  }
  // run.mjs가 생성하는 임시 Git 저장소도 테스트 종료 시 함께 정리한다.
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

test('runtime 인자는 문서 케이스가 없어도 런타임만 실행한다', (t) => {
  const r = fixture(t, { documents: false })('runtime')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /runtime sentinel/)
  assert.doesNotMatch(r.out, /0\/0|산출물 도구 평가/)
})

test('runtime 실패는 단독 실행과 전체 실행 모두 실패로 반환한다', (t) => {
  const run = fixture(t, { runtimeCode: 7 })
  for (const args of [['runtime'], []]) {
    const r = run(...args)
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /runtime sentinel/)
  }
})

test('알 수 없는 케이스는 런타임 실행으로 대체하지 않는다', (t) => {
  const r = fixture(t)('unknown')
  assert.equal(r.code, 1, r.out)
  assert.doesNotMatch(r.out, /runtime sentinel/)
})

test('오류 0건 케이스에서 검사기 예외를 정상 결과로 집계하지 않는다', (t) => {
  const r = fixture(t, { check: "throw new Error('checker crashed')" })('sample')
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /종료 코드 1 \(기대 0\)/)
  assert.match(r.out, /checker crashed/)
})

test('경고만 있는 케이스는 종료 코드 0일 때 통과한다', (t) => {
  const r = fixture(t, {
    expected: { lint: { errors: 0, warns: 1, matches: ['warning sentinel'] } },
    lint: "console.log('⚠ 경고 1건\\n  intent.md  warning sentinel')",
  })('sample')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /1\/1 통과/)
  assert.doesNotMatch(r.out, /runtime sentinel/)
})

test('지적 수가 같아도 오류 케이스의 종료 코드가 다르면 실패한다', (t) => {
  for (const code of [0, 1, 2]) {
    const r = fixture(t, {
      expected: { check: { errors: 1, warns: 0, matches: ['error sentinel'] } },
      check: `console.log('✗ 오류 1건\\n  intent.md  error sentinel'); process.exit(${code})`,
    })('sample')
    assert.equal(r.code, code === 1 ? 0 : 1, r.out)
  }
})

test('검사기 시그널 종료를 기대한 오류 종료로 인정하지 않는다', (t) => {
  const r = fixture(t, {
    expected: { check: { errors: 1, warns: 0 } },
    check: "process.stdout.write('✗ 오류 1건\\n  intent.md  error sentinel\\n', () => process.kill(process.pid, 'SIGTERM'))",
  })('sample')
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /시그널 종료/)
})

test('인자 없는 실행은 문서와 런타임을 모두 검증한다', (t) => {
  const r = fixture(t)()
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /1\/1 통과/)
  assert.match(r.out, /runtime sentinel/)
})
