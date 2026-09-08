#!/usr/bin/env node
/** 산문 규율 린터 — 검사기가 못 보는 자리.
 *
 *  `check-artifacts.mjs` 는 **구조**를 본다 — ID 가 맞물리는가, 추적이 끊겼는가.
 *  구조가 완벽하면서 읽을 수 없는 문서를 쓰는 것은 얼마든지 가능하다. 이 사슬을 표에서
 *  산문으로 옮긴 이유 자체가 «읽히는 것» 이었으므로, 그 규율에도 결정론적 층이 필요하다.
 *
 *  ## 표 자체는 죄가 없다 — **항목을 행으로 만드는 것**이 죄다
 *
 *  이 사슬을 산문으로 옮긴 이유는 셋이다. 발안자(엔지니어가 아닌 사람)가 양식 앞에서
 *  물러나는 것, 셀이 짧아 «왜» 가 빠지는 것, 세션마다 읽히는 글의 비용.
 *
 *  **셋 다 겨냥하는 것은 하나다 — 항목 목록을 표의 행으로 만드는 것.** 거기서만 «양식
 *  채우기» 가 된다. 반대로 진짜 2차원 자료(대안 비교 · 상태 전이 · 지표의 현재값과 목표)는
 *  표가 가장 정확한 형태이고, 그것까지 막으면 규칙이 스스로를 못 지킨다 — 이 규약을 적은
 *  `conventions.md` 자신이 표로 되어 있다.
 *
 *  그래서 잡는 것은 **첫 칸에 우리 ID 가 선 표**다. 그것이 곧 «`### FR-001 — 제목` 으로
 *  섰어야 할 항목을 행으로 접었다» 는 뜻이다. 넓은 표(5열 이상)는 `intent`·`spec` 에서만
 *  경고한다 — 그 둘의 독자에 엔지니어가 아닌 사람이 있다.
 *
 *  ## 모호한 말은 요구사항에서만 잡는다
 *
 *  «빠르게» 는 문제를 서술할 때는 정직한 말이다 — 사람이 실제로 그렇게 느낀다. 그것이
 *  결함이 되는 자리는 **결과·요구사항·수용 기준**뿐이다. 거기서는 참·거짓을 가릴 수
 *  없게 만들기 때문이다. 그래서 이 검사는 엔티티 안에서만 돌고, 같은 줄에 수치가 있으면
 *  이미 한정된 것으로 보고 넘어간다.
 *
 *  ## 템플릿에는 안 돈다
 *
 *  템플릿은 주석과 placeholder 가 있는 것이 정상이다. 인스턴스화된 문서에만 돈다 —
 *  거기 주석이 남아 있으면 «템플릿 지시문이 산출물에 실려 나간» 것이다.
 *
 *    node lint-prose.mjs <스펙 폴더> [--strict]
 */
import { existsSync, statSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import {
  loadDir, isTemplate, idsIn, stripComments, report, P_ALT, SDLC_VERSION, ADR_FILENAME, loadAdrDir,
  SUPPORTED_SCHEMA_VERSIONS, schemaVersion,
} from './artifact-parse.mjs'

const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  console.log(`sdlc-runtime ${SDLC_VERSION}; schemas ${SUPPORTED_SCHEMA_VERSIONS.join(',')}`)
  process.exit(0)
}
const STRICT = argv.includes('--strict')
const DIR = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')

/** 측정 가능한 기준으로 바꿔야 하는 말. 같은 줄에 수치가 있으면 이미 한정된 것으로 본다. */
const VAGUE = ['빠르게', '빠른', '신속', '적절히', '적절한', '적당히', '쉽게', '편하게',
  '간편하', '사용하기 쉬', '최적화', '개선한다', '개선된다', '향상', '안정적', '효율적',
  '유연하', '확장 가능', '충분히', '대부분', '종종', '가능한 한', '되도록', '원활',
  '매끄럽', '직관적', '깔끔', '잘 동작', '문제없', '등등']
/** 이 접두의 본문에서만 모호한 말을 잡는다 — 문제 서술에서 «빠르게» 는 정직한 말이다. */
const MEASURED = /^(OUT|FR|NFR|AC)-/
const MAX_SENTENCES = 4
const MAX_TITLE = 40
const MAX_FIELD = 200

