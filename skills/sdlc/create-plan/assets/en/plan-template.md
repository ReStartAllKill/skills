---
artifact: plan
schema_version: 4
id: "PLAN-YYYY-NNN"
title: "<implementation plan title>"
status: draft # draft | in_review | accepted | in_progress | completed | rejected | superseded
tier: standard # must match the intent's tier
owner: "<the person or team who implements>"
created: YYYY-MM-DD
updated: YYYY-MM-DD
intent: "./intent.md"
spec: "./spec.md"
spec_version: "<SHA of the commit that last changed spec.md>"
superseded_by: null
approved_by: null # required from status accepted on — the **person** who approved. Cannot equal generated_by
generated_by: null
generated_from: null
skills_in_force: []
---

# Plan: <plan title>

<!-- The input to `/implement-spec`. Cite requirements by ID. If external behaviour changes,
     the spec changes first. -->

## Input and scope `[required · all tiers]`

Upstream spec: [<SPEC-YYYY-NNN>](./spec.md) · upstream intent: [<CHG-YYYY-NNN>](./intent.md)
Building: FR-001, FR-002, NFR-001
Not building: <Could/Won't IDs, or N/A — basis>
Base: <branch, tag, commit>

Before starting:

- [ ] the intent and the spec are `accepted`
- [ ] no blocking question is open
- [ ] the environments, access and test data exist

## Code as it stands `[required · standard+]`

<!-- Cite as `<path>:<line>`. Write «none» when building from scratch. Keep what was checked
     separate from what is believed. -->

- `<path>:<line>` — <what it does now> / <why it is touched>

## Target state and change points `[required · all tiers]`

<!-- The flow after this lands, and which file changes how. This is the body of a light plan. -->

<The flow, in one to three sentences.>

- `<path>` — <what is added or changed there> (FR-001)
- `<test path>` — <what it verifies> (AC-001)

## Release impact `[required · all tiers]`

<!-- `/implement-spec` reads these. Do not leave them blank. -->

target_branch: <branch>
pr_strategy: <one PR / one PR per level / no PR>
rollback: <a single revert PR / turn off feature flag <name> / needs a reverse migration>
last rollback rehearsal: <YYYY-MM-DD environment result — or «not done» and why>
gates that apply: <whichever extra_gates in spec-profile.yml apply here, or none>

## Design decisions `[required · standard+]`

<!-- Only decisions that are hard to reverse. Record what was rejected and why. -->

### TD-001 — <name of the decision>

covers: FR-001

<The approach taken and what it stands on.>

rejected: <what was considered and dropped, and why.>

## Data, contracts, migration `[conditional · when a schema, a public contract or existing data changes]`

- Schema change: <what, or N/A — basis>
- Existing data: <backfill, transform, lazy migration>
- Integrity: <transactions, idempotence, concurrency>
- Contract compatibility: <version/extension/adapter> · consumer cutover: <order and deadline>
- Order: <1) ship the compatible base → 2) migrate gradually → 3) remove the old path>

## Tasks `[required · all tiers]`

<!-- Format and rules live in references/tasks.md. All five fields are required, and tasks on the
     same level must not share a file. -->

Execution order:

```
level 1:  WP-001  WP-002      ← in parallel
         ── full verify ──
level 2:  WP-003
```

- [ ] **WP-001 — <what it builds, in one line>**
  - files: `<source path>`, `<test path>`
  - depends: none
  - covers: FR-001 (AC-001)
  - tests: <every AC sentence in covers — separate several with ` · `>
  - verify: <command>

- [ ] **WP-002 — <what it builds, in one line>**
  - files: `<another path>`
  - depends: none
  - covers: FR-002 (AC-003)
  - tests: <every AC sentence in covers — separate several with ` · `>
  - verify: <command>

- [ ] **WP-003 — <what it builds, in one line>**
  - files: `<path>`
  - depends: WP-001
  - covers: NFR-001 (AC-004)
  - tests: <every AC sentence in covers — separate several with ` · `>
  - verify: <command>

## Risks `[required · all tiers]`

### RISK-001 — <risk>

likelihood <high/medium/low> · impact <high/medium/low>
early signal: <what shows it is happening>
response: <prevention, mitigation>

## Observability and operations `[required · standard+]`

- <signal> — <purpose, e.g. measures OUT-001> · threshold <value> · <dashboard/log> · <owner>
- Runbook changes: <link, or N/A — basis>
- On-call and ownership: <team and how to reach it>

## Rollout `[required · full]`

1. Internal — <entry condition> / <window and measures> / <go or stop>
2. Limited to <percentage> — <condition> / <measures> / <criteria>
3. Everyone — <condition> / <measures> / <criteria>

Feature flag: <name, default, owner, or N/A — basis>

## Open questions `[required · all tiers]`

### PQ-001 — <a technical question>

affects: WP-002 · owner: <name> · state: Open

## Definition of done `[required · all tiers]`

- [ ] every Must requirement and its acceptance criteria pass
- [ ] the full verify passes, including the gates that apply
- [ ] (standard+) security, privacy and accessibility review is done
- [ ] the rollback path is ready
- [ ] the result and its verification evidence are linked from the PR
- [ ] nothing contradicts the upstream documents, or what does has been carried upstream

## Execution log `[required · all tiers]`

<!-- Where the plan and reality differ. Before execution starts, write `N/A — not started`. -->

- YYYY-MM-DD WP-001 — <done/partial/failed> · commit: <SHA> · <PR link> · differs from plan: <none, or what>

### History

- YYYY-MM-DD <name> — first draft. affects: WP-001, TD-001
