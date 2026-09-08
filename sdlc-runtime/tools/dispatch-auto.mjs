#!/usr/bin/env node
/** 자율 경로를 실행한다 — **탐지는 결정론이고, 판단만 모델에게 넘긴다.**
 *
 *  레포의 탐지 스크립트가 지표를 재서 밴드가 깨지면 이것을 부른다. 이 파일은 정책을
 *  읽고, 경로가 살아 있는지 보고, 그 경로가 허용한 **도구만** 들려 Claude 를 비대화형으로
 *  띄운다. 무엇을 해도 되는지가 문서 안의 선언이 아니라 **실행 시점의 권한**이 되는 자리다.
 *
 *  이 파일이 지키는 것 넷. 모델에게 맡기면 «지켜졌다고 문서에 적히는» 값이 된다.
 *
 *    1. 만료된 위임으로는 실행하지 않는다.
 *    2. 경로가 허용한 도구만 넘긴다 (`--allowedTools`). 사슬을 쓰는 데 드는 **배관**은
 *       정책이 아니라 여기서 더한다 — 아래 «배관» 참조.
 *    3. 다 쓴 뒤 검사기를 **이 프로세스가** 돌린다. 모델이 «검사기를 돌렸다» 고 적는 것과
 *       검사기가 실제로 돈 것은 다른 사실이다.
 *    4. 허용한 것 · 실제로 쓴 도구 · 거부된 호출 · 검사 결과를 실행 기록에 남긴다.
 *
 *  ## 배관 — 첫 end-to-end 실행에서 드러난 것
 *
 *  정책의 `tools` 만 넘기면 사슬이 서지 않았다. 셋이 막혔다.
 *
 *    - **`.claude/` 아래는 «민감한 파일» 이라 Write·Edit 이 언제나 묻는다.** `-p` 에는 답할
 *      사람이 없어 거부되고, 에이전트는 `specs-staging/` 같은 딴 자리에 문서를 두었다.
 *      허용 규칙(`Write(.claude/specs/**)`)도 훅의 `allow` 도 그 물음을 끄지 못했다.
 *      → `spec_dir` 를 `.claude/` 밖으로 옮긴다(기본 `.sdlc/specs`). 여기서는 거절한다.
 *    - **Bash 가 없으면 검사기·린터·`git log`(버전 핀) 를 못 돌린다.** 38번 시도하고 전부
 *      거부됐다. → 검사는 이 프로세스가 돌리고, `git log` 와 런타임 도구 셋만 허용한다.
 *    - **막힌 이유를 모르면 런타임 소스를 뒤진다.** 검사기·가드·디스패처 소스를 읽느라
 *      Read 23번 · Bash 38번을 썼다. → 프롬프트에 무엇이 허용됐고 무엇이 뒤에 도는지 적는다.
 *
 *  이 명령은 사슬을 `advance_to` 까지만 밀어 올린다. `approved_by` 는 사람 이름이 아니라
 *  `policy:<경로 id>` 가 되고, 검사기가 그 경로의 실재·만료·티어 한계를 대조한다.
 *
 *    node dispatch-auto.mjs <repo> --route <id> --signal "<무엇이 관측됐나>" [--dry-run]
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadPolicy, routeActive, validate } from './autonomy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null }
const DRY = argv.includes('--dry-run')
const ROOT = resolve(argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true) ?? process.cwd())
const ROUTE_ID = flag('route')
const SIGNAL = flag('signal')

const die = (msg, code = 2) => { console.error(msg); process.exit(code) }

if (!ROUTE_ID) die('사용법: dispatch-auto.mjs <repo> --route <id> --signal "<관측>" [--dry-run]')
if (!SIGNAL) die('`--signal` 이 없다 — 무엇이 관측됐는지 없이 발화할 수 없다.')

const profilePath = join(ROOT, '.claude/spec-profile.yml')
if (!existsSync(profilePath)) die(`프로필이 없다 — ${relative(ROOT, profilePath)}. \`/sdlc-init\` 을 먼저 돌린다.`)
const profile = readFileSync(profilePath, 'utf8')
const yml = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(profile)?.[1] ?? '')
  .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()

const SPEC_DIR = yml('spec_dir') || '.sdlc/specs'
/** **`.claude/` 아래는 자율로 쓸 수 없다.** Claude Code 는 그 폴더의 Write·Edit 을 «자기 설정
 *  편집» 으로 보고 언제나 묻는다 — 허용 규칙도 훅의 allow 도 그 물음을 끄지 못한다.
 *  `-p` 에는 답할 사람이 없어 산출물이 한 장도 안 써진다. */
