#!/usr/bin/env node
/** Pull approved intent and spec artifacts from the upstream repository and write a lock file.
 * Usage: node pull-spec.mjs <artifact-dir> [--from <upstream-checkout>] [--slug <upstream-dir>] [--force] */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'
import { frontmatter } from './artifact-parse.mjs'
import { LOCK_FILE, VENDORED, upstreamSeam, loadLock, hashOf, headOf, findUpstream, sameRepo } from './upstream.mjs'

const argv = process.argv.slice(2)
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
const FORCE = argv.includes('--force')
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--from', '--slug'].includes(argv[i - 1]))
const DIR = resolve(positional[0] ?? '.')

const die = (msg, ...more) => { console.error(msg); for (const m of more) console.error(m); process.exit(2) }

if (!existsSync(DIR) || !statSync(DIR).isDirectory()) die(`산출물 디렉터리가 없다 — ${DIR}`)

const repoRoot = (() => {
  for (let d = DIR, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
    if (existsSync(resolve(d, '.claude/spec-profile.yml'))) return d
  }
  return null
})()
if (!repoRoot) die('프로필을 찾지 못했다 — `.claude/spec-profile.yml` 이 있는 레포 안에서 돌린다.')

const yml = (key, file) => {
  if (!existsSync(file)) return ''
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(readFileSync(file, 'utf8'))
  return m ? m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : ''
}

const seam = upstreamSeam(repoRoot)
const existing = loadLock(DIR)
if (existing?.broken) die(`${LOCK_FILE} 이 깨졌다 — ${existing.broken}`, '지우고 다시 끌어오면 새로 만든다.')

const repo = existing?.repo || seam.upstream
if (!repo) {
  die('상류 레포를 모른다.',
    '프로필에 `upstream_repo: "<owner>/<repo>"` 를 적거나, 이미 끌어온 폴더에서 돌린다.')
}
if (existing && seam.upstream && !sameRepo(existing.repo, seam.upstream)) {
  die(`락의 상류(${existing.repo})와 프로필의 상류(${seam.upstream})가 다르다.`,
    '상류를 옮겼으면 이 폴더의 락을 지우고 다시 끌어온다 — 사본의 출처가 둘이 되면 안 된다.')
}

const upstreamRoot = findUpstream({ repo }, repoRoot, flag('--from'))
if (!upstreamRoot) {
  die(`${repo} 체크아웃을 찾지 못했다.`,
    '`--from <경로>` 로 지정하거나 `SDLC_UPSTREAM` 환경변수를 쓴다.',
    '형제 디렉터리에 받아뒀으면 origin remote 가 그 레포를 가리켜야 한다.')
}

const upstreamSpecDir = yml('spec_dir', join(upstreamRoot, '.claude/spec-profile.yml')) || '.sdlc/specs'
const slug = flag('--slug') || existing?.slug || basename(DIR)
const srcDir = resolve(upstreamRoot, upstreamSpecDir, slug)
if (!existsSync(srcDir)) {
  const near = existsSync(resolve(upstreamRoot, upstreamSpecDir))
    ? readdirSync(resolve(upstreamRoot, upstreamSpecDir)).filter((n) => !n.startsWith('.')).slice(0, 8)
    : []
  die(`상류에 ${slug} 가 없다 — ${relative(process.cwd(), srcDir)}`,
    near.length ? `상위 산출물 세트: ${near.join(' · ')}` : '상류의 spec_dir 이 비었다.')
}

const files = {}
const pulled = []
const skipped = []
for (const name of VENDORED) {
  const src = join(srcDir, name)
  if (!existsSync(src)) { skipped.push(`${name} — 상류에 없다`); continue }
  const text = readFileSync(src, 'utf8')
  const fm = frontmatter(text) ?? {}
  // Approval belongs upstream. Pulling unapproved documents breaks provenance and state-order checks.
  if (!FORCE && fm.status !== 'accepted') {
    die(`상류의 ${name} 이 \`${fm.status ?? '(상태 없음)'}\` 다 — 승인된 것만 끌어온다.`,
      '상류에서 승인한 뒤 다시 돌린다. 초안으로 먼저 계획을 짜려면 `--force` 를 쓰고, 승인 뒤 반드시 다시 끌어온다.')
  }
  const relPath = relative(upstreamRoot, src)
  const sha = headOf(upstreamRoot, relPath)
  if (!sha) skipped.push(`${name} — 상류에서 아직 커밋되지 않았다(핀 없이 받는다)`)
  writeFileSync(join(DIR, name), text)
  files[name] = { path: relPath, sha, hash: hashOf(text), status: fm.status ?? null }
  pulled.push(name)
}

if (!pulled.length) die(`끌어올 문서가 없다 — ${relative(process.cwd(), srcDir)} 에 ${VENDORED.join(' · ')} 가 없다.`)

const lock = {
  repo,
  slug,
  pulled_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  files,
}
writeFileSync(join(DIR, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n')

console.log(`${repo}#${slug} → ${relative(process.cwd(), DIR)}`)
for (const name of pulled) {
  const e = files[name]
  console.log(`  ${name}  ${e.sha ? e.sha.slice(0, 7) : '(미커밋)'}  ${e.status ?? '-'}`)
}
for (const s of skipped) console.log(`  건너뜀 — ${s}`)
console.log(`\n  ${LOCK_FILE} 을 커밋한다. 사본은 읽기 전용이고, 고칠 일은 상류에서 한다.`)
if (files['spec.md']?.sha) {
  console.log(`  plan 의 \`spec_version\` 에 ${files['spec.md'].sha.slice(0, 7)} 를 적는다.`)
}
