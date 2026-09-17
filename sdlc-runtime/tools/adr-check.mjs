import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { ADR_FILENAME, idsIn, stripComments, isNull, loadAdrDir, wpFiles } from './artifact-parse.mjs'
import { SECTION, CHOSEN, hasAlias, canonical, ADR_STATUS_ALIASES, LEGACY_STATUS_ROW } from './keywords.mjs'
import { locale } from './locale.mjs'
const CHOSEN_RE = new RegExp(`\\((?:${CHOSEN.join('|')})\\)`, 'i')

export const ADR_STATUS = ['draft', 'in_review', 'accepted', 'deprecated', 'superseded', 'rejected']
export const ADR_DEAD = ['deprecated', 'superseded', 'rejected']
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

export function adrSeam(repoRoot) {
  const path = repoRoot && resolve(repoRoot, '.claude/spec-profile.yml')
  if (!path || !existsSync(path)) return { configured: false }
  const text = readFileSync(path, 'utf8')
  const yml = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(text)?.[1] ?? '')
    .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
  const dir = yml('adr_dir')
  const repo = yml('adr_repo')
  const manifest = yml('adr_manifest') || (repo && !dir ? '.claude/adr-manifest.json' : '')
  if (!dir && !repo) return { configured: false, self: yml('repo') || null }
  return {
    configured: true,
    root: repoRoot,
    self: yml('repo') || null,
    dir: dir ? resolve(repoRoot, dir) : null,
    repo: repo || null,
    manifest: manifest ? resolve(repoRoot, manifest) : null,
    index: yml('adr_index') ? resolve(repoRoot, yml('adr_index')) : (dir ? resolve(repoRoot, dir, 'index.md') : null),
  }
}

