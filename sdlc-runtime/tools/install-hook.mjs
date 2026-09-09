#!/usr/bin/env node
/** 기존 훅을 유지하며 승인 가드와 편집 후 검사 래퍼를 설치한다. 사용법: node install-hook.mjs <repo-root> [--force]. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const argv = process.argv.slice(2)
const FORCE = argv.includes('--force')
const ROOT = resolve(argv.find((a) => !a.startsWith('--')) ?? process.cwd())

mkdirSync(join(ROOT, '.claude/hooks'), { recursive: true })

/** 훅도 저장소가 고정한 런타임을 우선 사용한다. 런타임이 없으면 검사를 생략한다. */
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

# 런타임을 찾는 순서가 곧 정책이다 — **프로필이 지목한 사본이 가장 세고**, 그다음이 관례
# 벤더 경로, 플러그인 설치본 순이다. **여기서 sdlc-lib.sh 를 source 하지 않는다**: 그
# 파일 자체가 런타임 안에 살아서, 찾기 전에는 부를 수 없다. 그래서 프로필도 sed 로 읽는다.
#
# 프로필을 안 읽으면 훅만 설치본을 돌고 스킬과 CI 는 지목된 사본을 돈다 — 같은 문서의 검사
# 결과가 갈리고, 런타임을 개발하는 레포에서는 훅이 언제나 옛 하네스로 검사한다.
PROFILE_RT=""
if [ -f "$ROOT/.claude/spec-profile.yml" ]; then
  PROFILE_RT="$(sed -n 's/^sdlc_runtime:[[:space:]]*//p' "$ROOT/.claude/spec-profile.yml" 2>/dev/null | head -1 \\
    | sed -e 's/[[:space:]]\\{1,\\}#.*$//' -e 's/^["'"'"']//' -e 's/["'"'"']$//' -e 's/[[:space:]]*$//')"
  case "$PROFILE_RT" in
    "")    ;;
    "~/"*) PROFILE_RT="$HOME/\${PROFILE_RT#\\~/}" ;;
    /*)    ;;
    *)     PROFILE_RT="$ROOT/$PROFILE_RT" ;;
  esac
fi

for R in \\
  "$PROFILE_RT" \\
  "$ROOT/.claude/sdlc" \\
  $(ls -td "$HOME"/.claude/skills/*/sdlc-runtime 2>/dev/null) \\
  $(ls -td "$HOME"/.claude/plugins/cache/*/restart-harness/*/sdlc-runtime 2>/dev/null)
do
  [ -n "$R" ] || continue
  [ -x "$R/tools/${tool}" ] && exec "$R/tools/${tool}"
done
exit 0
`

const SHIMS = [
  {
    file: 'sdlc-gate.sh', tool: 'gate-artifacts.sh', event: 'PostToolUse', matchers: ['Edit|Write'], timeout: 60,
    why: 'PostToolUse(Edit|Write) — 산출물을 저장할 때 문서 간 추적성을 검사한다.',
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

// 기존 matcher의 훅 목록에 추가해 다른 훅을 보존한다.
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

// .claude 아래 산출물은 쓰기 승인이 필요할 수 있음을 알리되 설치는 허용한다.
const profilePath = join(ROOT, '.claude/spec-profile.yml')
const specDir = (existsSync(profilePath)
  ? (/^spec_dir:[ \t]*(.*)$/m.exec(readFileSync(profilePath, 'utf8'))?.[1] ?? '')
  : '').replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() || '.sdlc/specs'
if (specDir === '.claude' || specDir.startsWith('.claude/')) {
  console.warn(`\n⚠ spec_dir 가 \`${specDir}\` 다 — .claude/ 아래 편집은 Claude Code 가 언제나 사람에게 묻는다.`)
  console.warn('  대화형에서는 문서 편집마다 다이얼로그가 뜨고, 자율 경로(dispatch-auto)는 이 폴더에 쓸 수 없다.')
  console.warn('  프로필의 spec_dir 를 `.sdlc/specs` 로 바꾸고 산출물 디렉터리를 옮기는 것을 권한다.\n')
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

// CI 워크플로는 수정하지 않고 연결할 검사 명령만 출력한다.
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
