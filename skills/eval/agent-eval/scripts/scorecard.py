#!/usr/bin/env python3
"""Aggregate graded runs.json files into raw results, scorecards, and cost tables.

Usage:
  scorecard.py <BEFORE-runs.json> [<AFTER-runs.json> ...]
  scorecard.py --md <...>            # Emit Markdown tables for PRs and documentation.

Weights match section 3 of the agent-run-quality rubric. Negative controls assign 60 points to
false-positive avoidance, 20 to gate accuracy, and 20 to evidence reproducibility. Use
--weights legacy only to compare historical measurements without severity accuracy.

runs.json schema for one run (the grader completes judgment fields):
  detected        {"D1": "Low", "D2": "Critical", "D3": null}   # null = not detected
  evidence_cited  4        evidence_total 4
  gate_reported   "FAIL (lint)"    gate_actual "FAIL (lint)"    # Cause must match for full credit.
  drift_isolated  true|false       false_positives 0
  immediate_fail  "reason" | null  # Reject regardless of score when set.
  tokens / tools / seconds / cost_usd / harness_error           # Populated by run-case.sh.
"""

import argparse
import collections
import json
import re
import statistics
import sys
import unicodedata

WEIGHTS_V2 = {
    "검출률": 25,
    "심각도 정확도": 10,
    "게이트 정확도": 20,
    "증거 재현성": 20,
    "드리프트 분리": 10,
    "오탐 없음": 10,
    "심각도 일관성": 5,
}
# Legacy weights without severity accuracy, for historical comparisons only.
WEIGHTS_LEGACY = {
    "검출률": 30,
    "게이트 정확도": 25,
    "증거 재현성": 20,
    "드리프트 분리": 10,
    "오탐 없음": 10,
    "심각도 일관성": 5,
}
WEIGHTS = WEIGHTS_V2
# Negative controls assign detection and severity weight to false-positive avoidance.
WEIGHTS_NEGATIVE_CONTROL = {
    "오탐 없음": 60,
    "게이트 정확도": 20,
    "증거 재현성": 20,
}
# Penalize each false positive by 3 per run; normalize by k to keep configurations comparable.
FALSE_POSITIVE_PENALTY = 3
# For negative controls, penalize each false positive by 15 because it is the primary signal.
FALSE_POSITIVE_PENALTY_NC = 15
SEVERITY_ORDER = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]


def severity_distance(reported, expected):
    """Return distance from expected severity, such as High|Critical, or None."""
    if not reported or not expected:
        return None
    r = str(reported).strip().upper()
    if r not in SEVERITY_ORDER:
        return None
    accepted = [s.strip().upper() for s in str(expected).split("|")]
    idx = [SEVERITY_ORDER.index(s) for s in accepted if s in SEVERITY_ORDER]
    if not idx:
        return None
    ri = SEVERITY_ORDER.index(r)
    if min(idx) <= ri <= max(idx):
        return 0
    return min(abs(ri - i) for i in idx)


GATE_NAMES = ("format", "lint", "typecheck", "test", "build", "browser", "design")


def norm_gate(value):
    """Normalize a gate report to (status, causes).

    'FAIL (lint)' → ('FAIL', {'lint'}), 'FAIL(lint, typecheck)' → ('FAIL', {'lint','typecheck'}).
    Also accept per-gate reports without a leading status. Any FAIL makes the overall status FAIL.
    Award half credit when status matches but the reported cause differs.
    """
    if value is None:
        return None
    text = str(value).strip()
    upper = text.upper()
    if upper.startswith("FAIL"):
        status = "FAIL"
    elif upper.startswith("PASS"):
        status = "PASS"
    elif re.search(r"\bFAIL\b", upper) or "실패" in text:
        # Any failed gate makes the result FAIL. Use word boundaries to avoid matching error codes.
        status = "FAIL"
    elif re.search(r"\bPASS\b", upper) or "통과" in text:
        status = "PASS"
    else:
        # Reports without a status, such as "not run", cannot match the expected result.
        status = upper
    causes = {g for g in GATE_NAMES if g in text.lower()}
    return status, frozenset(causes)


