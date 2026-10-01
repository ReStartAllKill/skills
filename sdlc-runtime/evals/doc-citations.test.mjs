/** Every «read section X of document Y» in the harness names a heading Y actually has.
 *
 * Skills, references and tool messages send the model (or a person) to a named section. When the
 * reference documents were translated, a handful of skills kept citing the old Korean titles, and
 * nothing noticed: a dangling citation reads exactly like a working one, the model just lands on a
 * page without that heading and guesses. This test walks every citation it can recognise, resolves
 * the document and looks the title up among its headings.
 *
 * The recogniser is deliberately narrow — it matches only the shapes the repository writes:
 *   `path/to/doc.md`(의|'s)? (under)? 「T」 | «T» | “T”   (optionally «A» · «B» · «C» 절)
 *   「T」 | «T» | “T” in `path/to/doc.md`
 *   규약 「T」                                          (규약 = conventions)
 *   see «T»                                             (a section of the same document)
 * A document path must be in backticks and the title must follow it with nothing but whitespace or
 * a particle between them. Widening it to bare quoted phrases would flag every «…» used as a
 * quotation; plain ASCII "…" is left out because no citation uses it and code strings would drown it.
 * Because a recogniser that matches nothing would pass silently, the test also fails on zero. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const RUNTIME = join(ROOT, 'sdlc-runtime')

/** Eval fixtures are artifacts, not documentation — they quote section titles as content. */
const SKIP = new Set(['evals', 'node_modules', '.git'])

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(md|mjs|sh)$/.test(name)) out.push(p)
  }
  return out
}

const sources = () => [
  ...walk(join(ROOT, 'skills')), ...walk(RUNTIME), ...walk(join(ROOT, 'agents')), ...walk(join(ROOT, 'commands')),
  ...['README.md', 'README.ko.md', 'CLAUDE.md'].map((f) => join(ROOT, f)).filter(existsSync),
]

/** A title may wrap once, as prose wrapped at 100 columns does; two breaks would be a paragraph. */
const inQuote = (close) => String.raw`([^${close}\n]{1,80}(?:\n[^${close}\n]{1,80})?)`
const Q = String.raw`(?:「${inQuote('」')}」|«${inQuote('»')}»|“${inQuote('”')}”)`
const qtext = (m, at) => m[at] ?? m[at + 1] ?? m[at + 2]
const DOC = String.raw`\x60((?:<[^>\x60\n]+>|[^\x60\s<])*\.md)\x60`
const DOC_THEN_TITLES = new RegExp(String.raw`${DOC}[ \t]*(?:의|'s)?\s*(?:under\s+)?(${Q}(?:\s*·\s*${Q})*)`, 'g')
const TITLE_THEN_DOC = new RegExp(String.raw`${Q}\s+(?:in|under)\s+${DOC}`, 'g')
const ALIAS_THEN_TITLE = new RegExp(String.raw`규약\s*${Q}`, 'g')
const SEE_HERE = new RegExp(String.raw`\b[Ss]ee\s+${Q}(?!\s+in\s+\x60)`, 'g')
const ONE_Q = new RegExp(Q, 'g')

/** Collects { file, line, doc, title } from one file's text. */
export function citations(file, text) {
  const out = []
  const lineAt = (i) => text.slice(0, i).split('\n').length
  for (const m of text.matchAll(DOC_THEN_TITLES)) {
    const at = m.index + m[0].length - m[2].length
    for (const t of m[2].matchAll(ONE_Q)) out.push({ file, line: lineAt(at + t.index), doc: m[1], title: qtext(t, 1) })
  }
  for (const m of text.matchAll(TITLE_THEN_DOC)) out.push({ file, line: lineAt(m.index), doc: m[4], title: qtext(m, 1) })
  for (const m of text.matchAll(ALIAS_THEN_TITLE)) out.push({ file, line: lineAt(m.index), doc: 'conventions.md', title: qtext(m, 1) })
  if (file.endsWith('.md')) for (const m of text.matchAll(SEE_HERE)) out.push({ file, line: lineAt(m.index), doc: '.', title: qtext(m, 1) })
  return out
}

