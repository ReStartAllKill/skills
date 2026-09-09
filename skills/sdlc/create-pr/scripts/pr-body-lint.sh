#!/usr/bin/env bash
# Check PR body structure and required sections. Return 0 on success or print errors and return 1.
# Usage: pr-body-lint.sh <body-file>
# Set PR_BODY_LINT_BASE to override the comparison base. See ../references/pr.md for content review.
set -uo pipefail

. "$(dirname "$0")/pr-lib.sh"

FILE="${1:?usage: pr-body-lint.sh <body-file>}"
[[ -f "$FILE" ]] || { echo "no such file: $FILE" >&2; exit 2; }

# Read the profile before selecting language-specific prose checks.
pr_repo_profile || PROFILE=""
BODY_LANG="ko"
[ -n "$PROFILE" ] && BODY_LANG="$(pr_yml lang "$PROFILE")"
BODY_LANG="${BODY_LANG:-ko}"

# Language-specific prose patterns. An empty value means the rule does not apply.
if [ "$BODY_LANG" = "en" ]; then
  RE_NARRATIVE='Phase [0-9]|thoughts/|as discussed|after (some )?discussion|[0-9](st|nd|rd|th) (attempt|try)|while (working|debugging)|it turned out|I (found|noticed|realised|realized)'
  RE_REGISTER=''
  MSG_WORDY='[군더더기] 수동태·에두른 표현 — 주어를 세우고 짧게 쓴다:'
  RE_NOISE='^\|.*(no change|unchanged|not applicable)'
  RE_ASKING='(\?|what do you think|should we|is it ok|any thoughts)'
  RE_WORDY='\bin order to\b|\bdue to the fact that\b|\bit should be noted\b|\butilize[sd]?\b|\bmake use of\b|\bis [a-z]+ed by\b|\bare [a-z]+ed by\b|\bwith (regard|respect) to\b|\bat this point in time\b|\bhas the ability to\b'
else
  RE_NARRATIVE='Phase [0-9]|thoughts/|플랜|리뷰 반영|[0-9]차 시도|논의 결과|판단해|하다가 발견'
  RE_REGISTER='습니다|합니다|입니다|됩니다|드립니다'
  MSG_WORDY='[번역체] 영어 번역투 — 능동·짧은 우리말로 바꾼다:'
  RE_NOISE='^\|.*(변경 없음|해당 없음|해당사항 없음)'
  RE_ASKING='(\?|의견을 듣고 싶|어떻게 할지|괜찮을지|필요할지)'
  RE_WORDY='에 대한|에 대해|를 통해|을 통해|를 통하여|을 통하여|에 의해|에 의하여|되어진|되어지|지게 된다|할 수 있도록 지원|에 있어서|필요로 한다|로 하여금'
fi

fail=0
note() { fail=1; printf '%s\n' "$1"; }
# Report checks that were not applicable.
remark() { printf '%s\n' "$1"; }

# 1) Session history, plan references, and decision-process narration.
if hits="$(grep -niE "$RE_NARRATIVE" "$FILE")"; then
  note "[경위] 작업 과정 서술로 보이는 줄 — 리뷰어에게 새 정보인지 다시 보고 아니면 지운다:"
  printf '%s\n' "$hits"
fi

# Check Korean formal endings, including 합니다 and 습니다 while excluding 아니다.
if [ -n "$RE_REGISTER" ] && hits="$(grep -niE "$RE_REGISTER" "$FILE")"; then
  note "[문체] 합쇼체 — 체언·평서 종결로 바꾼다:"
  printf '%s\n' "$hits"
fi

# 3) Disallow Co-Author trailers.
if hits="$(grep -niE 'co-authored-by|generated with' "$FILE")"; then
  note "[서명] Co-Author·생성 도구 서명은 넣지 않는다:"
  printf '%s\n' "$hits"
fi

