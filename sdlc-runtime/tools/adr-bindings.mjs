#!/usr/bin/env node
/** Bind decisions kept in another repository to this repository's code.
 *
 * Under `adr_repo` the link from a decision to code is cut in two. The document repository's ADR
 * names repositories (`applies_to`); this repository names paths and tests, in
 * `.claude/adr-bindings.yml`. The split follows who can check what: a path is verifiable only
 * where it lives, and the PR that renames it is the PR that must fix the link. Keeping the paths
 * upstream — the `repo:path` scope this replaces — left every rename owing a second PR in a
 * repository whose checker skips paths it does not own, so the link rotted with nothing noticing.
 *
 * What this repository needs of the decision itself arrives in `.claude/adr-manifest.json`,
 * written by `pull-adr.mjs` and never by hand: the integrity hash below turns an edit into an
 * error, for the same reason `upstream.lock.json` guards a vendored spec.
 *
 * Usage: node adr-bindings.mjs [<repo-root>] [--from <upstream-checkout>] [--strict] [--json] */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ADR_FILENAME, BODY_PIN, report, loadAdr } from './artifact-parse.mjs'
import { hashOf, headOf, findUpstream, sameRepo } from './upstream.mjs'
import { decisionHash, digestPin, appliesToOf } from './adr-text.mjs'
import { R, noteDrift } from './rules.mjs'

export const ADR_DEAD = ['deprecated', 'superseded', 'rejected']
export const MANIFEST_FILE = '.claude/adr-manifest.json'
export const BINDINGS_FILE = '.claude/adr-bindings.yml'

/** Where decisions live, from the profile. Lives here rather than in adr-check so this module
 *  stays a leaf: adr-check imports it, and a cycle deadlocks the CLI's top-level await. */
export function adrSeam(repoRoot) {
  const path = repoRoot && resolve(repoRoot, '.claude/spec-profile.yml')
  if (!path || !existsSync(path)) return { configured: false }
  const text = readFileSync(path, 'utf8')
  const yml = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(text)?.[1] ?? '')
    .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
  const dir = yml('adr_dir')
  const repo = yml('adr_repo')
  // The manifest defaults whenever `adr_repo` is set, as the bindings file does. It once defaulted
  // only without `adr_dir`, so a profile with both keys had no manifest unless it said so, and the
  // checker then quietly read only the local folder; a repository keeping its own decisions next to
  // an organisation's is the ordinary case, not one to opt into twice.
  const manifest = yml('adr_manifest') || (repo ? MANIFEST_FILE : '')
  if (!dir && !repo) return { configured: false, self: yml('repo') || null }
  return {
    configured: true,
    root: repoRoot,
    self: yml('repo') || null,
    dir: dir ? resolve(repoRoot, dir) : null,
    repo: repo || null,
    manifest: manifest ? resolve(repoRoot, manifest) : null,
    bindings: repo ? resolve(repoRoot, yml('adr_bindings') || BINDINGS_FILE) : null,
    index: yml('adr_index') ? resolve(repoRoot, yml('adr_index')) : (dir ? resolve(repoRoot, dir, 'index.md') : null),
  }
}

/** Hash of the decisions exactly as `pull-adr` serialised them. JSON.parse keeps key order, so a
 *  manifest nobody touched re-serialises to the same bytes. */
export const manifestIntegrity = (decisions) => hashOf(JSON.stringify(decisions ?? []))

/** `{ missing }`, `{ broken }`, or the manifest. `loadManifest` below folds the first two into
 *  null for callers that only ask «is there a list to match against». */
