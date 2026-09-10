#!/usr/bin/env bash
# PreToolUse(Edit|Write|Bash) — 모델의 자기승인과 승인 문서 무단 변경을 막는다.
# 편집을 되돌릴 수 없으므로 PostToolUse가 아니라 도구 실행 전에 판정한다.
# 종료 코드 2는 차단이다. 입력을 읽지 못하거나 프로필이 없어 판정할 수 없으면 통과시킨다.
set -uo pipefail
. "$(dirname "$0")/sdlc-lib.sh"

# 훅 입력은 한 번만 읽는다. stdin은 두 번 읽히지 않는다.
SDLC_HOOK_JSON="$(cat)"
export SDLC_HOOK_JSON

tool="$(sdlc_hook_field tool_name)"

# 모델이 Bash로 우회하면 tool_name=Bash로 들어온다. 셸 전체를 해석할 수 없으므로
# 승인 필드를 바꾸는 대표적인 명령만 막는다. 보안 경계가 아니라 로컬 방어층이다.
if [ "$tool" = "Bash" ]; then
  cmd="$(sdlc_hook_field tool_input.command)"
  case "$cmd" in
    *sed*|*perl*|*python*|*ruby*|*awk*|*tee*|*printf*|*echo*|*apply_patch*)
      block=false
      case "$cmd" in *status*accepted*) block=true ;; esac
      # approved_by가 나오는 자리를 하나씩 본다. 명령 어딘가의 null을 통과 근거로 삼으면
      # s/approved_by: null/approved_by: 이름/ 이 검색어의 null 때문에 빠져나간다.
      # 값의 첫 글자가 정규식·셸 메타문자면 그 자리는 값이 아니라 sed의 검색어다.
      _v='[^[:space:].*^$/\,;)}"'"'"']'
      if printf '%s' "$cmd" \
         | grep -oE "approved_by[[:space:]]*:[[:space:]]*${_v}[^[:space:],;)}\"'/\\]*" \
         | grep -qvE ':[[:space:]]*(null|~)$'; then block=true; fi
      if [ "$block" = true ]; then
        cat >&2 <<'EOF'
승인 필드를 Bash 로 바꾸려는 모델 호출을 막았다.

승인 전이는 Edit 도구로 시도한다 — 그러면 가드가 승인 다이얼로그를 띄우고 사람이 그 자리에서
승인하거나 거절한다. 사용자가 승인 명령을 손으로 칠 필요는 없다. 셸 한 줄은 다이얼로그에
보여줄 편집 내용이 없어 여기서는 언제나 막는다. 셸 전체를 판정하는 보안 경계는 아니므로
CI 의 구조 검사와 리뷰를 함께 쓴다.
EOF
        exit 2
      fi
      ;;
  esac
  exit 0
fi

file="$(sdlc_hook_field tool_input.file_path)"
sdlc_resolve "$file" || exit 0

# finding의 accepted는 승인 대신 처리 경로 확정을 뜻하므로 제외한다. 그 자리는 routed_to가 지킨다.
case "$file" in *"/finding.md") exit 0 ;; esac

# 새로 쓰이는 내용. Edit는 new_string, Write는 content다.
new="$(sdlc_hook_field tool_input.new_string)"
[ -n "$new" ] || new="$(sdlc_hook_field tool_input.content)"
# edits[] 배열로 오는 도구는 위 두 필드가 비어 있으므로 JSON 그대로 받아 훑는다.
[ -n "$new" ] || new="$(sdlc_hook_field tool_input.edits)"
[ -n "$new" ] || exit 0

current="$(sed -n 's/^status:[[:space:]]*//p' "$file" 2>/dev/null | head -1 \
  | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/[[:space:]]*$//')"
# 확장 정규식(-E)이어야 한다. BSD sed는 BRE의 \| 교체를 지원하지 않는다.
# deprecated는 ADR만 쓰는 값이다. 목록에서 빠지면 accepted -> deprecated가 본문 변경으로 읽힌다.
# status 값의 공백과 따옴표를 모두 허용한다.
target="$(printf '%s' "$new" \
  | sed -nE 's/.*status:[[:space:]]*["'"'"']?(draft|in_review|accepted|in_progress|completed|rejected|superseded|deprecated)["'"'"']?.*/\1/p' \
  | head -1)"

