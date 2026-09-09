---
artifact: spec
schema_version: 4
id: "SPEC-YYYY-NNN"
title: "<명세 제목>"
status: draft # draft | in_review | accepted | rejected | superseded
tier: standard # intent 의 tier 와 같아야 한다
owner: "<명세 책임자 또는 팀>"
created: YYYY-MM-DD
updated: YYYY-MM-DD
intent: "./intent.md"
intent_version: "<intent.md 를 마지막으로 바꾼 커밋 SHA>"
superseded_by: null
approved_by: null # status 가 accepted 이상이면 필수 — 승인한 **사람**. generated_by 와 같을 수 없다
generated_by: null
generated_from: null
skills_in_force: []
---

# Spec: <명세 제목>

<!-- Internal structure, libraries and ordering belong in the plan. Field and event names on an
     external interface are a contract, so they belong here. Background stays in the intent, cited by ID. -->

## 범위 `[필수 · 모든 티어]`

상위 intent: [<CHG-YYYY-NNN>](./intent.md)
충족하는 결과: OUT-001, OUT-002
적용하는 제약: CON-001

제외: intent 의 비목표를 정본으로 따른다.

## 시나리오 `[필수 · 모든 티어]`

<!-- One nominal flow and at least one error or edge flow. Observable interaction only. -->

### SCN-001 — <대표 정상 흐름>

- **Given** <초기 상태>
- **When** <행동 또는 이벤트>
- **Then** <사용자가 관찰하는 결과>

### SCN-002 — <오류 또는 경계 흐름>

- **Given** <상태>
- **When** <같은 행동이 반복되거나 의존성이 실패>
- **Then** <안전하고 예측 가능한 결과>

## 요구사항 `[필수 · 모든 티어]`

<!-- One behaviour per requirement. `basis:` is required. Every Must needs acceptance criteria. -->

### FR-001 — <한 줄 요약> `Must`

근거: OUT-001

<시스템은 <조건>일 때 <관찰 가능한 동작>을 한다.>

수용 기준:

- [ ] AC-001 — <언제>이면 시스템은 <무엇을> 한다
- [ ] AC-002 — <언제>이면 시스템은 <무엇을> 한다

### FR-002 — <한 줄 요약> `Should`

근거: OUT-002

<사용자는 <행동>을 할 수 있다.>

수용 기준:

- [ ] AC-003 — <언제>이면 시스템은 <무엇을> 한다

## 오류와 경계 `[필수 · 모든 티어]`

### EDGE-001 — <조건>

<기대 동작.> 사용자에게: <행동 가능한 메시지.> 복구: <자동/수동/불가>

## 비기능 요구사항 `[필수 · standard+]`

<!-- Percentiles, load, and where it is measured. If a category does not apply, write `N/A — <basis>`. -->

### NFR-001 — 성능: <한 줄 요약> `Must`

근거: OUT-001

<p95 응답 시간이 <조건>에서 <값> 이하다.>

수용 기준:

- [ ] AC-004 — <측정 조건>에서 <수치 기준>을 만족한다

### NFR-002 — 보안·개인정보: <한 줄 요약> `Should`

근거: CON-001

<인증·권한·보존·암호화 요구.>

## 인터페이스 계약 `[조건부 · 외부 소비자와의 계약이 바뀔 때]`

**<인터페이스 이름>** — 소비자: <누가>

- 입력: <필드·의미·필수 여부·유효 범위>
- 출력: <성공 결과와 의미>
- 오류: <범주와 소비자가 취할 행동>
- 호환성: <기존 소비자에 대한 보장>

## 데이터와 개인정보 `[조건부 · 영속 데이터나 개인정보를 다룰 때]`

- <데이터군>: 출처 <..> · 목적 <..> · 분류 <공개/내부/개인/민감> · 보존 <..> · 접근 주체 <..>
- 정합성: <중복·순서·일관성·시간대 규칙>
- 이동 제한: <지역·시스템 경계 또는 해당 없음 — 근거>

## 열린 질문과 결정 `[필수 · 모든 티어]`

<!-- A question that stops the plan from starting is `blocked`. If none, write `N/A — <basis>`. -->

### SQ-001 — <질문>

영향 받는 요구사항: FR-002
담당: <이름> · 상태: Open

### SD-001 — <외부 동작에 대한 결정>

<무엇을 어떻게 정했고 왜.> 결정: <이름> / YYYY-MM-DD

## 승인과 변경 이력 `[필수 · standard+]`

- <역할> <이름> — <승인/조건부/반려>, YYYY-MM-DD. <의견>

### 변경 이력

- YYYY-MM-DD <이름> — 초안 작성. 영향: FR-001, AC-001
