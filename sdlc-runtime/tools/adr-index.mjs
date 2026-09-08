#!/usr/bin/env node
/** ADR 인덱스를 생성한다. --check는 최신 여부를 검사하고, --next는 다음 번호와 목록을 출력한다. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, relative, basename } from 'node:path'
import { loadAdrDir, ADR_FILENAME } from './artifact-parse.mjs'
import { adrSeam, ADR_DEAD, legacyMeta } from './adr-check.mjs'

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const NEXT = argv.includes('--next')
const ROOT = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')
const die = (msg, code = 2) => { console.error(msg); process.exit(code) }

/** 프로필이 있는 가장 가까운 상위 디렉터리를 저장소 루트로 사용한다. */
let root = null
for (let d = ROOT, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
  if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { root = d; break }
}
if (!root) die(`프로필을 못 찾았다 — ${ROOT} 의 조상에 .claude/spec-profile.yml 이 없다.`)
const seam = adrSeam(root)
if (!seam.configured || !seam.dir) {
  die('프로필에 `adr_dir` 이 없다 — 이 레포는 결정을 어디에 둘지 아직 안 정했다.\n' +
      '  결정이 다른 레포에 살면 그쪽에서 이 명령을 돌린다(`adr_repo` 는 인덱스를 만들지 않는다).')
}

const { docs, malformed } = loadAdrDir(seam.dir)
const num = (d) => Number(ADR_FILENAME.exec(d.name)?.[1] ?? 0)
/** 프런트매터가 없는 ADR은 H1과 헤더 표에서 읽는다. */
const meta = (d) => {
  const lg = legacyMeta(d)
  return lg
    ? { id: `ADR-${ADR_FILENAME.exec(d.name)?.[1] ?? '?'}`, title: lg.title, status: lg.status || lg.rawStatus || '?', scope: [], legacy: true }
    : { id: String(d.fm?.id ?? d.name), title: String(d.fm?.title ?? ''), status: String(d.fm?.status ?? '?'),
        scope: [].concat(d.fm?.scope ?? []).map(String).filter(Boolean), superseded_by: d.fm?.superseded_by, legacy: false }
}
docs.sort((a, b) => num(a) - num(b))

// 다음 번호는 현재 파일 기준이다. 다른 브랜치의 번호 사용은 별도로 확인해야 한다.
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

// 유효한 결정과 대체·폐기된 결정을 분리한다.
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').trim()
const link = (d) => `[${cell(meta(d).id)}](${basename(d.name)})`
const rows = (list) => list.map((d) => {
  const m = meta(d)
  const tail = m.status === 'superseded' ? ` → ${cell(m.superseded_by ?? '?')}` : ''
  const scope = m.scope.map(cell).filter(Boolean).map((x) => `\`${x}\``).join(' ')
  return `| ${link(d)} | ${cell(m.title)} | \`${m.status}\`${tail}${m.legacy ? ' · 옛 형식' : ''} | ${scope || '—'} |`
}).join('\n')

const live = docs.filter((d) => !ADR_DEAD.includes(meta(d).status))
const past = docs.filter((d) => ADR_DEAD.includes(meta(d).status))
const legacy = docs.filter((d) => meta(d).legacy).length
const head = '| ID | 제목 | 상태 | scope |\n|---|---|---|---|'

const body = [
  '# 결정 로그',
  '',
  '<!-- adr-index.mjs 가 만든다. 손으로 고치지 않는다 — 고치면 파일과 표가 갈리고,',
  '     믿을 것은 파일 쪽인데 사람이 보는 것은 표 쪽이 된다. -->',
  '',
  `결정 ${docs.length}장 · 효력 있는 것 ${live.length}장.${legacy ? ` 옛 형식 ${legacy}장은 H1 과 헤더 표에서 읽었다 — 프런트매터를 더하면 scope 도 선다.` : ''}`,
  '',
  '## 효력 있는 결정',
  '',
  live.length ? `${head}\n${rows(live)}` : '아직 없다.',
  '',
  '## 지나간 결정',
  '',
  '대체·폐기·기각된 것. **번호는 재사용하지 않으므로 자리를 물고 남는다** — 같은 논의가 다시',
  '열리면 이 표가 «전에 왜 그렇게 정했나» 와 «왜 뒤집었나» 의 답이다.',
  '',
  past.length ? `${head}\n${rows(past)}` : '아직 없다.',
  '',
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
