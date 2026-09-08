#!/usr/bin/env node
/** 산출물의 구조·추적성·상태·참조 버전을 검사한다. 사용법: node check-artifacts.mjs <명세 디렉터리> [--strict]. */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { resolve, basename, dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  PREFIXES, FILES, WP_FIELDS, P_ALT, idsIn, stripComments, isNull, frontmatter,
  loadDir, isTemplate, report, SDLC_VERSION,
  SUPPORTED_SCHEMA_VERSIONS, schemaVersion,
  levelsOf, wpFiles, ADR_FILENAME, loadAdrDir, CHAIN_FILES, scopeOf } from './artifact-parse.mjs'
import { adrSeam, checkAdr, checkPins } from './adr-check.mjs'
import { LOCK_FILE, upstreamSeam, loadLock, verifyLock, findUpstream, headOf, sameRepo } from './upstream.mjs'
import { loadBands, revisedBy } from './bands.mjs'
import { loadPolicy, routeActive, STAGES } from './autonomy.mjs'
import { FIELD, MARKER, BLOCKED, SECTION, hasAlias, sectionBlock, RE_NA, RE_NA_WITH_BASIS, RE_BAND_NO_CHANGE } from './keywords.mjs'
import { useLocale } from './locale.mjs'

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
useLocale(DIR)   // 문체 번들을 프로필의 lang 으로 고른다

/** 산출물 ID 검사에서 제외할 표준 약어와 문서 ID 접두. */
const NOT_OURS = new Set(['UTF', 'ISO', 'RFC', 'SHA', 'AES', 'TLS', 'SLA', 'RTO', 'RPO', 'WCAG',
  'HTTP', 'HTTPS', 'ADR', 'DORA', 'MDM', 'MCP', 'ACP', 'PII', 'API', 'SDK', 'CHG', 'SPEC',
  'PLAN', 'FND', 'JSON', 'YAML', 'CSV', 'SQL', 'AWS', 'GCP', 'CPU', 'RAM'])

