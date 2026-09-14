#!/usr/bin/env node
/** Prepare and apply one human approval over an exact light-tier document set.
 * CLI execution is an authorized write; the PreToolUse hook asks before the apply command. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { frontmatter, schemaVersion } from './artifact-parse.mjs'
import { readProfile } from './profile.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILES = ['intent.md', 'spec.md', 'plan.md']
export function prepareApproval(dir, approver) {
  dir = resolve(dir)
  if (!approver?.trim() || approver.startsWith('policy:') || /[\r\n]/.test(approver)) throw new Error('사람 승인자의 이름을 지정한다.')
  const profile = readProfile(dir)
  if (profile.get('approval_mode') !== 'batch_light') throw new Error('묶음 승인은 프로필의 approval_mode: batch_light 설정이 필요하다.')
  const files = FILES.map((name) => {
    const path = join(dir, name), before = readFileSync(path, 'utf8')
    const fm = frontmatter(before)
    if (!fm || fm.tier !== 'light' || fm.status !== 'in_review' || schemaVersion(fm) < 7) throw new Error(`${name}: v7 이상 light · in_review 문서만 묶음 승인한다.`)
    if (String(fm.generated_by).toLowerCase() === approver.toLowerCase()) throw new Error(`${name}: approved_by 와 generated_by 가 같다.`)
    const header = /^---\r?\n[\s\S]*?\r?\n---/.exec(before)[0]
    for (const key of ['status', 'approved_by', 'generated_by']) if ([...header.matchAll(new RegExp(`^${key}:`, 'gm'))].length !== 1) throw new Error(`${name}: ${key} 필드가 없거나 중복됐다.`)
    const afterHeader = header.replace(/^status:.*$/m, 'status: accepted')
      .replace(/^approved_by:.*$/m, `approved_by: ${JSON.stringify(approver)}`)
    return { name, path, title: fm.title, before, after: afterHeader + before.slice(header.length) }
  })
  for (const [tool, extra] of [['check-artifacts.mjs', ['--approve-as', approver]], ['lint-prose.mjs', []]]) {
    const r = spawnSync(process.execPath, [join(HERE, tool), dir, ...extra], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`${tool}: ${(r.stdout ?? '') + (r.stderr ?? '')}`)
  }
  const digest = createHash('sha256').update(JSON.stringify({ dir, approver,
    profile: readFileSync(profile.path, 'utf8'), files: files.map((f) => [f.name, f.before]) })).digest('hex')
  return { dir, approver, digest, files, profilePath: profile.path,
    profileHash: createHash('sha256').update(readFileSync(profile.path)).digest('hex') }
}

export function applyApproval(preview, digest) {
  if (digest !== preview.digest) throw new Error('검토 이후 문서·프로필·승인자가 바뀌었다. prepare 로 다시 검토한다.')
  const journalDir = join(preview.dir, '.approval')
  mkdirSync(journalDir, { recursive: true })
  const lock = join(journalDir, 'lock')
  try { mkdirSync(lock) } catch (e) {
    if (e.code === 'EEXIST') throw new Error(`다른 승인 적용 또는 중단된 적용이 있다. .approval 기록을 확인한다: ${lock}`)
    throw e
  }
  const journal = join(journalDir, `${digest}.json`)
  let recoverable = true
  try {
    if (existsSync(journal)) throw new Error(`이 승인 시도의 기록이 이미 있다. 부분 쓰기 여부를 확인한다: ${journal}`)
    if (createHash('sha256').update(readFileSync(preview.profilePath)).digest('hex') !== preview.profileHash) throw new Error('프로필이 검토 후 바뀌었다.')
    for (const f of preview.files) if (readFileSync(f.path, 'utf8') !== f.before) throw new Error(`${f.name} 가 검토 후 바뀌었다.`)
    writeFileSync(journal, JSON.stringify({ status: 'applying', ...preview }, null, 2), { flag: 'wx' })
    const written = []
    try {
      for (const f of preview.files) {
        if (readFileSync(f.path, 'utf8') !== f.before) throw new Error(`${f.name} 가 적용 중 바뀌었다.`)
        const temp = join(lock, f.name)
        writeFileSync(temp, f.after)
        renameSync(temp, f.path)
        written.push(f)
      }
      writeFileSync(journal, JSON.stringify({ status: 'approved', digest, approver: preview.approver,
        at: new Date().toISOString(), files: preview.files.map((f) => f.name) }, null, 2))
    } catch (e) {
      // Only restore files this attempt wrote, and preserve any intervening human edits.
      for (const f of written) {
        try {
          if (readFileSync(f.path, 'utf8') === f.after) writeFileSync(f.path, f.before)
          else recoverable = false
        } catch { recoverable = false }
      }
      throw e
    }
  } finally {
    // A crash or incomplete rollback leaves the lock and original bytes for inspection.
    if (recoverable) { try { rmdirSync(lock) } catch { /* a failed rename may leave its candidate */ } }
  }

  return journal
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), dir = args[0]
  const at = args.indexOf('--approver'), apply = args.indexOf('--apply')
  try {
    if (!dir || at < 0 || (apply < 0 && !args.includes('--prepare'))) throw new Error('사용법: approve-set.mjs <set> --approver <name> --prepare | --apply <digest>')
    const preview = prepareApproval(dir, args[at + 1])
    if (apply >= 0) console.log(`승인 완료: ${applyApproval(preview, args[apply + 1])}`)
    else console.log(JSON.stringify({ ...preview, files: preview.files.map(({ name, title, before, after }) => ({ name, title, before, after })) }, null, 2))
  } catch (e) { console.error(e.message); process.exit(2) }
}
