#!/usr/bin/env bash
# 훅이 공유하는 해석 로직. 저장소 루트, 산출물 여부, 런타임 경로를 판정한다.
# source해서 사용하며 TREE·SPEC_DIR·RUNTIME 전역 변수를 채운다.

sdlc_say() { printf 'sdlc: %s\n' "$1" >&2; }

# YAML 스칼라 한 줄을 읽는다. 값 뒤의 주석과 따옴표는 제거한다.
sdlc_yml() {
  sed -n "s/^$1:[[:space:]]*//p" "$2" 2>/dev/null | head -1 \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' \
          -e 's/[[:space:]]*$//'
}

# 훅 JSON에서 필드 하나를 뽑는다. python3가 없는 환경이 있어 node로 읽는다.
# 읽지 못하면 빈 값을 내고 호출한 쪽이 통과시킨다.
sdlc_hook_field() {
  SDLC_HOOK_JSON="${SDLC_HOOK_JSON-}" node -e '
const path = process.argv[1].split(".")
let s = process.env.SDLC_HOOK_JSON ?? ""
const emit = () => {
  try {
    let v = JSON.parse(s)
    for (const k of path) v = v?.[k]
    // 문자열이 아니면 JSON으로 돌려준다. tool_input.edits 같은 배열을 훑는 호출자가 있다.
    process.stdout.write(typeof v === "string" ? v : v == null ? "" : JSON.stringify(v))
  } catch { process.stderr.write("sdlc: 훅 입력을 JSON 으로 읽지 못했다 — 건너뛴다\n") }
}
if (s) emit()
else process.stdin.on("data", (c) => (s += c)).on("end", emit)
' "$1" 2>&2
}

# 프로필이 런타임을 지정하지 않을 때 찾는 순서. 저장소 고정본이 가장 우선한다.
# 훅은 저장소의 shim이 호출하므로 CLAUDE_PLUGIN_ROOT가 비어 있을 수 있어 캐시 경로도 훑는다.
sdlc_find_runtime() {
  local tree="$1" c
  for c in \
    "${SDLC_RUNTIME:-}" \
    "$tree/.claude/sdlc" \
    "${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/sdlc-runtime}"
  do
    [ -n "$c" ] && [ -f "$c/VERSION" ] && { printf '%s' "$c"; return 0; }
  done
  # 플러그인은 제자리 로드(skills/)와 설치본(plugins/cache/) 두 형태로 존재한다.
  # 한쪽만 보면 다른 설치 방식에서 훅이 동작하지 않는다. 개발 중인 제자리 사본을 먼저 본다.
  for c in \
    "$(ls -td "$HOME"/.claude/skills/*/sdlc-runtime 2>/dev/null | head -1)" \
    "$(ls -td "$HOME"/.claude/plugins/cache/*/restart-harness/*/sdlc-runtime 2>/dev/null | head -1)"
  do
    [ -n "$c" ] && [ -f "$c/VERSION" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

# 편집한 파일이 이 저장소의 산출물인지 판정한다. 맞으면 0과 함께 TREE·SPEC_DIR·RUNTIME을 채운다.
sdlc_resolve() {
  local file="$1"
  [ -n "$file" ] || return 1

  # dirname $0으로 폴백하지 않는다. 이 파일은 런타임 설치 경로에 있어 홈 디렉터리를 저장소로 오인한다.
  local root="${CLAUDE_PROJECT_DIR:-}"
  if [ -z "$root" ]; then
    root="$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)" || root=""
  fi
  [ -n "$root" ] && [ -d "$root" ] || return 1

  # 프로필이 없으면 사슬을 쓰지 않는 저장소이므로 검사하지 않는다.
  # intent.md·spec.md·plan.md는 흔한 파일명이라 이 관문이 없으면 무관한 문서까지 막힌다.
  [ -f "$root/.claude/spec-profile.yml" ] || return 1
  local profile="$root/.claude/spec-profile.yml"

  # 워크트리 안의 편집은 그 트리 기준으로 본다. 위치는 프로필의 worktree_dir이 정한다.
  local wt; wt="$(sdlc_yml worktree_dir "$profile")"; wt="${wt:-.claude/worktrees}"
  TREE="$root"
  case "$file" in
    "$root/$wt"/*/*) local rel="${file#"$root/$wt"/}"; TREE="$root/$wt/${rel%%/*}" ;;
  esac
  [ -f "$TREE/.claude/spec-profile.yml" ] && profile="$TREE/.claude/spec-profile.yml"

  # 옛 스펙(requirements.md·design.md·tasks.md)은 검사 대상이 아니다.
  SPEC_DIR="$(sdlc_yml spec_dir "$profile")"; SPEC_DIR="${SPEC_DIR:-.sdlc/specs}"
  case "$file" in
    "$TREE/$SPEC_DIR"/*/intent.md|"$TREE/$SPEC_DIR"/*/spec.md|\
    "$TREE/$SPEC_DIR"/*/plan.md|"$TREE/$SPEC_DIR"/*/finding.md) ;;
    *) return 1 ;;
  esac

  # 프로필의 sdlc_runtime을 따른다. 훅과 스킬이 다른 버전을 읽으면 같은 문서의 검사 결과가 갈린다.
  RUNTIME="$(sdlc_yml sdlc_runtime "$profile")"
  case "$RUNTIME" in
    "")    RUNTIME="$(sdlc_find_runtime "$TREE")" ;;
    "~/"*) RUNTIME="$HOME/${RUNTIME#\~/}" ;;
    /*)    ;;
    *)     RUNTIME="$TREE/$RUNTIME" ;;
  esac
  return 0
}
