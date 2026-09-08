#!/usr/bin/env node
/** 임시 Git 저장소에서 산출물 검사 결과를 expected.json과 대조한다. 사용법: node run.mjs [케이스 ID|스킬 이름|runtime]. */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, cpSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
import { findSkillDirs } from './skills.mjs'
const TOOLS = resolve(HERE, '../tools')
const only = process.argv[2]
const git = (d, ...a) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function runRuntime() {
  try {
    console.log(execFileSync(process.execPath, [join(HERE, 'runtime-smoke.mjs')], { encoding: 'utf8' }))
    return true
  } catch (e) {
    console.error((e.stdout ?? '') + (e.stderr ?? '') || e.message)
    return false
  }
}

// 런타임 단독 실행은 문서 케이스 탐색과 독립적이다.
if (only === 'runtime') process.exit(runRuntime() ? 0 : 1)

/** SHA 자리표시자를 임시 커밋으로 치환한다. target은 검사할 하위 디렉터리를 지정한다. */
function stage(caseDir, target = ".") {
  const tmp = mkdtempSync(join(tmpdir(), 'spec-eval-'))
  cpSync(join(caseDir, 'docs'), tmp, { recursive: true })
  git(tmp, 'init', '-q'); git(tmp, 'config', 'user.email', 'eval@local'); git(tmp, 'config', 'user.name', 'eval')
  git(tmp, 'add', '-A'); git(tmp, 'commit', '-qm', 'case')
  for (const [token, src, dst] of [['@INTENT_SHA@', 'intent.md', 'spec.md'], ['@SPEC_SHA@', 'spec.md', 'plan.md']]) {
    const t = join(tmp, target, dst)
    if (!existsSync(t)) continue
    const body = readFileSync(t, 'utf8')
    if (!body.includes(token)) continue
    writeFileSync(t, body.replace(token, git(tmp, 'log', '-1', '--format=%h', '--', join(target, src))))
    git(tmp, 'add', '-A'); git(tmp, 'commit', '-qm', `pin ${dst}`)
  }
  return join(tmp, target)
}
function run(tool, dir) {
  try { return { code: 0, out: execFileSync(process.execPath, [join(TOOLS, tool), dir], { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status ?? null, out: (e.stdout ?? '') + (e.stderr ?? '') || e.message } }
}
const strip = (s) => s.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
function findings(out, level) {
  const lines = strip(out).split('\n')
  const start = lines.findIndex((l) => l.includes(level === 'error' ? '오류' : '경고') && /^(✗|⚠)/.test(l))
  if (start < 0) return []
  const res = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(✗|⚠)/.test(lines[i])) break
    const m = /^ {2}(\S+?)(?::(\d+))?\s{2}(.*)$/.exec(lines[i])
    if (m) { res.push(`${m[1]} ${m[3]}`); continue }
    // 들여쓴 힌트도 같은 진단에 포함해 기대 문구와 대조한다.
    if (res.length && /^\s{4,}\S/.test(lines[i])) res[res.length - 1] += ' ' + lines[i].trim()
  }
  return res
}

/** 작성 스킬별 evals/cases에서 평가 케이스를 수집한다. */
const cases = findSkillDirs(HERE)
  .flatMap(({ name: skill, dir: skillDir }) => {
    const dir = join(skillDir, 'evals', 'cases')
    if (!existsSync(dir)) return []
    return readdirSync(dir).map((id) => ({ skill, id, dir: join(dir, id) }))
  })
  .filter((c) => !only || c.id === only || c.skill === only)
  .sort((a, b) => (a.skill + a.id).localeCompare(b.skill + b.id))
const rows = []
let pass = 0, fail = 0
for (const { skill, id, dir } of cases) {
  const exp = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'))
  const staged = stage(dir, exp.target ?? '.')
  const got = { check: run('check-artifacts.mjs', staged), lint: run('lint-prose.mjs', staged) }
  const problems = []
  const counts = {}
  for (const tool of ['check', 'lint']) {
    const want = exp[tool] ?? { errors: 0, warns: 0 }
    const errs = findings(got[tool].out, 'error')
    const warns = findings(got[tool].out, 'warn')
    counts[tool] = `${errs.length}/${warns.length}`
    const expectedCode = want.errors > 0 ? 1 : 0
    if (got[tool].code !== expectedCode) {
      problems.push(`${tool}: 종료 코드 ${got[tool].code ?? '없음(실행 오류 또는 시그널 종료)'} (기대 ${expectedCode})`)
      if (got[tool].out.trim()) problems.push(`${tool}: 출력\n${got[tool].out.trim()}`)
    }
    if (errs.length !== want.errors) problems.push(`${tool}: 오류 ${errs.length}건 (기대 ${want.errors})`)
    if (warns.length !== want.warns) problems.push(`${tool}: 경고 ${warns.length}건 (기대 ${want.warns})`)
    for (const m of want.matches ?? []) {
      if (![...errs, ...warns].some((f) => f.includes(m))) problems.push(`${tool}: «${m}» 을 못 잡았다`)
    }
    for (const m of want.forbidden ?? []) {
      const hit = [...errs, ...warns].find((f) => f.includes(m))
      if (hit) problems.push(`${tool}: «${m}» 을 잡으면 안 되는데 잡았다 — ${hit}`)
    }
  }
  const ok = problems.length === 0
  ok ? pass++ : fail++
  rows.push({ skill, id, kind: exp.kind ?? '', ok, problems, n: `검사 ${counts.check} · 린트 ${counts.lint}` })
}

// 케이스가 없으면 성공으로 처리하지 않는다.
if (rows.length === 0) {
  console.error('\n케이스를 하나도 못 찾았다 — 스킬 배치가 바뀌었거나 evals/cases 가 비었다.')
  console.error('0개는 통과가 아니다. skills.mjs 의 탐색과 실제 배치를 대조한다.\n')
  process.exit(1)
}
console.log(`\n산출물 도구 평가 — 케이스 ${rows.length}개  (오류/경고)\n`)
let last = ''
for (const r of rows) {
  if (r.skill !== last) { console.log(`  ${r.skill}`); last = r.skill }
  console.log(`    ${r.id.padEnd(16)} ${r.kind.padEnd(18)} ${r.n.padEnd(26)} ${r.ok ? '통과' : '✗ 실패'}`)
  for (const p of r.problems) console.log(`        ${p}`)
}
console.log(`\n${pass}/${rows.length} 통과`)
const runtimeFail = !only && !runRuntime()
if (fail || runtimeFail) { console.log('\n기대와 다르다 — 도구가 회귀했거나 케이스가 낡았다. 어느 쪽인지 정하고 고친다.\n'); process.exit(1) }
console.log('')
