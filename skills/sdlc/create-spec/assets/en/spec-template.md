---
artifact: spec
schema_version: 4
id: "SPEC-YYYY-NNN"
title: "<spec title>"
status: draft # draft | in_review | accepted | rejected | superseded
tier: standard # must match the intent's tier
owner: "<the person or team who owns the spec>"
created: YYYY-MM-DD
updated: YYYY-MM-DD
intent: "./intent.md"
intent_version: "<SHA of the commit that last changed intent.md>"
superseded_by: null
approved_by: null # required from status accepted on — the **person** who approved. Cannot equal generated_by
generated_by: null
generated_from: null
skills_in_force: []
---

# Spec: <spec title>

<!-- Internal structure, libraries and ordering belong in the plan. Field and event names on an
     external interface are a contract, so they belong here. Background stays in the intent, cited by ID. -->

## Scope `[required · all tiers]`

Upstream intent: [<CHG-YYYY-NNN>](./intent.md)
Outcomes covered: OUT-001, OUT-002
Constraints applied: CON-001

Excluded: the intent's non-goals govern.

## Scenarios `[required · all tiers]`

<!-- One nominal flow and at least one error or edge flow. Observable interaction only. -->

### SCN-001 — <the main nominal flow>

- **Given** <starting state>
- **When** <an action or event>
- **Then** <what the user observes>

### SCN-002 — <an error or edge flow>

- **Given** <state>
- **When** <the same action repeats, or a dependency fails>
- **Then** <a safe and predictable result>

## Requirements `[required · all tiers]`

<!-- One behaviour per requirement. `basis:` is required. Every Must needs acceptance criteria. -->

### FR-001 — <one line> `Must`

basis: OUT-001

<Under <condition> the system does <observable behaviour>.>

acceptance:

- [ ] AC-001 — When <trigger>, the system does <what>.
- [ ] AC-002 — When <trigger>, the system does <what>.

### FR-002 — <one line> `Should`

basis: OUT-002

<A user can <action>.>

acceptance:

- [ ] AC-003 — When <trigger>, the system does <what>.

## Errors and edges `[required · all tiers]`

### EDGE-001 — <condition>

<Expected behaviour.> To the user: <a message they can act on.> Recovery: <automatic/manual/none>

## Non-functional requirements `[required · standard+]`

<!-- Percentiles, load, and where it is measured. If a category does not apply, write `N/A — <basis>`. -->

### NFR-001 — Performance: <one line> `Must`

basis: OUT-001

<p95 response time stays at or under <value> under <condition>.>

acceptance:

- [ ] AC-004 — Under <measurement condition> the system meets <numeric threshold>.

### NFR-002 — Security and privacy: <one line> `Should`

basis: CON-001

<Authentication, authorisation, retention, encryption.>

## Interface contract `[conditional · when a contract with an external consumer changes]`

**<interface name>** — consumers: <who>

- Input: <fields, meaning, whether required, valid range>
- Output: <the success result and what it means>
- Errors: <categories and what a consumer does about each>
- Compatibility: <what is guaranteed to existing consumers>

## Data and privacy `[conditional · when persistent data or personal data is involved]`

- <data set>: source <..> · purpose <..> · class <public/internal/personal/sensitive> · retention <..> · who can read <..>
- Integrity: <duplication, ordering, consistency, time zone rules>
- Movement limits: <region or system boundary, or N/A — basis>

## Open questions and decisions `[required · all tiers]`

<!-- A question that stops the plan from starting is `blocked`. If none, write `N/A — <basis>`. -->

### SQ-001 — <question>

affects: FR-002
owner: <name> · state: Open

### SD-001 — <a decision about external behaviour>

<What was settled, how, and why.> decided by: <name> / YYYY-MM-DD

## Approvals and history `[required · standard+]`

- <role> <name> — <approved/conditional/rejected>, YYYY-MM-DD. <comment>

### History

- YYYY-MM-DD <name> — first draft. affects: FR-001, AC-001
