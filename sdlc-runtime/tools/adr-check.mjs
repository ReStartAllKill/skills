import { existsSync, realpathSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ADR_FILENAME, idsIn, stripComments, isNull, loadAdrDir, wpFiles, frontmatter, outsideCode, waiveLines } from './artifact-parse.mjs'
import { SECTION, CHOSEN, hasAlias, canonical, ADR_STATUS_ALIASES, LEGACY_STATUS_ROW } from './keywords.mjs'
import { locale } from './locale.mjs'
import { ADR_DEAD, adrSeam, loadManifest, loadBindings, boundForFiles, touches, lookFor, pathPast, pastUnknown, successorGap, showGap, SEARCH_BUDGET } from './adr-bindings.mjs'
import { sameRepo } from './upstream.mjs'
import { R } from './rules.mjs'
export { ADR_DEAD, adrSeam, loadManifest }
const CHOSEN_RE = new RegExp(`\\((?:${CHOSEN.join('|')})\\)`, 'i')

export const ADR_STATUS = ['draft', 'in_review', 'accepted', 'deprecated', 'superseded', 'rejected']
const SECTION_KEYS = ['decision', 'forces', 'alternatives', 'consequences', 'revisit']
const SECTIONS = SECTION_KEYS.map((k) => SECTION[k][1])
const titleIn = (doc, key) => SECTION[key].find((t) => sectionText(doc, t) != null) ?? SECTION[key][1]
const sameTitle = (a, b) => a.replace(/\s*및\s*/g, '과').replace(/\s+/g, '').toLowerCase() === b.replace(/\s*및\s*/g, '과').replace(/\s+/g, '').toLowerCase()

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

const sectionText = (doc, title) => {
  const h = doc.hs.find((x) => x.depth === 2 && sameTitle(x.title.replace(/`\[[^\]]*\]`/g, '').trim(), title))
  return h ? { h, text: stripComments(doc.lines.slice(h.line + 1, h.allEnd).join('\n')) } : null
}

const RESIDUE = [/\{NNN\}/, /<[^<>\n]{2,60}>/]

