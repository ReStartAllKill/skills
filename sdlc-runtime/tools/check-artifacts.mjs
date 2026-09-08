#!/usr/bin/env node
/** 산출물 사슬 검사 — 규약을 사람의 기억에서 기계로 옮긴다.
 *
 *  `/create-*` 가 만든 intent · spec · plan · finding 을 읽고, 문서가 서로 맞물리는지 본다.
 *  **권고는 위반을 드물게 만들 뿐이고, 반드시 지켜져야 하는 것에는 결정론적 장치가
 *  뒤에 있어야 한다.** 스킬 본문의 «추적성 검사» 는 모델이 자기 글을 읽고 하는 판정이라
 *  advisory 다. 여기가 그 뒤에 서는 층이다.
 *
 *  ## 산문에서 ID 를 어떻게 읽나
 *
 *  표가 아니라 **헤딩**이 정의다 — `### FR-001 — 제목 `Must``. 그 밑의
 *  `키: 값` 줄이 필드이고, 수용 기준은 `- [ ] AC-001 — …` 체크박스, 작업은
 *  `- [ ] **WP-001 — …**` 와 다섯 줄이다.
 *
 *  이 모양을 고른 이유는 사람이 읽는 글이 그대로 기계가 읽는 구조이기 때문이다. 표는
 *  기계에겐 편하지만 사람에게는 양식이고, 양식은 안 쓰인다. 정의가 헤딩에만 있으므로
 *  «참조인지 정의인지» 하는 모호함도 없다.
 *
 *  ## 결측을 합치지 않는다
 *
 *  «섹션이 없다» · «비었다» · «placeholder 만 남았다» · «해당 없음이라 적었다» 는 서로
 *  다른 사실이고 서로 다른 문장으로 선다. 마지막 것은 근거를 요구한다 — 근거 없는
 *  `해당 없음` 은 «정말 없다» 와 «귀찮아서» 를 같은 글자로 만든다.
 *
 *  ## 오류와 경고
 *
 *  오류는 사슬이 깨진 것(참조가 허공을 가리킨다, 하위가 상위를 앞선다, 같은 레벨의
 *  작업이 같은 파일을 만진다), 경고는 사람이 판단할 것이다. CI 는 `--strict`.
 *
 *    node check-artifacts.mjs <스펙 폴더> [--strict]
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { resolve, basename, dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  PREFIXES, FILES, WP_FIELDS, P_ALT, idsIn, stripComments, isNull, frontmatter,
  loadDir, isTemplate, report, SDLC_VERSION,
  SUPPORTED_SCHEMA_VERSIONS, schemaVersion,
 levelsOf, wpFiles, ADR_FILENAME, loadAdrDir, CHAIN_FILES } from './artifact-parse.mjs'
import { adrSeam, checkAdr, checkPins } from './adr-check.mjs'
import { loadBands, revisedBy } from './bands.mjs'
import { loadPolicy, routeActive, STAGES } from './autonomy.mjs'

const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  console.log(`sdlc-runtime ${SDLC_VERSION}; schemas ${SUPPORTED_SCHEMA_VERSIONS.join(',')}`)
  process.exit(0)
}
const supportAt = argv.indexOf('--supports-schema')
if (supportAt >= 0) {
  const requested = Number(argv[supportAt + 1])
  process.exit(SUPPORTED_SCHEMA_VERSIONS.includes(requested) ? 0 : 2)
}
const STRICT = argv.includes('--strict')
const DIR = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')

/** 우리 ID 가 아닌 «대문자-숫자» — 표준 약어와 문서 자신의 id 접두다. */
const NOT_OURS = new Set(['UTF', 'ISO', 'RFC', 'SHA', 'AES', 'TLS', 'SLA', 'RTO', 'RPO', 'WCAG',
  'HTTP', 'HTTPS', 'ADR', 'DORA', 'MDM', 'MCP', 'ACP', 'PII', 'API', 'SDK', 'CHG', 'SPEC',
  'PLAN', 'FND', 'JSON', 'YAML', 'CSV', 'SQL', 'AWS', 'GCP', 'CPU', 'RAM'])

const TIERS = ['light', 'standard', 'full']
const STATUS = {
  intent: ['draft', 'in_review', 'accepted', 'rejected', 'superseded'],
  spec: ['draft', 'in_review', 'accepted', 'rejected', 'superseded'],
  plan: ['draft', 'in_review', 'accepted', 'in_progress', 'completed', 'rejected', 'superseded'],
  // finding 은 같은 낱말을 쓰되 뜻이 다르다 — in_review = 분류 중, accepted = 경로 확정,
  // rejected = 기각. 상태 어휘를 두 벌로 만들지 않기 위해서다.
  finding: ['draft', 'in_review', 'accepted', 'rejected', 'superseded'],
}
const RANK = { draft: 0, in_review: 1, accepted: 2, in_progress: 3, completed: 4, rejected: -1, superseded: -2 }
const BASE_FM = ['artifact', 'id', 'title', 'status', 'tier', 'owner', 'created', 'updated']
const REQUIRED_FM = {
  intent: BASE_FM,
  spec: [...BASE_FM, 'intent', 'intent_version'],
  plan: [...BASE_FM, 'intent', 'spec', 'spec_version'],
  finding: [...BASE_FM, 'detected_at', 'trigger', 'autonomy_tier'],
}
const TRIGGERS = ['band_breach', 'scheduled_scan', 'ticket', 'channel', 'manual']
const AUTONOMY = ['log', 'diagnose', 'propose']

const problems = []
const err = (doc, msg, hint) => problems.push({ level: 'error', doc, msg, hint })
const warn = (doc, msg, hint) => problems.push({ level: 'warn', doc, msg, hint })
const notes = []

/** 레포 뿌리 — 프로필이 있는 가장 가까운 조상. 아래 여러 검사가 각자 찾던 것을 한 번만 찾는다. */
const REPO_ROOT = (() => {
  for (let d = DIR, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
    if (existsSync(resolve(d, '.claude/spec-profile.yml'))) return d
  }
  return null
})()
const SEAM = { ...adrSeam(REPO_ROOT), root: REPO_ROOT }

// ─────────────────────────────────────────── 0. 결정 기록 모드
// 입력이 ADR 파일 하나이거나 `adr_dir` 이면 사슬 검사를 돌리지 않는다. ADR 은 폴더가 아니라
// 파일 단위고 상위 문서가 없어서, 사슬의 추적성·버전 고정 검사가 통째로 헛돈다.

