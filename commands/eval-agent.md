---
description: '에이전트 실행(run)을 agent-run-quality rubric으로 채점한다. Usage: /eval-agent [경로|--agent <type>] | --compare <라벨A>=<경로> <라벨B>=<경로>'
---

# Agent Run Evaluation

에이전트 실행의 궤적과 산출을 독립 채점한다. 작성자가 아니라 감사자다. 정직하고 구체적으로.

기준: `${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/rubrics/agent-run-quality.md` — **여기에 채점 기준을 다시 적지 않는다.** 파일이 없으면 그 사실을 보고하고 멈춘다. 기준을 지어내지 않는다.

입력: $ARGUMENTS

## Step 0 — 모드 판별

| 입력 | 모드 |
| --- | --- |
| 없음 | 이 세션의 가장 최근 서브에이전트 실행 1건 (실행 단위) |
| `agent-*.jsonl` 또는 세션 디렉터리 | 해당 실행들 (실행 단위) |
| `--agent <type>` | 그 agentType 의 최근 실행들 (실행 단위) |
| `~/agent-evals/runs/.../<label>-<ts>/` | 케이스 실행 채점 — `runs.json` 의 판단 항목을 채운다 |
| `--compare <BEFORE-runs.json> <AFTER-runs.json>` | 설정 비교 스코어카드 (100점) |

**케이스 실행 채점 모드**: 그 디렉터리의 `run-N.json`(보고문)을 케이스 정답지(`~/.claude/evals/cases/<repo>/<case>/answer-key.md`)와 대조해 `runs.json` 의 `detected`·`evidence_cited`·`gate_reported`·`drift_isolated`·`false_positives` 를 채우고 저장한다. **정답지를 먼저 읽고, 보고문은 그 다음에 읽는다** — 순서를 뒤집으면 보고문이 정답 해석을 끌고 간다. 채운 뒤 `scorecard.py` 로 표를 낸다.

**비교 모드**: 두 `runs.json` 을 `python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/scorecard.py --md <A> <B>` 로 집계하고, 출력된 표 3종(원시 결과·채점·비용)에 축별 근거를 붙여 보고한다.

세션 트랜스크립트 위치:

```bash
ls -td ~/.claude/projects/$(pwd | sed 's|/|-|g')/*/subagents 2>/dev/null | head -3
```

## Step 1 — 레포 파라미터 수집

rubric §0 표를 채운다. 검증 게이트 명령은 그 레포 `CLAUDE.md` 의 검증 절에서 읽고, 역할 구분(작성/감사/탐색)과 write 허용 경로는 `.claude/agents/*` 에서 읽는다. 기준선:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/agent-run-metrics.py --summary ~/.claude/projects/<project-slug>
```

## Step 2 — 궤적 지표 추출

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/agent-run-metrics.py <경로>
```

기계로 나오는 것(툴 호출·토큰·시간·허용 경로 밖 write·명령 반복·재읽기)은 여기서 받고, 나머지는 궤적과 최종 보고문을 직접 읽어 판단한다.

## Step 3 — 주장 검증

보고문의 주장 5~10건을 표본으로 직접 확인한다.

- file:line 이 실제로 존재하고 내용이 일치하는가
- 인용한 명령을 그대로 돌리면 같은 수치가 나오는가 (증거 재현성)
- 보고한 게이트 상태가 재현되는가 (게이트 정확도) — 실행 기록이 궤적에 없으면 "미실행"이다
- 감사 결과라면: 오탐이 있는가, 채점자가 같은 diff 에서 찾은 결함 중 누락이 있는가, 선행 결함을 이 변경 책임과 분리했는가

## Step 4 — 채점

rubric 의 6개 기준을 각각 1–5로, 근거를 인용해 채점한다. 가중 평균과 판정은 rubric 의 공식·표를 그대로 쓴다. **즉시 FAIL 4항목을 먼저 확인한다** — 하나라도 걸리면 점수와 무관하게 FAIL 이다.

비교 모드면 rubric §3 의 100점 스코어카드를 쓰고, 비용은 점수에 넣지 말고 별도 표로 보고한다. 검출률이 떨어졌으면 총점과 무관하게 반려로 적는다.

## Step 5 — 보고

```markdown
## Agent Run Eval: <agentType> / <run-id>

### 판정: PASS / NEEDS_IMPROVEMENT / FAIL   (즉시 FAIL 해당 시 사유 명시)

### 가중 평균: X.XX / 5.0

| 기준 | 가중 | 점수 | 근거 |
| --- | --- | --- | --- |

### 궤적 지표
툴 호출 N (기준선 M) · 출력 토큰 N · 소요 Ns · 재읽기 N건 · 명령 반복 N건

### 검증한 주장
| 주장 | 확인 방법 | 결과 |

### 발견
- (구체적 문제 + 근거)

### 개선 제안
- (기준별 실행 가능한 수정)
```

저장: `~/.claude/evals/results/<repo-name>/$(date +%F)-<agentType>-<run-id>.md`

## Step 6 — 반복·승격

- 판정이 1회 실행 기준이면 신뢰성 결론을 내지 않는다. 같은 프롬프트 k ≥ 3 회를 요청하고 **전부 PASS** 여야 통과로 센다.
- heavy 기준(역할 준수·산출 정확성·증거 재현성)이 4 미만이면 개선안을 제시하고, 같은 발견이 3회 이상 재발하면 rubric 이 아니라 규칙(린터·스크립트·레포 규칙 문서)으로 올릴 것을 **제안까지만** 한다. 규칙 파일 변경은 사용자가 결정한다.

## 규칙

- 점수를 부풀리지 않는다. 거짓 칭찬으로는 에이전트가 나아지지 않는다
- 모든 점수에 궤적·코드에서 인용한 근거를 붙인다
- 경로가 아니라 결과를 채점한다. 예상 밖 경로로 정답에 도달했으면 감점하지 않는다
- 확인하지 못한 항목은 추정하지 말고 "미확인"으로 적는다
