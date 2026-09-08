---
artifact: adr
schema_version: 5
id: "ADR-{NNN}"
title: "<a title that says what was decided>"
status: draft
scope:
  - "<the code this decision constrains — paths from the repository root>"
supersedes: null
superseded_by: null
approved_by: null
generated_by: "<model or person>"
generated_from: "<what called for this ADR — a spec path, an issue, a conversation>"
confirms:
  - "<the test name or gate command that judges whether it is held>"
revisit: ["RV-001"]
---

# ADR-{NNN} — <title>

<!-- Five sections, below. Do not number them, add to them, or split them.
     Delete every guide comment and <> placeholder before submitting. -->

## Decision

<!-- State it first, in the plain present tense. What was decided, and **how far** it reaches.
     No reasoning here. Code is the source of truth for field definitions, formulas and
     signatures, so quote only what is needed to follow the decision. -->

<What was decided.>

### Non-goals

<!-- What this ADR does not settle — what goes to another ADR, to code, or to an issue. It closes
     a scope argument before it opens. This list is carried into the implementing agent's prompt. -->

- <What is not settled here.>

## Context and forces

<!-- What is uncomfortable, risky or unclear. Do not leak the decision or the fix. -->

<The problem.>

**Deciding forces** — the shared axes the alternatives below are judged on. Not boxes to fill, but
the device that holds every alternative to one yardstick.

- **<force>:** <why this axis separates the options.>

### ASM-001 — <an unverified premise>

<!-- Only when the decision stands on something unverified. What is unsettled, why, and which part
     of the decision rests on it. If you write a premise, pair it with an RV-* below for the case
     where it fails. If there is none, delete this subsection. -->

<The premise and what rests on it.>

## Alternatives

<!-- Only options that were really considered and are **mutually exclusive**. If two can be adopted
     together they are a combination, not alternatives. State the strengths of what was rejected —
     an ADR listing only weak alternatives reads as justification written afterwards.
     If staying as-is was a real option, list it as one.
     With three or more alternatives, or three or more axes, use a comparison table; with a table,
     drop the per-alternative subsections. -->

### ALT-001 — <name>

<Strengths and weaknesses.>

### ALT-002 — <name> (chosen)

<Strengths and weaknesses.>

**Why this one:** <what the table or the list does not show — why this axis was worth the loss on that one.>

## Consequences

<!-- What is gained, and **the limits accepted**. The second is the point of this document, and the
     checker rejects an ADR with none — a decision without a cost is not a decision. "It might"
     is not a cost. No owning team, no schedule: project management belongs in the issue and goes
     stale first. -->

- What this buys: <what>
- What it costs: <what>

## Review and revisit

<!-- What `confirms:` points at, and what would reopen the decision. Link only things that exist.
     Do not keep a list of documents that contradict this decision here — that list is a chore that
     has to be deleted once each is fixed, which brings the synchronisation burden back. It belongs
     on the implementation issue's checklist. -->

- **Confirms:** <what, once verified, means the decision is held — which test is the source of truth.>

### RV-001 — <the condition that reopens it>

<!-- A condition that is true or false, not a date. «Revisit in six months» is not a condition.
     `/create-finding` can wake this ID from an operational signal. -->

<When this becomes true, the decision is reopened.>

- **Links:** <implementation issue URL · an executable source of truth (contract, schema, test) · related ADRs>
