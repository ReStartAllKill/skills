/** 산출물 파서 — `check-artifacts.mjs` 와 `lint-prose.mjs` 가 **함께** 쓴다.
 *
 *  파서를 두 벌 두면 이 사슬이 내내 경계한 «두 정본» 이 도구 쪽에 생긴다. 구조를 읽는
 *  법이 갈리는 순간 «검사기는 통과하는데 린터는 못 찾는» 자리가 조용히 생기고, 그 자리는
 *  아무도 안 본다.
 *
 *  읽는 모양은 셋이다 — 산문에 ID 를 다는 방식이 그것뿐이기 때문이다.
 *    `### FR-001 — 제목 `Must``          헤딩 정의
 *    `- [ ] AC-001 — 기준 문장`          수용 기준 (부모 요구사항 안)
 *    `- [ ] **WP-001 — 제목**` + 다섯 줄  작업
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 글로벌 런타임은 여러 산출물 스키마를 읽는다. 무버전 문서는 v1 이다. */
export const SDLC_VERSION = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../VERSION'), 'utf8').trim()
export const CURRENT_SCHEMA_VERSION = Number(SDLC_VERSION)
export const LEGACY_SCHEMA_VERSION = 1
/** 옛 버전을 계속 읽는다 — 레포마다 사슬을 올리는 시점이 다르고, 낡았다는 이유로
 *  거절하면 마이그레이션이 끝날 때까지 그 레포는 검사기를 못 쓴다. */
export const SUPPORTED_SCHEMA_VERSIONS =
  Array.from({ length: CURRENT_SCHEMA_VERSION - LEGACY_SCHEMA_VERSION + 1 }, (_, i) => LEGACY_SCHEMA_VERSION + i)
export const schemaVersion = (fm = {}) => {
  if (isNull(fm.schema_version)) return LEGACY_SCHEMA_VERSION
  const n = Number(fm.schema_version)
  return Number.isInteger(n) ? n : null
}

/** ID 접두. `conventions.md` 의 표가 정본이고 여기가 그 기계 판이다.
 *  접두를 더할 때는 **양쪽을 함께** 고친다. */
export const PREFIXES = {
  OUT: { doc: 'intent', label: '목표 결과' },
  CON: { doc: 'intent', label: '제약' },
  ASM: { doc: 'intent', label: '가정' },
  Q: { doc: 'intent', label: '열린 질문(의도 층)' },
  SCN: { doc: 'spec', label: '시나리오' },
  FR: { doc: 'spec', label: '기능 요구사항' },
  NFR: { doc: 'spec', label: '비기능 요구사항' },
  AC: { doc: 'spec', label: '수용 기준' },
  EDGE: { doc: 'spec', label: '오류·경계' },
  SQ: { doc: 'spec', label: '열린 질문(명세 층)' },
  SD: { doc: 'spec', label: '명세 결정' },
  TD: { doc: 'plan', label: '설계 결정' },
  WP: { doc: 'plan', label: '작업' },
  RISK: { doc: 'plan', label: '위험' },
  PQ: { doc: 'plan', label: '열린 질문(계획 층)' },
  EV: { doc: 'finding', label: '관측(결정론적)' },
  HYP: { doc: 'finding', label: '가설(모델 판정)' },
  FQ: { doc: 'finding', label: '열린 질문(발견 층)' },
  ALT: { doc: 'adr', label: '대안' },
  RV: { doc: 'adr', label: '재검토 조건' },
}
/** `ASM-*` 은 두 집을 갖는다 — intent 의 «가정» 과 adr 의 «전제» 는 같은 뜻이고, 결정이 선
 *  전제를 ADR 밖에 두면 그 전제가 무너져도 결정을 아무도 못 깨운다. 접두를 하나 더 만드는
 *  대신 집을 둘로 인정한다. */
PREFIXES.ASM.also = ['adr']

/** `ALT` 를 `AC` 보다 앞에 둔다. 교체는 앞에서부터 맞춰 보므로 뒤에 두면 «ALT-001» 이
 *  «AC» 로 먼저 걸릴 자리가 생긴다(지금 문법으로는 안 걸리지만 접두가 늘면 걸린다). */
