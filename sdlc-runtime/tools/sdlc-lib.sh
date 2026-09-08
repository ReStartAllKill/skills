#!/usr/bin/env bash
# 훅 두 개가 **함께** 쓰는 해석 로직 — 어느 레포인가 · 산출물인가 · 런타임은 어디인가.
#
# 두 벌을 두면 이 사슬이 내내 경계한 «두 정본» 이 훅 쪽에 생긴다. `spec_dir` 주석을
# 한쪽만 벗기거나 `worktree_dir` 을 한쪽만 따르는 순간, 검사는 도는데 가드는 안 도는
# 자리가 조용히 생기고 그 자리는 아무도 안 본다.
#
# source 해서 쓴다. 함수는 전역 변수 셋을 채운다: TREE · SPEC_DIR · RUNTIME.

sdlc_say() { printf 'sdlc: %s\n' "$1" >&2; }

# YAML 스칼라 한 줄. **값 뒤 주석을 벗긴다** — `spec_dir: thoughts/specs # gitignore 됨`
# 같은 프로필에서 경로가 어긋나면 매처가 아무것과도 안 맞아 검사가 **소리 없이** 꺼진다.
sdlc_yml() {
  sed -n "s/^$1:[[:space:]]*//p" "$2" 2>/dev/null | head -1 \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' \
          -e 's/[[:space:]]*$//'
}

# 훅 JSON 에서 한 필드를 뽑는다. **node 로 읽는다** — 검사기·린터가 이미 node 라 없을 수
# 없는 반면 python3 는 별도 설치라 없는 기계에서 훅이 소리 없이 꺼진다.
# 못 읽으면 빈 값을 내고 부르는 쪽이 통과시킨다 — 훅의 고장이 편집을 막으면 사람이 훅부터 끈다.
sdlc_hook_field() {
  SDLC_HOOK_JSON="${SDLC_HOOK_JSON-}" node -e '
const path = process.argv[1].split(".")
let s = process.env.SDLC_HOOK_JSON ?? ""
const emit = () => {
  try {
    let v = JSON.parse(s)
    for (const k of path) v = v?.[k]
    // 문자열이 아니면 JSON 으로 준다 — `tool_input.edits` 같은 배열을 훑어야 하는
    // 호출자가 있고, 빈 값을 주면 그 도구는 판정 없이 통과한다.
    process.stdout.write(typeof v === "string" ? v : v == null ? "" : JSON.stringify(v))
  } catch { process.stderr.write("sdlc: 훅 입력을 JSON 으로 읽지 못했다 — 건너뛴다\n") }
}
if (s) emit()
else process.stdin.on("data", (c) => (s += c)).on("end", emit)
' "$1" 2>&2
}

# 프로필이 런타임을 말하지 않을 때 어디를 보는가. **순서가 곧 정책이다** — 레포가
# 고정한 사본이 가장 세고, 그다음이 이 설치본, 마지막이 옛 글로벌 경로다.
#
# 플러그인 캐시를 훑는 이유: 이 파일이 플러그인 안에서 돌 때도 훅은 **레포의 shim** 이
# 부르는 것이라 `CLAUDE_PLUGIN_ROOT` 가 안 서 있다. 그 자리에서 유일하게 남는 단서가
# 캐시 경로라, 버전 디렉터리가 갱신돼도 따라가도록 최신 것을 고른다.
sdlc_find_runtime() {
  local tree="$1" c
  for c in \
    "${SDLC_RUNTIME:-}" \
    "$tree/.claude/sdlc" \
    "${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/sdlc-runtime}"
  do
    [ -n "$c" ] && [ -f "$c/VERSION" ] && { printf '%s' "$c"; return 0; }
  done
  # 플러그인은 두 모양으로 산다 — `skills/<name>/`(제자리 로드)과 `plugins/cache/`(설치본).
  # **둘 다 훑는다.** 한쪽만 보면 그 설치 방식에서 훅이 조용히 꺼지고, 꺼진 게이트는
  # 통과한 게이트와 구분되지 않는다. 개발 중인 제자리 사본을 먼저 본다.
  for c in \
    "$(ls -td "$HOME"/.claude/skills/*/sdlc-runtime 2>/dev/null | head -1)" \
    "$(ls -td "$HOME"/.claude/plugins/cache/*/restart-harness/*/sdlc-runtime 2>/dev/null | head -1)"
  do
    [ -n "$c" ] && [ -f "$c/VERSION" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

# 편집한 파일이 이 레포의 산출물인가. 맞으면 0 을 내고 TREE·SPEC_DIR·RUNTIME 을 채운다.
sdlc_resolve() {
  local file="$1"
  [ -n "$file" ] || return 1

  # **`dirname $0` 으로 폴백하지 않는다.** 이 파일은 런타임 설치 경로에 살아서
  # 그 폴백은 홈 디렉터리를 레포로 착각한다. 못 정하면 그냥 나간다.
  local root="${CLAUDE_PROJECT_DIR:-}"
  if [ -z "$root" ]; then
    root="$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)" || root=""
  fi
  [ -n "$root" ] && [ -d "$root" ] || return 1

  # 프로필이 없으면 이 레포는 사슬을 안 쓴다. `intent.md`·`spec.md`·`plan.md` 는 흔한
  # 파일명이라, 이 관문이 없으면 무관한 레포의 문서가 «프런트매터에 artifact 가 없다»로
  # 막히고 그 순간 사람이 훅부터 끈다. **조용히 나가는 유일한 자리다.**
  [ -f "$root/.claude/spec-profile.yml" ] || return 1
  local profile="$root/.claude/spec-profile.yml"

  # `/implement-spec` 이 판 워크트리 안의 편집은 그 트리에서 봐야 한다. 자리는 프로필의
  # `worktree_dir` 이 정한다. 기본값을 박으면 그 값을 바꾼 레포에서 조용히 빗나간다.
  local wt; wt="$(sdlc_yml worktree_dir "$profile")"; wt="${wt:-.claude/worktrees}"
  TREE="$root"
  case "$file" in
    "$root/$wt"/*/*) local rel="${file#"$root/$wt"/}"; TREE="$root/$wt/${rel%%/*}" ;;
  esac
  [ -f "$TREE/.claude/spec-profile.yml" ] && profile="$TREE/.claude/spec-profile.yml"

  # 옛 스펙(`requirements.md`·`design.md`·`tasks.md`)은 안 걸린다 — 굴리려고 다시
  # 쓰게 하지 않는다.
  SPEC_DIR="$(sdlc_yml spec_dir "$profile")"; SPEC_DIR="${SPEC_DIR:-.sdlc/specs}"
  case "$file" in
    "$TREE/$SPEC_DIR"/*/intent.md|"$TREE/$SPEC_DIR"/*/spec.md|\
    "$TREE/$SPEC_DIR"/*/plan.md|"$TREE/$SPEC_DIR"/*/finding.md) ;;
    *) return 1 ;;
  esac

  # **프로필의 `sdlc_runtime` 을 따른다.** 레포가 런타임을 벤더했으면 스킬은 그것을
  # 읽는데 훅만 글로벌을 읽으면 같은 문서를 서로 다른 버전이 검사한다.
  RUNTIME="$(sdlc_yml sdlc_runtime "$profile")"
  case "$RUNTIME" in
    "")    RUNTIME="$(sdlc_find_runtime "$TREE")" ;;
    "~/"*) RUNTIME="$HOME/${RUNTIME#\~/}" ;;
    /*)    ;;
    *)     RUNTIME="$TREE/$RUNTIME" ;;
  esac
  return 0
}
