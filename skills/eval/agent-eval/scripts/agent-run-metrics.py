#!/usr/bin/env python3
"""서브에이전트 실행(run) 트랜스크립트에서 채점용 지표를 뽑는다.

트랜스크립트 위치:
  ~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<id>.jsonl
  같은 이름의 .meta.json 에 agentType 이 들어 있다.

사용:
  agent-run-metrics.py <경로...>                 # 경로 = jsonl | subagents 디렉터리 | 세션 디렉터리 | 프로젝트 디렉터리
  agent-run-metrics.py --summary <경로...>       # agentType 별 중앙값(기준선 산출용)
  agent-run-metrics.py --agent frontend-auditor <경로...>
  agent-run-metrics.py --json <경로...>          # 기계 판독용
  agent-run-metrics.py --write-allow 'agent-memory|scratchpad' <경로...>

지표: 소요 시간 · 툴 호출 수 · 출력 토큰 · 허용 경로 밖 write · 동일 명령 반복 · 같은 파일 재읽기.
채점 기준은 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/rubrics/agent-run-quality.md.
"""

import argparse
import collections
import glob
import json
import os
import re
import statistics
import sys
from datetime import datetime

WRITE_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")
# 감사·탐색 에이전트에 허용되는 write 경로(메모리 갱신·임시 파일). 이 밖은 역할 위반 후보.
DEFAULT_WRITE_ALLOW = r"agent-memory|scratchpad|/tmp/|/T/"
# read-only 로 규정된 역할. 이 패턴에 걸리는 agentType 만 write 위반을 표시한다.
DEFAULT_READONLY = r"auditor|reviewer|locator|finder|Explore|explorer"


def find_runs(paths):
    """입력 경로들을 agent-*.jsonl 목록으로 펼친다."""
    out = []
    for p in paths:
        p = os.path.expanduser(p)
        if os.path.isfile(p):
            out.append(p)
        elif os.path.isdir(p):
            for pattern in ("agent-*.jsonl", "subagents/agent-*.jsonl", "*/subagents/agent-*.jsonl"):
                out.extend(glob.glob(os.path.join(p, pattern)))
    return sorted(set(out))


def parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def measure(path, write_allow, readonly_pattern, agent_type=None):
    meta_path = path.replace(".jsonl", ".meta.json")
    meta = {}
    if os.path.exists(meta_path):
        try:
            meta = json.load(open(meta_path))
        except ValueError:
            pass
    # 최상위 `claude -p --agent X` 세션에는 .meta.json 이 없다 — 역할을 모르면 write 검사가 꺼지므로
    # 호출자가 --agent-type 으로 알려준다.
    if agent_type and not meta.get("agentType"):
        meta["agentType"] = agent_type

    tools = collections.Counter()
    reads = collections.Counter()
    bash_cmds = collections.Counter()
    writes, first_ts, last_ts = [], None, None
    # 같은 assistant 메시지가 content block 수만큼 줄로 쪼개져 기록되고 usage 가 그대로 반복된다.
    # 그냥 더하면 배로 뻥튀기된다(실측 2.36배) — message.id 별 마지막 값만 남긴다.
    tokens_by_msg = {}
    orphan_tokens = 0
    final_text = ""

    for line in open(path, errors="replace"):
        try:
            rec = json.loads(line)
        except ValueError:
            continue

        ts = parse_ts(rec.get("timestamp"))
        if ts:
            first_ts = first_ts or ts
            last_ts = ts

        message = rec.get("message") or {}
        usage = message.get("usage") or {}
        if usage:
            msg_id = message.get("id")
            if msg_id:
                tokens_by_msg[msg_id] = usage.get("output_tokens", 0)
            else:
                orphan_tokens += usage.get("output_tokens", 0)

        content = message.get("content")
        if isinstance(content, str) and rec.get("type") == "assistant":
            final_text = content
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and rec.get("type") == "assistant":
                final_text = block.get("text", "")
            if block.get("type") != "tool_use":
                continue
            name = block.get("name", "?")
            inp = block.get("input", {}) if isinstance(block.get("input"), dict) else {}
            tools[name] += 1
            if name == "Read":
                reads[inp.get("file_path", "")] += 1
            if name in WRITE_TOOLS:
                writes.append(inp.get("file_path", ""))
            if name == "Bash":
                bash_cmds[(inp.get("command") or "").strip()] += 1

    agent_type = meta.get("agentType", "?")
    is_readonly = bool(re.search(readonly_pattern, agent_type, re.I))
    disallowed = [w for w in writes if w and not re.search(write_allow, w)] if is_readonly else []
    repeated_bash = {c[:80]: n for c, n in bash_cmds.items() if n >= 3 and c}
    reread = {f: n for f, n in reads.items() if n >= 2 and f}

    return {
        "run": os.path.basename(path),
        "agent": agent_type,
        "readonly_role": is_readonly,
        "task": meta.get("description", ""),
        "duration_s": round((last_ts - first_ts).total_seconds()) if first_ts and last_ts else None,
        "tool_calls": sum(tools.values()),
        "tools": tools.most_common(6),
        "output_tokens": sum(tokens_by_msg.values()) + orphan_tokens,
        "writes": writes,
        "writes_outside_allow": disallowed,
        "repeated_bash": repeated_bash,
        "reread_files": reread,
        "final_report_chars": len(final_text),
        "path": path,
    }


