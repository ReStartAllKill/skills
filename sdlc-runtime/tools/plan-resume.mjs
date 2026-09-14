#!/usr/bin/env node
/** Read-only recovery: distinguish implementation, integration checks and final completion. */
import { parseCommitRecords, ownsTaskCommit } from './commit-records.mjs'
import { existsSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const DIR = resolve(args.find((a) => !a.startsWith('--')) ?? '.')
const json = args.includes('--json')
function read(tool) {
  const r = spawnSync(process.execPath, [join(HERE, tool), DIR, '--json'], { encoding: 'utf8' })
  try { return JSON.parse(r.stdout) } catch { throw new Error(`${tool}: ${(r.stderr || r.stdout || 'no report').trim()}`) }
}
try {
  const plan = read('plan-levels.mjs'), progress = read('plan-progress.mjs')
  const ROOT = plan.root
  const git = (...a) => {
    const r = spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error((r.stderr || `git ${a.join(' ')} failed`).trim())
    return a.includes('-z') ? r.stdout : r.stdout.trim()
  }
  const action = (action, tasks = [], level = null, reason = '') => ({ action, tasks, level, reason })
  const rows = new Map(progress.rows.map((r) => [r.id, r]))
  const next = (() => {
    const errors = [...plan.problems, ...progress.notes.filter((n) => n.level === 'error').map((n) => n.msg)]
    if (!ROOT || !progress.born) return action('blocked', [], null, '프로필과 커밋된 plan 이 필요하다.')
    if (errors.length) return action('blocked', [], null, errors.join('\n'))
    if (!['accepted', 'in_progress', 'completed'].includes(plan.status)) return action('blocked', [], null, '먼저 plan 을 검토하고 승인한다.')
    if (git('branch', '--show-current') !== plan.target_branch) return action('blocked', [], null, `target_branch ${plan.target_branch} 에서 재개한다.`)
    // Pending logs and checkbox records are expected after interruption; unrelated edits are not.
    const raw = git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames')
    const changed = raw.split('\0').filter(Boolean).map((p) => p.slice(3))
    const permitted = (p) => p === relative(ROOT, join(DIR, 'plan.md')) || p.startsWith(progress.logDir + '/')
    const outside = changed.filter((p) => !permitted(p))
    if (outside.length) return action('blocked', [], null, `미커밋 변경을 보존하고 먼저 확인한다: ${outside.join(', ')}`)
    for (const level of plan.levels) {
      const pending = level.tasks.filter((t) => !rows.get(t.id).commits.length)
      if (pending.length) {
        for (const task of pending) {
          const branch = plan.task_branch.replaceAll('{slug}', plan.slug).replaceAll('{task}', task.id)
          const wt = resolve(ROOT, plan.worktree_dir, `${plan.slug}-${task.id}`)
          const found = git('branch', '--list', branch)
          if (!found && !existsSync(wt)) continue
          const body = found ? git('log', '--format=%H%x1f%B%x1e', `HEAD..${branch}`) : ''
          const owned = parseCommitRecords(body).some((c) => ownsTaskCommit(c, task.id, relative(ROOT, join(DIR, 'plan.md'))))
          return { ...action(owned ? 'merge' : 'resume_worktree', [task.id], level.n,
            owned ? '귀속 커밋이 작업 브랜치에 있다. 다시 구현하지 않고 병합한다.' : '기존 워크트리의 변경을 확인해 이어서 구현한다.'), worktree: wt, branch }
        }
        return action('implement', pending.map((t) => t.id), level.n, '귀속 커밋이 없는 작업만 구현한다.')
      }
      if (level.n !== plan.levels.at(-1).n && level.tasks.some((t) => !rows.get(t.id).integrated.length && !rows.get(t.id).verified.length)) {
        return action('verify_scoped', level.tasks.map((t) => t.id), level.n, '이 레벨은 병합됐지만 합류점 검증 증거가 없다. 프로필에 verify_scoped 가 없으면 전체 verify 를 실행한다.')
      }
    }
    const all = progress.rows.map((r) => r.id)
    const last = plan.levels.at(-1)?.n ?? null
    if (progress.rows.some((r) => !r.verified.length)) return action('verify_full', all, last, '전체 작업 ID로 마지막 전체 verify 를 실행한다.')
    if (plan.status === 'completed' && changed.length && progress.rows.every((r) => r.done)) return action('commit_completion', all, last, '완료 상태로 바꾼 plan 과 이 세트의 검증 로그만 커밋한다. plan-check commit 은 in_progress 전용이다.')
    if (progress.rows.some((r) => !r.done) || changed.length) return action('record', all, last, '미체크 작업을 mark 하고 계획서와 각 레벨 검증 로그를 커밋한다.')
    if (plan.status !== 'completed') return action('review_completion', all, last, '추가 게이트·수동 검증·AC 감사를 확인한 뒤 completed 로 기록한다.')
    return action('complete', all, last, '완료 상태와 전체 검증 증거가 일치한다.')
  })()
  const report = { version: 1, dir: DIR, ...next, states: progress.rows.map((r) => ({ id: r.id,
    state: r.done ? 'completed' : r.verified.length ? 'verified' : r.integrated.length ? 'integrated' : r.commits.length ? 'implemented' : 'pending' })) }
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    for (const row of report.states) console.log(`${row.id}: ${row.state}`)
    console.log(`\n다음: ${report.action}${report.level ? ` · 레벨 ${report.level}` : ''} · ${report.tasks.join(' ')}\n${report.reason}`)
    if (report.worktree) console.log(`워크트리: ${report.worktree} · 브랜치: ${report.branch}`)
  }
  process.exit(next.action === 'blocked' ? 1 : 0)
} catch (e) {
  if (json) console.log(JSON.stringify({ version: 1, action: 'blocked', reason: e.message }))
  else console.error(e.message)
  process.exit(2)
}