export function legacyMeta(doc) {
  if (/^---\r?\n/.test(doc.text)) return null
  const h1 = /^#\s+(.+?)\s*$/m.exec(doc.text)?.[1] ?? ''
  const title = h1.replace(/^ADR-\d{3,4}\s*[—–:-]?\s*/, '').trim()
  const row = LEGACY_STATUS_ROW.exec(doc.text)?.[1] ?? ''
  const raw = row.replace(/\(.*$/, '').trim()
  const known = canonical(raw, ADR_STATUS_ALIASES)
  return { title, status: known ?? '', rawStatus: raw, legacy: true }
}

export function checkAdr(doc, { seam, siblings = [] }, push) {
  const fm = doc.fm ?? {}
  const err = (m, h, rule) => push('error', m, h, rule)
  const warn = (m, h, rule) => push('warn', m, h, rule)

  const nm = ADR_FILENAME.exec(doc.name)
  if (!nm) {
    err(`파일 이름이 규칙과 다르다 — ${doc.name}`, 'ADR-{세 자리}-{kebab-slug}.md 다. 이름이 번호를 물어야 «ADR-007» 이 한 문서를 가리킨다.', R('adr-filename'))
  }
  if (!/^---\r?\n/.test(doc.text)) {
    if (!legacyMeta(doc).status) err('Unknown legacy ADR status', 'Use a Status/상태 table row with a supported status value.', R('adr-legacy-status-unknown'))
    push('info', '프런트매터가 없는 옛 문서다 — 이름과 번호·상태 해석만 검사했다',
      '새 계약으로 옮기려면 프런트매터(artifact · id · status · scope · confirms)를 더한다. ' +
      '그 전까지 이 결정은 승인 가드가 지키지 않고, 산출물 세트가 핀해도 상태를 못 본다.')
    return
  }

  if (nm) {
    const want = `ADR-${nm[1]}`
    if (String(fm.id ?? '') !== want) err(`파일 이름의 번호와 id 가 다르다 — 이름 ${want} · id ${fm.id ?? '(없음)'}`, '둘 중 어느 쪽이 맞는지 정하고 맞춘다. 번호는 재사용하지 않는다.', R('adr-id-mismatch'))
    const dup = siblings.filter((s) => s !== doc && String(s.fm?.id ?? '') === want)
    if (dup.length) err(`${want} 번호를 ${dup.length + 1}개 문서가 쓴다 — ${[doc, ...dup].map((s) => s.name).join(' · ')}`, '번호는 단조 증가하고 재사용하지 않는다. 뒤에 쓴 것에 새 번호를 준다.', R('adr-number-reused'))
  }

  if (String(fm.artifact ?? '') !== 'adr') err('`artifact: adr` 이 아니다', '이 값으로 검사기가 ADR 을 가려낸다.', R('artifact-kind-mismatch'))
  if (Number(fm.schema_version) !== 5) err(`schema_version 이 ${fm.schema_version ?? '(없음)'} 다`, 'ADR 은 언제나 5 다 — 산출물 세트의 버전과 별개다(references/schema.md).', R('adr-schema-version'))
  for (const k of ['id', 'title', 'status', 'generated_by']) {
    if (isNull(fm[k])) err(`\`${k}\` 가 비었다`, undefined, R('frontmatter-missing-key'))
  }
  const status = String(fm.status ?? '')
  if (status && !ADR_STATUS.includes(status)) {
    err(`status 가 \`${status}\` 다`, `허용값: ${ADR_STATUS.join(' · ')}. 산출물 상태값을 그대로 쓴다 — 모르는 값이면 승인 가드가 상태 전이를 못 본다.`, R('status-unknown'))
  }

  if (status === 'accepted') {
    if (isNull(fm.approved_by)) err('accepted 인데 `approved_by` 가 비었다', '승인은 사람이 한다. 가드가 그 편집을 다이얼로그로 보낸다.', R('approved-by-missing'))
    else if (String(fm.approved_by) === String(fm.generated_by)) err('`approved_by` 와 `generated_by` 가 같다', '쓴 쪽이 승인하면 관문이 아니라 자기선언이다.', R('self-approval'))
  }
  if (status === 'superseded' && isNull(fm.superseded_by)) {
    err('superseded 인데 `superseded_by` 가 없다', '무엇이 대체했는지 없으면 결정의 변경 이력을 추적할 수 없다.', R('superseded-by-missing'))
  }
  for (const [k, other] of [['superseded_by', 'supersedes'], ['supersedes', 'superseded_by']]) {
    for (const ref of [].concat(fm[k] ?? []).filter((v) => !isNull(v))) {
      const target = siblings.find((s) => String(s.fm?.id ?? '') === String(ref))
      if (!target) { warn(`\`${k}: ${ref}\` 가 이 폴더에 없다`, '다른 레포의 결정이면 그대로 두고, 오타면 고친다.', R('adr-supersede-target-missing')); continue }
      const back = [].concat(target.fm?.[other] ?? []).map(String)
      if (!back.includes(String(fm.id))) warn(`${ref} 의 \`${other}\` 에 ${fm.id} 가 없다`, '대체 관계는 양쪽에 적어야 어느 쪽에서 읽어도 추적 관계가 이어진다.', R('adr-supersede-unreciprocated'))
    }
  }
  // Retiring a decision before its successor is accepted opens a window with nothing in force for
  // the scope: `task-brief` injects only accepted decisions, so the implementing agent is told
  // nothing, and a plan has nothing live to pin. The chain is followed — a successor itself
  // superseded by an accepted decision closes the gap — and a successor in another repository is
  // left alone, since its status cannot be read here. Not waivable: it reports a broken link
  // between decisions, and a warning, so it gates under `--strict` as the other ADR links do.
  if (status === 'superseded') {
    const look = (id) => siblings.find((s) => String(s.fm?.id ?? '') === id)?.fm ?? null
    const gap = successorGap(look, String(fm.id ?? ''), [].concat(fm.superseded_by ?? []).filter((v) => !isNull(v)))
    if (gap) {
      warn(`superseded 인데 후속이 효력이 없다 — ${showGap(gap, look)}`,
        '후속이 accepted 가 될 때까지 이 결정의 scope 에 효력 있는 결정이 없다 — task-brief 는 아무 결정도 싣지 않고, 계획은 핀할 결정이 없다. 순서는 «후속을 승인하고, 그다음 선행을 superseded 로 돌린다» 다. 이미 돌렸으면 후속을 승인해 그 틈을 닫는다.', R('adr-successor-not-in-force'))
    }
  }

  const found = Object.fromEntries(SECTION_KEYS.map((k, i) => [SECTIONS[i], sectionText(doc, titleIn(doc, k))]))
  for (const t of SECTIONS) {
    if (found[t]) continue
    if (t === '확인과 재검토' && ['draft', 'in_review', 'rejected'].includes(status)) continue
    err(`«${t}» 절이 없다`, `ADR 의 절은 다섯이고 지울 수 없다: ${SECTIONS.join(' · ')}`, R('adr-section-missing'))
  }
  if (found['결정'] && !doc.hs.some((h) => h.depth === 3 && /^Non-goals$/i.test(h.title))) {
    warn('«결정» 에 `### Non-goals` 가 없다', '정하지 않는 것을 적지 않으면 스코프 논쟁이 나중에 다시 열린다. 이 목록은 구현 에이전트 프롬프트에 그대로 실린다.', R('adr-non-goals-missing'))
  }

  const alts = alternativesOf(doc)
  if (found['대안']) {
    if (alts.length < 2) err(`대안이 ${alts.length}개다`, '합리적인 대안이 실제로 있었다는 것이 ADR 의 전제다. 선택지가 없었으면 결정이 아니라 사실이고 spec 으로 간다.', R('adr-alternatives-too-few'))
    const chosen = alts.filter((a) => a.chosen)
    if (status === 'accepted' && chosen.length !== 1) {
      err(`accepted 인데 «(채택)» 이 ${chosen.length}개다`, '채택안이 정확히 하나여야 이 문서가 무엇을 정했는지 기계도 사람도 읽는다.', R('adr-chosen-count'))
    } else if (chosen.length > 1) {
      err(`«(채택)» 이 ${chosen.length}개다 — ${chosen.map((c) => c.id).join(' · ')}`, '대안은 서로 배타적이다. 동시에 채택 가능하면 그건 대안이 아니라 조합이다.', R('adr-chosen-count'))
    }
  }

  if (found['결과'] && !['draft', 'rejected'].includes(status)) {
    if (!locale().tradeoff.test(found['결과'].text)) {
      err('«결과» 에 감수하는 제약이 없다', '얻는 것만 있는 결정은 없다. 무엇을 대가로 지불하기로 했는지 적는다 — 그 줄이 이 문서의 핵심 기록이다.', R('adr-tradeoff-missing'))
    }
  }

  const asms = [...doc.ents.values()].filter((e) => e.id.startsWith('ASM-')).map((e) => e.id)
  const rvs = [...doc.ents.values()].filter((e) => e.id.startsWith('RV-')).map((e) => e.id)
  if (asms.length && !rvs.length) {
    warn(`전제 ${asms.length}개가 있는데 재검토 조건이 없다`, '전제가 무너지는 것이 곧 재검토 조건이다. RV-* 로 짝짓지 않으면 전제가 틀렸을 때 아무도 이 결정을 깨우지 않는다.', R('adr-revisit-missing'))
  }
  const declared = [].concat(fm.revisit ?? []).map(String).filter((v) => !isNull(v))
  for (const id of declared) if (!rvs.includes(id)) warn(`\`revisit: ${id}\` 가 본문에 없다`, '«확인과 재검토» 에 `### RV-NNN — 조건` 으로 정의한다.', R('adr-revisit-undefined'))
  for (const id of rvs) if (declared.length && !declared.includes(id)) warn(`${id} 가 \`revisit:\` 에 없다`, '프런트매터가 기계가 읽는 목록이다 — 빠지면 finding 이 그 조건을 못 깨운다.', R('adr-revisit-unlisted'))
  for (const rv of [...doc.ents.values()].filter((e) => e.id.startsWith('RV-'))) {
    if (locale().deadlineOnly.test(rv.title)) {
      warn(`${rv.title} 이 시한으로 쓰였다`, 'RV-* 는 참·거짓이 판정되는 조건이다. «6개월 뒤 재검토» 는 아무도 판정하지 않는다.', R('adr-revisit-deadline'))
    }
  }

  const scope = [].concat(fm.scope ?? []).map(String).filter((v) => !isNull(v))
  const confirms = [].concat(fm.confirms ?? []).map(String).filter((v) => !isNull(v))
  const confirmsIn = [].concat(fm.confirms_in ?? []).map(String).filter((v) => !isNull(v))
  const appliesTo = [].concat(fm.applies_to ?? []).map(String).filter((v) => !isNull(v))
  const live = !['draft', 'rejected', ...ADR_DEAD].includes(status)
  const entries = scope.map((s) => scopeEntry(s, seam?.self))
  const mine = entries.filter((e) => e.mine)
  const foreign = entries.filter((e) => !e.mine)

  for (const r of appliesTo) {
    if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?$/.test(r)) err(`\`applies_to\` 의 \`${r}\` 가 레포 이름이 아니다`, '`<repo>` 나 `<owner>/<repo>` 다. 경로는 그 레포의 `.claude/adr-bindings.yml` 이 적는다.', R('adr-applies-to-invalid'))
  }
  // `applies_to` is the opt-in to bindings. An ADR is always schema 5, so the version cannot mark
  // the boundary; the field can. An ADR that has it and still names another repository's path
  // holds the same link in two places, and the upstream copy is the one nothing checks.
  if (foreign.length && appliesTo.length) {
    err(`\`applies_to\` 를 쓰는데 \`scope\` 가 다른 레포의 경로를 짚는다 — ${foreign.map((e) => `${e.repo}:${e.path}`).join(' · ')}`,
      '경로는 그 레포의 `.claude/adr-bindings.yml` 로 옮긴다. 여기 남기면 아무도 검사하지 않는 사본이 된다.', R('adr-scope-foreign-with-applies-to'))
  } else if (foreign.length && live) {
    warn(`\`scope\` 가 다른 레포의 경로를 짚는다 — ${foreign.map((e) => `${e.repo}:${e.path}`).join(' · ')}`,
      '이 레포는 그 경로를 볼 수 없고, 경로를 바꾸는 사람은 저쪽 레포에 있다. `applies_to: [<repo>]` 로 레포만 적고, 경로와 confirms 는 그 레포의 `.claude/adr-bindings.yml` 로 옮긴다 — `pull-adr.mjs` 가 뼈대를 출력한다.', R('adr-scope-foreign'))
  }
  if (foreign.length && !seam?.self) {
    push('info', `\`scope\` 가 다른 레포를 짚는데 프로필에 \`repo\` 가 없다 — ${foreign.map((e) => e.repo).join(' · ')}`,
      '`repo: <이 레포 이름>` 을 프로필에 적으면 「내 자리」와 「남의 자리」를 갈라 본다. 없으면 접두 붙은 항목을 전부 남의 것으로 읽는다.')
  }

  // A decision that reaches code through `applies_to` has its paths and tests in the other
  // repository's bindings, so an empty `scope` and `confirms` here is the expected shape.
  const viaBindings = appliesTo.length > 0 && !mine.length
  if (live && !scope.length && !appliesTo.length) {
    warn('`scope` 가 비었다', '이 결정이 제약하는 코드 자리다. 비우면 task-brief 가 구현 에이전트에게 못 싣고 확인 드리프트 검사도 안 돈다 — 결정이 코드에 닿지 않는다. 코드가 다른 레포에 있으면 `applies_to` 다.', R('adr-scope-empty'))
  }
  if (live && !confirms.length && !viaBindings) {
    warn('`confirms` 가 비었다', '지켜졌는지 무엇으로 판정하나. 식이나 fixture 를 옮겨 적지 말고 어느 테스트가 정본인지를 가리킨다.', R('adr-confirms-empty'))
  }
  if (confirms.length && viaBindings) {
    warn('`confirms` 를 이 레포에서 대조할 곳이 없다', '테스트는 코드가 있는 레포에 있다. 그 레포의 `.claude/adr-bindings.yml` 에 `confirms` 로 옮긴다.', R('adr-confirms-unplaced'))
  }

  // The path check stands on its own. It once ran only when `confirms` was non-empty, so an ADR
  // with a scope and no confirms kept pointing at a deleted directory with nothing said.
  // A path absent now and never in this branch's history is where code is still to be written —
  // the «ADR first» rule accepts the decision before the plan that creates it — so it is a note, and
  // the note says the checks that need the path did not run. `confirms_in` names where else the
  // confirming test is looked for; it is read by this lookup and nothing else, so a test tree named
  // there does not widen what the decision is injected into or which plans must pin it.
  if (seam?.root && (mine.length || confirmsIn.length)) {
    const where = []
    for (const [key, path] of [...mine.map((e) => ['scope', e.path]), ...confirmsIn.map((p) => ['confirms_in', p])]) {
      const p = resolve(seam.root, path)
      if (existsSync(p)) { where.push(p); continue }
      const past = pathPast(seam.root, path)
      if (past.state === 'never') {
        // check-artifacts prints a note without its hint, so what did not run is in the message.
        push('info', `\`${key}\` 의 \`${path}\` 가 아직 없다 — git 이력에도 없던 경로라 만들어질 자리로 읽었다. 그 경로의 검사${confirms.length ? '와 그 안의 confirms 찾기' : ''}는 돌지 않았다 — 경로가 생기면 돈다`)
      } else if (key === 'scope') {
        warn(`\`scope\` 의 \`${path}\` 가 없다`, '경로가 바뀌었거나 지워졌다. 결정이 제약하던 자리가 사라졌으면 이 ADR 이 아직 유효한지 본다.' + pastUnknown(past), R('adr-scope-missing-path'))
      } else {
        warn(`\`confirms_in\` 의 \`${path}\` 가 없다`, '테스트 자리가 옮겨졌거나 지워졌다. `confirms_in` 을 고친다.' + pastUnknown(past), R('adr-confirms-in-missing-path'))
      }
    }
    const inWhat = confirmsIn.length ? 'scope · confirms_in' : 'scope'
    const found = confirms.length && where.length ? lookFor(confirms, where) : null
    for (const c of found?.searched ? found.missing : []) {
      if (found.cut) {
        warn(`\`confirms\` 의 «${c}» 를 ${inWhat} 안에서 찾다가 멈췄다 — 경로마다 파일 ${SEARCH_BUDGET}개까지만 읽는다`, '없다는 뜻이 아니다 — 다 읽지 못했다. 테스트가 있는 자리를 `confirms_in` 에 좁게 적으면 그 자리는 따로 읽는다.', R('adr-confirms-search-cut'))
      } else {
        warn(`\`confirms\` 의 «${c}» 를 ${inWhat} 안에서 못 찾았다`, '테스트 이름이 바뀌었거나 사라졌다. 결정이 아직 지켜지는지 확인하고, 이름만 바뀐 것이면 confirms 를 고친다. 테스트가 scope 밖에 있으면 그 자리를 `confirms_in` 에 적는다.', R('adr-confirms-not-found'))
      }
    }
  }

  // Fenced blocks and code spans are code, and `Result<Blob, StoreError>` in a decision is the
  // signature it settles, not a `<placeholder>` left from the template. `outsideCode` keeps a span
  // that opens with `<`, which is how the template quotes its own placeholders.
  const body = outsideCode(stripComments(doc.lines.filter((_, i) => doc.live[i]).join('\n')))
  for (const re of RESIDUE) {
    const m = re.exec(body)
    if (m) { err(`템플릿 자국이 남았다 — \`${m[0].slice(0, 40)}\``, '안내 주석과 placeholder 를 전부 지운다.', R('adr-template-residue')); break }
  }
  if (/<!--/.test(doc.text) && status !== 'draft') {
    warn('안내 주석이 남았다', '제출 전 지운다.', R('adr-comment-left'))
  }
}


