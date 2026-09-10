---
artifact: plan
schema_version: 7
id: "PLAN-YYYY-NNN"
title: "<implementation plan title>"
status: draft # draft | in_review | accepted | in_progress | completed | rejected | superseded
tier: standard # must match the intent's tier
owner: "<the person or team who implements>"
intent: "./intent.md"
spec: "./spec.md"
spec_version: "<SHA of the commit that last changed spec.md>"
approved_by: null # required from status accepted on — the **person** who approved. Cannot equal generated_by
generated_by: null
---

# Plan: <plan title>

<!-- The input to `/implement-spec`. Cite requirements by ID. If external behaviour changes,
     the spec changes first. -->

## Code as it stands `[required · standard+]`

<!-- Cite as `<path>:<line>`. Write «none» when building from scratch. Keep what was checked
     separate from what is believed. -->

- `<path>:<line>` — <what it does now> / <why it is touched>

## Target state and change points

<!-- The flow after this lands, and which file changes how. This is the body of a light plan. -->

<The flow, in one to three sentences.>

- `<path>` — <what is added or changed there> (FR-001)
- `<test path>` — <what it verifies> (AC-001)

## Release impact

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

## Tasks

<!-- Format and rules live in references/tasks.md. All five fields are required, and tasks on the
     same level must not share a file. -->

Execution order:

```
level 1:  WP-001  WP-002      ← in parallel
         ── scoped verify ──
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

## Risks

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

<!-- Open questions: when there are any, add a `## Open questions` heading and one `### PQ-NNN`
     item per question. When there are none, leave no heading — a section that is present must
     have content. The execution-log section is written by `plan-check mark`, which creates it on
     the first entry; do not add it by hand and do not leave it standing empty. The change history
     is git's; do not keep a copy here. -->
