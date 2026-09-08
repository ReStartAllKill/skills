---
artifact: plan
id: "PLAN-2026-031"
title: "보관 문서 검색 제외 구현"
status: accepted
tier: light
owner: "검색팀"
created: 2026-09-04
updated: 2026-09-04
intent: "./intent.md"
spec: "./spec.md"
spec_version: "@SPEC_SHA@"
superseded_by: null
generated_by: "claude-opus-5"
generated_from: "/create-plan"
skills_in_force: []
---

# Plan: 보관 문서 검색 제외 구현

## 입력과 범위 `[필수 · 모든 티어]`

상위 spec: [SPEC-2026-031](./spec.md) · 상위 intent: [CHG-2026-031](./intent.md)
구현 대상: FR-001, FR-002
구현하지 않는 것: 해당 없음 — 두 요구사항이 전부다
기준 코드: main

시작 전 전제:

- [x] intent 와 spec 이 accepted 다
- [x] 막는 열린 질문이 없다

## 도달 상태와 변경 지점 `[필수 · 모든 티어]`

검색 질의 조립부가 기본 필터에 «보관 아님» 을 더하고, 요청 파라미터로 그것을 끌 수 있게 한다. 응답 형태는 그대로다.

- `search/query.ts` — 기본 필터에 보관 제외를 더한다 (FR-001)
- `search/params.ts` — 보관 포함 플래그를 받는다 (FR-002)

## 릴리스 영향 `[필수 · 모든 티어]`

target_branch: feat/search-exclude-archived
pr_strategy: 단일 PR
되돌리기: revert PR 한 장 — 데이터를 쓰지 않는다
마지막 롤백 리허설: 미실시 — 되돌리기가 순수 코드 revert 라 리허설 대상이 아니다
걸리는 게이트: 없음

## 작업 `[필수 · 모든 티어]`

실행 순서:

```
레벨 1:  WP-001  WP-002      ← 병렬
        ── 전체 verify ──
레벨 2:  WP-003
```

- [ ] **WP-001 — 기본 필터에 보관 제외를 더한다**
  - files: `search/query.ts`, `search/query.test.ts`
  - depends: 없음
  - covers: FR-001 (AC-001, AC-002)
  - tests: 보관 문서와 일반 문서가 함께 걸리는 질의에서 일반 문서만 반환된다
  - verify: npm run gate

- [ ] **WP-002 — 보관 포함 플래그를 파라미터로 받는다**
  - files: `search/params.ts`, `search/params.test.ts`
  - depends: 없음
  - covers: FR-002 (AC-003)
  - tests: 플래그가 켜지면 보관 문서와 일반 문서가 모두 반환된다
  - verify: npm run gate

- [ ] **WP-003 — 플래그를 질의 조립부에 연결한다**
  - files: `search/query.ts`
  - depends: WP-001, WP-002
  - covers: FR-002 (AC-003)
  - tests: 플래그가 꺼진 기본 호출에서 보관 문서가 여전히 빠진다
  - verify: npm run gate

## 위험 `[필수 · 모든 티어]`

### RISK-001 — 보관 필드가 빈 옛 문서가 함께 걸러진다

가능성 중 · 영향 중
조기 신호: 검색 결과 건수가 배포 직후 급감
대응: 필드가 없으면 «보관 아님» 으로 읽는다. AC-002 가 그것을 문다.

## 열린 질문 `[필수 · 모든 티어]`

해당 없음 — 차단 요소가 없다.

## 완료 정의 `[필수 · 모든 티어]`

- [ ] 모든 Must 요구사항과 수용 기준이 통과했다
- [ ] 전체 verify 가 통과했다
- [ ] 되돌리기 경로가 준비돼 있다
- [ ] 구현 결과와 검증 증거가 PR 에 연결됐다

## 실행 기록 `[필수 · 모든 티어]`

해당 없음 — 아직 실행 전.
