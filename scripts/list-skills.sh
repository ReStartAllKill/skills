#!/usr/bin/env bash
# 레포의 스킬과 `plugin.json` 의 `skills` 배열이 어긋났는지 본다.
#
# 스킬 탐색은 **자동이 아니다** — 카테고리(`skills/<분야>/<이름>/`)로 한 단 더 들어간 순간
# 배열에 적힌 것만 로드된다. 새 스킬을 만들고 배열에 안 적으면 파일은 있는데 안 걸리고,
# 그 상태는 «스킬이 안 뜬다» 말고는 아무 증상이 없다.
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
