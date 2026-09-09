"""Verify that the CLI and shared scorer reject inputs unsuitable for scoring."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scorecard import WEIGHTS_LEGACY, score

SCRIPTS = Path(__file__).resolve().parent


def completed():
    return {
        "case": "sample", "label": "BEFORE", "expected_severity": {"D1": "High"},
        "runs": [{
            "n": n, "detected": {"D1": "High"}, "evidence_cited": 2, "evidence_total": 2,
            "gate_reported": "FAIL (lint)", "gate_actual": "FAIL (lint)",
            "drift_isolated": None, "false_positives": 0,
            "harness_error": False, "immediate_fail": None,
        } for n in range(1, 4)],
    }


class ScorecardTests(unittest.TestCase):
    def test_completed_runs_keep_full_score(self):
        self.assertEqual(score(completed())["total"], 100)

    def test_zero_detections_are_valid(self):
        data = completed()
        for run in data["runs"]:
            run["detected"]["D1"] = None
        self.assertEqual(score(data)["detection_ratio"], 0)

    def test_negative_control_is_valid(self):
        data = completed()
        data["expected_severity"] = {}
        for run in data["runs"]:
            run["detected"] = {}
        self.assertEqual(score(data)["total"], 100)

    def test_missing_or_null_required_fields_are_rejected(self):
        for field in ("gate_reported", "gate_actual", "evidence_cited", "evidence_total", "false_positives", "detected"):
            for missing in (True, False):
                with self.subTest(field=field, missing=missing):
                    data = completed()
                    if missing:
                        del data["runs"][0][field]
                    else:
                        data["runs"][0][field] = None
                    with self.assertRaisesRegex(ValueError, field):
                        score(data)

    def test_harness_error_is_rejected_even_with_complete_grading(self):
        data = completed()
        data["runs"][0]["harness_error"] = True
        with self.assertRaisesRegex(ValueError, "하네스 실행 오류"):
            score(data)

    def test_drift_not_applicable_is_distinct_from_partial_grading(self):
        data = completed()
        data["runs"][0]["drift_isolated"] = True
        with self.assertRaisesRegex(ValueError, "drift_isolated 일부 회차 미채점"):
            score(data)
        for run in data["runs"]:
            run["drift_isolated"] = False
        self.assertEqual(score(data)["axes"]["드리프트 분리"][0], 0)
        del data["runs"][0]["drift_isolated"]
        with self.assertRaisesRegex(ValueError, "drift_isolated"):
            score(data)

    def test_inconsistent_defect_ids_and_duplicate_runs_are_rejected(self):
        data = completed()
        data["runs"][1]["detected"] = {}
        with self.assertRaisesRegex(ValueError, "결함 ID"):
            score(data)
        data = completed()
        data["runs"][1]["n"] = 1
        with self.assertRaisesRegex(ValueError, "중복 회차"):
            score(data)

    def test_invalid_counts_are_rejected(self):
        for value in (-1, True, "2", 1.5, 3):
            with self.subTest(value=value):
                data = completed()
                data["runs"][0]["evidence_cited"] = value
                with self.assertRaisesRegex(ValueError, "evidence_cited"):
                    score(data)

    def test_expected_severity_is_required_only_for_the_relevant_weights(self):
        data = completed()
        del data["expected_severity"]
        with self.assertRaisesRegex(ValueError, "expected_severity.D1"):
            score(data)
        self.assertEqual(score(data, WEIGHTS_LEGACY)["total"], 100)

    def test_unknown_severity_is_rejected(self):
        data = completed()
        data["runs"][0]["detected"]["D1"] = "severe"
        with self.assertRaisesRegex(ValueError, "D1 심각도"):
            score(data)

    def test_omitted_defects_are_not_treated_as_a_negative_control(self):
        data = completed()
        for run in data["runs"]:
            run["detected"] = {}
        with self.assertRaisesRegex(ValueError, "expected_severity"):
            score(data)

    def test_empty_runs_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "실행 결과가 하나 이상"):
            score({"runs": []})

    def test_immediate_fail_remains_a_scored_rejection(self):
        data = completed()
        data["runs"][0]["immediate_fail"] = "정답지 열람"
        self.assertEqual(score(data)["immediate_fails"], [(1, "정답지 열람")])

    def test_both_clis_reject_invalid_after_without_printing_or_overwriting_report(self):
        for field, value in (("false_positives", None), ("harness_error", True)):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                before = completed()
                after = copy.deepcopy(before)
                after["label"] = "AFTER"
                after["runs"][0][field] = value
                paths = [root / "before.json", root / "after.json"]
                for path, data in zip(paths, (before, after)):
                    path.write_text(json.dumps(data))
                report = root / "report.md"
                report.write_text("existing report")
                for script in ("scorecard.py", "report.py"):
                    args = [sys.executable, str(SCRIPTS / script), *map(str, paths)]
                    if script == "report.py":
                        args += ["--out", str(report)]
                    result = subprocess.run(args, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                    self.assertIn("집계를 중단", result.stderr)
                    self.assertEqual(result.stdout, "")
                    self.assertEqual(report.read_text(), "existing report")

    def test_both_clis_accept_valid_comparison(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            for label in ("BEFORE", "AFTER"):
                data = completed()
                data["label"] = label
                path = Path(tmp) / f"{label}.json"
                path.write_text(json.dumps(data))
                paths.append(str(path))
            for script in ("scorecard.py", "report.py"):
                result = subprocess.run([sys.executable, str(SCRIPTS / script), *paths], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("판정", result.stdout)


if __name__ == "__main__":
    unittest.main()