# 4) Unfilled template remnants: guide comments, empty table rows, lists, and callouts.
if hits="$(grep -nE '^[[:space:]]*<!--|^\|([[:space:]]*\|)+$|^-[[:space:]]*$|^[0-9]+\.[[:space:]]*$|^>[[:space:]]*\*\*(Reviewer Focus|Root cause|Not the cause|Open question):\*\*[[:space:]]*$' "$FILE")"; then
  note "[템플릿] 안내 주석·빈 표 행·빈 항목이 남아 있다 — 채우거나 섹션째 지운다:"
  printf '%s\n' "$hits"
fi

# 5) Remaining placeholders.
if hits="$(grep -nE '^[[:space:]]*(-|[0-9]+\.)?[[:space:]]*\.\.\.[[:space:]]*$' "$FILE")"; then
  note "[플레이스홀더] '...' 가 그대로 남아 있다:"
  printf '%s\n' "$hits"
fi

# 6) Table rows for unchanged areas.
if hits="$(grep -niE "$RE_NOISE" "$FILE")"; then
  note "[잡음] 바뀌지 않은 영역의 표 행 — 행째 지운다:"
  printf '%s\n' "$hits"
fi

# Check verdict emoji only in Behavior tables identified by a Scenario header.
# Use grep -F to avoid multibyte-character false positives.
hits="$(awk '
  /^\|/ && /Scenario/ { intable = 1; next }
  /^\|/ && intable { print NR": "$0; next }
  { intable = 0 }
' "$FILE" | grep -F -e "✅" -e "❌")"
if [[ -n "$hits" ]]; then
  note "[표기] Behavior 표의 칸은 낱말로 쓴다(허용·거부·멱등·-). 검증 결과는 Verification 으로:"
  printf '%s\n' "$hits"
fi

# Reject Risk tables containing only low-risk entries.
green="$(grep -cE '^\|.*🟢' "$FILE" || true)"
graded="$(grep -cE '^\|.*(🔴|🟡|🟢)' "$FILE" || true)"
if [[ "$graded" -gt 0 && "$green" -eq "$graded" ]]; then
  note "[등급] Risk 가 🟢 뿐이다 — 섹션째 지우거나, 실제로 대가가 큰 축을 찾아 올린다."
fi

# 9) Excessive location references.
refs="$(grep -oE '[A-Za-z0-9_.-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|php|c|cc|cpp|h|hpp|sh|sql|ya?ml|json|toml|md):[0-9]+' "$FILE" | sort -u)"
ref_count="$(printf '%s\n' "$refs" | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "$ref_count" -gt 2 ]]; then
  note "[메타정보] file:line 참조 ${ref_count}개 — 실제로 열어봐야 할 한두 곳만 남긴다:"
  printf '%s\n' "$refs" | sed 's/^/  /'
fi

# 10) Questions inside Reviewer Focus.
if hits="$(grep -niE "^>[[:space:]]*\*\*Reviewer Focus:\*\*.*$RE_ASKING" "$FILE")"; then
  note "[콜아웃] Reviewer Focus 에 질문이 섞였다 — 단언만 남기고 질문은 **Open question:** 줄로 뺀다:"
  printf '%s\n' "$hits"
fi

# 11) Translated phrasing and wordiness, aligned with runtime references/prose.md.
if hits="$(grep -niE "$RE_WORDY" "$FILE")"; then
  note "$MSG_WORDY"
  printf '%s\n' "$hits"
fi

# 12) Length: about one screen (70 lines).
lines="$(wc -l < "$FILE" | tr -d ' ')"
if [[ "$lines" -gt 70 ]]; then
  note "[분량] 본문 ${lines}행 (상한 70) — 문장을 다듬기 전에 지울 섹션·행이 없는지 먼저 본다."
fi