def gate_credit(reported, actual):
    """Score 1.0 for matching status and cause, 0.5 for status only, or 0 otherwise."""
    r, a = norm_gate(reported), norm_gate(actual)
    if r is None or a is None or r[0] != a[0]:
        return 0.0
    if not a[1]:            # Compare status only when the answer has no cause.
        return 1.0
    return 1.0 if r[1] & a[1] else 0.5


def validate_runs(data, weights):
    """Reject ungraded runs and execution errors; allow misses and empty negative controls."""
    if not isinstance(data, dict) or not isinstance(data.get("runs"), list) or not data["runs"]:
        raise ValueError("runs에는 실행 결과가 하나 이상 있어야 한다")
    problems = []
    defects = None
    seen = set()
    drift_values = []
    for index, run in enumerate(data["runs"], 1):
        if not isinstance(run, dict):
            problems.append(f"회차 {index}: 실행 결과는 객체여야 한다")
            continue
        number = run.get("n")
        prefix = f"회차 {number if type(number) is int else index}"
        if type(number) is not int or number < 1:
            problems.append(f"{prefix}: n은 양의 정수여야 한다")
        elif number in seen:
            problems.append(f"{prefix}: 중복 회차")
        else:
            seen.add(number)
        if run.get("harness_error"):
            problems.append(f"{prefix}: 하네스 실행 오류 — 해당 회차를 다시 실행한다")
        for field in ("gate_reported", "gate_actual"):
            if not isinstance(run.get(field), str) or not run[field].strip():
                problems.append(f"{prefix}: {field} 누락 또는 미채점")
        for field in ("evidence_cited", "evidence_total", "false_positives"):
            value = run.get(field)
            if type(value) is not int or value < 0:
                problems.append(f"{prefix}: {field}는 0 이상의 정수여야 한다 (누락·미채점 불가)")
        cited, total = run.get("evidence_cited"), run.get("evidence_total")
        if type(cited) is int and type(total) is int and cited > total:
            problems.append(f"{prefix}: evidence_cited가 evidence_total을 초과한다")
        if "drift_isolated" not in run or (run["drift_isolated"] is not None and type(run["drift_isolated"]) is not bool):
            problems.append(f"{prefix}: drift_isolated는 true·false·null 중 하나여야 한다")
        drift_values.append(run.get("drift_isolated"))
        detected = run.get("detected")
        if not isinstance(detected, dict):
            problems.append(f"{prefix}: detected 누락 또는 형식 오류")
            continue
        if defects is None:
            defects = set(detected)
        elif set(detected) != defects:
            problems.append(f"{prefix}: detected의 결함 ID가 다른 회차와 다르다")
        for defect, severity in detected.items():
            if severity is not None and (not isinstance(severity, str) or severity.upper() not in SEVERITY_ORDER):
                problems.append(f"{prefix}: {defect} 심각도는 Info·Low·Medium·High·Critical 또는 null이어야 한다")
    # All-null values mean the case has no seeded defects; partial nulls indicate missing grading.
    if any(value is None for value in drift_values) and any(value is not None for value in drift_values):
        problems.append("drift_isolated 일부 회차 미채점 — 선행 결함이 없을 때만 모든 회차에 null을 사용한다")
    expected = data.get("expected_severity")
    if isinstance(expected, dict) and expected and set(expected) != defects:
        problems.append("detected의 결함 ID가 expected_severity와 다르다")
    if weights.get("심각도 정확도", 0) and defects:
        for defect in sorted(defects):
            value = expected.get(defect) if isinstance(expected, dict) else None
            if not isinstance(value, str) or any(s.strip().upper() not in SEVERITY_ORDER for s in value.split("|")):
                problems.append(f"expected_severity.{defect} 누락 또는 형식 오류")
    if problems:
        raise ValueError(f"{data.get('label', '?')}: 평가 입력이 유효하지 않다\n  " + "\n  ".join(problems))