/** Expands a `<placeholder>` path segment (`assets/<lang>/…`) to every directory standing there. */
function expand(base, parts) {
  if (!parts.length) return existsSync(base) && statSync(base).isFile() ? [base] : []
  const [head, ...rest] = parts
  if (/^<[^>]+>$/.test(head)) {
    if (!existsSync(base) || !statSync(base).isDirectory()) return []
    return readdirSync(base).flatMap((d) => expand(join(base, d), rest))
  }
  return expand(join(base, head), rest)
}

/** A path is written relative to whoever reads it: the skill folder, the runtime, or a sibling. */
function resolveDoc(file, doc) {
  if (doc === '.') return [file]
  const rel = doc.replace(/^<sdlc_runtime>\//, '').replace(/^sdlc-runtime\//, '')
  const skillDir = file.includes(`${join(ROOT, 'skills')}/`) ? dirname(file) : null
  const bases = doc.startsWith('<sdlc_runtime>/') ? [RUNTIME]
    : [skillDir, dirname(file), RUNTIME, join(RUNTIME, 'references'), ROOT].filter(Boolean)
  for (const b of bases) {
    const hit = expand(b, rel.split('/'))
    if (hit.length) return hit
  }
  return []
}

/** The checker's comparison: backtick markers do not count, nor do case and spacing. A trailing
 *  parenthetical («진행 상태 (Step 1b)», «🎯 Intent (항상)») qualifies a heading, it does not name it. */
const norm = (s) => s.replace(/`[^`]*`/g, '').replace(/\s+/g, '').toLowerCase()
function headingsOf(path) {
  const hs = []
  let fence = false
  readFileSync(path, 'utf8').split('\n').forEach((l) => {
    if (/^\s*```/.test(l)) { fence = !fence; return }
    const m = !fence && /^#{1,6}\s+(.+?)\s*$/.exec(l)
    if (m) hs.push(m[1])
  })
  return hs
}
const has = (hs, title) => hs.some((h) => norm(h) === norm(title) || norm(h.replace(/\s*\([^()]*\)\s*$/, '')) === norm(title))

export function dangling(list) {
  const bad = []
  for (const c of list) {
    const docs = resolveDoc(c.file, c.doc)
    const where = `${relative(ROOT, c.file)}:${c.line}`
    if (!docs.length) { bad.push(`${where} — 「${c.title}」 cites \`${c.doc}\`, which does not resolve to a file`); continue }
    if (docs.some((d) => has(headingsOf(d), c.title))) continue
    const near = docs.flatMap(headingsOf).filter((h) => !/^[A-Z]+-\d/.test(h))
    bad.push(`${where} — \`${c.doc}\` has no heading «${c.title}». Its headings: ${near.map((h) => `«${h}»`).join(' · ')}`)
  }
  return bad
}

test('every cited section title exists in the document it names', () => {
  const list = sources().flatMap((f) => citations(f, readFileSync(f, 'utf8')))
  assert.ok(list.length > 0, 'no section citations recognised at all — the recogniser is broken, not the documents clean')
  const bad = dangling(list)
  assert.equal(bad.length, 0, `${bad.length} of ${list.length} section citations do not resolve:\n${bad.join('\n')}`)
})

test('the recogniser catches a dangling citation and leaves an ordinary quotation alone', () => {
  const file = join(ROOT, 'skills/sdlc/create-adr/SKILL.md')
  const text = [
    '`<sdlc_runtime>/references/adr.md`의',
    '   「판정」 기준에 따른다. 규약 「Tiers」를 본다.',
    '사용자가 «승인» 이라고 말하면 멈춘다.',
    'See “Artifact syntax” in `conventions.md`.',
  ].join('\n')
  const list = citations(file, text)
  assert.deepEqual(list.map((c) => c.title).sort(), ['Artifact syntax', 'Tiers', '판정'])
  const bad = dangling(list)
  assert.equal(bad.length, 1, bad.join('\n'))
  assert.match(bad[0], /SKILL\.md:2 .*«판정».*«What qualifies as an ADR»/)
})
