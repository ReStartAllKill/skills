#!/usr/bin/env bash
# PreToolUse(Edit|Write|Bash) — 모델의 일반적인 자기승인과 승인 문서 무단 변경을 막는다.
#
# 이 사슬에서 승인은 오래 «문서를 쓴 그 에이전트가 프런트매터 한 줄을 바꾸는 일» 이었다.
# 그러면 관문이 아니라 자기선언이고, «사람이 판단이 필요한 결정을 지킨다» 가 글자로만
# 남는다. 사람이 «승인» 이라고 말한 것과 사람이 승인한 것은 다르다 — 앞은 대화 기록이고
# 뒤는 저장소에 남는 사실이다.
#
# **PostToolUse 가 아니라 PreToolUse 인 이유:** PostToolUse 는 편집이 끝난 뒤에 불려서
# 되돌리지 못한다. 막으려면 도구가 돌기 전이어야 한다.
#
# 종료 코드 2 = 차단. 이 훅은 **막는 것이 목적**이라, 다른 훅과 달리 조용히 통과하는
# 자리를 최소로 둔다. 다만 판정을 못 하는 상황(입력을 못 읽음, 프로필 없음)에서는
# 통과시킨다 — 못 읽는 것과 위반은 다른 사실이다.
set -uo pipefail
. "$(dirname "$0")/sdlc-lib.sh"

# 훅 입력을 한 번만 읽는다 — stdin 은 두 번 읽히지 않는다.
SDLC_HOOK_JSON="$(cat)"
export SDLC_HOOK_JSON

tool="$(sdlc_hook_field tool_name)"

# 사용자 터미널의 `!sed` 는 Claude 도구 호출이 아니므로 이 훅을 타지 않는다. 반대로 모델이
# Bash 로 같은 명령을 우회하면 tool_name=Bash 로 들어온다. 셸 언어 전체를 해석할 수는
# 없으므로 승인 필드를 쓰는 대표적인 변경 명령을 막는다. 이 때문에 문서에서는 이 가드를
# 컴플라이언스 경계가 아니라 로컬 방어층으로 부른다.
if [ "$tool" = "Bash" ]; then
  cmd="$(sdlc_hook_field tool_input.command)"
  case "$cmd" in
    *sed*|*perl*|*python*|*ruby*|*awk*|*tee*|*printf*|*echo*|*apply_patch*)
      block=false
      case "$cmd" in *status*accepted*) block=true ;; esac
      # **`approved_by` 가 나오는 자리를 하나씩 본다.** «명령 어딘가에 null 이 있으면 통과»
      # 로 보면 `s/approved_by: null/approved_by: 이름/` 이 검색어의 null 때문에 빠져나간다.
      # 한 자리라도 null·~ 이 아닌 값을 쓰면 막고, 템플릿의 `approved_by: null` 은 통과시킨다.
      # 값의 첫 글자가 정규식·셸 메타문자면 그 자리는 «값» 이 아니라 sed 의 **검색어** 다
      # (`s/^approved_by:.*/…/`). 그것까지 값으로 읽으면 null 로 되돌리는 정상 명령이 막힌다.
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

# `finding.md` 는 뺀다. 그쪽의 `accepted` 는 «승인» 이 아니라 «경로가 정해져 나갔다» 이고,
# 자동 탐지에서 시작될 수 있어 사람의 손을 요구하면 루프 자체가 막힌다. 그 자리는
# `routed_to` 가 지킨다.
case "$file" in *"/finding.md") exit 0 ;; esac

# 새로 쓰이는 내용. Edit 는 `new_string`, Write 는 `content` 다.
new="$(sdlc_hook_field tool_input.new_string)"
[ -n "$new" ] || new="$(sdlc_hook_field tool_input.content)"
# `edits[]` 로 오는 도구(MultiEdit 계열)는 위 두 필드가 비어 있어 **판정 없이 통과**했다.
# 배열이면 JSON 그대로 받아 훑는다 — 그 안에 승인 줄이 있으면 같은 판정이 걸린다.
[ -n "$new" ] || new="$(sdlc_hook_field tool_input.edits)"
[ -n "$new" ] || exit 0

current="$(sed -n 's/^status:[[:space:]]*//p' "$file" 2>/dev/null | head -1 \
  | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/[[:space:]]*$//')"
