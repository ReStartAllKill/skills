#!/usr/bin/env bash
# Run an agent evaluation case k times and save runs.json plus execution logs.
# Usage: run-case.sh <case-dir> --label BEFORE [--k 3] [--harness <.claude-dir>] [--agent <type>] [--keep]
# Output: ~/agent-evals/runs/<repo>/<case>/<label>-<timestamp>/
set -euo pipefail
SELF_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Resolve sibling scripts relative to this file.

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
# Create worktrees outside ~/.claude/, where Write/Edit is restricted. Override with EVAL_RUNS_ROOT.
RUNS_ROOT="${EVAL_RUNS_ROOT:-$HOME/agent-evals/runs}"
RUN_DIR="$RUNS_ROOT/$REPO/$CASE_ID/$LABEL-$TS"
TREE="$RUN_DIR/tree"
mkdir -p "$RUN_DIR"

echo "케이스 $CASE_ID · 라벨 $LABEL · ${K}회 · 에이전트 $AGENT"
echo "워크트리: $TREE"

# Without --harness, evaluate the harness at the base commit.
HEAD_SHA=$(git -C "$REPO_PATH" rev-parse --short HEAD)
BASE_SHA=$(git -C "$REPO_PATH" rev-parse --short "$BASE")
if [[ -z "$HARNESS" && "$HEAD_SHA" != "$BASE_SHA" ]]; then
  echo "  ※ 이 실행의 하네스는 base 커밋 $BASE_SHA 시점 것이다 (현재 HEAD $HEAD_SHA 아님)."
  echo "    현재 커밋본을 재려면 --harness <repo>/.claude 를 주거나 케이스를 새 base 로 다시 떠라."
fi

git -C "$REPO_PATH" worktree add --detach "$TREE" "$BASE" >/dev/null

# Link node_modules after committing patches so links stay out of the evaluated diff.

apply_and_commit() {
  local patch="$1" msg="$2"
  [[ -f "$patch" ]] || return 0
  git -C "$TREE" apply --check "$patch" || { echo "패치가 안 맞는다 — base 커밋이 밀렸다. 정답지 재검증이 필요하다: $patch"; exit 1; }
  # Stage only files included in the patch.
  git -C "$TREE" apply --index "$patch"
  git -C "$TREE" -c user.name=eval -c user.email=eval@local commit -q -m "$msg"
}

DRIFT_MSG=$(read_setup drift_commit_message); DRIFT_MSG=${DRIFT_MSG:-"chore: 선행 변경"}
DEFECTS_MSG=$(read_setup defects_commit_message); DEFECTS_MSG=${DEFECTS_MSG:-"feat: 심사 대상 브랜치"}

apply_and_commit "$CASE_DIR/drift.patch" "$DRIFT_MSG"
DRIFT_COMMIT=$(git -C "$TREE" rev-parse --short HEAD)
apply_and_commit "$CASE_DIR/defects.patch" "$DEFECTS_MSG"

# Link node_modules for verification.
ln -s "$REPO_PATH/node_modules" "$TREE/node_modules" 2>/dev/null || true

