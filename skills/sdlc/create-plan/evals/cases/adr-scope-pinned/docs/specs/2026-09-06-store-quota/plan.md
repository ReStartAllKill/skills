---
artifact: plan
schema_version: 7
id: "PLAN-2026-061"
title: "업로드 전 남은 용량 표시 구현"
status: accepted
tier: light
owner: "업로드팀"
intent: "./intent.md"
spec: "./spec.md"
spec_version: "@SPEC_SHA@"
approved_by: "hanjiwoo"
generated_by: "claude-opus-5"
---

# Plan: 업로드 전 남은 용량 표시 구현

## 현재 코드

- `src/storage/quota.ts:1` — 용량을 항상 0 으로 낸다 / 집계를 읽도록 바꾼다

## 도달 상태와 변경 지점

업로드 시작 핸들러가 집계에서 남은 용량을 읽어 응답에 싣고, 0 이면 거부한다.

- `src/storage/quota.ts` — 집계에서 남은 용량을 읽는다 (FR-001)
- `src/storage/quota.test.ts` — 응답 값과 거부를 문다 (AC-001, AC-002)

## 릴리스 영향

target_branch: feat/store-quota
pr_strategy: 단일 PR
되돌리기: revert PR 한 장 — 데이터를 쓰지 않는다
마지막 롤백 리허설: 미실시 — 순수 코드 revert 라 리허설 대상이 아니다
걸리는 게이트: 없음

## 작업

- [ ] **WP-001 — 집계에서 남은 용량을 읽어 응답에 싣는다**
  - files: `src/storage/quota.ts`, `src/storage/quota.test.ts`
  - depends: 없음
  - covers: FR-001 (AC-001, AC-002)
  - tests: 업로드 시작 요청이 오면 시스템은 응답에 남은 용량을 바이트로 싣는다 · 남은 용량이 0 이면 시스템은 업로드 시작을 거부한다
  - verify: npm run gate

## 위험

### RISK-001 — 집계 지연으로 남은 용량이 실제보다 크게 보인다

가능성 중 · 영향 저
조기 신호: 남은 용량이 보였는데 적재가 거부되는 로그
대응: 응답에 집계 시각을 함께 싣는다.
