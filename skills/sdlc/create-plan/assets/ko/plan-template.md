---
artifact: plan
schema_version: 7
id: "PLAN-YYYY-NNN"
title: "<구현 계획 제목>"
status: draft # draft | in_review | accepted | in_progress | completed | rejected | superseded
tier: standard # intent 의 tier 와 같아야 한다
owner: "<구현 책임자 또는 팀>"
intent: "./intent.md"
spec: "./spec.md"
spec_version: "<spec.md 를 마지막으로 바꾼 커밋 SHA>"
approved_by: null # status 가 accepted 이상이면 필수 — 승인한 **사람**. generated_by 와 같을 수 없다
generated_by: null
---

# Plan: <계획 제목>

<!-- The input to `/implement-spec`. Cite requirements by ID. If external behaviour changes,
     the spec changes first. -->

## 코드 실태 `[필수 · standard+]`

<!-- Cite as `<path>:<line>`. Write «none» when building from scratch. Keep what was checked
     separate from what is believed. -->

- `<경로>:<줄>` — <현재 책임> / <왜 건드리는가>

## 도달 상태와 변경 지점

<!-- The flow after this lands, and which file changes how. This is the body of a light plan. -->

<1~3문장으로 흐름.>

- `<경로>` — <추가/수정할 책임> (FR-001)
- `<테스트 경로>` — <검증 추가> (AC-001)

## 릴리스 영향

<!-- `/implement-spec` reads these. Do not leave them blank. -->

target_branch: <브랜치>
pr_strategy: <단일 PR / 레벨별 PR / PR 없음>
되돌리기: <revert PR 한 장 / 기능 플래그 <이름> 끄기 / 역마이그레이션 필요>
마지막 롤백 리허설: <YYYY-MM-DD 환경 결과 — 또는 «미실시» 와 그 이유>
걸리는 게이트: <spec-profile.yml 의 extra_gates 중 이번에 걸리는 것 또는 없음>

## 설계 결정 `[필수 · standard+]`

<!-- Only decisions that are hard to reverse. Record what was rejected and why. -->

### TD-001 — <결정 이름>

covers: FR-001

<선택한 방식과 그 근거.>

기각안: <고려했지만 버린 안과 사유.>

## 데이터·계약·마이그레이션 `[조건부 · 스키마·공개 계약·기존 데이터가 바뀔 때]`

- 스키마 변경: <내용 또는 해당 없음 — 근거>
- 기존 데이터: <백필·변환·지연 마이그레이션>
- 정합성: <트랜잭션·멱등성·동시성>
- 계약 호환성: <버전/확장/어댑터> · 소비자 전환: <순서와 기한>
- 순서: <1) 호환 가능한 기반 배포 → 2) 점진 전환 → 3) 옛 경로 제거>

## 작업

<!-- Format and rules live in references/tasks.md. All five fields are required, and tasks on the
     same level must not share a file. -->

실행 순서:

```
레벨 1:  WP-001  WP-002      ← 병렬
        ── scoped verify ──
레벨 2:  WP-003
```

- [ ] **WP-001 — <무엇을 만드는지 한 줄>**
  - files: `<소스 경로>`, `<테스트 경로>`
  - depends: 없음
  - covers: FR-001 (AC-001)
  - tests: <covers 의 AC 문장 전부 — 여러 개면 ` · `로 구분>
  - verify: <명령>

- [ ] **WP-002 — <무엇을 만드는지 한 줄>**
  - files: `<다른 경로>`
  - depends: 없음
  - covers: FR-002 (AC-003)
  - tests: <covers 의 AC 문장 전부 — 여러 개면 ` · `로 구분>
  - verify: <명령>

- [ ] **WP-003 — <무엇을 만드는지 한 줄>**
  - files: `<경로>`
  - depends: WP-001
  - covers: NFR-001 (AC-004)
  - tests: <covers 의 AC 문장 전부 — 여러 개면 ` · `로 구분>
  - verify: <명령>

## 위험

### RISK-001 — <위험>

가능성 <높/중/낮> · 영향 <높/중/낮>
조기 신호: <무엇을 보면 알 수 있나>
대응: <예방·완화>

## 관측과 운영 `[필수 · standard+]`

- <신호> — <목적(OUT-001 측정 등)> · 임계 <값> · <대시보드/로그> · <담당>
- 런북 변경: <링크 또는 해당 없음 — 근거>
- 온콜·소유권: <팀과 연락 경로>

## 배포 `[필수 · full]`

1. 내부 — <진입 조건> / <관찰 기간·지표> / <진행·중단 기준>
2. 제한 출시 <비율> — <조건> / <지표> / <기준>
3. 전체 — <조건> / <지표> / <기준>

기능 플래그: <이름, 기본값, 소유자 또는 해당 없음 — 근거>

<!-- Open questions: when there are any, add a `## 열린 질문` heading and one `### PQ-NNN`
     item per question. When there are none, leave no heading — a section that is present must
     have content. The execution-log section is written by `plan-check mark`, which creates it on
     the first entry; do not add it by hand and do not leave it standing empty. The change history
     is git's; do not keep a copy here. -->