const TIERS = ['light', 'standard', 'full']
const STATUS = {
  intent: ['draft', 'in_review', 'accepted', 'rejected', 'superseded'],
  spec: ['draft', 'in_review', 'accepted', 'rejected', 'superseded'],
  plan: ['draft', 'in_review', 'accepted', 'in_progress', 'completed', 'rejected', 'superseded'],
  // finding의 accepted는 승인 대신 처리 경로 확정을 뜻한다.
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

/** 프로필이 있는 가장 가까운 상위 디렉터리를 저장소 루트로 사용한다. */
const REPO_ROOT = (() => {
  for (let d = DIR, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
    if (existsSync(resolve(d, '.claude/spec-profile.yml'))) return d
  }
  return null
})()
const SEAM = { ...adrSeam(REPO_ROOT), root: REPO_ROOT }
const UP = upstreamSeam(REPO_ROOT)

// ADR 입력은 상위 문서가 없는 파일 단위 검사로 처리한다.

const ADR_TARGETS = (() => {
  const isDir = existsSync(DIR) && statSync(DIR).isDirectory()
  if (!isDir) return ADR_FILENAME.test(basename(DIR)) ? { dir: dirname(DIR), only: basename(DIR) } : null
  // ADR 경로가 겹치더라도 intent·spec·plan이 있으면 산출물 검사를 우선한다.
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
    // info 진단도 누락되지 않도록 별도 출력한다.
    checkAdr(d, { seam: SEAM, siblings: all }, (level, msg, hint) =>
      level === 'info' ? notes.push(`${d.name} — ${msg}`) : problems.push({ level, doc: d.name, msg, hint }))
  }
  if (!SEAM.configured) notes.push('프로필에 `adr_dir` 이 없다 — 등재하면 사슬의 `decisions:` 핀 검사가 함께 돈다')
  process.exit(report({
    title: `결정 기록 검사 — ${targets.length}장${malformed.length ? ` (이름 규칙 위반 ${malformed.length}개)` : ''}`,
    notes, problems, strict: STRICT, ruleDoc: '`references/adr.md` 에 있다.',
  }))
}


const docs = loadDir(DIR, (d, dup, first) =>
  err(d.name, `${dup.id} 이 두 번 정의됐다`, `먼저: ${d.name}:${first.line + 1}`))
const TEMPLATE = isTemplate(docs)

if (Object.keys(docs).length === 0) {
  console.error(`산출물이 없다 — ${DIR} 에 intent.md / spec.md / plan.md / finding.md 가 하나도 없다.`)
  process.exit(1)
}
// finding만 있는 디렉터리도 유효하다.
if (!TEMPLATE && !docs.intent && (docs.spec || docs.plan)) {
  err('(폴더)', 'intent.md 가 없다', '사슬은 의도에서 시작한다. spec·plan 만으로는 «왜»가 어디에도 없다.')
}

/** 템플릿은 내용·상태·버전 검사를 생략하되 구조와 ID 참조는 검사한다. */
if (TEMPLATE) notes.push('템플릿 원본으로 판정했다(id 가 아직 `…-YYYY-NNN`) — 내용·상태·버전·층 검사는 건너뛰고 구조와 ID 그래프만 본다.')

const ALL = new Map()
for (const d of Object.values(docs)) for (const [id, e] of d.ents) if (!ALL.has(id)) ALL.set(id, { ...e, doc: d })
const ent = (id) => ALL.get(id)
const of = (kind, prefix) => [...(docs[kind]?.ents.values() ?? [])].filter((e) => e.id.startsWith(prefix + '-'))
const isMust = (e) => /^must$/i.test(e.priority ?? '')
const field = (e, ...names) => { for (const n of names) if (e.fields.has(n)) return e.fields.get(n); return '' }


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

// band_breach는 등록된 밴드를 참조해야 하며, 조정 내용은 등록부와 일치해야 한다.
if (docs.finding && !TEMPLATE) {
  const f = docs.finding
  /** Git 초기화 여부와 관계없이 프로필을 기준으로 루트를 찾는다. */
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
      // finding의 허용 범위는 밴드 설정을 초과할 수 없다.
      err(f.name, `\`autonomy_tier: ${f.fm.autonomy_tier}\` 가 등록부의 \`${band}\`(\`${reg.bands[band].autonomy_tier}\`) 와 다르다`,
        '무엇을 해도 되는지는 밴드가 정한다. 넓혀야 하면 등록부를 먼저 고친다.')
    }
  }

  /** 밴드를 조정했다면 등록부 기록을 요구하고, 조정하지 않았다면 근거를 요구한다. */
  if (f.fm.status === 'rejected') {
    const body = stripComments(f.lines.join('\n'))
    const noChange = RE_BAND_NO_CHANGE.test(body)
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

// 스키마 v3 이상은 작성자와 승인자를 분리한다. finding은 처리 경로로 검증한다.
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

    /** 정책 승인은 등록된 경로의 유효기간과 위임 범위를 검사한다. */
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
        /** 정책 승인은 advance_to 이후의 산출물에 적용할 수 없다. */
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

// 작성 메타데이터 누락은 경고한다. strict 모드에서는 실패로 처리한다.
if (!TEMPLATE) {
  for (const d of Object.values(docs)) {
    if (!isNull(d.fm.generated_by)) continue
    warn(d.name, '`generated_by` 가 비었다',
      'Agent 가 썼으면 `generated_by` · `generated_from` · `skills_in_force` 를 채운다. 사람이 손으로 썼으면 그대로 두고 이 경고를 남긴다 — 그것도 기록이다.')
  }
}

/** intent·spec·plan은 스키마 버전이 같아야 한다. 독립 입력인 finding은 예외다. */
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

/** 위험 등급은 intent에서 상속한다. finding은 자체 등급을 사용한다. */
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

/** from_finding과 routed_to의 양방향 연결을 확인한다. */
if (docs.intent && !isNull(docs.intent.fm.from_finding)) {
  const fp = resolve(DIR, String(docs.intent.fm.from_finding))
  if (!existsSync(fp)) err('intent.md', `\`from_finding: ${docs.intent.fm.from_finding}\` 가 가리키는 파일이 없다`, '상대 경로를 확인한다.')
  else {
    const up = frontmatter(readFileSync(fp, 'utf8')) ?? {}
    const r = isNull(up.routed_to) ? '' : String(up.routed_to)
    if (up.status === 'accepted' && !r.startsWith('intent')) {
      err('intent.md', `상위 발견(${basename(fp)}) 은 \`${r || '경로 없음'}\` 로 나갔다고 적혀 있다`, '이 intent 가 그 발견에서 왔다면 발견의 `routed_to` 도 `intent:<이 경로>` 여야 한다.')
    } else if (r.startsWith('intent')) {
      // 양쪽 경로가 같은 문서 쌍을 가리켜야 한다.
      const points = resolve(fp, '..', r.slice(r.indexOf(':') + 1).trim())
      if (points !== docs.intent.path) {
        err('intent.md', '상위 발견의 `routed_to` 는 다른 intent 를 가리킨다',
          `발견 → ${points}\n      이 문서 → ${docs.intent.path}\n      발견 하나는 intent 하나를 낳는다. 다른 의도라면 발견도 따로 연다.`)
      }
    }
  }
}

// 상류가 다른 레포면 그 사실이 폴더 안에 파일로 있어야 검사기가 본다. 락이 그 파일이다.
const LOCK = TEMPLATE ? null : loadLock(DIR)
if (LOCK?.broken) {
  err(LOCK_FILE, `락을 읽을 수 없다 — ${LOCK.broken}`, '`pull-spec.mjs` 로 다시 끌어오면 새로 만든다.')
} else if (LOCK) {
  // 사본이 락과 다르면 손을 탄 것이다. 정본이 둘이 되는 것을 규율이 아니라 해시가 막는다.
  for (const pr of verifyLock(DIR, LOCK)) problems.push(pr)
  if (!UP.self) {
    err(LOCK_FILE, '상류에서 끌어왔는데 프로필에 `repo` 가 없다',
      '`repo: "<owner>/<name>"` 이 없으면 어느 수용 기준이 이 레포 몫인지 가를 수 없어, 남의 몫까지 이 레포에 물린다.')
  }
  if (UP.self && sameRepo(UP.self, LOCK.repo)) {
    err(LOCK_FILE, `상류(${LOCK.repo})가 이 레포다`, '자기 자신에서 끌어오면 사본과 정본이 같은 자리에 산다. 락을 지운다.')
  }
  // 신선도는 옆에 받아둔 체크아웃이 있을 때만 본다 — 검사기는 네트워크를 쓰지 않는다.
  const upRoot = findUpstream(LOCK, REPO_ROOT, null)
  if (!upRoot) {
    notes.push(`${LOCK.repo} 체크아웃이 없다 — 사본의 무결성만 봤다. CI 는 상류를 체크아웃하고 \`SDLC_UPSTREAM\` 으로 가리킨다.`)
  } else {
    for (const [name, e] of Object.entries(LOCK.files)) {
      if (!e?.sha || !e?.path) continue
      const head = headOf(upRoot, e.path)
      if (!head || head === e.sha) continue
      err(name, `상류가 이 사본보다 앞서 있다 (락 ${String(e.sha).slice(0, 7)} != 상류 ${head.slice(0, 7)})`,
        `${LOCK.repo} 의 ${e.path} 가 바뀌었다. \`pull-spec.mjs ${basename(DIR)}\` 로 다시 끌어오고 바뀐 내용에 맞춰 plan 을 고친다.`)
    }
  }
}

// intent_version·spec_version을 상위 문서의 커밋과 대조한다. 락이 있으면 대조 상대는
// 사본이 아니라 락이 가리키는 상류 커밋이다 — 그래야 핀이 레포 경계를 넘는다.
const inGit = (() => { try { execFileSync('git', ['-C', DIR, 'rev-parse', '--git-dir'], { stdio: 'ignore' }); return true } catch { return false } })()
const lastCommit = (f) => {
  try { return execFileSync('git', ['-C', DIR, 'log', '-1', '--format=%H', '--', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null }
  catch { return null }
}
// git 도 락도 없으면 대조할 상대가 없다 — 형식 검사까지 통째로 건너뛴다.
if (!inGit && !LOCK?.files) notes.push('git 저장소가 아니다 — 버전 고정 검사만 건너뛴다.')
else if (!TEMPLATE) {
  for (const [d, key, up] of [[docs.spec, 'intent_version', 'intent.md'], [docs.plan, 'spec_version', 'spec.md']]) {
    if (!d || isNull(d.fm[key])) continue
    const decl = String(d.fm[key])
    if (/^\d{4}-\d{2}-\d{2}$/.test(decl)) { warn(d.name, `\`${key}\` 가 날짜다`, '커밋 SHA 를 쓰면 기계가 대조할 수 있다.'); continue }
    if (!/^[0-9a-f]{7,40}$/i.test(decl)) { err(d.name, `\`${key}: ${decl}\` 는 커밋 SHA 도 날짜도 아니다`, `${up} 을 마지막으로 바꾼 커밋의 SHA 를 적는다.`); continue }
    const pinned = LOCK?.files?.[up]?.sha ?? null
    const actual = pinned ?? (inGit ? lastCommit(up) : null)
    if (!actual) { warn(d.name, `${up} 의 커밋 이력을 못 읽었다`, '아직 커밋되지 않았을 수 있다.'); continue }
    if (actual.startsWith(decl.toLowerCase())) continue
    err(d.name, `\`${key}\` 가 ${pinned ? `${LOCK.repo} 의 ${up}` : up} 의 현재 커밋과 다르다 (선언 ${decl} != 실제 ${actual.slice(0, 7)})`,
      pinned
        ? '락이 가리키는 상류 커밋을 적는다. 상류가 바뀌었으면 `pull-spec.mjs` 로 다시 끌어온 뒤 찍는다.'
        : `${up} 이 이 문서를 쓴 뒤에 바뀌었다. 바뀐 내용을 읽고 이 문서를 갱신한 다음 ${key} 를 다시 찍는다.`)
  }
}


const tierOf = (m) => !m ? null
  : hasAlias(m, MARKER.conditional) ? 'conditional' : hasAlias(m, MARKER.optional) ? 'optional'
  : hasAlias(m, MARKER.allTiers) ? 'light' : /standard\+/.test(m) ? 'standard'
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
      /** 같은 깊이의 제목은 하위 내용으로 집계하지 않는다. */
      const next = d.hs.find((x) => x.line > h.line)
      const sibling = next && next.depth === h.depth && new RegExp(`^(${P_ALT})-\\d`).test(next.title)
      err(d.name, `${where} 이 비어 있다`, sibling
        ? `바로 뒤의 \`${next.title.split(/\s/)[0]}\` 이 같은 층(h${next.depth})이라 자식이 아니라 옆칸이다. 이 제목을 \`##\` 로 올리거나 표기를 떼고 항목만 남긴다 — 템플릿의 헤딩 층을 그대로 쓰는 것이 가장 안전하다.`
        : `\`${TIER}\` 티어에서 필수다. 없으면 \`해당 없음 — <근거>\`.`)
      continue
    }
    /** 섹션 전체가 ‘해당 없음’일 때만 근거를 요구한다. 본문 필드 값은 제외한다. */
    const none = content.length <= 2 ? content.find((l) => RE_NA.test(l)) : undefined
    if (none) {
      if (!RE_NA_WITH_BASIS.test(none)) {
        err(d.name, `${where} 의 \`해당 없음\` 에 근거가 없다`, '근거 없는 «해당 없음» 은 «정말 없다» 와 «안 봤다» 를 같은 글자로 만든다.')
      }
      continue
    }
    const ph = content.filter((l) => /<[^<>\n]{1,120}>/.test(l))
    if (ph.length === content.length) err(d.name, `${where} 이 placeholder 뿐이다 (미작성)`, `\`${TIER}\` 티어에서 필수다. 채우거나 티어를 낮춘다.`)
    else if (ph.length > 0) warn(d.name, `${where} 에 placeholder ${ph.length}줄이 남았다`, `첫 줄: ${ph[0].trim().slice(0, 60)}`)
  }
}


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
      // 템플릿의 ID 자리표시자는 참조로 집계하지 않는다.
      if (TEMPLATE && /<[^<>]*-\d/.test(line)) continue
      const home = PREFIXES[id.split('-')[0]]
      /** 아직 생성되지 않은 문서의 ID 참조는 오류로 처리하지 않는다. */
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


