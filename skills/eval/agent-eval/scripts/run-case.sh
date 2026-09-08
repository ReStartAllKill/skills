#!/usr/bin/env bash
# 에이전트 평가 케이스를 k회 실행한다.
#
#   run-case.sh <case-dir> --label BEFORE [--k 3] [--harness <.claude 디렉터리>] [--agent <type>] [--keep]
#
# 하는 일:
#   1. case.json 의 base 커밋으로 격리 워크트리를 만든다
#   2. drift.patch → 커밋, defects.patch → 커밋 (심사 대상 diff 가 두 번째 커밋)
#   3. --harness 를 주면 그 .claude 를 워크트리에 덮는다 (agent-memory 는 제외 — 기억 오염 방지)
#   4. claude -p --agent <type> 를 k회 돌리고 트랜스크립트·보고문·비용을 모은다
#   5. 채점 입력 뼈대(runs.json)를 쓰고 다음 단계를 안내한다
#
# 산출: ~/agent-evals/runs/<repo>/<case>/<label>-<timestamp>/
set -euo pipefail
SELF_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# 형제 스크립트는 **자기 위치 기준**으로 부른다 — 홈 경로를 박아 두면 플러그인 안에서
# 도는 순간 옛 설치본을 부르거나 못 찾는다.

CASE_DIR="" LABEL="" K="" HARNESS="" AGENT="" KEEP=0 WITH_MEMORY=0 JOBS=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --k) K="$2"; shift 2 ;;
    --jobs) JOBS="$2"; shift 2 ;;
    --harness) HARNESS="$2"; shift 2 ;;
    --agent) AGENT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --with-memory) WITH_MEMORY=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) CASE_DIR="$1"; shift ;;
  esac
done

[[ -n "$CASE_DIR" && -f "$CASE_DIR/case.json" ]] || { echo "case.json 이 있는 케이스 디렉터리를 넘겨라"; exit 1; }
[[ -n "$LABEL" ]] || { echo "--label 이 필요하다 (예: BEFORE / AFTER)"; exit 1; }

read_case() { python3 -c "import json;print(json.load(open('$CASE_DIR/case.json')).get('$1',''))"; }
read_setup() { python3 -c "import json;print(json.load(open('$CASE_DIR/case.json')).get('setup',{}).get('$1',''))"; }

CASE_ID=$(read_case id)
REPO=$(read_case repo)
REPO_PATH=$(read_case repo_path); REPO_PATH="${REPO_PATH/#\~/$HOME}"   # eval 금지 — case.json 은 에이전트가 쓴다
BASE=$(read_case base_commit)
AGENT=${AGENT:-$(read_case agent)}
K=${K:-$(read_case k)}
K=${K:-3}
PROMPT=$(read_case prompt)

TS=$(date +%Y%m%d-%H%M%S)
# 워크트리를 `~/.claude/` 안에 두면 **작성 역할이 코드를 못 쓴다** — Write/Edit 가 그 경로에서
# 거부된다 — 같은 세션·같은 permission-mode 라도 `~/.claude/**` 만 차단된다.
# 감사 역할은 거의 안 쓰니 티가 안 났지만, writer 평가는 통째로 무효가 된다.
# 기본 루트를 `~/.claude/` 밖으로 옮긴다. EVAL_RUNS_ROOT 로 덮어쓸 수 있다.
RUNS_ROOT="${EVAL_RUNS_ROOT:-$HOME/agent-evals/runs}"
RUN_DIR="$RUNS_ROOT/$REPO/$CASE_ID/$LABEL-$TS"
TREE="$RUN_DIR/tree"
mkdir -p "$RUN_DIR"

echo "케이스 $CASE_ID · 라벨 $LABEL · ${K}회 · 에이전트 $AGENT"
echo "워크트리: $TREE"

# BEFORE(=--harness 미지정)가 무엇을 측정하는지 분명히 한다: base 커밋 시점의 하네스다.
HEAD_SHA=$(git -C "$REPO_PATH" rev-parse --short HEAD)
BASE_SHA=$(git -C "$REPO_PATH" rev-parse --short "$BASE")
if [[ -z "$HARNESS" && "$HEAD_SHA" != "$BASE_SHA" ]]; then
  echo "  ※ 이 실행의 하네스는 base 커밋 $BASE_SHA 시점 것이다 (현재 HEAD $HEAD_SHA 아님)."
  echo "    현재 커밋본을 재려면 --harness <repo>/.claude 를 주거나 케이스를 새 base 로 다시 떠라."
fi

git -C "$REPO_PATH" worktree add --detach "$TREE" "$BASE" >/dev/null

