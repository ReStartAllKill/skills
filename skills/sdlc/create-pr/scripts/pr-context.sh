#!/usr/bin/env bash
# Collect the PR branch, commits, diff summary, and related artifacts.
# Usage: pr-context.sh [base-branch] (default: profile pr_base or main)
# Read repository-specific analysis rules from profile pr_* settings.
set -uo pipefail

. "$(dirname "$0")/pr-lib.sh"

pr_repo_profile; PROFILE_STATE=$?
if [ "$PROFILE_STATE" -eq 2 ]; then
  echo "Git 저장소가 아니다 — PR 맥락을 낼 수 없다." >&2
  exit 2
fi

conf()      { [ -n "$PROFILE" ] && pr_yml      "$1" "$PROFILE" || true; }
conf_list() { [ -n "$PROFILE" ] && pr_yml_list "$1" "$PROFILE" || true; }

BASE="${1:-$(conf pr_base)}"
BASE="${BASE:-main}"
if [[ "$BASE" != origin/* ]] && git show-ref --verify --quiet "refs/remotes/origin/$BASE"; then
  BASE="origin/$BASE"
fi
BRANCH="$(git branch --show-current)"
echo "branch: $BRANCH"
echo "base:   $BASE"
if [ "$PROFILE_STATE" -ne 0 ]; then
  echo "profile: 없음 — 분할 신호·위험 축·산출물 세트 검사를 건너뛴다 (/sdlc-init 으로 만든다)"
fi
if PR_JSON="$(gh pr view --json number,state,isDraft,url -q '"#\(.number) \(.state) draft=\(.isDraft) \(.url)"' 2>/dev/null)"; then
  echo "existing-pr: $PR_JSON"
else
  echo "existing-pr: none"
fi

if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  echo
  echo "베이스 «$BASE» 를 찾지 못했다 — git fetch origin 뒤에 다시 실행하거나 인자로 베이스를 넘긴다." >&2
  exit 2
fi

echo
echo "== commits ($BASE..HEAD) =="
git log "$BASE"..HEAD --oneline

echo
echo "== diffstat =="
git diff "$BASE"...HEAD --stat | tail -1

echo
echo "== affected areas =="
CHANGED="$(git diff "$BASE"...HEAD --name-only)"
WS_DIRS="$(conf pr_workspace_dirs)"
if [[ -n "$WS_DIRS" ]]; then
  WS_RE="^($(printf '%s' "$WS_DIRS" | tr -s ' ' '|'))/"
  # Prefixes may span multiple levels; group through the first level after the prefix.
  AREAS="$(printf '%s\n' "$CHANGED" | grep -E "$WS_RE" | awk -v prefixes="$WS_DIRS" '
    BEGIN { n = split(prefixes, pre, " ") }
    {
      for (i = 1; i <= n; i++) {
        head = pre[i] "/"
        if (index($0, head) == 1) {
          rest = substr($0, length(head) + 1)
          cut = index(rest, "/")
          print pre[i] "/" (cut ? substr(rest, 1, cut - 1) : rest)
          next
        }
      }
    }' | sort -u || true)"
  OTHER="$(printf '%s\n' "$CHANGED" | grep -vE "$WS_RE" | awk -F/ '{print $1}' | sort -u || true)"
else
  AREAS="$(printf '%s\n' "$CHANGED" | awk -F/ '{print $1}' | sort -u || true)"
  OTHER=""
fi
printf '%s\n' "$AREAS" "$OTHER" | sed '/^$/d'

echo
echo "== signals =="
SPLIT_DIR="$(conf pr_split_dir)"
if [[ -n "$SPLIT_DIR" ]]; then
  SPLIT_COUNT="$(printf '%s\n' "$AREAS" | grep -c "^$SPLIT_DIR/" || true)"
  echo "$SPLIT_DIR-touched: $SPLIT_COUNT"
  if [[ "$SPLIT_COUNT" -ge 2 ]]; then
    HINT="$(conf pr_split_hint)"
    echo "SPLIT_HINT: ${HINT:-배포 단위 2개 이상 변경 — 생성 전에 분할 여부를 물어라}"
  fi
fi

while IFS= read -r rule; do
  [[ -n "$rule" ]] || continue
  pattern="$(printf '%s' "${rule%%=>*}" | sed -E 's/[[:space:]]+$//')"
  label="$(printf '%s' "${rule#*=>}" | sed -E 's/^[[:space:]]+//')"
  if printf '%s\n' "$CHANGED" | grep -qE "$pattern"; then
    echo "review-focus: $label — diff 를 직접 읽어라"
  fi
done < <(conf_list pr_review_focus)

echo
echo "== artifact sets =="
# Find PR rationale in changed artifact directories.
CHAINS=""
if [ "$PROFILE_STATE" -eq 0 ]; then
  CHAINS="$(printf '%s\n' "$CHANGED" | grep -E "^${SPEC_DIR}/" \
    | sed -E "s|^(${SPEC_DIR}/(findings/)?[^/]+)/.*|\1|" | sort -u || true)"
fi
if [[ -z "$CHAINS" ]]; then
  echo "artifact-set: none — 본문의 Intent·Problem을 diff와 커밋에서 작성한다"
else
  for chain in $CHAINS; do
    echo "artifact-set: $chain"
    for doc in finding.md intent.md spec.md plan.md; do
      path="$TREE/$chain/$doc"
      [[ -f "$path" ]] || continue
      status="$(pr_yml status "$path")"
      tier="$(pr_yml tier "$path")"
      printf '  %-10s status=%s tier=%s\n' "$doc" "${status:-?}" "${tier:-—}"
      ids="$(grep -oE '^### (OUT|CON|ASM|Q|SCN|FR|NFR|EDGE|SQ|SD|TD|WP|RISK|PQ|EV|HYP|FQ)-[0-9]+' "$path" \
        | awk '{print $2}' | tr '\n' ' ' || true)"
      [[ -n "$ids" ]] && echo "             ids: $ids"
      dec="$(pr_yml_list decisions "$path" | tr '\n' ' ' || true)"
      [[ -n "$dec" ]] && echo "             decisions: $dec"
    done
    strategy="$(pr_yml pr_strategy "$TREE/$chain/plan.md" 2>/dev/null || true)"
    [[ -n "$strategy" ]] && echo "  pr_strategy: $strategy (분할 «방식» 이지 생성 권한이 아니다)"
    if [[ -f "$TREE/$chain/plan.md" ]]; then
      hist="$(grep -E '^- [0-9]{4}-[0-9]{2}-[0-9]{2} (WP|TASK)-[0-9]+' "$TREE/$chain/plan.md" | tail -5 || true)"
      if [[ -n "$hist" ]]; then
        echo "  실행 이력 (마지막 5줄 — Verification 의 재료다):"
        printf '%s\n' "$hist" | sed 's/^/    /'
      fi
    fi
  done
fi

echo
echo "== working tree =="
MODIFIED="$(git status --porcelain | grep -cv '^??' || true)"
UNTRACKED="$(git status --porcelain | grep -c '^??' || true)"
echo "modified-tracked: $MODIFIED / untracked: $UNTRACKED (untracked 는 PR 무관이면 커밋하지 않는다)"
if [[ "$MODIFIED" -gt 0 ]]; then
  git status --short | grep -v '^??'
fi
