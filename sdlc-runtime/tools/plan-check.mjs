#!/usr/bin/env node
/** 체크박스와 §실행 기록 을 갱신하고, 그 갱신만 커밋한다.
 *
 *  `/implement-spec` 에서 **이 한 걸음만 도구가 없었다.** 레벨 · 워크트리 · 커밋 · 프롬프트 ·
 *  검증 기록은 전부 도구가 내는데(규칙 11) §2e 만 모델의 손이었고, 하필 그 자리는 병렬
 *  에이전트와 합류점 검증이 끝난 **가장 컨텍스트가 무거운 지점** 바로 뒤다.
 *
 *  게다가 지시가 스스로 모순이었다. §2e 는 «이 갱신을 verify 로그와 함께 커밋한다» 고 하는데
 *    · `task-worktree commit` 은 그 작업의 `files` 밖을 스테이징하지 않는다 — plan.md 는 언제나 밖이다
 *    · 규칙 8 은 `git add -A` · `git add .` 를 금한다
 *  그래서 인가된 명령이 하나도 없었고 모델이 매번 생짜 git 을 지어냈다. 안 지어내면 메인 트리가
 *  더러운 채로 남아 **다음 레벨의 `merge` 가 죽는다**(task-worktree.mjs 의 더티 검사).
 *
 *  여기서는 둘을 가른다 — `mark` 는 계획서만 고치고, `commit` 은 계획서와 그 레벨의 검증
 *  로그**만** 스테이징한다. 경로를 명시적으로 대므로 규칙 8 을 깨지 않는다.
 *
 *    node plan-check.mjs <스펙 폴더> mark   <WP> --note "<계획과의 차이>" [--result 완료|부분|실패] [--pr <링크>] [--dry-run]
 *    node plan-check.mjs <스펙 폴더> commit --level <N> [--gate <로그>]… [-m "<제목>"] [--dry-run]
 *
 *  **판정은 여전히 사람·모델의 것이다.** 이 도구는 「무엇이 사실인가」(귀속 커밋 · verify 기록)를
 *  `plan-progress.mjs` 에게 물어 **증거가 없으면 거절할** 뿐, 「수용 기준을 만족했나」를 대신
 *  정하지 않는다. `--note` 를 필수로 받는 이유가 그것이다 — 기계가 만들 수 없는 값이고,
 *  비워 두면 계획서는 «하려던 것» 만 알고 «한 것» 은 모르는 문서가 된다.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, relative, basename, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const die = (msg, code = 2) => { console.error(msg); process.exit(code) }
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const flags = (n) => argv.map((a, i) => (a === n ? argv[i + 1] : null)).filter(Boolean)
const DRY = argv.includes('--dry-run')

const positional = argv.filter((a, i) => !a.startsWith('-') && !(i > 0 && argv[i - 1].startsWith('-')))
const [dirArg, CMD, TASK] = positional
if (!dirArg || !['mark', 'commit'].includes(CMD ?? '')) {
  die('사용법:\n' +
      '  plan-check.mjs <스펙 폴더> mark   <WP> --note "<계획과의 차이>" [--result 완료|부분|실패] [--pr <링크>] [--dry-run]\n' +
      '  plan-check.mjs <스펙 폴더> commit --level <N> [--gate <로그>]… [-m "<제목>"] [--dry-run]')
}
const DIR = resolve(dirArg)
const PLAN = join(DIR, 'plan.md')
if (!existsSync(PLAN)) die(`plan.md 가 없다 — ${DIR}`)

let ROOT = null
for (let d = DIR, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
  if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { ROOT = d; break }
}
if (!ROOT) die(`프로필을 못 찾았다 — ${DIR} 의 조상에 .claude/spec-profile.yml 이 없다.`)
const profile = readFileSync(join(ROOT, '.claude/spec-profile.yml'), 'utf8')
const yml = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(profile)?.[1] ?? '')
  .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()

const git = (...a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' })
const ok = (r) => r.status === 0
const sout = (r) => (r.stdout ?? '').trim()

/** 사실은 `plan-progress` 가 잰다 — 여기서 커밋 로그를 다시 훑지 않는다(규칙 11). */
const progress = (() => {
  const r = spawnSync(process.execPath, [join(HERE, 'plan-progress.mjs'), DIR, '--json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  try { return JSON.parse(r.stdout) } catch { return die(`plan-progress 를 읽지 못했다:\n${r.stdout}${r.stderr}`) }
})()
const levels = (() => {
  const r = spawnSync(process.execPath, [join(HERE, 'plan-levels.mjs'), DIR, '--json'], { encoding: 'utf8' })
  try { return JSON.parse(r.stdout) } catch { return null }
})()

const planText = readFileSync(PLAN, 'utf8')
const fm = /^---\n[\s\S]*?\n---\n/.exec(planText)?.[0] ?? ''
const status = /^status:[ \t]*["']?([\w-]+)/m.exec(fm)?.[1] ?? ''

// ── 실행 상태가 아니면 손대지 않는다 ────────────────────────────────────────
// `accepted` 인 계획서의 본문을 고치는 것은 승인 가드가 사람에게 묻는 자리다. 도구가
// 그 물음을 우회하면 가드는 Edit 만 지키는 반쪽이 된다. 여기서는 거절하고, 사람·모델이
// 밟아야 할 한 걸음(accepted → in_progress, 가드가 명시적으로 허용하는 전이)을 말한다.
if (status !== 'in_progress') {
  die(`plan 의 status 가 \`${status || '(없음)'}\` 다 — 실행 중인 계획서만 갱신한다.\n` +
      `  실행을 시작(또는 재개)한다면 먼저 status 를 \`in_progress\` 로 바꾸고 커밋한다.\n` +
      `  그 전이는 승인 가드가 허용한다(accepted → in_progress). 되돌아간 것이라면 왜 되돌아갔는지\n` +
      `  §변경 기록을 보고, /iterate-spec 이 재승인 뒤 in_progress 로 복귀시켰어야 한 자리다.`)
}

// ────────────────────────────────────────────────────────────────────────────
if (CMD === 'mark') {
  if (!TASK) die('어느 작업인지 없다 — `mark <WP-id>`')
  const NOTE = flag('--note')
  const RESULT = flag('--result') ?? '완료'
  const PR = flag('--pr') ?? 'PR 없음'
  if (!NOTE) die('`--note "<계획과의 차이>"` 가 없다 — 기계가 만들 수 없는 값이라 비워 둘 수 없다. 차이가 없으면 `--note 없음`.')
  if (!['완료', '부분', '실패'].includes(RESULT)) die('`--result` 는 완료 · 부분 · 실패 중 하나다.')

  const row = progress.rows.find((r) => r.id === TASK)
  if (!row) die(`${TASK} 가 plan.md 의 작업이 아니다. 있는 것: ${progress.rows.map((r) => r.id).join(' · ')}`)
  if (row.done) die(`${TASK} 는 이미 체크돼 있다 — 다시 적지 않는다. 기록을 고치려면 손으로 §실행 기록을 편집한다.`, 0)

  // 증거가 없으면 «완료» 로 적지 않는다. 실패·부분 기록은 증거가 없는 것이 정상이다.
  if (RESULT === '완료') {
    if (!row.commits.length) die(`${TASK} 에 귀속 커밋이 없다 — \`SDLC-Task: ${TASK}\` trailer 가 붙은 커밋이 있어야 한다.\n  아직 합류 전이면 \`task-worktree.mjs <스펙> commit|merge ${TASK}\` 가 먼저다.`)
    if (!row.verified.length) die(`${TASK} 에 합류점 verify 기록이 없다 — 통과했다는 주장의 증거는 그 로그다.\n  \`verify-run.mjs <스펙> --level <N> --tasks ${TASK} -- "<프로필 verify>"\` 를 먼저 돌린다.`)
  }

  const today = new Date().toLocaleDateString('sv-SE')
  const commits = row.commits.map((c) => `\`${c.slice(0, 7)}\``).join(' ')
  const verify = row.verified.map((v) => `\`${v}\``).join(' ')
  const line = `- ${today} ${TASK} — ${RESULT}` +
    (commits ? ` · commit: ${commits}` : '') +
    (verify ? ` · verify: ${verify}` : '') +
    ` · ${PR} · 계획과의 차이: ${NOTE}`

  // 체크박스 — 그 작업의 줄 하나만 뒤집는다.
  const box = new RegExp(`^(\\s*[-*]\\s*)\\[ \\](\\s*\\*\\*${TASK}\\b)`, 'm')
  if (!box.test(planText)) die(`${TASK} 의 미체크 항목을 못 찾았다 — plan.md 의 작업 줄 형식을 확인한다.`)
  let next = planText.replace(box, '$1[x]$2')

  // §실행 기록 — `### …` 하위 절 **앞**이 이 기록의 자리다. 변경 기록·감사 절에 섞이면
  // 나중에 그 절을 통째로 읽는 도구가 작업 ID 를 오인한다.
  const secStart = /^##\s*실행 기록.*$/m.exec(next)
  if (!secStart) die('§실행 기록 절이 없다 — plan 템플릿의 필수 절이다.')
  const bodyFrom = secStart.index + secStart[0].length
  const after = next.slice(bodyFrom)
  const stop = (() => {
    const m = /^#{2,}\s/m.exec(after)
    return m ? bodyFrom + m.index : next.length
  })()
  let body = next.slice(bodyFrom, stop)
  const placeholder = /^[ \t]*해당 없음[^\n]*$/m.exec(body)
  if (placeholder) {
    body = body.slice(0, placeholder.index) + line + body.slice(placeholder.index + placeholder[0].length)
  } else {
    const entries = [...body.matchAll(/^-[ \t][^\n]*(?:\n(?![ \t]*\n|[-*#][ \t]|#)[^\n]*)*/gm)]
    const last = entries[entries.length - 1]
    if (last) body = body.slice(0, last.index + last[0].length) + '\n' + line + body.slice(last.index + last[0].length)
    else body = body.replace(/\s*$/, '') + `\n\n${line}\n`
  }
  next = next.slice(0, bodyFrom) + body + next.slice(stop)

  // 프런트매터는 한 글자도 건드리지 않는다 — 이 도구는 승인 필드에 닿을 일이 없다.
  const nextFm = /^---\n[\s\S]*?\n---\n/.exec(next)?.[0] ?? ''
  if (nextFm !== fm) die('프런트매터가 바뀌었다 — 도구의 버그다. 아무것도 쓰지 않았다.')

  if (DRY) { console.log(`(dry-run) ${TASK} → [x]\n(dry-run) ${line}`); process.exit(0) }
  writeFileSync(PLAN, next)
  console.log(`${TASK} → [x]  (${relative(ROOT, PLAN)})`)
  console.log(`  ${line}`)
  console.log(`\n레벨의 나머지 작업까지 적었으면: plan-check.mjs ${relative(ROOT, DIR)} commit --level <N>`)
}

// ────────────────────────────────────────────────────────────────────────────
if (CMD === 'commit') {
  const LEVEL = flag('--level')
  if (!/^[1-9]\d*$/.test(LEVEL ?? '')) die('`--level <N>` 이 없다 — 어느 합류점의 기록인지 없이 커밋하지 않는다.')

  const branch = sout(git('branch', '--show-current'))
  if (levels?.target_branch && branch !== levels.target_branch) {
    die(`메인 트리가 ${branch || '(분리된 HEAD)'} 에 있다 — target_branch ${levels.target_branch} 가 아니다.`)
  }

  // 이 레벨의 검증 로그 — verify-run 이 `L<N>…` 으로 남긴다.
  const logDir = resolve(ROOT, yml('verify_log_dir') || '.sdlc/verify', basename(DIR))
  const logs = existsSync(logDir)
    ? readdirSync(logDir).filter((f) => f.startsWith(`L${LEVEL}-`) && f.endsWith('.log')).map((f) => relative(ROOT, join(logDir, f)))
    : []
  const gates = flags('--gate').map((g) => relative(ROOT, resolve(g)))
  const paths = [relative(ROOT, PLAN), ...logs, ...gates]

  // 남의 변경이 이미 인덱스에 있으면 손대지 않는다 — task-worktree 와 같은 규칙이다.
  const staged = git('diff', '--cached', '--name-only', '-z', '--no-renames')
  if (!ok(staged)) die(`인덱스를 읽지 못했다:\n${(staged.stdout ?? '') + (staged.stderr ?? '')}`)
  const outside = (staged.stdout ?? '').split('\0').filter((f) => f && !paths.includes(f))
  if (outside.length) die(`이 커밋의 것이 아닌 파일이 이미 스테이징되어 있다 — 인덱스를 변경하지 않았다: ${outside.join(', ')}`)

  const checked = progress.rows.filter((r) => r.done).map((r) => r.id)
  const inLevel = levels?.levels?.find((l) => String(l.n) === LEVEL)?.tasks?.map((t) => t.id) ?? []
  const marked = inLevel.filter((id) => checked.includes(id))
  const msg = flag('-m') ?? flag('--message') ??
    `chore(sdlc): ${(marked.length ? marked : [`레벨 ${LEVEL}`]).join('·')} 완료 기록과 레벨 ${LEVEL} 검증 로그`

  if (DRY) {
    console.log(`(dry-run) 스테이징: ${paths.join(', ')}`)
    console.log(`(dry-run) 커밋 제목: ${msg}`)
    process.exit(0)
  }
  let r = git('add', '--', ...paths)
  if (!ok(r)) die(`git add 실패:\n${(r.stdout ?? '') + (r.stderr ?? '')}`)
  if (!sout(git('diff', '--cached', '--name-only'))) die('커밋할 변경이 없다 — 계획서도 검증 로그도 그대로다.', 0)
  r = git('commit', '-q', '-m', msg, '-m', `SDLC-Plan: ${relative(ROOT, PLAN)}`)
  if (!ok(r)) die(`commit 실패:\n${(r.stdout ?? '') + (r.stderr ?? '')}`)
  console.log(`커밋 ${sout(git('rev-parse', '--short', 'HEAD'))}  ${paths.length}개 파일`)
  console.log(`  ${msg}`)

  // 어긋남이 남았으면 여기서 보인다 — 다음 레벨로 가기 전에.
  const after = spawnSync(process.execPath, [join(HERE, 'plan-progress.mjs'), DIR], { encoding: 'utf8' })
  console.log('\n' + (after.stdout ?? '').trim().split('\n').slice(-1)[0])
  const bad = (after.stdout ?? '').split('\n').filter((l) => /^\s*[✗⚠]/.test(l))
  if (bad.length) console.log(bad.join('\n'))
}
