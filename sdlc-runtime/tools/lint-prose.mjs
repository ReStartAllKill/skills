#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import {
  loadDir, isTemplate, idsIn, stripComments, report, P_ALT, SDLC_VERSION, ADR_FILENAME, loadAdrDir,
  SUPPORTED_SCHEMA_VERSIONS, schemaVersion,
} from './artifact-parse.mjs'
import { SECTION, RE_DIVERGENCE, RESULT, NO_DIVERGENCE, PRIORITIES, TIERS, STATUSES, hasAlias } from './keywords.mjs'
import { loadLock } from './upstream.mjs'
import { lintWarningPolicy } from './profile.mjs'
import { useLocale } from './locale.mjs'

const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  console.log(`sdlc-runtime ${SDLC_VERSION}; schemas ${SUPPORTED_SCHEMA_VERSIONS.join(',')}`)
  process.exit(0)
}
let policy
try { policy = lintWarningPolicy(argv.find((a) => !a.startsWith('--')) ?? '.') } catch (e) { console.error(e.message); process.exit(2) }
const STRICT = argv.includes('--strict') || policy === 'error'
const DIR = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')

// REC-* 도 재는 자리다. 사실·추론·가정을 가르는 것은 기계가 볼 수 없지만, «더 빠르다» 로 끝난 판단은
// 무엇을 근거로 그렇게 말했는지 어차피 아무도 못 되짚는다.
const MEASURED = /^(OUT|FR|NFR|AC|REC)-/

const TIER_MULT = { light: 1, standard: 1.6, full: 2.4 }

const L = useLocale(DIR)
const { vague: VAGUE, translationese: TRANSLATIONESE, meta: META, budget: BUDGET, script: SCRIPT } = L
const MAX_SENTENCES = L.limits.sentences
const MAX_TITLE = L.limits.title
const MAX_FIELD = L.limits.field
const MAX_AC = L.limits.ac
const MAX_LOG = L.limits.logNote

