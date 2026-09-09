---
artifact: intent
schema_version: 4
id: "CHG-YYYY-NNN"
title: "<변경 의도를 한 문장으로>"
status: draft # draft | in_review | accepted | rejected | superseded
tier: standard # light | standard | full — 이 산출물 세트 전체의 무게를 여기서 정한다
owner: "<의사결정 책임자 또는 팀>"
created: YYYY-MM-DD
updated: YYYY-MM-DD
superseded_by: null # status 가 superseded 이면 필수
from_finding: null # 운영 신호에서 왔다면 그 finding.md 경로 — **이 파일이 있는 폴더 기준**
                   # Example: "../findings/FND-2026-007-ci-failure-rate/finding.md"
approved_by: null # status 가 accepted 이상이면 필수 — 승인한 **사람**. generated_by 와 같을 수 없다
generated_by: null # 예: "claude-opus-5" — Agent 가 썼으면 채운다
generated_from: null # 그 세션의 프롬프트나 슬래시 커맨드
skills_in_force: [] # 예: ["brand@a3f2c1"]
---

# Intent: <변경 제목>

<!-- 주 독자는 제품 책임자와 발안자. 구현 방법이 나오면 spec 이거나 plan 이다. -->

## 문제 `[필수 · 모든 티어]`

<!-- 해결책이 아니라 문제. 사실과 해석을 섞지 않는다. 2~4문장. -->

<현재 [대상]은 [상황]에서 [문제]를 겪는다. 그 결과 [비용]이 든다.>

### 근거 `[필수 · standard+]`

- <예: 지원 문의 — 최근 30일 동일 유형 42건. [대시보드 링크]>

## 목표 결과 `[필수 · 모든 티어]`

<!-- 관찰 가능한 결과. Must 는 spec 의 요구사항으로 덮여야 한다. -->

### OUT-001 — <한 줄 요약> `Must`

<무엇이 가능해지는가.>

확인: <어떻게 관찰하거나 측정하는가.>

### OUT-002 — <한 줄 요약> `Should`

<무엇이 가능해지는가.>

확인: <어떻게 관찰하거나 측정하는가.>

## 비목표 `[필수 · 모든 티어]`

- <예: 관리자 화면 개편은 포함하지 않는다.>

## 제약 `[필수 · 모든 티어]`

<!-- 지켜야 할 경계. 구현을 지시하지 않는다. 없으면 `해당 없음 — <근거>`. -->

### CON-001 — <한 줄 요약>

<무엇을 지켜야 하는가. 왜. 어기면 무슨 일이 생기는가.>

## 열린 질문 `[필수 · 모든 티어]`

<!-- `막힘` 이 Open 이면 accepted 로 못 간다. 없으면 `해당 없음 — <근거>`. -->

### Q-001 — <결정하거나 확인할 질문>

영향: <막힘 / 높음 / 낮음>
담당: <이름>
상태: Open

## 영향 범위와 지표 `[필수 · standard+]`

<!-- 기준값을 모르면 «미측정» 과 측정 계획. 0 이나 공란으로 두지 않는다. -->

영향 받는 것: <사용자군 · 내부 운영 · 연계 시스템>

- 성공 — <지표>: <현재값> → <목표> (<측정 기간>, <출처>)
- 보호 — <지표>: <현재값>, <허용 범위> 안에 머물러야 한다 (<출처>)

## 가정 `[필수 · standard+]`

### ASM-001 — <전제>

검증: <어떻게 확인하는가> · 틀리면: <무엇이 달라지는가> · 담당/기한: <이름 / 날짜>

## 대안과 기각 `[필수 · full]`

- <선택지> — <기대 효과> / 기각 사유: <이유>

## 승인과 변경 이력 `[필수 · standard+]`

- <역할> <이름> — <승인/조건부/반려>, YYYY-MM-DD. <의견>

### 변경 이력

- YYYY-MM-DD <이름> — 초안 작성. <배경>
