#!/usr/bin/env node
/** 레포에 산출물 훅을 건다 — shim 두 장과 훅 등록.
 *
 *  **레포에 들어가는 것은 로직이 아니라 포인터다.** 검사기·린터·게이트 본체를 레포마다
 *  복사하면 «두 정본» 이 레포 수만큼 늘어나고, 오늘 고친 버그를 내일 다른 레포에서 다시
 *  만난다. shim 은 열 줄이라 낡을 것이 없다.
 *
 *  **이 일은 스킬이 아니라 프로그램이다.** 설치는 매번 같은 결과가 나와야 하는데 모델은
 *  그것을 보장하지 않고, 훅 등록은 실행 설정을 건드리는 일이라 드리프트가 가장 비싸게
 *  먹힌다. 판단이 필요한 것(프로필 초안)만 스킬이 한다.
 *
 *  거는 훅이 둘인 것은 **시점이 다르기 때문**이다. 게이트는 쓴 뒤에 맞물림을 보고,
 *  가드는 쓰기 전에 승인 전이를 막는다 — 뒤에 서는 훅은 되돌리지 못한다.
 *
 *    node install-hook.mjs <repo-root> [--force]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const argv = process.argv.slice(2)
const FORCE = argv.includes('--force')
const ROOT = resolve(argv.find((a) => !a.startsWith('--')) ?? process.cwd())

mkdirSync(join(ROOT, '.claude/hooks'), { recursive: true })

/** shim. **벤더한 사본을 먼저 본다** — 레포가 런타임을 고정했으면 훅도 그 사본이어야
 *  하고, 그래야 팀원이 글로벌 설치 없이도 같은 검사를 받는다. 둘 다 없으면 조용히
 *  나간다: 이 레포를 스킬 없이 클론한 사람의 편집을 막을 이유가 없다. */
const shim = (tool, why) => `#!/usr/bin/env bash
# ${why}
#
# **로직은 여기 없다.** 이 파일은 <sdlc_runtime>/tools/${tool} 을 부르는 포인터이고,
# 그래서 훅을 고칠 때 레포를 돌지 않아도 된다. 벤더한 런타임이 있으면 그것을 먼저 쓴다 —
# 팀·CI 가 같은 검사기를 쓰게 하려는 것이 벤더의 유일한 목적이라, 훅만 글로벌을 보면
# 그 목적이 무너진다.
#
# install-hook.mjs 가 만든다. 손으로 고치지 말고 본체를 고친다.
set -uo pipefail

ROOT="\${CLAUDE_PROJECT_DIR:-}"
[ -n "$ROOT" ] || ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)" || exit 0

# 런타임을 찾는 순서가 곧 정책이다 — 레포가 고정한 사본이 가장 세고, 그다음이 플러그인
# 설치본, 마지막이 옛 글로벌 경로다. **여기서 sdlc-lib.sh 를 source 하지 않는다**: 그
# 파일 자체가 런타임 안에 살아서, 찾기 전에는 부를 수 없다.
for R in \\
  "$ROOT/.claude/sdlc" \\
  $(ls -td "$HOME"/.claude/skills/*/sdlc-runtime 2>/dev/null) \\
  $(ls -td "$HOME"/.claude/plugins/cache/*/restart-harness/*/sdlc-runtime 2>/dev/null)
do
  [ -x "$R/tools/${tool}" ] && exec "$R/tools/${tool}"
done
exit 0
`

const SHIMS = [
  {
    file: 'sdlc-gate.sh', tool: 'gate-artifacts.sh', event: 'PostToolUse', matchers: ['Edit|Write'], timeout: 60,
    why: 'PostToolUse(Edit|Write) — 산출물 사슬 게이트. 쓴 문서가 맞물리는지 그 자리에서 본다.',
  },
  {
    file: 'sdlc-approval.sh', tool: 'guard-approval.sh', event: 'PreToolUse', matchers: ['Edit|Write', 'Bash'], timeout: 15,
    why: 'PreToolUse(Edit|Write|Bash) — 자기승인과 승인된 문서의 무승인 변경을 막는 로컬 가드.',
  },
]

for (const s of SHIMS) {
  const p = join(ROOT, '.claude/hooks', s.file)
  const existed = existsSync(p)
  writeFileSync(p, shim(s.tool, s.why))
  chmodSync(p, 0o755)
  console.log(`${existed ? '갱신' : '생성'}: ${relative(ROOT, p)}`)
}

// ── settings.json 에 등록 ───────────────────────────────────────────────────
/** **기존 훅을 뭉개지 않는다.** 레포에 이미 코드 게이트가 걸려 있는 것이 정상이고
 *  (실제로 그런 레포가 있었다), 같은 matcher 에 항목을 하나 더 다는 것으로 충분하다 —
 *  둘 다 돌고 둘 다 차단할 수 있다. 덮어쓰면 남의 게이트가 조용히 사라진다. */
