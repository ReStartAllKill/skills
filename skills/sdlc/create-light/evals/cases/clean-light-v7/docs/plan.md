---
artifact: plan
schema_version: 7
id: "PLAN-2026-041"
title: "보관 문서 검색 제외 구현"
status: accepted
tier: light
owner: "검색팀"
intent: "./intent.md"
spec: "./spec.md"
spec_version: "body:c35f0f372b3d"
approved_by: "한지우"
generated_by: "claude-opus-5"
---

# Plan: 보관 문서 검색 제외 구현

## 도달 상태와 변경 지점

검색 질의 조립부가 기본 필터에 «보관 아님» 을 더하고, 요청 파라미터로 그것을 끌 수 있게 한다. 응답 형태는 그대로다.

- `search/query.ts` — 기본 필터에 보관 제외를 더한다 (FR-001)
- `search/params.ts` — 보관 포함 플래그를 받는다 (FR-002)

## 릴리스 영향

target_branch: feat/search-exclude-archived
pr_strategy: 단일 PR
되돌리기: revert PR 한 장 — 데이터를 쓰지 않는다
마지막 롤백 리허설: 미실시 — 되돌리기가 순수 코드 revert 라 리허설 대상이 아니다
걸리는 게이트: 없음

## 작업

실행 순서:

```
레벨 1:  WP-001  WP-002      ← 병렬
        ── scoped verify ──
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

## 위험

### RISK-001 — 보관 필드가 빈 옛 문서가 함께 걸러진다

가능성 중 · 영향 중
조기 신호: 검색 결과 건수가 배포 직후 급감
대응: 필드가 없으면 «보관 아님» 으로 읽는다. AC-002 가 그것을 문다.