def score(data, weights=None):
    weights = weights or WEIGHTS
    validate_runs(data, weights)
    runs = data["runs"]
    k = len(runs)
    defects = list(runs[0]["detected"].keys()) if runs else []
    opportunities = k * len(defects)

    found = sum(1 for r in runs for v in r["detected"].values() if v)
    # Do not score detection rate for negative controls.
    negative_control = len(defects) == 0
    if negative_control:
        weights = WEIGHTS_NEGATIVE_CONTROL
    detection = weights.get("검출률", 0) * (found / opportunities if opportunities else 1.0)

    # Severity scores 1.0 in range, 0.5 one level away, and 0 otherwise. Detection handles misses.
    expected = data.get("expected_severity", {})
    sev_scores = []
    for r in runs:
        for defect, reported in r["detected"].items():
            if not reported:
                continue
            distance = severity_distance(reported, expected.get(defect))
            if distance is None:
                continue
            sev_scores.append(1.0 if distance == 0 else 0.5 if distance == 1 else 0.0)
    severity_accuracy = (weights.get("심각도 정확도", 0) * sum(sev_scores) / len(sev_scores)
                         if sev_scores else weights.get("심각도 정확도", 0))

    gate_credits = [gate_credit(r.get("gate_reported"), r.get("gate_actual")) for r in runs]
    gate_ok = sum(gate_credits)
    gate = weights.get("게이트 정확도", 0) * gate_ok / k
    partial = sum(1 for c in gate_credits if c == 0.5)

    cited = sum(r.get("evidence_cited") or 0 for r in runs)
    total = sum(r.get("evidence_total") or 0 for r in runs)
    evidence = weights.get("증거 재현성", 0) * cited / total if total else 0

    # Drift isolation does not apply when the case contains no drift.
    drift_applicable = any(r.get("drift_isolated") is not None for r in runs)
    drift_ok = sum(1 for r in runs if r.get("drift_isolated"))
    drift = weights.get("드리프트 분리", 0) * (drift_ok / k if drift_applicable else 1.0)

    fp_total = sum(r.get("false_positives") or 0 for r in runs)
    fp_per_run = fp_total / k
    penalty = FALSE_POSITIVE_PENALTY_NC if negative_control else FALSE_POSITIVE_PENALTY
    fp_score = max(0, weights["오탐 없음"] - penalty * fp_per_run)

    # Severity consistency scores 2 for one-level variance and 0 for two or more; require two samples.
    spreads = []
    for d in defects:
        levels = [str(r["detected"][d]).upper() for r in runs if r["detected"].get(d)]
        idx = [SEVERITY_ORDER.index(x) for x in levels if x in SEVERITY_ORDER]
        if len(idx) >= 2:
            spreads.append(max(idx) - min(idx))
    measurable = k >= 2 and bool(spreads)
    worst = max(spreads) if spreads else 0
    consistency = (weights.get("심각도 일관성", 0) if worst == 0 else 2 if worst == 1 else 0) \
        if measurable else weights.get("심각도 일관성", 0)

    axes = {
        "검출률": (detection, "해당 없음(대조 케이스)" if negative_control else f"{found}/{opportunities}"),
        "게이트 정확도": (gate, f"{gate_ok:g}/{k}" + (f" (원인 불일치 {partial})" if partial else "")),
        "증거 재현성": (evidence, f"{cited}/{total}"),
        "드리프트 분리": (drift, f"{drift_ok}/{k}" if drift_applicable else "해당 없음"),
        "오탐 없음": (fp_score, f"오탐 {fp_total}건 (회차당 {fp_per_run:.1f})"),
        "심각도 일관성": (consistency, f"최대 {worst}단계 흔들림" if measurable else "측정 불가(k<2)"),
    }
    if "심각도 정확도" in weights:
        axes["심각도 정확도"] = (
            severity_accuracy,
            f"{sum(sev_scores):.1f}/{len(sev_scores)} 기대 부합" if sev_scores
            else "해당 없음(대조 케이스)" if negative_control else "판정 불가",
        )
    axes = {name: axes[name] for name in weights}  # 표 순서를 배점 정의 순서에 맞춘다

    fails = [(r["n"], r["immediate_fail"]) for r in runs if r.get("immediate_fail")]
    # Per-run totals distinguish mean differences from run-to-run noise.
    run_totals = []
    if k > 1:
        for r in runs:
            single = dict(data, runs=[r])
            run_totals.append(score(single, weights)["total"])
    return {
        "label": data.get("label", "?"),
        "k": k,
        "defects": defects,
        "axes": axes,
        "weights": weights,
        "total": sum(v for v, _ in axes.values()),
        "detection_ratio": found / opportunities if opportunities else 0,
        "immediate_fails": fails,
        "run_totals": run_totals,
        "cost": {
            "tokens": mean_of(runs, "tokens"),
            "tools": mean_of(runs, "tools"),
            "seconds": mean_of(runs, "seconds"),
            "cost_usd": mean_of(runs, "cost_usd"),
        },
        "runs": runs,
    }


