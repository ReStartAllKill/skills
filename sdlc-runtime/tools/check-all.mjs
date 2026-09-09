#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { execFileSync, execFileSync as run } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadBands, validate } from './bands.mjs'
import { loadPolicy, validate as validatePolicy } from './autonomy.mjs'
import { frontmatter, schemaVersion } from './artifact-parse.mjs'
import { useLocale } from './locale.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const REQUIRED = args.includes('--required')
const ROOT = resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd())
useLocale(ROOT)   // 문체 번들을 프로필의 lang 으로 고른다
const DOCS = ['intent.md', 'spec.md', 'plan.md', 'finding.md']

const yml = (key, file) => {
  if (!existsSync(file)) return ''
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(readFileSync(file, 'utf8'))
  return m ? m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : ''
}

const failed = []
const profile = join(ROOT, '.claude/spec-profile.yml')
if (!existsSync(profile)) {
  console.log(`이 레포는 SDLC 산출물 체계를 쓰지 않는다 — ${relative(ROOT, profile)} 이 없다.`)
  process.exit(REQUIRED ? 2 : 0)
}
const specDir = resolve(ROOT, yml('spec_dir', profile) || '.sdlc/specs')

const inGit = (() => { try { run('git', ['-C', ROOT, 'rev-parse', '--git-dir'], { stdio: 'ignore' }); return true } catch { return false } })()
const tracked = (p) => {
  if (!inGit) return true
  try { return !!run('git', ['-C', ROOT, 'ls-files', '--', p], { encoding: 'utf8' }).trim() } catch { return true }
}
if (!tracked(profile)) {
  const msg = `프로필이 Git 에 없다 — ${relative(ROOT, profile)}`
  console.log(`${REQUIRED ? '✗' : '⚠'} ${msg}\n` +
    '    나만 보는 검사가 된다 — 남의 산출물 세트는 다른 규칙으로 통과하고 CI 는 프로필이 없어 아무것도 안 본다.\n' +
    '    사람마다 다른 값 때문에 못 올리는 것이면 그 키만 뺀다. `owner` 는 비우면 git config user.name 이라\n' +
    '    여럿이 쓰는 레포에서는 비우는 쪽이 맞다 — 적어 두면 남이 승인한 것도 그 이름으로 적힌다.')
  if (REQUIRED) failed.push({ rel: relative(ROOT, profile), out: msg })
}

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
  console.log(`검사할 산출물 세트가 없다 — ${relative(ROOT, specDir)} 아래에 산출물이 없다.`)
}

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
    if (!tracked(dir)) {
      const msg = `결정 기록이 Git 에 없다 — ${rel}`
      console.log(`${REQUIRED ? '✗' : '⚠'} ${msg}\n    기각한 대안이 이 기계 밖에서는 없던 일이 된다.`)
      if (REQUIRED) failed.push({ rel, out: msg })
    }
  }
} else if (yml('adr_repo', profile)) {
  console.log(`\n결정 기록은 ${yml('adr_repo', profile)} 에 있다 — 여기서는 핀의 형식만 본다`)
}

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

const pol = loadPolicy(ROOT, yml("autonomy", profile))
if (pol.missing && yml('autonomy', profile)) failed.push({ rel: pol.rel, out: '프로필에 지정한 자율 정책이 없다.' })
if (!pol.missing) {
  const pp = validatePolicy(pol)
  const pe = pp.filter((p) => p.level === "error")
  console.log(`\n자율 실행 정책 ${pe.length ? "실패" : "통과"}  ${pol.rel}  (경로 ${Object.keys(pol.routes).length}개)`)
  for (const p of pp) console.log(`  ${p.level === "error" ? "✗" : "⚠"} ${p.line}행  ${p.msg}`)
  if (pe.length) failed.push({ rel: pol.rel, out: "자율 실행 정책 오류 " + pe.length + "건" })
}

const vendored = join(ROOT, '.claude/sdlc/VERSION')
if (existsSync(vendored)) {
  const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'VERSION')
  const a = readFileSync(vendored, 'utf8').trim()
  const b = existsSync(here) ? readFileSync(here, 'utf8').trim() : null
  if (b && a !== b) console.log(`\n참고: 벤더 런타임 ${a} · 이 기계의 글로벌 ${b} — vendor-runtime.sh --check 로 내용까지 대조한다.`)
}

console.log(`\n산출물 세트 ${chains.length}개 · 실패 ${failed.length}개`)
for (const f of failed) console.log(`\n──── ${f.rel}\n${f.out}`)
process.exit(failed.length ? 1 : 0)
