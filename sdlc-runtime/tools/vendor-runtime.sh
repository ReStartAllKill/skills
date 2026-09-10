#!/usr/bin/env bash
# 런타임을 저장소에 고정해 팀과 CI가 같은 검사기를 쓰게 한다.
# 고정본은 버전을 명시하므로 낡은 사본이 새 스키마를 만나면 오류로 선다.
#
#   vendor-runtime.sh <repo-root>            처음 고정 (이미 있으면 거절)
#   vendor-runtime.sh --update <repo-root>   글로벌 버전으로 갱신
#   vendor-runtime.sh --check  <repo-root>   드리프트 확인 (CI용 · 어긋나면 exit 1)
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

# 고정본의 버전과 내용이 글로벌과 같은지 확인한다. CI가 이 모드를 쓴다.
if [[ $mode == check ]]; then
  if [[ ! -d $target ]]; then
    echo "런타임을 벤더하지 않았다: $target (글로벌 $global_ver 을 쓴다)"
    exit 0
  fi
  local_ver=$(ver "$target")
  same=true
  [[ $local_ver == "$global_ver" ]] || same=false
  cmp -s "$runtime_root/conventions.md" "$target/conventions.md" || same=false
  cmp -s "$runtime_root/conventions.ko.md" "$target/conventions.ko.md" || same=false
  diff -qr "$runtime_root/tools" "$target/tools" >/dev/null 2>&1 || same=false
  diff -qr "$runtime_root/references" "$target/references" >/dev/null 2>&1 || same=false
  diff -qr "$runtime_root/locales" "$target/locales" >/dev/null 2>&1 || same=false
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

# tools·references·locales 는 디렉터리째 옮긴다. 파일을 나열하면 새로 늘어난 것이 고정본에서 빠진다.
# locales 가 빠진 사본은 모든 도구가 useLocale 에서 죽는다 — 0.2.0 에 생긴 디렉터리를 여기 더하지
# 않아 실제로 그랬다. 디렉터리 하나가 늘면 이 목록과 아래 --check 두 곳을 같이 고친다.
prev=""
[[ -d $target ]] && prev=$(ver "$target")

mkdir -p "$target"
rm -rf "$target/tools"
rm -rf "$target/references"
rm -rf "$target/locales"
cp -R "$runtime_root/tools" "$target/tools"
cp -R "$runtime_root/references" "$target/references"
cp -R "$runtime_root/locales" "$target/locales"
cp "$runtime_root/VERSION" "$target/VERSION"
# 규약은 두 언어를 함께 옮긴다. 정본인 영어판 머리에 한국어판 링크가 있어서, 한쪽만 옮기면
# 벤더 사본에서 그 링크가 죽는다.
cp "$runtime_root/conventions.md" "$target/conventions.md"
cp "$runtime_root/conventions.ko.md" "$target/conventions.ko.md"
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
