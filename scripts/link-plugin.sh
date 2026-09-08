#!/usr/bin/env bash
# 이 레포를 `~/.claude/skills/` 로 심링크해 **제자리에서** 로드시킨다. 유지보수자용이다.
#
# 마켓플레이스로 설치하면 `~/.claude/plugins/cache/` 에 **사본**이 생겨, 레포를 고쳐도
# `claude plugin update` 전까지 반영되지 않는다. 심링크는 사본을 만들지 않는다.
#
# 플러그인 이름은 디렉터리명이 아니라 `.claude-plugin/plugin.json` 의 `name` 을 따른다.
set -euo pipefail

REPO="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO/.claude-plugin/plugin.json" | head -1)"
DEST="$HOME/.claude/skills/$NAME"

# **DEST 가 실제 디렉터리면 멈춘다.** 그 자리에 손으로 둔 스킬이 있을 수 있고, 그것을
# 말없이 지우면 되돌릴 방법이 없다.
if [ -e "$DEST" ] && [ ! -L "$DEST" ]; then
  echo "error: $DEST 가 심링크가 아닌 실제 경로다. 확인하고 직접 옮겨라." >&2
  exit 1
fi

ln -sfn "$REPO" "$DEST"
echo "링크: $DEST -> $REPO"
echo
echo "다음: /reload-plugins (또는 다음 세션에 자동 로드)"
echo "확인: claude plugin details $NAME"
echo "해제: rm \"$DEST\""