/** 번역체 — 한국어로 생각해 쓴 글에는 잘 안 나오는 모양들. 값이 아니라 **읽는 속도**의
 *  문제다: 이중 피동과 «~에 의해» 는 누가 하는 일인지를 한 겹 뒤로 숨긴다. */
const TRANSLATIONESE = [
  ['되어지', '이중 피동이다. «되다» 하나면 된다'],
  ['지게 된다', '이중 피동이다. «된다» 로 충분하다'],
  ['에 있어서', '«~에서» 나 «~할 때»'],
  ['에 의해', '누가 하는지를 주어로 세운다 — «A 에 의해 처리된다» → «A 가 처리한다»'],
  ['에 의하여', '누가 하는지를 주어로 세운다'],
  ['필요로 한다', '«~이 필요하다»'],
  ['을 가진다', '«~이 있다»'],
  ['를 가진다', '«~이 있다»'],
  ['을 갖는다', '«~이 있다»'],
  ['를 갖는다', '«~이 있다»'],
  ['제공한다', '«~한다» 로 바로 쓴다 — «검색 기능을 제공한다» → «검색한다»'],
  ['수행한다', '«~한다» 로 바로 쓴다'],
  ['라고 할 수 있다', '«~이다»'],
  ['가능하게 한다', '«~할 수 있다»'],
  ['로 하여금', '주어를 바꿔 쓴다'],
]
/** 문서가 내용 대신 **자기 자신**을 말하는 자리. 읽는 사람이 할 일이 없는 글자다. */
const META = [
  [/이 문서(는|에서는)[^.\n]{0,40}(설명|기술|정의|다룬다|살펴|소개)/, '문서가 자기를 설명한다. 내용을 바로 쓴다'],
  [/본 문서/, '«이 문서» 도 대개 필요 없다'],
  [/(아래에서는|위에서 설명|앞서 언급|앞에서 살펴|다음 절|이 절에서는|이 장에서는)/, '차례를 서술하지 않는다 — 제목이 이미 그 일을 한다'],
  [/참고로,/, '본문이면 그냥 쓰고, 아니면 뺀다'],
]

/** 섹션별 글자 한도(공백 제외). **`intent.md` 가 가장 좁다** — 그 문서의 독자는 발안자와
 *  제품 책임자이고, 길어지는 순간 «읽고 판단하는 문서» 에서 «훑고 넘기는 문서» 가 된다.
 *
 *  숫자는 지어낸 것이 아니라 `light` 예제를 재서 뽑았다:
 *  intent 437 · spec 727 · plan 1240 · finding 871, 섹션 최대 159~476, 엔티티 최대 187.
 *  경고선은 그 3배 남짓이고 **두 배를 넘으면 오류**다. 티어가 오르면 함께 늘어난다 —
 *  full 은 규제 대상이라 실제로 쓸 말이 많다. */
const BUDGET = {
  intent: { doc: 1200, section: 500, entity: 250 },
  spec: { doc: 2000, section: 800, entity: 400 },
  plan: { doc: 3000, section: 1200, entity: 350 },
  finding: { doc: 2000, section: 600, entity: 250 },
  /** ADR 은 티어가 없다 — 사슬 밖 문서라 이번 변경의 크기를 물려받지 않는다. 그래서 아래
   *  `mult` 가 1 로 고정되고, 이 수가 그대로 한도다. 「분량은 결정의 무게에 맞춘다」 지만
   *  한 결정이 이보다 길어지면 대개 분량 문제가 아니라 **한 문서에 결정이 둘**인 것이다. */
  adr: { doc: 2600, section: 900, entity: 400 },
}
/** 이 사슬의 문체 규칙은 **한국어에 맞춰 잰 것**이다 — 번역체·메타·모호어 목록도, 위 글자
 *  한도도. 영문 산출물에 그대로 걸면 목록 셋이 **하나도 안 걸리고** 길이만 한국어 숫자로
 *  재진다. 안 걸리는 것은 통과와 구분되지 않으므로, 지원하지 않는다는 사실을 조용히 두지
 *  않고 말한다.
 *
 *  임계값은 실측이다: 이 레포의 한국어 산출물 42개가 한글 비율 0.52~0.97, 중앙 0.92 였다.
 *  0.3 은 그 아래 어디에도 닿지 않고 영문 문서는 0 에 가깝다. **짧은 문서는 판정하지
 *  않는다** — 200자도 안 되면 비율이 흔들려 오판이 나고, 오판한 경고는 사람이 린터를 끄게
 *  만든다. */
