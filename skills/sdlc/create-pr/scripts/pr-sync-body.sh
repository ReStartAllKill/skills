#!/usr/bin/env bash
# 생성 후 본문 갱신 — 현재 body 를 파일로 내려받아, 사용자 수동 편집을 보존한 채 부분 수정 후 반영한다.
#
# 사용: pr-sync-body.sh <pr-number> [out-file]      # 1) 현재 본문 내려받기 (기본 pr-<n>-body.md)
#       pr-sync-body.sh <pr-number> --apply <file>  # 2) 부분 수정한 파일로 본문 교체
#
# 통째 재작성 금지 — 내려받은 파일에서 달라진 섹션만 고친 뒤 --apply 한다.
set -euo pipefail

PR="${1:?usage: pr-sync-body.sh <pr-number> [out-file | --apply <file>]}"
shift || true

if [[ "${1:-}" == "--apply" ]]; then
  FILE="${2:?usage: pr-sync-body.sh <pr-number> --apply <file>}"
  "$(dirname "$0")/pr-body-lint.sh" "$FILE"
  gh pr edit "$PR" --body-file "$FILE"
  echo "PR #$PR 본문 반영 완료 ($FILE)"
else
  OUT="${1:-pr-$PR-body.md}"
  gh pr view "$PR" --json body -q .body > "$OUT"
  echo "PR #$PR 현재 본문 → $OUT — 이 파일에서 달라진 섹션만 고친 뒤 'pr-sync-body.sh $PR --apply $OUT'"
fi