const PIN = /^(?:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)#)?(?<id>ADR-\d{3,4})(?:@(?<sha>[0-9a-f]{7,40}))?$/

/** A set that has finished — a completed plan, or a set someone replaced or turned down — is a
 *  record of work done under the decisions in force at the time. Judging it against today's
 *  decisions turns history red the day an ADR it pinned is superseded, and `check-all` walks every
 *  set, so CI fails on a change nobody can make: the set is not to be rewritten.
 *
 *  «Closed» alone cannot excuse a pin, though. The edit that writes `completed` is checked with
 *  `completed` already in it, so a set closed on top of a dead decision would pass the one check
 *  meant to stop it. What decides is the decision's status at the commit that closed the set,
 *  read from git. An uncommitted closing edit, or a history too shallow to show the commit, yields
 *  nothing, and the caller then judges as if the set were open. */
const CLOSED = ['completed', 'superseded', 'rejected']
const git = (cwd, args) => {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null }
}
export function closedHistory(docs, seam) {
  const d = [docs.plan, docs.intent].find((x) => x?.path && CLOSED.includes(String(x.fm?.status ?? '')))
  if (!d) return null
  const top = git(dirname(d.path), ['rev-parse', '--show-toplevel'])?.trim()
  if (!top) return { closed: true, commit: null }
  // git answers with the resolved path; a checkout reached through a symlink (macOS /var →
  // /private/var) would otherwise yield `../..` paths that name nothing in any commit.
  const real = (p) => { try { return realpathSync(p) } catch { return p } }
  const relTo = (p) => relative(top, real(p))
  const rel = relTo(d.path)
  const statusIn = (h, p) => { const t = git(top, ['show', `${h}:${p}`]); return t == null ? null : t }
  let commit = null
  let wasClosed = false
  for (const h of (git(top, ['log', '--format=%H', '--reverse', '--', rel]) ?? '').split('\n').filter(Boolean)) {
    const t = statusIn(h, rel)
    const now = !!t && CLOSED.includes(String(frontmatter(t)?.status ?? ''))
    if (now && !wasClosed) commit = h
    wasClosed = now
  }
  // The working tree must agree with the last commit: a set closed in history but reopened since is
  // open, and a set closed only in the working tree has not been through CI yet.
  if (!wasClosed) commit = null
  const manifestAt = (() => {
    if (!commit || !seam?.manifest) return null
    try { return JSON.parse(statusIn(commit, relTo(seam.manifest)) ?? 'null') } catch { return null }
  })()
  /** The decision's status when the set closed, or null when that cannot be read. */
  const statusAt = (id, adrPath) => {
    if (!commit) return null
    if (adrPath) {
      const t = statusIn(commit, relTo(adrPath))
      if (t == null) return null
      const fm = frontmatter(t)
      return (fm ? String(fm.status ?? '') : legacyMeta({ text: t }).status) || null
    }
    return String(manifestAt?.decisions?.find((x) => String(x.id) === id)?.status ?? '') || null
  }
  return { closed: true, commit, statusAt }
}

