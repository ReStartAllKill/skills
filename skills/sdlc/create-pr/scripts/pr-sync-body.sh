#!/usr/bin/env bash
# Download a PR body, edit changed sections, and preserve user edits.
# Fetch: pr-sync-body.sh <pr-number> [out-file] (default: pr-<n>-body.md)
# Apply: pr-sync-body.sh <pr-number> --apply <file>
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