const ADR_TARGETS = (() => {
  const isDir = existsSync(DIR) && statSync(DIR).isDirectory()
  if (!isDir) return ADR_FILENAME.test(basename(DIR)) ? { dir: dirname(DIR), only: basename(DIR) } : null
  // **사슬 문서가 있으면 언제나 사슬 모드다.** `adr_dir` 이 `spec_dir` 과 겹치게 설정된
  // 레포에서 ADR 모드가 이기면 그 폴더의 intent·spec·plan 검사가 통째로 안 돈다 — 아무도
  // 안 보는 자리가 조용히 생기는, 이 하네스가 가장 경계하는 모양이다.
  if (Object.values(CHAIN_FILES).some((f) => existsSync(join(DIR, f)))) return null
  const looksAdr = SEAM.dir === DIR || readdirSync(DIR).some((f) => ADR_FILENAME.test(f))
  return looksAdr ? { dir: DIR, only: null } : null
})()

if (ADR_TARGETS) {
  const { docs: all, malformed } = loadAdrDir(ADR_TARGETS.dir, (d, dup, first) =>
    err(d.name, `${dup.id} 이 두 번 정의됐다`, `먼저: ${d.name}:${first.line + 1}`))
  for (const name of malformed) {
    err(name, '파일 이름이 ADR 규칙과 다르다', 'ADR-{세 자리}-{kebab-slug}.md 다. 이름이 번호를 물지 않으면 번호가 한 문서를 가리키지 못한다.')
  }
  const targets = ADR_TARGETS.only ? all.filter((d) => d.name === ADR_TARGETS.only) : all
  if (!targets.length && !malformed.length) {
    console.error(`결정 기록이 없다 — ${DIR}`)
    process.exit(1)
  }
  for (const d of targets) {
    // `info` 는 오류도 경고도 아니지만 **보이긴 해야 한다** — report 가 error·warn 만 내므로
    // 노트로 돌린다. 어느 문서가 옛 계약인지 안 보이면 아무도 이관하지 않는다.
    checkAdr(d, { seam: SEAM, siblings: all }, (level, msg, hint) =>
      level === 'info' ? notes.push(`${d.name} — ${msg}`) : problems.push({ level, doc: d.name, msg, hint }))
  }
  if (!SEAM.configured) notes.push('프로필에 `adr_dir` 이 없다 — 등재하면 사슬의 `decisions:` 핀 검사가 함께 돈다')
  process.exit(report({
    title: `결정 기록 검사 — ${targets.length}장${malformed.length ? ` (이름 규칙 위반 ${malformed.length}개)` : ''}`,
    notes, problems, strict: STRICT, ruleDoc: '`references/adr.md` 에 있다.',
  }))
}

// ─────────────────────────────────────────────────────────── 문서 읽기

const docs = loadDir(DIR, (d, dup, first) =>
  err(d.name, `${dup.id} 이 두 번 정의됐다`, `먼저: ${d.name}:${first.line + 1}`))
const TEMPLATE = isTemplate(docs)

if (Object.keys(docs).length === 0) {
  console.error(`산출물이 없다 — ${DIR} 에 intent.md / spec.md / plan.md / finding.md 가 하나도 없다.`)
  process.exit(1)
}
// finding.md 하나만 있는 폴더는 정상이다 — 한 장의 PR 로 끝났거나 기각된 발견이다.
if (!TEMPLATE && !docs.intent && (docs.spec || docs.plan)) {
  err('(폴더)', 'intent.md 가 없다', '사슬은 의도에서 시작한다. spec·plan 만으로는 «왜»가 어디에도 없다.')
}

/** 템플릿 원본인가. 채우기 전이면 내용·상태·버전 검사를 건너뛴다 — 안 그러면 템플릿이
 *  늘 실패한다. **구조와 ID 그래프는 그대로 본다**: 템플릿이 스스로 검증되는 것이 요점이다. */
if (TEMPLATE) notes.push('템플릿 원본으로 판정했다(id 가 아직 `…-YYYY-NNN`) — 내용·상태·버전·층 검사는 건너뛰고 구조와 ID 그래프만 본다.')

const ALL = new Map()
for (const d of Object.values(docs)) for (const [id, e] of d.ents) if (!ALL.has(id)) ALL.set(id, { ...e, doc: d })
const ent = (id) => ALL.get(id)
const of = (kind, prefix) => [...(docs[kind]?.ents.values() ?? [])].filter((e) => e.id.startsWith(prefix + '-'))
const isMust = (e) => /^must$/i.test(e.priority ?? '')
const field = (e, ...names) => { for (const n of names) if (e.fields.has(n)) return e.fields.get(n); return '' }

// ─────────────────────────────────────────────────────────── 1. 프런트매터

for (const d of Object.values(docs)) {
  const schema = schemaVersion(d.fm)
  if (schema == null) {
    err(d.name, `\`schema_version: ${d.fm.schema_version}\` 을 읽을 수 없다`, '정수를 쓴다. 무버전 문서는 v1 로 읽힌다.')
  } else if (!SUPPORTED_SCHEMA_VERSIONS.includes(schema)) {
    err(d.name, `지원하지 않는 schema_version \`${schema}\``, `이 런타임(${SDLC_VERSION})이 읽는 버전: ${SUPPORTED_SCHEMA_VERSIONS.join(' · ')}`)
  }
  for (const k of REQUIRED_FM[d.kind]) if (isNull(d.fm[k])) err(d.name, `프런트매터에 \`${k}\` 가 없다`, `${d.kind} 에 필수인 키다.`)
  if (d.fm.artifact !== d.kind) err(d.name, `\`artifact: ${d.fm.artifact}\` — 파일 이름과 다르다`, `\`${d.kind}\` 여야 한다.`)
  if (d.fm.status && !STATUS[d.kind].includes(d.fm.status)) err(d.name, `허용되지 않는 status \`${d.fm.status}\``, `쓸 수 있는 값: ${STATUS[d.kind].join(' · ')}`)
  if (d.fm.tier && !TIERS.includes(d.fm.tier)) err(d.name, `허용되지 않는 tier \`${d.fm.tier}\``, `${TIERS.join(' · ')} 중 하나여야 한다.`)
  if (d.fm.status === 'superseded' && isNull(d.fm.superseded_by)) {
    err(d.name, '`superseded` 인데 `superseded_by` 가 비었다', '적지 않으면 사슬을 과거로만 거슬러 갈 수 있고 «지금 무엇이 되었나» 에 답할 수 없다.')
  }
}

