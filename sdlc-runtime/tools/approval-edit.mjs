#!/usr/bin/env node
/** Evaluate the proposed document with the same frontmatter parser as the checker.
 * The shell wrapper owns repository/path discovery and the best-effort Bash guard. */
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { frontmatter, isNull, bodyOf } from './artifact-parse.mjs'

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
  const plan = basename(file) === 'plan.md'
  const reverted = ['in_review', 'rejected', 'superseded'].includes(target)
  const stripBoxes = (s) => s.replace(/^(\s*[-*]\s*)\[[ xX]\]/gm, '$1[]')
  const executionStart = plan && target === 'in_progress' && bodyOf(before) === bodyOf(after)
  const checkboxOnly = plan && before !== after && stripBoxes(before) === stripBoxes(after)
  const protectedEdit = current === 'accepted' && !reverted && !executionStart && !checkboxOnly &&
    (before !== after || target !== current)
  if (!approval && !protectedEdit) process.exit(0)

  const route = process.env.SDLC_AUTONOMY_ROUTE
  if (route) {
    if (approver === `policy:${route}`) process.exit(0)
    deny(`자율 실행의 승인자는 policy:${route} 여야 한다. 사람 이름이나 다른 경로로 승인할 수 없다 — ${file}`)
  }
  if (approver.startsWith('policy:')) deny(`사람 세션에서는 정책 승인을 쓸 수 없다 — ${approver}`)
  if ((approval || protectedEdit) && writer && approver.toLowerCase() === writer.toLowerCase()) {
    deny(`approved_by 가 generated_by 와 같다 (${writer}). 작성자와 다른 사람이 승인해야 한다.`)
  }
  if (event.permission_mode === 'dontAsk') deny('승인 다이얼로그가 사람에게 가지 않는 권한 모드다. 권한 모드를 바꾸고 다시 승인한다.')
  console.log(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'ask',
    permissionDecisionReason: `승인 전이입니다 — ${file}: ${current || '없음'} → ${target || '본문 변경'}. 변경 내용을 확인하고 승인하거나 거절하세요.`,
  } }))
} catch (e) {
  deny(`승인 가드가 편집을 해석하지 못했다 — ${e.message}`)
}