# node_modules 링크는 **패치 커밋 뒤에** 건다 — 먼저 걸면 심사 대상 diff 에 심볼릭 링크가 끼어들어
# 감사가 "개인 절대경로가 커밋됐다"를 정당하게 지적하게 된다(하네스가 만든 가짜 발견).

apply_and_commit() {
  local patch="$1" msg="$2"
  [[ -f "$patch" ]] || return 0
  git -C "$TREE" apply --check "$patch" || { echo "패치가 안 맞는다 — base 커밋이 밀렸다. 정답지 재검증이 필요하다: $patch"; exit 1; }
  # --index 로 패치에 든 파일만 스테이징한다. 워킹트리를 훑어 add 하면 하네스가 만든 부산물까지 딸려온다
  git -C "$TREE" apply --index "$patch"
  git -C "$TREE" -c user.name=eval -c user.email=eval@local commit -q -m "$msg"
}

DRIFT_MSG=$(read_setup drift_commit_message); DRIFT_MSG=${DRIFT_MSG:-"chore: 선행 변경"}
DEFECTS_MSG=$(read_setup defects_commit_message); DEFECTS_MSG=${DEFECTS_MSG:-"feat: 심사 대상 브랜치"}

apply_and_commit "$CASE_DIR/drift.patch" "$DRIFT_MSG"
DRIFT_COMMIT=$(git -C "$TREE" rev-parse --short HEAD)
apply_and_commit "$CASE_DIR/defects.patch" "$DEFECTS_MSG"

# 이제 커밋이 끝났으니 게이트 실행용 node_modules 를 건다 (심사 diff 밖)
ln -s "$REPO_PATH/node_modules" "$TREE/node_modules" 2>/dev/null || true