# accepted로 올리거나 승인자를 대신 적으면 차단한다. 템플릿과 초안의 approved_by: null은 통과시킨다.
new_approver="$(printf '%s' "$new" | sed -n 's/.*approved_by:[[:space:]]*["'\'']*\([^"'\'']*\)["'\'']*.*/\1/p' | head -1 \
  | sed -e 's/[[:space:]]*$//')"
reason=""
[ "$target" = accepted ] && reason="자기승인"
# case 패턴의 ~는 인용해야 한다. 따옴표가 없으면 틸드 확장으로 $HOME이 된다.
case "$new_approver" in ""|null|"~") ;; *) reason="자기승인" ;; esac

# 편집 결과 상태로 판정한다. 새 내용이 승인자를 말하지 않으면 파일에 적힌 값이 그대로 남는다.
if printf '%s' "$new" | grep -q 'approved_by[[:space:]]*:'; then
  approver="$new_approver"
else
  approver="$(sed -n 's/^approved_by:[[:space:]]*//p' "$file" 2>/dev/null | head -1 \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/[[:space:]]*$//')"
fi

# 승인된 intent·spec의 본문은 먼저 in_review로 되돌려야 한다. plan은 accepted -> in_progress만
# 모델이 할 수 있고, in_progress plan의 실행 기록과 체크박스 갱신은 정상적인 상태 변경이다.
if [ -z "$reason" ] && [ "$current" = "accepted" ]; then
  case "$new" in *"status: in_review"*|*"status: rejected"*|*"status: superseded"*) exit 0 ;; esac
  case "$file:$target" in *"/plan.md:in_progress") exit 0 ;; esac
  # 체크박스 토글만 있는 편집은 승인 대상이 아니다. old_string과 new_string에서 체크 표시를
  # 지운 결과가 같으면 통과시킨다. Write는 옛 내용을 주지 않아 이 판정을 할 수 없다.
  case "$file" in *"/plan.md")
    old="$(sdlc_hook_field tool_input.old_string)"
    if [ -n "$old" ] && [ -n "$(sdlc_hook_field tool_input.new_string)" ]; then
      _strip() { printf '%s' "$1" | sed -E 's/^([[:space:]]*[-*][[:space:]]*)\[[ xX]\]/\1[]/'; }
      if [ "$(_strip "$old")" = "$(_strip "$new")" ] && [ "$old" != "$new" ]; then exit 0; fi
    fi
    ;;
  esac
  reason="승인된 문서의 상태 유지 변경"
fi

[ -n "$reason" ] || exit 0

# 차단이 아니라 승인 요청으로 처리한다. permissionDecision "ask"는 편집 내용을 다이얼로그에
# 그대로 보여주고, 대화형 세션에서는 권한 모드와 무관하게 뜬다. claude -p에서는 답할 사람이
# 없어 거부된다. dontAsk는 물음을 자동 거부로 만들어 이유가 사라지므로 그 모드에서만 직접 막는다.
mode="$(sdlc_hook_field permission_mode)"
human=true
case "$mode" in dontAsk) human=false ;; esac

# 자율 실행에는 답할 사람이 없어 "ask"가 거부되고 정책 승인까지 막힌다.
# SDLC_AUTONOMY_ROUTE가 있으면 여기서 먼저 갈라 자기 경로의 정책 승인만 통과시킨다.
if [ -n "${SDLC_AUTONOMY_ROUTE-}" ]; then
  # 정책 승인은 자율 루트의 승인 방식이며 정책(.claude/autonomy.yml)은 사람이 쓰고 커밋한다.
  # 자기 경로만 쓸 수 있다. 다른 경로 이름을 쓰면 max_tier가 경계 구실을 못 한다.
  # 실재·만료·티어 대조는 검사기가 하고, 가드는 그 이름을 쓸 자격만 본다.
  if [ "$approver" = "policy:$SDLC_AUTONOMY_ROUTE" ]; then exit 0; fi

  cat >&2 <<EOF
