#!/usr/bin/env bash
# PostToolUse(Edit|Write) — validate traceability for the artifact just written.
# 로직은 여기에만 두고 저장소의 훅은 이 파일을 호출하는 껍데기로 유지한다.
# 훅에 직접 등록하면 stdin의 훅 JSON을 읽고, 저장소 훅이 위임하면 파일 경로를 인자로 받는다.
# 종료 코드 2는 차단이며 stderr는 에이전트에게 그대로 전달된다.
set -uo pipefail
. "$(dirname "$0")/sdlc-lib.sh"

# 훅으로 직접 등록되면 stdin 의 JSON 에서 경로와 트랜스크립트 두 가지를 읽는다. stdin 은 한 번만
# 읽히므로 먼저 통째로 담아 둔다. 저장소 훅이 경로를 인자로 위임한 경우에는 stdin 에 아무것도 없다.
file="${1:-}"
if [ -z "$file" ]; then
  sdlc_hook_slurp
  file="$(sdlc_hook_field tool_input.file_path)"
fi
sdlc_resolve "$file" || exit 0

# 런타임이 없으면 차단하지 않는다. 검사를 건너뛴 사실은 stderr에 남긴다.
if [ ! -f "$RUNTIME/tools/check-artifacts.mjs" ]; then
  sdlc_say "런타임이 없다 (${RUNTIME:-못 찾음}) — 산출물 검사를 건너뛴다. 통과가 아니라 미검사다."
  exit 0
fi

# 게이트도 훅과 같은 node 를 쓴다. PATH 에 없으면 검사 실패가 아니라 미검사다 —
# 여기서 exit 2 를 내면 node 가 없는 장비에서 모든 산출물 편집이 막힌다.
if ! NODE="$(sdlc_node)"; then
  sdlc_say "node 를 못 찾았다 — 산출물 검사를 건너뛴다. 통과가 아니라 미검사다."
  exit 0
fi

# 토큰 사용량은 차단 검사보다 **먼저** 적는다. 검사에 걸린 편집도 토큰은 이미 썼고, 통과한
# 편집만 기록하면 되돌린 작업의 비용이 장부에서 통째로 사라진다 — 재작업이 공짜로 보인다.
# 기록 실패는 절대 편집을 막지 않는다. 장부는 관문이 아니라 관측이다.
# ADR 은 세트 디렉터리가 없어 제외한다 (SDLC_KIND).
if [ "${SDLC_KIND:-}" = "set" ] && [ -f "$RUNTIME/tools/usage-ledger.mjs" ]; then
  transcript="$(sdlc_hook_field transcript_path)"
  # 배열로 넘긴다. ${x:+--flag "$x"} 는 따옴표가 확장 **안쪽** 이라 단어 분리를 막지 못하고,
  # 트랜스크립트 경로는 프로젝트 경로를 그대로 담아 공백이 들어갈 수 있다.
  usage_args=(record --root "$TREE" --set "$(dirname "$file")" --doc "$file")
  [ -n "$transcript" ] && usage_args+=(--transcript "$transcript")
  "$NODE" "$RUNTIME/tools/usage-ledger.mjs" "${usage_args[@]}" 2>&1 \
    | while IFS= read -r l; do sdlc_say "$l"; done
fi

# 폴더 단위로 검사해 방금 고친 파일 때문에 옆 문서가 깨지는 경우를 잡는다.
# 프로필의 sdlc_version은 따로 보지 않는다. 검사기가 문서의 schema_version을 확인한다.
dir="$(dirname "$file")"

if ! out="$("$NODE" "$RUNTIME/tools/check-artifacts.mjs" "$dir" 2>&1)"; then
  printf '산출물 추적성 검사 실패 — 문서 연결이 유효하지 않다\n\n%s\n' "$out" >&2
  exit 2
fi

# 린터는 오류만 차단하고 경고(번역체·길이·문체)는 출력만 한다.
if ! lint="$("$NODE" "$RUNTIME/tools/lint-prose.mjs" "$dir" --json 2>&1)"; then
  printf '산문 린트 실패\n\n%s\n' "$lint" >&2
  exit 2
fi

# Read counts from the machine report; translated messages are presentation only.
if ! n="$(printf '%s' "$lint" | "$NODE" -e 'let s=""; process.stdin.on("data", d => s+=d); process.stdin.on("end", () => { try { const r=JSON.parse(s); if (r.version !== 1 || !Number.isInteger(r.counts?.warnings) || r.counts.warnings < 0 || !Array.isArray(r.problems)) throw Error(); console.log(r.counts.warnings) } catch { process.exitCode=1 } })')"; then
  printf 'Could not read lint diagnostics\n%s\n' "$lint" >&2
  exit 2
fi
cache="${XDG_CACHE_HOME:-$HOME/.cache}/sdlc-gate"
key="$cache/$(printf '%s' "$dir" | cksum | cut -d' ' -f1)"

if [ "$n" -gt 0 ]; then
    mkdir -p "$cache" 2>/dev/null
    sig="$(printf '%s' "$lint" | cksum | cut -d' ' -f1)"
    if [ -f "$key" ] && [ "$(cat "$key" 2>/dev/null)" = "$sig" ]; then
      sdlc_say "린트 경고 ${n}건 — 직전 편집과 같아 다시 보이지 않는다. 전체는: node $RUNTIME/tools/lint-prose.mjs $dir"
    else
      printf '%s' "$lint" | "$NODE" -e 'let s=""; process.stdin.on("data", d=>s+=d); process.stdin.on("end",()=>{for(const p of JSON.parse(s).problems) console.error(`${p.doc}:${p.line ?? 0} [${p.rule ?? p.level}] ${p.msg}\n${p.hint ?? ""}`)})'
      printf '%s' "$sig" > "$key" 2>/dev/null
    fi
else
  rm -f "$key" 2>/dev/null
fi
exit 0