const KO_MIN_RATIO = 0.3
const LANG_MIN_CHARS = 200

const TIER_MULT = { light: 1, standard: 1.6, full: 2.4 }
const MAX_AC = 100

const problems = []
const add = (level, doc, line, rule, msg, hint) => problems.push({ level, doc, line, rule, msg, hint })
const notes = []

/** 입력이 ADR 파일 하나이거나 ADR 이 든 폴더면 그쪽을 읽는다. **사슬의 네 이름만 보면
 *  결정 기록이 문체 검사를 통째로 안 받는다.** 문서 모양이 같으므로 아래 검사는 다 돈다. */
const docs = (() => {
  const isDir = existsSync(DIR) && statSync(DIR).isDirectory()
  const adrDir = isDir ? DIR : dirname(DIR)
  const one = isDir ? null : basename(DIR)
  if (one && !ADR_FILENAME.test(one)) return loadDir(DIR)
  const found = loadAdrDir(adrDir).docs.filter((d) => !one || d.name === one)
  if (found.length) return Object.fromEntries(found.map((d) => [d.name, d]))
  return isDir ? loadDir(DIR) : {}
})()
if (Object.keys(docs).length === 0) {
  console.error(`산출물이 없다 — ${DIR} 에 intent.md / spec.md / plan.md / finding.md / ADR-*.md 가 하나도 없다.`)
  process.exit(1)
}
// ADR 만 있는 폴더에서는 사슬의 넷이 다 없다. 거기서 undefined 를 읽어 v1 로 적으면 사람이
// 그걸 「이 결정이 구버전인가」 로 읽는다 — ADR 은 언제나 현재 스키마다.
const schema = schemaVersion((docs.intent ?? docs.finding ?? docs.spec ?? docs.plan ?? Object.values(docs)[0])?.fm)
if (schema != null) notes.push(`산출물 schema v${schema}${schema === 1 ? ' (무버전 문서 호환)' : ''} · runtime ${SDLC_VERSION}`)
if (isTemplate(docs)) {
  console.log(`\n산문 린트 — ${basename(DIR)}\n  · 템플릿 원본이다 — 주석과 placeholder 가 있는 것이 정상이라 «항목을 행으로 접었나» 검사만 돈다.`)
}
const TEMPLATE = isTemplate(docs)

const tokens = (s) => new Set(String(s).toLowerCase().match(/[가-힣a-z0-9]{2,}/g) ?? [])
const sentences = (s) => (stripComments(s).match(/[^.!?\n]*(?:다\.|[.!?])/g) ?? []).filter((x) => x.trim().length > 4).length

const ADR_ONLY = Object.values(docs).every((d) => d.kind === 'adr')
const TIER = docs.intent?.fm?.tier ?? docs.finding?.fm?.tier ?? (ADR_ONLY ? '—' : 'standard')
const mult = ADR_ONLY ? 1 : (TIER_MULT[TIER] ?? 1.6)
const chars = (s) => stripComments(String(s)).replace(/\s+/g, '').length