if (SPEC_DIR === '.claude' || SPEC_DIR.startsWith('.claude/')) {
  die(`\`spec_dir: ${SPEC_DIR}\` 는 자율 경로가 쓸 수 없다 — \`.claude/\` 아래 쓰기는 Claude Code 가 언제나 사람에게 묻는다.\n` +
      '프로필의 `spec_dir` 를 `.claude/` 밖(기본 `.sdlc/specs`)으로 옮기고 사슬 폴더를 그리로 이동한다.')
}
let RUNTIME = yml('sdlc_runtime') || join(HERE, '..')
if (RUNTIME.startsWith('~/')) RUNTIME = join(process.env.HOME ?? '', RUNTIME.slice(2))
RUNTIME = resolve(ROOT, RUNTIME)

const pol = loadPolicy(ROOT, yml('autonomy'))
if (pol.missing) die(`자율 실행 정책이 없다 — ${pol.rel}. 이 레포에는 자율 경로가 없다.`)

const route = pol.routes[ROUTE_ID]
if (!route) die(`경로 \`${ROUTE_ID}\` 가 정책에 없다. 있는 것: ${Object.keys(pol.routes).join(' · ') || '(없음)'}`)

/** **만료가 이 명령의 첫 관문이다.** 만료된 위임으로 돈 실행은 지금 아무도 책임지지
 *  않는다. 그것을 실행 시점에 막지 않으면 만료일은 문서에 적힌 장식이 된다. */
if (!routeActive(route)) {
  die(`경로 \`${ROUTE_ID}\` 의 위임이 만료됐다 (${route.expires ?? '만료일 없음'}).\n` +
      '정책을 다시 검토해 갱신하거나, 이번 신호는 사람이 직접 처리한다.', 3)
}

/** **가드가 없으면 돌리지 않는다.** 자율 루트의 승인 경계(`policy:` 자기 경로만)는
 *  PreToolUse 가드가 지킨다. 그 훅이 이 레포에 등록돼 있지 않으면 «정책 승인» 은
 *  프롬프트 속 부탁일 뿐이다. */
const settingsPath = join(ROOT, '.claude/settings.json')
const settingsText = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : ''
if (!settingsText.includes('sdlc-approval.sh')) {
  die(`승인 가드가 이 레포에 없다 — ${relative(ROOT, settingsPath)} 에 sdlc-approval.sh 등록이 없다.\n` +
      `먼저 돌린다: node ${relative(ROOT, join(RUNTIME, 'tools/install-hook.mjs'))} ${ROOT}`)
}

const policyErrors = validate(pol).filter((p) => p.level === 'error')
if (policyErrors.length) die(policyErrors.map((p) => p.msg).join('\n'))

/** 사슬을 어디까지 미느냐가 곧 프롬프트다. `implement` 는 여기서 부르지 않는다 —
 *  `/implement-spec` 은 사람이 시점을 정하는 명령이고(자동 호출이 꺼져 있다), 자율
 *  경로가 그것을 우회하면 «사람이 실행 시점을 정한다» 가 글자로만 남는다. */
const CHAIN = {
  finding: '`/create-finding` 으로 finding.md 만 쓴다.',
  intent: '`/create-finding` 으로 finding.md 를 쓰고, 경로가 `intent` 면 이어서 `/create-intent` 로 intent.md 까지 쓴다.',
  spec: '`/create-finding` → `/create-intent` → `/create-spec` 순으로 쓴다.',
  plan: '`/create-finding` → `/create-intent` → `/create-spec` → `/create-plan` 순으로 쓴다.',
  implement: '`/create-finding` → `/create-intent` → `/create-spec` → `/create-plan` 까지 쓴다. **구현은 하지 않는다** — `/implement-spec` 은 사람이 부르는 명령이다. 마지막에 그 명령을 다음 단계로 안내한다.',
}

