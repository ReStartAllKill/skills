#!/usr/bin/env bash
# Verify that repository skills match the skills array in plugin.json.
set -euo pipefail

REPO="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

disk=$(find skills -name SKILL.md -not -path '*/evals/*' | sed 's|/SKILL.md$||' | sed 's|^|./|' | sort)
declared=$(sed -n 's|.*"\(\./skills/[^"]*\)".*|\1|p' .claude-plugin/plugin.json | sort)

echo "디스크 $(echo "$disk" | grep -c .) · 선언 $(echo "$declared" | grep -c .)"
missing=$(comm -23 <(echo "$disk") <(echo "$declared"))
extra=$(comm -13 <(echo "$disk") <(echo "$declared"))
[ -n "$missing" ] && { echo; echo "선언 안 됨 (로드되지 않는다):"; echo "$missing" | sed 's/^/  /'; }
[ -n "$extra" ]   && { echo; echo "선언은 있는데 파일이 없다:";   echo "$extra"   | sed 's/^/  /'; }
[ -z "$missing" ] && [ -z "$extra" ] && echo "일치"
[ -z "$missing" ] && [ -z "$extra" ]
