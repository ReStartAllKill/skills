---
artifact: spec
schema_version: 7
id: "SPEC-2026-062"
title: "집행 전 신청 취소"
status: accepted
tier: standard
owner: "대출팀"
intent: "./intent.md"
intent_version: "@INTENT_SHA@"
approved_by: "hanjiwoo"
generated_by: "claude-opus-5"
---

# Spec: 집행 전 신청 취소

## 시나리오

### SCN-001 — 대기 중 신청을 취소한다 `Must`

- **Given** 신청이 `PENDING` 이다
- **When** 신청자가 취소를 누른다
- **Then** 신청이 `CANCELLED` 가 되고 심사 큐에서 빠진다

### SCN-002 — 사유를 골라 취소한다 `Should`

- **Given** 신청이 `PENDING` 이다
- **When** 신청자가 사유를 고르고 취소를 누른다
- **Then** 취소와 함께 사유가 남는다

### SCN-003 — 집행된 신청은 취소되지 않는다 `Should`

- **Given** 신청이 `DISBURSED` 다
- **When** 신청자가 취소를 누른다
- **Then** 취소가 거부되고 상태가 그대로다

## 요구사항

### FR-001 — 대기 중 신청의 취소 `Must`

근거: OUT-001
시나리오: SCN-001

`PENDING` 신청에 취소 요청이 오면 상태를 `CANCELLED` 로 바꾼다.

수용 기준:

- [ ] AC-001 — `PENDING` 신청에 취소 요청이 오면 시스템은 상태를 `CANCELLED` 로 바꾼다
- [ ] AC-002 — 취소된 신청에 다시 취소 요청이 오면 시스템은 같은 결과를 낸다

### FR-002 — 취소 사유 기록 `Should`

근거: OUT-002
시나리오: SCN-002

취소 요청에 사유 코드가 실리면 신청에 그 사유를 남긴다.

수용 기준:

- [ ] AC-003 — 사유 코드가 실린 취소 요청이 오면 시스템은 신청에 그 사유를 남긴다

## 오류와 경계

### EDGE-001 — 취소 요청이 두 번 겹친다

한 건만 반영하고 나머지는 같은 결과를 낸다. 사용자에게: 이미 취소됐다고 알린다. 복구: 자동

## 비기능 요구사항

### NFR-001 — 취소 응답 시간 `Must`

근거: OUT-001
시나리오: SCN-001

취소 요청의 p95 응답 시간이 500ms 안이다.

수용 기준:

- [ ] AC-004 — 동시 취소 요청 50건에서 시스템은 p95 500ms 안에 응답한다

## 승인

- 대출팀 hanjiwoo — 승인, 2026-09-06.
