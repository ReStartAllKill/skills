#!/usr/bin/env python3
"""채점된 runs.json 들을 원시 결과표·스코어카드·비용표로 집계한다.

사용:
  scorecard.py <BEFORE-runs.json> [<AFTER-runs.json> ...]
  scorecard.py --md <...>            # 마크다운 표로 출력 (PR·문서용)

배점은 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/rubrics/agent-run-quality.md §3 과 같다:
  검출률 25 · 심각도 정확도 10 · 게이트 정확도 20 · 증거 재현성 20 · 드리프트 분리 10 · 오탐 없음 10 · 심각도 일관성 5
  대조 케이스(defects 빈 배열)는 오탐 없음 60 · 게이트 정확도 20 · 증거 재현성 20
  --weights legacy 는 심각도 정확도 축이 없던 초기 배점(과거 측정치 대조용)

runs.json 의 한 회차 스키마 (판단 항목은 채점자가 채운다):
  detected        {"D1": "Low", "D2": "Critical", "D3": null}   # null = 미검출
  evidence_cited  4        evidence_total 4
  gate_reported   "FAIL (lint)"    gate_actual "FAIL (lint)"    # 원인까지 맞아야 만점
  drift_isolated  true|false       false_positives 0
  immediate_fail  "사유" | null    # 채워지면 점수와 무관하게 반려
  tokens / tools / seconds / cost_usd / harness_error           # run-case.sh 가 자동 기입
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
# 심각도 정확도 축이 없던 초기 배점. 과거 측정치와 대조할 때만 쓴다(--weights legacy).
WEIGHTS_LEGACY = {
    "검출률": 30,
    "게이트 정확도": 25,
    "증거 재현성": 20,
    "드리프트 분리": 10,
    "오탐 없음": 10,
    "심각도 일관성": 5,
}
WEIGHTS = WEIGHTS_V2
# 결함을 심지 않은 대조 케이스(negative control) 전용 배점. 검출·심각도 축은 잴 대상이 없으므로
# 그 배점을 "없는 결함을 만들어내지 않는가"로 몰아준다 — 안 그러면 65점이 공짜로 깔려
# 산탄총 전략과 절제된 감사가 100 vs 94 로만 갈린다.
WEIGHTS_NEGATIVE_CONTROL = {
    "오탐 없음": 60,
    "게이트 정확도": 20,
    "증거 재현성": 20,
}
# 회차당 오탐 1건에 −3. k 로 정규화하지 않으면 k 가 큰 설정이 구조적으로 불리해진다.
FALSE_POSITIVE_PENALTY = 3
# 대조 케이스에서는 오탐이 유일한 변별점이라 배점에 맞춰 벌점도 키운다(회차당 1건에 −15).
FALSE_POSITIVE_PENALTY_NC = 15
SEVERITY_ORDER = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]


def severity_distance(reported, expected):
    """기대 severity(예: "High|Critical")와 보고값의 단계 차이. 판정 불가면 None."""
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
    """게이트 보고를 (상태, 원인 집합)으로 정규화한다.

    'FAIL (lint)' → ('FAIL', {'lint'}), 'FAIL(lint, typecheck)' → ('FAIL', {'lint','typecheck'}).
    상태를 앞에 안 쓰고 게이트별로 나열한 보고('format:check PASS / lint FAIL …')도 읽는다 —
    하나라도 FAIL 이면 FAIL, 아니면 PASS. 채점자 문장 습관이 20 점 축을 좌우하면 안 된다.
    상태만 맞고 원인이 다르면(예: 실제는 lint FAIL 인데 typecheck FAIL 이라고 보고) 절반만 인정한다 —
    "무조건 FAIL 이라고 찍기"가 만점이 되는 걸 막는다.
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
        # 상태를 앞에 안 쓰고 게이트별로 나열한 보고("format:check PASS / lint FAIL ...").
        # 하나라도 FAIL 이면 전체는 FAIL 이다. 단어 경계로 찾는다 — 그러지 않으면
        # `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` 같은 에러코드가 전체를 FAIL 로 뒤집는다.
        status = "FAIL"
    elif re.search(r"\bPASS\b", upper) or "통과" in text:
        status = "PASS"
    else:
        # "미실행" 처럼 상태 자체가 없는 보고 — 정답과 절대 일치하지 않아 0 점이 된다.
        status = upper
    causes = {g for g in GATE_NAMES if g in text.lower()}
    return status, frozenset(causes)