자율 실행은 이 방식으로 문서를 승인하지 않는다 — 이 편집을 막았다.

  파일: ${file#"$TREE"/}
  지금: ${current:-(없음)}  ->  쓰려던 값: ${target:-(본문 변경)}
  경로: $SDLC_AUTONOMY_ROUTE

  적힌 승인자: ${approver:-(없음)}

자율 루트의 승인은 미리 선언한 정책이 준다. \`approved_by\` 에 사람 이름을 적지 말고
\`policy:$SDLC_AUTONOMY_ROUTE\` 를 적는다 — 자기 경로만 쓸 수 있고, 그러면 이 전이가
통과한다. 위임의 \`max_tier\` 를 넘는 변경이라면 승인 대상이 아니다: \`approved_by\` 를
비우고 \`status\` 는 \`in_review\` 로 두고 사람이 봐야 한다고 적는다.
EOF
  exit 2
fi

# 사람 세션에서 policy:를 적으면 사람이 승인해도 기록은 정책 승인이 되어 감사 추적이 어긋난다.
case "$approver" in policy:*)
  cat >&2 <<EOF
사람 세션에서는 정책 승인을 쓸 수 없다 — 이 편집을 막았다.

  파일: ${file#"$TREE"/}
  적힌 승인자: $approver

\`policy:<경로>\` 는 디스패처가 띄운 자율 실행만 쓴다. 이 세션의 승인은 사람이 다이얼로그에서
한다 — \`approved_by\` 에 승인하는 사람의 이름을 적고 같은 편집을 다시 시도한다.
EOF
  exit 2 ;;
esac

# 쓴 사람은 승인하지 못한다. 여기까지는 «물어본다» 였고 검사기가 뒤에서 거부했는데, 그러면 사람이
# 다이얼로그에서 «승인» 을 누른 뒤에야 그 값이 통과하지 못한다는 것을 안다. 물어볼 것이 없는
# 물음이라 다이얼로그를 띄우지 않고 여기서 막는다.
# 파일의 generated_by 를 본다 — 이 편집이 승인자만 바꾸므로 작성자는 이미 적혀 있다.
writer="$(sed -n 's/^generated_by:[[:space:]]*//p' "$file" 2>/dev/null | head -1 \
  | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/[[:space:]]*$//')"
case "$writer" in ""|null|"~") writer="" ;; esac
# 승인 전이일 때만 본다. 이미 승인된 문서의 본문 변경은 승인자가 누구든 다이얼로그로 가야 한다 —
# 여기서 같이 막으면 «되돌릴 수 없는 값» 이 아니라 «되돌려 놓으라» 는 말이 필요한 자리에 엉뚱한
# 이유가 나간다.
if [ "$reason" = "자기승인" ] && [ -n "$writer" ] && [ -n "$approver" ] \
   && [ "$(printf '%s' "$writer" | tr '[:upper:]' '[:lower:]')" \
      = "$(printf '%s' "$approver" | tr '[:upper:]' '[:lower:]')" ]; then
  cat >&2 <<EOF
쓴 것이 승인할 수는 없다 — 이 편집을 막았다.

  파일: ${file#"$TREE"/}
  지금: ${current:-(없음)}  ->  쓰려던 값: ${target:-(본문 변경)}
  작성자: $writer
  적힌 승인자: $approver

\`approved_by\` 가 \`generated_by\` 와 같으면 검사기가 거부한다. 승인하는 사람의 이름을 적고
같은 편집을 다시 시도한다. 다이얼로그를 띄우지 않은 것은 여기에 사람이 승인할 만한 것이
없기 때문이다 — 승인해도 그 값으로는 통과하지 못한다.
EOF
  exit 2
fi

if [ "$human" = false ]; then
  cat >&2 <<EOF
승인 다이얼로그가 사람에게 가지 않는 권한 모드다 — 이 편집을 막았다.

  파일: ${file#"$TREE"/}
  지금: ${current:-(없음)}  ->  쓰려던 값: ${target:-(본문 변경)}
  모드: $mode

이 모드는 «승인해도 되나» 라는 물음을 자동으로 «아니오» 로 만든다. 승인은 사람이
다이얼로그에서 해야 하므로, Shift+Tab 으로 다른 모드로 바꾸고 같은 편집을 다시 시도한다.
그러면 승인 다이얼로그가 뜨고 그 자리에서 승인하면 된다 — 명령을 손으로 칠 필요는 없다.
EOF
  exit 2
fi

# 다이얼로그에 그대로 보이는 문장이다.
printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"ask\",\"permissionDecisionReason\":\"승인 전이입니다 — 사람의 판단이 필요합니다.  $(basename "$(dirname "$file")")/$(basename "$file"): ${current:-없음} -> ${target:-본문 변경} ($reason).  쓴 것이 승인할 수 없으므로 이 결정만은 모델이 대신 하지 않습니다. 내용을 확인하고 승인하거나 거절하세요.\"}}"
exit 0
