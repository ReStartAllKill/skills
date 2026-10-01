#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { taskFingerprint, repositoryFingerprint } from './task-evidence.mjs'
import { loadDir, stripComments, idsIn, schemaVersion, wpField, scopeOf } from './artifact-parse.mjs'
import { parseCommitRecords, ownsTaskCommit } from './commit-records.mjs'
import { taskFiles } from './task-paths.mjs'
import { SECTION, sectionBlock, RE_NA, RE_CHANGE_LOG } from './keywords.mjs'
import { upstreamSeam, loadLock } from './upstream.mjs'
import { consumerSelf, owes } from './owed.mjs'

const argv = process.argv.slice(2)
const STRICT = argv.includes('--strict')
const JSON_OUT = argv.includes('--json')
const DIR = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')

const docs = loadDir(DIR, () => {})
if (!docs.plan) {
  console.error(`plan.md 가 없다 — ${DIR}`)
  process.exit(2)
}
const PLAN_SCHEMA = schemaVersion(docs.plan.fm)
const TASK_EVIDENCE_SCHEMA = 4

let ROOT = null
for (let d = DIR, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
  if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { ROOT = d; break }
}
const git = (...a) => {
  try { return execFileSync('git', ['-C', ROOT ?? DIR, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
}
const inGit = git('rev-parse', '--git-dir') != null
const rel = (p) => (ROOT ? relative(ROOT, p) : p)

const planPath = rel(join(DIR, 'plan.md'))
const born = inGit
  ? (git('log', '--diff-filter=A', '--format=%H', '--', planPath) ?? '').split('\n').filter(Boolean).pop() ?? null
  : null

const evidenceRef = docs.plan.fm.status === 'completed' && git('status', '--porcelain', '--', planPath) === ''
  ? git('log', '-1', '--format=%H', '--', planPath) : null
const readEvidence = (path) => {
  const name = rel(path)
  if (evidenceRef) {
    const entry = (git('ls-tree', evidenceRef, '--', name) ?? '').trim()
    if (!entry) return null
    if (entry.split('\n').length === 1 && entry.split(/[\t ]/)[1] === 'tree') {
      const members = (git('ls-tree', '-r', '--name-only', evidenceRef, '--', name) ?? '').split('\n').filter(Boolean)
      return members.map((m) => git('show', `${evidenceRef}:${m}`) ?? '').join('\n')
    }
    return git('show', `${evidenceRef}:${name}`)
  }
  if (!existsSync(path)) return null
  if (!statSync(path).isDirectory()) return readFileSync(path, 'utf8')
  const members = (git('ls-files', '--cached', '--others', '--exclude-standard', '--', name) ?? '')
    .split('\n').filter(Boolean)
  return members.map((m) => { try { return readFileSync(resolve(ROOT ?? DIR, m), 'utf8') } catch { return '' } }).join('\n')
}
const wps = [...docs.plan.ents.values()].filter((e) => e.kind === 'wp')
const field = (e, k) => (e.fields.has(k) ? e.fields.get(k) : '')
const filesOf = taskFiles

const testsOf = (e) => field(e, 'tests').split(/\s·\s|\s\|\s/).map((t) => t.trim().replace(/^[`"'«]|[`"'»]$/g, '').trim())
  .filter((t) => t && !/^<.*>$/.test(t) && !RE_NA.test(t))
const squash = (s) => s.replace(/\s+/g, '')
const testsPresent = (files, sentences) => {
  const bodies = files.map((f) => readEvidence(resolve(ROOT ?? DIR, f))).filter((s) => s !== null).map(squash)
  if (!bodies.length) return { checked: false, missing: [] }
  return { checked: true, missing: sentences.filter((t) => !bodies.some((b) => b.includes(squash(t)))) }
}

const yml = (k, file) => {
  if (!file) return ''
  const m = new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(readEvidence(file) ?? '')
  return m ? m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : ''
}
const logDir = ROOT ? relative(ROOT, resolve(ROOT, yml('verify_log_dir', resolve(ROOT, '.claude/spec-profile.yml')) || '.sdlc/verify', basename(DIR))) : null
const verifyLogs = (() => {
  if (!ROOT) return []
  const dir = resolve(ROOT, yml('verify_log_dir', resolve(ROOT, '.claude/spec-profile.yml')) || '.sdlc/verify', basename(DIR))
  const paths = evidenceRef
    ? (git('ls-tree', '-r', '--name-only', evidenceRef, '--', relative(ROOT, dir)) ?? '').split('\n').filter(Boolean).map((p) => resolve(ROOT, p))
    : existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : []
  return paths.filter((p) => p.endsWith('.log')).map((path) => {
    const head = (readEvidence(path) ?? '').split('\n---\n')[0]
    const kv = Object.fromEntries(head.split('\n').map((l) => l.split(/:\s(.*)/s)).filter((a) => a.length > 1).map(([k, v]) => [k.trim(), v.trim()]))
    let fingerprints = {}, command = null, changed = null
    try { fingerprints = JSON.parse(kv.fingerprints ?? '{}'); command = JSON.parse(kv.command ?? 'null') } catch {}
    // `changed` is absent from stable runs and from every log written before verify-run recorded it.
    try { changed = kv.changed ? { paths: JSON.parse(kv.changed), total: Number(kv.changed_total ?? 0) } : null } catch {}
    return { level: Number(kv.level), date: kv.date ?? '', repository: kv.repository, spec: kv.spec, head: kv.head, stable: kv.stable === 'true', changed, fingerprints, command, file: relative(ROOT, path), tasks: (kv.tasks ?? '').split(/\s+/).filter(Boolean), exit: Number(kv.exit ?? 1), label: kv.label ?? null }
  })
})()
const verifyCommand = ROOT ? yml('verify', resolve(ROOT, '.claude/spec-profile.yml')) : ''
const repository = ROOT && inGit ? repositoryFingerprint(ROOT, {
  specDir: yml('spec_dir', resolve(ROOT, '.claude/spec-profile.yml')) || '.sdlc/specs',
  logDir: yml('verify_log_dir', resolve(ROOT, '.claude/spec-profile.yml')) || '.sdlc/verify',
}, evidenceRef) : null
const newest = (ls) => [...ls].sort((a, b) => b.date.localeCompare(a.date) || b.file.localeCompare(a.file))[0] ?? null

/** Why a log is not evidence, in words a person can act on.
 *
 * Both verdicts below used to be a single conjunction, and every way of failing it read the same:
 * «no verify record — run verify-run first». A test run that writes an un-ignored coverage file is
 * unstable on every run, so following that advice looped forever, and nothing named the cause. Each
 * condition is now a [fails, reason] pair tried in order; the first that fails is the reason, and
 * none failing is exactly the old conjunction holding. The order puts the specific before the
 * general — a task-file change also changes the repository hash, a rebase may change both — so the
 * named cause is the one to fix. Evaluation stays lazy, as the `&&` chain was: the git calls and
 * fingerprints after a failing condition are never run. */
const firstFailure = (l, checks) => {
  for (const [fails, why] of checks) if (fails()) return { ...why(), log: l.file }
  return null
}
const HEX = /^[a-f0-9]{40,64}$/
const short = (h) => String(h ?? '').slice(0, 12)
const RERUN = '지금 상태에서 verify-run.mjs 로 다시 돌린다.'
const common = (task, commits, l) => ({
  exit: [() => l.exit !== 0, () => ({ code: 'exit', msg: `최신 로그가 실패했다 (exit ${l.exit})`, hint: '실패를 고친 뒤 다시 돌린다 — 더 오래된 통과 로그는 새 실패를 대신하지 않는다.' })],
  tasks: [() => !l.tasks.includes(task.id), () => ({ code: 'tasks', msg: `최신 로그의 --tasks 에 ${task.id} 가 없다 (${l.tasks.join(' ') || '없음'})`, hint: `--tasks 에 ${task.id} 를 넣어 다시 돌린다.` })],
  legacy: [() => !l.repository || !(task.id in l.fingerprints), () => ({ code: 'legacy', msg: '최신 로그에 작업·저장소 지문이 없다 — 지문을 남기기 전의 verify-run 이 쓴 로그다', hint: RERUN })],
  stable: [() => !l.stable, () => {
    const paths = l.changed?.paths ?? []
    const more = l.changed && l.changed.total > paths.length ? ` 외 ${l.changed.total - paths.length}개` : ''
    return { code: 'unstable', changed: paths,
      msg: `verify 명령이 실행 중에 추적되거나 git 이 무시하지 않는 파일을 바꿨다 (stable: false)${paths.length ? `: ${paths.join(', ')}${more}` : ''}`,
      hint: '테스트가 쓰는 보고서·커버리지·캐시 파일은 .gitignore 에 넣거나 저장소 밖에 쓰게 한 뒤 다시 돌린다 — 그대로 다시 돌리면 같은 결과다.' }
  }],
  commits: [() => !commits.length, () => ({ code: 'no-commits', msg: `${task.id} 에 귀속 커밋이 없다`, hint: `\`SDLC-Task: ${task.id}\` trailer 가 붙은 커밋 뒤에 다시 돌린다.` })],
  headFormat: [() => !HEX.test(l.head ?? ''), () => ({ code: 'head', msg: '최신 로그에 검증한 HEAD 가 없다', hint: `커밋이 있는 git 저장소에서 ${RERUN}` })],
  headGone: [() => git('merge-base', '--is-ancestor', l.head, evidenceRef ?? 'HEAD') === null, () => ({ code: 'head-gone',
    msg: `검증한 HEAD ${short(l.head)} 가 지금 이력에 없다 — rebase·amend·reset 뒤로 보인다`, hint: RERUN })],
  contains: [() => commits.some((c) => git('merge-base', '--is-ancestor', c, l.head) === null), () => {
    const missing = commits.find((c) => git('merge-base', '--is-ancestor', c, l.head) === null)
    return { code: 'commits', msg: `검증한 HEAD ${short(l.head)} 가 작업 커밋 ${short(missing)} 를 담지 않는다 — 커밋 전에 돌렸다`, hint: `작업 커밋 뒤에 ${RERUN}` }
  }],
})

/** When no log is even a candidate, say what the nearest miss was rather than «none»: the profile
 * has no `verify`, a run used a command that differs from it by a space or a quote, the folder's
 * logs name another spec path, or every log carries a label. No log at all stays `null`, so the
 * caller keeps its «run verify-run first» message for the one case where that advice is right. */
const nearestMiss = (unlabelled, labelled) => {
  const mine = unlabelled.filter((l) => l.spec === rel(DIR))
  const l = newest(mine)
  if (l && !verifyCommand) return { code: 'no-verify', log: l.file, msg: '프로필에 verify 가 없다 — 비교할 명령이 없어 어느 로그도 완료 증거가 못 된다', hint: '.claude/spec-profile.yml 에 verify: 를 적는다.' }
  if (l) return { code: 'command', log: l.file, command: l.command, expected: verifyCommand,
    msg: `최신 로그의 명령이 프로필 verify 와 다르다 — 로그 ${JSON.stringify(l.command)} · 프로필 ${JSON.stringify(verifyCommand)}`,
    hint: '프로필의 verify 를 공백·따옴표까지 그대로 넘겨 다시 돌린다.' }
  const other = newest(unlabelled)
  if (other) return { code: 'spec', log: other.file, msg: `이 폴더의 로그가 다른 스펙 경로를 적고 있다 — 로그 ${other.spec} · 지금 ${rel(DIR)}`, hint: '세트를 옮겼으면 지금 경로에서 다시 돌린다.' }
  const tagged = newest(labelled)
  if (tagged) return { code: 'label', log: tagged.file, msg: `라벨이 붙은 로그만 있다 (label: ${tagged.label}) — 라벨 붙은 실행은 완료 증거가 아니다`,
    hint: '`verify-run.mjs <스펙> --level <N> --tasks <모든 WP> -- "<프로필 verify>"` 를 라벨 없이 돌린다.' }
  return null
}

/** `files` is the evidence exactly as before; `reason` says why there is none when a log exists. */
const verifiedBy = (task, commits) => {
  const l = newest(verifyLogs.filter((x) => !x.label && x.spec === rel(DIR) && x.command === verifyCommand))
  if (!l) return { files: [], reason: nearestMiss(verifyLogs.filter((x) => !x.label), verifyLogs.filter((x) => x.label)) }
  const c = common(task, commits, l)
  const reason = firstFailure(l, [
    c.exit, c.tasks, c.legacy, c.stable,
    [() => !verifyCommand, () => nearestMiss([l], [])],
    c.headFormat, c.headGone, c.commits, c.contains,
    [() => l.fingerprints[task.id] !== taskFingerprint(ROOT ?? DIR, task, evidenceRef), () => ({ code: 'task-changed',
      msg: `verify 뒤에 ${task.id} 의 files 내용이나 작업 정의가 바뀌었다`, hint: RERUN })],
    [() => !repository, () => ({ code: 'repository', msg: '저장소 지문을 계산할 수 없다 — git 저장소가 아니다', hint: 'git 저장소 안에서 돌린다.' })],
    [() => l.repository !== repository, () => ({ code: 'repository-changed',
      msg: 'verify 뒤에 저장소가 바뀌었다 — 다른 파일 편집, 새로 생긴 파일, rebase, 커밋 안 된 변경 중 하나다', hint: `증거는 실행한 그 저장소 상태에만 묶인다. ${RERUN}` })],
  ])
  return { files: reason ? [] : [l.file], reason }
}

// Scoped runs authorize moving to the next level, never final completion. Compare
// their committed snapshot so later dependent tasks can legitimately change shared files.
const snapshotHashes = new Map()
const integratedBy = (task, commits) => {
  const scoped = ROOT ? yml('verify_scoped', resolve(ROOT, '.claude/spec-profile.yml')) : ''
  const l = newest(verifyLogs.filter((x) => x.spec === rel(DIR) && x.tasks.includes(task.id) &&
    (scoped ? x.label === 'scoped' && x.command === scoped : !x.label && x.command === verifyCommand)))
  if (!l) return { files: [], reason: null }
  const snapshot = () => {
    if (!snapshotHashes.has(l.head)) snapshotHashes.set(l.head, repositoryFingerprint(ROOT, {
      specDir: yml('spec_dir', resolve(ROOT, '.claude/spec-profile.yml')) || '.sdlc/specs',
      logDir: yml('verify_log_dir', resolve(ROOT, '.claude/spec-profile.yml')) || '.sdlc/verify',
    }, l.head))
    return snapshotHashes.get(l.head)
  }
  const c = common(task, commits, l)
  const reason = firstFailure(l, [
    c.exit, c.stable, c.commits,
    [() => !l.repository, () => c.legacy[1]()],
    c.headFormat, c.headGone, c.contains,
    [() => l.repository !== snapshot(), () => ({ code: 'uncommitted',
      msg: `실행할 때의 작업 트리가 검증한 HEAD ${short(l.head)} 커밋과 달랐다 — 커밋 안 된 변경이 있는 채로 돌렸다`, hint: `변경을 커밋한 뒤 ${RERUN}` })],
    [() => l.fingerprints[task.id] !== taskFingerprint(ROOT, task, l.head), () => ({ code: 'task-uncommitted',
      msg: `실행할 때의 ${task.id} files 가 검증한 HEAD ${short(l.head)} 커밋과 달랐다`, hint: `변경을 커밋한 뒤 ${RERUN}` })],
  ])
  return { files: reason ? [] : [l.file], reason }
}

/** Every commit reachable from the evidence point, not only those after the plan was added.
 *
 * This used to be `born..HEAD`. The `SDLC-Plan:` trailer already binds a task commit to this
 * exact plan path, so the lower bound bought nothing — and it cost everything the moment a
 * repository started tracking an artifact directory it had ignored until then: `born` became the
 * newest commit, the window held zero commits, and every task in every plan read «no attributed
 * commit» while its trailered commits sat right below. sdlc-metrics.mjs never had the bound, so
 * the two tools disagreed about the same history. The file-commit hint below keeps `born`,
 * because a file touched before the plan existed is not evidence for the plan. */
const commitRecords = (() => {
  if (!inGit) return []
  const out = git('log', '--format=%H%x1f%B%x1e', evidenceRef ?? 'HEAD') ?? ''
  return parseCommitRecords(out)
})()
const taskCommits = (id) => commitRecords.filter((c) => ownsTaskCommit(c, id, planPath)).map((c) => c.hash)

const planBody = stripComments(docs.plan.lines.join('\n'))
const logSection = (sectionBlock(SECTION.executionLog).exec(planBody)?.[0] ?? '')
  .replace(RE_CHANGE_LOG, '')
const loggedIds = new Set(idsIn(logSection).filter((x) => x.startsWith('WP-')))

const rows = []
for (const w of wps) {
  const files = filesOf(w)
  const present = files.filter((f) => readEvidence(resolve(ROOT ?? DIR, f)) !== null)
  let commits = taskCommits(w.id)
  let fileCommits = []
  let dirty = []
  if (inGit && files.length) {
    if (born) {
      const out = git('log', '--format=%h', `${born}..${evidenceRef ?? 'HEAD'}`, '--', ...files)
      fileCommits = (out ?? '').split('\n').filter(Boolean)
    } else {
      const out = git('log', '--format=%h', '-20', '--', ...files)
      fileCommits = (out ?? '').split('\n').filter(Boolean)
    }
    const st = evidenceRef ? '' : git('status', '--porcelain', '--', ...files)
    dirty = (st ?? '').split('\n').filter(Boolean).map((l) => l.trim().replace(/^\S+\s+/, ''))
  }
  const sentences = testsOf(w)
  const tests = testsPresent(files, sentences)
  const verdict = verifiedBy(w, commits)
  const integration = integratedBy(w, commits)
  rows.push({
    id: w.id, title: w.title, done: !!w.done,
    files, present: present.length, commits, fileCommits, dirty,
    logged: loggedIds.has(w.id),
    tests: { total: sentences.length, checked: tests.checked, missing: tests.missing },
    verified: verdict.files,
    integrated: integration.files,
    // Added fields — plan-check and plan-resume read this JSON, so nothing existing changed shape.
    // Null when the task is verified (integrated) or when there is no log to find fault with.
    unverified: verdict.files.length ? null : verdict.reason,
    unintegrated: integration.files.length ? null : integration.reason,
  })
}

const notes = []
for (const r of rows) {
  if (r.done && r.commits.length === 0) {
    notes.push({ level: PLAN_SCHEMA >= TASK_EVIDENCE_SCHEMA ? 'error' : 'info', id: r.id, msg: '체크됐는데 귀속 커밋이 없다', hint: PLAN_SCHEMA >= TASK_EVIDENCE_SCHEMA
      ? `작업 커밋에 \`SDLC-Task: ${r.id}\` trailer가 있어야 한다. 하지 않은 일이면 체크를 되돌린다.`
      : 'v1~v3 계획은 trailer 도입 전 문서라 참고만 한다.' })
  }
  if (!r.done && r.commits.length > 0) {
    notes.push({ level: r.verified.length ? 'warn' : 'info', id: r.id, msg: `미체크인데 귀속 커밋 ${r.commits.length}개가 있다 (${r.commits[0]})`, hint: '전체 검증 전에는 미체크가 정상이다. plan-resume.mjs 로 다음 행동을 확인하고 다시 구현하지 않는다.' })
  }
  if (r.done && !r.logged) {
    notes.push({ level: 'warn', id: r.id, msg: '체크됐는데 §실행 기록 에 줄이 없다', hint: '«계획과의 차이» 가 없으면 이 계획서는 «하려던 것» 만 알고 «한 것» 은 모른다.' })
  }
  if (r.done && r.tests.checked && r.tests.missing.length) {
    notes.push({ level: 'warn', id: r.id, msg: `체크됐는데 tests 문장 ${r.tests.missing.length}/${r.tests.total}개가 files 에 없다: «${r.tests.missing[0]}»${r.tests.missing.length > 1 ? ' 외' : ''}`,
      hint: '수용 기준 문장이 곧 테스트 이름이다 — 테스트를 그 문장으로 쓰거나, 실제 테스트 이름에 맞춰 tests: 줄을 고친다.' })
  }
  if (r.done && PLAN_SCHEMA >= TASK_EVIDENCE_SCHEMA && r.verified.length === 0) {
    const u = r.unverified
    notes.push(u
      ? { level: 'warn', id: r.id, msg: `체크됐는데 합류점 verify 기록이 증거가 못 된다 — ${u.msg}`, hint: `${u.hint} (로그: ${u.log})` }
      : { level: 'warn', id: r.id, msg: '체크됐는데 합류점 verify 기록이 없다', hint: '`verify-run.mjs <스펙 폴더> --level <N> --tasks <WP> -- "<verify>"` 로 돌리면 기록이 남는다. 통과했다는 주장의 증거는 그 로그다.' })
  }
  // Before the check, too: this is the moment someone is about to run `mark` and be refused. A
  // label-only reason is left out — mid-plan, scoped logs and no full run are the expected state.
  if (!r.done && r.commits.length && r.unverified && r.unverified.code !== 'label') {
    notes.push({ level: 'info', id: r.id, msg: `최신 verify 로그가 완료 증거가 못 된다 — ${r.unverified.msg}`, hint: `${r.unverified.hint} (로그: ${r.unverified.log})` })
  }
  if (r.dirty.length) {
    notes.push({ level: 'warn', id: r.id, msg: `커밋되지 않은 변경 ${r.dirty.length}개`, hint: `${r.dirty.slice(0, 3).join(', ')}` })
  }
  if (!r.done && r.commits.length === 0 && r.fileCommits.length > 0) {
    notes.push({ level: 'info', id: r.id, msg: `files 이력은 ${r.fileCommits.length}개지만 귀속 커밋은 없다`, hint: '다른 순차 작업이 같은 파일을 건드렸을 수 있다. 파일 이력만으로 완료로 판단하지 않는다.' })
  }
  if (r.files.length && r.present === 0 && r.commits.length === 0) {
    notes.push({ level: 'info', id: r.id, msg: '파일이 아직 없다 — 시작 전으로 보인다' })
  }
}

if (PLAN_SCHEMA >= TASK_EVIDENCE_SCHEMA) {
  const status = docs.plan.fm.status ?? ''
  const checked = rows.filter((r) => r.done).map((r) => r.id)
  if (checked.length && !['in_progress', 'completed'].includes(status)) {
    notes.push({ level: 'error', id: 'plan.md', msg: `체크된 작업 ${checked.length}개가 있는데 status 가 ${status || '(없음)'} 다`,
      hint: '실행이 시작된 계획서의 status 는 in_progress 다. 되돌아갔으면 in_progress 로 고치고 커밋한다 — 그대로 두면 승인 가드가 남은 체크박스 갱신을 막는다.' })
  }
}

if (PLAN_SCHEMA >= TASK_EVIDENCE_SCHEMA && docs.plan.fm.status === 'completed') {
  const open = rows.filter((r) => !r.done).map((r) => r.id)
  if (open.length) notes.push({ level: 'error', id: 'plan.md', msg: `completed 인데 미완료 작업이 있다: ${open.join(' · ')}`, hint: '모든 작업과 검증을 끝낸 뒤 completed 로 바꾼다.' })
}

/** Acceptance criteria, derived from the plan rather than read from the spec's own boxes.
 *
 * The spec carries `- [ ] AC-001` and nothing ever ticks it, and nothing can: schema 7 pins the
 * spec body byte for byte in the plan's `spec_version`, and the approval guard refuses body edits
 * to an accepted document. Both are deliberate — a spec whose text can drift after approval is
 * a spec nobody approved. So a criterion is satisfied when every task that covers it is checked,
 * and the answer lives here, next to the task evidence it is made of, instead of in the document
 * it describes. A criterion no task covers is reported as such rather than as open: «no one is
 * building this» and «this is not built yet» call for different actions.
 *
 * `covers: FR-001 (AC-001, AC-002)` names criteria directly; a bare `FR-001` covers every
 * criterion under that requirement, the reading lint-prose already applies.
 *
 * Not every criterion is this plan's to build. owed.mjs decides, for this tool and check-artifacts
 * alike: a criterion under a requirement the spec marks `Should`, `Could` or `Won't` may be left for
 * later, and in a consumer repository one scoped to another repository must not be built here at
 * all. Warning about either failed `--strict` — and so check-all — for a set check-artifacts passes.
 * A criterion with no priority at all still warns: silence is not deferral. `owed`, `reason`,
 * `priority` and `scope` are added fields; nothing existing was renamed, because plan-check and
 * plan-resume read this JSON. */
const SELF = consumerSelf(loadLock(DIR), upstreamSeam(ROOT))
const acceptance = (() => {
  if (!docs.spec) return null
  const acs = [...docs.spec.ents.values()].filter((e) => e.kind === 'ac')
  if (!acs.length) return []
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  const req = (a) => (a.parent ? docs.spec.ents.get(a.parent) ?? null : null)
  const covering = new Map(acs.map((a) => [a.id, []]))
  for (const w of wps) {
    const covers = wpField(w, 'covers')
    const direct = new Set([...covers.matchAll(/\bAC-\d{1,4}\b/g)].map((m) => m[0]))
    const reqs = new Set([...covers.matchAll(/\b(?:FR|NFR)-\d{1,4}\b/g)].map((m) => m[0]))
    for (const a of acs) {
      if (direct.has(a.id) || (a.parent && reqs.has(a.parent) && !direct.size)) covering.get(a.id).push(w.id)
    }
  }
  return acs.map((a) => {
    const by = covering.get(a.id)
    const parent = req(a)
    const reason = owes(SELF, a, parent)
    return {
      id: a.id, title: a.title, requirement: a.parent,
      covered_by: by,
      done: by.length > 0 && by.every((id) => byId[id]?.done),
      // What the spec file says, kept so a hand-ticked box is visible as a claim without evidence.
      claimed: /\[[xX]\]/.test(docs.spec.lines[a.line]),
      // An unprioritised criterion is owed here: nothing in the spec says it may wait, so it warns
      // and counts, exactly as before. `reason` tells it apart from a `Must`.
      owed: reason === 'owed' || reason === 'unprioritised',
      reason,
      priority: parent?.priority ?? null,
      scope: scopeOf(a, parent),
    }
  })
})()

/** A criterion counts towards «N/M» when the plan owes it or builds it anyway. A `Could` a task
 * picked up is work this plan does; one left for later or built by another repository is not, and
 * counting it would hold the ratio below 1 for a plan that finished everything it set out to do. */
const counted = (a) => a.owed || a.covered_by.length > 0

for (const a of acceptance ?? []) {
  if (!a.covered_by.length && a.owed) notes.push({ level: 'warn', id: a.id, msg: '어느 작업의 covers 에도 없다', hint: 'spec 의 기준인데 plan 이 짓지 않는다. 작업의 covers 에 더하거나, 기준을 빼는 /iterate-spec 이 필요하다.' })
  if (!a.covered_by.length && a.reason === 'foreign') notes.push({ level: 'info', id: a.id, msg: `다른 레포 몫이다 (scope: ${a.scope.join('·')}) — 이 계획이 짓지 않는다`, hint: `이 레포는 \`${SELF}\` 다. 그 레포의 계획이 덮는다 — 여기서 덮으면 check-artifacts 가 막는다.` })
  if (!a.covered_by.length && a.reason === 'deferred') notes.push({ level: 'info', id: a.id,
    msg: `${a.requirement} 이 Must 가 아니다 (${a.priority}) — 미뤘다`,
    hint: '덮는 작업이 없어도 이 계획은 끝날 수 있다. 이번 변경에서 지을 거면 작업의 covers 에 더한다.' })
  if (a.claimed && !a.done) notes.push({ level: 'warn', id: a.id, msg: 'spec.md 에 손으로 체크돼 있지만 덮는 작업이 다 끝나지 않았다', hint: '체크는 여기서 파생된다. spec 의 박스는 증거가 아니다 — 되돌리고 작업을 끝낸다.' })
}

if (JSON_OUT) {
  console.log(JSON.stringify({ dir: DIR, born, logDir, rows, acceptance, notes }, null, 2))
  process.exit(notes.some((n) => n.level === 'error') || (STRICT && notes.some((n) => n.level === 'warn')) ? 1 : 0)
}

const mark = (r) => (r.done ? '[x]' : '[ ]')
console.log(`작업 진행 — ${basename(DIR)}  (status: ${docs.plan.fm.status ?? '?'}, 작업 ${rows.length}개)`)
if (!inGit) console.log('  · git 저장소가 아니다 — 커밋 대조를 건너뛴다. 체크박스만 보인다.')
else if (!born) console.log('  · plan.md 의 최초 커밋을 못 찾았다 — 파일 이력은 최근 20개 커밋만 본다. 트레일러 귀속은 전체 이력을 본다.')
console.log('')
for (const r of rows) {
  const c = r.commits.length ? `귀속 커밋 ${r.commits.length} (${r.commits[0]})` : '귀속 커밋 없음'
  const f = r.files.length ? `files ${r.present}/${r.files.length}` : 'files 없음'
  const t = r.tests.total ? (r.tests.checked ? `tests ${r.tests.total - r.tests.missing.length}/${r.tests.total}` : `tests ?/${r.tests.total}`) : 'tests 없음'
  const v = r.verified.length ? ` · verify ${r.verified.length}` : ''
  console.log(`  ${mark(r)} ${r.id}  ${c} · ${f} · ${t}${v}${r.logged ? ' · 기록됨' : ''}${r.dirty.length ? ` · 더티 ${r.dirty.length}` : ''}`)
}
if (acceptance?.length) {
  const mine = acceptance.filter(counted)
  const rest = acceptance.filter((a) => !counted(a))
  const met = mine.filter((a) => a.done).length
  console.log(`\n수용 기준 ${met}/${mine.length}  (plan 의 체크에서 파생 — spec.md 의 박스는 고치지 않는다)`)
  for (const a of mine) {
    const by = a.covered_by.length ? `← ${a.covered_by.join(' ')}` : '← 덮는 작업 없음'
    console.log(`  ${a.done ? '[x]' : '[ ]'} ${a.id}  ${by}${a.requirement ? `  (${a.requirement})` : ''}`)
  }
  if (rest.length) {
    console.log(`  이 계획 몫이 아닌 기준 ${rest.length}개 — 분모에 넣지 않는다`)
    for (const a of rest) {
      const why = a.reason === 'foreign' ? `다른 레포 몫 (${a.scope.join('·')})` : `미뤘다 (${a.priority})`
      console.log(`   -  ${a.id}  ${why}${a.requirement ? `  (${a.requirement})` : ''}`)
    }
  }
} else if (acceptance) {
  console.log('\n수용 기준 — spec.md 에 `- [ ] AC-…` 줄이 없다')
} else {
  console.log('\n수용 기준 — spec.md 가 없어 파생할 수 없다')
}
if (notes.length) {
  console.log('')
  for (const n of notes) {
    console.log(`  ${n.level === 'error' ? '✗' : n.level === 'warn' ? '⚠' : '·'} ${n.id}  ${n.msg}`)
    if (n.hint) console.log(`      ${n.hint}`)
  }
}
const done = rows.filter((r) => r.done).length
console.log(`\n체크 ${done}/${rows.length} · 어긋남 ${notes.filter((n) => n.level !== 'info').length}건`)
process.exit(notes.some((n) => n.level === 'error') || (STRICT && notes.some((n) => n.level === 'warn')) ? 1 : 0)