# **확장 정규식(-E)이어야 한다.** BSD sed(macOS)는 BRE 의 `\|` 교체를 지원하지 않아
# target 이 언제나 빈 값이 됐고, 그러면 아래 `plan.md:in_progress` 예외가 절대 안 걸려
# `/implement-spec` 이 첫 단계에서 막혔다 — 게다가 실패 메시지의 «쓰려던 값» 도 비었다.
# `deprecated` 는 ADR 만 쓰는 값이다(references/adr.md). 여기 없으면 accepted -> deprecated 가
# «본문 변경» 으로 읽혀, 효력을 끄는 전이가 다이얼로그에 이유 없이 뜬다.
# 공백과 따옴표를 견뎌야 한다. 한 칸 정확히만 보면 YAML 로 정상인 `status:  accepted` 와
# `status: "accepted"` 가 그냥 지나간다.
target="$(printf '%s' "$new" \
  | sed -nE 's/.*status:[[:space:]]*["'"'"']?(draft|in_review|accepted|in_progress|completed|rejected|superseded|deprecated)["'"'"']?.*/\1/p' \
  | head -1)"

# accepted 로 올리거나 실제 승인자를 대신 쓰는 것은 언제나 차단한다. 템플릿과 초안의
# `approved_by: null` 은 정상이라 막지 않는다.
new_approver="$(printf '%s' "$new" | sed -n 's/.*approved_by:[[:space:]]*["'\'']*\([^"'\'']*\)["'\'']*.*/\1/p' | head -1 \
  | sed -e 's/[[:space:]]*$//')"
reason=""
[ "$target" = accepted ] && reason="자기승인"
# **패턴의 `~` 를 인용해야 한다.** case 패턴은 틸드 확장을 하므로 따옴표가 없으면 `~` 가
# `$HOME` 으로 바뀐다 — YAML 의 null 인 `approved_by: ~` 가 승인으로 오판되고, 반대로
# 값이 홈 경로면 조용히 면제된다.
case "$new_approver" in ""|null|"~") ;; *) reason="자기승인" ;; esac

# 편집이 `status` 줄만 바꿀 수도 있으므로 **결과 상태**로 판정한다. 새 내용이 승인자를
# 말하지 않으면 파일에 이미 적힌 것이 그대로 남는다 — 그것이 이 편집 뒤의 승인자다.
if printf '%s' "$new" | grep -q 'approved_by[[:space:]]*:'; then
  approver="$new_approver"
else
  approver="$(sed -n 's/^approved_by:[[:space:]]*//p' "$file" 2>/dev/null | head -1 \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/[[:space:]]*$//')"
fi

# 승인된 intent/spec의 본문은 먼저 in_review 로 되돌려야 한다. 승인된 plan은 실행 시작
# 전이(accepted → in_progress)만 모델이 할 수 있다. in_progress plan의 실행 기록과
# 체크박스 갱신은 정상적인 실행 상태 변경이다.
if [ -z "$reason" ] && [ "$current" = "accepted" ]; then
  case "$new" in *"status: in_review"*|*"status: rejected"*|*"status: superseded"*) exit 0 ;; esac
  case "$file:$target" in *"/plan.md:in_progress") exit 0 ;; esac
  # **체크박스 토글 하나는 승인 대상이 아니다.** `accepted` plan 의 본문 편집을 통째로
  # 막으면, 실행 중에 status 가 되돌아간 계획서(iterate-spec 이 재승인을 태운 자리)에서
  # `- [ ]` → `- [x]` 마다 «승인 전이입니다» 다이얼로그가 뜬다 — 토글 하나에 대고 물으니
  # 문구가 사실과 다르고, `claude -p` 에서는 그대로 거부라 남은 작업이 조용히 안 찍힌다.
  #
  # Edit 는 `old_string` 과 `new_string` 을 **둘 다** 준다. 양쪽에서 체크 표시만 지워
  # 남는 글이 한 글자도 다르지 않으면 그 편집은 토글뿐이다 — 작업 정의도 files 도 tests 도
  # 손대지 않았다는 뜻이라 재승인을 물을 것이 없다. 한 글자라도 다르면 아래로 내려가 묻는다.
  # Write 는 옛 내용을 안 줘서 이 판정을 못 하므로 예외에 넣지 않는다.
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