for (const d of Object.values(docs)) {
  // ── 한국어 문서인가. 아니면 아래 검사 대부분이 **말없이 지나간다**.
  if (!TEMPLATE) {
    const prose = stripComments(
      d.lines.filter((_, i) => d.live[i]).join('\n').replace(/^---[\s\S]*?---/, ''),
    ).replace(/`[^`]*`/g, '')
    const ko = (prose.match(/[가-힣]/g) ?? []).length
    const la = (prose.match(/[A-Za-z]/g) ?? []).length
    if (ko + la >= LANG_MIN_CHARS && ko / (ko + la) < KO_MIN_RATIO) {
      add('warn', d.name, 1, 'lang-unsupported',
        `한국어 문서가 아니다 (한글 ${Math.round((ko / (ko + la)) * 100)}%)`,
        '문체 검사(번역체·메타·모호어)는 한국어 목록이라 이 문서에서는 하나도 걸리지 않고, 글자 한도도 한국어 기준이라 영문에는 좁다. 지금 이 사슬이 지원하는 산출물 언어는 한국어다 — 길이 경고는 참고로만 읽는다.')
    }
  }

  // ── 항목을 표의 행으로 접었나. 표 자체가 아니라 **이것**이 규칙이다.
  d.lines.forEach((line, i) => {
    if (!d.live[i]) return
    if (!/^\s*\|/.test(line)) return
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(d.lines[i + 1] ?? '')) return
    const cols = line.trim().replace(/^\||\|$/g, '').split('|').length
    // 표의 어느 행이든 첫 칸이 우리 ID 면 «헤딩으로 섰어야 할 항목» 을 행으로 접은 것이다.
    let rowIds = 0
    for (let j = i + 2; j < d.lines.length && /^\s*\|/.test(d.lines[j]); j++) {
      const first = (d.lines[j].trim().replace(/^\||\|$/g, '').split('|')[0] ?? '').replace(/`/g, '').trim()
      if (new RegExp(`^(${P_ALT})-\\d{1,4}$`).test(first)) rowIds++
    }
    if (rowIds > 0) {
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

  // ── 번역체와 메타. 값이 아니라 읽는 속도의 문제라 전부 경고다.
  d.lines.forEach((line, i) => {
    if (!d.live[i] || /^\s*(?:[-*]\s+)?[A-Za-z가-힣_][A-Za-z가-힣_ ]{0,19}:\s/.test(line)) return
    const clean = stripComments(line)
    for (const [w, fix] of TRANSLATIONESE) {
      if (!clean.includes(w)) continue
      add('warn', d.name, i + 1, 'translationese', `번역체 — «${w}»`, fix)
    }
    for (const [re, fix] of META) {
      if (!re.test(clean)) continue
      add('warn', d.name, i + 1, 'meta', '문서가 내용 대신 자기 자신을 말한다', fix)
    }
  })

  // ── 템플릿 주석이 산출물에 실려 나갔다.
  d.lines.forEach((line, i) => {
    if (!/<!--/.test(line)) return
    add('error', d.name, i + 1, 'comment', '템플릿 주석이 남아 있다',
      '인스턴스화하면 주석은 지운다. 남으면 산출물이 «작성 지시문» 을 함께 배포하게 되고, 읽는 사람은 어느 쪽이 내용인지 판단해야 한다.')
  })

  for (const e of d.ents.values()) {
    // ── 제목은 라벨이지 문장이 아니다. AC 는 제목이 곧 기준이라 길이는 아래 한 곳에서만
    //    말한다 — 한 사실을 두 규칙이 말하면 사람이 고칠 자리를 두 번 찾는다.
    if (e.kind !== 'ac' && e.title.length > MAX_TITLE) {
      add('warn', d.name, e.line + 1, 'long-title', `${e.id} 의 제목이 ${e.title.length}자다`,
        `제목은 목록에서 훑어보는 라벨이다. ${MAX_TITLE}자 안으로 줄이고 자세한 것은 본문에 쓴다.`)
    }
    // ── 필드는 한 줄.
    for (const [k, v] of e.fields) {
      if (v.length <= MAX_FIELD) continue
      add('warn', d.name, e.line + 1, 'long-field', `${e.id} 의 \`${k}:\` 가 ${v.length}자다`,
        '필드는 한 줄이다. 문단이 필요하면 본문으로 내린다.')
    }
    // ── 한 항목은 한 단락.
    const prose = e.bodyLines.filter((l) => !/^\s*(?:[-*]\s+)?[A-Za-z가-힣_][A-Za-z가-힣_ ]{0,19}:\s/.test(l) && !/^\s*[-*]\s+\[[ xX]\]/.test(l))
    const n = sentences(prose.join(' '))
    if (n > MAX_SENTENCES) {
      add('warn', d.name, e.line + 1, 'long-item', `${e.id} 의 본문이 ${n}문장이다`,
        `한 항목은 한 단락이다. ${MAX_SENTENCES}문장을 넘으면 두 항목으로 갈라야 한다는 신호다.`)
    }
    // ── 모호한 말 — 재는 자리에서만.
    if (MEASURED.test(e.id)) {
      const hay = e.kind === 'ac' ? [e.title] : [e.title, ...prose]
      for (const line of hay) {
        if (/\d/.test(line)) continue // 수치가 함께 있으면 이미 한정됐다
        const hit = VAGUE.find((w) => line.includes(w))
        if (!hit) continue
        add(e.kind === 'ac' ? 'error' : 'warn', d.name, e.line + 1, 'vague', `${e.id} 에 «${hit}» — 측정 기준이 아니다`,
          e.kind === 'ac' ? '수용 기준은 참·거짓이 갈려야 한다. 수치·백분위·조건으로 바꾼다.'
            : '재는 자리다. «얼마나»를 수치나 조건으로 적는다.')
      }
    }
    // ── 항목 하나의 길이. 넘치면 읽는 사람이 «훑고 넘기는» 쪽으로 넘어간다.
    const cap = e.kind === 'ac' ? MAX_AC : Math.round((BUDGET[d.kind]?.entity ?? 400) * mult)
    const size = e.kind === 'ac' ? e.title.length : chars(prose.join('') + e.title)
    if (size > cap) {
      add(size > cap * 2 ? 'error' : 'warn', d.name, e.line + 1, 'too-long',
        `${e.id} 이 ${size}자다 (한도 ${cap})`,
        e.kind === 'ac' ? '수용 기준은 한 문장이다. 길어지면 기준이 둘 이상 섞인 것이다.'
          : '한 항목이 길어지면 그것은 대개 두 항목이다. 갈라 쓰거나 아래 층(spec·plan)으로 내린다.')
    }
    // ── 수용 기준은 서술문으로 끝난다.
    if (e.kind === 'ac' && !/(다|다\.)$/.test(e.title.trim())) {
      add('warn', d.name, e.line + 1, 'untestable-ac', `${e.id} 이 서술문으로 끝나지 않는다`,
        '«<언제>이면 시스템은 <무엇을> 한다» 꼴로 쓴다. 명사로 끝나면 그건 기준이 아니라 항목 이름이다.')
    }
  }

  // ── 섹션과 문서의 길이. **`intent.md` 가 가장 좁다** — 그 문서가 길어지면 발안자와
  //    제품 책임자가 읽지 않고, 그러면 이 사슬의 첫 칸이 비는 것과 같다.
  const budget = BUDGET[d.kind]
  if (budget) {
    for (const h of d.hs.filter((x) => x.depth === 2)) {
      const cap = Math.round(budget.section * mult)
      const n = chars(d.lines.slice(h.line + 1, h.allEnd).filter((_, k) => d.live[h.line + 1 + k]).join(''))
      if (n <= cap) continue
      add(n > cap * 2 ? 'error' : 'warn', d.name, h.line + 1, 'too-long',
        `«${h.title}» 이 ${n}자다 (한도 ${cap})`,
        '이 섹션이 담을 것보다 많이 담았다. 항목으로 갈라 쓰거나 아래 층으로 내린다.')
    }
    const capDoc = Math.round(budget.doc * mult)
    const total = chars(d.lines.filter((_, i) => d.live[i]).join('').replace(/^---[\s\S]*?---/, ''))
    if (total > capDoc) {
      add(total > capDoc * 2 ? 'error' : 'warn', d.name, null, 'too-long',
        `${d.name} 이 ${total}자다 (${TIER} 한도 ${capDoc})`,
        d.kind === 'intent'
          ? '이 문서의 독자는 발안자와 제품 책임자다. 길어지면 «읽고 판단하는 문서» 가 «훑고 넘기는 문서» 가 된다 — 세부는 spec 으로 내린다.'
          : '티어를 올려야 하는 변경인지, 아니면 한 문서에 두 변경을 담았는지 본다.')
    }
  }

  // ── 작업의 `tests:` 는 수용 기준 문장을 옮긴 것이다.
  if (d.kind !== 'plan') continue
  const specAcs = new Map([...(docs.spec?.ents ?? new Map())].filter(([id]) => id.startsWith('AC-')))
  for (const w of [...d.ents.values()].filter((e) => e.kind === 'wp')) {
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

process.exit(report({
  title: TEMPLATE ? '' : `산문 린트 — ${basename(DIR)}  (문서 ${Object.keys(docs).length}개)`,
  notes, problems, strict: STRICT, ruleDoc: '`conventions.md` 의 «산출물 문법» 절과 `references/prose.md` 에 있다.',
}))
