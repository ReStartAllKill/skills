#!/usr/bin/env node
/** Evaluate the proposed document with the same frontmatter parser as the checker.
 * The shell wrapper owns repository/path discovery and the best-effort Bash guard. */
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { frontmatter, isNull, ADR_FILENAME } from './artifact-parse.mjs'
import { SECTION, sectionBlock, RE_NA } from './keywords.mjs'

const deny = (message) => { console.error(message); process.exit(2) }
try {
  const event = JSON.parse(process.env.SDLC_HOOK_JSON || '{}')
  const input = event.tool_input ?? {}
  const file = input.file_path
  if (!file) process.exit(0)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
  let after = before
  // Older hook adapters supply metadata fragments without old_string. Parse those
  // conservatively; normal Edit/Write calls are evaluated as complete documents.
  const parse = (text) => frontmatter(text) ?? frontmatter(`---\n${text}\n---`) ?? {}
  const previous = parse(before)
  let next
  if (event.tool_name === 'Write') {
    after = input.content ?? ''
    next = parse(after)
  } else {
    const edits = input.edits ?? [input]
    for (const edit of edits) {
      if (typeof edit.old_string !== 'string') {
        next = { ...(next ?? previous), ...parse(edit.new_string ?? '') }
        continue
      }
      if (!edit.old_string || !after.includes(edit.old_string)) deny('승인 가드: 편집 전 내용을 찾지 못했다. 파일을 다시 읽고 편집한다.')
      const count = after.split(edit.old_string).length - 1
      if (count > 1 && !edit.replace_all) deny('승인 가드: 편집 위치가 모호하다. old_string 을 더 구체적으로 지정한다.')
      after = edit.replace_all ? after.replaceAll(edit.old_string, edit.new_string ?? '')
        : after.replace(edit.old_string, edit.new_string ?? '')
    }
    next ??= parse(after)
  }
  const metadata = /^---\r?\n([\s\S]*?)\r?\n---/.exec(after)?.[1] ?? ''
  for (const key of ['status', 'approved_by', 'generated_by']) {
    if ([...metadata.matchAll(new RegExp(`^${key}:`, 'gm'))].length > 1) {
      deny(`승인 메타데이터(status/approved_by/generated_by)가 중복됐다: ${key}. 하나의 값으로 고친다.`)
    }
  }
  const scalar = (v) => isNull(v) || v === '~' ? '' : String(v).trim()
  const current = scalar(previous.status), target = scalar(next.status)
  const approver = scalar(next.approved_by), writer = scalar(next.generated_by)
  const approval = (target === 'accepted' && current !== 'accepted') ||
    (approver && approver !== scalar(previous.approved_by))
  const changed = before !== after, moved = target !== current
  // The wrapper knows the kind from the profile's adr_dir (sdlc_resolve). The file-name fallback
  // is for a direct invocation without the wrapper; guessing «not an ADR» there would hand an
  // accepted decision the intent/spec exemptions below, which is the hole this split closes.
  const kind = process.env.SDLC_KIND
  const adr = kind ? kind === 'adr' : ADR_FILENAME.test(basename(file))
  const plan = !adr && basename(file) === 'plan.md'

  // «Status only» ignores `updated:` as policy-history's contract does: a writer that bumps the date
  // along with the status has changed nothing a person approved.
  const unstatus = (s) => s.replace(/^---\r?\n[\s\S]*?\r?\n---/, (m) => m.replace(/^(?:status|updated):.*$/gm, ''))
  const statusOnly = unstatus(before) === unstatus(after)
  const stripBoxes = (s) => s.replace(/^(\s*[-*]\s*)\[[ xX]\]/gm, '$1[]')
  const checkboxOnly = plan && changed && stripBoxes(before) === stripBoxes(after)
  // An addition to the execution log, the rest unchanged. `plan-check mark` writes this section
  // through fs and never meets the guard; this is for the hand-written entries the skills ask for —
  // a change-log line under the log. Existing lines must survive in order (only the «not run yet»
  // placeholder may go): rewriting what happened is not an addition.
  const splitLog = (s) => {
    const m = sectionBlock(SECTION.executionLog).exec(s)
    return m ? [s.slice(0, m.index) + s.slice(m.index + m[0].length), m[0]] : [s, '']
  }
  const logAddition = (() => {
    if (!plan || !changed || moved) return false
    const [restA, logA] = splitLog(before), [restB, logB] = splitLog(after)
    if (stripBoxes(restA).trimEnd() !== stripBoxes(restB).trimEnd()) return false
    const kept = logB.split('\n')
    let at = 0
    for (const line of logA.split('\n').filter((l) => l.trim() && !RE_NA.test(l))) {
      while (at < kept.length && kept[at] !== line) at++
      if (at++ >= kept.length) return false
    }
    return true
  })()

  // Each rule names what a person is being asked, so the dialog does not read «accepted → accepted».
  const reason = (() => {
    if (approval && (!adr || !['accepted', 'superseded', 'deprecated', 'rejected'].includes(current))) {
      return moved ? `승인 — ${current || '없음'} → ${target || '상태 없음'}` : `승인자 변경 — ${approver}`
    }
    if (adr) {
      // An ADR is not pulled back the way an intent is: leaving `accepted` removes a constraint code
      // relies on, and a closed decision is history. Only draft and in_review are free to edit.
      if (current === 'accepted' && moved) return `결정 은퇴 — 효력 있는 결정을 accepted → ${target || '상태 없음'} 으로 내린다`
      if (current === 'accepted' && changed) return '효력 있는 결정의 내용 변경'
      if (['superseded', 'deprecated', 'rejected'].includes(current) && (changed || moved)) {
        return `종료된 결정 기록(${current})의 변경 — 이력을 고친다`
      }
      return null
    }
    if (plan && ['in_progress', 'completed'].includes(target) && moved &&
      !(statusOnly && ((current === 'accepted' && target === 'in_progress') ||
        (current === 'in_progress' && target === 'completed')))) {
      // in_review → in_progress used to pass: a plan pulled back for a change could re-enter execution
      // with nobody approving the change. The way back is accepted (the re-approval), then in_progress.
      return `실행 상태로 건너뛰는 전이 — ${current || '없음'} → ${target}. 정상 경로는 accepted → in_progress → completed 이며 상태만 바꾼다`
    }
    if (plan && ['in_progress', 'completed'].includes(current)) {
      const pulledBack = ['in_review', 'superseded', 'rejected'].includes(target) && statusOnly
      if (!changed && !moved) return null
      const finished = statusOnly && current === 'in_progress' && target === 'completed'
      if (checkboxOnly || logAddition || pulledBack || finished) return null
      return `${current === 'completed' ? '완료된' : '실행 중인'} 계획의 내용 변경 — 작업·결정을 바꾸려면 먼저 상태만 in_review 로 되돌린다`
    }
    const reverted = ['in_review', 'rejected', 'superseded'].includes(target)
    const executionStart = plan && target === 'in_progress' && statusOnly
    if (current === 'accepted' && !reverted && !executionStart && !checkboxOnly && (changed || moved)) {
      return moved ? `승인된 문서의 상태 변경 — accepted → ${target || '상태 없음'}` : '승인된 문서의 내용 변경'
    }
    return null
  })()
  if (!reason) process.exit(0)

  const route = process.env.SDLC_AUTONOMY_ROUTE
  if (route) {
    // Routes delegate finding/intent/spec/plan up to `advance_to`; no route delegates a decision.
    // Before this, a route could approve or retire an ADR by writing its own policy:<route>.
    if (adr) deny(`ADR 은 어떤 자율 경로의 위임에도 들지 않는다 — ${reason}. 사람 세션에서 다룬다 — ${file}`)
    if (approver === `policy:${route}`) process.exit(0)
    deny(`자율 실행의 승인자는 policy:${route} 여야 한다. 사람 이름이나 다른 경로로 승인할 수 없다 — ${file}`)
  }
  if (approver.startsWith('policy:')) deny(`사람 세션에서는 정책 승인을 쓸 수 없다 — ${approver}`)
  if (writer && approver.toLowerCase() === writer.toLowerCase()) {
    deny(`approved_by 가 generated_by 와 같다 (${writer}). 작성자와 다른 사람이 승인해야 한다.`)
  }
  if (event.permission_mode === 'dontAsk') deny(`승인 다이얼로그가 사람에게 가지 않는 권한 모드다 (${reason}). 권한 모드를 바꾸고 다시 승인한다.`)
  console.log(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'ask',
    permissionDecisionReason: `사람의 확인이 필요한 편집입니다 — ${reason}: ${file}. 변경 내용을 확인하고 승인하거나 거절하세요.`,
  } }))
} catch (e) {
  deny(`승인 가드가 편집을 해석하지 못했다 — ${e.message}`)
}
