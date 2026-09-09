#!/usr/bin/env python3
"""Combine runs.json files from multiple cases and configurations into one report.

  report.py <runs.json...> [--out report.md] [--cases-root ~/.claude/evals/cases/<repo>]

Group cases by `case` and configurations by `label`. Compare configurations when a case has
multiple labels; otherwise report a single measurement. Detection rates by difficulty require
`defect_tiers` ({"D1": "T2", ...}) in case.json.
"""

import argparse
import collections
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scorecard import WEIGHTS_LEGACY, WEIGHTS_V2, score  # noqa: E402

ADOPT_THRESHOLD = 85  # Matches the adoption rule in rubric section 3.

TIER_LABEL = {
    "T1": "T1 기계 검출 (lint·typecheck가 잡는다)",
    "T2": "T2 규칙·컨벤션 (자동 검사 없음)",
    "T3": "T3 도메인·아키텍처 (스펙 대조·교차 파일 추론)",
}


def default_cases_roots(files):
    """Infer case roots from runs.json paths.

    Given ~/agent-evals/runs/<repo>/<case>/<label>-<ts>/runs.json, cases for the same
    repository live under ~/.claude/evals/cases/<repo>/.
    """
    roots = []
    for f in files:
        parts = os.path.abspath(f).split(os.sep)
        if "runs" in parts:
            i = len(parts) - 1 - parts[::-1].index("runs")
            if i + 1 < len(parts):
                root = os.sep.join(parts[:i] + ["cases", parts[i + 1]])
                if root not in roots:
                    roots.append(root)
    return roots


def load_tiers(case_id, roots):
    for root in roots:
        path = os.path.join(os.path.expanduser(root), case_id, "case.json")
        if os.path.exists(path):
            try:
                return json.load(open(path)).get("defect_tiers", {})
            except ValueError:
                return {}
    return {}