const outs = of('intent', 'OUT')
const reqs = [...of('spec', 'FR'), ...of('spec', 'NFR')]
const acs = of('spec', 'AC')
const wps = of('plan', 'WP')

// 요구사항의 근거는 OUT 또는 CON이어야 한다.
for (const r of reqs) {
  if (idsIn(field(r, ...FIELD.basis)).some((x) => /^(OUT|CON)-/.test(x))) continue
  err('spec.md', `${r.id} 에 \`근거:\` 가 없다`, '어느 OUT-*/CON-* 에서 왔는지 없으면 이 요구사항이 왜 존재하는지 아무도 답할 수 없다.')
}
// 모든 Must 목표 결과에 요구사항이 연결돼야 한다.
if (docs.spec) {
  const covered = new Set(reqs.flatMap((r) => idsIn(field(r, ...FIELD.basis))))
  for (const o of outs) {
    if (!isMust(o) || covered.has(o.id)) continue
    err('spec.md', `${o.id}(Must) 를 덮는 요구사항이 없다`, 'intent 가 Must 로 약속한 결과인데 명세가 다루지 않는다. 요구사항을 더하거나 intent 에서 우선순위를 내린다.')
  }
}
// Must 요구사항에는 수용 기준이 필요하다.
for (const r of reqs) {
  if (!isMust(r)) continue
  if (acs.some((a) => a.parent === r.id)) continue
  err('spec.md', `${r.id}(Must) 에 수용 기준이 없다`, '`수용 기준:` 밑에 `- [ ] AC-00N — <언제>이면 시스템은 <무엇을> 한다` 를 적는다. Pass/Fail 로 못 재는 Must 는 끝났는지 아무도 말할 수 없다.')
}
// 작업의 필수 필드와 요구사항 참조를 검사한다.
for (const w of wps) {
  const missing = WP_FIELDS.filter((k) => !w.fields.has(k))
  if (missing.length) err('plan.md', `${w.id} 에 \`${missing.join('\`·\`')}\` 줄이 없다`, `작업마다 ${WP_FIELDS.join(' · ')} 다섯 줄이 있어야 /implement-spec 이 이것을 굴린다.`)
  if (!w.fields.has('covers')) continue
  if (idsIn(field(w, 'covers')).some((x) => /^(FR|NFR|AC)-/.test(x))) continue
  err('plan.md', `${w.id} 이 어느 요구사항도 가리키지 않는다`, '어디에도 안 걸린 작업은 이 변경의 일이 아니다. covers 를 채우거나 작업을 뺀다.')
}
// 소비 레포는 상류 spec 의 자기 `scope` 몫만 덮는다. 단일 레포면 경계가 없어 전부가 내 몫이다.
const CONSUMER = !!(LOCK && !LOCK.broken && UP.self)
const MINE = (e, parent) => {
  if (!CONSUMER) return true
  const sc = scopeOf(e, parent)
  // 범위가 없는 기준은 «아무의 몫도 아님» 이 아니라 «모두의 몫» 으로 읽는다. 조용히 빠지는 것보다 낫다.
  return sc.length === 0 || sc.some((s) => sameRepo(s, UP.self))
}

