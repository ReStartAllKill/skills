# 평가 케이스

에이전트를 채점하려면 **정답을 아는 태스크**가 있어야 한다. 케이스 하나 = 결함을 심은 레포 상태 + 정답지.

```
~/.claude/evals/cases/<repo>/<case-id>/
  case.json       # 메타: 대상 에이전트·base 커밋·프롬프트·게이트 정답·시드 결함 목록
  drift.patch     # (선택) 심사 범위 밖에 미리 심는 선행 결함
  defects.patch   # 심사 대상 브랜치가 들어오는 변경 = 시드 결함
  answer-key.md   # 결함별 위치·기대 severity·판정 근거, 오탐 정의, 재검증 절차
```

## 왜 패치 두 장인가

`drift.patch` 를 먼저 커밋하고 `defects.patch` 를 그 위에 커밋하면, 심사 diff(`<drift-commit>..HEAD`)에는 시드 결함만 들어가고 선행 결함은 **레포에는 있지만 심사 범위 밖**이 된다. 게이트를 돌리면 둘 다 걸리므로, 에이전트가 실패 원인을 분리해 귀속하는지(드리프트 분리)를 잴 수 있다. 선행 결함이 필요 없는 케이스는 `drift.patch` 를 생략한다.

## 케이스를 새로 만들 때

1. `git worktree add <tmp> <base-commit>` 로 격리 트리를 만들고 `node_modules` 를 심볼릭 링크한다
2. 선행 결함 → 커밋, 시드 결함 → 커밋
3. **게이트를 직접 돌려 정답을 확정한다.** format/lint/typecheck/test 각각의 실제 결과와 lint 에러 건수·귀속을 기록한다
4. `git diff <base> HEAD~1 > drift.patch`, `git diff HEAD~1 HEAD > defects.patch`
5. `answer-key.md` 에 결함별 위치·유형·기대 severity·판정 근거와 **오탐 정의**를 적는다

**결함 난이도를 섞는다.** 전부 기계 검출 가능하면 두 설정이 같은 점수로 붙고, 전부 판단 영역이면 채점자 간 일치가 깨진다. 기계 1 + 판단 2~3 정도가 적당하다.

**정답지는 에이전트에게 주는 프롬프트에 넣지 않는다.** `case.json` 의 `prompt` 만 전달된다.

## 난이도

`case.json` 의 `defect_tiers` 에 결함별 난이도를 적는다. 리포트의 난이도별 검출률이 이 필드로 만들어진다.

| tier | 정의 | 잡히는 방식 |
| --- | --- | --- |
| T1 | 게이트가 잡는다 | lint·typecheck·format·test |
| T2 | 규칙·컨벤션인데 자동 검사가 없다 | 규칙 문서를 읽고 판단 |
| T3 | 도메인·아키텍처 | 스펙 대조, 교차 파일 추론 |

T1만 잘 잡고 T3를 놓치는 에이전트는 "게이트 대행"이지 감사자가 아니다 — 난이도를 섞어야 이 구분이 보인다. **T1 결함은 게이트를 깨는 것으로 끝내지 말고 `defects` 에도 넣어라** — 게이트 축에만 두면 난이도표에 T1 행이 아예 안 나온다.

## 대조 케이스 (negative control)

`defects` 를 빈 배열로 두고 **결함 없는 깨끗한 변경**을 심는 케이스를 한 벌 만든다(`"kind": "negative-control"`). 시드 케이스만 있으면 "전부 지적하는" 산탄총 전략이 무비용이다 — 사실인 지적은 오탐으로 세지 않기 때문에, 절제를 재려면 심은 게 없는 케이스가 필요하다.

배점이 다르다: **오탐 없음 60 · 게이트 정확도 20 · 증거 재현성 20** (검출·심각도 축은 잴 대상이 없어 빠진다). 오탐 벌점도 회차당 −15 로 커진다. 예: `cases/<repo>/auditor-clean-search/`.

