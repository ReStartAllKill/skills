#!/usr/bin/env node
import { resolve, dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareApproval } from './approve-set.mjs'

try {
  const event = JSON.parse(process.env.SDLC_HOOK_JSON || '{}')
  const command = event.tool_input?.command ?? ''
  // Accept only a direct invocation. Expansion, pipelines and extra shell actions
  // cannot share the approval that belongs to these three documents.
  const tokens = [], chars = [...command]
  let token = '', quote = null, active = false
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (quote === "'") { if (c === "'") quote = null; else token += c; active = true; continue }
    if (/[`$\n\r;&|<>]/.test(c)) throw new Error('묶음 승인 명령은 다른 셸 명령이나 확장과 함께 실행할 수 없다.')
    if (c === '\\') { if (++i === chars.length) throw new Error('잘못된 셸 인용'); token += chars[i]; active = true; continue }
    if (quote) { if (c === quote) quote = null; else token += c; active = true; continue }
    if (c === "'" || c === '"') { quote = c; active = true; continue }
    if (/\s/.test(c)) { if (active) tokens.push(token); token = ''; active = false; continue }
    token += c; active = true
  }
  if (quote) throw new Error('닫히지 않은 셸 인용')
  if (active) tokens.push(token)
  const [node, script, dir, approverFlag, approver, mode, digest] = tokens
  const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const expected = join(dirname(fileURLToPath(import.meta.url)), 'approve-set.mjs')
  if (basename(node ?? '') !== 'node' || resolve(cwd, script ?? '') !== expected || approverFlag !== '--approver' ||
    !['--prepare', '--apply'].includes(mode) || tokens.length !== (mode === '--prepare' ? 6 : 7)) throw new Error('직접 호출 형식: node <runtime>/tools/approve-set.mjs <set> --approver <name> --apply <digest>')
  if (mode === '--prepare') process.exit(0)
  if (process.env.SDLC_AUTONOMY_ROUTE) throw new Error('묶음 승인은 사람 세션에서만 실행한다.')
  const preview = prepareApproval(resolve(cwd, dir), approver)
  if (preview.digest !== digest) throw new Error('검토 이후 문서·프로필·승인자가 바뀌었다. prepare 로 다시 검토한다.')
  if (event.permission_mode === 'dontAsk') throw new Error('사람에게 승인 요청을 전달할 수 없는 권한 모드다.')
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask',
    permissionDecisionReason: `light 변경 묶음 승인 — ${preview.dir}\n${preview.files.map((f) => `${f.name}: ${f.title}`).join('\n')}\n승인자: ${approver}\n검토 버전: ${digest}\n검토한 세 문서를 함께 승인합니다.`,
  } }))
} catch (e) { console.error(e.message); process.exit(2) }
