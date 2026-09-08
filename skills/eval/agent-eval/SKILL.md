---
name: agent-eval
description: 현재 레포의 에이전트(.claude/agents/*)를 자동 평가한다 — 난이도별 시드 결함 시나리오를 만들고, 설정 두 벌을 병렬로 k회씩 돌리고, 채점해 리포트를 낸다. "에이전트 평가해줘", "하네스 바꾼 게 나아졌는지 재줘", "eval 돌려줘", /agent-eval 에 쓴다.
---

# agent-eval

한 번 호출로 **시나리오 생성 → 병렬 실행 → 채점 → 리포트**까지 간다.

기준 문서(다시 적지 말고 읽어서 쓴다):

- 채점 기준: `${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/rubrics/agent-run-quality.md`
- 케이스 포맷: `${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/cases/README.md`
- 스크립트: `${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/{run-case.sh,run-suite.sh,scorecard.py,report.py,agent-run-metrics.py}`

## Step 0 — 범위 확정

사용자 입력: $ARGUMENTS

| 물어볼 것 | 기본값 |
| --- | --- |
| 대상 에이전트 | `.claude/agents/*` 중 작성·감사 역할 (탐색 역할은 게이트가 없어 축 절반이 무의미) |
| 비교 설정 | `git status` 로 `.claude/` 에 미커밋 변경이 있으면 **BEFORE=커밋본 / AFTER=워킹트리**, 없으면 단일 측정 |
| k | 3 (신뢰성 판단의 최소치) |
| 케이스 | 기존 `~/.claude/evals/cases/<repo>/` 재사용 + 부족한 난이도만 생성 |

비용을 먼저 알린다: 실행 1회 ≈ 5분 / $1.2 기준으로 `케이스 수 × 설정 수 × k` 를 곱해 제시하고 진행 여부를 확인한다. **확인 없이 6회를 넘겨 돌리지 않는다.**

## Step 1 — 케이스 준비 (병렬)

`~/.claude/evals/cases/<repo-name>/` 를 확인한다. 난이도(T1/T2/T3)별로 하나씩 있으면 재사용하고, 없는 것만 만든다.

최소 세트는 **T1·T2·T3 섞인 시드 케이스 + 대조 케이스(negative control) 1개**다. 대조 케이스가 없으면 "전부 지적하는" 전략이 무비용이라 오탐 축이 작동하지 않는다.

부족한 tier 마다 `Agent(subagent_type="eval-case-author")` 를 **한 번에 하나씩, 병렬로** 띄운다. 각 프롬프트에 넣을 것:

- 대상 에이전트와 그 역할(작성/감사)
- 맡길 tier 와 결함 개수(T1 하나 + 해당 tier 2~3개)
- 레포 경로·base 커밋(`git rev-parse HEAD`)
- 케이스 ID 규칙: `<agent>-<주제>-<tier>`
- "게이트를 직접 돌려 정답을 확정할 것, 워킹트리를 건드리지 말 것"

case-author 는 임시 워크트리에서 작업하므로 서로 충돌하지 않는다. 반환된 케이스 디렉터리와 게이트 정답을 받아 **`git apply --check` 로 패치가 붙는지 직접 확인**한다.

## Step 2 — 병렬 실행

```bash
${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/run-suite.sh ~/.claude/evals/cases/<repo> --label BEFORE --k 3 --jobs 3
${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/run-suite.sh ~/.claude/evals/cases/<repo> --label AFTER  --k 3 --jobs 3 \
  --harness <레포>/.claude
```

- `--jobs` 는 **동시에 도는 케이스 수**다(케이스 내부 k회는 순차 — 회차들이 워크트리를 공유하고, 순차일 때만 회차 간 메모리 격리가 걸린다). 기본 3.
- BEFORE/AFTER 는 **순차로** 돌린다. 동시에 돌리면 머신 부하가 결과의 소요 시간 축을 오염시킨다.
- `--harness` 는 `.claude/` 와 그 옆 `CLAUDE.md` 를 함께 덮는다. BEFORE(미지정)는 **케이스 base 커밋 시점의 하네스**다 — base 가 HEAD 보다 오래됐으면 러너가 경고하니, 그 경고가 나오면 케이스를 새 base 로 다시 뜰지 판단한다.
- 스위트가 exit 1 이면 실패한 케이스가 있다는 뜻이다. **설정 간 케이스 수가 어긋난 채로 집계하지 마라.**
- 오래 걸리므로 `run_in_background: true` 로 띄우고, 끝나면 출력의 `runs.json` 목록을 받는다.

## Step 3 — 채점 (병렬)

**케이스 하나당 `Agent(subagent_type="eval-grader")` 하나**를 병렬로 띄운다 — 회차마다 띄우면 같은 `runs.json` 에 Edit 경쟁이 나서 채점이 유실된다. 프롬프트에 넣을 것: `<run-dir>` 경로, 회차 수, 케이스 디렉터리 경로.

채점 완결성은 집계기가 stderr 로 경고한다(`gate_reported`·`evidence_cited`·`false_positives`·`drift_isolated`·`detected` 전부 확인). 경고가 나오면 그 회차를 다시 채점시킨다 — 미채점 `null` 은 축마다 다른 방향으로 조용히 점수가 된다.

`immediate_fail` 이 이미 채워진 회차가 있으면 **덮어쓰지 마라** — 러너가 정답지 열람을 탐지해 미리 표시한 것이다.

**첫 배치에서는 캘리브레이션을 한 번 한다**: 회차 하나를 사용자(또는 메인)가 직접 채점해 `runs.human.json` 으로 저장하고

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/calibrate.py <run-dir>/runs.json <run-dir>/runs.human.json
```

일치율이 85% 미만이면 judge 결과로 결론을 내지 말고, 불일치한 필드에 해당하는 **정답지·rubric 문구부터 고친다.**

## Step 4 — 리포트

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/eval/agent-eval/scripts/report.py <BEFORE runs.json...> <AFTER runs.json...> \
  --cases-root ~/.claude/evals/cases/<repo> --out <run-root>/report.md
```

리포트에는 총점·난이도별 검출률·축별 평균·비용·만점 미달 축·판정이 자동으로 들어간다. 여기에 **모델이 붙여야 하는 것**:

- 축이 갈린 이유 — 어느 설정이 무엇을 했고 안 했는지, 보고문에서 인용
- 난이도 해석 — T1만 잘 잡고 T3를 놓치면 "게이트 대행"이지 감사가 아니다
- 즉시 FAIL 이 있었으면 최상단에 명시. 점수가 높아도 신뢰 문제다
- 다음 조치 — 프롬프트를 고칠 곳, 규칙으로 승격할 것(같은 발견 3회 이상 재발 시), 케이스를 늘릴 난이도

마지막에 사용자에게 리포트 경로와 판정 한 줄을 준다. 리포트를 공유용 페이지로 원하면 Artifact 로 게시한다.

## 판정

채택 기준은 `rubrics/agent-run-quality.md` §3 이 정본이고 `report.py` 가 그대로 계산한다.
**여기에 기준을 다시 적지 않는다** — 세 곳이 갈리면 어느 것이 판정인지 알 수 없다.

리포트를 읽을 때 사람이 판단할 것 둘:

- 하네스 오류(claude 비정상 종료)로 표시된 회차는 에이전트 실패가 아니다 — 다시 돌린다
- 비용 악화는 총점과 별개로 명시한다

## 주의

- **메모리 오염**: 자동 메모리는 워크트리가 아니라 본 레포 슬러그에 쓰인다 — 평가 실행이 시드한 가짜 결함을 실제 프로젝트 기억으로 저장한다. `run-case.sh` 가 실행 전후로 스냅샷·복원하고 쓰려던 내용을 `memory-written/` 에 남기니, 그 디렉터리가 생겼으면 리포트에 **무엇을 저장하려 했는지** 한 줄 넣는다(에이전트가 가짜 케이스를 얼마나 진짜로 믿었는지 보여주는 신호다)
- k=1 결과로 신뢰성을 말하지 않는다. 심각도 일관성은 k≥2 에서만 의미가 있다
- `--harness` 는 `agent-memory/` 를 기본 제외한다. 메모리를 포함하면 이전 세션의 학습이 설정 효과와 섞인다
- 케이스가 1개뿐이면 "이 케이스에서"라고 범위를 명시한다. 난이도 3종이 모여야 일반화할 수 있다
- 통과율이 80%를 넘으면 케이스가 쉬워진 것이다 — 새 실패 사례로 교체를 제안한다
