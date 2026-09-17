---
artifact: spec
schema_version: 7
id: "SPEC-YYYY-NNN"
title: "<spec title>"
status: draft # draft | in_review | accepted | rejected | superseded
tier: standard # must match the intent's tier
owner: "<the person or team who owns the spec>"
intent: "./intent.md"
intent_version: "<SHA of the commit that last changed intent.md>"
approved_by: null # required from status accepted on — the **person** who approved. Cannot equal generated_by
generated_by: null
---

# Spec: <spec title>

<!-- Internal structure, libraries and ordering belong in the plan. Field and event names on an
     external interface are a contract, so they belong here. Background stays in the intent, cited by ID. -->

## Scenarios `[required · standard+]`

<!-- One nominal flow and at least one error or edge flow. Observable interaction only.
     A priority on a scenario names a release slice: a `Must` scenario is worth shipping on its own.
     Either every scenario carries one, or none does. -->

### SCN-001 — <the main nominal flow> `Must`

- **Given** <starting state>
- **When** <an action or event>
- **Then** <what the user observes>

### SCN-002 — <an error or edge flow> `Should`

- **Given** <state>
- **When** <the same action repeats, or a dependency fails>
- **Then** <a safe and predictable result>

## Requirements

<!-- One behaviour per requirement. `basis:` is required. Every Must needs acceptance criteria.
     `scenario:` names the scenarios this requirement realises; it is how a slice reaches the plan.
     Delete those lines together with the Scenarios section at light tier — a citation of a
     scenario that is not there is an error, not a slice. -->

### FR-001 — <one line> `Must`

basis: OUT-001
scenario: SCN-001

<Under <condition> the system does <observable behaviour>.>

acceptance:

- [ ] AC-001 — When <trigger>, the system does <what>.
- [ ] AC-002 — When <trigger>, the system does <what>.

### FR-002 — <one line> `Should`

basis: OUT-002
scenario: SCN-002

<A user can <action>.>

acceptance:

- [ ] AC-003 — When <trigger>, the system does <what>.

## Errors and edges

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

## Approvals `[required · standard+]`

- <role> <name> — <approved/conditional/rejected>, YYYY-MM-DD. <comment>

<!-- Open questions and decisions: when there are any, add a `## Open questions and decisions`
     heading with one `### SQ-NNN` per question and one `### SD-NNN` per settled decision. When
     there are none, leave no heading — a section that is present must have content, and a
     standing `N/A — nothing open` is a sentence written for the checker rather than for a
     reader. The change history is git's; do not keep a copy here. -->