const hits = (needle, line) => (needle instanceof RegExp ? needle.test(line) : line.includes(needle))
const shown = (needle) => (needle instanceof RegExp ? needle.source.replace(/\\b/g, '').replace(/\(\?:/g, '(') : needle)

const problems = []
const add = (level, doc, line, rule, msg, hint) => problems.push({ level, doc, line, rule, msg, hint })
const notes = []

const docs = (() => {
  const isDir = existsSync(DIR) && statSync(DIR).isDirectory()
  const adrDir = isDir ? DIR : dirname(DIR)
  const one = isDir ? null : basename(DIR)
  if (one && !ADR_FILENAME.test(one)) return loadDir(DIR)
  const found = loadAdrDir(adrDir).docs.filter((d) => !one || d.name === one)
  if (found.length) return Object.fromEntries(found.map((d) => [d.name, d]))
  return isDir ? loadDir(DIR) : {}
})()
const VENDOR = (() => {
  const isDir = existsSync(DIR) && statSync(DIR).isDirectory()
  const lock = isDir ? loadLock(DIR) : null
  return lock && !lock.broken ? new Set(Object.keys(lock.files)) : new Set()
})()
const vendored = Object.keys(docs).filter((k) => VENDOR.has(docs[k].name)).map((k) => ({ k, name: docs[k].name }))
// A vendored copy is not linted here, but it stays in `docs`: the plan's checks read the spec's
// acceptance criteria and the intent's tier, and only the consumer repository holds both sides of
// those. Dropping the document dropped the checks with it, which is the failure this guards.
const LINTED = Object.fromEntries(Object.entries(docs).filter(([k]) => !vendored.some((v) => v.k === k)))
if (vendored.length) notes.push(`벤더한 사본 ${vendored.map((v) => v.name).join(' · ')} 은 상류가 린트한다 — 여기서는 상호 참조로만 읽는다.`)
if (Object.keys(LINTED).length === 0 && vendored.length) {
  process.exit(report({ title: `산문 린트 — ${basename(DIR)}`, notes, problems, json: argv.includes('--json') }))
}
if (Object.keys(docs).length === 0) {
  if (argv.includes('--json')) process.exit(report({ title: '', problems: [{ level: 'error', doc: DIR, rule: 'artifacts-missing', msg: `산출물이 없다 — ${DIR} 에 intent.md / spec.md / plan.md / finding.md / research.md / ADR-*.md 가 하나도 없다.` }], json: true }))
  console.error(`산출물이 없다 — ${DIR} 에 intent.md / spec.md / plan.md / finding.md / research.md / ADR-*.md 가 하나도 없다.`)
  process.exit(1)
}
const schema = schemaVersion((docs.intent ?? docs.finding ?? docs.spec ?? docs.plan ?? Object.values(docs)[0])?.fm)
if (schema != null) notes.push(`산출물 schema v${schema}${schema === 1 ? ' (무버전 문서 호환)' : ''} · runtime ${SDLC_VERSION}`)
if (isTemplate(LINTED) && !argv.includes('--json')) {
  console.log(`\n산문 린트 — ${basename(DIR)}\n  · 템플릿 원본이다 — 주석과 placeholder 가 있는 것이 정상이라 «항목을 행으로 접었나» 검사만 돈다.`)
}
const TEMPLATE = isTemplate(LINTED)

const tokens = (s) => new Set(String(s).toLowerCase().match(/[가-힣a-z0-9]{2,}/g) ?? [])
const sentences = (s) => (stripComments(s).replace(/\.(?=\S)/g, '').match(/[^.!?\n]*(?:다\.|[.!?])/g) ?? []).filter((x) => x.trim().length > 4).length

const ADR_ONLY = Object.values(LINTED).every((d) => d.kind === 'adr')
// ADR 과 조사에는 티어가 없다. 남의 티어 배수를 빌려 재면 같은 문서가 옆에 선 산출물 세트에 따라
// 길어졌다 짧아졌다 한다.
const UNTIERED = new Set(['adr', 'research'])
// The plan's own tier is the last resort, not the first: the intent is where the tier is decided,
// and a plan whose frontmatter drifted from it should be measured by the decision, not the drift.
const TIER = docs.intent?.fm?.tier ?? docs.finding?.fm?.tier ?? docs.plan?.fm?.tier ?? (ADR_ONLY ? '—' : 'standard')
const multOf = (d) => (ADR_ONLY || UNTIERED.has(d.kind) ? 1 : (TIER_MULT[TIER] ?? 1.6))
const chars = (s) => stripComments(String(s)).replace(/\s+/g, '').length

for (const d of Object.values(LINTED)) {
  if (!TEMPLATE) {
    const prose = stripComments(
      d.lines.filter((_, i) => d.live[i]).join('\n').replace(/^---[\s\S]*?---/, ''),
    ).replace(/`[^`]*`/g, '')
    const mine = (prose.match(SCRIPT.test) ?? []).length
    const other = (prose.match(SCRIPT.against) ?? []).length
    if (mine + other >= SCRIPT.minChars && mine / (mine + other) < SCRIPT.minRatio) {
      add('warn', d.name, 1, 'lang-unsupported',
        `${SCRIPT.name} 문서가 아니다 (${SCRIPT.name} ${Math.round((mine / (mine + other)) * 100)}%)`,
        `문체 검사(번역체·메타·모호어)는 ${SCRIPT.name} 낱말 목록이라 이 문서에서는 하나도 걸리지 않고, 글자 한도도 ${SCRIPT.name} 기준이라 다른 언어에는 안 맞는다. 이 레포의 산출물 언어는 프로필의 \`lang\` 이 정한다.`)
    }
  }

  d.lines.forEach((line, i) => {
    if (!d.live[i]) return
    if (!/^\s*\|/.test(line)) return
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(d.lines[i + 1] ?? '')) return
    const cols = line.trim().replace(/^\||\|$/g, '').split('|').length
    let rowIds = 0
    for (let j = i + 2; j < d.lines.length && /^\s*\|/.test(d.lines[j]); j++) {
      const first = (d.lines[j].trim().replace(/^\||\|$/g, '').split('|')[0] ?? '').replace(/`/g, '').trim()
      if (new RegExp(`^(${P_ALT})-\\d{1,4}$`).test(first)) rowIds++
    }
    // 조사의 비교표만 예외다 — 머리행이 OPT-* 면 이 표는 기준 × 선택지의 진짜 2차원 자료이고, 행을
    // 펴면 같은 값을 선택지 수만큼 되풀이하게 된다. 이 규칙이 막는 것은 목록을 표로 접는 일이지
    // 표 자체가 아니다.
    const comparison = d.kind === 'research' &&
      line.trim().replace(/^\||\|$/g, '').split('|').some((c) => /\bOPT-\d{1,4}\b/.test(c))
    if (rowIds > 0 && !comparison) {
      add('error', d.name, i + 1, 'entity-table', `항목 ${rowIds}개를 표의 행으로 접었다`,
        '`### ID — 제목` 헤딩과 그 밑 단락으로 편다. 셀은 짧아야 해서 결론만 남고 «왜» 가 빠진다 — 그것이 제약이나 요구사항의 절반이다.')
      return
    }
    if (cols >= 5 && (d.kind === 'intent' || d.kind === 'spec')) {
      add('warn', d.name, i + 1, 'wide-table', `${cols}열짜리 표다`,
        `${d.name} 의 독자에는 엔지니어가 아닌 사람이 있다. 넓은 표는 «채워야 할 양식» 으로 읽힌다 — 정말 2차원 자료가 맞는지 다시 본다.`)
    }
  })
  if (TEMPLATE) continue

  d.lines.forEach((line, i) => {
    if (!d.live[i] || /^\s*(?:[-*]\s+)?[A-Za-z가-힣_][A-Za-z가-힣_ ]{0,19}:\s/.test(line)) return
    const clean = stripComments(line)
    for (const [w, fix] of TRANSLATIONESE) {
      if (!hits(w, clean)) continue
      add('warn', d.name, i + 1, 'translationese', `번역체 — «${shown(w)}»`, fix)
    }
    for (const [re, fix] of META) {
      if (!re.test(clean)) continue
      add('warn', d.name, i + 1, 'meta', '문서가 내용 대신 자기 자신을 말한다', fix)
    }
  })

  d.lines.forEach((line, i) => {
    if (!/<!--/.test(line)) return
    add('error', d.name, i + 1, 'comment', '템플릿 주석이 남아 있다',
      '인스턴스화하면 주석은 지운다. 남으면 산출물이 «작성 지시문» 을 함께 배포하게 되고, 읽는 사람은 어느 쪽이 내용인지 판단해야 한다.')
  })

  for (const e of d.ents.values()) {
    if (e.kind !== 'ac' && e.title.length > MAX_TITLE) {
      add('warn', d.name, e.line + 1, 'long-title', `${e.id} 의 제목이 ${e.title.length}자다`,
        `제목은 목록에서 훑어보는 라벨이다. ${MAX_TITLE}자 안으로 줄이고 자세한 것은 본문에 쓴다.`)
    }
    for (const [k, v] of e.fields) {
      if (v.length <= MAX_FIELD) continue
      add('warn', d.name, e.line + 1, 'long-field', `${e.id} 의 \`${k}:\` 가 ${v.length}자다`,
        '필드는 한 줄이다. 문단이 필요하면 본문으로 내린다.')
    }
    const prose = e.bodyLines.filter((l) => !/^\s*(?:[-*]\s+)?[A-Za-z가-힣_][A-Za-z가-힣_ ]{0,19}:\s/.test(l) && !/^\s*[-*]\s+\[[ xX]\]/.test(l))
    const n = sentences(prose.join(' '))
    if (n > MAX_SENTENCES) {
      add('warn', d.name, e.line + 1, 'long-item', `${e.id} 의 본문이 ${n}문장이다`,
        `한 항목은 한 단락이다. ${MAX_SENTENCES}문장을 넘으면 두 항목으로 갈라야 한다는 신호다.`)
    }
    if (MEASURED.test(e.id)) {
      const hay = e.kind === 'ac' ? [e.title] : [e.title, ...prose]
      for (const line of hay) {
        if (/\d/.test(line)) continue // 수치가 있으면 제외한다.
        const hit = VAGUE.find((w) => hits(w, line))
        if (!hit) continue
        add(e.kind === 'ac' ? 'error' : 'warn', d.name, e.line + 1, 'vague', `${e.id} 에 «${shown(hit)}» — 측정 기준이 아니다`,
          e.kind === 'ac' ? '수용 기준은 참·거짓이 갈려야 한다. 수치·백분위·조건으로 바꾼다.'
            : '재는 자리다. «얼마나»를 수치나 조건으로 적는다.')
      }
    }
    const cap = e.kind === 'ac' ? MAX_AC : Math.round((BUDGET[d.kind]?.entity ?? 400) * multOf(d))
    const size = e.kind === 'ac' ? e.title.length : chars(prose.join('') + e.title)
    if (size > cap) {
      add(size > cap * 2 ? 'error' : 'warn', d.name, e.line + 1, 'too-long',
        `${e.id} 이 ${size}자다 (한도 ${cap})`,
        e.kind === 'ac' ? '수용 기준은 한 문장이다. 길어지면 기준이 둘 이상 섞인 것이다.'
          : '한 항목이 길어지면 그것은 대개 두 항목이다. 갈라 쓰거나 아래 층(spec·plan)으로 내린다.')
    }
    if (e.kind === 'ac' && !L.acSentence.test(e.title.trim())) {
      add('warn', d.name, e.line + 1, 'untestable-ac', `${e.id} 이 서술문으로 끝나지 않는다`,
        '«<언제>이면 시스템은 <무엇을> 한다» 꼴로 쓴다. 명사로 끝나면 그건 기준이 아니라 항목 이름이다.')
    }
  }

  const budget = BUDGET[d.kind]
  if (budget) {
    for (const h of d.hs.filter((x) => x.depth === 2)) {
      const cap = Math.round(budget.section * multOf(d))
      const n = chars(d.lines.slice(h.line + 1, h.allEnd).filter((_, k) => d.live[h.line + 1 + k]).join(''))
      if (n <= cap) continue
      add(n > cap * 2 ? 'error' : 'warn', d.name, h.line + 1, 'too-long',
        `«${h.title}» 이 ${n}자다 (한도 ${cap})`,
        '이 섹션이 담을 것보다 많이 담았다. 항목으로 갈라 쓰거나 아래 층으로 내린다.')
    }
    const capDoc = Math.round(budget.doc * multOf(d))
    const total = chars(d.lines.filter((_, i) => d.live[i]).join('').replace(/^---[\s\S]*?---/, ''))
    if (total > capDoc) {
      add(total > capDoc * 2 ? 'error' : 'warn', d.name, null, 'too-long',
        `${d.name} 이 ${total}자다 (${TIER} 한도 ${capDoc})`,
        d.kind === 'intent'
          ? '이 문서의 독자는 발안자와 제품 책임자다. 길어지면 «읽고 판단하는 문서» 가 «훑고 넘기는 문서» 가 된다 — 세부는 spec 으로 내린다.'
          : '티어를 올려야 하는 변경인지, 아니면 한 문서에 두 변경을 담았는지 본다.')
    }
  }

  if (d.kind !== 'plan') continue

  // The execution log is not made of entities, so none of the item limits above reach it. Without
  // a rule of its own a single 800-character entry passes as long as the section total fits.
  const logH = d.hs.find((h) => h.depth === 2 && hasAlias(h.title, SECTION.executionLog))
  if (logH) {
    const entries = []
    // ownEnd, not allEnd: §Change log is a `###` child of this section and is a different record.
    for (let i = logH.line + 1; i < logH.ownEnd; i++) {
      if (!d.live[i]) continue
      const line = stripComments(d.lines[i])
      if (/^-[ \t]/.test(line)) entries.push({ line: i, text: line })
      else if (entries.length && line.trim()) entries[entries.length - 1].text += ' ' + line.trim()
    }
    for (const e of entries) {
      const label = RE_DIVERGENCE.exec(e.text)
      // Measure the note alone. The date, task IDs and result in front of it are written by
      // `plan-check mark` and are not the author's to shorten.
      const note = (label ? e.text.slice(label.index + label[0].length) : e.text.replace(/^-[ \t]*/, '')).trim()
      if (note.length <= MAX_LOG) continue
      add(note.length > MAX_LOG * 2 ? 'error' : 'warn', d.name, e.line + 1, 'long-log',
        label ? `실행 기록 한 줄의 «${L.written.divergence}» 가 ${note.length}자다 (한도 ${MAX_LOG})`
              : `실행 기록의 한 줄이 ${note.length}자다 (한도 ${MAX_LOG}) — «${L.written.divergence}» 라벨도 없다`,
        '무엇이 어떻게 달랐는지만 남긴다. 원인 분석·시도한 것·로그 발췌는 커밋 메시지와 verify 로그에 이미 있고, 옮겨 적으면 훑어야 할 차이가 그 사이에 묻힌다.')
    }
  }

  const specAcs = new Map([...(docs.spec?.ents ?? new Map())].filter(([id]) => id.startsWith('AC-')))
  const wps = [...d.ents.values()].filter((e) => e.kind === 'wp')

  // The overlap check assumes `tests:` and the acceptance criteria are written in one language.
  // Where test names are code identifiers and the criteria are not, every task scores zero and the
  // rule fires on all of them — as useless as being off, and louder about it.
  const testText = wps.map((w) => w.fields.get('tests') ?? '').join(' ')
  const mine = (testText.match(SCRIPT.test) ?? []).length
  const other = (testText.match(SCRIPT.against) ?? []).length
  if (mine + other >= 40 && mine / (mine + other) < SCRIPT.minRatio) {
    add('warn', d.name, null, 'test-drift-lang',
      `\`tests:\` 의 언어가 산출물 언어(${SCRIPT.name})와 달라 겹침을 잴 수 없다 (${SCRIPT.name} ${Math.round((mine / (mine + other)) * 100)}%)`,
      `수용 기준은 프로필의 \`lang\` 으로 쓰고 테스트 이름은 코드의 언어로 쓰는 레포다. 낱말 겹침으로는 표류를 못 잡으니 \`covers\` 의 기준과 \`tests:\` 가 같은 것을 가리키는지 사람이 본다.`)
    continue
  }

  for (const w of wps) {
    const tests = w.fields.get('tests')
    if (!tests) continue
    const covered = idsIn(w.fields.get('covers') ?? '')
      .flatMap((id) => id.startsWith('AC-') ? [specAcs.get(id)] : [...specAcs.values()].filter((a) => a?.parent === id))
      .filter(Boolean)
    if (!covered.length) continue
    const t = tokens(tests)
    if (!t.size) continue
    const best = Math.max(...covered.map((a) => {
      const c = tokens(a.title)
      return [...t].filter((x) => c.has(x)).length / t.size
    }))
    if (best >= 0.25) continue
    add('warn', d.name, w.line + 1, 'test-drift', `${w.id} 의 \`tests:\` 가 수용 기준과 겹치지 않는다`,
      `covers 의 수용 기준 문장이 곧 테스트 이름이다(겹침 ${(best * 100).toFixed(0)}%). 기준을 옮겨 적거나, 정말 다른 것을 검사한다면 그 기준을 spec 에 먼저 더한다.`)
  }
}