/** Reading the history costs a `git log` and a `git show` per commit that touched the plan — half a
 *  second on a plan with a dozen commits, paid for every set `check-all` walks. Most sets never need
 *  it: an open set, or a closed one whose pins are all live and whose tasks meet no unpinned
 *  decision, is judged the same with or without it. So it is read only when a verdict turns on it,
 *  and once per document set: `checkPins` and `checkTaskScope` see the same `docs`. Computing it up
 *  front in the caller was rejected — the caller cannot know whether a dead pin is coming. */
const histories = new WeakMap()
const historyOf = (docs, seam) => {
  if (!histories.has(docs)) histories.set(docs, closedHistory(docs, seam))
  return histories.get(docs)
}

/** The ID spaces a pin can name. With only `adr_dir` or only `adr_repo` there is one, and every pin
 *  reads against it as it always did. With both there are two, and they overlap — `ADR-005` here
 *  and `ADR-005` upstream are different decisions — so a pin is read by its form: bare means this
 *  repository's folder, `<owner>/<repo>#` the manifest's repository (or this repository, when it
 *  names `repo`). Reducing a pin to its bare ID, as every caller once did, let a local pin satisfy
 *  an upstream requirement and checked an upstream pin against the local folder. */
function idSpaces(seam) {
  const localDocs = seam.dir ? loadAdrDir(seam.dir).docs : []
  const manifest = seam.repo ? loadManifest(seam.manifest) : null
  const dual = !!(seam.dir && seam.repo)
  const local = {
    byId: new Map(localDocs.map((d) => [String(d.fm?.id ?? ''), { status: String(d.fm?.status ?? ''), superseded_by: d.fm?.superseded_by, path: d.path }])),
    have: localDocs.length > 0,
    where: seam.dir ? relative(seam.root ?? '', seam.dir) : '',
  }
  const up = {
    byId: new Map((manifest?.decisions ?? []).map((d) => [String(d.id), { status: String(d.status ?? ''), superseded_by: d.superseded_by }])),
    have: manifest != null,
    where: manifest?.source ?? '매니페스트',
  }
  const upRepo = manifest?.source ?? seam.repo
  /** 'local' · 'up' · null (a repository this one knows nothing of). `explicit` is whether the
   *  prefix itself named the space, which turns a missing ID into an error rather than a shape check. */
  const spaceOf = (g) => {
    const prefix = g.repo ? `${g.owner}/${g.repo}` : null
    const toUp = !!prefix && !!upRepo && sameRepo(prefix, upRepo)
    if (!dual) return { space: seam.dir ? 'local' : 'up', explicit: toUp && !!manifest?.source }
    if (!prefix) return { space: 'local', explicit: true }
    if (toUp) return { space: 'up', explicit: true }
    if (seam.self && sameRepo(prefix, seam.self)) return { space: 'local', explicit: true }
    return { space: null, explicit: false }
  }
  const keyOf = (g) => {
    const s = spaceOf(g).space
    return s ? `${s}:${g.id}` : `${g.owner}/${g.repo}#${g.id}`
  }
  return { local, up, manifest, dual, upRepo, spaceOf, keyOf }
}
const pinKeys = (ids, docs) => new Set(Object.values(docs)
  .flatMap((d) => [].concat(d.fm?.decisions ?? []).map(String))
  .map((p) => PIN.exec(p.trim())?.groups).filter(Boolean).map(ids.keyOf))

