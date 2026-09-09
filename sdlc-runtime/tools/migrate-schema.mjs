#!/usr/bin/env node
/** Preview the effect of a schema change. --profile raises the profile only; --artifact-sets
 *  (--chains, kept for existing scripts) raises artifact sets that pass the new checks, and
 *  --force raises the ones that fail too. */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, cpSync } from 'node:fs'
import { resolve, join, relative, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { SDLC_VERSION, CURRENT_SCHEMA_VERSION } from './artifact-parse.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const DO_PROFILE = argv.includes('--profile')
const DO_CHAINS = argv.includes('--chains') || argv.includes('--artifact-sets')
const FORCE = argv.includes('--force')
const ROOT = resolve(argv.find((a) => !a.startsWith('--')) ?? process.cwd())
const DOCS = ['intent.md', 'spec.md', 'plan.md', 'finding.md']

const profilePath = join(ROOT, '.claude/spec-profile.yml')
if (!existsSync(profilePath)) {
  console.log(`이 레포는 SDLC 산출물 체계를 쓰지 않는다 — ${relative(ROOT, profilePath)} 이 없다.`)
  console.log('`/sdlc-init` 이 프로필을 만든다.')
  process.exit(0)
}
const yml = (key, text) => {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(text)
  return m ? m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : ''
}
let profileText = readFileSync(profilePath, 'utf8')
const declared = yml('sdlc_version', profileText)
const profileVer = declared === '' ? 1 : Number(declared)
const specDir = resolve(ROOT, yml('spec_dir', profileText) || '.sdlc/specs')

const chains = []
const walk = (dir, depth = 0) => {
  if (depth > 4 || !existsSync(dir)) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  const files = entries.filter((e) => e.isFile() && DOCS.includes(e.name)).map((e) => e.name)
  if (files.length) chains.push({ dir, files })
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name), depth + 1)
}
walk(specDir)

const schemaOf = (text) => {
  const v = yml('schema_version', text)
  return v === '' ? 1 : Number(v)
}
const setSchema = (text, n) =>
  /^schema_version:/m.test(text)
    ? text.replace(/^schema_version:.*$/m, `schema_version: ${n}`)
    : text.replace(/^(artifact:.*)$/m, `$1\nschema_version: ${n}`)