export function readManifest(path) {
  if (!path || !existsSync(path)) return { missing: true }
  let j
  try { j = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { return { broken: `JSON 을 읽을 수 없다 — ${e.message}` } }
  if (!j || !Array.isArray(j.decisions)) return { broken: '`decisions` 배열이 없다' }
  return { manifest: j }
}

export function loadManifest(path) {
  return readManifest(path).manifest ?? null
}

/** A deliberately small YAML reader, the same shape as the bands registry: fixed indentation,
 *  one ADR per key. Keyed by ID rather than a list of maps so a duplicate is a parse error, not
 *  two bindings that disagree. `paths` absent and `paths: []` differ on purpose — the first is a
 *  binding someone forgot to finish, the second an opt-out that must carry a `reason`. */
export function parseBindings(text) {
  const out = { source: null, bindings: {}, problems: [] }
  const bad = (line, msg) => out.problems.push({ line, msg })
  const strip = (s) => s.trim().replace(/^["']|["']$/g, '')
  const list = (v) => v.trim().replace(/^\[|\]$/g, '').split(',').map(strip).filter(Boolean)
  let inBindings = false
  let cur = null
  let listKey = null

  text.split(/\r?\n/).forEach((raw, i) => {
    // A trailing comment comes off the line before anything reads it. It once came off scalar values
    // and list items only, so `  ADR-004:   # title` — the line `pull-adr` prints in its skeleton —
    // was a parse error, and `paths: []   # …`, also from the skeleton, was read without complaint
    // as the one path `]`: an opt-out that never met the `reason` check. As before, a `#` after
    // whitespace starts a comment inside quotes too; this reader does not track quoting.
    const line = raw.replace(/(^|\s+)#.*$/, '').replace(/\s*$/, '')
    if (!line.trim()) return
    const indent = line.length - line.trimStart().length
    const body = line.trim()

    if (indent === 0) {
      cur = null; listKey = null
      inBindings = body === 'bindings:'
      if (inBindings) return
      const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(body)
      if (!m) return bad(i + 1, `최상위에서 \`키: 값\` 이 아니다: ${body}`)
      if (m[1] === 'source') out.source = strip(m[2]) || null
      else bad(i + 1, `모르는 최상위 키 \`${m[1]}\` — \`source\` 와 \`bindings\` 만 읽는다`)
      return
    }
    if (!inBindings) return bad(i + 1, `\`bindings:\` 밖의 들여쓴 줄: ${body}`)

    if (indent === 2) {
      listKey = null
      const m = /^(ADR-\d{3,4}):$/.exec(body)
      if (!m) return bad(i + 1, `바인딩은 \`  ADR-NNN:\` 한 줄로 연다: ${body}`)
      cur = m[1]
      if (out.bindings[cur]) bad(i + 1, `${cur} 이 두 번 바인딩됐다`)
      out.bindings[cur] = { id: cur, at: null, paths: null, confirms: [], confirms_in: [], reason: null, line: i + 1 }
      return
    }
    if (!cur) return bad(i + 1, `어느 바인딩에도 속하지 않은 줄: ${body}`)

    if (indent === 4) {
      listKey = null
      const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(body)
      if (!m) return bad(i + 1, `\`키: 값\` 이 아니다: ${body}`)
      const [, key, v] = m
      if (key === 'paths' || key === 'confirms' || key === 'confirms_in') {
        if (v.trim() === '') { out.bindings[cur][key] = []; listKey = key; return }
        if (!v.trim().startsWith('[')) return bad(i + 1, `\`${key}\` 는 목록이다: ${body}`)
        // Whatever cuts a list short — a comment inside the brackets, a list continued on the next
        // line — would otherwise leave a shorter list that reads as the whole one.
        if (!v.trim().endsWith(']')) return bad(i + 1, `\`${key}\` 의 \`[\` 가 같은 줄에서 닫히지 않았다: ${body}`)
        out.bindings[cur][key] = list(v)
        return
      }
      if (key === 'at' || key === 'reason') { out.bindings[cur][key] = strip(v) || null; return }
      return bad(i + 1, `모르는 키 \`${key}\` — at · paths · confirms · confirms_in · reason 만 읽는다`)
    }
    if (indent === 6 && listKey) {
      const m = /^-\s*(.*)$/.exec(body)
      if (!m) return bad(i + 1, `목록 항목은 \`- …\` 이다: ${body}`)
      out.bindings[cur][listKey].push(strip(m[1]))
      return
    }
    bad(i + 1, `들여쓰기를 읽을 수 없다(0·2·4·6 만 쓴다): ${body}`)
  })
  return out
}

export function loadBindings(path) {
  if (!path || !existsSync(path)) return null
  return parseBindings(readFileSync(path, 'utf8'))
}

const norm = (p) => String(p).replace(/^\.\//, '').replace(/\/+$/, '')
/** A scope and a file touch when either contains the other: a task on `src/vault/Pool.sol` is
 *  inside `src/vault`, and a task declaring the whole `src` still reaches it. */
export const touches = (scope, file) => {
  const s = norm(scope), f = norm(file)
  return s === f || f.startsWith(s + '/') || s.startsWith(f + '/')
}

/** Accepted decisions whose binding here touches one of `files`. The manifest supplies the
 *  decision and the binding the paths; neither alone can answer. */
export function boundForFiles(manifest, bindings, files) {
  if (!manifest || !bindings) return []
  return (manifest.decisions ?? [])
    .filter((d) => String(d.status ?? '') === 'accepted')
    .filter((d) => (bindings.bindings[String(d.id)]?.paths ?? []).some((p) => files.some((f) => touches(p, f))))
}

/** Files read per searched path. `cut` is set when the walk stopped with files still unread, so a
 *  name that was not found there can be reported as «not looked at», never as «missing». */
export const SEARCH_BUDGET = 400
export function collect(path, out, budget = { files: SEARCH_BUDGET }) {
  if (budget.files <= 0) { budget.cut = true; return }
  let st
  try { st = statSync(path) } catch { return }
  if (st.isFile()) { budget.files--; try { out.push(readFileSync(path, 'utf8')) } catch {} ; return }
  if (!st.isDirectory()) return
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue
    collect(join(path, name), out, budget)
  }
}

/** Look for `confirms` names under existing absolute paths, each path with its own budget as before.
 *  Raising the budget was rejected — any number is beaten by a broad enough scope, and the check
 *  would still read a cut-short walk as «not found». `git grep --untracked` was rejected too: it is
 *  fast and has no budget, but it needs a git checkout, and the whitespace-blind match a gate command
 *  needs (`npm test -- quota`) is not a pattern it takes. So the walk stays and says when it stopped.
 *  `searched` is false when nothing readable was found at all, which callers keep treating as before. */
export function lookFor(names, paths) {
  const bodies = []
  let cut = false
  for (const p of paths) { const budget = { files: SEARCH_BUDGET }; collect(p, bodies, budget); cut ||= !!budget.cut }
  const hay = bodies.join('\n').replace(/\s+/g, '')
  return { searched: !!hay, cut, missing: names.filter((c) => !hay.includes(String(c).replace(/\s+/g, ''))) }
}

/** Whether a path that is absent now was ever on this branch. The «ADR first» rule has a decision
 *  accepted before the directory it constrains is created, and a missing-path warning then keeps CI
 *  red until the code lands; the warning is meant for a path a rename or a deletion took away. Git
 *  tells the two apart. The history read is HEAD's — the commits CI has checked out. `--all` was
 *  rejected: it answers from whatever other branches a clone happened to fetch, so one commit could
 *  be judged differently on two machines, and a path that lived only on an abandoned branch was
 *  never part of this one. When the history cannot answer — not a repository, a shallow clone, no
 *  commit yet — the state is `unknown` and the caller keeps the warning: missing evidence does not
 *  buy the lenient reading. One `git rev-parse` per repository root, then one `git log` per missing
 *  path; a path that exists costs nothing. */
const pasts = new Map()
const gitIn = (root, args) => {
  try { return execFileSync('git', ['-C', root, '--literal-pathspecs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}
export function pathPast(root, rel) {
  if (!pasts.has(root)) {
    const shallow = gitIn(root, ['rev-parse', '--is-shallow-repository'])
    pasts.set(root, shallow == null ? 'git 저장소가 아니다' : shallow === 'true' ? '얕은 클론이다 — CI 는 fetch-depth: 0' : null)
  }
  const why = pasts.get(root)
  if (why) return { state: 'unknown', why }
  const h = gitIn(root, ['log', '-1', '--format=%H', 'HEAD', '--', rel])
  if (h == null) return { state: 'unknown', why: '커밋이 아직 없거나 git 이 그 경로를 읽지 못했다' }
  return h ? { state: 'gone', commit: h } : { state: 'never' }
}
/** The hint tail for a missing-path warning whose history could not be read. */
export const pastUnknown = (past) => past.state === 'unknown'
  ? ` git 이력을 읽지 못해(${past.why}) 아직 만들지 않은 경로인지 가리지 못했다 — 그래서 경고로 둔다.` : ''

/** Follow `superseded_by` from the given successors to the decision now in force. `lookup(id)` gives
 *  `{ status, superseded_by }` or null for an ID it cannot see (another repository's), and an unseen
 *  link says nothing either way. Returns null when some chain reaches an accepted decision or leaves
 *  sight, else the first chain that stops short — at a decision not in force, or in a loop. */
export function successorGap(lookup, start, refs) {
  const walk = (id, seen) => {
    if (seen.has(id)) return { chain: [...seen, id].slice(1), status: 'cycle' }
    const d = lookup(id)
    if (!d) return null
    const st = String(d.status ?? '')
    if (st === 'accepted') return null
    const next = [].concat(d.superseded_by ?? []).map(String).filter((v) => v && v !== 'null')
    const here = new Set([...seen, id])
    if (st !== 'superseded' || !next.length) return { chain: [...here].slice(1), status: st }
    const gaps = next.map((n) => walk(n, here))
    return gaps.some((g) => g == null) ? null : gaps[0]
  }
  const gaps = refs.map((r) => walk(String(r), new Set([String(start)])))
  return !gaps.length || gaps.some((g) => g == null) ? null : gaps[0]
}
/** «ADR-005(draft)», «ADR-005(superseded) → ADR-006(draft)», for a gap `successorGap` found. */
export const showGap = (gap, lookup) => gap.chain.map((id, i) =>
  `${id}(${i === gap.chain.length - 1 && gap.status === 'cycle' ? '순환' : lookup(id)?.status ?? '?'})`).join(' → ')

const appliesHere = (d, self) => !!self && [].concat(d.applies_to ?? []).some((r) => sameRepo(r, self))
/** Every check that needs a path runs here, in the repository that holds the path.
 *  push(level, doc, msg, hint, line?, rule?) — level is error · warn · info; error and warn carry a
 *  rule ID from rules.mjs. */
export function checkBindings({ root, seam, from = null }, push) {
  const mrel = relative(root, seam.manifest)
  const brel = relative(root, seam.bindings)
  const loaded = readManifest(seam.manifest)
  const bindings = loadBindings(seam.bindings)

  for (const p of bindings?.problems ?? []) push('error', brel, p.msg, null, p.line, R('bindings-parse'))

  if (loaded.missing) {
    push('warn', mrel, `결정 매니페스트가 없다 — ${seam.repo} 의 결정을 이 레포가 하나도 모른다`,
      `\`node <sdlc_runtime>/tools/pull-adr.mjs\` 로 끌어와 커밋한다. 그 전까지 핀의 상태 검사, 계획의 결정 누락 검사, 구현 에이전트 주입이 전부 꺼져 있다.`, undefined, R('manifest-missing'))
    return
  }
  if (loaded.broken) { push('error', mrel, `결정 매니페스트가 깨졌다 — ${loaded.broken}`, '`pull-adr.mjs` 로 다시 만든다.', undefined, R('manifest-broken')); return }
  const manifest = loaded.manifest
  if (manifest.integrity !== manifestIntegrity(manifest.decisions)) {
    push('error', mrel, '결정 매니페스트가 `pull-adr` 가 쓴 것과 다르다',
      `이 파일은 ${manifest.source ?? seam.repo} 의 ADR 에서 만든 사본이고 여기서는 읽기 전용이다. 결정을 고칠 일은 그쪽에서 하고 \`pull-adr.mjs\` 로 다시 끌어온다.`, undefined, R('manifest-modified'))
  }
  if (manifest.source && seam.repo && !sameRepo(manifest.source, seam.repo)) {
    push('error', mrel, `매니페스트의 출처(${manifest.source})가 프로필의 \`adr_repo\`(${seam.repo})와 다르다`, '결정이 사는 곳을 옮겼으면 다시 끌어온다.', undefined, R('manifest-source-mismatch'))
  }
  if (bindings?.source && manifest.source && !sameRepo(bindings.source, manifest.source)) {
    push('error', brel, `바인딩의 \`source\`(${bindings.source})가 매니페스트의 출처(${manifest.source})와 다르다`, '한 레포의 결정만 바인딩한다.', undefined, R('bindings-source-mismatch'))
  }

  const self = seam.self
  const byId = new Map((manifest.decisions ?? []).map((d) => [String(d.id), d]))
  const bound = bindings?.bindings ?? {}
  const later = []

  if (!self && (manifest.decisions ?? []).some((d) => [].concat(d.applies_to ?? []).length)) {
    push('info', brel, '프로필에 `repo` 가 없다 — 어느 결정이 이 레포에 적용되는지 `applies_to` 와 대조하지 못했다',
      '`repo: <이 레포 이름>` 을 적으면 바인딩이 빠진 결정을 경고한다.')
  }
  for (const d of manifest.decisions ?? []) {
    if (String(d.status ?? '') !== 'accepted' || !appliesHere(d, self) || bound[String(d.id)]) continue
    push('warn', brel, `${d.id}(«${d.title ?? ''}») 가 이 레포에 적용되는데 바인딩이 없다`,
      `결정이 제약하는 경로를 \`bindings:\` 에 적는다 — 그래야 계획과 구현 에이전트가 그 결정을 만난다. 이 레포에 닿는 코드가 없으면 \`paths: []\` 와 \`reason:\` 으로 명시한다. \`pull-adr.mjs\` 가 뼈대를 출력한다.`, undefined, R('binding-missing'))
  }

  for (const b of Object.values(bound)) {
    const err = (m, h, rule) => push('error', brel, `${b.id} — ${m}`, h, b.line, rule)
    const warn = (m, h, rule) => push('warn', brel, `${b.id} — ${m}`, h, b.line, rule)
    const d = byId.get(b.id)
    if (!d) { err(`매니페스트에 없는 결정이다`, '오타이거나 매니페스트가 낡았다. `pull-adr.mjs` 로 다시 끌어온다.', R('binding-unknown-decision')); continue }
    const st = String(d.status ?? '')
    if (ADR_DEAD.includes(st)) {
      // A successor not yet accepted upstream leaves this path with no decision in force, and «move
      // the binding there» would then hand it to a draft. The document repository's own check warns
      // on the retired decision; here the hint must not send anyone to the draft as if it held.
      const look = (id) => byId.get(id) ?? null
      const gap = st === 'superseded' ? successorGap(look, d.id, [].concat(d.superseded_by ?? [])) : null
      err(`결정의 상태가 \`${st}\` 다`, st !== 'superseded'
        ? '효력이 없는 결정에 코드를 묶어 두고 있다. 바인딩을 지운다.'
        : gap ? `${showGap(gap, look)} — 후속이 아직 효력이 없어 이 경로에 효력 있는 결정이 없다. 상류에서 후속을 승인한 뒤 다시 끌어오고 바인딩을 옮긴다.`
        : `${d.superseded_by ?? '후속 ADR'} 이 대체했다. 그 결정을 읽고 바인딩을 옮긴다.`, R('binding-dead'))
    } else if (st !== 'accepted') {
      warn(`결정이 아직 \`${st}\` 다`, '승인 안 된 결정에 묶인 코드는 결정이 바뀔 때 같이 흔들린다.', R('binding-unaccepted'))
    }
    // `at` names what was read when the binding was written. The content form (`body:<hex>`, the
    // decision's `decisionHash`) moves only when what the decision says moves; the commit form moves
    // with every commit that touches the file — a typo, an `applies_to` edit, a squash merge — and
    // stays accepted, unchanged, so no existing binding breaks.
    const now = d.digest ? `body:${d.digest.slice(0, 12)}` : d.sha ? d.sha.slice(0, 12) : null
    const reread = `${manifest.source ?? seam.repo} 의 ${d.path ?? d.id} 를 다시 읽고, 경로와 확인이 여전히 맞으면 \`at\` 을 올린다`
    const bodyAt = BODY_PIN.exec(b.at ?? '')?.[1]?.toLowerCase()
    if (!b.at) err('`at` 이 없다', `어느 판의 결정을 읽고 묶었는지가 없으면 결정이 바뀐 것을 알 수 없다. 지금 판은 ${now ? `\`at: "${now}"\`` : '(상류에서 미커밋)'} 이다.`, R('binding-at-missing'))
    else if (bodyAt) {
      if (d.digest && !d.digest.startsWith(bodyAt)) {
        err(`묶은 뒤 결정이 바뀌었다 — \`at: ${b.at}\`, 지금 ${digestPin(d.digest)}`,
          `결정·Non-goals·대안·상태 가운데 무엇이 바뀌었다. ${reread} — \`at: "${digestPin(d.digest)}"\`.`, R('binding-stale'))
      } else if (!d.digest) {
        warn('매니페스트에 결정 해시가 없어 `at` 을 대조하지 못했다', '이 기능 전에 끌어온 매니페스트다. `pull-adr.mjs` 로 다시 끌어온다.', R('binding-at-unverified'))
      }
    } else if (!/^[0-9a-f]{7,40}$/.test(b.at)) err(`\`at: ${b.at}\` 이 커밋 SHA 도 결정 해시도 아니다`, `\`body:<16진수 12자 이상>\` — 결정 내용의 해시 — 이나 상류 ADR 파일을 마지막으로 바꾼 커밋이다. \`pull-adr.mjs\` 가 출력한다${now ? ` — 지금은 \`at: "${now}"\`` : ''}.`, R('binding-at-invalid'))
    else if (d.sha && !d.sha.startsWith(b.at)) {
      err(`묶은 뒤 결정이 바뀌었다 — \`at: ${b.at.slice(0, 7)}\`, 지금 ${d.sha.slice(0, 7)}`,
        `${reread}.`, R('binding-stale'))
    } else if (!d.sha) {
      warn('끌어올 때 상류 ADR 이 커밋되지 않아 `at` 을 대조하지 못했다', '상류에서 커밋한 뒤 다시 끌어온다.', R('binding-at-unverified'))
    } else if (d.digest) {
      // Only when the SHA still matches: the binding was then written against this very text, so the
      // digest printed is one its author has read. Suggesting it next to a stale SHA would invite
      // raising `at` without the re-read. A note, not a warning — under `--strict` a warning would
      // fail every consumer that bound before the content form existed.
      later.push(`${b.id} — \`at\` 이 커밋 SHA 다. 상류의 오타·\`applies_to\`·스쿼시 병합에도 멈춘다 — \`at: "${digestPin(d.digest)}"\` 로 바꾸면 결정 내용이 바뀔 때만 멈춘다`)
    }
    if (self && !appliesHere(d, self)) {
      warn(`결정의 \`applies_to\` 에 이 레포(${self})가 없다`, `이 레포를 제약하는 결정이면 ${manifest.source ?? '상류'} 에서 \`applies_to\` 에 더한다.`, R('binding-not-applicable'))
    }

    if (b.paths == null) { err('`paths` 가 없다', '결정이 제약하는 경로를 적는다. 이 레포에 닿는 코드가 없으면 `paths: []` 와 `reason:` 이다.', R('binding-paths-missing')); continue }
    if (!b.paths.length) {
      if (!b.reason) err('`paths: []` 인데 `reason` 이 없다', '빈 바인딩은 «이 레포는 이 결정과 무관하다» 는 선언이다. 왜 무관한지 한 줄 적는다 — 검토자가 읽는 것은 그 줄뿐이다.', R('binding-reason-missing'))
      else push('info', brel, `${b.id} — 경로 없이 묶었다: ${b.reason}`)
      continue
    }
    // `confirms_in` widens only where the confirming test is looked for. Tests rarely sit beside the
    // code (`src/vault` + `test/vault`), and widening `paths` to reach them would also widen which
    // tasks meet the decision and what is injected into them.
    const where = []
    for (const [key, p] of [...b.paths.map((x) => ['paths', x]), ...b.confirms_in.map((x) => ['confirms_in', x])]) {
      const abs = resolve(root, p)
      if (existsSync(abs)) { where.push(abs); continue }
      const past = pathPast(root, p)
      if (past.state === 'never') {
        push('info', brel, `${b.id} — \`${key}\` 의 \`${p}\` 가 아직 없다 — git 이력에도 없던 경로라 만들어질 자리로 읽었다. 그 경로의 검사${b.confirms.length ? '와 그 안의 confirms 찾기' : ''}는 돌지 않았다 — 경로가 생기면 돈다`)
      } else if (key === 'paths') {
        warn(`\`paths\` 의 \`${p}\` 가 없다`, '경로가 바뀌었으면 같은 PR 에서 바인딩을 고친다. 결정이 제약하던 자리가 사라졌으면 그 결정이 아직 유효한지 본다.' + pastUnknown(past), R('binding-path-missing'))
      } else {
        warn(`\`confirms_in\` 의 \`${p}\` 가 없다`, '테스트 자리가 옮겨졌거나 지워졌다. 같은 PR 에서 `confirms_in` 을 고친다.' + pastUnknown(past), R('binding-confirms-in-missing-path'))
      }
    }
    const inWhat = b.confirms_in.length ? '`paths` · `confirms_in`' : '`paths`'
    if (!b.confirms.length) {
      warn('`confirms` 가 비었다', '결정이 지켜지는지 판정하는 테스트 이름을 적는다. 검사기는 `paths` 와 `confirms_in` 안에서 그 이름을 찾는다.', R('binding-confirms-empty'))
    } else if (where.length) {
      const found = lookFor(b.confirms, where)
      for (const c of found.searched ? found.missing : []) {
        if (found.cut) warn(`\`confirms\` 의 «${c}» 를 ${inWhat} 안에서 찾다가 멈췄다 — 경로마다 파일 ${SEARCH_BUDGET}개까지만 읽는다`, '없다는 뜻이 아니다 — 다 읽지 못했다. 테스트가 있는 자리를 `confirms_in` 에 좁게 적으면 그 자리는 따로 읽는다.', R('binding-confirms-search-cut'))
        else warn(`\`confirms\` 의 «${c}» 를 ${inWhat} 안에서 못 찾았다`, '테스트 이름이 바뀌었으면 같은 PR 에서 고친다. 지워졌으면 결정이 아직 지켜지는지 본다. 테스트가 `paths` 밖에 있으면 그 자리를 `confirms_in` 에 적는다.', R('binding-confirms-not-found'))
      }
    }
  }

  // A manifest pulled before decisions carried a content hash is still read, and judged by commit
  // as it always was; saying so is what keeps the old comparison from passing for the new one.
  const legacyManifest = (manifest.decisions ?? []).some((d) => !d.digest)
  if (legacyManifest) {
    push('info', mrel, '매니페스트에 결정 해시(`digest`)가 없다 — 이 기능 전에 끌어왔다. 상류와는 커밋 SHA 로 대조한다',
      '`pull-adr.mjs` 로 다시 끌어오면 결정 내용으로 대조한다 — 상류의 오타·`applies_to` 편집·스쿼시 병합에는 멈추지 않는다.')
  }

  checkFreshness()
  // The suggestion to move `at` to the content form comes last: it is advice, and a reader scanning
  // the notes should meet first what was and was not checked.
  for (const msg of later) push('info', brel, msg)

  function checkFreshness() {
    // Freshness needs the other repository. The checker does not use the network, so it reads a
    // checkout when one is at hand and says so when none is — a stale manifest must not look fresh.
    const upstream = findUpstream({ repo: manifest.source ?? seam.repo }, root, from)
    if (!upstream) {
      push('info', mrel, `${manifest.source ?? seam.repo} 체크아웃이 없다 — 매니페스트가 최신인지 대조하지 않았다`,
        '`SDLC_UPSTREAM` 이나 `--from` 으로 가리키면 상류에서 바뀐 결정을 오류로 잡는다.')
      return
    }
    // Only a decision that constrains this repository fails its CI: one bound here, or one whose
    // `applies_to` — in the manifest or in the upstream file now — names it. Anything else upstream is
    // a note. Failing on every move of a busy document repository kept each consumer red most of the
    // time for decisions about other repositories, and a gate that is always red is read as noise —
    // including the day it reports a decision that does bind here. Without `repo` nothing can tell what
    // applies here, so every change stays an error, as before; the note above that `repo` is missing
    // already says why.
    const constrains = (id, ...lists) => !self || !!bound[String(id)] || lists.some((l) => [].concat(l ?? []).some((r) => sameRepo(r, self)))
    const stale = (hard, msg, hint, rule) => hard
      ? push('error', mrel, msg, hint, undefined, rule)
      : push('info', mrel, `${msg} — 이 레포를 제약하지 않아 알리기만 한다`, hint)
    const upDoc = (path) => { try { return loadAdr(resolve(upstream, path)) } catch { return null } }
    // The folder comes from where the pulled decisions sat, not from an upstream profile: a document
    // repository need not run this harness at all.
    const dirs = [...new Set((manifest.decisions ?? []).map((d) => d.path && dirname(d.path)).filter(Boolean))]
    for (const dir of dirs) {
      if (!existsSync(resolve(upstream, dir))) continue
      for (const n of readdirSync(resolve(upstream, dir)).sort()) {
        const m = ADR_FILENAME.exec(n)
        if (!m || byId.has(`ADR-${m[1]}`)) continue
        const doc = upDoc(join(dir, n))
        const id = String(doc?.fm?.id ?? `ADR-${m[1]}`)
        if (byId.has(id)) continue
        const hard = !doc || constrains(id, appliesToOf(doc))
        stale(hard, `상류에 매니페스트가 모르는 결정이 있다 — ${id}`, '`pull-adr.mjs` 로 다시 끌어온다.', R('manifest-decision-unknown'))
      }
    }
    for (const d of manifest.decisions ?? []) {
      if (!d.path) continue
      if (!existsSync(resolve(upstream, d.path))) {
        stale(constrains(d.id, d.applies_to), `${d.id} 가 상류에서 사라졌다 — ${d.path}`, '`pull-adr.mjs` 로 다시 끌어온다.', R('manifest-decision-gone'))
        continue
      }
      if (!d.digest) {
        // The old comparison, for a manifest pulled before the content hash.
        const head = headOf(upstream, d.path)
        if (head && d.sha && head !== d.sha) {
          push('error', mrel, `${d.id} 가 끌어온 뒤 상류에서 바뀌었다 — ${d.sha.slice(0, 7)} → ${head.slice(0, 7)}`,
            '`pull-adr.mjs` 로 다시 끌어오고, 이 결정에 묶인 바인딩의 `at` 을 새 판을 읽은 뒤 올린다.', undefined, R('manifest-decision-changed'))
        }
        continue
      }
      const doc = upDoc(d.path)
      if (!doc) continue
      const digest = decisionHash(doc)
      if (digest !== d.digest) {
        stale(constrains(d.id, d.applies_to, appliesToOf(doc)),
          `${d.id} 가 끌어온 뒤 상류에서 바뀌었다 — 결정 내용 ${digestPin(d.digest)} → ${digestPin(digest)}`,
          '`pull-adr.mjs` 로 다시 끌어오고, 이 결정에 묶인 바인딩의 `at` 을 새 판을 읽은 뒤 올린다.', R('manifest-decision-changed'))
      } else if (d.hash && hashOf(doc.text) !== d.hash) {
        push('info', mrel, `${d.id} — 상류에서 문구가 바뀌었다 — 묶은 내용은 그대로다`,
          '결정·Non-goals·대안·상태는 끌어온 때와 같다. 매니페스트는 편할 때 `pull-adr.mjs` 로 갱신한다.')
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
  const ROOT = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--from') ?? process.cwd())
  const seam = adrSeam(ROOT)
  if (!seam.repo) {
    console.error('프로필에 `adr_repo` 가 없다 — 결정이 이 레포에 살면 바인딩은 필요 없다. `scope` 가 그 일을 한다.')
    process.exit(2)
  }
  const problems = []
  const notes = []
  checkBindings({ root: ROOT, seam, from: flag('--from') }, (level, doc, msg, hint, line, rule) =>
    level === 'info' ? notes.push(hint ? `${msg}\n      ${hint}` : msg) : problems.push({ level, doc, rule, msg, hint, line }))
  // No waivers here: these problems are reported against the bindings file and the manifest, which
  // carry no frontmatter. The bindings file has its own opt-out, `paths: []` with a `reason:`.
  noteDrift(problems, 'adr-bindings')
  process.exit(report({
    json: argv.includes('--json'),
    title: `결정 바인딩 검사 — ${seam.repo} → ${seam.self ?? '(repo 미지정)'}`,
    notes, problems, strict: argv.includes('--strict'), ruleDoc: '`references/adr.md` 의 «Decisions in another repository» 에 있다.',
  }))
}