export function scopeEntry(raw, self) {
  const s = String(raw).trim()
  const m = /^([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?):(.+)$/.exec(s)
  if (!m) return { repo: null, path: s, mine: true }
  const tail = (x) => String(x).split('/').pop()
  return { repo: m[1], path: m[2].trim(), mine: !!self && tail(m[1]) === tail(self) }
}

export function loadManifest(path) {
  if (!path || !existsSync(path)) return null
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(j?.decisions) ? j : null
  } catch { return null }
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
  const err = (m, h) => push('error', m, h)
  const warn = (m, h) => push('warn', m, h)

  const nm = ADR_FILENAME.exec(doc.name)
  if (!nm) {
    err(`파일 이름이 규칙과 다르다 — ${doc.name}`, 'ADR-{세 자리}-{kebab-slug}.md 다. 이름이 번호를 물어야 «ADR-007» 이 한 문서를 가리킨다.')
  }
  if (!/^---\r?\n/.test(doc.text)) {
    if (!legacyMeta(doc).status) err('Unknown legacy ADR status', 'Use a Status/상태 table row with a supported status value.')
    push('info', '프런트매터가 없는 옛 문서다 — 이름과 번호·상태 해석만 검사했다',
      '새 계약으로 옮기려면 프런트매터(artifact · id · status · scope · confirms)를 더한다. ' +
      '그 전까지 이 결정은 승인 가드가 지키지 않고, 산출물 세트가 핀해도 상태를 못 본다.')
    return
  }

  if (nm) {
    const want = `ADR-${nm[1]}`
    if (String(fm.id ?? '') !== want) err(`파일 이름의 번호와 id 가 다르다 — 이름 ${want} · id ${fm.id ?? '(없음)'}`, '둘 중 어느 쪽이 맞는지 정하고 맞춘다. 번호는 재사용하지 않는다.')
    const dup = siblings.filter((s) => s !== doc && String(s.fm?.id ?? '') === want)
    if (dup.length) err(`${want} 번호를 ${dup.length + 1}개 문서가 쓴다 — ${[doc, ...dup].map((s) => s.name).join(' · ')}`, '번호는 단조 증가하고 재사용하지 않는다. 뒤에 쓴 것에 새 번호를 준다.')
  }

  if (String(fm.artifact ?? '') !== 'adr') err('`artifact: adr` 이 아니다', '이 값으로 검사기가 ADR 을 가려낸다.')
  if (Number(fm.schema_version) !== 5) err(`schema_version 이 ${fm.schema_version ?? '(없음)'} 다`, 'ADR 은 언제나 5 다 — 산출물 세트의 버전과 별개다(references/schema.md).')
  for (const k of ['id', 'title', 'status', 'generated_by']) {
    if (isNull(fm[k])) err(`\`${k}\` 가 비었다`)
  }
  const status = String(fm.status ?? '')
  if (status && !ADR_STATUS.includes(status)) {
    err(`status 가 \`${status}\` 다`, `허용값: ${ADR_STATUS.join(' · ')}. 산출물 상태값을 그대로 쓴다 — 모르는 값이면 승인 가드가 상태 전이를 못 본다.`)
  }

  if (status === 'accepted') {
    if (isNull(fm.approved_by)) err('accepted 인데 `approved_by` 가 비었다', '승인은 사람이 한다. 가드가 그 편집을 다이얼로그로 보낸다.')
    else if (String(fm.approved_by) === String(fm.generated_by)) err('`approved_by` 와 `generated_by` 가 같다', '쓴 쪽이 승인하면 관문이 아니라 자기선언이다.')
  }
  if (status === 'superseded' && isNull(fm.superseded_by)) {
    err('superseded 인데 `superseded_by` 가 없다', '무엇이 대체했는지 없으면 결정의 변경 이력을 추적할 수 없다.')
  }
  for (const [k, other] of [['superseded_by', 'supersedes'], ['supersedes', 'superseded_by']]) {
    for (const ref of [].concat(fm[k] ?? []).filter((v) => !isNull(v))) {
      const target = siblings.find((s) => String(s.fm?.id ?? '') === String(ref))
      if (!target) { warn(`\`${k}: ${ref}\` 가 이 폴더에 없다`, '다른 레포의 결정이면 그대로 두고, 오타면 고친다.'); continue }
      const back = [].concat(target.fm?.[other] ?? []).map(String)
      if (!back.includes(String(fm.id))) warn(`${ref} 의 \`${other}\` 에 ${fm.id} 가 없다`, '대체 관계는 양쪽에 적어야 어느 쪽에서 읽어도 추적 관계가 이어진다.')
    }
  }

  const found = Object.fromEntries(SECTION_KEYS.map((k, i) => [SECTIONS[i], sectionText(doc, titleIn(doc, k))]))
  for (const t of SECTIONS) {
    if (found[t]) continue
    if (t === '확인과 재검토' && ['draft', 'in_review', 'rejected'].includes(status)) continue
    err(`«${t}» 절이 없다`, `ADR 의 절은 다섯이고 지울 수 없다: ${SECTIONS.join(' · ')}`)
  }
  if (found['결정'] && !doc.hs.some((h) => h.depth === 3 && /^Non-goals$/i.test(h.title))) {
    warn('«결정» 에 `### Non-goals` 가 없다', '정하지 않는 것을 적지 않으면 스코프 논쟁이 나중에 다시 열린다. 이 목록은 구현 에이전트 프롬프트에 그대로 실린다.')
  }

  const alts = alternativesOf(doc)
  if (found['대안']) {
    if (alts.length < 2) err(`대안이 ${alts.length}개다`, '합리적인 대안이 실제로 있었다는 것이 ADR 의 전제다. 선택지가 없었으면 결정이 아니라 사실이고 spec 으로 간다.')
    const chosen = alts.filter((a) => a.chosen)
    if (status === 'accepted' && chosen.length !== 1) {
      err(`accepted 인데 «(채택)» 이 ${chosen.length}개다`, '채택안이 정확히 하나여야 이 문서가 무엇을 정했는지 기계도 사람도 읽는다.')
    } else if (chosen.length > 1) {
      err(`«(채택)» 이 ${chosen.length}개다 — ${chosen.map((c) => c.id).join(' · ')}`, '대안은 서로 배타적이다. 동시에 채택 가능하면 그건 대안이 아니라 조합이다.')
    }
  }

  if (found['결과'] && !['draft', 'rejected'].includes(status)) {
    if (!locale().tradeoff.test(found['결과'].text)) {
      err('«결과» 에 감수하는 제약이 없다', '얻는 것만 있는 결정은 없다. 무엇을 대가로 지불하기로 했는지 적는다 — 그 줄이 이 문서의 핵심 기록이다.')
    }
  }

  const asms = [...doc.ents.values()].filter((e) => e.id.startsWith('ASM-')).map((e) => e.id)
  const rvs = [...doc.ents.values()].filter((e) => e.id.startsWith('RV-')).map((e) => e.id)
  if (asms.length && !rvs.length) {
    warn(`전제 ${asms.length}개가 있는데 재검토 조건이 없다`, '전제가 무너지는 것이 곧 재검토 조건이다. RV-* 로 짝짓지 않으면 전제가 틀렸을 때 아무도 이 결정을 깨우지 않는다.')
  }
  const declared = [].concat(fm.revisit ?? []).map(String).filter((v) => !isNull(v))
  for (const id of declared) if (!rvs.includes(id)) warn(`\`revisit: ${id}\` 가 본문에 없다`, '«확인과 재검토» 에 `### RV-NNN — 조건` 으로 정의한다.')
  for (const id of rvs) if (declared.length && !declared.includes(id)) warn(`${id} 가 \`revisit:\` 에 없다`, '프런트매터가 기계가 읽는 목록이다 — 빠지면 finding 이 그 조건을 못 깨운다.')
  for (const rv of [...doc.ents.values()].filter((e) => e.id.startsWith('RV-'))) {
    if (locale().deadlineOnly.test(rv.title)) {
      warn(`${rv.title} 이 시한으로 쓰였다`, 'RV-* 는 참·거짓이 판정되는 조건이다. «6개월 뒤 재검토» 는 아무도 판정하지 않는다.')
    }
  }

  const scope = [].concat(fm.scope ?? []).map(String).filter((v) => !isNull(v))
  const confirms = [].concat(fm.confirms ?? []).map(String).filter((v) => !isNull(v))
  const live = !['draft', 'rejected', ...ADR_DEAD].includes(status)
  if (live && !scope.length) {
    warn('`scope` 가 비었다', '이 결정이 제약하는 코드 자리다. 비우면 task-brief 가 구현 에이전트에게 못 싣고 확인 드리프트 검사도 안 돈다 — 결정이 코드에 닿지 않는다.')
  }
  if (live && !confirms.length) {
    warn('`confirms` 가 비었다', '지켜졌는지 무엇으로 판정하나. 식이나 fixture 를 옮겨 적지 말고 어느 테스트가 정본인지를 가리킨다.')
  }

  const entries = scope.map((s) => scopeEntry(s, seam?.self))
  const mine = entries.filter((e) => e.mine)
  const foreign = entries.filter((e) => !e.mine)
  if (foreign.length && !seam?.self) {
    push('info', `\`scope\` 가 다른 레포를 짚는데 프로필에 \`repo\` 가 없다 — ${foreign.map((e) => e.repo).join(' · ')}`,
      '`repo: <이 레포 이름>` 을 프로필에 적으면 「내 자리」와 「남의 자리」를 갈라 본다. 없으면 접두 붙은 항목을 전부 남의 것으로 읽는다.')
  }
  if (seam?.root && mine.length && confirms.length) {
    const bodies = []
    for (const e of mine) {
      const p = resolve(seam.root, e.path)
      if (!existsSync(p)) { warn(`\`scope\` 의 \`${e.path}\` 가 없다`, '경로가 바뀌었거나 지워졌다. 결정이 제약하던 자리가 사라졌으면 이 ADR 이 아직 유효한지 본다.'); continue }
      collect(p, bodies)
    }
    const hay = bodies.join('\n')
    if (hay) {
      for (const c of confirms) {
        const needle = c.replace(/\s+/g, '')
        if (!hay.replace(/\s+/g, '').includes(needle)) {
          warn(`\`confirms\` 의 «${c}» 를 scope 안에서 못 찾았다`, '테스트 이름이 바뀌었거나 사라졌다. 결정이 아직 지켜지는지 확인하고, 이름만 바뀐 것이면 confirms 를 고친다.')
        }
      }
    }
  }

  const body = stripComments(doc.text)
  for (const re of RESIDUE) {
    const m = re.exec(body)
    if (m) { err(`템플릿 자국이 남았다 — \`${m[0].slice(0, 40)}\``, '안내 주석과 placeholder 를 전부 지운다.'); break }
  }
  if (/<!--/.test(doc.text) && status !== 'draft') {
    warn('안내 주석이 남았다', '제출 전 지운다.')
  }
}