def gate_credit(reported, actual):
    """1.0 = 상태·원인 일치, 0.5 = 상태만 일치, 0 = 불일치."""
    r, a = norm_gate(reported), norm_gate(actual)
    if r is None or a is None or r[0] != a[0]:
        return 0.0
    if not a[1]:            # 정답에 원인 표기가 없으면 상태만 본다
        return 1.0
    return 1.0 if r[1] & a[1] else 0.5


def score(data, weights=None):
    weights = weights or WEIGHTS
    runs = data["runs"]
    k = len(runs)
    if k == 0:
        raise SystemExit(f"{data.get('label', '?')}: 회차가 하나도 없다 — 실행이 전부 실패했는지 확인해라")
    defects = list(runs[0]["detected"].keys()) if runs else []
    opportunities = k * len(defects)

    found = sum(1 for r in runs for v in r["detected"].values() if v)
    # 결함을 심지 않은 대조 케이스(negative control)는 검출 축이 해당 없음이다 —
    # 그 케이스의 관심사는 "없는 결함을 만들어내지 않는가"(오탐 축)다.
    negative_control = len(defects) == 0
    if negative_control:
        weights = WEIGHTS_NEGATIVE_CONTROL
    detection = weights.get("검출률", 0) * (found / opportunities if opportunities else 1.0)

    # 심각도 정확도 — 기대 범위 안 1.0, 한 단계 벗어남 0.5, 두 단계 이상 0.
    # 미검출은 분모에서 뺀다(검출률에서 이미 벌점). 이 축이 없으면 "전부 Critical" 전략이 만점이다.
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

    # 드리프트가 없는 케이스는 이 축이 해당 없음이다 — 0점으로 깎으면 케이스마다 만점이 달라진다
    drift_applicable = any(r.get("drift_isolated") is not None for r in runs)
    drift_ok = sum(1 for r in runs if r.get("drift_isolated"))
    drift = weights.get("드리프트 분리", 0) * (drift_ok / k if drift_applicable else 1.0)

    fp_total = sum(r.get("false_positives") or 0 for r in runs)
    fp_per_run = fp_total / k
    penalty = FALSE_POSITIVE_PENALTY_NC if negative_control else FALSE_POSITIVE_PENALTY
    fp_score = max(0, weights["오탐 없음"] - penalty * fp_per_run)

    # 심각도 일관성 — 결함별로 k회 부여된 severity 의 흔들림. 한 단계 2점, 두 단계 이상 0점.
    # k<2 거나 표본이 1개뿐인 결함은 "흔들림 없음"이 아니라 측정 불가다.
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
    # 회차별 총점 — k회 평균 차이가 회차 간 편차보다 작으면 그 차이는 노이즈다
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
        "harness_errors": [r["n"] for r in runs if r.get("harness_error")],
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
    """한글·전각 문자를 2칸으로 세는 표시 폭."""
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in text)


def pad(text, width):
    return text + " " * max(0, width - dwidth(text))


def verdict(scores):
    for s in scores:
        if s["immediate_fails"]:
            detail = "; ".join(f"run {n}: {why}" for n, why in s["immediate_fails"])
            print(f"\n[즉시 FAIL] {s['label']} — {detail}")
        if s["harness_errors"]:
            print(f"[!] {s['label']}: 하네스 오류로 비정상 종료한 회차 {s['harness_errors']} "
                  "— 에이전트 실패로 세지 말고 다시 돌려라")
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
        # 회차 편차와 겹치는 차이는 결론이 아니다
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
        data = json.load(open(path))
        # 미채점 null 은 축마다 다른 방향으로 조용히 점수가 된다(오탐 null→만점, 드리프트 null→해당없음).
        # 채점이 덜 된 채로 집계하지 않도록 전 필드를 본다.
        for field in ("gate_reported", "evidence_cited", "false_positives", "drift_isolated"):
            blank = [r["n"] for r in data["runs"] if r.get(field) is None]
            if blank and not (field == "drift_isolated" and len(blank) == len(data["runs"])):
                print(f"[!] {path}: {field} 미채점 회차 {blank} — 채점 후 다시 돌려라", file=sys.stderr)
        blank_detect = [r["n"] for r in data["runs"] if all(v is None for v in r["detected"].values())]
        if blank_detect:
            print(f"[!] {path}: detected 가 통째로 비어 있다 (회차 {blank_detect})", file=sys.stderr)
        scores.append(score(data, weights))

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