// ──────────────────────────────── 1-e. 밴드 등록부 (finding 의 입력 쪽)

/** **탐지는 결정론으로 남아야 한다.** `trigger: band_breach` 는 «기계가 밴드를 깼다» 는
 *  말인데, 그 밴드가 어디에도 정의되어 있지 않으면 «무엇이 정상인가» 를 모델이 그때그때
 *  지어낸다. 그러면 §관측 과 §진단 을 갈라 놓은 이 문서의 척추가 한 층 위에서 무너진다 —
 *  **기계가 잰 것** 이라고 적힌 값의 기준선이 사실은 짐작이기 때문이다.
 *
 *  그리고 **기각이 루프를 닫게 한다.** 「밴드 조정」 이 문서 안의 산문이기만 하면 아무도
 *  그것을 읽지 않고, 기각한 신호가 다음 실행에서 새 발견으로 다시 선다 — 이 템플릿이
 *  스스로 경고한 그 일이다. 조정이 **등록부에 남아야** 기각이 끝난 것이다. */
if (docs.finding && !TEMPLATE) {
  const f = docs.finding
  /** 레포 뿌리는 **프로필이 있는 가장 가까운 조상**이다. git 에 묻지 않는 것은 산출물이
   *  늘 git 안에 있지는 않기 때문이다 — 평가 케이스가 그렇고, 아직 init 하지 않은 레포도
   *  그렇다. 프로필이 곧 «여기가 이 사슬의 뿌리다» 라는 표시라 그것을 찾는 편이 정확하다. */
  let repoRoot = null
  for (let d = DIR, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
    if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { repoRoot = d; break }
  }

  const profilePath = repoRoot ? resolve(repoRoot, '.claude/spec-profile.yml') : null
  const bandsKey = profilePath && existsSync(profilePath)
    ? (/^bands:[ \t]*(.*)$/m.exec(readFileSync(profilePath, 'utf8'))?.[1] ?? '')
        .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
    : ''
  const reg = repoRoot ? loadBands(repoRoot, bandsKey) : { missing: true, bands: {} }

  const band = isNull(f.fm.band) ? null : String(f.fm.band).trim()

  if (f.fm.trigger === 'band_breach') {
    if (!band) {
      err(f.name, '`trigger: band_breach` 인데 `band` 가 비었다',
        '어느 밴드가 깨졌는지 없으면 «무엇이 정상인가» 가 이 문서 밖에 없다. 등록부의 밴드 id 를 적는다.')
    } else if (reg.missing) {
      warn(f.name, `밴드 등록부가 없어 \`band: ${band}\` 를 대조하지 못했다`,
        '탐지가 결정론으로 남으려면 «무엇이 정상인가» 가 파일에 있어야 한다. `.claude/bands.yml` 을 만든다.')
    } else if (!reg.bands[band]) {
      err(f.name, `\`band: ${band}\` 이 등록부에 없다`,
        `등록부에 있는 밴드: ${Object.keys(reg.bands).join(' · ') || '(없음)'}. 오타이거나, 밴드를 먼저 등록부에 더해야 한다.`)
    } else if (f.fm.autonomy_tier && reg.bands[band].autonomy_tier &&
               f.fm.autonomy_tier !== reg.bands[band].autonomy_tier) {
      // 발화가 허용한 범위는 밴드가 정한다. 문서가 더 넓게 적으면 «경계가 작동했다» 는
      // 기록이 문서 자신의 주장일 뿐이 된다.
      err(f.name, `\`autonomy_tier: ${f.fm.autonomy_tier}\` 가 등록부의 \`${band}\`(\`${reg.bands[band].autonomy_tier}\`) 와 다르다`,
        '무엇을 해도 되는지는 밴드가 정한다. 넓혀야 하면 등록부를 먼저 고친다.')
    }
  }

  /** 기각의 닫힘. «조정 없음 — 근거» 라고 적었으면 그것으로 끝이고, 조정했다고 적었으면
   *  등록부가 그 사실을 말해야 한다. 둘 다 아니면 이 신호는 다음 실행에서 다시 선다. */
  if (f.fm.status === 'rejected') {
    const body = stripComments(f.lines.join('\n'))
    const noChange = /밴드\s*조정\s*:\s*«?\s*조정\s*없음\s*[—–-]\s*\S/.test(body)
    if (!noChange) {
      if (!band) {
        err(f.name, '기각인데 `band` 도 «조정 없음» 도 없다',
          '기각은 둘 중 하나로 닫힌다 — 밴드를 조정하거나, «조정 없음 — <근거>» 라고 적거나. 안 그러면 같은 신호가 다음 실행에서 새 발견으로 다시 선다.')
      } else if (reg.missing) {
        warn(f.name, '밴드 등록부가 없어 조정이 반영됐는지 대조하지 못했다',
          '기각이 루프를 닫으려면 조정이 등록부에 남아야 한다.')
      } else if (!revisedBy(reg, band, String(f.fm.id ?? '').trim())) {
        err(f.name, `기각인데 등록부의 \`${band}\` 에 이 발견(${f.fm.id})의 조정 기록이 없다`,
          `\`.claude/bands.yml\` 의 \`${band}\` 밑 \`revised:\` 에 \`- <날짜> ${f.fm.id} — <무엇을 어떻게>\` 를 더한다. 문서 안의 산문만으로는 다음 실행이 그것을 읽지 못한다.`)
      }
    }
  }
}

// ────────────────────────────────────── 1-c. 승인 분리 (schema v3+)

/** **쓴 것이 승인할 수 없다.** 이 사슬에서 승인은 오래 «문서를 쓴 그 에이전트가 프런트매터
 *  한 줄을 바꾸는 일» 이었고, 그러면 관문이 아니라 자기선언이다. 사람이 지키는 것은 판단이
 *  필요한 결정이므로, 그 결정만은 기계가 대신 적을 수 없어야 한다.
 *
 *  여기는 **뒤에 서는 층**이다. 앞에서는 PreToolUse 훅이 일반적인 자기승인을 막고, 여기서는
 *  그 결과(누가 승인했나)가 문서에 남았는지 본다. 훅은 개인 장비에 있어서 팀원에게 없을 수
 *  있고, 그래서 훅만으로는 관문이 못 된다 — 팀에 거는 관문은 CI 의 이 검사다.
 *
 *  `finding.md` 는 뺀다. 그쪽의 `accepted` 는 «승인» 이 아니라 «경로가 정해져 나갔다» 이고
 *  이미 `routed_to` 가 그 자리를 지킨다. */
