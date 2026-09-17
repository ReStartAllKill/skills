---
artifact: adr
schema_version: 5
id: "ADR-004"
title: "본문 저장소는 오브젝트 스토어 하나만 쓴다"
status: accepted
scope:
  - "src/storage"
supersedes: null
superseded_by: null
approved_by: "hanjiwoo"
generated_by: "claude-opus-5"
confirms:
  - "test_StoreIsObjectOnly"
revisit: ["RV-001"]
---

# ADR-004 — 본문 저장소는 오브젝트 스토어 하나만 쓴다

## 결정

본문은 오브젝트 스토어에만 적재한다. 사용량 집계와 요금 계산은 그 하나의 경로만 읽는다.

### Non-goals

- 저장소 사이의 이관은 다루지 않는다.

## 문맥과 결정 요인

집계가 저장소마다 갈리면 마감된 집계를 다시 열어야 한다. 비교 축은 집계 경로의 수와 운영 비용이다.

### ASM-001 — 워크스페이스는 오브젝트 스토어에 닿는다

사내 볼륨만 쓰는 워크스페이스는 아직 없다.

## 대안

### ALT-001 — 저장소를 워크스페이스마다 고른다

집계 경로가 저장소 수만큼 늘고, 요금표를 저장소마다 든다.

### ALT-002 — 오브젝트 스토어 하나만 쓴다 (채택)

집계 경로가 하나라 마감 집계가 흔들리지 않는다.

## 결과

받아들인 제약: 사내 볼륨만 쓰는 워크스페이스는 업로드 앞에서 멈춘다. 그 비용을 집계의 단순함과 맞바꿨다.

## 확인과 재검토

`test_StoreIsObjectOnly` 가 적재 경로가 하나임을 문다.

### RV-001 — 사내 볼륨만 쓰는 워크스페이스가 생긴다

ASM-001 이 거짓이 되면 이 결정을 다시 연다.
