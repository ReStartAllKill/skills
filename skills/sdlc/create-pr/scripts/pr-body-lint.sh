#!/usr/bin/env bash
# PR 본문 초안 검사(create-pr §본문) — 통과하면 무출력 exit 0, 걸리면 사유를 찍고 exit 1.
#
# 사용: pr-body-lint.sh <body-file>
#       PR_BODY_LINT_BASE=origin/release  pr-body-lint.sh <body-file>   # 베이스를 바꿀 때
#
# 여기서 잡는 건 형식과 잡음, 그리고 «빠뜨리면 안 되는 섹션» 뿐이다. 내용 판단(Problem 이 동기가 아니라
# 현재 상태를 쓰는지, Changes 가 설계 의도로 시작하는지, Review Point 가 사람만 판단할 수 있는 것인지)은
# ../references/pr.md 를 보고 직접 한다.
set -uo pipefail

. "$(dirname "$0")/pr-lib.sh"

FILE="${1:?usage: pr-body-lint.sh <body-file>}"
[[ -f "$FILE" ]] || { echo "no such file: $FILE" >&2; exit 2; }

# 프로필을 먼저 읽는다 — 아래 문체 검사가 lang 으로 갈린다.
pr_repo_profile || PROFILE=""
BODY_LANG="ko"
[ -n "$PROFILE" ] && BODY_LANG="$(pr_yml lang "$PROFILE")"
BODY_LANG="${BODY_LANG:-ko}"

# 언어에 묶인 검사는 여기 다 있다. 빈 값이면 그 언어에 그 규칙이 없다는 뜻이다 —
# «건너뛴다» 가 아니라 «없다» 이고, 어느 것이 그런지는 이 표가 말한다.
#   narrative  작업 경위 서술          ko/en 둘 다
#   register   합쇼체                  ko 만 — 영어에는 대응하는 화계가 없다
#   noise      «변경 없음» 표 행        ko/en 둘 다
#   asking     Reviewer Focus 안의 질문 ko/en 둘 다
#   wordy      번역체·군더더기          ko/en 둘 다
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
# 막지 않는 알림. 검사가 «안 걸린 것» 인지 «못 본 것» 인지 구분해 준다.
remark() { printf '%s\n' "$1"; }

# 1) 작업 경위·플랜 참조·판단 과정 서술 — 독자는 세션·사슬 문서에 접근할 수 없다.
if hits="$(grep -niE "$RE_NARRATIVE" "$FILE")"; then
  note "[경위] 작업 과정 서술로 보이는 줄 — 리뷰어에게 새 정보인지 다시 보고 아니면 지운다:"
  printf '%s\n' "$hits"
fi

# 2) 합쇼체 — 문체는 체언·평서 종결(런타임 references/prose.md 와 같은 기준).
# «합니다» 에는 «습니다» 가 없다. 하나로 줄이면 검사가 조용히 죽는다. «아니다» 를 잡지 않도록
# 어간을 붙여 적는다.
if [ -n "$RE_REGISTER" ] && hits="$(grep -niE "$RE_REGISTER" "$FILE")"; then
  note "[문체] 합쇼체 — 체언·평서 종결로 바꾼다:"
  printf '%s\n' "$hits"
fi

# 3) Co-Author 금지.
if hits="$(grep -niE 'co-authored-by|generated with' "$FILE")"; then
  note "[서명] Co-Author·생성 도구 서명은 넣지 않는다:"
  printf '%s\n' "$hits"
fi

# 4) 채우지 않은 템플릿 잔재 — 안내 주석·빈 표 행·빈 목록·빈 콜아웃.
if hits="$(grep -nE '^[[:space:]]*<!--|^\|([[:space:]]*\|)+$|^-[[:space:]]*$|^[0-9]+\.[[:space:]]*$|^>[[:space:]]*\*\*(Reviewer Focus|Root cause|Not the cause|Open question):\*\*[[:space:]]*$' "$FILE")"; then
  note "[템플릿] 안내 주석·빈 표 행·빈 항목이 남아 있다 — 채우거나 섹션째 지운다:"
  printf '%s\n' "$hits"
fi

# 5) 남은 플레이스홀더.
if hits="$(grep -nE '^[[:space:]]*(-|[0-9]+\.)?[[:space:]]*\.\.\.[[:space:]]*$' "$FILE")"; then
  note "[플레이스홀더] '...' 가 그대로 남아 있다:"
  printf '%s\n' "$hits"
fi

# 6) 변경 없는 영역의 표 행 — 정보가 아니라 잡음.
if hits="$(grep -niE "$RE_NOISE" "$FILE")"; then
  note "[잡음] 바뀌지 않은 영역의 표 행 — 행째 지운다:"
  printf '%s\n' "$hits"