function collect(path, out, budget = { files: 400 }) {
  if (budget.files <= 0) return
  let st
  try { st = statSync(path) } catch { return }
  if (st.isFile()) { budget.files--; try { out.push(readFileSync(path, 'utf8')) } catch {} ; return }
  if (!st.isDirectory()) return
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue
    collect(join(path, name), out, budget)
  }
}

const PIN = /^(?:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)#)?(?<id>ADR-\d{3,4})(?:@(?<sha>[0-9a-f]{7,40}))?$/

export function checkPins(docs, { seam }, push) {
  if (!seam?.configured) return
  const local = seam.dir ? loadAdrDir(seam.dir).docs : []
  const manifest = seam.dir ? null : loadManifest(seam.manifest)
  const byId = new Map(local.length
    ? local.map((d) => [String(d.fm?.id ?? ''), { status: String(d.fm?.status ?? ''), superseded_by: d.fm?.superseded_by }])
    : (manifest?.decisions ?? []).map((d) => [String(d.id), { status: String(d.status ?? ''), superseded_by: d.superseded_by }]))
  const haveSource = local.length > 0 || manifest != null

  for (const d of Object.values(docs)) {
    const pins = [].concat(d.fm?.decisions ?? []).map(String).filter((v) => !isNull(v))
    const err = (m, h) => push('error', d.name, m, h)
    const warn = (m, h) => push('warn', d.name, m, h)

    for (const raw of pins) {
      const m = PIN.exec(raw.trim())
      if (!m) { err(`\`decisions: ${raw}\` 를 읽을 수 없다`, '같은 레포면 `ADR-005`, 다른 레포면 `<owner>/<repo>#ADR-005@<sha>` 다.'); continue }
      if (m.groups.repo && !byId.has(m.groups.id)) {
        if (!m.groups.sha) warn(`\`${raw}\` 에 SHA 가 없다`, '다른 레포의 결정은 움직인다. `@<sha>` 로 고정해야 나중에 무엇을 읽고 정했는지 되짚을 수 있다.')
        continue
      }
      if (!haveSource) continue
      const target = byId.get(m.groups.id)
      if (!target) { err(`핀한 ${m.groups.id} 가 없다`, `${seam.dir ? relative(seam.root ?? '', seam.dir) : (manifest?.source ?? '매니페스트')} 에서 못 찾았다. 오타이거나, 소비 레포라면 매니페스트가 낡았다.`); continue }
      const st = String(target.status ?? '')
      if (ADR_DEAD.includes(st)) {
        err(`핀한 ${m.groups.id} 의 상태가 \`${st}\` 다`,
          st === 'superseded' ? `${target.superseded_by ?? '후속 ADR'} 이 대체했다. 그쪽을 읽고 이 산출물 세트가 여전히 유효한지 확인한 뒤 핀을 옮긴다.`
                              : '효력이 없는 결정을 전제하고 있다. 이 산출물 세트가 여전히 유효한지 확인한다.')
      } else if (['draft', 'in_review'].includes(st)) {
        warn(`핀한 ${m.groups.id} 가 아직 \`${st}\` 다`, '승인 안 된 결정을 전제하고 구현하면, 결정이 바뀔 때 산출물 세트 전체의 추적 관계가 어긋난다.')
      }
    }

    const pinned = new Set(pins.map((p) => PIN.exec(p.trim())?.groups?.id).filter(Boolean))
    const mentioned = new Set([...stripComments(d.text).matchAll(/\bADR-\d{3,4}\b/g)].map((x) => x[0]))
    for (const id of mentioned) {
      if (pinned.has(id)) continue
      warn(`본문이 ${id} 를 부르는데 \`decisions:\` 에 없다`, '핀이 있어야 검사기가 그 결정의 상태를 본다 — 대체된 결정을 인용한 채로 도는 것을 산문만으로는 아무도 못 잡는다.')
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
  const pinned = new Set(Object.values(docs)
    .flatMap((d) => [].concat(d.fm?.decisions ?? []).map(String))
    .map((p) => PIN.exec(p.trim())?.groups?.id).filter(Boolean))
  const local = seam.dir ? loadAdrDir(seam.dir).docs : null
  const manifest = seam.dir ? null : loadManifest(seam.manifest)
  if (!local?.length && !manifest) return
  const byAdr = new Map()
  for (const w of wps) {
    const files = wpFiles(w)
    const hits = local
      ? adrsForFiles(local, files, seam.self).map((d) => ({ id: String(d.fm?.id ?? d.name), title: String(d.fm?.title ?? '') }))
      : manifestForFiles(manifest, files, seam.self).map((d) => ({ id: String(d.id), title: String(d.title ?? '') }))
    for (const a of hits) {
      if (pinned.has(a.id)) continue
      ;(byAdr.get(a.id) ?? byAdr.set(a.id, { ...a, wps: [] }).get(a.id)).wps.push(w.id)
    }
  }
  for (const a of byAdr.values()) {
    // A decision in another repository moves; the pin form there carries the commit it was read at.
    const pin = local ? `"${a.id}"` : `"${manifest.source ?? '<owner>/<repo>'}#${a.id}@<sha>"`
    push('warn', 'plan.md', `${a.wps.join('·')} 의 files 가 ${a.id}(«${a.title}») 의 scope 를 만지는데 \`decisions:\` 에 없다`,
      `결정을 읽고 그 안에서 설계했으면 \`decisions: [${pin}]\` 로 핀한다 — 핀이 있어야 검사기가 그 결정의 상태를 보고, 대체된 결정 위에 선 계획을 잡는다. 결정에서 벗어나는 설계면 TD-* 에 적지 말고 그 ADR 을 대체하는 새 ADR 을 먼저 쓴다.`)
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
  const norm = (p) => String(p).replace(/^\.\//, '').replace(/\/+$/, '')
  const touches = (scope, file) => {
    const s = norm(scope), f = norm(file)
    return s === f || f.startsWith(s + '/') || s.startsWith(f + '/')
  }
  return adrDocs.filter((d) => String(d.fm?.status ?? '') === 'accepted')
    .filter((d) => [].concat(d.fm?.scope ?? []).map(String).filter((v) => !isNull(v))
      .map((s) => scopeEntry(s, self)).filter((e) => e.mine)
      .some((e) => files.some((f) => touches(e.path, f))))
}

export function checkManifestDrift(manifest, { root, self }, push) {
  if (!manifest) return
  for (const d of manifest.decisions ?? []) {
    if (ADR_DEAD.includes(String(d.status ?? ''))) continue
    const mine = (d.scope ?? []).map((s) => scopeEntry(s, self)).filter((e) => e.mine)
    if (!mine.length) continue
    const bodies = []
    let gone = false
    for (const e of mine) {
      const p = resolve(root, e.path)
      if (!existsSync(p)) {
        push('warn', `${d.id} 의 \`scope\` \`${e.path}\` 가 이 레포에 없다`,
          `${manifest.source ?? '소유 레포'} 의 결정이 제약하던 자리가 사라졌다. 그 결정이 아직 유효한지 보고, 아니면 그쪽에서 superseded 로 옮긴다.`)
        gone = true
        continue
      }
      collect(p, bodies)
    }
    if (gone || !bodies.length) continue
    const hay = bodies.join('\n').replace(/\s+/g, '')
    for (const c of d.confirms ?? []) {
      if (!hay.includes(String(c).replace(/\s+/g, ''))) {
        push('warn', `${d.id} 의 \`confirms\` «${c}» 를 이 레포에서 못 찾았다`,
          '그 결정이 지켜졌는지 판정할 테스트가 없다. 이름만 바뀐 것이면 소유 레포의 ADR 을 고치고 매니페스트를 다시 벤더한다.')
      }
    }
  }
}

export function manifestForFiles(manifest, files, self) {
  if (!manifest) return []
  const norm = (p) => String(p).replace(/^\.\//, '').replace(/\/+$/, '')
  const touches = (scope, file) => {
    const s = norm(scope), f = norm(file)
    return s === f || f.startsWith(s + '/') || s.startsWith(f + '/')
  }
  return (manifest.decisions ?? [])
    .filter((d) => String(d.status ?? '') === 'accepted')
    .filter((d) => (d.scope ?? []).map((s) => scopeEntry(s, self)).filter((e) => e.mine)
      .some((e) => files.some((f) => touches(e.path, f))))
}