# Copy per-package pnpm node_modules so relative links resolve inside the evaluation worktree.
for src in "$REPO_PATH"/apps/*/node_modules "$REPO_PATH"/packages/*/node_modules; do
  [[ -d "$src" ]] || continue
  rel=${src#"$REPO_PATH"/}
  mkdir -p "$(dirname "$TREE/$rel")"
  rsync -a --links "$src/" "$TREE/$rel/"
done

# Add only missing dependency links instead of running pnpm install against the source tree.
python3 "$SELF_DIR/resolve-workspace-deps.py" "$TREE" "$REPO_PATH" || true

DEFECTS_COMMIT=$(git -C "$TREE" rev-parse HEAD)

# Reset the tree for each run, then reapply the evaluation harness.
apply_harness() {
  [[ -n "$HARNESS" ]] || return 0
  local excludes=(--exclude 'worktrees/' --exclude 'evals/results/')
  [[ $WITH_MEMORY -eq 0 ]] && excludes+=(--exclude 'agent-memory/')
  rsync -a --delete "${excludes[@]}" "$HARNESS/" "$TREE/.claude/"
  # Copy CLAUDE.md because it contains verification commands and project rules.
  local harness_root; harness_root=$(dirname "$HARNESS")
  # Return zero when optional files are absent so set -e does not exit.
  for f in CLAUDE.md AGENTS.md; do
    [[ -f "$harness_root/$f" ]] && cp "$harness_root/$f" "$TREE/$f"
  done
  return 0
}

if [[ -n "$HARNESS" ]]; then
  echo "하네스 덮어쓰기: $HARNESS"
  apply_harness
fi

# Derive tool permissions from the evaluated agent definition. Allow writes only when declared.
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

# Session transcript directory name: cwd with `/` and `.` replaced by `-`.
SLUG=$(echo "$TREE" | sed 's|[/.]|-|g')
PROJECT_DIR="$HOME/.claude/projects/$SLUG"

# Back up source-repository auto-memory before evaluation and restore it on exit.
# Batch runs share EVAL_MEMORY_SNAPSHOT and delegate backup and restore to run-suite.sh.
MEM_DIR="$HOME/.claude/projects/$(echo "$REPO_PATH" | sed 's|[/.]|-|g')/memory"
MEM_SNAPSHOT="${EVAL_MEMORY_SNAPSHOT:-}"
MEM_MANAGED_BY_SUITE=0
if [[ -n "$MEM_SNAPSHOT" ]]; then
  MEM_MANAGED_BY_SUITE=1
elif [[ -d "$MEM_DIR" ]]; then
  MEM_SNAPSHOT="$RUN_DIR/memory-snapshot"
  cp -R "$MEM_DIR" "$MEM_SNAPSHOT"
fi

# Restore memory between sequential runs to isolate their results.
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
  # Prune registrations for deleted worktrees.
  git -C "$REPO_PATH" worktree prune >/dev/null 2>&1 || true
}
# Restore memory after interruption or failure.
trap cleanup EXIT INT TERM

one_run() {
  local i="$1" sid
  sid=$(uuidgen | tr 'A-Z' 'a-z')
  echo "  [$i/$K] session $sid"
  # Delete ignored agent-memory explicitly because reset and clean do not remove it.
  rm -rf "$TREE/.claude/agent-memory"

  # Reset code so writer agents cannot inherit an earlier run's implementation.
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
  # Save writer diffs for implementation-result grading.
  if [[ $IS_WRITER -eq 1 ]]; then
    git -C "$TREE" add -A -- ':!node_modules' >/dev/null 2>&1 || true
    git -C "$TREE" diff --cached "$DEFECTS_COMMIT" -- ':!node_modules' > "$RUN_DIR/run-$i.diff" 2>/dev/null || true
  fi
  cp "$PROJECT_DIR/$sid.jsonl" "$RUN_DIR/run-$i.jsonl" 2>/dev/null \
    || echo "  [$i/$K] 트랜스크립트를 못 찾았다: $PROJECT_DIR/$sid.jsonl"
  # Restore memory after each sequential run.
  if [[ $JOBS -eq 1 ]]; then restore_memory; fi
}

# Runs share a worktree and caches, so the default is sequential. Parallelize cases with run-suite.sh.
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
    # Check answer-key filenames only to avoid treating directory listings as answer leakage.
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
        # Fall back to CLI result JSON when no transcript exists.
        "tokens": m.get("output_tokens") or usage.get("output_tokens"),
        "tools": m.get("tool_calls"),
        "seconds": m.get("duration_s") or round(result.get("duration_ms", 0) / 1000) or None,
        "cost_usd": result.get("total_cost_usd"),
        # Distinguish harness failures from agent failures.
        "harness_error": bool(result.get("is_error")) or not result.get("result"),
        # Fields completed by the grader.
        "detected": {d: None for d in case.get("defects", [])},
        "evidence_cited": None,
        "evidence_total": case.get("evidence_total"),
        "gate_reported": None,
        "gate_actual": case.get("gate_actual"),
        "drift_isolated": None,
        "false_positives": None,
        # Mark runs that read the answer key as immediate_fail.
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