/** ── 배관 ─────────────────────────────────────────────────────────────────
 *  정책의 `tools` 는 «이 위임이 무엇을 만져도 되나» 다. 아래는 그 위임과 무관하게 사슬을
 *  **쓰는 데** 드는 최소 권한이고, 정책마다 다시 적게 하면 빠뜨린 정책이 조용히 실패한다.
 *  넓히지 않는다 — 산출물 폴더 안의 편집, 상위 문서의 커밋 SHA, 런타임 도구 셋뿐이다. */
const toolsDir = join(RUNTIME, 'tools')
const tildeTools = toolsDir.startsWith(process.env.HOME ?? '\0') ? '~' + toolsDir.slice(process.env.HOME.length) : null
const PLUMBING = [
  'Skill',
  'Bash(git log:*)', 'Bash(git status:*)', 'Bash(git diff:*)',
  ...['check-artifacts.mjs', 'lint-prose.mjs', 'bands.mjs'].flatMap((t) => [
    `Bash(node ${join(toolsDir, t)}:*)`,
    ...(tildeTools ? [`Bash(node ${tildeTools}/${t}:*)`] : []),
  ]),
]
const policyTools = String(route.tools ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const allowed = [...new Set([...policyTools, ...PLUMBING])]

const prompt = `자율 실행이다. 사람이 지금 이 자리에 없다 — **아무것도 묻지 않는다.** 물을 것이 생기면
문서의 열린 질문(FQ-* · Q-*)으로 적고 그 문서는 \`in_review\` 로 둔다.

관측된 신호: ${SIGNAL}

이 실행에 적용되는 위임(\`${pol.rel}\` 의 \`${ROUTE_ID}\`):
- 발화 종류: ${route.trigger}
- 최대 티어: ${route.max_tier} — 이보다 위험하다고 판단되면 **문서를 쓰되 승인하지 말고** 그 사실을 보고한다
- 사슬의 끝: ${route.advance_to}
- 위임 책임자: ${pol.owner}
- 만료: ${route.expires}

${CHAIN[route.advance_to]}

이 실행에서 허용된 것과 뒤에 도는 것 — **이 밖의 것을 시도하지 않는다. 막힌 이유를 찾으러
런타임 도구의 소스를 읽지 않는다.**
- 산출물은 \`${SPEC_DIR}/\` 아래에만 쓴다. 다른 자리에 두지 않는다.
- Bash 는 \`git log\` · \`git status\` · \`git diff\` 와 런타임 도구 셋(check-artifacts · lint-prose · bands)만 된다.
  테스트 · 빌드 · 네트워크 · 커밋은 이 실행에서 할 수 없다 — 필요하면 «못 한 것» 으로 적는다.
- 검사기와 린터는 스킬이 시키는 대로 돌리되, 이 실행이 끝난 뒤 디스패처가 **다시** 돌려 기록한다.
- 커밋은 디스패처가 검사 통과 뒤에 한다. 직접 커밋하지 않는다.

지켜야 할 것:
1. 만든 문서의 \`approved_by\` 는 \`policy:${ROUTE_ID}\` 로 적는다. **사람 이름을 적지 않는다.**
   \`generated_by\` 는 너 자신이다. **이 경로 id 만 쓸 수 있다** — 다른 경로를 적으면 자기보다
   넓은 위임을 빌려오는 것이라 가드가 막는다.
2. 티어가 \`${route.max_tier}\` 이하인 문서는 그 정책 승인으로 \`status: accepted\` 까지 올린다.
   **사슬은 위에서부터 순서대로다** — 상위가 \`accepted\` 여야 하위가 \`accepted\` 로 갈 수 있다.
3. 티어가 \`${route.max_tier}\` 를 넘으면 그 문서는 승인 대상이 아니다 — \`approved_by\` 를 비우고
   \`status\` 는 \`in_review\` 로 두고, 무엇이 위임을 넘었는지 적는다.
   **여기서 멈추는 것이 이 위임이 실제로 작동했다는 증거다.** 넘겨서 통과시키면 위임이 아니다.
4. 판단이 서지 않으면 승인하지 않는다. \`in_review\` 로 두고 이유를 적는 쪽이 언제나 옳다 —
   사람은 나중에 승인할 수 있지만, 잘못 선 \`accepted\` 는 아무도 다시 안 본다.
5. finding.md 의 §취한 조치 와 §하지 않은 것 을 채운다. **하지 않은 것이 감사에서 더 중요하다** —
   위임의 경계가 실제로 작동했다는 기록이기 때문이다.
6. 마지막 메시지는 만든 문서의 경로 · 각 문서의 status · 승인하지 않았다면 그 이유, 이 셋만 적는다.`

const args = ['-p', prompt, '--permission-mode', 'acceptEdits',
  '--allowedTools', allowed.join(','),
  '--output-format', 'stream-json', '--verbose']
const MAX_TURNS = Number(route.max_turns ?? 80)
if (MAX_TURNS > 0) args.push('--max-turns', String(MAX_TURNS))

// 실행 이력 자체는 다음 실행의 입력 변경으로 취급하지 않는다.
const initialStatus = spawnSync('git', ['-C', ROOT, 'status', '--porcelain', '--', '.', ':(exclude).claude/autonomy-runs.jsonl'], { encoding: 'utf8' })
if (!DRY && (initialStatus.status !== 0 || initialStatus.stdout.trim())) die('자율 실행은 변경이 없는 Git 작업 트리에서 시작한다.')
const started = new Date().toISOString()
console.log(`자율 실행 — ${ROUTE_ID}`)
console.log(`  위임: ≤${route.max_tier} · →${route.advance_to} · ${route.expires} · ${pol.owner}`)
console.log(`  정책 도구: ${policyTools.join(',') || '(없음 — 정책에 tools 가 비었다)'}`)
console.log(`  배관 도구: ${PLUMBING.join(' · ')}`)
console.log(`  신호: ${SIGNAL}`)

if (DRY) {
  console.log('\n--dry-run — 실행하지 않는다. 넘길 명령:')
  console.log(`  claude -p <프롬프트 ${prompt.length}자> --permission-mode acceptEdits --max-turns ${MAX_TURNS} \\`)
  console.log(`    --allowedTools "${allowed.join(',')}"`)
  process.exit(0)
}

/** 가드에게 «지금은 물어볼 사람이 없다» 를 알린다. `-p` 에서 훅의 "ask" 는 답할 사람이
 *  없어 거부되므로, 가드는 이 변수를 보고 자기 경로의 정책 승인만 통과시킨다. */
const r = spawnSync('claude', args, {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, SDLC_AUTONOMY_ROUTE: ROUTE_ID },
})
const ended = new Date().toISOString()