const APPROVAL_SCHEMA = 3
if (!TEMPLATE) {
  for (const d of [docs.intent, docs.spec, docs.plan].filter(Boolean)) {
    const schema = schemaVersion(d.fm)
    if (schema == null || schema < APPROVAL_SCHEMA) continue
    if ((RANK[d.fm.status] ?? 0) < 2) continue
    if (isNull(d.fm.approved_by)) {
      err(d.name, `\`${d.fm.status}\` 인데 \`approved_by\` 가 비었다`,
        '승인은 사람이 하는 결정이다. 승인한 사람을 적지 않으면 이 상태는 «누가 받아들였나» 에 답하지 못하고, 그러면 관문이 아니라 자기선언이다.')
      continue
    }
    const by = String(d.fm.approved_by).trim()
    const gen = isNull(d.fm.generated_by) ? '' : String(d.fm.generated_by).trim()

    /** **정책 승인** — 자율 경로가 만든 문서는 사람 이름 대신 정책을 가리킨다
     *  (`policy:<경로 id>`). 승인이 사라진 것이 아니라 **문서 단위에서 정책 단위로
     *  올라간 것**이고, 정책은 커밋된 산출물이라 사람이 쓰고 사람이 다시 본다.
     *
     *  그 문자열을 검사하지 않으면 «policy:아무거나» 가 승인으로 통과한다. 그러면
     *  자기승인을 막으려고 만든 필드가 자기승인의 우회로가 된다 — 여기가 그것을 막는다. */
    if (by.startsWith('policy:')) {
      const routeId = by.slice('policy:'.length).trim()
      let repoRoot = null
      for (let p = DIR, prev = null; p !== prev; prev = p, p = resolve(p, '..')) {
        if (existsSync(resolve(p, '.claude/spec-profile.yml'))) { repoRoot = p; break }
      }
      const polKey = repoRoot && existsSync(resolve(repoRoot, '.claude/spec-profile.yml'))
        ? (/^autonomy:[ \t]*(.*)$/m.exec(readFileSync(resolve(repoRoot, '.claude/spec-profile.yml'), 'utf8'))?.[1] ?? '')
            .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
        : ''
      const pol = repoRoot ? loadPolicy(repoRoot, polKey) : { missing: true, routes: {} }
      const route = pol.routes?.[routeId]

      if (pol.missing) {
        err(d.name, `\`approved_by: ${by}\` 인데 자율 실행 정책이 없다`,
          '정책 승인은 커밋된 `.claude/autonomy.yml` 이 뒤를 받쳐야 성립한다. 없으면 이 승인은 아무도 가리키지 않는다.')
      } else if (!route) {
        err(d.name, `\`${by}\` 가 가리키는 자율 경로가 정책에 없다`,
          `정책에 있는 경로: ${Object.keys(pol.routes).join(' · ') || '(없음)'}. 오타이거나, 경로가 지워진 뒤 문서만 남았다.`)
      } else if (!routeActive(route)) {
        err(d.name, `\`${by}\` 의 자율 경로가 만료됐다 (${route.expires ?? '만료일 없음'})`,
          '만료된 위임으로 승인된 문서는 지금 아무도 책임지지 않는다. 정책을 다시 검토해 갱신하거나, 이 문서를 사람이 직접 승인한다.')
      } else if (d.fm.tier && TIERS.indexOf(String(d.fm.tier)) > TIERS.indexOf(String(route.max_tier))) {
        err(d.name, `\`tier: ${d.fm.tier}\` 가 자율 경로 \`${routeId}\` 의 \`max_tier: ${route.max_tier}\` 를 넘는다`,
          '위임한 것보다 위험한 변경이 그 위임으로 통과했다. 사람이 직접 승인하거나 정책을 먼저 넓힌다.')
      } else if (STAGES.indexOf(d.name.replace(/\.md$/, '')) > STAGES.indexOf(String(route.advance_to))) {
        /** **`advance_to` 는 사슬의 어디까지 맡겼는지다.** 그 뒤를 같은 위임으로 승인하면
         *  경계가 문서 안의 선언일 뿐이 된다 — `intent` 까지 맡긴 위임이 `plan` 을
         *  승인하는 자리가 실제로 열려 있었다. */
        err(d.name, `자율 경로 \`${routeId}\` 은 \`${route.advance_to}\` 까지 맡았는데 ${d.name} 를 승인했다`,
          `이 위임의 경계 밖이다. 사람이 직접 승인하거나, 정책의 \`advance_to\` 를 먼저 넓힌다 — 넓히는 것은 사람이 하는 결정이다.`)
      }
      continue
    }

    if (gen && by.toLowerCase() === gen.toLowerCase()) {
      err(d.name, `\`approved_by\` 가 \`generated_by\` 와 같다 (\`${by}\`)`,
        '쓴 것이 승인할 수 없다. 문서를 만든 주체와 그것을 받아들인 주체가 같으면 검토가 일어나지 않았다는 뜻이다.')
    }
  }
}

// ────────────────────────────────────── 1-d. 감사 추적 (경고)

/** «누가 썼나» 의 답이 사람 이름뿐이면 AI-native 사슬의 감사 추적은 절반이 빈 칸이다.
 *  사람이 손으로 쓴 문서는 비어 있는 것이 정상이라 **경고**다 — 판단은 사람이 한다.
 *  CI 는 `--strict` 로 돌아 이 경고도 실패로 센다. */
if (!TEMPLATE) {
  for (const d of Object.values(docs)) {
    if (!isNull(d.fm.generated_by)) continue
    warn(d.name, '`generated_by` 가 비었다',
      'Agent 가 썼으면 `generated_by` · `generated_from` · `skills_in_force` 를 채운다. 사람이 손으로 썼으면 그대로 두고 이 경고를 남긴다 — 그것도 기록이다.')
  }
}

/** intent · spec · plan 은 한 계약이므로 스키마 버전도 같아야 한다. finding 은 독립 입력이라
 *  다른 버전이어도 새 intent 를 낳을 수 있다. */