**시드 케이스와 같은 배치에서 돌려라.** 대조 케이스만 보면 "아무 것도 보고하지 않는" 전략이 만점이다.

## 실행

전체 자동화는 `/agent-eval` 스킬이 한다(케이스 생성 → 병렬 실행 → 채점 → 리포트). 아래는 손으로 돌릴 때.

```bash
# BEFORE — 레포에 커밋된 하네스 그대로
${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/run-case.sh <case-dir> --label BEFORE --k 3

# AFTER — 고친 하네스를 덮어씌워 같은 케이스 재실행
${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/run-case.sh <case-dir> --label AFTER --k 3 \
  --harness <레포 경로>/.claude
```

`--harness` 는 그 디렉터리를 워크트리의 `.claude/` 위에 덮는다. **`agent-memory/` 는 기본 제외** — 에이전트 메모리가 들어가면 이전 세션에서 배운 발견이 유입돼 설정 효과와 섞인다. 메모리 자체를 평가하려면 `--with-memory`.

산출: `~/agent-evals/runs/<repo>/<case>/<label>-<ts>/` — `run-N.json`(보고문) · `run-N.jsonl`(궤적) · `metrics.json` · `runs.json`(채점 입력 뼈대).

## 채점 → 집계

`runs.json` 의 기계 항목(토큰·툴·시간)은 자동으로 채워지고, 판단 항목은 `null` 로 남는다:

| 필드 | 채우는 법 |
| --- | --- |
| `detected` | 결함 ID별로 보고문이 부여한 severity. 못 찾았으면 `null` |
| `evidence_cited` | 정답지의 기준선 수치 중 실제로 인용·재현되는 개수 |
| `gate_reported` | 보고문이 주장한 게이트 상태 (`gate_actual` 은 정답지에서 자동 기입) |
| `drift_isolated` | 선행 결함을 이 브랜치 책임에서 분리했으면 `true` |
| `false_positives` | 정답지의 오탐 정의에 해당하는 건수 |

`/eval-agent <run-dir>` 로 Claude 에게 채우게 하거나 직접 채운 뒤:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/scorecard.py <BEFORE>/runs.json <AFTER>/runs.json        # 케이스 1개: 표 3종 + 판정
python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/scorecard.py --md <BEFORE>/runs.json <AFTER>/runs.json   # PR 붙일 마크다운

# 케이스 여러 개 → 하나의 리포트 (총점·난이도별 검출률·축별 평균·비용·판정)
python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/report.py <BEFORE 것들...> <AFTER 것들...> \
  --cases-root ~/.claude/evals/cases/<repo> --out report.md
```

인자 순서가 곧 비교 기준이다 — **첫 라벨이 BEFORE** 로 잡힌다.

## 병렬

```bash
# 케이스 여러 개를 한 번에, 동시 claude 프로세스 3개까지
${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/run-suite.sh ~/.claude/evals/cases/<repo> --label BEFORE --k 3 --jobs 3
```

병렬은 **케이스 단위**다. `run-case.sh --jobs N` 으로 한 케이스의 k회를 동시에 돌릴 수도 있지만 기본은 1이다 — 회차들이 같은 워크트리를 공유하고(게이트가 `build/`·`.react-router/` 를 쓰고 node_modules 심볼릭 링크로 vite 캐시까지 공유한다), 순차일 때만 **회차마다 메모리를 되돌려 회차 독립성**을 지킬 수 있다.

BEFORE/AFTER 는 순차로 — 동시에 돌리면 머신 부하가 소요 시간 축을 오염시킨다.

케이스가 하나라도 실패하면 `run-suite.sh` 는 exit 1 로 끝나고 실패 목록·로그 경로를 찍는다. **설정 간 케이스 수가 다른 채로 비교하지 마라.**

## 유지보수

`git apply --check` 가 실패하면 base 커밋이 밀린 것이다. 패치를 새 base 에서 다시 만들고 **정답지의 라인 번호·게이트 결과·"기계 검출 불가" 전제를 다시 확인한다** — 린트 설정이 바뀌면 정답이 바뀐다.
