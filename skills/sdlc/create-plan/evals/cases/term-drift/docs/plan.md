---
artifact: plan
schema_version: 7
id: "PLAN-2026-062"
title: "집행 전 신청 취소 구현"
status: accepted
tier: standard
owner: "대출팀"
intent: "./intent.md"
spec: "./spec.md"
spec_version: "@SPEC_SHA@"
approved_by: "hanjiwoo"
generated_by: "claude-opus-5"
---

# Plan: 집행 전 신청 취소 구현

## 현재 코드

- `loan/state.ts:12` — 상태 전이표에 `CANCELLED` 가 없다 / 전이를 더한다
- `loan/cancel.ts:1` — 없음 / 새로 만든다

## 도달 상태와 변경 지점

취소 핸들러가 전이표를 거쳐 상태를 바꾸고, 사유가 실리면 신청에 남긴다.

- `loan/reason.ts` — 사유 코드 표와 기록을 더한다 (FR-002)
- `loan/cancel.ts` — 취소 핸들러를 더한다 (FR-001)

## 릴리스 영향

target_branch: feat/cancel-application
pr_strategy: 단일 PR
되돌리기: revert PR 한 장 — 상태 값 하나가 늘 뿐 마이그레이션이 없다
마지막 롤백 리허설: 미실시 — 순수 코드 revert 라 리허설 대상이 아니다
걸리는 게이트: 없음

## 설계 결정

### TD-001 — 상태 전이를 전이표 한 곳에 둔다

covers: FR-001

전이표에 없는 조합은 예외로 떨어뜨려 조용한 통과를 막는다.

기각안: 핸들러마다 조건문 — 전이가 흩어져 `DISBURSED` 취소를 막는 자리가 여럿이 된다.

## 작업

실행 순서:

```
레벨 1:  WP-001
레벨 2:  WP-002
```

- [ ] **WP-001 — 사유 코드 표와 기록을 더한다**
  - files: `loan/reason.ts`, `loan/reason.test.ts`
  - depends: 없음
  - covers: FR-002 (AC-003)
  - tests: 사유 코드가 실린 취소 요청이 오면 시스템은 신청에 그 사유를 남긴다
  - verify: npm run gate

- [ ] **WP-002 — 취소 핸들러와 전이를 더한다**
  - files: `loan/cancel.ts`, `loan/state.ts`, `loan/cancel.test.ts`
  - depends: 없음
  - covers: FR-001 (AC-001, AC-002), NFR-001 (AC-004)
  - tests: `PENDING` 신청에 취소 요청이 오면 시스템은 상태를 `Cancelled` 로 바꾼다 · 취소된 신청에 다시 취소 요청이 오면 시스템은 같은 결과를 낸다 · 동시 취소 요청 50건에서 시스템은 p95 500ms 안에 응답한다
  - verify: npm run gate

## 위험

### RISK-001 — 심사 큐가 상태를 안 읽고 복제본을 든다

가능성 저 · 영향 고
조기 신호: 취소된 신청이 큐 조회에 남는다
대응: ASM-001 을 큐 코드에서 먼저 확인한다.

## 관측과 운영

- 취소 성공 건수 — OUT-001 을 잰다 · 임계 없음 · 대출 대시보드 · 대출팀
- 런북 변경: 해당 없음 — 운영 절차가 바뀌지 않는다
- 온콜과 소유: 대출팀 온콜 채널
