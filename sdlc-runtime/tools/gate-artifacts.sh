#!/usr/bin/env bash
# PostToolUse(Edit|Write) — 방금 쓴 산출물이 사슬로서 맞물리는지 그 자리에서 본다.
#
# **로직은 여기 한 벌만 있다.** 레포의 훅은 이 파일을 부르는 얇은 껍데기이고, 그래서
# 여기 고친 것이 레포 수와 상관없이 한 번에 적용된다. 레포마다 사본을 두면 «두 정본»이
# 레포 수만큼 늘어나는데, 그것이 이 사슬이 내내 경계한 것이다.
#
# 부르는 법 둘 — 어느 쪽이든 된다.
#   1) 훅에 직접 등록:  command 로 이 파일을 걸면 stdin 의 훅 JSON 을 읽는다
#   2) 레포 훅이 위임:  gate-artifacts.sh "<이미 파싱한 파일 경로>"
#
# 종료 코드 2 = 차단. stderr 가 에이전트에게 그대로 돌아가 그 자리에서 고치게 한다.
# **막지 않고 통과시키는 자리마다 그 사실을 stderr 에 적는다** — 조용히 꺼진 훅은
# 걸린 적 없는 훅보다 나쁘다. «안 막혔으니 통과»로 읽히기 때문이다.
set -uo pipefail
. "$(dirname "$0")/sdlc-lib.sh"

file="${1:-}"
[ -n "$file" ] || file="$(sdlc_hook_field tool_input.file_path)"
sdlc_resolve "$file" || exit 0

# 런타임이 없으면 막지 않는다 — 이 레포를 스킬 없이 클론한 사람에게는 도구가 없다.
# 다만 **조용히 나가지는 않는다**: 여기까지 온 파일은 분명히 산출물이므로, 검사가
# 안 돌았다는 사실 자체가 신호다.
if [ ! -f "$RUNTIME/tools/check-artifacts.mjs" ]; then
  sdlc_say "런타임이 없다 (${RUNTIME:-못 찾음}) — 산출물 검사를 건너뛴다. 통과가 아니라 미검사다."
  exit 0
fi

# 폴더 단위로 본다 — 사슬은 문서 하나가 아니라 맞물림이고, 방금 고친 파일 때문에
# 옆 문서가 깨지는 것이 이 검사의 요점이다.
#
# 프로필의 `sdlc_version` 을 따로 확인하지 않는 것은 검사기가 문서의 `schema_version`
# 을 이미 보기 때문이다 — 런타임이 못 읽는 버전이면 거기서 오류로 선다.
dir="$(dirname "$file")"

if ! out="$(node "$RUNTIME/tools/check-artifacts.mjs" "$dir" 2>&1)"; then
  printf '산출물 사슬 검사 실패 — 문서끼리 맞물리지 않는다\n\n%s\n' "$out" >&2
  exit 2
fi

# 린터는 **오류만** 막는다. 경고(번역체·길이·문체)는 판단 대상이라 보이기만 한다 —
# 편집마다 도는 훅에서 판단까지 막으면 사람이 훅부터 끈다.
if ! lint="$(node "$RUNTIME/tools/lint-prose.mjs" "$dir" 2>&1)"; then
  printf '산문 린트 실패\n\n%s\n' "$lint" >&2
  exit 2
fi

# «경고 0건» 도 «경고» 를 포함하므로 낱말이 아니라 **경고 머리표(⚠)** 로 집는다.
# 깨끗한 편집마다 출력이 찍히면 그것이 곧 소음이고, 소음이 쌓이면 훅이 꺼진다.
#
# **같은 경고를 편집마다 다시 보여주지 않는다.** 경고는 판단 대상이라 남겨 두는 것이
# 정상인데, 그 문서를 열 번 고치면 같은 경고가 열 번 에이전트의 컨텍스트에 쌓였다.
# 폴더별로 직전 출력의 해시를 캐시에 두고, 같으면 한 줄로만 알린다. 경고가 바뀌면
# (늘거나 줄거나) 다시 전부 보인다 — 바뀐 것이 곧 봐야 할 것이다.
# **`case` 밖에서 정한다.** 안에서만 정하면 «경고 없음» 갈래가 빈 변수를 읽어 `set -u` 로
# 죽는다 — 문서가 깨끗할 때만 게이트가 터지는, 가장 늦게 발견되는 모양이다.
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