def mean_of(runs, key):
    vals = [r[key] for r in runs if r.get(key) is not None]
    return statistics.mean(vals) if vals else None


def fmt_cell(v):
    return "—" if v is None else str(v)


def print_raw(s, md):
    defects = s["defects"]
    head = ["회차", *defects, "기준선 인용", "게이트 보고", "오탐", "토큰", "tool", "시간"]
    rows = []
    for r in s["runs"]:
        rows.append([
            str(r["n"]),
            *[fmt_cell(r["detected"].get(d) or "미검출") for d in defects],
            f"{fmt_cell(r.get('evidence_cited'))}/{fmt_cell(r.get('evidence_total'))}",
            fmt_cell(r.get("gate_reported")),
            fmt_cell(r.get("false_positives")),
            f"{r['tokens']:,}" if r.get("tokens") else "—",
            fmt_cell(r.get("tools")),
            f"{r['seconds']}s" if r.get("seconds") else "—",
        ])
    print(f"\n{s['label']}")
    table(head, rows, md)


def print_scorecard(scores, md):
    head = ["축", "배점", *[s["label"] for s in scores]]
    rows = []
    for axis, weight in scores[0]["weights"].items():
        row = [axis, str(weight)]
        for s in scores:
            value, detail = s["axes"][axis]
            row.append(f"{round(value, 1):g} ({detail})")
        rows.append(row)
    rows.append(["합계", "100", *[f"{s['total']:.0f}" for s in scores]])
    print("\n채점")
    table(head, rows, md)


def print_cost(scores, md):
    if len(scores) < 2:
        c = scores[0]["cost"]
        parts = []
        if c["tokens"] is not None:
            parts.append(f"토큰 {c['tokens']:,.0f}")
        if c["tools"] is not None:
            parts.append(f"tool {c['tools']:.1f}")
        if c["seconds"] is not None:
            parts.append(f"{c['seconds']:.0f}s")
        if c["cost_usd"] is not None:
            parts.append(f"${c['cost_usd']:.2f}")
        print("\n비용 평균 — " + " · ".join(parts))
        return
    base, *rest = scores
    head = ["", f"{base['label']} 평균", *[f"{s['label']} 평균" for s in rest], "차이"]
    rows = []
    for key, name, fmt in (("tokens", "토큰", "{:,.0f}"), ("tools", "tool 호출", "{:.1f}"),
                           ("seconds", "소요 시간", "{:.0f}s"), ("cost_usd", "비용(USD)", "${:.2f}")):
        b = base["cost"][key]
        if b is None and all(s["cost"][key] is None for s in rest):
            continue
        cells = [fmt.format(b) if b is not None else "—"]
        diffs = []
        for s in rest:
            v = s["cost"][key]
            cells.append(fmt.format(v) if v is not None else "—")
            diffs.append(f"{(v - b) / b * 100:+.1f}%" if b and v is not None else "—")
        rows.append([name, *cells, " / ".join(diffs)])
    print("\n비용")
    table(head, rows, md)


