#!/usr/bin/env bash
# 런타임을 레포에 고정한다 — 팀과 CI 가 같은 검사기를 쓰게 하려면 이것뿐이다.
#
# 개인 레포는 플러그인이 들고 있는 사본을 그냥 쓰면 된다. 벤더는 **재현성이 필요할 때**만
# 하는 선택이다: 팀원 노트북에 글로벌 런타임이 없어도, CI 컨테이너가 홈 디렉터리를
# 안 들고 있어도 같은 결과가 나와야 하는 자리.
#
# 벤더의 값은 «사본이 생긴다»가 아니라 «사본이 **버전을 말한다**»는 데 있다. 낡은
# 사본은 새 스키마를 만나면 조용히 넘어가지 않고 오류로 선다.
#
#   vendor-runtime.sh <repo-root>            처음 고정 (이미 있으면 거절)
#   vendor-runtime.sh --update <repo-root>   글로벌 버전으로 갱신
#   vendor-runtime.sh --check  <repo-root>   드리프트만 본다 (CI 용 · 어긋나면 exit 1)
set -euo pipefail

mode=install
case "${1:-}" in
  --update) mode=update; shift ;;
  --check)  mode=check;  shift ;;
  -*) echo "unknown option: $1" >&2; exit 2 ;;
esac

if [[ $# -ne 1 ]]; then
  echo "usage: vendor-runtime.sh [--update|--check] <repo-root>" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_root=$(git -C "$1" rev-parse --show-toplevel)
target="$repo_root/.claude/sdlc"

ver() { tr -d '[:space:]' < "$1/VERSION" 2>/dev/null || echo "?"; }
global_ver=$(ver "$runtime_root")

# ── 드리프트 확인 ─────────────────────────────────────────────────────────
# 벤더한 뒤 «갱신할 방법이 없다»가 되면 사본은 그냥 낡아간다. 규약이 «둘이 갈리면
# 함께 고친다»고 한 그 «함께»가 레포 수만큼 늘어난 자리라, 어긋남을 **묻지 않아도
# 보이게** 해야 한다. CI 가 이 모드를 쓴다.
if [[ $mode == check ]]; then
  if [[ ! -d $target ]]; then
    echo "런타임을 벤더하지 않았다: $target (글로벌 $global_ver 을 쓴다)"
    exit 0
  fi
  local_ver=$(ver "$target")
  same=true
  [[ $local_ver == "$global_ver" ]] || same=false
  cmp -s "$runtime_root/conventions.md" "$target/conventions.md" || same=false
  diff -qr "$runtime_root/tools" "$target/tools" >/dev/null 2>&1 || same=false
  diff -qr "$runtime_root/references" "$target/references" >/dev/null 2>&1 || same=false
  if [[ $same == true ]]; then
    echo "런타임 일치 — 벤더 $local_ver = 글로벌 $global_ver (내용 포함)"
    exit 0
  fi
  echo "런타임 드리프트 — 버전 또는 내용이 글로벌과 다르다 (벤더 $local_ver · 글로벌 $global_ver)" >&2
  echo "  갱신: $0 --update $repo_root" >&2
  echo "  (벤더 사본이 정본이라면 글로벌을 맞추거나 이 검사를 CI 에서 뺀다)" >&2
  exit 1
fi

if [[ -e $target && $mode == install ]]; then
  echo "refusing to overwrite existing runtime: $target" >&2
  echo "  갱신하려면: $0 --update $repo_root" >&2
  exit 1
fi

# ── 복사 ──────────────────────────────────────────────────────────────────
# **`tools/`와 `references/`는 통째로 옮긴다.** 파일을 하나씩 나열하면 도구나 참조 문서가
# 늘 때 벤더한 레포에서만 빠질 수 있다. 디렉터리 단위 복사가 그 결손을 막는다.
prev=""
[[ -d $target ]] && prev=$(ver "$target")

mkdir -p "$target"
rm -rf "$target/tools"
rm -rf "$target/references"
cp -R "$runtime_root/tools" "$target/tools"
cp -R "$runtime_root/references" "$target/references"
cp "$runtime_root/VERSION" "$target/VERSION"
cp "$runtime_root/conventions.md" "$target/conventions.md"
chmod +x "$target"/tools/*.sh 2>/dev/null || true

if [[ -n $prev ]]; then
  echo "SDLC 런타임 갱신: $prev → $global_ver ($target)"
  echo "산출물이 새 스키마를 요구하면 프로필의 sdlc_version 도 함께 올린다 — 별개 작업이다."
else
  echo "SDLC 런타임 $global_ver 을 $target 에 고정했다"
  echo "프로필(.claude/spec-profile.yml)에 적는다:"
  echo "  sdlc_version: $global_ver"
  echo '  sdlc_runtime: ".claude/sdlc"'
fi
echo "런타임과 프로필을 함께 커밋한다 — 그래야 팀과 CI 가 같은 검사기를 쓴다."