const sPath = join(ROOT, '.claude/settings.json')
let settings = {}
if (existsSync(sPath)) {
  try {
    settings = JSON.parse(readFileSync(sPath, 'utf8'))
  } catch (e) {
    console.error(`${relative(ROOT, sPath)} 를 JSON 으로 읽지 못했다 — 훅 등록을 건너뛴다.`)
    console.error(`  ${e.message}`)
    console.error('  파일을 고친 뒤 다시 돌린다. 이 자리에서 덮어쓰면 기존 설정이 사라진다.')
    process.exit(1)
  }
}
let changed = false
settings.hooks ??= {}

// ── spec_dir 가 .claude/ 아래면 경고 ───────────────────────────────────────
/** **`.claude/` 아래는 Claude Code 가 «자기 설정 편집» 으로 보고 Write·Edit 마다 묻는다.**
 *  허용 규칙도 훅의 allow 도 그 물음을 끄지 못한다. 대화형에서는 사슬의
 *  모든 편집이 다이얼로그를 타고, 비대화형 자율 경로에서는 거부돼 산출물이 안 써진다.
 *  설치는 막지 않는다 — 기존 레포의 사슬이 거기 있을 수 있다. 대신 크게 알린다. */
const profilePath = join(ROOT, '.claude/spec-profile.yml')
const specDir = (existsSync(profilePath)
  ? (/^spec_dir:[ \t]*(.*)$/m.exec(readFileSync(profilePath, 'utf8'))?.[1] ?? '')
  : '').replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() || '.sdlc/specs'
if (specDir === '.claude' || specDir.startsWith('.claude/')) {
  console.warn(`\n⚠ spec_dir 가 \`${specDir}\` 다 — .claude/ 아래 편집은 Claude Code 가 언제나 사람에게 묻는다.`)
  console.warn('  대화형에서는 문서 편집마다 다이얼로그가 뜨고, 자율 경로(dispatch-auto)는 이 폴더에 쓸 수 없다.')
  console.warn('  프로필의 spec_dir 를 `.sdlc/specs` 로 바꾸고 사슬 폴더를 옮기는 것을 권한다.\n')
}

for (const s of SHIMS) {
  const cmd = `$CLAUDE_PROJECT_DIR/.claude/hooks/${s.file}`
  settings.hooks[s.event] ??= []
  const list = settings.hooks[s.event]
  for (const matcher of s.matchers) {
    const slot = list.find((e) => e?.matcher === matcher)
    const existing = (slot?.hooks ?? []).find((h) => typeof h?.command === 'string' && h.command.includes(s.file))
    if (existing) {
      if (FORCE && (existing.command !== cmd || existing.timeout !== s.timeout)) {
        existing.command = cmd
        existing.timeout = s.timeout
        changed = true
        console.log(`${s.event} 의 ${s.file} (${matcher}) 등록을 갱신했다.`)
      } else console.log(`${s.event} 에 ${s.file} (${matcher}) 이 이미 있다 — 그대로 둔다.`)
      continue
    }
    const entry = { type: 'command', command: cmd, timeout: s.timeout }
    if (slot) {
      slot.hooks ??= []
      slot.hooks.push(entry)
      console.log(`${s.event} 의 기존 \`${matcher}\` 항목에 덧붙였다 (기존 훅은 그대로).`)
    } else {
      list.push({ matcher, hooks: [entry] })
      console.log(`${s.event} 에 \`${matcher}\` 항목을 새로 만들었다.`)
    }
    changed = true
  }
}

if (changed) {
  writeFileSync(sPath, JSON.stringify(settings, null, 2) + '\n')
  console.log(`갱신: ${relative(ROOT, sPath)}`)
}

// ── CI ─────────────────────────────────────────────────────────────────────
/** 훅은 관문이 아니다 — 개인 장비에 있어서 팀원에게 없을 수 있다. 팀에 걸리는 관문은
 *  CI 이고, 그 자리가 `check-all.mjs` 다. 워크플로 파일은 레포마다 모양이 달라 여기서
 *  쓰지 않고 붙일 조각만 낸다. */
console.log(`
건 것 둘 — 시점이 다르다.
  PreToolUse   sdlc-approval.sh  Edit·Write·일반적인 Bash 자기승인을 막는다
  PostToolUse  sdlc-gate.sh      쓴 문서의 맞물림을 **본다**

훅은 **속도**(편집한 자리에서 0.2초)이고 관문이 아니다 — 팀원 장비에는 없을 수 있다.
팀에 거는 관문은 CI 다. 워크플로에 이 한 줄을 더한다:

    - run: node .claude/sdlc/tools/check-all.mjs .
      # 런타임을 벤더한 경우다(vendor-runtime.sh). CI 러너에는 플러그인도 홈 디렉터리도
      # 없으니, 관문을 CI 에 두려면 벤더가 사실상 유일한 길이다.

만든 것을 커밋한다 — .claude/hooks/*.sh 와 .claude/settings.json.
그래야 클론한 팀원에게도 같은 훅이 걸린다.`)
