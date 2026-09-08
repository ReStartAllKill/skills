#!/usr/bin/env node
/** 결정 로그 — `<adr_dir>` 의 ADR 을 한 장의 표로 만든다.
 *
 *  인덱스가 없으면 그 폴더는 아무도 못 읽는 파일 벽이다. 번호는 단조 증가하고 재사용하지
 *  않으므로 파일 이름만으로는 «지금 효력 있는 결정이 무엇인가» 를 알 수 없다 — 폐기·대체된
 *  것이 같은 자리에 섞여 있기 때문이다. 이 표가 그것을 갈라 준다.
 *
 *  **손으로 고치지 않는다.** 사람이 고치면 파일과 표가 갈리고, 그때 믿을 것은 파일 쪽인데
 *  사람이 보는 것은 표 쪽이다.
 *
 *    node adr-index.mjs <레포 루트>            인덱스를 만들어 쓴다
 *    node adr-index.mjs <레포 루트> --check    어긋나면 exit 1 (CI 용)
 *    node adr-index.mjs <레포 루트> --next     다음 번호와 기존 목록만 낸다 (/create-adr 용)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, relative, basename } from 'node:path'
import { loadAdrDir, ADR_FILENAME } from './artifact-parse.mjs'
import { adrSeam, ADR_DEAD, legacyMeta } from './adr-check.mjs'

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const NEXT = argv.includes('--next')
const ROOT = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')
const die = (msg, code = 2) => { console.error(msg); process.exit(code) }

/** 레포 뿌리는 프로필이 있는 가장 가까운 조상이다 — 검사기와 같은 규칙이다. */
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
/** 옛 문서는 프런트매터가 없다 — H1 과 헤더 표에서 읽는다. 이관이 끝날 때까지 두 모양이
 *  한 폴더에 섞여 살고, 그때 옛 것을 «제목 없음 · 상태 ?» 로 적으면 결정 로그가 못 쓰게 된다. */
const meta = (d) => {
  const lg = legacyMeta(d)
  return lg
    ? { id: `ADR-${ADR_FILENAME.exec(d.name)?.[1] ?? '?'}`, title: lg.title, status: lg.status || lg.rawStatus || '?', scope: [], legacy: true }
    : { id: String(d.fm?.id ?? d.name), title: String(d.fm?.title ?? ''), status: String(d.fm?.status ?? '?'),
        scope: [].concat(d.fm?.scope ?? []).map(String).filter(Boolean), superseded_by: d.fm?.superseded_by, legacy: false }
}
docs.sort((a, b) => num(a) - num(b))

// ── --next ────────────────────────────────────────────────────────────────
// 다음 번호는 **파일에서만** 센다. 진행 중인 브랜치가 쥔 번호는 여기서 안 보이므로
// `/create-adr` 이 `git log origin/main..` 으로 한 번 더 본다.
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

// ── 표 ────────────────────────────────────────────────────────────────────
// 효력 있는 것과 지나간 것을 갈라 놓는다. 한 표에 섞으면 «지금 무엇이 유효한가» 를
// 읽는 데 상태 열을 한 줄씩 훑어야 하고, 그러면 아무도 안 읽는다.
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
