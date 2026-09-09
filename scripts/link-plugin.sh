#!/usr/bin/env bash
# Link development skills into ~/.claude/skills/.
# Use the plugin name from .claude-plugin/plugin.json.
set -euo pipefail

REPO="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO/.claude-plugin/plugin.json" | head -1)"
DEST="$HOME/.claude/skills/$NAME"

# Stop when DEST is a real directory to protect existing user files.
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