# pnpm 워크스페이스는 루트 링크만으로 부족하다. 패키지마다 자기 node_modules 를 두고 그 안의
# `@scope/*` 워크스페이스 링크가 **상대경로**라, 워크트리에 없으면 원본 레포 쪽으로 해석된다.
# 그러면 format·lint 는 워크트리를 보는데 typecheck·build·test 는 **원본 레포의 dist/** 를 봐서
# 게이트 결과가 조용히 거짓이 된다(정답지도, 평가 대상의 보고도 함께 틀린다).
# 심볼릭 링크가 아니라 **복사**여야 그 상대경로가 워크트리 자신을 가리킨다. 전체 1MB 미만이다.
for src in "$REPO_PATH"/apps/*/node_modules "$REPO_PATH"/packages/*/node_modules; do
  [[ -d "$src" ]] || continue
  rel=${src#"$REPO_PATH"/}
  mkdir -p "$(dirname "$TREE/$rel")"
  rsync -a --links "$src/" "$TREE/$rel/"
done

# 케이스 스캐폴드가 package.json 에 의존성을 새로 추가했다면 원본 레포에는 그 링크가 없다.
# `pnpm install` 은 답이 아니다 — 루트 node_modules 가 원본 레포로 향하는 심볼릭 링크라
# 사용자 레포를 건드리게 된다. 선언됐는데 안 이어진 것만 골라 잇는다.
python3 "$SELF_DIR/resolve-workspace-deps.py" "$TREE" "$REPO_PATH" || true

DEFECTS_COMMIT=$(git -C "$TREE" rev-parse HEAD)

# 작성 역할은 회차마다 트리를 이 커밋으로 되돌린다. `git reset --hard` 는 추적 파일인 `.claude/`
# 까지 커밋 상태로 되돌리므로, 되돌린 뒤에는 하네스를 **다시 덮어야** 한다 — 그래서 함수다.
apply_harness() {
  [[ -n "$HARNESS" ]] || return 0
  local excludes=(--exclude 'worktrees/' --exclude 'evals/results/')
  [[ $WITH_MEMORY -eq 0 ]] && excludes+=(--exclude 'agent-memory/')
  rsync -a --delete "${excludes[@]}" "$HARNESS/" "$TREE/.claude/"
  # 하네스는 `.claude/` 만이 아니다 — CLAUDE.md 가 검증 게이트·도메인 규칙·금지 목록의 정본이라
  # 이걸 빼면 하네스 변경의 절반을 안 재고 "차이 없음"이 나온다.
  local harness_root; harness_root=$(dirname "$HARNESS")
  # `[[ -f ]] && cp` 는 파일이 없으면 비영-종료다. 루프의 마지막 반복이 그렇게 끝나면
  # 함수 반환값이 1 이 되고 `set -e` 가 스크립트를 죽인다 — AGENTS.md 가 없는 레포에서
  # --harness 가 항상 즉사하던 원인. 명시적으로 0 을 돌려준다.
  for f in CLAUDE.md AGENTS.md; do
    [[ -f "$harness_root/$f" ]] && cp "$harness_root/$f" "$TREE/$f"
  done
  return 0
}

if [[ -n "$HARNESS" ]]; then
  echo "하네스 덮어쓰기: $HARNESS"
  apply_harness
fi

# 툴 권한은 **측정 대상 하네스의 에이전트 정의**가 정한다. 러너가 read-only 로 고정하면
# 작성 역할은 한 줄도 못 써서 아예 측정이 안 된다(빈 diff 를 "구현 실패"로 오독하게 된다).
# 기본값은 감사 역할 그대로 두고, 정의가 Edit/Write 를 선언한 경우에만 넓힌다.
ALLOWED_TOOLS="Read Grep Glob Bash"
IS_WRITER=0
AGENT_DEF="$TREE/.claude/agents/$AGENT.md"
if [[ -f "$AGENT_DEF" ]]; then
  TOOLS_LINE=$(sed -n 's/^tools:[[:space:]]*//p' "$AGENT_DEF" | head -1)
  if [[ "$TOOLS_LINE" == *Edit* || "$TOOLS_LINE" == *Write* ]]; then
    IS_WRITER=1
    ALLOWED_TOOLS="Read Grep Glob Bash Edit Write"
    echo "작성 역할로 판정 — Edit·Write 허용, 회차마다 트리를 $DEFECTS_COMMIT 로 되돌린다"
  fi
fi

FULL_PROMPT="$PROMPT

심사 범위: git diff $DRIFT_COMMIT..HEAD"

# 세션 트랜스크립트 디렉터리 이름 = cwd 의 `/` 와 `.` 를 모두 `-` 로 바꾼 것
SLUG=$(echo "$TREE" | sed 's|[/.]|-|g')
PROJECT_DIR="$HOME/.claude/projects/$SLUG"

# 자동 메모리는 워크트리가 아니라 **본 레포 슬러그**에 쓰인다 — 평가 실행이 시드한 가짜 결함을
# 실제 프로젝트 기억으로 저장해 버린다. 실행 전 스냅샷을 떠서 되돌리고, 쓰려던 내용은 남긴다.
#
# 스냅샷은 **한 배치에 하나만** 떠야 한다. 케이스마다 각자 뜨면 병렬일 때 A의 오염이 B의 스냅샷에
# 들어가고, 나중에 복원하는 쪽이 그 오염을 최종 상태로 되살린다. run-suite.sh 가 배치 전체를 감쌀
# 때는 EVAL_MEMORY_SNAPSHOT 을 넘겨주고, 여기서는 스냅샷을 뜨지도 복원하지도 않는다.
MEM_DIR="$HOME/.claude/projects/$(echo "$REPO_PATH" | sed 's|[/.]|-|g')/memory"
MEM_SNAPSHOT="${EVAL_MEMORY_SNAPSHOT:-}"
MEM_MANAGED_BY_SUITE=0
if [[ -n "$MEM_SNAPSHOT" ]]; then
  MEM_MANAGED_BY_SUITE=1
elif [[ -d "$MEM_DIR" ]]; then
  MEM_SNAPSHOT="$RUN_DIR/memory-snapshot"
  cp -R "$MEM_DIR" "$MEM_SNAPSHOT"
fi

# 회차 간 오염도 막는다 — run 1 이 메모리에 "결함 4건 찾음"을 써두면 run 2·3 이 그걸 읽어
# pass^k 가 재려는 회차 독립성이 깨진다. 순차 실행(JOBS=1)이면 회차마다 되돌린다.
restore_memory() {
  [[ -d "$MEM_DIR" && -n "$MEM_SNAPSHOT" && -d "$MEM_SNAPSHOT" ]] || return 0
  if ! diff -rq "$MEM_SNAPSHOT" "$MEM_DIR" >/dev/null 2>&1; then
    rsync -a "$MEM_DIR/" "$RUN_DIR/memory-written/"
    rsync -a --delete "$MEM_SNAPSHOT/" "$MEM_DIR/"
    echo "  ※ 평가 실행이 프로젝트 메모리를 건드려 되돌렸다 — 쓰려던 내용은 $RUN_DIR/memory-written/"
  fi
}

cleanup() {
  [[ $MEM_MANAGED_BY_SUITE -eq 1 ]] || restore_memory
  [[ $MEM_MANAGED_BY_SUITE -eq 1 || $KEEP -eq 1 ]] || rm -rf "$RUN_DIR/memory-snapshot"
  [[ $KEEP -eq 1 ]] || git -C "$REPO_PATH" worktree remove --force "$TREE" >/dev/null 2>&1 || true
  # run 디렉터리를 사람이 지우면 등록만 남아 목록이 지저분해진다
  git -C "$REPO_PATH" worktree prune >/dev/null 2>&1 || true
}
# 중단(Ctrl-C)·set -e 실패 경로에서도 메모리를 반드시 되돌린다
trap cleanup EXIT INT TERM

one_run() {
  local i="$1" sid
  sid=$(uuidgen | tr 'A-Z' 'a-z')
  echo "  [$i/$K] session $sid"
  # 에이전트 메모리는 **역할과 무관하게** 회차마다 지운다. `.claude/agent-memory/` 는 gitignore
  # 대상이라 `git reset --hard` 도 `git clean -fd`(-x 없음) 도 건드리지 못한다 — 그대로 두면
  # 1회차가 적어둔 발견을 2·3회차가 그대로 읽어 pass^k 가
  # 재려는 회차 독립성이 깨진다. 뒤 회차일수록 유리해져 검출률이 부풀고 분산이 눌린다.
  # `--harness` 가 agent-memory 를 기본 제외하는 것과 같은 이유다.
  rm -rf "$TREE/.claude/agent-memory"

  # 작성 역할은 앞 회차가 남긴 코드 위에서 시작하면 안 된다 — 2회차가 1회차의 구현을 이어받으면
  # pass^k 가 재려는 회차 독립성이 깨지고, 뒤 회차일수록 유리해진다.
  if [[ $IS_WRITER -eq 1 ]]; then
    git -C "$TREE" reset --hard "$DEFECTS_COMMIT" >/dev/null
    git -C "$TREE" clean -fdq -e node_modules
    apply_harness   # reset 이 추적 파일인 .claude/ 도 커밋 상태로 되돌린다
  fi
  ( cd "$TREE" && claude -p "$FULL_PROMPT" \
      --agent "$AGENT" \
      --session-id "$sid" \
      --permission-mode acceptEdits \
      --allowedTools "$ALLOWED_TOOLS" \
      --output-format json ) > "$RUN_DIR/run-$i.json" || echo "  [$i/$K] 비정상 종료 — run-$i.json 확인"
  # 작성 역할은 보고문만으로 채점할 수 없다 — 실제로 무엇을 썼는지가 산출 정확성의 재료다
  if [[ $IS_WRITER -eq 1 ]]; then
    git -C "$TREE" add -A -- ':!node_modules' >/dev/null 2>&1 || true
    git -C "$TREE" diff --cached "$DEFECTS_COMMIT" -- ':!node_modules' > "$RUN_DIR/run-$i.diff" 2>/dev/null || true
  fi
  cp "$PROJECT_DIR/$sid.jsonl" "$RUN_DIR/run-$i.jsonl" 2>/dev/null \
    || echo "  [$i/$K] 트랜스크립트를 못 찾았다: $PROJECT_DIR/$sid.jsonl"
  # 순차 실행이면 회차마다 메모리를 되돌려 다음 회차가 이전 회차의 결론을 읽지 못하게 한다
  if [[ $JOBS -eq 1 ]]; then restore_memory; fi
}

# k회를 --jobs 만큼 동시에. 기본은 1이다 — 회차끼리 **같은 워크트리를 공유**하기 때문이다.
# "감사는 읽기 전용이라 안전"은 사실이 아니다: 게이트가 build/·.react-router/ 를 쓰고,
# node_modules 심볼릭 링크로 vite 캐시까지 공유하며, 에이전트가 stash·checkout 을 쓸 수도 있다.
# 병렬이 필요하면 케이스 단위로(run-suite.sh) 늘리는 것이 안전하다.
if [[ $IS_WRITER -eq 1 && $JOBS -gt 1 ]]; then
  echo "  ※ 작성 역할은 회차 병렬이 불가능하다(회차마다 트리를 되돌리므로 서로를 지운다) — --jobs 1 로 내린다."
  JOBS=1
fi
if [[ $JOBS -gt 1 ]]; then
  echo "  ※ --jobs $JOBS: 회차들이 같은 워크트리를 공유한다. 트리를 건드리는 에이전트면 결과가 오염된다."
  echo "    회차 간 메모리 격리도 이 모드에서는 꺼진다(배치 끝에 한 번만 복원)."
fi
for i in $(seq 1 "$K"); do
  one_run "$i" &
  while [[ $(jobs -rp | wc -l) -ge $JOBS ]]; do sleep 2; done
done
wait

restore_memory

python3 "$SELF_DIR/agent-run-metrics.py" --json --agent-type "$AGENT" \
  "$RUN_DIR"/run-*.jsonl > "$RUN_DIR/metrics.json" 2>/dev/null || true

python3 - "$RUN_DIR" "$CASE_DIR" "$LABEL" <<'PY'
import json, os, sys, glob
run_dir, case_dir, label = sys.argv[1:4]
case = json.load(open(os.path.join(case_dir, "case.json")))
metrics = []
mpath = os.path.join(run_dir, "metrics.json")
if os.path.exists(mpath):
    try: metrics = json.load(open(mpath))
    except ValueError: pass
by_run = {os.path.basename(m["path"]): m for m in metrics}

def run_index(path):
    return int(os.path.basename(path)[4:-5])  # run-<N>.json → N (사전순은 10 이 2 앞에 온다)


def peeked_at_answers(run_dir, i, case_dir):
    """평가 대상이 정답지를 읽었는지 궤적에서 확인한다.

    Read/Bash 가 열려 있으니 정답지는 물리적으로 막을 수 없다 — 대신 읽으면 잡아서 그 회차를
    무효로 만든다(측정이 아니라 커닝이므로 점수로 환산하지 않는다).
    """
    path = os.path.join(run_dir, f"run-{i}.jsonl")
    if not os.path.exists(path):
        return False
    # `evals/cases` 를 그대로 넣으면 안 된다 — 정답지를 읽지 않고 그 경로가 **출력에 스치기만 해도**
    # 걸린다. 실제로 `find`/`ls` 결과에 디렉터리 목록이 찍힌 회차가 커닝으로 오판됐다.
    # 케이스 파일을 실제로 건드려야 잡히는 이름만 남긴다.
    needles = ("answer-key", os.path.basename(os.path.normpath(case_dir)) + "/case.json",
               "defects.patch", "drift.patch", "expected_severity")
    for line in open(path, errors="replace"):
        low = line.lower()
        if any(n.lower() in low for n in needles):
            return True
    return False

runs = []
for path in sorted(glob.glob(os.path.join(run_dir, "run-*.json")), key=run_index):
    i = run_index(path)
    try: result = json.load(open(path))
    except ValueError: result = {}
    m = by_run.get(f"run-{i}.jsonl", {})
    usage = result.get("usage") or {}
    runs.append({
        "n": i,
        "report": result.get("result", ""),
        # 트랜스크립트가 없으면 CLI 결과 JSON 으로 폴백한다
        "tokens": m.get("output_tokens") or usage.get("output_tokens"),
        "tools": m.get("tool_calls"),
        "seconds": m.get("duration_s") or round(result.get("duration_ms", 0) / 1000) or None,
        "cost_usd": result.get("total_cost_usd"),
        # 하네스 장애(claude 비정상 종료)와 에이전트 실패를 구분하기 위한 표시
        "harness_error": bool(result.get("is_error")) or not result.get("result"),
        # ↓ 채점자가 보고문을 읽고 채운다
        "detected": {d: None for d in case.get("defects", [])},
        "evidence_cited": None,
        "evidence_total": case.get("evidence_total"),
        "gate_reported": None,
        "gate_actual": case.get("gate_actual"),
        "drift_isolated": None,
        "false_positives": None,
        # 정답지를 읽었으면 그 회차는 측정이 아니다 — 즉시 FAIL 로 미리 채워 집계에서 반려된다
        "immediate_fail": ("정답지/케이스 메타를 열람했다 — 이 회차는 측정 무효"
                           if peeked_at_answers(run_dir, i, case_dir) else None),
    })

out = {"case": case.get("id"), "label": label, "agent": case.get("agent"),
       "expected_severity": case.get("expected_severity", {}), "runs": runs}
json.dump(out, open(os.path.join(run_dir, "runs.json"), "w"), ensure_ascii=False, indent=2)
print(f"\n{len(runs)}회 완료 (기계 항목 기입됨, 판단 항목은 null)")
print(f"RUNS_JSON={run_dir}/runs.json")  # run-suite.sh 가 이 줄을 읽는다
PY

cat <<EOF

다음 단계
  1. 채점: 각 run-N.json 의 보고문을 정답지($CASE_DIR/answer-key.md)와 대조해
     runs.json 의 null 항목(detected / evidence_cited / gate_reported / drift_isolated / false_positives)을 채운다.
     Claude 로 채점하려면:  /eval-agent $RUN_DIR
  2. 두 라벨을 모았으면 집계:
     python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/scorecard.py <BEFORE-runs.json> <AFTER-runs.json>
EOF