def print_run(m):
    print(f"\n=== {m['agent']}  ({m['run']})")
    if m["task"]:
        print(f"    task: {m['task']}")
    print(
        f"    tool calls {m['tool_calls']} · output tokens {m['output_tokens']:,} · "
        f"{m['duration_s']}s · report {m['final_report_chars']} chars"
    )
    print(f"    tools: {m['tools']}")
    if m["writes"] and not m["readonly_role"]:
        print(f"    writes: {len(m['writes'])}건 ({len(set(m['writes']))} 파일)")
    if m["writes_outside_allow"]:
        print("    [!] read-only 역할인데 허용 경로 밖 write:")
        for w in m["writes_outside_allow"]:
            print(f"        {w}")
    if m["repeated_bash"]:
        print("    [!] 동일 명령 3회 이상:")
        for c, n in m["repeated_bash"].items():
            print(f"        {n}x  {c}")
    if m["reread_files"]:
        print(f"    [!] 재읽기 {len(m['reread_files'])}건: {list(m['reread_files'])[:3]}")


def print_summary(runs):
    by_agent = collections.defaultdict(list)
    for m in runs:
        by_agent[m["agent"]].append(m)
    print(f"\n{'agent':22} {'n':>3} {'tool(med)':>10} {'tok(med)':>10} {'sec(med)':>9}  range(tool)")
    for agent, group in sorted(by_agent.items(), key=lambda kv: -len(kv[1])):
        calls = [m["tool_calls"] for m in group]
        toks = [m["output_tokens"] for m in group]
        secs = [m["duration_s"] for m in group if m["duration_s"] is not None] or [0]
        print(
            f"{agent:22} {len(group):>3} {statistics.median(calls):>10.0f} "
            f"{statistics.median(toks):>10,.0f} {statistics.median(secs):>9.0f}  {min(calls)}–{max(calls)}"
        )
    flagged = [m for m in runs if m["writes_outside_allow"]]
    if flagged:
        print(f"\n[!] read-only 역할인데 허용 경로 밖 write 를 한 실행 {len(flagged)}건:")
        for m in flagged:
            print(f"  {m['agent']:20} {m['run']}  {m['writes_outside_allow'][:2]}")


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--agent", help="agentType 필터")
    ap.add_argument("--summary", action="store_true", help="agentType 별 중앙값만")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--write-allow", default=DEFAULT_WRITE_ALLOW, help="write 가 허용되는 경로 정규식")
    ap.add_argument("--readonly-agents", default=DEFAULT_READONLY, help="read-only 로 규정된 agentType 정규식")
    ap.add_argument("--agent-type", help=".meta.json 이 없는 최상위 세션의 agentType 을 지정")
    args = ap.parse_args()

    files = find_runs(args.paths)
    if not files:
        sys.exit("agent-*.jsonl 을 찾지 못했다. 세션 디렉터리나 subagents 디렉터리를 넘겨라.")

    runs = [measure(f, args.write_allow, args.readonly_agents, args.agent_type) for f in files]
    if args.agent:
        runs = [m for m in runs if m["agent"] == args.agent]
    if not runs:
        sys.exit(f"'{args.agent}' 실행이 없다.")

    if args.json:
        print(json.dumps(runs, ensure_ascii=False, indent=2))
    elif args.summary:
        print_summary(runs)
    else:
        for m in runs:
            print_run(m)
        if len(runs) > 1:
            print_summary(runs)


if __name__ == "__main__":
    main()
