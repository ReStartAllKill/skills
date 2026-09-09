#!/usr/bin/env bash
# PreToolUse(Edit|Write|Bash) — 자기승인과 승인된 문서의 무승인 변경을 막는 로컬 가드.
#
# **로직은 여기 없다.** 이 파일은 <sdlc_runtime>/tools/guard-approval.sh 을 부르는 포인터이고,
# 그래서 훅을 고칠 때 레포를 돌지 않아도 된다. 벤더한 런타임이 있으면 그것을 먼저 쓴다 —
# 팀·CI 가 같은 검사기를 쓰게 하려는 것이 벤더의 유일한 목적이라, 훅만 글로벌을 보면
# 그 목적이 무너진다.
#
# install-hook.mjs 가 만든다. 손으로 고치지 말고 본체를 고친다.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -n "$ROOT" ] || ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)" || exit 0

# 런타임을 찾는 순서가 곧 정책이다 — **프로필이 지목한 사본이 가장 세고**, 그다음이 관례
# 벤더 경로, 플러그인 설치본 순이다. **여기서 sdlc-lib.sh 를 source 하지 않는다**: 그
# 파일 자체가 런타임 안에 살아서, 찾기 전에는 부를 수 없다. 그래서 프로필도 sed 로 읽는다.
#
# 프로필을 안 읽으면 훅만 설치본을 돌고 스킬과 CI 는 지목된 사본을 돈다 — 같은 문서의 검사
# 결과가 갈리고, 런타임을 개발하는 레포에서는 훅이 언제나 옛 하네스로 검사한다.
PROFILE_RT=""
if [ -f "$ROOT/.claude/spec-profile.yml" ]; then
  PROFILE_RT="$(sed -n 's/^sdlc_runtime:[[:space:]]*//p' "$ROOT/.claude/spec-profile.yml" 2>/dev/null | head -1 \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'"'"']//' -e 's/["'"'"']$//' -e 's/[[:space:]]*$//')"
  case "$PROFILE_RT" in
    "")    ;;
    "~/"*) PROFILE_RT="$HOME/${PROFILE_RT#\~/}" ;;
    /*)    ;;
    *)     PROFILE_RT="$ROOT/$PROFILE_RT" ;;
  esac
fi

for R in \
  "$PROFILE_RT" \
  "$ROOT/.claude/sdlc" \
  $(ls -td "$HOME"/.claude/skills/*/sdlc-runtime 2>/dev/null) \
  $(ls -td "$HOME"/.claude/plugins/cache/*/restart-harness/*/sdlc-runtime 2>/dev/null)
do
  [ -n "$R" ] || continue
  [ -x "$R/tools/guard-approval.sh" ] && exec "$R/tools/guard-approval.sh"
done
exit 0
