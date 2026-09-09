#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, relative, basename } from 'node:path'
import { loadAdrDir, ADR_FILENAME } from './artifact-parse.mjs'
import { useLocale } from './locale.mjs'
import { adrSeam, ADR_DEAD, legacyMeta } from './adr-check.mjs'

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const NEXT = argv.includes('--next')
const ROOT = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')
const die = (msg, code = 2) => { console.error(msg); process.exit(code) }

let root = null
for (let d = ROOT, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
  if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { root = d; break }
}
if (!root) die(`프로필을 못 찾았다 — ${ROOT} 의 조상에 .claude/spec-profile.yml 이 없다.`)
const W = useLocale(root).written.adrIndex
const seam = adrSeam(root)
if (!seam.configured || !seam.dir) {
  die('프로필에 `adr_dir` 이 없다 — 이 레포는 결정을 어디에 둘지 아직 안 정했다.\n' +
      '  결정이 다른 레포에 살면 그쪽에서 이 명령을 돌린다(`adr_repo` 는 인덱스를 만들지 않는다).')
}

const { docs, malformed } = loadAdrDir(seam.dir)
const num = (d) => Number(ADR_FILENAME.exec(d.name)?.[1] ?? 0)
const meta = (d) => {
  const lg = legacyMeta(d)
  return lg
    ? { id: `ADR-${ADR_FILENAME.exec(d.name)?.[1] ?? '?'}`, title: lg.title, status: lg.status || lg.rawStatus || '?', scope: [], legacy: true }
    : { id: String(d.fm?.id ?? d.name), title: String(d.fm?.title ?? ''), status: String(d.fm?.status ?? '?'),
        scope: [].concat(d.fm?.scope ?? []).map(String).filter(Boolean), superseded_by: d.fm?.superseded_by, legacy: false }
}
docs.sort((a, b) => num(a) - num(b))

const unknown = docs.filter((d) => !['draft', 'in_review', 'accepted', ...ADR_DEAD].includes(meta(d).status))
if (unknown.length) die(`Unknown ADR status: ${unknown.map((d) => d.name).join(', ')}`)

if (NEXT) {
  const max = docs.reduce((m, d) => Math.max(m, num(d)), 0)
  console.log(`다음 번호: ADR-${String(max + 1).padStart(3, '0')}   (${relative(root, seam.dir)} · ${docs.length}장)`)
  if (malformed.length) console.log(`  ⚠ 이름 규칙을 어긴 파일 ${malformed.length}개: ${malformed.join(' · ')}`)
  if (!docs.length) { console.log('  아직 없다 — 첫 결정이다.'); process.exit(0) }
  console.log('')
  for (const d of docs) {
    const m = meta(d)
    console.log(`  ${m.id.padEnd(8)} ${m.status.padEnd(11)} ${m.title || d.name}${m.legacy ? '  (옛 형식)' : ''}`)
  }
  console.log('\n이미 같은 결정을 담은 ADR 이 있으면 새로 만들지 않는다 — 결론을 바꾸는 것이면')
  console.log('그 문서를 superseded 로 옮기고 후속을 쓴다. 승인된 본문을 고쳐 결론을 바꾸지 않는다.')
  process.exit(0)
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').trim()
const link = (d) => `[${cell(meta(d).id)}](${basename(d.name)})`
const rows = (list) => list.map((d) => {
  const m = meta(d)
  const tail = m.status === 'superseded' ? ` → ${cell(m.superseded_by ?? '?')}` : ''
  const scope = m.scope.map(cell).filter(Boolean).map((x) => `\`${x}\``).join(' ')
  return `| ${link(d)} | ${cell(m.title)} | \`${m.status}\`${tail}${m.legacy ? ` · ${W.legacy}` : ''} | ${scope || '—'} |`
}).join('\n')

const live = docs.filter((d) => !ADR_DEAD.includes(meta(d).status))
const past = docs.filter((d) => ADR_DEAD.includes(meta(d).status))
const legacy = docs.filter((d) => meta(d).legacy).length
const head = `| ID | ${W.title} | ${W.status} | scope |\n|---|---|---|---|`

const body = [
  `# ${W.heading}`, '', W.comment, '', W.summary(docs.length, live.length, legacy), '',
  `## ${W.live}`, '', live.length ? `${head}\n${rows(live)}` : W.empty, '',
  `## ${W.past}`, '', W.history, '', past.length ? `${head}\n${rows(past)}` : W.empty, '',
].join('\n')

const target = seam.index ?? resolve(seam.dir, 'index.md')
const current = existsSync(target) ? readFileSync(target, 'utf8') : null

if (malformed.length) {
  console.error(`⚠ 이름 규칙을 어긴 파일 ${malformed.length}개는 표에 싣지 않았다: ${malformed.join(' · ')}`)
}

if (CHECK) {
  if (current === body) { console.log(`결정 로그 최신 — ${relative(root, target)} (${docs.length}장)`); process.exit(0) }
  console.error(`결정 로그가 어긋난다 — ${relative(root, target)}\n  갱신: node ${relative(root, new URL(import.meta.url).pathname)} ${relative(root, root) || '.'}`)
  process.exit(1)
}

if (current === body) { console.log(`결정 로그 그대로 — ${relative(root, target)} (${docs.length}장)`); process.exit(0) }
writeFileSync(target, body)
console.log(`결정 로그 갱신 — ${relative(root, target)}  (${docs.length}장 · 효력 ${live.length} · 지나간 것 ${past.length})`)