/** The decisions that replaced the one under `key`, nearest first, following `superseded_by` through
 *  every decision that is itself `superseded`; `{ space, ids }`, or null when the key's space is
 *  unknown. `superseded_by` is read and `supersedes` is not: the retired decision must name its
 *  successor (`superseded-by-missing` is an error) and that edit goes through the approval dialog,
 *  while `supersedes` is optional and written by the successor — a draft claiming to replace a
 *  decision still in force would otherwise excuse citing it. It is also the one field the upstream
 *  manifest has always carried, so the same walk serves both spaces with no manifest change, and an
 *  old manifest reads the same. When the two disagree, `adr-supersede-unreciprocated` warns on the
 *  folder. Only bare IDs are followed: a successor written `<owner>/<repo>#ADR-NNN` lives in another
 *  space, and the chain does not cross spaces. */
function successorsOf(ids, key) {
  const at = key.indexOf(':')
  const space = at > 0 ? key.slice(0, at) : null
  const src = space ? ids[space] : null
  if (!src?.byId) return null
  const out = []
  const seen = new Set([key.slice(at + 1)])
  const walk = (id) => {
    const t = src.byId.get(id)
    if (!t || t.status !== 'superseded') return
    for (const n of [].concat(t.superseded_by ?? []).map((v) => String(v).trim()).filter((v) => /^ADR-\d{3,4}$/.test(v))) {
      if (seen.has(n)) continue
      seen.add(n); out.push(n); walk(n)
    }
  }
  walk(key.slice(at + 1))
  return { space, ids: out }
}

