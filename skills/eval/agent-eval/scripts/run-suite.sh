#!/usr/bin/env bash
# 케이스 여러 개를 병렬로 돌린다 (run-case.sh 를 케이스마다 호출).
#
#   run-suite.sh <cases-root|case-dir...> --label BEFORE [--k 3] [--jobs 3] [--harness <.claude>] [--agent <type>]
#
#   --jobs   동시에 도는 claude 프로세스 총수 (기본 3). 케이스 수 × k 를 이 한도 안에서 나눠 쓴다.
#
# 산출: 케이스마다 ~/agent-evals/runs/<repo>/<case>/<label>-<ts>/ , 마지막에 경로 목록을 찍는다.
set -euo pipefail
SELF_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# 형제 스크립트는 **자기 위치 기준**으로 부른다 — 홈 경로를 박아 두면 플러그인 안에서
# 도는 순간 옛 설치본을 부르거나 못 찾는다.

ARGS=() CASES=() LABEL="" JOBS=3
while [[ $# -gt 0 ]]; do
  case "$1" in
    --jobs) JOBS="$2"; shift 2 ;;
    --label) LABEL="$2"; ARGS+=(--label "$2"); shift 2 ;;
    --k|--harness|--agent) ARGS+=("$1" "$2"); shift 2 ;;
    --with-memory|--keep) ARGS+=("$1"); shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) CASES+=("$1"); shift ;;
  esac
done

[[ -n "$LABEL" ]] || { echo "--label 이 필요하다"; exit 1; }
[[ ${#CASES[@]} -gt 0 ]] || { echo "케이스 디렉터리나 케이스 루트를 넘겨라"; exit 1; }

# 케이스 루트를 넘기면 case.json 이 있는 하위 디렉터리를 전부 편다
EXPANDED=()
for c in "${CASES[@]}"; do
  if [[ -f "$c/case.json" ]]; then
    EXPANDED+=("$c")
  else
    while IFS= read -r found; do EXPANDED+=("$(dirname "$found")"); done \
      < <(find "$c" -maxdepth 2 -name case.json | sort)
  fi
done
[[ ${#EXPANDED[@]} -gt 0 ]] || { echo "case.json 을 못 찾았다"; exit 1; }

echo "케이스 ${#EXPANDED[@]}개 · 라벨 $LABEL · 동시 케이스 $JOBS (케이스 내부 회차는 순차)"

# 병렬은 **케이스 단위로만** 준다. 한 케이스의 k회는 같은 워크트리를 공유하므로 기본 순차다
# (필요하면 run-case.sh --jobs 로 직접 올린다).
CASE_PARALLEL=$JOBS; [[ $CASE_PARALLEL -lt 1 ]] && CASE_PARALLEL=1

STAMP=$(date +%Y%m%d-%H%M%S)
WORK="${TMPDIR:-/tmp}/eval-suite-$LABEL-$STAMP"
mkdir -p "$WORK"
LIST="$WORK/runs.list"; FAILED="$WORK/failed.list"
: > "$LIST"; : > "$FAILED"

# 배치 전체를 감싸는 메모리 스냅샷 하나. 케이스마다 각자 뜨면 병렬일 때 A의 오염이 B의 스냅샷에
# 섞여 복원으로 되살아난다 — run-case.sh 는 EVAL_MEMORY_SNAPSHOT 이 있으면 손대지 않는다.
FIRST_CASE="${EXPANDED[0]}"
REPO_PATH=$(python3 -c "import json;print(json.load(open('$FIRST_CASE/case.json')).get('repo_path',''))")
REPO_PATH="${REPO_PATH/#\~/$HOME}"
MEM_DIR="$HOME/.claude/projects/$(echo "$REPO_PATH" | sed 's|[/.]|-|g')/memory"
export EVAL_MEMORY_SNAPSHOT=""
if [[ -d "$MEM_DIR" ]]; then
  EVAL_MEMORY_SNAPSHOT="$WORK/memory-snapshot"
  cp -R "$MEM_DIR" "$EVAL_MEMORY_SNAPSHOT"
  export EVAL_MEMORY_SNAPSHOT
fi
restore_memory_batch() {
  [[ -n "$EVAL_MEMORY_SNAPSHOT" && -d "$EVAL_MEMORY_SNAPSHOT" && -d "$MEM_DIR" ]] || return 0
  if ! diff -rq "$EVAL_MEMORY_SNAPSHOT" "$MEM_DIR" >/dev/null 2>&1; then
    rsync -a "$MEM_DIR/" "$WORK/memory-written/"
    rsync -a --delete "$EVAL_MEMORY_SNAPSHOT/" "$MEM_DIR/"
    echo "  ※ 배치가 프로젝트 메모리를 건드려 되돌렸다 — 쓰려던 내용은 $WORK/memory-written/"
  fi
}
trap restore_memory_batch EXIT INT TERM

for case_dir in "${EXPANDED[@]}"; do
  (
    # set -e 를 끈다 — 실패한 케이스가 서브셸을 조용히 죽여 목록에서 사라지면
    # BEFORE 6케이스 / AFTER 5케이스 같은 비대칭이 경고 없이 리포트로 간다
    set +e
    out=$("$SELF_DIR/run-case.sh" "$case_dir" "${ARGS[@]}" 2>&1)
    rc=$?
    echo "── $(basename "$case_dir")$( [[ $rc -ne 0 ]] && echo "  [실패 exit=$rc]" )"
    echo "$out" | sed -n '1,3p;/회 완료/p;/메모리를 건드려/p;/패치가 안 맞는다/p'
    if [[ $rc -eq 0 ]] && echo "$out" | grep -q '^RUNS_JSON='; then
      echo "$out" | sed -n 's/^RUNS_JSON=//p' >> "$LIST"
    else
      echo "$case_dir (exit=$rc)" >> "$FAILED"
      echo "$out" > "$WORK/$(basename "$case_dir").log"
    fi
  ) &
  while [[ $(jobs -rp | wc -l) -ge $CASE_PARALLEL ]]; do sleep 2; done
done
wait

echo
echo "runs.json 목록:"
cat "$LIST"

if [[ -s "$FAILED" ]]; then
  echo
  echo "[!] 실패한 케이스 $(wc -l < "$FAILED" | tr -d ' ')개 — 로그는 $WORK/*.log"
  cat "$FAILED"
  echo "    설정 간 케이스 수가 어긋난 채로 비교하지 마라. 고치고 다시 돌려라."
  exit 1
fi

echo
echo "다음: 채점(/eval-agent <run-dir>) 후"
echo "  python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/report.py \$(cat $LIST | tr '\\n' ' ')"
