---
artifact: spec
id: "SPEC-2026-031"
title: "Archived documents excluded from search"
status: accepted
tier: light
owner: "Search team"
created: 2026-09-04
updated: 2026-09-04
intent: "./intent.md"
intent_version: "@INTENT_SHA@"
superseded_by: null
generated_by: "claude-opus-5"
generated_from: "/create-spec"
skills_in_force: []
---

# Spec: Archived documents excluded from search

## Scope `[required · all tiers]`

Upstream intent: [CHG-2026-031](./intent.md)
Outcomes covered: OUT-001, OUT-002
Constraints applied: CON-001

Excluded: the intent's non-goals govern.

## Scenarios `[required · all tiers]`

### SCN-001 — Default search

- **Given** one archived and one unarchived document are indexed
- **When** an operator searches a word that matches both
- **Then** only the unarchived document stands in the results

### SCN-002 — Search including archived

- **Given** the same state
- **When** the operator sends the same query with archive inclusion on
- **Then** both documents stand in the results

## Requirements `[required · all tiers]`

### FR-001 — A default search excludes archived documents `Must`

basis: OUT-001

A search query drops archived documents from the results unless the caller says otherwise. An older document carrying no archive field counts as not archived.

acceptance:

- [ ] AC-001 — A query matching one archived and one plain document returns only the plain one.
- [ ] AC-002 — A document with no archive field stays in the results.

### FR-002 — Archive inclusion flag `Should`

basis: OUT-002

A caller that asks for archived documents gets them in the results. The flag defaults to false.

acceptance:

- [ ] AC-003 — With the flag on, both the archived and the plain document come back.

## Errors and edges `[required · all tiers]`

### EDGE-001 — Every match is archived, so the result set is empty

Return the empty set. To the user: say there is nothing and that archive inclusion is available. Recovery: automatic

## Open questions and decisions `[required · all tiers]`

N/A — the two scenarios settle the behaviour.