# ── 차단이 아니라 **승인 요청** ──────────────────────────────────────────
# 사람이 승인 명령을 손으로 치게 하면 게이트가 너무 빡빡해 결국 꺼진다. 필요한 것은
# «모델이 못 하게 막는 것» 이 아니라 **«사람이 판단하게 만드는 것»** 이고, 그 자리는
# Claude Code 의 권한 다이얼로그다 — 모델이 만들어낼 수 없는 UI 에서 답이 나온다.
#
# 그래서 여기서는 `permissionDecision: "ask"` 를 낸다. 편집 내용이 그대로 다이얼로그에
# 보이므로 사용자는 무엇이 쓰이는지 보고 승인하거나 거절한다. 판단은 여전히 사람이 한다.
#
# **«ask» 는 권한 모드보다 세다.**
#   대화형 acceptEdits · auto · bypassPermissions  → 다이얼로그가 뜬다 (자동 승인되지 않는다)
#   비대화형 `claude -p` 의 모든 모드                → 물어볼 사람이 없어 **거부**된다
# 문서도 같은 말을 한다: «A hook's "ask" also forces a permission prompt in auto mode».
# 그래서 이 모드들에서 직접 차단하지 않는다 — 차단은 사용자가 모드를 오가게 만드는 마찰뿐이다.
#
# 남는 예외는 `dontAsk` 하나다. 그 모드는 물음을 자동으로 «아니오» 로 만들므로 ask 를 내도
# 결과는 거부인데, 그때 사용자가 보는 것은 «거부됐다» 뿐이라 **왜** 가 사라진다. 그래서
# 그 모드에서만 직접 막고 이유를 적는다. 필드가 없는 옛 CLI 는 사람이 있는 쪽으로 읽는다 —
# 못 읽는 것과 위반은 다른 사실이다.
mode="$(sdlc_hook_field permission_mode)"
human=true
case "$mode" in dontAsk) human=false ;; esac

# **자율 루트에서는 물어볼 사람이 없다.** 디스패처는 `claude -p` 로 돌고, 거기서 "ask" 는
# 답할 사람이 없어 거부된다 — 그러면 정책 승인(`approved_by: policy:…`)까지 막혀 자율
# 경로가 초안기가 된다. 그 실행에는 `SDLC_AUTONOMY_ROUTE` 가 있으므로 여기서 먼저 갈라
# 자기 경로의 정책 승인만 통과시키고 나머지는 이유를 적어 막는다.
if [ -n "${SDLC_AUTONOMY_ROUTE-}" ]; then
  # **정책 승인은 자율 루트의 승인 방식이다.** 승인이 사라진 것이 아니라 문서 단위에서
  # 정책 단위로 올라간 것이고, 정책(`.claude/autonomy.yml`)은 사람이 쓰고 커밋하고 다시
  # 보는 산출물이다. 그러니 여기서 그것까지 막으면 자율 루트는 「승인이 필요 없는 데까지만」
  # 도는 초안기가 되고, `expires`·`max_tier`·`target_branch` 는 발화하지 않는 장식이 된다.
  #
  # **자기 경로만 쓸 수 있다.** 경로 A 로 도는 실행이 `policy:B` 를 적으면 자기보다 넓은
  # 위임을 스스로 빌려오는 것이고, 그 순간 `max_tier` 가 경계가 아니게 된다.
  # 실재·만료·티어 대조는 검사기가 한다 — 가드는 «누가 그 이름을 쓸 수 있나» 만 본다.
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

# **사람 세션의 에이전트는 정책 승인을 참칭할 수 없다.** `policy:` 는 자율 루트의 승인
# 방식이고, 그 자리에는 `SDLC_AUTONOMY_ROUTE` 가 있다. 그것 없이 `policy:` 를 적으면 사람이
# 다이얼로그에서 «예» 라고 답해도 기록은 «정책이 승인했다» 가 되어 감사 추적이 거짓이 된다.
# 다이얼로그로 보낼 것이 아니라 여기서 막고, 사람 이름으로 다시 쓰게 한다.
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

# 다이얼로그에 그대로 보이는 문장이다 — 무엇이 왜 승인 대상인지 여기서 다 말한다.
printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"ask\",\"permissionDecisionReason\":\"승인 전이입니다 — 사람의 판단이 필요합니다.  $(basename "$(dirname "$file")")/$(basename "$file"): ${current:-없음} -> ${target:-본문 변경} ($reason).  쓴 것이 승인할 수 없으므로 이 결정만은 모델이 대신 하지 않습니다. 내용을 확인하고 승인하거나 거절하세요. approved_by 는 generated_by 와 달라야 검사기를 통과합니다.\"}}"
exit 0