// 모든 Must 수용 기준에 구현 작업이 연결돼야 한다.
if (docs.plan && docs.spec) {
  const done = new Set(wps.flatMap((w) => idsIn(field(w, 'covers'))))
  for (const a of acs) {
    const parent = a.parent ? ent(a.parent) : null
    if (!parent || !isMust(parent)) continue
    if (done.has(a.id) || done.has(a.parent)) continue
    // 상류에서 끌어온 spec 은 여러 레포의 몫을 함께 담는다. 이 레포는 자기 `scope` 만 덮는다.
    if (!MINE(a, parent)) continue
    err('plan.md', `${a.id}(${a.parent} 의 수용 기준) 을 덮는 작업이 없다`, '수용 기준이 있는데 그것을 만드는 작업이 없으면 그 기준은 아무도 통과시키지 않는다.')
  }
  // 남의 몫을 덮는 작업은 이 레포의 일이 아니다 — 두 레포가 같은 기준을 만들면 합류에서 갈린다.
  if (CONSUMER) {
    for (const w of wps) {
      const foreign = idsIn(field(w, 'covers')).map((id) => ent(id)).filter((e) => {
        if (!e || e.kind === 'wp') return false
        const owner = e.kind === 'ac' && e.parent ? ent(e.parent) : null
        return !MINE(e, owner)
      })
      if (!foreign.length) continue
      err('plan.md', `${w.id} 이 다른 레포 몫을 덮는다: ${foreign.map((e) => `${e.id}(${scopeOf(e, e.kind === 'ac' && e.parent ? ent(e.parent) : null).join('·')})`).join(' · ')}`,
        `이 레포는 \`${UP.self}\` 다. 범위가 틀렸으면 상류 spec 의 \`scope\` 를 고치고 다시 끌어온다.`)
    }
  }
}
// `scope` 는 v6 문법이다. 옛 스키마로 선언한 문서에 쓰면 옛 런타임이 제목의 일부로 읽고
// 배정이 조용히 사라진다 — 버전을 올려야 그 사실이 드러난다.
if (docs.spec && !TEMPLATE && schemaVersion(docs.spec.fm) < 6) {
  const scoped = [...docs.spec.ents.values()].filter((e) => e.scope?.length)
  if (scoped.length) {
    err('spec.md', `\`scope\` 를 썼는데 \`schema_version: ${docs.spec.fm.schema_version ?? '(없음)'}\` 이다: ${scoped.map((e) => e.id).join(' · ')}`,
      'AC·요구사항의 레포 배정은 v6 부터다. 프런트매터의 schema_version 을 6 으로 올린다.')
  }
}

