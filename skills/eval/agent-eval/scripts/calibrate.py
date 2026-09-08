#!/usr/bin/env python3
"""judge(eval-grader) 채점과 사람 채점의 일치율을 잰다.

  calibrate.py <judge-runs.json> <human-runs.json> [--threshold 0.85]

같은 실행을 두 번 채점한 두 파일을 회차·필드 단위로 비교한다. 사람 파일은 judge 결과를
복사해 손으로 고쳐 만들면 된다:

  cp <run-dir>/runs.json <run-dir>/runs.human.json   # 그 다음 직접 채점

일치율이 임계 밑이면 **에이전트가 아니라 rubric·정답지 문구를 고친다** — 사람 둘이 다르게
읽는 기준으로는 어떤 비교도 재현되지 않는다. 불일치 목록이 곧 고칠 문장 목록이다.
"""

import argparse
import json
import sys

FIELDS = ("evidence_cited", "gate_reported", "drift_isolated", "false_positives", "immediate_fail")


def norm(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip().lower()
    return value


def compare(judge, human):
    rows, agree, total = [], 0, 0
    hmap = {r["n"]: r for r in human["runs"]}
    for jr in judge["runs"]:
        hr = hmap.get(jr["n"])
        if hr is None:
            continue
        for defect in jr.get("detected", {}):
            j, h = norm(jr["detected"].get(defect)), norm(hr.get("detected", {}).get(defect))
            total += 1
            if j == h:
                agree += 1
            else:
                rows.append([jr["n"], f"detected.{defect}", jr["detected"].get(defect),
                             hr.get("detected", {}).get(defect)])
        for field in FIELDS:
            j, h = norm(jr.get(field)), norm(hr.get(field))
            # immediate_fail 은 문구가 아니라 유무만 본다
            if field == "immediate_fail":
                j, h = bool(j), bool(h)
            total += 1
            if j == h:
                agree += 1
            else:
                rows.append([jr["n"], field, jr.get(field), hr.get(field)])
    return rows, agree, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("judge")
    ap.add_argument("human")
    ap.add_argument("--threshold", type=float, default=0.85,
                    help="필요 일치율 (기본 0.85 — 업계 관행인 85~90%%의 하한)")
    args = ap.parse_args()

    judge, human = json.load(open(args.judge)), json.load(open(args.human))
    rows, agree, total = compare(judge, human)
    if total == 0:
        sys.exit("비교할 회차가 없다 — 두 파일의 run 번호가 맞는지 확인해라")

    rate = agree / total
    print(f"일치 {agree}/{total} = {rate:.0%}  (임계 {args.threshold:.0%})")
    if rows:
        print(f"\n{'회차':<5}{'필드':<22}{'judge':<28}사람")
        print("-" * 84)
        for n, field, j, h in rows:
            print(f"{n:<5}{field:<22}{str(j):<28}{h}")
        print("\n불일치한 필드가 곧 모호한 기준이다 — 정답지(answer-key.md)와 rubric 문구를 먼저 고쳐라.")

    if rate < args.threshold:
        print(f"\n[!] 캘리브레이션 실패 — judge 결과를 비교 근거로 쓰지 마라.")
        sys.exit(1)


if __name__ == "__main__":
    main()