def table(head, rows, md):
    if md:
        print("| " + " | ".join(head) + " |")
        print("| " + " | ".join("---" for _ in head) + " |")
        for r in rows:
            print("| " + " | ".join(r) + " |")
        return
    widths = [max(dwidth(str(x)) for x in [h, *[r[i] for r in rows]]) for i, h in enumerate(head)]
    line = "  ".join(pad(h, w) for h, w in zip(head, widths))
    print(line)
    print("-" * dwidth(line))
    for r in rows:
        print("  ".join(pad(str(c), w) for c, w in zip(r, widths)))


def dwidth(text):
    """Display width counting Korean and full-width characters as two columns."""
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in text)


def pad(text, width):
    return text + " " * max(0, width - dwidth(text))


def verdict(scores):
    for s in scores:
        if s["immediate_fails"]:
            detail = "; ".join(f"run {n}: {why}" for n, why in s["immediate_fails"])
            print(f"\n[즉시 FAIL] {s['label']} — {detail}")
    if len(scores) < 2:
        return
    base, *rest = scores
    print("\n판정")
    for s in rest:
        gap = s["total"] - base["total"]
        lines = [f"  {s['label']}: {s['total']:.0f}점 ({gap:+.0f} vs {base['label']})"]
        if s["immediate_fails"]:
            lines.append("  → 반려. 즉시 FAIL(신뢰 위반)이 있다 — 점수로 갚을 수 없다")
        elif s["detection_ratio"] < base["detection_ratio"] - 1e-9:
            lines.append("  → 반려. 검출률이 떨어졌다 — 놓친 결함은 다른 축으로 갚을 수 없다")
        elif s["total"] >= 85 and gap > 0:
            lines.append("  → 채택 가능 (총점 85 이상, 검출률 비열세 아님)")
        elif gap > 0:
            lines.append("  → 개선이지만 총점 85 미만. 케이스를 늘려 재측정")
        else:
            lines.append("  → 채택 근거 없음")
        # Differences within run-to-run variance are inconclusive.
        if gap > 0 and s["run_totals"] and base["run_totals"]:
            if min(s["run_totals"]) <= max(base["run_totals"]):
                lines.append(
                    f"  ※ 회차 범위가 겹친다 ({base['label']} {min(base['run_totals']):.0f}–{max(base['run_totals']):.0f}"
                    f" vs {s['label']} {min(s['run_totals']):.0f}–{max(s['run_totals']):.0f})"
                    " — k 나 케이스를 늘리기 전에는 노이즈와 구분되지 않는다")
        for key, name in (("tokens", "토큰"), ("tools", "tool 호출"), ("seconds", "소요 시간")):
            b, v = base["cost"][key], s["cost"][key]
            if b and v and abs(v - b) / b >= 0.20:
                lines.append(f"  ※ {name} {(v - b) / b * 100:+.1f}% — 총점과 별개로 명시 보고 대상")
        print("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--md", action="store_true", help="마크다운 표")
    ap.add_argument("--weights", choices=["v2", "legacy"], default="v2",
                    help="v2=심각도 정확도 포함(기본), legacy=초기 6축 배점(과거 측정치 대조용)")
    args = ap.parse_args()

    weights = WEIGHTS_LEGACY if args.weights == "legacy" else WEIGHTS_V2
    scores = []
    for path in args.files:
        try:
            with open(path) as source:
                scores.append(score(json.load(source), weights))
        except (OSError, ValueError) as error:
            ap.exit(1, f"{path}: {error}\n집계를 중단했다. 입력을 보완한 뒤 다시 실행한다.\n")

    for s in scores:
        print_raw(s, args.md)
        if s["k"] < 3:
            print(f"[!] {s['label']}: k={s['k']} — 심각도 일관성은 k≥2 에서만 의미가 있고, "
                  "신뢰성 판단은 k≥3 이 필요하다", file=sys.stderr)
    print_scorecard(scores, args.md)
    print_cost(scores, args.md)
    verdict(scores)


if __name__ == "__main__":
    main()