/** **실제로 한 것을 스트림에서 센다.** 도구 이름별 호출 수, 거부된 호출, 마지막 보고,
 *  비용. 모델이 «했다» 고 적은 것이 아니라 하네스가 본 것이다. */
const used = {}
const denied = []
let final = null
for (const line of (r.stdout ?? '').split('\n')) {
  if (!line.trim()) continue
  let ev; try { ev = JSON.parse(line) } catch { continue }
  const content = ev.message?.content
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'tool_use') used[b.name] = (used[b.name] ?? 0) + 1
      if (b.type === 'tool_result') {
        const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')
        if (/requested permissions|require approval|requires approval|not allowed/i.test(t)) denied.push(t.slice(0, 160))
      }
    }
  }
  if (ev.type === 'result') final = ev
}
console.log('\n── 에이전트의 마지막 보고 ──')
console.log(final?.result ?? (r.stderr || '(결과 없음)').slice(0, 2000))
console.log(`\n도구 사용: ${Object.entries(used).map(([k, v]) => `${k}×${v}`).join(' · ') || '(없음)'}`)
if (denied.length) console.log(`거부된 호출 ${denied.length}건:\n  ${denied.slice(0, 8).join('\n  ')}`)

/** **검사는 이 프로세스가 돌린다.** 에이전트가 돌렸든 안 돌렸든, 기록에 남는 판정은
 *  여기서 난 것이다. 오류가 있으면 커밋하지 않고 사람에게 넘긴다. */
