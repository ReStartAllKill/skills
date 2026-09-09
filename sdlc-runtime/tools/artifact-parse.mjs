import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SDLC_VERSION = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../VERSION'), 'utf8').trim()
export const CURRENT_SCHEMA_VERSION = Number(SDLC_VERSION)
export const LEGACY_SCHEMA_VERSION = 1
export const SUPPORTED_SCHEMA_VERSIONS =
  Array.from({ length: CURRENT_SCHEMA_VERSION - LEGACY_SCHEMA_VERSION + 1 }, (_, i) => LEGACY_SCHEMA_VERSION + i)
export const schemaVersion = (fm = {}) => {
  if (isNull(fm.schema_version)) return LEGACY_SCHEMA_VERSION
  const n = Number(fm.schema_version)
  return Number.isInteger(n) ? n : null
}

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
PREFIXES.ASM.also = ['adr']

export const P_ALT = 'RISK|EDGE|HYP|NFR|OUT|CON|ASM|SCN|ALT|FR|AC|EV|FQ|SQ|SD|TD|WP|PQ|RV|Q'
export const CHAIN_FILES = { finding: 'finding.md', intent: 'intent.md', spec: 'spec.md', plan: 'plan.md' }
export const FILES = { ...CHAIN_FILES, adr: 'ADR-*.md' }
export const ADR_FILENAME = /^ADR-(\d{3,4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
export const WP_FIELDS = ['files', 'depends', 'covers', 'tests', 'verify']

export const idsIn = (s) => [...String(s).matchAll(new RegExp(`\\b(${P_ALT})-(\\d{1,4})\\b`, 'g'))].map((m) => `${m[1]}-${m[2]}`)
export const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')
export const unquote = (s) => s.trim().replace(/^["']|["']$/g, '')
export const isNull = (v) => v == null || v === 'null' || v === '' || (Array.isArray(v) && v.length === 0)

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

export function outsideFence(lines) {
  const ok = new Array(lines.length).fill(true)
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; ok[i] = false; return }
    ok[i] = !fence
  })
  return ok
}

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

export const SCOPE_TAG = /`scope:\s*([^`]+)`/i
export const scopeList = (raw) => String(raw ?? '')
  .split(/[,·]/).map((s) => s.trim().replace(/^["'`]|["'`]$/g, '')).filter(Boolean)

export const scopeOf = (e, parent) => (e?.scope?.length ? e.scope : parent?.scope ?? [])

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

export const isTemplate = (docs) => Object.values(docs)
  .some((doc) => /YYYY-NNN/.test(String(doc?.fm?.id ?? '')))

export function report({ title, notes = [], problems, strict, ruleDoc, json = false }) {
  const errors = problems.filter((p) => p.level === 'error')
  const warns = problems.filter((p) => p.level === 'warn')
  if (json) {
    const exitCode = errors.length || (strict && warns.length) ? 1 : 0
    console.log(JSON.stringify({ version: 1, title, notes, problems, counts: { errors: errors.length, warnings: warns.length }, exitCode }))
    return exitCode
  }
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

export const wpField = (e, k) => (e.fields.has(k) ? e.fields.get(k) : '')
export const wpFiles = (w) => {
  const v = wpField(w, 'files')
  const ticked = [...v.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())
  return (ticked.length ? ticked : v.split(',')).map((s) => s.trim().replace(/^`|`$/g, '')).filter(Boolean)
}
export const wpDeps = (w) => idsIn(wpField(w, 'depends')).filter((x) => x.startsWith('WP-'))

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