const chain = [docs.intent, docs.spec, docs.plan].filter(Boolean)
const chainSchema = chain.length ? schemaVersion(chain[0].fm) : null
for (const d of chain.slice(1)) {
  const schema = schemaVersion(d.fm)
  if (schema != null && chainSchema != null && schema !== chainSchema) {
    err(d.name, `schema_version 이 ${chain[0].name} 와 다르다 (\`${schema}\` != \`${chainSchema}\`)`,
      '한 사슬은 한 스키마 버전만 쓴다. 기존 사슬은 통째로 마이그레이션하거나 현재 버전을 유지한다.')
  }
}
const shownSchema = chainSchema ?? (docs.finding ? schemaVersion(docs.finding.fm) : null)
if (shownSchema != null) notes.push(`산출물 schema v${shownSchema}${shownSchema === 1 ? ' (무버전 문서 호환)' : ''} · runtime ${SDLC_VERSION}`)

/** 티어의 정본은 intent 다. finding 만 있는 폴더에서는 finding 이 진다 — 발견은 사슬의
 *  **입력**이지 하위 문서가 아니므로 상속하지 않는다. light 발견이 full intent 를 낳는
 *  것이 정상이다(작은 신호가 큰 문제를 가리킬 수 있다). */
const TIER = docs.intent?.fm?.tier ?? docs.finding?.fm?.tier ?? 'standard'
for (const d of [docs.spec, docs.plan].filter(Boolean)) {
  if (d.fm.tier && d.fm.tier !== TIER) {
    err(d.name, `tier 가 intent 와 다르다 (\`${d.fm.tier}\` != \`${TIER}\`)`, '무게는 의도 층에서 한 번 정하고 하위가 상속한다. 올려야 하면 intent 부터 올린다.')
  }
}
for (const [d, key] of [[docs.spec, 'intent'], [docs.plan, 'intent'], [docs.plan, 'spec']]) {
  if (TEMPLATE || !d || isNull(d.fm[key])) continue
  if (!existsSync(resolve(DIR, String(d.fm[key])))) err(d.name, `\`${key}: ${d.fm[key]}\` 가 가리키는 파일이 없다`, '상대 경로를 확인한다.')
}

// ─────────────────────────────────────────── 1-b. 발견의 발화와 경로

if (docs.finding) {
  const f = docs.finding
  if (f.fm.trigger && !TRIGGERS.includes(f.fm.trigger)) err(f.name, `허용되지 않는 trigger \`${f.fm.trigger}\``, `${TRIGGERS.join(' · ')} 중 하나여야 한다.`)
  if (f.fm.autonomy_tier && !AUTONOMY.includes(f.fm.autonomy_tier)) err(f.name, `허용되지 않는 autonomy_tier \`${f.fm.autonomy_tier}\``, `${AUTONOMY.join(' · ')} 중 하나여야 한다.`)
  const route = isNull(f.fm.routed_to) ? null : String(f.fm.routed_to)
  const kind = route ? route.split(':')[0].trim() : null
  if (route && !['patch', 'intent', 'dismiss'].includes(kind)) {
    err(f.name, `\`routed_to: ${route}\` 의 경로가 셋 중 하나가 아니다`, '`patch:<PR>` · `intent:<경로>` · `dismiss:<사유>` 뿐이다. 나가는 길이 셋이라는 것이 이 문서의 요점이다.')
  }
  if (f.fm.status === 'accepted' && !route) err(f.name, '`accepted`(경로 확정) 인데 `routed_to` 가 비었다', '어디로 나갔는지 없으면 이 발견은 닫힌 것이 아니라 잊힌 것이다.')
  if (f.fm.status === 'rejected' && kind !== 'dismiss') {
    err(f.name, `\`rejected\` 인데 \`routed_to\` 가 \`${kind ?? '비어 있다'}\``, '기각이면 `dismiss:<사유>` 여야 한다. 밴드를 조정하는지도 §경로 판정 에 적는다 — 안 그러면 같은 신호가 다음 실행에서 새 발견으로 다시 선다.')
  }
  if (kind === 'intent') {
    const t = route.slice(route.indexOf(':') + 1).trim()
    if (t && !existsSync(resolve(DIR, t))) err(f.name, `\`routed_to\` 가 가리키는 intent 가 없다: ${t}`, '경로를 고치거나, 아직 안 만들었으면 status 를 in_review 로 되돌린다.')
  }
}

/** 루프가 실제로 닫혔는지 — intent 가 «어느 발견에서 왔다» 고 말하면 그 발견도 «이
 *  intent 로 나갔다» 고 말해야 한다. 한쪽만 있으면 사슬이 한 방향으로만 이어진다. */