# Treat consecutive prose lines as hard wraps; exclude headings, tables, lists, and quotes.
wrapped="$(awk '
  function prose(s) {
    return (s !~ /^[[:space:]]*$/ && s !~ /^[[:space:]]*[|>#]/ && s !~ /^[[:space:]]*[-*] / && s !~ /^[[:space:]]*[0-9]+\. /)
  }
  /^```/ { inblock = !inblock; prev = ""; next }
  inblock { next }
  {
    if (prev != "" && prose(prev) && prose($0)) print prevno": "prev
    prev = $0; prevno = NR
  }
' "$FILE" | head -5)"
if [[ -n "$wrapped" ]]; then
  note "[줄바꿈] 문단 하드랩 — 한 문단은 한 줄로 쓴다(soft wrap 에 맡김):"
  printf '%s\n' "$wrapped"
fi

# Check repository changes when both a profile and Git are available.
BASE="${PR_BODY_LINT_BASE:-}"
if [[ -z "$BASE" && -n "$PROFILE" ]]; then BASE="$(pr_yml pr_base "$PROFILE")"; fi
BASE="${BASE:-origin/main}"
CHANGED=""
if git rev-parse --verify --quiet "$BASE" >/dev/null 2>&1; then
  CHANGED="$(git diff "$BASE"...HEAD --name-only 2>/dev/null)"
fi

# Require a Risks section when pr_review_focus paths change.
if [[ -n "$PROFILE" && -n "$CHANGED" ]] && ! grep -qE '^#{1,3} .*Risks' "$FILE"; then
  axes=""
  while IFS= read -r rule; do
    [[ -n "$rule" ]] || continue
    pattern="$(printf '%s' "${rule%%=>*}" | sed -E 's/[[:space:]]+$//')"
    label="$(printf '%s' "${rule#*=>}" | sed -E 's/^[[:space:]]+//')"
    printf '%s\n' "$CHANGED" | grep -qE "$pattern" && axes="${axes}  - ${label}"$'\n'
  done < <(pr_yml_list pr_review_focus "$PROFILE")
  if [[ -n "$axes" ]]; then
    note "[누락] 아래 축을 건드렸으므로 Risks & Review Points 섹션을 생략할 수 없다:"
    printf '%s' "$axes"
  fi
fi

# Require rationale IDs when a PR changes artifacts.
if [[ -n "$PROFILE" && -n "$CHANGED" ]]; then
  if printf '%s\n' "$CHANGED" | grep -qE "^${SPEC_DIR}/" \
     && ! grep -qE '\b(OUT|CON|SCN|FR|NFR|AC|EDGE|TD|WP|RISK|FND|CHG|SPEC|PLAN|ADR)-[0-9]+' "$FILE"; then
    note "[추적성] 이 브랜치는 ${SPEC_DIR} 의 산출물을 변경했지만 본문에 근거 ID가 없다 — Intent·Problem은 승인된 문서에서 가져오고 해당 ID를 적는다."
  fi
fi

# Check that profile.lang matches the body language; skip bodies under 200 characters.
# Set the locale for grep and wc so Korean text is counted by character.
ko="$(LC_ALL=en_US.UTF-8 grep -o '[가-힣]' "$FILE" | wc -l | tr -d ' ')"
all="$(LC_ALL=en_US.UTF-8 tr -d '[:space:]' < "$FILE" | wc -m | tr -d ' ')"
if [ "$BODY_LANG" = "en" ]; then
  mismatch="$(awk -v k="$ko" -v n="$all" 'BEGIN { print (n >= 200 && k / n >= 0.3) ? 1 : 0 }')"
  wanted="English"
else
  mismatch="$(awk -v k="$ko" -v n="$all" 'BEGIN { print (n >= 200 && k / n < 0.3) ? 1 : 0 }')"
  wanted="한국어"
fi
if [ "$mismatch" = "1" ]; then
  remark "[lang-unsupported] 프로필의 \`lang: $BODY_LANG\` 인데 본문이 ${wanted} 가 아니다 — 문체 검사가 하나도 돌지 않았다. 통과가 아니라 미검사다."
fi

exit "$fail"
