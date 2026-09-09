---
artifact: adr
schema_version: 5
id: "ADR-{NNN}"
title: "<무엇을 정했는지가 드러나는 제목>"
status: draft
scope:
  - "<이 결정이 제약하는 코드 경로 — 레포 루트 기준>"
supersedes: null
superseded_by: null
approved_by: null
generated_by: "<모델 또는 사람>"
generated_from: "<이 ADR을 부른 자리 — 스펙 경로 · 이슈 · 대화>"
confirms:
  - "<지켜졌는지 판정하는 테스트 이름 또는 게이트 명령>"
revisit: ["RV-001"]
---

# ADR-{NNN} — <제목>

<!-- Five sections, below. Do not number them, add to them, or split them.
     Delete every guide comment and <> placeholder before submitting. -->

## 결정

<!-- State it first, in the plain present tense. What was decided, and **how far** it reaches.
     No reasoning here. Code is the source of truth for field definitions, formulas and
     signatures, so quote only what is needed to follow the decision. -->

<정한 것.>

### Non-goals

<!-- What this ADR does not settle — what goes to another ADR, to code, or to an issue. It closes
     a scope argument before it opens. This list is carried into the implementing agent's prompt. -->

- <정하지 않는 것.>

## 문맥과 결정 요인

<!-- What is uncomfortable, risky or unclear. Do not leak the decision or the fix. -->

<문제.>

**결정 요인** — 아래 대안 절의 공통 축이다. 채워야 할 칸이 아니라 잣대를 하나로 묶는 장치다.

- **<요인>:** <왜 이 축이 결정을 가르는가.>

### ASM-001 — <미검증 전제>

<!-- Only when the decision stands on something unverified. What is unsettled, why, and which part
     of the decision rests on it. If you write a premise, pair it with an RV-* below for the case
     where it fails. If there is none, delete this subsection. -->

<전제와 그 위에 선 부분.>

## 대안

<!-- Only options that were really considered and are **mutually exclusive**. If two can be adopted
     together they are a combination, not alternatives. State the strengths of what was rejected —
     an ADR listing only weak alternatives reads as justification written afterwards.
     If staying as-is was a real option, list it as one.
     With three or more alternatives, or three or more axes, use a comparison table; with a table,
     drop the per-alternative subsections. -->

### ALT-001 — <대안 이름>

<장점과 단점.>

### ALT-002 — <대안 이름> (채택)

<장점과 단점.>

**채택 근거:** <표나 나열이 보여주지 않는 것 — 왜 이 축의 손실을 감수하고 저 축을 택했는가.>

## 결과

<!-- What is gained, and **the limits accepted**. The second is the point of this document, and the
     checker rejects an ADR with none — a decision without a cost is not a decision. "It might"
     is not a cost. No owning team, no schedule: project management belongs in the issue and goes
     stale first. -->

- 얻는 것: <내용>
- 감수하는 제약: <내용>

## 확인과 재검토

<!-- What `confirms:` points at, and what would reopen the decision. Link only things that exist.
     Do not keep a list of documents that contradict this decision here — that list is a chore that
     has to be deleted once each is fixed, which brings the synchronisation burden back. It belongs
     on the implementation issue's checklist. -->

- **확인:** <무엇이 검증되면 결정이 지켜진 것인가 — 정본은 어느 테스트인가.>

### RV-001 — <재검토 조건>

<!-- A condition that is true or false, not a date. «Revisit in six months» is not a condition.
     `/create-finding` can wake this ID from an operational signal. -->

<이것이 참이 되면 이 결정을 다시 연다.>

- **링크:** <구현 이슈 URL · 실행 가능한 정본(계약·스키마·테스트) · 관련 ADR>