const checkAll = spawnSync(process.execPath, [join(toolsDir, 'check-all.mjs'), ROOT, '--required'], { encoding: 'utf8' })
const checkOut = (checkAll.stdout ?? '') + (checkAll.stderr ?? '')
console.log('\n── 검사 (디스패처) ──')
console.log(checkOut.trim())
const checkOk = checkAll.status === 0

/** 통과했을 때만 산출물 폴더를 커밋한다. 상위 문서의 커밋 SHA 가 하위의 버전 핀이라,
 *  커밋되지 않은 사슬은 다음 칸(사람이 여는 `/create-spec`)에서 핀을 찍을 수 없다. */
let commit = null
const status = spawnSync('git', ['-C', ROOT, 'status', '--porcelain', '--', SPEC_DIR], { encoding: 'utf8' })
const changed = status.stdout?.trim()
const agentOk = r.status === 0 && final?.is_error !== true && final?.subtype === 'success'
const staged = spawnSync('git', ['-C', ROOT, 'diff', '--cached', '--name-only', '-z'], { encoding: 'utf8' })
const indexClean = staged.status === 0 && !staged.stdout
if (agentOk && checkOk && status.status === 0 && changed && indexClean) {
  const subject = `docs(sdlc): ${ROUTE_ID} — ${SIGNAL.slice(0, 60)}`
  const body = `자율 실행이 ${route.advance_to} 까지 세운 사슬. 위임: ${pol.rel} 의 ${ROUTE_ID} (≤${route.max_tier}, ${pol.owner}).\n\nSDLC-Route: ${ROUTE_ID}`
  const added = spawnSync('git', ['-C', ROOT, 'add', '--', SPEC_DIR], { encoding: 'utf8' })
  const c = added.status === 0 ? spawnSync('git', ['-C', ROOT, 'commit', '-q', '-m', subject, '-m', body], { encoding: 'utf8' }) : added
  if (c.status === 0) commit = spawnSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  else console.error(`커밋 실패:\n${c.stderr}`)
}

const logPath = join(ROOT, '.claude/autonomy-runs.jsonl')
mkdirSync(dirname(logPath), { recursive: true })
appendFileSync(logPath, JSON.stringify({
  started, ended, route: ROUTE_ID, signal: SIGNAL,
  allowed: { max_tier: route.max_tier, advance_to: route.advance_to, tools: policyTools, plumbing: PLUMBING },
  owner: pol.owner, expires: route.expires,
  exit: r.status ?? null, turns: final?.num_turns ?? null, cost_usd: final?.total_cost_usd ?? null,
  used, denied: denied.length, check: checkOk ? 'pass' : 'fail', commit,
}) + '\n')
console.log(`\n실행 기록: ${relative(ROOT, logPath)}`)

if (!agentOk) {
  console.error(`\n자율 실행이 실패했다 (exit ${r.status}). 사람이 봐야 한다.`)
  process.exit(1)
}
if (!checkOk) {
  console.error('\n검사기가 오류를 냈다 — 커밋하지 않았다. 산출물은 작업 트리에 그대로 있고 사람이 봐야 한다.')
  process.exit(1)
}
if (!changed) {
  console.error(`\n산출물이 한 장도 생기지 않았다 — ${SPEC_DIR} 에 변경이 없다. 에이전트의 보고와 무관하게 이 실행은 실패다.`)
  process.exit(1)
}
if (!commit) die('커밋을 완료하지 못했다. 인덱스와 Git 오류를 확인한다.', 1)
console.log(`\n사슬이 \`${route.advance_to}\` 까지 섰다 (커밋 ${commit ?? '실패'}). 위임 안의 문서는 \`policy:${ROUTE_ID}\` 로 승인됐다.`)
console.log('위임을 넘은 것은 `in_review` 로 남아 사람을 기다린다 — 무엇이 남았는지는 finding.md 의 §하지 않은 것 에 있다.')
