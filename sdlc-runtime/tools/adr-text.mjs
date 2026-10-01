/** What an ADR says, read from its text: sections, alternatives, the legacy header, the digest
 *  `task-brief` injects, and the content hash a code repository binds to.
 *
 *  A leaf module on purpose. `adr-check` imports `adr-bindings`, and `adr-bindings` now needs the
 *  content hash to compare a manifest against an upstream checkout; reaching back into `adr-check`
 *  for it would close an import cycle, which deadlocks the CLI's top-level await. So the readers both
 *  need live here, and `adr-check` re-exports them for the callers that always imported them there. */
import { createHash } from 'node:crypto'
import { stripComments, isNull, bodyOf } from './artifact-parse.mjs'
import { SECTION, CHOSEN, canonical, ADR_STATUS_ALIASES, LEGACY_STATUS_ROW } from './keywords.mjs'

export const CHOSEN_RE = new RegExp(`\\((?:${CHOSEN.join('|')})\\)`, 'i')
const sameTitle = (a, b) => a.replace(/\s*및\s*/g, '과').replace(/\s+/g, '').toLowerCase() === b.replace(/\s*및\s*/g, '과').replace(/\s+/g, '').toLowerCase()

export const sectionText = (doc, title) => {
  const h = doc.hs.find((x) => x.depth === 2 && sameTitle(x.title.replace(/`\[[^\]]*\]`/g, '').trim(), title))
  return h ? { h, text: stripComments(doc.lines.slice(h.line + 1, h.allEnd).join('\n')) } : null
}
export const titleIn = (doc, key) => SECTION[key].find((t) => sectionText(doc, t) != null) ?? SECTION[key][1]

export function alternativesOf(doc) {
  const heads = [...doc.ents.values()].filter((e) => e.id.startsWith('ALT-'))
    .map((e) => ({ id: e.id, title: e.title, chosen: CHOSEN_RE.test(e.title) }))
  if (heads.length) return heads
  const sec = sectionText(doc, titleIn(doc, 'alternatives'))
  if (!sec) return []
  const row = sec.text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('|'))
  if (!row) return []
  const cells = row.split('|').slice(1, -1).map((c) => c.trim()).filter(Boolean)
  return cells.slice(1).map((t, i) => ({ id: `표 ${i + 1}번째 열`, title: t, chosen: CHOSEN_RE.test(t) }))
}

export function scopeEntry(raw, self) {
  const s = String(raw).trim()
  const m = /^([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?):(.+)$/.exec(s)
  if (!m) return { repo: null, path: s, mine: true }
  const tail = (x) => String(x).split('/').pop()
  return { repo: m[1], path: m[2].trim(), mine: !!self && tail(m[1]) === tail(self) }
}

export function legacyMeta(doc) {
  if (/^---\r?\n/.test(doc.text)) return null
  const h1 = /^#\s+(.+?)\s*$/m.exec(doc.text)?.[1] ?? ''
  const title = h1.replace(/^ADR-\d{3,4}\s*[—–:-]?\s*/, '').trim()
  const row = LEGACY_STATUS_ROW.exec(doc.text)?.[1] ?? ''
  const raw = row.replace(/\(.*$/, '').trim()
  const known = canonical(raw, ADR_STATUS_ALIASES)
  return { title, status: known ?? '', rawStatus: raw, legacy: true }
}

/** The repositories a decision constrains. An ADR written before `applies_to` names them only
 *  through `repo:path` scope entries, and those stand in for it, so a code repository learns which
 *  decisions are its own before the document repository migrates. A legacy ADR names none. */
export function appliesToOf(doc) {
  if (legacyMeta(doc)) return []
  const list = (v) => [].concat(v ?? []).map(String).filter((x) => !isNull(x))
  const explicit = list(doc.fm?.applies_to)
  if (explicit.length) return explicit
  return [...new Set(list(doc.fm?.scope).map((s) => scopeEntry(s, null)).filter((e) => e.repo).map((e) => e.repo))]
}

export function adrDigest(doc) {
  const dec = sectionText(doc, titleIn(doc, 'decision'))
  const alts = alternativesOf(doc)
  const decBody = dec ? dec.text.split(/^###\s/m)[0].trim() : ''
  const ng = doc.hs.find((h) => h.depth === 3 && /^Non-goals$/i.test(h.title))
  const nonGoals = ng
    ? stripComments(doc.lines.slice(ng.line + 1, ng.allEnd).join('\n')).split('\n')
        .map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, ''))
    : []
  return {
    id: String(doc.fm?.id ?? doc.name),
    title: String(doc.fm?.title ?? ''),
    file: doc.name,
    status: String(doc.fm?.status ?? ''),
    scope: [].concat(doc.fm?.scope ?? []).map(String).filter((v) => !isNull(v)),
    decision: decBody,
    nonGoals,
    chosen: alts.filter((a) => a.chosen).map((a) => a.title.replace(CHOSEN_RE, '').trim()),
    rejected: alts.filter((a) => !a.chosen).map((a) => a.title),
  }
}

/** The hash of what a code repository binds to: the whole Decision section (its `### Non-goals`
 *  and any other subsection with it), every alternative's title with its chosen marker, `status`
 *  and `superseded_by`. A binding and a pin keyed on the commit that last touched the file went
 *  stale on a typo in the Context section, on a frontmatter edit adding another repository to
 *  `applies_to`, and on a squash merge that rewrote the SHA under identical text — so every consumer
 *  of a busy document repository was red for changes that left its constraints as they were. The
 *  move is the one schema 7 made for spec pins (`body:`), narrowed to the parts that constrain code.
 *
 *  Left out: the title, `applies_to` (which repositories a decision reaches is not what it says),
 *  the other four sections, and the rest of the frontmatter. Normalised: HTML comments are dropped
 *  (`sectionText` strips them, as the injected digest always has), and every run of whitespace —
 *  line endings, a reflowed paragraph, trailing spaces — counts as one space, ends trimmed. A body
 *  pin keeps both, because there every writer must agree on the bytes without a parser; here both
 *  sides already parse the ADR the same way, so the stricter reading would only report reflows.
 *
 *  A document with no Decision section this reader can find — a legacy ADR under a heading the
 *  aliases miss — is hashed over its whole body instead, `bodyOf` as the body pin reads it: with
 *  nothing recognised, an empty Decision would hash the same forever and a changed decision would
 *  read as unchanged. The fallback is stricter than needed and never blind. The `adr-digest/1` tag
 *  makes a later change of this definition a different hash rather than a silent equal one. */
export function decisionHash(doc) {
  const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
  const legacy = legacyMeta(doc)
  const dec = sectionText(doc, titleIn(doc, 'decision'))
  const parts = {
    v: 'adr-digest/1',
    status: legacy ? legacy.status : flat(doc.fm?.status),
    superseded_by: legacy ? [] : [].concat(doc.fm?.superseded_by ?? []).map(String).filter((x) => !isNull(x)).map(flat),
    decision: dec ? flat(dec.text) : null,
    alternatives: dec ? alternativesOf(doc).map((a) => flat(a.title)) : [],
    body: dec ? null : flat(bodyOf(doc.text)),
  }
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex')
}
/** The form `at:` and a pin's `@` suffix take — the body pin's shape, 12 hex characters. */
export const digestPin = (hex) => `body:${String(hex).slice(0, 12)}`
