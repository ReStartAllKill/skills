---
artifact: intent
schema_version: 7
id: "CHG-YYYY-NNN"
title: "<변경 의도를 한 문장으로>"
status: draft # draft | in_review | accepted | rejected | superseded
tier: standard # light | standard | full — 이 산출물 세트 전체의 무게를 여기서 정한다
owner: "<의사결정 책임자 또는 팀>"
from_finding: null # 운영 신호에서 왔다면 그 finding.md 경로 — **이 파일이 있는 폴더 기준**. 예: "../findings/FND-2026-007-ci/finding.md"
approved_by: null # status 가 accepted 이상이면 필수 — 승인한 **사람**. generated_by 와 같을 수 없다
generated_by: null # 예: "claude-opus-5" — Agent 가 썼으면 채운다
---

# Intent: <변경 제목>

<!-- Written for the product owner and the person proposing the change. If a way to build it
     appears here, it belongs in the spec or the plan. -->

## 문제

<!-- The problem, not the solution. Keep observation separate from reading. Two to four sentences. -->

<현재 [대상]은 [상황]에서 [문제]를 겪는다. 그 결과 [비용]이 든다.>

### 근거 `[필수 · standard+]`

- <예: 지원 문의 — 최근 30일 동일 유형 42건. [대시보드 링크]>

## 목표 결과

<!-- Observable results. Every Must has to be covered by a requirement in the spec. -->

### OUT-001 — <한 줄 요약> `Must`

<무엇이 가능해지는가.>

확인: <어떻게 관찰하거나 측정하는가.>

### OUT-002 — <한 줄 요약> `Should`

<무엇이 가능해지는가.>

확인: <어떻게 관찰하거나 측정하는가.>

## 비목표

- <예: 관리자 화면 개편은 포함하지 않는다.>

## 제약

<!-- Boundaries to hold. Do not prescribe an implementation. If none, write `N/A — <basis>`. -->

### CON-001 — <한 줄 요약>

<무엇을 지켜야 하는가. 왜. 어기면 무슨 일이 생기는가.>

## 영향 범위와 지표 `[필수 · standard+]`

<!-- If a baseline is unknown, write «unmeasured» and how it will be measured. Never 0, never blank. -->

영향 받는 것: <사용자군 · 내부 운영 · 연계 시스템>

- 성공 — <지표>: <현재값> → <목표> (<측정 기간>, <출처>)
- 보호 — <지표>: <현재값>, <허용 범위> 안에 머물러야 한다 (<출처>)

## 가정 `[필수 · standard+]`

### ASM-001 — <전제>

검증: <어떻게 확인하는가> · 틀리면: <무엇이 달라지는가> · 담당/기한: <이름 / 날짜>

## 대안과 기각 `[필수 · full]`

- <선택지> — <기대 효과> / 기각 사유: <이유>

## 승인 `[필수 · standard+]`

- <역할> <이름> — <승인/조건부/반려>, YYYY-MM-DD. <의견>

<!-- Open questions: when there are any, add a `## 열린 질문` heading and one `### Q-NNN`
     item per question. When there are none, leave no heading — a section that is present must
     have content, and a standing `해당 없음 — 물을 것이 없다` is a sentence written for the checker
     rather than for a reader. The change history is git's; do not keep a copy here. -->
