---
artifact: spec
schema_version: 7
id: "SPEC-2026-061"
title: "업로드 전 남은 용량 표시"
status: accepted
tier: light
owner: "업로드팀"
intent: "./intent.md"
intent_version: "@INTENT_SHA@"
approved_by: "hanjiwoo"
generated_by: "claude-opus-5"
---

# Spec: 업로드 전 남은 용량 표시

## 요구사항

### FR-001 — 업로드 시작 응답에 남은 용량이 실린다 `Must`

근거: OUT-001

업로드 시작 요청의 응답에 남은 용량이 바이트 단위로 실린다. 값은 사용량 집계에서 읽는다.

수용 기준:

- [ ] AC-001 — 업로드 시작 요청이 오면 시스템은 응답에 남은 용량을 바이트로 싣는다
- [ ] AC-002 — 남은 용량이 0 이면 시스템은 업로드 시작을 거부한다

## 오류와 경계

### EDGE-001 — 집계가 아직 없는 새 워크스페이스

전체 용량을 남은 용량으로 낸다. 사용자에게: 그대로 보인다. 복구: 자동