export function checkPins(docs, { seam }, push) {
  if (!seam?.configured) return
  const ids = idSpaces(seam)

  for (const d of Object.values(docs)) {
    const pins = [].concat(d.fm?.decisions ?? []).map(String).filter((v) => !isNull(v))
    const err = (m, h, rule) => push('error', d.name, m, h, rule)
    const warn = (m, h, rule) => push('warn', d.name, m, h, rule)

    for (const raw of pins) {
      const m = PIN.exec(raw.trim())
      if (!m) { err(`\`decisions: ${raw}\` 를 읽을 수 없다`, '같은 레포면 `ADR-005`, 다른 레포면 `<owner>/<repo>#ADR-005@<sha>` 다.', R('decision-pin-unreadable')); continue }
      // A pin into the repository the manifest came from is checked against it. Only a pin into a
      // repository this one has no manifest for is left at the SHA-shape check.
      const { space, explicit } = ids.spaceOf(m.groups)
      const src = space ? ids[space] : null
      if (m.groups.repo && (!src || (!src.byId.has(m.groups.id) && !explicit))) {
        if (!m.groups.sha) warn(`\`${raw}\` 에 SHA 가 없다`, '다른 레포의 결정은 움직인다. `@<sha>` 로 고정해야 나중에 무엇을 읽고 정했는지 되짚을 수 있다.', R('decision-pin-sha-missing'))
        continue
      }
      if (!src.have) continue
      const target = src.byId.get(m.groups.id)
      if (!target) { err(`핀한 ${m.groups.id} 가 없다`, `${src.where} 에서 못 찾았다. 오타이거나, 소비 레포라면 매니페스트가 낡았다.`, R('decision-pin-unknown')); continue }
      const st = String(target.status ?? '')
      const history = ADR_DEAD.includes(st) ? historyOf(docs, seam) : null
      const then = history ? history.statusAt(m.groups.id, target.path) : null
      if (ADR_DEAD.includes(st) && then && !ADR_DEAD.includes(then)) {
        push('info', d.name, `끝난 세트가 핀한 ${m.groups.id} 는 세트를 닫은 ${history.commit.slice(0, 7)} 에서 \`${then}\` 였고 그 뒤 \`${st}\` 가 됐다${st === 'superseded' && target.superseded_by ? ` (→ ${target.superseded_by})` : ''}`,
          '이 세트는 그 결정 아래에서 끝났다. 이어 가는 작업은 새 세트를 쓰고 효력 있는 결정을 핀한다.')
      } else if (ADR_DEAD.includes(st)) {
        const why = !history ? ''
          : then ? ` 세트를 닫은 ${history.commit.slice(0, 7)} 에서 이미 \`${then}\` 였다 — 효력 없는 결정 위에서 끝낸 세트다.`
          : history.commit ? ' 세트를 닫을 때의 상태를 git 에서 읽지 못했다 — 그때 효력이 있었는지 모르므로 오류로 둔다.'
          : ' 세트를 닫는 변경이 아직 커밋되지 않았거나 git 이력이 얕다(CI 는 fetch-depth: 0) — 닫은 시점을 모르므로 오류로 둔다.'
        err(`핀한 ${m.groups.id} 의 상태가 \`${st}\` 다`,
          (st === 'superseded' ? `${target.superseded_by ?? '후속 ADR'} 이 대체했다. 그쪽을 읽고 이 산출물 세트가 여전히 유효한지 확인한 뒤 핀을 옮긴다.`
                               : '효력이 없는 결정을 전제하고 있다. 이 산출물 세트가 여전히 유효한지 확인한다.') + why, R('pin-dead'))
      } else if (['draft', 'in_review'].includes(st)) {
        warn(`핀한 ${m.groups.id} 가 아직 \`${st}\` 다`, '승인 안 된 결정을 전제하고 구현하면, 결정이 바뀔 때 산출물 세트 전체의 추적 관계가 어긋난다.', R('decision-pin-unaccepted'))
      }
    }

    // A mention is read as a pin of the same form would be: with two ID spaces a bare `ADR-005` in
    // prose is this repository's, and the upstream one is written `<owner>/<repo>#ADR-005`. Reading a
    // bare mention as «either» was rejected — it lets an upstream pin silence a local citation, the
    // same conflation the pin check refuses.
    // A waiver's basis justifies an opt-out and is not the document resting on anything it names, as
    // the ID-reference scan in check-artifacts already reads it. The rest of the frontmatter stays
    // in: `decisions:` only names what is pinned, and `title` or `generated_from` naming a decision
    // is the writer citing it.
    const pinned = pinKeys(ids, { d })
    const waiving = waiveLines(d.lines)
    const text = stripComments(d.lines.map((l, i) => (waiving.has(i) ? '' : l)).join('\n'))
    const mentioned = new Map([...text.matchAll(/(?:\b(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)#)?\b(?<id>ADR-\d{3,4})\b/g)]
      .map((x) => [ids.keyOf(ids.dual ? x.groups : { id: x.groups.id }), ids.dual ? x[0] : x.groups.id]))
    for (const [key, shown] of mentioned) {
      if (pinned.has(key)) continue
      // Naming the decision a change migrates away from is history, not reliance, once the document
      // pins what replaced it: the pin's status is watched, and the old one cannot come back into
      // force without its successor going through the same approval. Without this the migration
      // sentence could not be written — unpinned it warns, pinned it is a dead pin.
      const succ = successorsOf(ids, key)
      if (succ?.ids.some((n) => pinned.has(`${succ.space}:${n}`))) continue
      const showUp = (n) => (succ?.space === 'up' && ids.dual ? `${ids.upRepo}#${n}` : n)
      const live = succ?.ids.find((n) => ids[succ.space].byId.get(n)?.status === 'accepted')
      const replaced = succ?.ids.length
        ? ` ${shown} 는 ${showUp(succ.ids[0])} 가 대체했다${live && live !== succ.ids[0] ? ` — 지금 효력은 ${showUp(live)}` : ''}. 대체한 결정을 \`decisions:\` 에 핀하면 이 언급은 그 결정의 이력으로 읽힌다 — 대체된 결정을 핀하는 것은 오류다.`
        : ''
      warn(`본문이 ${shown} 를 부르는데 \`decisions:\` 에 없다`, '핀이 있어야 검사기가 그 결정의 상태를 본다 — 대체된 결정을 인용한 채로 도는 것을 산문만으로는 아무도 못 잡는다.' + replaced +
        (ids.dual && !shown.includes('#') ? ` 앞에 레포가 없는 ID 는 이 레포의 ${ids.local.where} 로 읽는다 — ${ids.upRepo} 의 결정이면 \`${ids.upRepo}#${shown}\` 로 쓴다.` : ''), R('adr-mention-unpinned'))
    }
  }
}

/** A plan whose tasks touch code an accepted ADR constrains must pin that ADR. `task-brief` does
 *  inject the decision into the writer prompt, but design is settled in the plan before any task
 *  runs — a `TD-*` written without reading the decision is where a settled debate reopens. The pin
 *  is the only evidence the plan saw it, and the only handle the status check has. A warning, not
 *  an error: CI runs `--strict`, and a chain written before this rule should not go red on a hook. */
export function checkTaskScope(docs, { seam }, push) {
  if (!seam?.configured || !docs.plan) return
  const wps = [...docs.plan.ents.values()].filter((e) => e.kind === 'wp')
  if (!wps.length) return
  const ids = idSpaces(seam)
  const pinned = pinKeys(ids, docs)
  const local = seam.dir ? loadAdrDir(seam.dir).docs : []
  const manifest = ids.manifest
  if (!local.length && !manifest) return
  // Across repositories the paths are this repository's bindings, not the decision's scope.
  // Without a bindings file nothing matches here; `adr-bindings.mjs` is what says so, per decision.
  // With both keys set both sources are matched, each under its own key, so a local pin of
  // `ADR-005` cannot stand in for the upstream `ADR-005` a task also touches.
  const bindings = manifest ? loadBindings(seam.bindings) : null
  const byAdr = new Map()
  for (const w of wps) {
    const files = wpFiles(w)
    const hits = [
      ...adrsForFiles(local, files, seam.self).map((d) => ({ space: 'local', id: String(d.fm?.id ?? d.name), title: String(d.fm?.title ?? ''), path: d.path })),
      ...boundForFiles(manifest, bindings, files).map((d) => ({ space: 'up', id: String(d.id), title: String(d.title ?? '') })),
    ]
    for (const a of hits) {
      const key = `${a.space}:${a.id}`
      if (pinned.has(key)) continue
      ;(byAdr.get(key) ?? byAdr.set(key, { ...a, wps: [] }).get(key)).wps.push(w.id)
    }
  }
  // A closed plan's files meeting a decision that was not yet in force when the set closed is code
  // that predates the decision, not a plan that skipped it. Only that case becomes a note: a
  // decision already in force at closing was there to be read, and the warning stands.
  const history = byAdr.size ? historyOf(docs, seam) : null
  // With two ID spaces the upstream decision is named with its repository, or two warnings about
  // «ADR-005» would read as one decision said twice.
  const shown = (a) => a.space === 'up' && ids.dual ? `${manifest.source ?? ids.upRepo}#${a.id}` : a.id
  for (const [key, a] of [...byAdr]) {
    const then = history?.commit ? history.statusAt(a.id, a.path) : null
    if (history?.commit && then !== 'accepted') {
      push('info', 'plan.md', `${a.wps.join('·')} 의 files 가 ${shown(a)} 의 범위에 들지만, 세트를 닫은 ${history.commit.slice(0, 7)} 에서 그 결정은 ${then ? `\`${then}\` 였다` : '없었다'}`,
        '끝난 계획보다 뒤에 선 결정이다. 이 코드를 다시 고치는 새 세트가 그 결정을 핀한다.')
      byAdr.delete(key)
    }
  }
  for (const a of byAdr.values()) {
    // A decision in another repository moves; the pin form there carries the commit it was read at.
    const isLocal = a.space === 'local'
    const pin = isLocal ? `"${a.id}"` : `"${manifest.source ?? '<owner>/<repo>'}#${a.id}@<sha>"`
    push('warn', 'plan.md', `${a.wps.join('·')} 의 files 가 ${shown(a)}(«${a.title}») 의 ${isLocal ? 'scope' : '바인딩 paths'} 를 만지는데 \`decisions:\` 에 없다`,
      `결정을 읽고 그 안에서 설계했으면 \`decisions: [${pin}]\` 로 핀한다 — 핀이 있어야 검사기가 그 결정의 상태를 보고, 대체된 결정 위에 선 계획을 잡는다. 결정에서 벗어나는 설계면 TD-* 에 적지 말고 그 ADR 을 대체하는 새 ADR 을 먼저 쓴다.`, R('task-adr-unpinned'))
  }
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

/** `self` is the profile's `repo`. A scope entry may be written `acme/quota:src/storage`; `checkAdr`
 *  reads that entry as this repository's through `scopeEntry`, so this must too — otherwise the
 *  confirms check sees the decision and the task-scope check does not, on the same line. */
export function adrsForFiles(adrDocs, files, self = null) {
  return adrDocs.filter((d) => String(d.fm?.status ?? '') === 'accepted')
    .filter((d) => [].concat(d.fm?.scope ?? []).map(String).filter((v) => !isNull(v))
      .map((s) => scopeEntry(s, self)).filter((e) => e.mine)
      .some((e) => files.some((f) => touches(e.path, f))))
}