export const P_ALT = 'RISK|EDGE|HYP|NFR|OUT|CON|ASM|SCN|ALT|FR|AC|EV|FQ|SQ|SD|TD|WP|PQ|RV|Q'
/** 사슬의 네 문서. `loadDir` 가 도는 것은 이것뿐이다. */
export const CHAIN_FILES = { finding: 'finding.md', intent: 'intent.md', spec: 'spec.md', plan: 'plan.md' }
/** ADR 은 폴더가 아니라 파일 하나고 이름이 번호를 문다 — 아래 이름표는 오류 문구에만 쓴다. */
export const FILES = { ...CHAIN_FILES, adr: 'ADR-*.md' }
export const ADR_FILENAME = /^ADR-(\d{3,4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
export const WP_FIELDS = ['files', 'depends', 'covers', 'tests', 'verify']

export const idsIn = (s) => [...String(s).matchAll(new RegExp(`\\b(${P_ALT})-(\\d{1,4})\\b`, 'g'))].map((m) => `${m[1]}-${m[2]}`)
export const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')
export const unquote = (s) => s.trim().replace(/^["']|["']$/g, '')
export const isNull = (v) => v == null || v === 'null' || v === '' || (Array.isArray(v) && v.length === 0)

/** 프런트매터 — 이 문서들이 쓰는 만큼만 읽는다(스칼라·인라인 배열·블록 리스트).
 *  YAML 파서를 들이지 않는 것은 의존성의 문제다. 필요한 모양이 넷뿐이고, 넷을 넘어서면
 *  그건 프런트매터가 아니라 설정 파일이다. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const out = {}
  let key = null
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    if (!line.trim()) continue
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && key) { (out[key] ||= []).push(unquote(item[1])); continue }
    const kv = /^([A-Za-z_]\w*):\s*(.*)$/.exec(line)
    if (!kv) continue
    key = kv[1]
    const v = kv[2].trim()
    if (v === '') { out[key] = []; continue }
    if (v.startsWith('[')) { out[key] = v.slice(1, -1).split(',').map(unquote).filter(Boolean); continue }
    out[key] = unquote(v)
  }
  return out
}

/** 코드펜스 밖의 줄만 «살아 있다». 예시 안의 `### FR-001` 이나 표가 세어지면 안 된다. */
export function outsideFence(lines) {
  const ok = new Array(lines.length).fill(true)
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; ok[i] = false; return }
    ok[i] = !fence
  })
  return ok
}

/** `## 제목 `[표기]`` 과 `### …`. 표기가 붙은 것이 티어 검사 단위다. */
export function headings(lines, live) {
  const hs = []
  lines.forEach((line, i) => {
    if (!live[i]) return
    const m = /^(#{2,4})\s+(.+?)\s*(?:`\[([^\]]+)\]`)?\s*$/.exec(line)
    if (!m) return
    hs.push({ depth: m[1].length, title: m[2].trim(), marker: m[3] ?? null, line: i })
  })
  hs.forEach((h, i) => {
    const rest = hs.slice(i + 1)
    h.ownEnd = rest.length ? rest[0].line : lines.length
    const stop = rest.findIndex((x) => x.depth <= h.depth)
    h.allEnd = stop < 0 ? lines.length : rest[stop].line
    const kids = stop < 0 ? rest : rest.slice(0, stop)
    h.hasMarkedChild = kids.some((x) => x.marker)
    h.hasChild = kids.length > 0
  })
  return hs
}

/** 필드 — `키: 값` 또는 `- 키: 값`. 산문 한가운데의 콜론이 걸려도 해가 없다(안 쓰는 키가
 *  하나 생길 뿐). 값에서 ID 를 뽑는 쪽이 실제 검사다. */
export function fieldsOf(lines) {
  const f = new Map()
  for (const raw of lines) {
    const m = /^\s*(?:[-*]\s+)?([A-Za-z가-힣_][A-Za-z가-힣_ ]{0,19}):\s*(.+?)\s*$/.exec(raw)
    if (!m) continue
    const k = m[1].trim()
    if (!f.has(k)) f.set(k, m[2].trim())
  }
  return f
}

export const sectionOf = (hs, line) => [...hs].reverse().find((h) => h.depth === 2 && h.line <= line)?.title ?? null

/** 엔티티를 모은다. `onDup` 은 중복 정의를 어떻게 보고할지 부르는 쪽이 정한다 —
 *  검사기는 오류로, 린터는 무시한다(같은 사실을 두 도구가 두 번 말하지 않는다). */
export function entities(doc, onDup = () => {}) {
  const { lines, live, hs } = doc
  const out = new Map()
  const add = (e) => { if (out.has(e.id)) onDup(e, out.get(e.id)); else out.set(e.id, e) }
  for (const h of hs) {
    if (h.depth < 3) continue
    const m = new RegExp(`^(${P_ALT})-(\\d{1,4})\\s*[—–-]\\s*(.*)$`).exec(h.title)
    if (!m) continue
    const prio = /`(Must|Should|Could|Won't)`/i.exec(m[3])
    const body = lines.slice(h.line + 1, h.allEnd).filter((_, k) => live[h.line + 1 + k])
    add({
      id: `${m[1]}-${m[2]}`, title: m[3].replace(/`[^`]*`/g, '').trim(),
      priority: prio ? prio[1] : null, line: h.line, kind: 'heading',
      fields: fieldsOf(body), bodyLines: body, body: body.join('\n'), section: sectionOf(hs, h.line),
    })
  }
  lines.forEach((line, i) => {
    if (!live[i]) return
    const wp = /^\s*[-*]\s+\[[ xX]\]\s+\*\*(WP-\d{1,4})\s*[—–-]\s*(.+?)\*\*\s*$/.exec(line)
    if (wp) {
      const body = []
      for (let j = i + 1; j < lines.length && (/^\s{2,}[-*]\s/.test(lines[j]) || !lines[j].trim()); j++) {
        if (lines[j].trim()) body.push(lines[j])
      }
      add({ id: wp[1], title: wp[2].trim(), priority: null, line: i, kind: 'wp', done: /\[[xX]\]/.test(line),
        fields: fieldsOf(body), bodyLines: body, body: body.join('\n'), section: sectionOf(hs, i) })
      return
    }
    const ac = /^\s*[-*]\s+\[[ xX]\]\s+(AC-\d{1,4})\s*[—–-]\s*(.+?)\s*$/.exec(line)
    if (ac) {
      const owner = [...out.values()].filter((e) => e.kind === 'heading' && e.line < i && /^(FR|NFR)-/.test(e.id)).pop()
      add({ id: ac[1], title: ac[2].trim(), priority: null, line: i, kind: 'ac', parent: owner?.id ?? null,
        fields: new Map(), bodyLines: [], body: ac[2], section: sectionOf(hs, i) })
    }
  })
  return out
}

/** ADR 파일 하나를 사슬 문서와 같은 모양으로 연다. `loadDir` 와 갈라 두는 이유는 ADR 이
 *  폴더가 아니라 파일 단위이고 이름이 번호를 물기 때문이다 — 같은 함수에 우겨넣으면
 *  «폴더 하나에 문서 넷» 이라는 loadDir 의 계약이 흐려진다. */
export function loadAdr(path, onDup) {
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  const live = outsideFence(lines)
  const d = { kind: 'adr', name: basename(path), path, text, lines, live, fm: frontmatter(text) ?? {} }
  d.hs = headings(lines, live)
  d.ents = entities(d, onDup ? (a, b) => onDup(d, a, b) : undefined)
  return d
}

/** `<adr_dir>` 의 ADR 을 전부 연다. 이름 규칙을 어긴 파일은 열지 않고 이름만 돌려준다 —
 *  번호를 못 읽는 파일은 이 모음의 «번호는 하나를 가리킨다» 를 이미 깨고 있다. */
export function loadAdrDir(dir, onDup) {
  if (!existsSync(dir)) return { docs: [], malformed: [] }
  const docs = [], malformed = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || name === 'index.md') continue
    if (!ADR_FILENAME.test(name)) { malformed.push(name); continue }
    const d = loadAdr(join(dir, name), onDup)
    if (d) docs.push(d)
  }
  return { docs, malformed }
}

/** 폴더 하나를 읽어 네 문서를 연다. 없는 문서는 그냥 없다 — finding 하나만 있는 폴더도,
 *  intent 만 있는 폴더도 정상이다. */
export function loadDir(dir, onDup) {
  const docs = {}
  for (const [kind, name] of Object.entries(CHAIN_FILES)) {
    const path = join(dir, name)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    const lines = text.split(/\r?\n/)
    const live = outsideFence(lines)
    const d = { kind, name, path, text, lines, live, fm: frontmatter(text) ?? {} }
    d.hs = headings(lines, live)
    docs[kind] = d
  }
  for (const d of Object.values(docs)) d.ents = entities(d, onDup ? (a, b) => onDup(d, a, b) : undefined)
  return docs
}

/** 템플릿 원본인가 — 채우기 전이면 내용 검사를 건너뛴다. 안 그러면 템플릿이 늘 실패한다. */
export const isTemplate = (docs) => Object.values(docs)
  .some((doc) => /YYYY-NNN/.test(String(doc?.fm?.id ?? '')))

/** 보고 — 두 도구가 같은 모양으로 낸다. */
export function report({ title, notes = [], problems, strict, ruleDoc }) {
  const errors = problems.filter((p) => p.level === 'error')
  const warns = problems.filter((p) => p.level === 'warn')
  const ESC = String.fromCharCode(27)
  const bold = (s) => (process.stdout.isTTY ? `${ESC}[1m${s}${ESC}[0m` : s)
  console.log(`\n${title}`)
  for (const n of notes) console.log(`  · ${n}`)
  const show = (list, label) => {
    if (!list.length) return
    console.log(`\n${bold(label)} ${list.length}건\n`)
    for (const p of list) {
      console.log(`  ${p.doc}${p.line ? ':' + p.line : ''}  ${p.rule ? `[${p.rule}] ` : ''}${p.msg}`)
      if (p.hint) console.log(`      ${p.hint}`)
    }
  }
  show(errors, '✗ 오류')
  show(warns, '⚠ 경고')
  if (!errors.length && !warns.length) { console.log('\n통과 — 오류 0건, 경고 0건\n'); return 0 }
  console.log('')
  if (errors.length) { if (ruleDoc) console.log(`규칙은 ${ruleDoc}\n`); return 1 }
  if (strict) { console.log('--strict — 경고를 실패로 취급한다.\n'); return 1 }
  console.log('경고만 있다 — 통과. CI 에서는 `--strict` 로 막는다.\n')
  return 0
}

/** 작업(WP)의 `files` · `depends` 와 **레벨**. `/implement-spec` 은 `depends` 를 위상정렬한
 *  같은 깊이를 한 레벨로 병렬 실행한다. 검사기(파일 겹침)와 plan-levels(실행 순서)가
 *  같은 함수를 써야 «검사는 통과했는데 실행 순서가 다르다» 가 생기지 않는다. */
export const wpField = (e, k) => (e.fields.has(k) ? e.fields.get(k) : '')
export const wpFiles = (w) => {
  const v = wpField(w, 'files')
  const ticked = [...v.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())
  return (ticked.length ? ticked : v.split(',')).map((s) => s.trim().replace(/^`|`$/g, '')).filter(Boolean)
}
export const wpDeps = (w) => idsIn(wpField(w, 'depends')).filter((x) => x.startsWith('WP-'))

/** 레벨을 센다. 결과: { level: Map<id, n>, cycles: [[...ids]], unknown: [{id, dep}] }.
 *  순환이나 없는 의존은 레벨 0 으로 두고 문제로 돌려준다 — 부르는 쪽이 오류로 만든다. */
export function levelsOf(wps) {
  const byId = new Map(wps.map((w) => [w.id, w]))
  const level = new Map()
  const cycles = []
  const unknown = []
  const seenCycle = new Set()
  const walk = (id, stack = []) => {
    if (level.has(id)) return level.get(id)
    if (stack.includes(id)) {
      if (!seenCycle.has(id)) { seenCycle.add(id); cycles.push([...stack.slice(stack.indexOf(id)), id]) }
      return 0
    }
    const w = byId.get(id)
    if (!w) return 0
    const deps = wpDeps(w)
    const lv = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => walk(d, [...stack, id])))
    level.set(id, lv)
    return lv
  }
  for (const w of wps) {
    for (const d of wpDeps(w)) if (!byId.has(d)) unknown.push({ id: w.id, dep: d })
    walk(w.id)
  }
  return { level, cycles, unknown }
}
