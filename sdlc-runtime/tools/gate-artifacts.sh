#!/usr/bin/env bash
# PostToolUse(Edit|Write) — 방금 쓴 산출물이 사슬로 맞물리는지 검사한다.
# 로직은 여기에만 두고 저장소의 훅은 이 파일을 호출하는 껍데기로 유지한다.
# 훅에 직접 등록하면 stdin의 훅 JSON을 읽고, 저장소 훅이 위임하면 파일 경로를 인자로 받는다.
# 종료 코드 2는 차단이며 stderr는 에이전트에게 그대로 전달된다.
set -uo pipefail
. "$(dirname "$0")/sdlc-lib.sh"

file="${1:-}"
[ -n "$file" ] || file="$(sdlc_hook_field tool_input.file_path)"
sdlc_resolve "$file" || exit 0

# 런타임이 없으면 차단하지 않는다. 검사를 건너뛴 사실은 stderr에 남긴다.
if [ ! -f "$RUNTIME/tools/check-artifacts.mjs" ]; then
  sdlc_say "런타임이 없다 (${RUNTIME:-못 찾음}) — 산출물 검사를 건너뛴다. 통과가 아니라 미검사다."
  exit 0
fi

# 폴더 단위로 검사해 방금 고친 파일 때문에 옆 문서가 깨지는 경우를 잡는다.
# 프로필의 sdlc_version은 따로 보지 않는다. 검사기가 문서의 schema_version을 확인한다.
dir="$(dirname "$file")"

if ! out="$(node "$RUNTIME/tools/check-artifacts.mjs" "$dir" 2>&1)"; then
  printf '산출물 사슬 검사 실패 — 문서끼리 맞물리지 않는다\n\n%s\n' "$out" >&2
  exit 2
fi

# 린터는 오류만 차단하고 경고(번역체·길이·문체)는 출력만 한다.
if ! lint="$(node "$RUNTIME/tools/lint-prose.mjs" "$dir" 2>&1)"; then
  printf '산문 린트 실패\n\n%s\n' "$lint" >&2
  exit 2
fi

# "경고 0건"도 "경고"를 포함하므로 낱말이 아니라 머리표(⚠)로 판정한다.
# 폴더별로 직전 출력의 해시를 캐시에 두고, 같은 경고가 반복되면 한 줄로 줄인다.
# 캐시 경로는 case 밖에서 정한다. 안에서 정하면 경고가 없는 갈래가 빈 변수를 읽어 set -u로 죽는다.
cache="${XDG_CACHE_HOME:-$HOME/.cache}/sdlc-gate"
key="$cache/$(printf '%s' "$dir" | cksum | cut -d' ' -f1)"

case "$lint" in
  *"⚠"*)
    mkdir -p "$cache" 2>/dev/null
    sig="$(printf '%s' "$lint" | cksum | cut -d' ' -f1)"
    n="$(printf '%s' "$lint" | sed -nE 's/.*⚠ 경고 ([0-9]+)건.*/\1/p' | head -1)"; n="${n:-?}"
    if [ -f "$key" ] && [ "$(cat "$key" 2>/dev/null)" = "$sig" ]; then
      sdlc_say "린트 경고 ${n}건 — 직전 편집과 같아 다시 보이지 않는다. 전체는: node $RUNTIME/tools/lint-prose.mjs $dir"
    else
      printf '%s\n' "$lint" >&2
      printf '%s' "$sig" > "$key" 2>/dev/null
    fi ;;
  *) rm -f "$key" 2>/dev/null ;;
esac
exit 0