if (docs.intent && !isNull(docs.intent.fm.from_finding)) {
  const fp = resolve(DIR, String(docs.intent.fm.from_finding))
  if (!existsSync(fp)) err('intent.md', `\`from_finding: ${docs.intent.fm.from_finding}\` 가 가리키는 파일이 없다`, '상대 경로를 확인한다.')
  else {
    const up = frontmatter(readFileSync(fp, 'utf8')) ?? {}
    const r = isNull(up.routed_to) ? '' : String(up.routed_to)
    if (up.status === 'accepted' && !r.startsWith('intent')) {
      err('intent.md', `상위 발견(${basename(fp)}) 은 \`${r || '경로 없음'}\` 로 나갔다고 적혀 있다`, '이 intent 가 그 발견에서 왔다면 발견의 `routed_to` 도 `intent:<이 경로>` 여야 한다.')
    } else if (r.startsWith('intent')) {
      // 경로 종류만 맞는 것으로는 부족하다 — **같은 파일**을 가리켜야 한다. 안 그러면
      // 발견 하나가 여러 intent 의 출처로 조용히 재사용된다.
      const points = resolve(fp, '..', r.slice(r.indexOf(':') + 1).trim())
      if (points !== docs.intent.path) {
        err('intent.md', '상위 발견의 `routed_to` 는 다른 intent 를 가리킨다',
          `발견 → ${points}\n      이 문서 → ${docs.intent.path}\n      발견 하나는 intent 하나를 낳는다. 다른 의도라면 발견도 따로 연다.`)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────── 2. 버전 고정

/** `intent_version` · `spec_version` 은 «어느 시점의 상위를 보고 썼나» 다. 대조하지
 *  않으면 적어 두기만 한 글자이고, 대조하는 순간 이 사슬에서 가장 흔한 붕괴가 잡힌다 —
 *  상위가 몰래 바뀐 채 하위가 진행되는 것. */
const inGit = (() => { try { execFileSync('git', ['-C', DIR, 'rev-parse', '--git-dir'], { stdio: 'ignore' }); return true } catch { return false } })()
const lastCommit = (f) => {
  try { return execFileSync('git', ['-C', DIR, 'log', '-1', '--format=%H', '--', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null }
  catch { return null }
}
if (!inGit) notes.push('git 저장소가 아니다 — 버전 고정 검사만 건너뛴다.')
else if (!TEMPLATE) {
  for (const [d, key, up] of [[docs.spec, 'intent_version', 'intent.md'], [docs.plan, 'spec_version', 'spec.md']]) {
    if (!d || isNull(d.fm[key])) continue
    const decl = String(d.fm[key])
    if (/^\d{4}-\d{2}-\d{2}$/.test(decl)) { warn(d.name, `\`${key}\` 가 날짜다`, '커밋 SHA 를 쓰면 기계가 대조할 수 있다.'); continue }
    if (!/^[0-9a-f]{7,40}$/i.test(decl)) { err(d.name, `\`${key}: ${decl}\` 는 커밋 SHA 도 날짜도 아니다`, `${up} 을 마지막으로 바꾼 커밋의 SHA 를 적는다.`); continue }
    const actual = lastCommit(up)
    if (!actual) { warn(d.name, `${up} 의 커밋 이력을 못 읽었다`, '아직 커밋되지 않았을 수 있다.'); continue }
    if (!actual.startsWith(decl.toLowerCase())) {
      err(d.name, `\`${key}\` 가 ${up} 의 현재 커밋과 다르다 (선언 ${decl} != 실제 ${actual.slice(0, 7)})`,
        `${up} 이 이 문서를 쓴 뒤에 바뀌었다. 바뀐 내용을 읽고 이 문서를 갱신한 다음 ${key} 를 다시 찍는다.`)
    }
  }
}

// ─────────────────────────────────────────────────────────── 3. 티어별 섹션

const tierOf = (m) => !m ? null
  : /조건부/.test(m) ? 'conditional' : /선택/.test(m) ? 'optional'
  : /모든\s*티어/.test(m) ? 'light' : /standard\+/.test(m) ? 'standard'
  : /\bfull\b/.test(m) ? 'full' : 'unknown'
const required = (n) => n === 'light' || (n === 'standard' && TIER !== 'light') || (n === 'full' && TIER === 'full')

for (const d of Object.values(docs)) {
  for (const h of d.hs) {
    const need = tierOf(h.marker)
    if (need === 'unknown') { warn(d.name, `«${h.title}» 의 표기 \`[${h.marker}]\` 를 못 읽었다`, 'conventions.md 의 표기 다섯 중 하나여야 한다.'); continue }
    if (!need || !required(need) || h.hasMarkedChild || TEMPLATE) continue

    const body = (from, to) => stripComments(d.lines.slice(from, to).join('\n')).split('\n')
      .filter((l) => l.trim() && !/^\s*```/.test(l))
    let content = body(h.line + 1, h.ownEnd)
    if (content.length === 0 && h.hasChild) content = body(h.line + 1, h.allEnd).filter((l) => !/^#{2,4}\s/.test(l))
    const where = `«${h.title}»`

    if (content.length === 0) {
      /** 흔한 모양 하나를 따로 말한다: 표기 붙은 제목 바로 뒤에 **형제** 항목 헤딩이 서면
       *  그 항목들은 이 제목의 자식이 아니라 옆칸이라 내용이 빈 것으로 읽힌다. 템플릿의
       *  헤딩 층을 바꿀 때 생기고, 메시지가 «비어 있다» 뿐이면 원인이 안 보인다. */
      const next = d.hs.find((x) => x.line > h.line)
      const sibling = next && next.depth === h.depth && new RegExp(`^(${P_ALT})-\\d`).test(next.title)
      err(d.name, `${where} 이 비어 있다`, sibling
        ? `바로 뒤의 \`${next.title.split(/\s/)[0]}\` 이 같은 층(h${next.depth})이라 자식이 아니라 옆칸이다. 이 제목을 \`##\` 로 올리거나 표기를 떼고 항목만 남긴다 — 템플릿의 헤딩 층을 그대로 쓰는 것이 가장 안전하다.`
        : `\`${TIER}\` 티어에서 필수다. 없으면 \`해당 없음 — <근거>\`.`)
      continue
    }
    /** «이 섹션은 해당 없음» 과 «복구: 해당 없음» 은 다르다. 앞은 섹션을 통째로 비운
     *  선언이라 근거를 요구하고, 뒤는 본문 한가운데의 필드 값이다. 줄 **머리**에 서고
     *  그것 말고 내용이 없을 때만 선언으로 읽는다. */
    const none = content.length <= 2 ? content.find((l) => /^\s*해당\s*없음/.test(l)) : undefined
    if (none) {
      if (!/해당\s*없음\s*[—–-]\s*\S/.test(none)) {
        err(d.name, `${where} 의 \`해당 없음\` 에 근거가 없다`, '근거 없는 «해당 없음» 은 «정말 없다» 와 «안 봤다» 를 같은 글자로 만든다.')
      }
      continue
    }
    const ph = content.filter((l) => /<[^<>\n]{1,120}>/.test(l))
    if (ph.length === content.length) err(d.name, `${where} 이 placeholder 뿐이다 (미작성)`, `\`${TIER}\` 티어에서 필수다. 채우거나 티어를 낮춘다.`)
    else if (ph.length > 0) warn(d.name, `${where} 에 placeholder ${ph.length}줄이 남았다`, `첫 줄: ${ph[0].trim().slice(0, 60)}`)
  }
}

// ─────────────────────────────────────────────────────────── 4. ID 문법과 참조

for (const d of Object.values(docs)) {
  for (const e of d.ents.values()) {
    const home = PREFIXES[e.id.split('-')[0]]
    if (home && home.doc !== d.kind) {
      err(d.name, `${e.id} 이 ${FILES[home.doc]} 밖에서 정의됐다`, `${e.id.split('-')[0]}-* 는 ${FILES[home.doc]} 의 «${home.label}» 이 정의한다.`)
    }
  }
  d.lines.forEach((line, i) => {
    if (!d.live[i]) return
    for (const id of idsIn(line)) {
      if (ALL.has(id)) continue
      // 템플릿의 `<AC-ID>` 같은 placeholder 참조는 세지 않는다.
      if (TEMPLATE && /<[^<>]*-\d/.test(line)) continue
      const home = PREFIXES[id.split('-')[0]]
      /** **아직 안 쓴 문서의 ID 는 오류가 아니다.** 사슬은 한 장씩 자란다 —
       *  `/create-intent` 직후에는 intent.md 뿐이고, 그 문서가 앞으로 쓸 `spec.md` 의
       *  결정을 가리키는 것은 정상이다. 그 문서가 **생긴 뒤에도** 정의가 없으면 그때
       *  오류다. 이것을 늘 오류로 두면 부분 사슬이 언제나 빨갛고, 빨간 것이 기본이면
       *  아무도 안 본다. */
      const pending = !docs[home.doc]
      ;(pending ? warn : err)(d.name,
        pending ? `${id} 은 아직 없는 ${FILES[home.doc]} 의 ID 다`
                : `${id} 을 참조하는데 어디에도 정의되어 있지 않다`,
        pending ? `${FILES[home.doc]} 을 쓸 때 «${home.label}» 에 \`### ${id} — 제목\` 으로 정의한다. 위치: ${d.name}:${i + 1}`
                : `${FILES[home.doc]} 의 «${home.label}» 에 \`### ${id} — 제목\` 으로 정의하거나 참조를 고친다. 위치: ${d.name}:${i + 1}`)
    }
    for (const m of line.matchAll(/\b([A-Z]{2,6})-(\d{2,4})\b/g)) {
      if (PREFIXES[m[1]] || NOT_OURS.has(m[1])) continue
      warn(d.name, `\`${m[0]}\` — conventions.md 의 ID 접두 표에 \`${m[1]}\` 가 없다`, '오타이거나, 표에 먼저 더해야 하는 새 접두다.')
    }
  })
}

// ─────────────────────────────────────────────────────────── 5. 추적성

const outs = of('intent', 'OUT')
const reqs = [...of('spec', 'FR'), ...of('spec', 'NFR')]
const acs = of('spec', 'AC')
const wps = of('plan', 'WP')

// 5-1. 모든 요구사항은 근거(OUT/CON)를 가리킨다.
for (const r of reqs) {
  if (idsIn(field(r, '근거')).some((x) => /^(OUT|CON)-/.test(x))) continue
  err('spec.md', `${r.id} 에 \`근거:\` 가 없다`, '어느 OUT-*/CON-* 에서 왔는지 없으면 이 요구사항이 왜 존재하는지 아무도 답할 수 없다.')
}
// 5-2. 모든 Must 결과는 요구사항으로 덮인다 — **역방향**. 이것이 빠지면 «요구사항이
//      어디서 왔나» 만 알고 «이 결과를 정말 덮었나» 는 모른다.
if (docs.spec) {
  const covered = new Set(reqs.flatMap((r) => idsIn(field(r, '근거'))))
  for (const o of outs) {
    if (!isMust(o) || covered.has(o.id)) continue
    err('spec.md', `${o.id}(Must) 를 덮는 요구사항이 없다`, 'intent 가 Must 로 약속한 결과인데 명세가 다루지 않는다. 요구사항을 더하거나 intent 에서 우선순위를 내린다.')
  }
}
// 5-3. 모든 Must 요구사항은 수용 기준을 가진다.
for (const r of reqs) {
  if (!isMust(r)) continue
  if (acs.some((a) => a.parent === r.id)) continue
  err('spec.md', `${r.id}(Must) 에 수용 기준이 없다`, '`수용 기준:` 밑에 `- [ ] AC-00N — <언제>이면 시스템은 <무엇을> 한다` 를 적는다. Pass/Fail 로 못 재는 Must 는 끝났는지 아무도 말할 수 없다.')
}
// 5-4. 작업은 다섯 줄을 갖추고 요구사항을 가리킨다.
for (const w of wps) {
  const missing = WP_FIELDS.filter((k) => !w.fields.has(k))
  if (missing.length) err('plan.md', `${w.id} 에 \`${missing.join('\`·\`')}\` 줄이 없다`, `작업마다 ${WP_FIELDS.join(' · ')} 다섯 줄이 있어야 /implement-spec 이 이것을 굴린다.`)
  if (!w.fields.has('covers')) continue
  if (idsIn(field(w, 'covers')).some((x) => /^(FR|NFR|AC)-/.test(x))) continue
  err('plan.md', `${w.id} 이 어느 요구사항도 가리키지 않는다`, '어디에도 안 걸린 작업은 이 변경의 일이 아니다. covers 를 채우거나 작업을 뺀다.')
}
// 5-5. 모든 Must 수용 기준은 작업이 덮는다.
if (docs.plan && docs.spec) {
  const done = new Set(wps.flatMap((w) => idsIn(field(w, 'covers'))))
  for (const a of acs) {
    const parent = a.parent ? ent(a.parent) : null
    if (!parent || !isMust(parent)) continue
    if (done.has(a.id) || done.has(a.parent)) continue
    err('plan.md', `${a.id}(${a.parent} 의 수용 기준) 을 덮는 작업이 없다`, '수용 기준이 있는데 그것을 만드는 작업이 없으면 그 기준은 아무도 통과시키지 않는다.')
  }
}
// 5-6. 모든 가설은 관측을 가리킨다 — finding 의 척추다.
for (const h of of('finding', 'HYP')) {
  if (idsIn(field(h, '근거')).some((x) => x.startsWith('EV-'))) continue
  err('finding.md', `${h.id} 이 어느 관측도 가리키지 않는다`, '§관측 의 EV-* 를 `근거:` 로 든다. 기계가 잰 것에 안 걸린 가설은 모델의 짐작이지 발견이 아니다.')
}

// 5-7. 같은 레벨의 작업은 같은 파일을 만지지 않는다.
/** `/implement-spec` 은 같은 레벨을 **동시에** 워크트리로 돌린다. `files` 가 겹치면
 *  합류에서 충돌이 나고, 그 충돌은 «이 검사가 틀렸다» 는 신호다. 스킬이 눈으로 보던
 *  것을 여기서 기계가 본다. */
if (wps.length) {
  const { level, cycles, unknown } = levelsOf(wps)
  for (const c of cycles) err('plan.md', `${c[0]} 의 \`depends\` 가 순환한다`, `${c.join(' → ')}. 순환하면 레벨이 정해지지 않아 실행 순서가 없다.`)
  for (const u of unknown) err('plan.md', `${u.id} 의 \`depends\` 가 없는 작업 ${u.dep} 를 가리킨다`, '오타이거나 그 작업이 빠졌다.')
  const byLevel = new Map()
  for (const w of wps) { const lv = level.get(w.id) ?? 0; (byLevel.get(lv) ?? byLevel.set(lv, []).get(lv)).push(w) }
  for (const [lv, group] of byLevel) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = new Set(wpFiles(group[i])), b = new Set(wpFiles(group[j]))
      const shared = [...a].filter((f) => b.has(f))
      if (shared.length === 0) continue
      err('plan.md', `레벨 ${lv + 1} 의 ${group[i].id} 와 ${group[j].id} 가 같은 파일을 만진다: ${shared.join(', ')}`,
        '같은 레벨은 병렬로 돌아 합류에서 충돌한다. `depends` 로 줄을 세우거나 두 작업을 합친다.')
    }
  }
}

// ─────────────────────────────────────────────────────────── 6. 상태 정합성

if (!TEMPLATE) {
  const rank = (d) => RANK[d?.fm?.status] ?? 0
  for (const [c, p] of [[docs.spec, docs.intent], [docs.plan, docs.spec], [docs.plan, docs.intent]]) {
    if (!c || !p) continue
    if (rank(c) >= 2 && rank(p) < 2) {
      err(c.name, `\`${c.fm.status}\` 인데 상위 ${p.name} 가 \`${p.fm.status}\` 다`, '하위는 상위보다 앞서갈 수 없다. 승인되지 않은 의도 위에 선 명세는 무엇에 대한 명세인지 알 수 없다.')
    }
  }
  for (const [d, prefix] of [[docs.finding, 'FQ'], [docs.intent, 'Q'], [docs.spec, 'SQ'], [docs.plan, 'PQ']]) {
    if (!d || (RANK[d.fm.status] ?? 0) < 2) continue
    for (const q of of(d.kind, prefix)) {
      const txt = q.body + ' ' + q.title
      if (!/막힘/.test(txt) || !/\bOpen\b/i.test(txt) || /<[^<>]*막힘/.test(txt)) continue
      err(d.name, `\`${d.fm.status}\` 인데 «막힘» 질문이 Open 이다 — ${q.id}`, '막는 질문이 열려 있는 동안에는 다음 단계의 확정적 작업을 시작하지 않는다.')
    }
  }

  if (docs.plan && schemaVersion(docs.plan.fm) >= 4 && docs.plan.fm.status === 'completed') {
    const open = wps.filter((w) => !w.done)
    if (open.length) err('plan.md', `\`completed\` 인데 미완료 작업이 있다: ${open.map((w) => w.id).join(' · ')}`,
      '모든 작업과 검증을 끝낸 뒤 completed 로 바꾼다.')
    const planText = stripComments(docs.plan.lines.join('\n'))
    const log = /##\s*실행 기록[\s\S]*?(?=\n##\s|\n*$)/.exec(planText)?.[0] ?? ''
    const logged = new Set(idsIn(log).filter((id) => id.startsWith('WP-')))
    const missing = wps.filter((w) => !logged.has(w.id))
    if (missing.length) err('plan.md', `\`completed\` 인데 실행 기록이 없는 작업이 있다: ${missing.map((w) => w.id).join(' · ')}`,
      '§실행 기록에 작업 ID, 결과, 커밋, 계획과의 차이를 남긴다.')
    const unchecked = docs.plan.lines.filter((line, i) => docs.plan.live[i] && /^\s*- \[ \]/.test(line))
    if (unchecked.length) err('plan.md', `\`completed\` 인데 체크되지 않은 완료 조건이 ${unchecked.length}개 있다`,
      '작업과 완료 정의의 체크박스를 모두 확인한다. 필수 수동 검증이 남았으면 completed 로 바꾸지 않는다.')
  }
}

// ────────────────────────────────────── 6-b. 결정 핀 (schema v4 는 선택, v5 는 검사)
// 되돌리기 어려운 결정을 사슬 안에서 새로 정하면 그 결정은 이번 변경과 함께 죽는다. 핀은
// 그것을 밖으로 내보내고, 이 검사는 **대체된 결정을 인용한 채로 도는 사슬**을 잡는다 —
// 산문만으로는 아무도 못 보는 자리다.

if (!TEMPLATE) {
  checkPins(docs, { seam: SEAM }, (level, doc, msg, hint) => problems.push({ level, doc, msg, hint }))
}

// ─────────────────────────────────────────────────────────── 7. 층 침범 (경고)

if (!TEMPLATE) {
  const SRC = /`?[\w.-]+\/[\w./-]*\.(?:ts|tsx|js|jsx|py|rs|go|java|kt|rb|php|cs|swift|sql)`?/
  for (const d of [docs.intent, docs.spec].filter(Boolean)) {
    d.lines.forEach((line, i) => {
      if (/^\s*```/.test(line) && d.kind === 'intent' && d.live[i] === false) return
      if (!d.live[i]) { if (d.kind === 'intent' && /^\s*```/.test(line)) warn(d.name, `${i + 1}번째 줄에 코드 블록이 있다`, 'intent 는 «왜/무엇»이다. 코드가 필요하면 spec 의 인터페이스 계약이나 plan 으로 내린다.'); return }
      const m = SRC.exec(stripComments(line))
      if (!m) return
      warn(d.name, `${i + 1}번째 줄에 소스 경로 \`${m[0]}\` 가 있다`,
        d.kind === 'intent' ? 'intent 는 파일명을 확정하지 않는다.' : 'spec 은 «관찰되는 동작»이다. 파일 구조는 plan 의 §도달 상태와 변경 지점 이 진다.')
    })
  }
}

// ─────────────────────────────────────────────────────────── 보고

process.exit(report({
  title: `산출물 사슬 검사 — ${basename(DIR)}  (tier: ${TIER}, 문서 ${Object.keys(docs).length}개, ID ${ALL.size}개)`,
  notes, problems, strict: STRICT, ruleDoc: '`conventions.md` 의 «티어» · «ID 접두» · «상태와 승인» 절에 있다.',
}))