// 상류 문서 레포는 배정을 진다 — 모든 Must 수용 기준이 어느 소비 레포엔가 걸려야 한다.
// 소비 레포는 자기 몫만 보므로, 아무에게도 배정되지 않은 기준은 여기서만 보인다.
if (UP.isUpstream && docs.spec && !TEMPLATE && schemaVersion(docs.spec.fm) >= 6) {
  const known = (s) => UP.consumers.some((c) => sameRepo(c, s))
  for (const a of acs) {
    const parent = a.parent ? ent(a.parent) : null
    if (!parent || !isMust(parent)) continue
    const sc = scopeOf(a, parent)
    if (!sc.length) {
      err('spec.md', `${a.id}(Must) 에 \`scope\` 가 없다`,
        `이 레포는 ${UP.consumers.join(' · ')} 의 상류다. 어느 레포가 만드는지 없으면 아무도 자기 몫으로 읽지 않는다. AC 줄 끝에 \`\`scope: <repo>\`\` 를 붙이거나 상위 요구사항에 \`scope:\` 줄을 둔다.`)
      continue
    }
    const stray = sc.filter((s) => !known(s))
    if (stray.length) {
      err('spec.md', `${a.id} 의 \`scope\` 가 등록되지 않은 레포를 가리킨다: ${stray.join(' · ')}`,
        `프로필의 \`spec_consumers\` 에 있는 레포만 쓴다 — 지금은 ${UP.consumers.join(' · ')} 다.`)
    }
  }
  if (docs.plan) {
    warn('plan.md', '상류 문서 레포에 plan 이 있다',
      '계획과 실행은 코드 레포가 진다. 여기 두면 워크트리·검증·증거가 코드와 다른 레포에서 돈다.')
  }
}