function dryRun(chain, target) {
  const tmp = mkdtempSync(join(tmpdir(), 'sdlc-mig-'))
  mkdirSync(join(tmp, '.claude'), { recursive: true })
  cpSync(profilePath, join(tmp, '.claude/spec-profile.yml'))
  const bands = join(ROOT, '.claude/bands.yml')
  if (existsSync(bands)) cpSync(bands, join(tmp, '.claude/bands.yml'))
  const work = join(tmp, basename(chain.dir))
  mkdirSync(work, { recursive: true })
  for (const f of chain.files) writeFileSync(join(work, f), setSchema(readFileSync(join(chain.dir, f), 'utf8'), target))
  try {
    execFileSync(process.execPath, [join(HERE, 'check-artifacts.mjs'), work, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const plan = join(chain.dir, 'plan.md')
    if (target >= 4 && existsSync(plan)) {
      const text = readFileSync(plan, 'utf8')
      if (/^- \[[xX]\] \*\*WP-/m.test(text) || /^status:[ \t]*(?:in_progress|completed)\b/m.test(text)) {
        return ['plan.md  v4 작업 증거가 필요한 실행 이력이 있다 — SDLC-Task trailer를 원본 git에서 대조한 뒤 수동 승격한다']
      }
    }
    return []
  } catch (e) {
    try {
      const result = JSON.parse(e.stdout ?? '')
      const errors = result.problems.filter((p) => p.level === 'error')
      return errors.length ? errors.map((p) => `${p.doc}  ${p.msg}`) : ['Checker failed without error diagnostics']
    } catch { return ['Could not read checker diagnostics'] }
  }
}


const TARGET = CURRENT_SCHEMA_VERSION
console.log(`스키마 버전 — ${basename(ROOT)}`)
console.log(`  런타임 ${SDLC_VERSION} · 프로필 ${declared === '' ? '없음 (v1 로 읽힘)' : `v${profileVer}`}`)
console.log('')

if (profileVer > TARGET) {
  console.log(`⚠ 프로필이 런타임보다 높다 (v${profileVer} > v${TARGET}).`)
  console.log('  런타임이 낡았다 — 내리지 말고 런타임을 맞춘다: vendor-runtime.sh --update, 또는 글로벌 sdlc 갱신.')
  process.exit(1)
}

const profileStale = profileVer < TARGET
if (profileStale) {
  console.log(`프로필  v${profileVer} → v${TARGET} 로 올릴 수 있다 — **새 산출물 세트에만 영향한다.**`)
  const missing = []
  if (profileVer < 3) missing.push('v3 승인 분리')
  if (profileVer < 4) missing.push('v4 작업 귀속·완료 증거')
  console.log(`  지금은 새 산출물 세트가 v${profileVer} 로 만들어져 ${missing.join(' · ')} 규칙이 걸리지 않는다.`)
  console.log('  안 걸리는 것은 통과와 구분되지 않으므로, 그대로 두는 것도 선택이 아니라 결정이다.')
} else {
  console.log(`프로필  v${profileVer} — 런타임과 같다.`)
}

const stale = []
if (chains.length === 0) {
  console.log('\n산출물 세트  없음 — 올릴 문서가 없다.')
} else {
  console.log('\n산출물 세트:')
  for (const c of chains) {
    const versions = new Set(c.files.map((f) => schemaOf(readFileSync(join(c.dir, f), 'utf8'))))
    const v = versions.size === 1 ? [...versions][0] : null
    const label = v == null ? `섞임 (${[...versions].join('·')})` : `v${v}`
    if (v === TARGET) { console.log(`  ${relative(ROOT, c.dir)}  ${label} — 최신`); continue }
    const breaks = dryRun(c, TARGET)
    stale.push({ ...c, from: v, breaks })
    console.log(`  ${relative(ROOT, c.dir)}  ${label} → v${TARGET} 시 ${breaks.length ? `오류 ${breaks.length}건` : '오류 없음 ✓'}`)
    for (const b of breaks) console.log(`      ${b}`)
  }
  if (stale.some((s) => s.breaks.length)) {
    console.log('\n  검사에 실패하는 산출물 세트는 **이미 끝난 계약**일 수 있다. 소급해서 올릴 이유가 없으면 그대로 둔다 —')
    console.log('  옛 버전으로 남은 문서도 검사기가 계속 읽는다(schemas ' + `1..${TARGET}` + ').')
  }
  console.log('\n  git 이 없는 사본에서 검사하므로 **버전 고정(SHA) 검사만 빠진 결과**다.')
}


let wrote = false
if (DO_PROFILE && profileStale) {
  profileText = declared === ''
    ? profileText.replace(/^(?!#)(\S)/m, `sdlc_version: ${TARGET}\n$1`)
    : profileText.replace(/^sdlc_version:.*$/m, `sdlc_version: ${TARGET}`)
  writeFileSync(profilePath, profileText)
  console.log(`\n갱신: ${relative(ROOT, profilePath)}  (sdlc_version: ${TARGET})`)
  wrote = true
}

if (DO_CHAINS) {
  for (const s of stale) {
    if (s.breaks.length && !FORCE) {
      console.log(`\n건너뜀: ${relative(ROOT, s.dir)} — 올리면 오류 ${s.breaks.length}건. 고친 뒤 다시 돌리거나 --force.`)
      continue
    }
    for (const f of s.files) {
      const p = join(s.dir, f)
      writeFileSync(p, setSchema(readFileSync(p, 'utf8'), TARGET))
    }
    console.log(`\n갱신: ${relative(ROOT, s.dir)}  (schema_version: ${TARGET}${s.breaks.length ? ' — 오류를 안고 올림' : ''})`)
    wrote = true
  }
}

if (!DO_PROFILE && !DO_CHAINS && (profileStale || stale.length)) {
  console.log('\n올리려면:')
  if (profileStale) console.log('  node migrate-schema.mjs <repo> --profile    프로필만 (안전)')
  if (stale.length) console.log('  node migrate-schema.mjs <repo> --artifact-sets     검사에 통과하는 산출물 세트만')
}
if (wrote) console.log('\n바꾼 것을 커밋한다.')
process.exit(0)
