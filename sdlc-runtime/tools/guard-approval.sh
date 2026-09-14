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
    node\ *approve-set.mjs*|*/node\ *approve-set.mjs*)
      NODE="$(sdlc_node)" || { sdlc_say "node 를 못 찾아 묶음 승인을 검사할 수 없다."; exit 2; }
      exec "$NODE" "$(dirname "$0")/approve-set-hook.mjs"
      ;;
  esac
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

# JSON 직렬화와 승인 상태 해석은 검사기와 같은 Node 파서가 맡는다.
if ! NODE="$(sdlc_node)"; then
  sdlc_say "node 를 못 찾았다 — 승인 검사를 건너뛴다. 통과가 아니라 미검사다."
  exit 0
fi
exec "$NODE" "$(dirname "$0")/approval-edit.mjs"