// 가설은 관측 근거를 참조해야 한다.
for (const h of of('finding', 'HYP')) {
  if (idsIn(field(h, ...FIELD.basis)).some((x) => x.startsWith('EV-'))) continue
  err('finding.md', `${h.id} 이 어느 관측도 가리키지 않는다`, '§관측 의 EV-* 를 `근거:` 로 든다. 기계가 잰 것에 안 걸린 가설은 모델의 짐작이지 발견이 아니다.')
}

// 병렬 실행할 같은 레벨의 작업은 파일 범위가 겹치면 안 된다.
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
      if (!hasAlias(txt, BLOCKED) || !/\bOpen\b/i.test(txt) || /<[^<>]*(?:막힘|blocked)/i.test(txt)) continue
      err(d.name, `\`${d.fm.status}\` 인데 «막힘» 질문이 Open 이다 — ${q.id}`, '막는 질문이 열려 있는 동안에는 다음 단계의 확정적 작업을 시작하지 않는다.')
    }
  }

  if (docs.plan && schemaVersion(docs.plan.fm) >= 4 && docs.plan.fm.status === 'completed') {
    const open = wps.filter((w) => !w.done)
    if (open.length) err('plan.md', `\`completed\` 인데 미완료 작업이 있다: ${open.map((w) => w.id).join(' · ')}`,
      '모든 작업과 검증을 끝낸 뒤 completed 로 바꾼다.')
    const planText = stripComments(docs.plan.lines.join('\n'))
    const log = sectionBlock(SECTION.executionLog).exec(planText)?.[0] ?? ''
    const logged = new Set(idsIn(log).filter((id) => id.startsWith('WP-')))
    const missing = wps.filter((w) => !logged.has(w.id))
    if (missing.length) err('plan.md', `\`completed\` 인데 실행 기록이 없는 작업이 있다: ${missing.map((w) => w.id).join(' · ')}`,
      '§실행 기록에 작업 ID, 결과, 계획과의 차이를 남긴다. 계획대로 끝난 작업은 한 줄에 묶어도 된다.')
    const unchecked = docs.plan.lines.filter((line, i) => docs.plan.live[i] && /^\s*- \[ \]/.test(line))
    if (unchecked.length) err('plan.md', `\`completed\` 인데 체크되지 않은 완료 조건이 ${unchecked.length}개 있다`,
      '작업과 완료 정의의 체크박스를 모두 확인한다. 필수 수동 검증이 남았으면 completed 로 바꾸지 않는다.')
  }
}

// ADR 참조의 버전과 유효 상태를 검사한다.

if (!TEMPLATE) {
  checkPins(docs, { seam: SEAM }, (level, doc, msg, hint) => problems.push({ level, doc, msg, hint }))
}


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


process.exit(report({
  title: `산출물 사슬 검사 — ${basename(DIR)}  (tier: ${TIER}, 문서 ${Object.keys(docs).length}개, ID ${ALL.size}개)`,
  notes, problems, strict: STRICT, ruleDoc: '`conventions.md` 의 «티어» · «ID 접두» · «상태와 승인» 절에 있다.',
}))
