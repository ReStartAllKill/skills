---
artifact: intent
id: "CHG-2026-031"
title: "Exclude archived documents from search"
status: accepted
tier: light
owner: "Search team"
created: 2026-09-04
updated: 2026-09-04
superseded_by: null
from_finding: null
generated_by: "claude-opus-5"
generated_from: "/spec archived documents show up in search"
skills_in_force: []
---

# Intent: Exclude archived documents from search

## 문제 `[필수 · 모든 티어]`

Operators keep running into documents they have already archived. They filter the
results by eye, which makes every search slower, and the fact that a document was
archived is nowhere on the screen.

## 목표 결과 `[필수 · 모든 티어]`

### OUT-001 — Default search hides archived documents `Must`

An operator who searches sees only documents that are not archived.

확인: create one archived and one ordinary document, search for a word that matches
both, and check that only the ordinary one comes back.

### OUT-002 — Archived documents remain reachable on request `Should`

Turning the include-archived flag on brings both back.

확인: run the same query with the flag on.

## 비목표 `[필수 · 모든 티어]`

- The archiving policy itself does not change.
- Read permissions on archived documents are left alone.

## 제약 `[필수 · 모든 티어]`

### CON-001 — The search API response shape does not change

Other consumers are already attached to it. Changing the shape breaks them quietly.

## 열린 질문 `[필수 · 모든 티어]`

None — the archived field is already in the index, and only the behaviour needs deciding.
