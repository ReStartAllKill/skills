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
# 산출물의 승인 필드를 쓰는 알아볼 수 있는 명령만 막는다. 보안 경계가 아니라 로컬 방어층이다.
if [ "$tool" = "Bash" ]; then
  cmd="$(sdlc_hook_field tool_input.command)"
  case "$cmd" in
    node\ *approve-set.mjs*|*/node\ *approve-set.mjs*)
      NODE="$(sdlc_node)" || { sdlc_say "node 를 못 찾아 묶음 승인을 검사할 수 없다."; exit 2; }
      exec "$NODE" "$(dirname "$0")/approve-set-hook.mjs"
      ;;
  esac
  # 승인 패턴의 두 낱말이 없으면 판정할 것이 없다. 모든 Bash 호출마다 node 를 한 번 더 띄우지 않으려는
  # 거름망이다 — 실제 판정(쓰는 명령 · 승인 패턴 · 이 저장소의 산출물 경로)은 approval-bash.mjs 가 한다.
  # 명령 문자열 전체에서 sed·tee 같은 낱말을 찾던 옛 규칙은 superseded·closed·committee 를 쓰는
  # 커밋 메시지와 읽기 전용 grep 까지 막아서 버렸다.
  case "$cmd" in *accepted*|*approved_by*) ;; *) exit 0 ;; esac
  # node 가 없으면 여기까지 오지 않는다 — 명령을 읽는 sdlc_hook_field 가 node 로 돌고, 못 찾으면
  # «미검사» 를 말하고 빈 명령을 낸다. 그때 Bash 를 모두 막으면 세션의 셸이 통째로 멈추므로 옛 가드와
  # 똑같이 통과시킨다. 아래 분기는 그 사이에 node 가 사라진 경우만 받는다.
  NODE="$(sdlc_node)" || { sdlc_say "node 를 못 찾았다 — Bash 승인 검사를 건너뛴다. 통과가 아니라 미검사다."; exit 0; }
  exec "$NODE" "$(dirname "$0")/approval-bash.mjs"
fi

file="$(sdlc_hook_field tool_input.file_path)"
sdlc_resolve "$file" || exit 0

# finding의 accepted는 승인 대신 처리 경로 확정을 뜻하므로 제외한다. 그 자리는 routed_to가 지킨다.
case "$file" in *"/finding.md") exit 0 ;; esac
# ADR 인지는 경로가 아니라 프로필의 adr_dir 이 정한다. 넘기지 않으면 판정기가 파일 이름으로 짐작하고,
# 결정을 intent 처럼 다루면 accepted 에서 내리는 편집이 «되돌리기» 로 읽혀 조용히 통과한다.
export SDLC_KIND

# JSON 직렬화와 승인 상태 해석은 검사기와 같은 Node 파서가 맡는다.
if ! NODE="$(sdlc_node)"; then
  sdlc_say "node 를 못 찾았다 — 승인 검사를 건너뛴다. 통과가 아니라 미검사다."
  exit 0
fi
exec "$NODE" "$(dirname "$0")/approval-edit.mjs"
