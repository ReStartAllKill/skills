#!/usr/bin/env bash
# create-pr 스크립트가 공유하는 프로필 읽기. source 해서 쓴다.
#
# 런타임의 sdlc-lib.sh 를 쓰지 않는다 — 그쪽은 훅이 벤더한 사본에서 읽는 파일이라, 이 스킬이 거기에
# 기대면 팀이 런타임을 고정한 순간 스킬의 새 버전이 옛 라이브러리를 읽는다. PR 도구는 훅도 CI 도
# 부르지 않아 고정할 이유가 없으므로, 필요한 만큼만 여기서 읽는다.

# YAML 스칼라 한 줄. 값 뒤의 주석과 따옴표는 제거한다.
pr_yml() {
  sed -n "s/^$1:[[:space:]]*//p" "$2" 2>/dev/null | head -1 \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/[[:space:]]*$//'
}

# YAML 블록 시퀀스: `key:` 다음의 `- 값` 줄을 한 줄씩 낸다.
# 인라인 배열(`key: [a, b]`)은 읽지 않는다 — 규칙 하나가 한 줄로 서야 어느 규칙이 걸렸는지 갈린다.
pr_yml_list() {
  awk -v key="$1" '
    $0 ~ "^" key ":[[:space:]]*(#.*)?$" { inlist = 1; next }
    inlist && /^[[:space:]]*-[[:space:]]/ { sub(/^[[:space:]]*-[[:space:]]*/, ""); print; next }
    inlist && /^[^[:space:]#]/ { inlist = 0 }
  ' "$2" 2>/dev/null \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/[[:space:]]*$//'
}

# 레포 루트와 프로필을 cwd 기준으로 찾아 TREE·PROFILE·SPEC_DIR 을 채운다.
# PR 은 «지금 서 있는 브랜치» 가 대상이라 CLAUDE_PROJECT_DIR 보다 cwd 의 워크트리가 먼저다.
# 반환: 0 프로필 있음 · 1 프로필 없음(TREE 는 채움) · 2 Git 저장소가 아님.
pr_repo_profile() {
  TREE="$(git rev-parse --show-toplevel 2>/dev/null)" || TREE="${CLAUDE_PROJECT_DIR:-}"
  [ -n "$TREE" ] && [ -d "$TREE" ] || { PROFILE=""; SPEC_DIR=".sdlc/specs"; return 2; }
  PROFILE="$TREE/.claude/spec-profile.yml"
  SPEC_DIR=".sdlc/specs"
  [ -f "$PROFILE" ] || { PROFILE=""; return 1; }
  local dir; dir="$(pr_yml spec_dir "$PROFILE")"
  [ -n "$dir" ] && SPEC_DIR="$dir"
  return 0
}
