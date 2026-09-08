/** 검사기와 린터가 공유하는 산출물 파서. 제목의 ID, AC 체크박스, WP 작업 필드를 읽는다. */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 버전이 없는 문서는 스키마 v1으로 읽는다. */
export const SDLC_VERSION = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../VERSION'), 'utf8').trim()
export const CURRENT_SCHEMA_VERSION = Number(SDLC_VERSION)
export const LEGACY_SCHEMA_VERSION = 1
/** 지원하는 이전 스키마도 함께 허용한다. */
export const SUPPORTED_SCHEMA_VERSIONS =
  Array.from({ length: CURRENT_SCHEMA_VERSION - LEGACY_SCHEMA_VERSION + 1 }, (_, i) => LEGACY_SCHEMA_VERSION + i)
export const schemaVersion = (fm = {}) => {
  if (isNull(fm.schema_version)) return LEGACY_SCHEMA_VERSION
  const n = Number(fm.schema_version)
  return Number.isInteger(n) ? n : null
}

/** ID 접두를 변경할 때 conventions.md도 함께 갱신한다. */
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
/** ASM은 intent의 가정과 ADR의 전제에 공통으로 사용한다. */
PREFIXES.ASM.also = ['adr']

export const P_ALT = 'RISK|EDGE|HYP|NFR|OUT|CON|ASM|SCN|ALT|FR|AC|EV|FQ|SQ|SD|TD|WP|PQ|RV|Q'
/** loadDir이 읽는 산출물 파일명. */
export const CHAIN_FILES = { finding: 'finding.md', intent: 'intent.md', spec: 'spec.md', plan: 'plan.md' }
/** ADR 이름표는 오류 메시지에 사용한다. */
export const FILES = { ...CHAIN_FILES, adr: 'ADR-*.md' }
export const ADR_FILENAME = /^ADR-(\d{3,4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
export const WP_FIELDS = ['files', 'depends', 'covers', 'tests', 'verify']

export const idsIn = (s) => [...String(s).matchAll(new RegExp(`\\b(${P_ALT})-(\\d{1,4})\\b`, 'g'))].map((m) => `${m[1]}-${m[2]}`)
export const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')
export const unquote = (s) => s.trim().replace(/^["']|["']$/g, '')
export const isNull = (v) => v == null || v === 'null' || v === '' || (Array.isArray(v) && v.length === 0)

/** 프런트매터의 스칼라·인라인 배열·블록 목록만 지원한다. */
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

/** 코드 블록 안의 예시는 정의로 집계하지 않는다. */
export function outsideFence(lines) {
  const ok = new Array(lines.length).fill(true)
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; ok[i] = false; return }
    ok[i] = !fence
  })
  return ok
}

/** 제목의 티어 표기를 섹션 검사에 사용한다. */
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

/** ‘키: 값’과 ‘- 키: 값’을 필드로 읽는다. */
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

/** 인라인 범위 표기. AC 는 한 줄이라 필드 줄을 달 자리가 없어 제목 끝에 붙인다. */
export const SCOPE_TAG = /`scope:\s*([^`]+)`/i
export const scopeList = (raw) => String(raw ?? '')
  .split(/[,·]/).map((s) => s.trim().replace(/^["'`]|["'`]$/g, '')).filter(Boolean)

/** 항목의 유효 범위. 자기 것이 없으면 상위 요구사항에서 물려받는다. */
export const scopeOf = (e, parent) => (e?.scope?.length ? e.scope : parent?.scope ?? [])

/** 중복 ID의 처리는 호출자가 onDup으로 지정한다. */
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
    const fields = fieldsOf(body)
    add({
      id: `${m[1]}-${m[2]}`, title: m[3].replace(/`[^`]*`/g, '').trim(),
      priority: prio ? prio[1] : null, line: h.line, kind: 'heading',
      scope: scopeList(fields.get('scope') ?? SCOPE_TAG.exec(m[3])?.[1]),
      fields, bodyLines: body, body: body.join('\n'), section: sectionOf(hs, h.line),
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
        scope: [], fields: fieldsOf(body), bodyLines: body, body: body.join('\n'), section: sectionOf(hs, i) })
      return
    }
    const ac = /^\s*[-*]\s+\[[ xX]\]\s+(AC-\d{1,4})\s*[—–-]\s*(.+?)\s*$/.exec(line)
    if (ac) {
      const owner = [...out.values()].filter((e) => e.kind === 'heading' && e.line < i && /^(FR|NFR)-/.test(e.id)).pop()
      const tag = SCOPE_TAG.exec(ac[2])
      const title = ac[2].replace(SCOPE_TAG, '').trim()
      add({ id: ac[1], title, priority: null, line: i, kind: 'ac', parent: owner?.id ?? null,
        scope: scopeList(tag?.[1]), fields: new Map(), bodyLines: [], body: title, section: sectionOf(hs, i) })
    }
  })
  return out
}

/** ADR 파일을 산출물 공통 구조로 읽는다. */
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

/** 파일명이 규칙에 맞지 않으면 본문을 읽지 않고 이름만 반환한다. */
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

/** 존재하는 산출물만 읽는다. 일부 문서만 있는 디렉터리도 허용한다. */
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

/** 템플릿 원본은 내용 검사에서 제외한다. */
export const isTemplate = (docs) => Object.values(docs)
  .some((doc) => /YYYY-NNN/.test(String(doc?.fm?.id ?? '')))

/** 검사기와 린터의 공통 출력 형식. */
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

/** 작업 의존 관계와 실행 레벨을 검사기·실행 도구가 공유한다. */
export const wpField = (e, k) => (e.fields.has(k) ? e.fields.get(k) : '')
export const wpFiles = (w) => {
  const v = wpField(w, 'files')
  const ticked = [...v.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())
  return (ticked.length ? ticked : v.split(',')).map((s) => s.trim().replace(/^`|`$/g, '')).filter(Boolean)
}
export const wpDeps = (w) => idsIn(wpField(w, 'depends')).filter((x) => x.startsWith('WP-'))

/** 반환값: {level, cycles, unknown}. 순환·미정의 의존 작업의 레벨은 0이다. */
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