def md_table(head, rows):
    out = ["| " + " | ".join(head) + " |", "| " + " | ".join("---" for _ in head) + " |"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", help="마크다운 저장 경로 (없으면 stdout)")
    ap.add_argument("--cases-root", action="append", default=[],
                    help="case.json 을 찾을 루트 (기본: runs 경로에서 유추)")
    ap.add_argument("--weights", choices=["v2", "legacy"], default="v2",
                    help="scorecard.py 와 같은 배점 선택")
    args = ap.parse_args()

    files = []
    for f in args.files:
        files.extend(sorted(glob.glob(f)) if any(ch in f for ch in "*?") else [f])

    weights = WEIGHTS_LEGACY if args.weights == "legacy" else WEIGHTS_V2
    by_case = collections.OrderedDict()
    for path in files:
        try:
            with open(path) as source:
                data = json.load(source)
            scored = score(data, weights)
        except (OSError, ValueError) as error:
            ap.exit(1, f"{path}: {error}\n집계를 중단했다. 입력을 보완한 뒤 다시 실행한다.\n")
        case_id, label = data.get("case", "?"), data.get("label", "?")
        bucket = by_case.setdefault(case_id, [])
        if any(s["label"] == label for s in bucket):
            print(f"[!] {case_id}/{label} 가 두 번 들어왔다 — 표에는 마지막 것만 나오고 평균은 둘 다 센다: {path}",
                  file=sys.stderr)
        bucket.append(scored)

    roots = args.cases_root or default_cases_roots(files)
    if not any(load_tiers(case_id, roots) for case_id in by_case):
        print("[!] case.json 을 못 찾아 난이도별 검출률을 건너뛴다 — --cases-root 를 지정해라", file=sys.stderr)
    lines = ["# 에이전트 평가 리포트", ""]

    # Use the first label as the comparison baseline (BEFORE).
    labels = []
    for scores in by_case.values():
        for s in scores:
            if s["label"] not in labels:
                labels.append(s["label"])
    head = ["케이스", "k", *labels]
    rows = []
    for case_id, scores in by_case.items():
        by_label = {s["label"]: s for s in scores}
        rows.append([case_id, by_label[scores[0]["label"]]["k"],
                     *[f"{by_label[l]['total']:.0f}" if l in by_label else "—" for l in labels]])
    if len(by_case) > 1:
        avg = ["평균", ""]
        for l in labels:
            vals = [s["total"] for scores in by_case.values() for s in scores if s["label"] == l]
            avg.append(f"{sum(vals) / len(vals):.0f}" if vals else "—")
        rows.append(avg)
    lines += ["## 총점", "", md_table(head, rows), ""]

    # Detection rate by difficulty.
    tier_rows = []
    for case_id, scores in by_case.items():
        tiers = load_tiers(case_id, roots)
        if not tiers:
            continue
        for label in labels:
            s = next((x for x in scores if x["label"] == label), None)
            if s is None:
                continue
            per_tier = collections.defaultdict(lambda: [0, 0])
            for run in s["runs"]:
                for defect, severity in run["detected"].items():
                    tier = tiers.get(defect, "?")
                    per_tier[tier][1] += 1
                    if severity:
                        per_tier[tier][0] += 1
            for tier in sorted(per_tier):
                hit, total = per_tier[tier]
                tier_rows.append([case_id, label, TIER_LABEL.get(tier, tier),
                                  f"{hit}/{total}", f"{hit / total * 100:.0f}%"])
    if tier_rows:
        lines += ["## 난이도별 검출률", "",
                  md_table(["케이스", "설정", "난이도", "검출", "비율"], tier_rows), ""]

    # Exclude dimensions that do not apply to negative controls.
    axis_rows = []
    all_axes = list(weights) + [a for s in (x for v in by_case.values() for x in v)
                                for a in s["axes"] if a not in weights]
    for axis in dict.fromkeys(all_axes):
        row = [axis]
        for label in labels:
            got = [s["axes"][axis][0] for scores in by_case.values() for s in scores
                   if s["label"] == label and axis in s["axes"]]
            cap = [s["weights"][axis] for scores in by_case.values() for s in scores
                   if s["label"] == label and axis in s["axes"]]
            row.append(f"{sum(got) / sum(cap) * 100:.0f}%" if cap and sum(cap) else "—")
        axis_rows.append(row)
    lines += ["## 축별 달성률", "", md_table(["축", *labels], axis_rows),
              "", "_케이스마다 배점이 다를 수 있어(대조 케이스는 오탐 축 60점) 점수 대신 달성률로 낸다._", ""]

    # Cost.
    cost_rows = []
    for key, name, fmt in (("tokens", "토큰", "{:,.0f}"), ("tools", "tool 호출", "{:.1f}"),
                           ("seconds", "소요 시간", "{:.0f}s"), ("cost_usd", "비용(USD)", "${:.2f}")):
        row = [name]
        any_value = False
        for label in labels:
            vals = [s["cost"][key] for scores in by_case.values() for s in scores
                    if s["label"] == label and s["cost"][key] is not None]
            row.append(fmt.format(sum(vals) / len(vals)) if vals else "—")
            any_value = any_value or bool(vals)
        if any_value:
            cost_rows.append(row)
    lines += ["## 비용 (실행 1회 평균)", "", md_table(["", *labels], cost_rows), ""]

    # Weaknesses.
    weak = []
    for case_id, scores in by_case.items():
        for s in scores:
            for axis, (value, detail) in s["axes"].items():
                cap = s["weights"].get(axis)
                if cap is not None and value < cap - 1e-9:
                    weak.append([case_id, s["label"], axis, f"{round(value, 1):g}/{cap}", detail])
    if weak:
        lines += ["## 만점 미달 축", "",
                  md_table(["케이스", "설정", "축", "점수", "내역"], weak), ""]

    # Report immediate failures before scores. Input validation rejects harness errors.
    trust = []
    for case_id, scores in by_case.items():
        for s in scores:
            for n, why in s["immediate_fails"]:
                trust.append([case_id, s["label"], f"run {n}", why])
    if trust:
        lines = lines[:1] + ["", "> **즉시 FAIL 있음 — 점수와 무관하게 반려 대상이다.**", "",
                             md_table(["케이스", "설정", "회차", "사유"], trust), ""] + lines[1:]
    if len(labels) >= 2:
        base_label, *rest = labels
        verdicts = []
        for label in rest:
            gap, regress, fails, totals = 0.0, [], [], []
            for case_id, scores in by_case.items():
                b = next((x for x in scores if x["label"] == base_label), None)
                v = next((x for x in scores if x["label"] == label), None)
                if b and v:
                    gap += v["total"] - b["total"]
                    totals.append(v["total"])
                    if v["detection_ratio"] < b["detection_ratio"] - 1e-9:
                        regress.append(case_id)
                    if v["immediate_fails"]:
                        fails.append(case_id)
            mean_total = sum(totals) / len(totals) if totals else 0
            if not totals:
                verdicts.append([label, "—", "—", f"비교 불가 — {base_label} 와 공통 케이스가 없다"])
                continue
            if fails:
                note = f"**반려** — 즉시 FAIL: {', '.join(fails)}"
            elif regress:
                note = f"**반려** — 검출률 하락: {', '.join(regress)}"
            elif gap > 0 and mean_total >= ADOPT_THRESHOLD:
                note = "**채택 가능**"
            elif gap > 0:
                note = f"개선이지만 케이스 평균 {mean_total:.0f}점 < {ADOPT_THRESHOLD} — 재측정"
            else:
                note = "채택 근거 없음"
            verdicts.append([label, f"{gap:+.0f}", f"{mean_total:.0f}", note])
        lines += ["## 판정", "",
                  md_table(["설정", f"총점 합 차이 (vs {base_label})", "케이스 평균", "판정"], verdicts),
                  "",
                  f"채택 = 총점 우위 + 케이스 평균 {ADOPT_THRESHOLD}점 이상 + 검출률 비열세 + 즉시 FAIL 없음. "
                  "검출률 하락과 즉시 FAIL은 점수로 갚을 수 없다.", ""]

    text = "\n".join(lines)
    if args.out:
        open(args.out, "w").write(text)
        print(f"리포트 저장: {args.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
