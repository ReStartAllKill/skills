#!/usr/bin/env node
/** 레포의 **모든** 사슬을 검사한다 — CI 가 부르는 자리.
 *
 *  `check-artifacts.mjs` 는 폴더 하나만 본다. 그것으로 «편집한 그 자리»는 지켜지지만
 *  «이 레포에 깨진 사슬이 있나»에는 답할 수 없다. 훅은 방금 만진 폴더만 보므로,
 *  상위 문서가 바뀐 뒤 아무도 안 건드린 하위는 조용히 낡아간다 — 이 사슬에서 가장
 *  흔한 붕괴가 정확히 그 모양이다.
 *
 *  **훅과 CI 는 다른 일을 한다.** 훅은 속도(0.2초, 그 자리에서 고치게)이고, CI 는
 *  강제(팀 전체가 통과해야 머지)다. 훅은 개인 장비에 있어서 팀원에게 없을 수 있고,
 *  그래서 훅만으로는 관문이 될 수 없다.
 *
 *    node check-all.mjs [repo-root]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { execFileSync, execFileSync as run } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadBands, validate } from './bands.mjs'
import { loadPolicy, validate as validatePolicy } from './autonomy.mjs'
import { frontmatter, schemaVersion } from './artifact-parse.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const REQUIRED = args.includes('--required')
const ROOT = resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd())
const DOCS = ['intent.md', 'spec.md', 'plan.md', 'finding.md']

/** 프로필 스칼라 한 줄. 주석과 따옴표를 벗긴다 — 값 뒤에 설명을 단 프로필이 실제로 있다. */
const yml = (key, file) => {
  if (!existsSync(file)) return ''
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(readFileSync(file, 'utf8'))
  return m ? m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : ''
}

const profile = join(ROOT, '.claude/spec-profile.yml')
if (!existsSync(profile)) {
  console.log(`이 레포는 산출물 사슬을 쓰지 않는다 — ${relative(ROOT, profile)} 이 없다.`)
  process.exit(REQUIRED ? 2 : 0)
}
const specDir = resolve(ROOT, yml('spec_dir', profile) || '.sdlc/specs')

/** 산출물이 **하나라도** 있는 폴더가 사슬 하나다. `finding.md` 만 있는 폴더도 사슬이다 —
 *  의도를 안 낳고 끝난 발견이 다수이기 때문이다. */
const chains = []
const walk = (dir, depth = 0) => {
  if (!existsSync(dir)) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch (e) { console.error(e.message); process.exit(2) }
  if (entries.some((e) => e.isFile() && DOCS.includes(e.name))) chains.push(dir)
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name), depth + 1)
}
walk(specDir)

if (chains.length === 0) {
  console.log(`검사할 사슬이 없다 — ${relative(ROOT, specDir)} 아래에 산출물이 없다.`)
}

/** 런타임은 프로필이 정한다. 벤더한 레포에서 CI 가 글로벌을 쓰면 «팀과 CI 가 같은
 *  검사기를 쓴다» 는 벤더의 유일한 목적이 무너진다. */
let runtime = yml('sdlc_runtime', profile) || join(HERE, '..')
if (runtime.startsWith('~/')) runtime = join(process.env.HOME ?? '', runtime.slice(2))
runtime = resolve(ROOT, runtime)

const tool = (n) => join(runtime, 'tools', n)
for (const t of ['check-artifacts.mjs', 'lint-prose.mjs', 'plan-progress.mjs']) {
  if (existsSync(tool(t))) continue
  console.error(`런타임에 ${t} 가 없다: ${runtime}`)
  console.error('프로필의 sdlc_runtime 을 확인하거나 vendor-runtime.sh 로 고정한다.')
  process.exit(2)
}

