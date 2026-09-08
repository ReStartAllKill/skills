#!/usr/bin/env node
/** 도구 평가 러너 — `check-artifacts.mjs` 와 `lint-prose.mjs` 가 값을 하는지 잰다.
 *
 *  케이스마다 문서 한 벌과 **기대 지적**(`expected.json`)이 있다. 러너는 케이스를 임시
 *  git 저장소로 세워(버전 고정 검사가 git 을 요구한다) 두 도구를 돌리고 대조한다.
 *
 *  ## 대조 케이스가 반드시 같은 배치에 있어야 한다
 *
 *  시드 케이스만 보면 **«전부 지적하는» 도구가 만점**이다 — 사실인 지적은 오탐으로 세지
 *  않기 때문이다. 특히 린터가 그렇다: 「모호하게 쓰지 마라」는 넓게 잡으면 언제나 뭔가
 *  걸린다. `clean-light` 가 그 절제를 잰다.
 *
 *  ## 거울 케이스가 두 도구의 경계를 증명한다
 *
 *  `chain-broken` 은 **검사기만** 걸려야 하고(산문은 멀쩡하다), `prose-rot` 은 **린터만**
 *  걸려야 한다(구조는 멀쩡하다). `forbidden` 이 그것을 못 박는다 — 상대 쪽에서도 걸리면
 *  두 도구가 같은 것을 두 번 보고 있다는 뜻이고, 그러면 하나는 없어도 된다.
 *
 *    node run.mjs [케이스 id]
 */
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

/** 케이스를 임시 git 저장소로 세운다. `@INTENT_SHA@`·`@SPEC_SHA@` 를 실제 커밋으로
 *  치환하므로 케이스는 SHA 를 들고 다니지 않는다 — 들고 다니면 케이스를 고칠 때마다 손으로
 *  다시 찍어야 하고, 그 순간 아무도 안 고친다. */
/** `target` 은 검사기를 **어느 폴더에** 돌릴지다(기본은 뿌리). 규약이 정한 진짜 배치는
 *  발견과 의도가 **다른 폴더**에 사는 것이라, 한 폴더에 몰아넣은 케이스는 실제로 쓰이는
 *  모양을 재지 못한다 — 사용자가 반드시 한 번 틀리는 자리가 바로 그 폴더 사이의 상대
 *  경로인데, 평평한 케이스에서는 그 경로가 늘 `./` 라 아무것도 증명하지 않는다. */
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
  try { return { code: 0, out: execFileSync('node', [join(TOOLS, tool), dir], { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') } }
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
    // 힌트 줄(더 깊이 들여쓴 다음 줄)도 그 지적의 일부다. **버리면 케이스가 힌트를 못 건다** —
    // 「무엇이 대체했는가」처럼 사람이 다음에 할 일이 힌트에만 있는 지적이 있고, 그 줄이
    // 통째로 사라져도 지적 건수는 그대로라 회귀가 수에 안 잡힌다.
    if (res.length && /^\s{4,}\S/.test(lines[i])) res[res.length - 1] += ' ' + lines[i].trim()
  }
  return res
}

/** 케이스는 **그 모양을 만드는 스킬**이 소유한다 — `create-intent` 는 intent 하나짜리,
 *  `create-spec` 은 intent+spec 부분 사슬, `create-plan` 은 전체 사슬. 그래야 케이스가
 *  실제로 나오는 모양과 같고, 부분 사슬에서만 나는 결함(아직 없는 문서의 ID 를 오류로
 *  읽는 것 같은)이 잡힌다. 러너는 하나이고 스킬을 훑는다. */
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

// **케이스 0개는 통과가 아니다.** 스킬을 못 찾으면 러너는 아무것도 안 돌리고 «0/0 통과»
// 를 찍는데, 그 출력은 전부 통과와 구분되지 않는다 — 배치를 바꾼 날 실제로 그렇게 됐다.
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
let runtimeFail = false
if (!only || only === 'runtime') {
  try {
    console.log(execFileSync(process.execPath, [join(HERE, 'runtime-smoke.mjs')], { encoding: 'utf8' }))
  } catch (e) {
    runtimeFail = true
    console.log((e.stdout ?? '') + (e.stderr ?? ''))
  }
}
if (fail || runtimeFail) { console.log('\n기대와 다르다 — 도구가 회귀했거나 케이스가 낡았다. 어느 쪽인지 정하고 고친다.\n'); process.exit(1) }
console.log('')