fi

# 7) Behavior 표에 ✅/❌ — 검증 결과는 Verification 이 맡는다. '의도대로 거부'가 결함으로 읽힌다.
#    이모지 판정은 awk 정규식이 아니라 grep -F 로 한다 — 브래킷 표현식은 C 로케일에서 멀티바이트를
#    바이트로 쪼개 한글을 오탐한다(예: '즉시' 의 9C 바이트가 ✅ 의 9C 와 겹침).
#    표는 헤더에 Scenario 가 있는 것만 본다 — Verification 표도 Before/After 열을 쓰기 때문이다.
hits="$(awk '
  /^\|/ && /Scenario/ { intable = 1; next }
  /^\|/ && intable { print NR": "$0; next }
  { intable = 0 }
' "$FILE" | grep -F -e "✅" -e "❌")"
if [[ -n "$hits" ]]; then
  note "[표기] Behavior 표의 칸은 낱말로 쓴다(허용·거부·멱등·-). 검증 결과는 Verification 으로:"
  printf '%s\n' "$hits"
fi

# 8) Risk 가 🟢 뿐인 표 — 리뷰 순서를 못 정해주므로 자리값을 못 한다.
green="$(grep -cE '^\|.*🟢' "$FILE" || true)"
graded="$(grep -cE '^\|.*(🔴|🟡|🟢)' "$FILE" || true)"
if [[ "$graded" -gt 0 && "$green" -eq "$graded" ]]; then
  note "[등급] Risk 가 🟢 뿐이다 — 섹션째 지우거나, 실제로 대가가 큰 축을 찾아 올린다."
fi

# 9) 위치 참조 과다 — 리뷰어가 실제로 열어봐야 할 한두 곳만 남긴다.
refs="$(grep -oE '[A-Za-z0-9_.-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|php|c|cc|cpp|h|hpp|sh|sql|ya?ml|json|toml|md):[0-9]+' "$FILE" | sort -u)"
ref_count="$(printf '%s\n' "$refs" | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "$ref_count" -gt 2 ]]; then
  note "[메타정보] file:line 참조 ${ref_count}개 — 실제로 열어봐야 할 한두 곳만 남긴다:"
  printf '%s\n' "$refs" | sed 's/^/  /'
fi

# 10) Reviewer Focus 안의 질문 — 확인할 사실(단언)과 저자의 질문을 갈라 둔다.
if hits="$(grep -niE "^>[[:space:]]*\*\*Reviewer Focus:\*\*.*$RE_ASKING" "$FILE")"; then
  note "[콜아웃] Reviewer Focus 에 질문이 섞였다 — 단언만 남기고 질문은 **Open question:** 줄로 뺀다:"
  printf '%s\n' "$hits"
fi

# 11) 번역체 — 런타임 references/prose.md 의 목록과 같은 축이다. 주어를 세우고 능동으로 쓴다.
if hits="$(grep -niE "$RE_WORDY" "$FILE")"; then
  note "$MSG_WORDY"
  printf '%s\n' "$hits"
fi

# 12) 분량 — 화면 한 스크롤 남짓(70행).
lines="$(wc -l < "$FILE" | tr -d ' ')"
if [[ "$lines" -gt 70 ]]; then
  note "[분량] 본문 ${lines}행 (상한 70) — 문장을 다듬기 전에 지울 섹션·행이 없는지 먼저 본다."
fi

# 13) 하드랩 — GitHub 는 단일 개행을 그대로 렌더링한다. 문단은 한 줄로 쓰므로, 산문 줄이 연달아
#     나오면 하드랩이다. 길이로 재지 않는다 — awk 의 length() 는 바이트를 세어 한글에서 어긋난다.
#     제목·표·목록·인용은 앞줄이든 뒷줄이든 정상적으로 이어지므로 양쪽 다 제외한다.
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

# --- 여기서부터는 레포를 본다. 프로필과 Git 이 있을 때만 돈다. ---
BASE="${PR_BODY_LINT_BASE:-}"
if [[ -z "$BASE" && -n "$PROFILE" ]]; then BASE="$(pr_yml pr_base "$PROFILE")"; fi
BASE="${BASE:-origin/main}"
CHANGED=""
if git rev-parse --verify --quiet "$BASE" >/dev/null 2>&1; then
  CHANGED="$(git diff "$BASE"...HEAD --name-only 2>/dev/null)"
fi

# 14) 위험 축을 건드렸는데 Risks 섹션이 없음 — 프로필 pr_review_focus 와 본문을 교차 검증한다.
#     경로 규칙이라 내용 단위 탐지는 아니다. 평범한 이름의 파일이 흘리는 위험은 사람이 본다.
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