const failed = []
if (!existsSync(specDir) || !statSync(specDir).isDirectory()) failed.push({ rel: relative(ROOT, specDir), out: 'spec_dir 디렉터리가 없다.' })
if (REQUIRED && chains.length === 0) failed.push({ rel: relative(ROOT, specDir), out: '필수 검사인데 산출물이 없다.' })
for (const dir of chains) {
  const rel = relative(ROOT, dir)
  const out = []
  let ok = true
  const checks = ['check-artifacts.mjs', 'lint-prose.mjs']
  const planPath = join(dir, 'plan.md')
  if (existsSync(planPath) && schemaVersion(frontmatter(readFileSync(planPath, 'utf8')) ?? {}) >= 4) checks.push('plan-progress.mjs')
  for (const t of checks) {
    try {
      run(process.execPath, [tool(t), dir, '--strict'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      ok = false
      out.push((e.stdout ?? '') + (e.stderr ?? ''))
    }
  }
  console.log(`${ok ? '통과' : '실패'}  ${rel}`)
  if (!ok) failed.push({ rel, out: out.join('\n') })
}

/** 결정 기록도 본다 — 사슬의 **바깥**이자 사슬이 기대는 자리다. 사슬이 다 맞물려도 그것이
 *  전제한 결정이 대체됐거나 결정 로그가 낡았으면, 사람이 읽는 것과 저장소가 진 것이 갈린다.
 *  ADR 은 폴더가 아니라 파일 단위라 위 사슬 루프가 못 본다. */
const adrDir = yml('adr_dir', profile)
if (adrDir) {
  const dir = resolve(ROOT, adrDir)
  const rel = relative(ROOT, dir)
  if (!existsSync(dir)) {
    console.log(`\n결정 기록 없음 — ${rel} (프로필이 가리키는데 폴더가 없다)`)
    failed.push({ rel, out: '프로필의 `adr_dir` 이 가리키는 폴더가 없다.' })
  } else {
    const out = []
    let ok = true
    for (const [t, args] of [['check-artifacts.mjs', [dir, '--strict']], ['adr-index.mjs', [ROOT, '--check']]]) {
      try { run(process.execPath, [tool(t), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
      catch (e) { ok = false; out.push((e.stdout ?? '') + (e.stderr ?? '')) }
    }
    console.log(`\n결정 기록 ${ok ? '통과' : '실패'}  ${rel}`)
    if (!ok) failed.push({ rel, out: out.join('\n') })
  }
} else if (yml('adr_repo', profile)) {
  console.log(`\n결정 기록은 ${yml('adr_repo', profile)} 에 있다 — 여기서는 핀의 형식만 본다`)
}

/** 밴드 등록부도 본다 — 사슬의 **입력** 쪽이다. 문서가 다 맞물려도 «무엇이 정상인가»
 *  가 깨져 있으면 다음 발견의 §관측 이 잰 것이 아니게 된다. */
const bandsKey = yml("bands", profile)
const reg = loadBands(ROOT, bandsKey)
if (reg.missing) {
  if (bandsKey) failed.push({ rel: reg.rel, out: '프로필에 지정한 밴드 등록부가 없다.' })
  console.log(`\n밴드 등록부 없음 — ${reg.rel} (band_breach 발견은 대조되지 않는다)`)
} else {
  const bp = validate(reg)
  const be = bp.filter((p) => p.level === "error")
  console.log(`\n밴드 등록부 ${be.length ? "실패" : "통과"}  ${reg.rel}  (밴드 ${Object.keys(reg.bands).length}개)`)
  for (const p of bp) console.log(`  ${p.level === "error" ? "✗" : "⚠"} ${p.line}행  ${p.msg}`)
  if (be.length) failed.push({ rel: reg.rel, out: "밴드 등록부 오류 " + be.length + "건" })
}

/** 자율 실행 정책도 본다 — **위임은 만료된다.** 만료된 경로가 그대로 남아 있으면
 *  탐지기가 그것을 부를 때마다 실패하고, 아무도 그 사실을 모른다. */
const pol = loadPolicy(ROOT, yml("autonomy", profile))
if (pol.missing && yml('autonomy', profile)) failed.push({ rel: pol.rel, out: '프로필에 지정한 자율 정책이 없다.' })
if (!pol.missing) {
  const pp = validatePolicy(pol)
  const pe = pp.filter((p) => p.level === "error")
  console.log(`\n자율 실행 정책 ${pe.length ? "실패" : "통과"}  ${pol.rel}  (경로 ${Object.keys(pol.routes).length}개)`)
  for (const p of pp) console.log(`  ${p.level === "error" ? "✗" : "⚠"} ${p.line}행  ${p.msg}`)
  if (pe.length) failed.push({ rel: pol.rel, out: "자율 실행 정책 오류 " + pe.length + "건" })
}

/** 벤더한 런타임이 글로벌과 다른지도 함께 본다 — 사슬은 통과하는데 검사기가
 *  옛것이면 «통과» 가 무엇을 뜻하는지 알 수 없다. 막지는 않고 알리기만 한다:
 *  벤더 사본이 정본인 것이 정상적인 선택이기 때문이다. */
const vendored = join(ROOT, '.claude/sdlc/VERSION')
if (existsSync(vendored)) {
  // **이 파일이 사는 곳이 곧 «지금 도는 런타임» 이다.** 경로를 박으면 런타임을 옮긴
  // 기계에서 그 자리가 비어, 알리기만 하는 이 검사가 소리 없이 꺼진다.
  const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'VERSION')
  const a = readFileSync(vendored, 'utf8').trim()
  const b = existsSync(here) ? readFileSync(here, 'utf8').trim() : null
  if (b && a !== b) console.log(`\n참고: 벤더 런타임 ${a} · 이 기계의 글로벌 ${b} — vendor-runtime.sh --check 로 내용까지 대조한다.`)
}

console.log(`\n사슬 ${chains.length}개 · 실패 ${failed.length}개`)
for (const f of failed) console.log(`\n──── ${f.rel}\n${f.out}`)
process.exit(failed.length ? 1 : 0)
