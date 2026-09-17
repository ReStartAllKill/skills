---
artifact: intent
schema_version: 7
id: "CHG-2026-061"
title: "업로드 전에 남은 용량을 보여 준다"
status: accepted
tier: light
owner: "업로드팀"
approved_by: "hanjiwoo"
generated_by: "claude-opus-5"
decisions: ["ADR-004"]
---

# Intent: 업로드 전에 남은 용량을 보여 준다

## 문제

워크스페이스가 용량이 다 찬 줄 모르고 업로드를 시작한다. 적재가 끝난 뒤에야 거부돼서 올린 시간이 버려진다.

## 목표 결과

### OUT-001 — 업로드 시작 화면에 남은 용량이 선다 `Must`

워크스페이스가 업로드를 시작하면 남은 용량을 먼저 본다.

확인: 용량이 거의 찬 워크스페이스로 업로드 화면을 열고 남은 값이 보이는지 본다.

## 비목표

- 용량을 늘리는 결제 흐름은 넣지 않는다.

## 제약

### CON-001 — 사용량 집계 값은 그대로다

마감된 집계를 다시 열지 않는다.
