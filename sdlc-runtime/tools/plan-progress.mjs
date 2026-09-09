#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { taskFingerprint, repositoryFingerprint } from './task-evidence.mjs'
import { loadDir, stripComments, idsIn, schemaVersion } from './artifact-parse.mjs'
import { SECTION, sectionBlock, RE_NA, RE_CHANGE_LOG } from './keywords.mjs'

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
const filesOf = (e) => {
  const v = field(e, 'files')
  const ticked = [...v.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())
  return (ticked.length ? ticked : v.split(',')).map((s) => s.trim().replace(/^`|`$/g, '')).filter(Boolean)
}

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
const verifyLogs = (() => {
  if (!ROOT) return []
  const dir = resolve(ROOT, yml('verify_log_dir', resolve(ROOT, '.claude/spec-profile.yml')) || '.sdlc/verify', basename(DIR))
  const paths = evidenceRef
    ? (git('ls-tree', '-r', '--name-only', evidenceRef, '--', relative(ROOT, dir)) ?? '').split('\n').filter(Boolean).map((p) => resolve(ROOT, p))
    : existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : []
  return paths.filter((p) => p.endsWith('.log')).map((path) => {
    const head = (readEvidence(path) ?? '').split('\n---\n')[0]
    const kv = Object.fromEntries(head.split('\n').map((l) => l.split(/:\s(.*)/s)).filter((a) => a.length > 1).map(([k, v]) => [k.trim(), v.trim()]))
    let fingerprints = {}, command = null
    try { fingerprints = JSON.parse(kv.fingerprints ?? '{}'); command = JSON.parse(kv.command ?? 'null') } catch {}
    return { date: kv.date ?? '', repository: kv.repository, spec: kv.spec, head: kv.head, stable: kv.stable === 'true', fingerprints, command, file: relative(ROOT, path), tasks: (kv.tasks ?? '').split(/\s+/).filter(Boolean), exit: Number(kv.exit ?? 1), label: kv.label ?? null }
  })
})()
const verifyCommand = ROOT ? yml('verify', resolve(ROOT, '.claude/spec-profile.yml')) : ''
const repository = ROOT ? repositoryFingerprint(ROOT, {
  specDir: yml('spec_dir', resolve(ROOT, '.claude/spec-profile.yml')) || '.sdlc/specs',
  logDir: yml('verify_log_dir', resolve(ROOT, '.claude/spec-profile.yml')) || '.sdlc/verify',
}, evidenceRef) : null
const verifiedBy = (task, commits) => verifyLogs.filter((l) => !l.label && l.spec === rel(DIR) && l.command === verifyCommand)
  .sort((a, b) => b.date.localeCompare(a.date) || b.file.localeCompare(a.file)).slice(0, 1).filter((l) =>
  l.exit === 0 && !l.label && l.tasks.includes(task.id) && l.spec === rel(DIR) &&
  l.stable && l.command === verifyCommand && !!verifyCommand &&
  l.repository === repository && !!repository &&
  l.fingerprints[task.id] === taskFingerprint(ROOT ?? DIR, task, evidenceRef) &&
  /^[a-f0-9]{40,64}$/.test(l.head ?? '') && git('merge-base', '--is-ancestor', l.head, evidenceRef ?? 'HEAD') !== null &&
  commits.length > 0 && commits.every((c) => git('merge-base', '--is-ancestor', c, l.head) !== null)
).map((l) => l.file)

const commitRecords = (() => {
  if (!inGit || !born) return []
  const out = git('log', '--format=%H%x1f%B%x1e', `${born}..${evidenceRef ?? 'HEAD'}`) ?? ''
  return out.split('\x1e').map((record) => {
    const [hash, ...body] = record.trim().split('\x1f')
    return hash ? { hash, body: body.join('\x1f') } : null
  }).filter(Boolean)
})()
const taskCommits = (id) => commitRecords
  .filter((c) => new RegExp(`^SDLC-Task:\\s*${id}\\s*$`, 'mi').test(c.body))
  .filter((c) => c.body.split('\n').some((line) => line === `SDLC-Plan: ${planPath}`))
  .map((c) => c.hash)

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
  rows.push({
    id: w.id, title: w.title, done: !!w.done,
    files, present: present.length, commits, fileCommits, dirty,
    logged: loggedIds.has(w.id),
    tests: { total: sentences.length, checked: tests.checked, missing: tests.missing },
    verified: verifiedBy(w, commits),
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
    notes.push({ level: 'warn', id: r.id, msg: `미체크인데 귀속 커밋 ${r.commits.length}개가 있다 (${r.commits[0]})`, hint: '한 일이 기록되지 않았다 — 검증을 대조하고 체크박스와 §실행 기록을 갱신한다. 다시 실행하지 않는다.' })
  }
  if (r.done && !r.logged) {
    notes.push({ level: 'warn', id: r.id, msg: '체크됐는데 §실행 기록 에 줄이 없다', hint: '«계획과의 차이» 가 없으면 이 계획서는 «하려던 것» 만 알고 «한 것» 은 모른다.' })
  }
  if (r.done && r.tests.checked && r.tests.missing.length) {
    notes.push({ level: 'warn', id: r.id, msg: `체크됐는데 tests 문장 ${r.tests.missing.length}/${r.tests.total}개가 files 에 없다: «${r.tests.missing[0]}»${r.tests.missing.length > 1 ? ' 외' : ''}`,
      hint: '수용 기준 문장이 곧 테스트 이름이다 — 테스트를 그 문장으로 쓰거나, 실제 테스트 이름에 맞춰 tests: 줄을 고친다.' })
  }
  if (r.done && PLAN_SCHEMA >= TASK_EVIDENCE_SCHEMA && r.verified.length === 0) {
    notes.push({ level: 'warn', id: r.id, msg: '체크됐는데 합류점 verify 기록이 없다', hint: '`verify-run.mjs <스펙 폴더> --level <N> --tasks <WP> -- "<verify>"` 로 돌리면 기록이 남는다. 통과했다는 주장의 증거는 그 로그다.' })
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

if (JSON_OUT) {
  console.log(JSON.stringify({ dir: DIR, born, rows, notes }, null, 2))
  process.exit(notes.some((n) => n.level === 'error') || (STRICT && notes.some((n) => n.level === 'warn')) ? 1 : 0)
}

const mark = (r) => (r.done ? '[x]' : '[ ]')
console.log(`작업 진행 — ${basename(DIR)}  (status: ${docs.plan.fm.status ?? '?'}, 작업 ${rows.length}개)`)
if (!inGit) console.log('  · git 저장소가 아니다 — 커밋 대조를 건너뛴다. 체크박스만 보인다.')
else if (!born) console.log('  · plan.md 의 최초 커밋을 못 찾았다 — 최근 20개 커밋만 본다.')
console.log('')
for (const r of rows) {
  const c = r.commits.length ? `귀속 커밋 ${r.commits.length} (${r.commits[0]})` : '귀속 커밋 없음'
  const f = r.files.length ? `files ${r.present}/${r.files.length}` : 'files 없음'
  const t = r.tests.total ? (r.tests.checked ? `tests ${r.tests.total - r.tests.missing.length}/${r.tests.total}` : `tests ?/${r.tests.total}`) : 'tests 없음'
  const v = r.verified.length ? ` · verify ${r.verified.length}` : ''
  console.log(`  ${mark(r)} ${r.id}  ${c} · ${f} · ${t}${v}${r.logged ? ' · 기록됨' : ''}${r.dirty.length ? ` · 더티 ${r.dirty.length}` : ''}`)
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
