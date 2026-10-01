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
import { ADR_FILENAME, report } from './artifact-parse.mjs'
import { hashOf, headOf, findUpstream, sameRepo } from './upstream.mjs'

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
  const strip = (s) => s.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')
  const list = (v) => v.trim().replace(/^\[|\]$/g, '').split(',').map(strip).filter(Boolean)
  let inBindings = false
  let cur = null
  let listKey = null

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s*$/, '')
    if (!line.trim() || /^\s*#/.test(line)) return
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
      out.bindings[cur] = { id: cur, at: null, paths: null, confirms: [], reason: null, line: i + 1 }
      return
    }
    if (!cur) return bad(i + 1, `어느 바인딩에도 속하지 않은 줄: ${body}`)

    if (indent === 4) {
      listKey = null
      const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(body)
      if (!m) return bad(i + 1, `\`키: 값\` 이 아니다: ${body}`)
      const [, key, v] = m
      if (key === 'paths' || key === 'confirms') {
        if (v.trim() === '') { out.bindings[cur][key] = []; listKey = key; return }
        if (!v.trim().startsWith('[')) return bad(i + 1, `\`${key}\` 는 목록이다: ${body}`)
        out.bindings[cur][key] = list(v)
        return
      }
      if (key === 'at' || key === 'reason') { out.bindings[cur][key] = strip(v) || null; return }
      return bad(i + 1, `모르는 키 \`${key}\` — at · paths · confirms · reason 만 읽는다`)
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

export function collect(path, out, budget = { files: 400 }) {
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

const appliesHere = (d, self) => !!self && [].concat(d.applies_to ?? []).some((r) => sameRepo(r, self))
/** Every check that needs a path runs here, in the repository that holds the path.
 *  push(level, doc, msg, hint, line?) — level is error · warn · info. */
export function checkBindings({ root, seam, from = null }, push) {
  const mrel = relative(root, seam.manifest)
  const brel = relative(root, seam.bindings)
  const loaded = readManifest(seam.manifest)
  const bindings = loadBindings(seam.bindings)

  for (const p of bindings?.problems ?? []) push('error', brel, p.msg, null, p.line)

  if (loaded.missing) {
    push('warn', mrel, `결정 매니페스트가 없다 — ${seam.repo} 의 결정을 이 레포가 하나도 모른다`,
      `\`node <sdlc_runtime>/tools/pull-adr.mjs\` 로 끌어와 커밋한다. 그 전까지 핀의 상태 검사, 계획의 결정 누락 검사, 구현 에이전트 주입이 전부 꺼져 있다.`)
    return
  }
  if (loaded.broken) { push('error', mrel, `결정 매니페스트가 깨졌다 — ${loaded.broken}`, '`pull-adr.mjs` 로 다시 만든다.'); return }
  const manifest = loaded.manifest
  if (manifest.integrity !== manifestIntegrity(manifest.decisions)) {
    push('error', mrel, '결정 매니페스트가 `pull-adr` 가 쓴 것과 다르다',
      `이 파일은 ${manifest.source ?? seam.repo} 의 ADR 에서 만든 사본이고 여기서는 읽기 전용이다. 결정을 고칠 일은 그쪽에서 하고 \`pull-adr.mjs\` 로 다시 끌어온다.`)
  }
  if (manifest.source && seam.repo && !sameRepo(manifest.source, seam.repo)) {
    push('error', mrel, `매니페스트의 출처(${manifest.source})가 프로필의 \`adr_repo\`(${seam.repo})와 다르다`, '결정이 사는 곳을 옮겼으면 다시 끌어온다.')
  }
  if (bindings?.source && manifest.source && !sameRepo(bindings.source, manifest.source)) {
    push('error', brel, `바인딩의 \`source\`(${bindings.source})가 매니페스트의 출처(${manifest.source})와 다르다`, '한 레포의 결정만 바인딩한다.')
  }

  const self = seam.self
  const byId = new Map((manifest.decisions ?? []).map((d) => [String(d.id), d]))
  const bound = bindings?.bindings ?? {}

  if (!self && (manifest.decisions ?? []).some((d) => [].concat(d.applies_to ?? []).length)) {
    push('info', brel, '프로필에 `repo` 가 없다 — 어느 결정이 이 레포에 적용되는지 `applies_to` 와 대조하지 못했다',
      '`repo: <이 레포 이름>` 을 적으면 바인딩이 빠진 결정을 경고한다.')
  }
  for (const d of manifest.decisions ?? []) {
    if (String(d.status ?? '') !== 'accepted' || !appliesHere(d, self) || bound[String(d.id)]) continue
    push('warn', brel, `${d.id}(«${d.title ?? ''}») 가 이 레포에 적용되는데 바인딩이 없다`,
      `결정이 제약하는 경로를 \`bindings:\` 에 적는다 — 그래야 계획과 구현 에이전트가 그 결정을 만난다. 이 레포에 닿는 코드가 없으면 \`paths: []\` 와 \`reason:\` 으로 명시한다. \`pull-adr.mjs\` 가 뼈대를 출력한다.`)
  }

  for (const b of Object.values(bound)) {
    const err = (m, h) => push('error', brel, `${b.id} — ${m}`, h, b.line)
    const warn = (m, h) => push('warn', brel, `${b.id} — ${m}`, h, b.line)
    const d = byId.get(b.id)
    if (!d) { err(`매니페스트에 없는 결정이다`, '오타이거나 매니페스트가 낡았다. `pull-adr.mjs` 로 다시 끌어온다.'); continue }
    const st = String(d.status ?? '')
    if (ADR_DEAD.includes(st)) {
      err(`결정의 상태가 \`${st}\` 다`, st === 'superseded'
        ? `${d.superseded_by ?? '후속 ADR'} 이 대체했다. 그 결정을 읽고 바인딩을 옮긴다.`
        : '효력이 없는 결정에 코드를 묶어 두고 있다. 바인딩을 지운다.')
    } else if (st !== 'accepted') {
      warn(`결정이 아직 \`${st}\` 다`, '승인 안 된 결정에 묶인 코드는 결정이 바뀔 때 같이 흔들린다.')
    }
    if (!b.at) err('`at` 이 없다', `어느 판의 결정을 읽고 묶었는지가 없으면 결정이 바뀐 것을 알 수 없다. 지금 판은 ${d.sha ? d.sha.slice(0, 7) : '(상류에서 미커밋)'} 이다.`)
    else if (!/^[0-9a-f]{7,40}$/.test(b.at)) err(`\`at: ${b.at}\` 이 커밋 SHA 가 아니다`, '상류 ADR 파일을 마지막으로 바꾼 커밋이다. `pull-adr.mjs` 가 출력한다.')
    else if (d.sha && !d.sha.startsWith(b.at)) {
      err(`묶은 뒤 결정이 바뀌었다 — \`at: ${b.at.slice(0, 7)}\`, 지금 ${d.sha.slice(0, 7)}`,
        `${manifest.source ?? seam.repo} 의 ${d.path ?? d.id} 를 다시 읽고, 경로와 확인이 여전히 맞으면 \`at\` 을 올린다.`)
    } else if (!d.sha) {
      warn('끌어올 때 상류 ADR 이 커밋되지 않아 `at` 을 대조하지 못했다', '상류에서 커밋한 뒤 다시 끌어온다.')
    }
    if (self && !appliesHere(d, self)) {
      warn(`결정의 \`applies_to\` 에 이 레포(${self})가 없다`, `이 레포를 제약하는 결정이면 ${manifest.source ?? '상류'} 에서 \`applies_to\` 에 더한다.`)
    }

    if (b.paths == null) { err('`paths` 가 없다', '결정이 제약하는 경로를 적는다. 이 레포에 닿는 코드가 없으면 `paths: []` 와 `reason:` 이다.'); continue }
    if (!b.paths.length) {
      if (!b.reason) err('`paths: []` 인데 `reason` 이 없다', '빈 바인딩은 «이 레포는 이 결정과 무관하다» 는 선언이다. 왜 무관한지 한 줄 적는다 — 검토자가 읽는 것은 그 줄뿐이다.')
      else push('info', brel, `${b.id} — 경로 없이 묶었다: ${b.reason}`)
      continue
    }
    const bodies = []
    for (const p of b.paths) {
      const abs = resolve(root, p)
      if (!existsSync(abs)) { warn(`\`paths\` 의 \`${p}\` 가 없다`, '경로가 바뀌었으면 같은 PR 에서 바인딩을 고친다. 결정이 제약하던 자리가 사라졌으면 그 결정이 아직 유효한지 본다.'); continue }
      collect(abs, bodies)
    }
    if (!b.confirms.length) {
      warn('`confirms` 가 비었다', '결정이 지켜지는지 판정하는 테스트 이름을 적는다. 검사기는 `paths` 안에서 그 이름을 찾는다.')
    } else if (bodies.length) {
      const hay = bodies.join('\n').replace(/\s+/g, '')
      for (const c of b.confirms) {
        if (!hay.includes(String(c).replace(/\s+/g, ''))) warn(`\`confirms\` 의 «${c}» 를 \`paths\` 안에서 못 찾았다`, '테스트 이름이 바뀌었으면 같은 PR 에서 고친다. 지워졌으면 결정이 아직 지켜지는지 본다.')
      }
    }
  }

  // Freshness needs the other repository. The checker does not use the network, so it reads a
  // checkout when one is at hand and says so when none is — a stale manifest must not look fresh.
  const upstream = findUpstream({ repo: manifest.source ?? seam.repo }, root, from)
  if (!upstream) {
    push('info', mrel, `${manifest.source ?? seam.repo} 체크아웃이 없다 — 매니페스트가 최신인지 대조하지 않았다`,
      '`SDLC_UPSTREAM` 이나 `--from` 으로 가리키면 상류에서 바뀐 결정을 오류로 잡는다.')
    return
  }
  // The folder comes from where the pulled decisions sat, not from an upstream profile: a document
  // repository need not run this harness at all.
  const dirs = [...new Set((manifest.decisions ?? []).map((d) => d.path && dirname(d.path)).filter(Boolean))]
  const onDisk = dirs.flatMap((dir) => existsSync(resolve(upstream, dir))
    ? readdirSync(resolve(upstream, dir)).map((n) => ADR_FILENAME.exec(n)).filter(Boolean).map((m) => `ADR-${m[1]}`)
    : [])
  const unseen = onDisk.filter((id) => !byId.has(id))
  if (unseen.length) push('error', mrel, `상류에 매니페스트가 모르는 결정이 있다 — ${unseen.join(' · ')}`, '`pull-adr.mjs` 로 다시 끌어온다.')
  for (const d of manifest.decisions ?? []) {
    if (!d.path) continue
    if (!existsSync(resolve(upstream, d.path))) { push('error', mrel, `${d.id} 가 상류에서 사라졌다 — ${d.path}`, '`pull-adr.mjs` 로 다시 끌어온다.'); continue }
    const head = headOf(upstream, d.path)
    if (head && d.sha && head !== d.sha) {
      push('error', mrel, `${d.id} 가 끌어온 뒤 상류에서 바뀌었다 — ${d.sha.slice(0, 7)} → ${head.slice(0, 7)}`,
        '`pull-adr.mjs` 로 다시 끌어오고, 이 결정에 묶인 바인딩의 `at` 을 새 판을 읽은 뒤 올린다.')
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
  checkBindings({ root: ROOT, seam, from: flag('--from') }, (level, doc, msg, hint, line) =>
    level === 'info' ? notes.push(hint ? `${msg}\n      ${hint}` : msg) : problems.push({ level, doc, msg, hint, line }))
  process.exit(report({
    json: argv.includes('--json'),
    title: `결정 바인딩 검사 — ${seam.repo} → ${seam.self ?? '(repo 미지정)'}`,
    notes, problems, strict: argv.includes('--strict'), ruleDoc: '`references/adr.md` 의 «Decisions in another repository» 에 있다.',
  }))
}