// 용어 표류 — 같은 이름을 문서마다 다르게 적는 것. 사람은 «비슷한 말» 로 읽고 넘어가지만 계약에서
// `user_id` 와 `userId` 는 다른 필드고, 구현 에이전트는 그중 하나를 고른다. 백틱 안의 식별자만 본다:
// 산문의 낱말은 굴절이 있어 기계가 같다고 못 하지만, 코드 스팬은 저자가 «이것은 정확한 이름이다» 라고
// 표시한 자리다. 표기가 갈리는 것만 잡는다 — 뜻이 같은 다른 이름은 이 도구가 볼 수 없고, 보는 척하면
// 안 본 것과 구분이 안 된다.
if (!TEMPLATE) {
  // Contract words are quoted in prose in whatever case the sentence wants (`Must` in a heading,
  // «must» in a hint) — they are not names. Taken from keywords.mjs so a value added there does not
  // become a drift candidate here. `--json` and `json` are an option and a word, not two spellings,
  // and the frontmatter is a record, not prose: its quoted values are not where a name is spelled.
  const key = (t) => t.toLowerCase().replace(/[_-]/g, '')
  const STOP = new Set([...PRIORITIES, ...TIERS, ...STATUSES, ...Object.values(RESULT).flat(), ...NO_DIVERGENCE,
    'true', 'false', 'null'].map(key))
  const seen = new Map()
  for (const d of Object.values(LINTED)) {
    const fmEnd = /^---\r?\n[\s\S]*?\r?\n---/.exec(d.text)?.[0].split('\n').length ?? 0
    d.lines.forEach((line, i) => {
      if (!d.live[i] || i < fmEnd) return
      for (const m of stripComments(line).matchAll(/`([^`\s]{3,60})`/g)) {
        const tok = m[1]
        if (/^-|[\/\\.:()[\]{}<>=,'"]/.test(tok) || idsIn(tok).length || !/[A-Za-z가-힣]/.test(tok)) continue
        const k = key(tok)
        if (STOP.has(k)) continue
        const forms = seen.get(k) ?? seen.set(k, new Map()).get(k)
        if (!forms.has(tok)) forms.set(tok, { doc: d.name, line: i + 1 })
      }
    })
  }
  for (const forms of seen.values()) {
    if (forms.size < 2) continue
    const [first, ...rest] = [...forms.entries()]
    for (const [tok, at] of rest) {
      add('warn', at.doc, at.line, 'term-drift', `«${tok}» 는 «${first[0]}» 의 다른 표기다 (${first[1].doc}:${first[1].line})`,
        '같은 이름은 한 표기로 쓴다. 인터페이스 필드라면 spec 의 표기가 정본이고, 정말 다른 것이면 이름을 갈라 헷갈리지 않게 한다.')
    }
  }
}

process.exit(report({
    json: argv.includes('--json'),
  title: TEMPLATE ? '' : `산문 린트 — ${basename(DIR)}  (문서 ${Object.keys(LINTED).length}개)`,
  notes, problems, strict: STRICT, ruleDoc: '`conventions.md` 의 «산출물 문법» 절과 `references/prose.md` 에 있다.',
}))
