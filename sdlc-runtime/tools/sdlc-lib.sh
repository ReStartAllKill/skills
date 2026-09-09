#!/usr/bin/env bash
# 훅이 공유하는 해석 로직. 저장소 루트, 산출물 여부, 런타임 경로를 판정한다.
# source해서 사용하며 TREE·SPEC_DIR·ADR_DIR·RUNTIME 전역 변수를 채운다.

sdlc_say() { printf 'sdlc: %s\n' "$1" >&2; }

# YAML 스칼라 한 줄을 읽는다. 값 뒤의 주석과 따옴표는 제거한다.
sdlc_yml() {
  sed -n "s/^$1:[[:space:]]*//p" "$2" 2>/dev/null | head -1 \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' \
          -e 's/[[:space:]]*$//'
}

# node 를 찾는다. 훅은 로그인 셸이 아니라 PATH 에 homebrew·nvm 이 없을 수 있고, 그때 조용히
# 통과하면 «가드가 꺼진 것» 과 «통과» 가 구분되지 않는다 — 이 하네스가 다른 자리에서 계속
# 금지하는 실패 방식이다. 그래서 흔한 설치 자리를 직접 훑고, 그래도 없으면 말한다.
# SDLC_NODE 로 직접 지목할 수 있다 — 흔치 않은 설치 자리를 쓰는 장비의 탈출구다.
sdlc_node() {
  local c
  [ -n "${SDLC_NODE-}" ] && [ -x "${SDLC_NODE}" ] && { printf '%s' "$SDLC_NODE"; return 0; }
  command -v node >/dev/null 2>&1 && { command -v node; return 0; }
  for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$HOME/.local/bin/node"; do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  for c in "$(ls -td "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | head -1)" \
           "$(ls -td "$HOME"/.asdf/installs/nodejs/*/bin/node 2>/dev/null | head -1)"; do
    [ -n "$c" ] && [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

# 훅 JSON에서 필드 하나를 뽑는다. python3가 없는 환경이 있어 node로 읽는다.
# 읽지 못하면 빈 값을 내고 호출한 쪽이 통과시킨다 — 다만 그 사실을 반드시 남긴다.
sdlc_hook_field() {
  local _node
  if ! _node="$(sdlc_node)"; then
    # 필드마다 되풀이하지 않는다. 한 번만 말하고 나머지는 조용히 빈 값을 낸다.
    [ -n "${SDLC_NO_NODE-}" ] || sdlc_say "node 를 못 찾았다 — 훅 입력을 읽을 수 없어 이 검사를 건너뛴다. 통과가 아니라 미검사다."
    SDLC_NO_NODE=1
    return 0
  fi
  SDLC_HOOK_JSON="${SDLC_HOOK_JSON-}" "$_node" -e '
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

  # 프로필이 없으면 산출물 체계를 쓰지 않는 저장소이므로 검사하지 않는다.
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
  # ADR 은 산출물 세트 밖에 살지만 가드와 검사는 똑같이 받는다 — 승인된 결정의 불변성이 이 모음을
  # 믿을 수 있게 만드는 유일한 근거라, 여기서 빠지면 accepted 를 아무도 안 지킨다.
  # adr_dir 이 없는 레포는 ADR 을 안 쓰므로 그대로 통과시킨다.
  ADR_DIR="$(sdlc_yml adr_dir "$profile")"
  case "$file" in
    "$TREE/$SPEC_DIR"/*/intent.md|"$TREE/$SPEC_DIR"/*/spec.md|\
    "$TREE/$SPEC_DIR"/*/plan.md|"$TREE/$SPEC_DIR"/*/finding.md) ;;
    *)
      [ -n "$ADR_DIR" ] || return 1
      case "$file" in
        "$TREE/$ADR_DIR"/ADR-[0-9][0-9][0-9]-*.md|"$TREE/$ADR_DIR"/ADR-[0-9][0-9][0-9][0-9]-*.md) ;;
        *) return 1 ;;
      esac
      ;;
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
