---
artifact: research
schema_version: 7
id: "RSH-YYYY-NNN"
title: "<a title that says what was compared with what>"
status: draft # draft | in_review(asking to be read) | reviewed(a person read it)
question: "<the decision this serves, in one line — what was being decided>"
owner: "<whoever carries this investigation>"
supersedes: null # the id of the older research on the same question, when there is one
reviewed_by: null # who read it. Not an approval — research has no approved_by and no tier
generated_by: null
---

# Research: <title>

<!-- Evidence, not a decision. What gets chosen belongs in the ADR or intent that cites this.
     The question and the criteria are written **before** the search: criteria written after the
     sources are criteria fitted to a conclusion. Research goes stale, so every source carries the
     date it was read. Delete every guide comment and <> placeholder before submitting. -->

## Question

<!-- The decision this serves, and which scope was actually available — the web, this repository,
     code only. A scope that is not stated is read as «everything was searched». -->

<What was being decided. What scope was available to read.>

## Criteria

<!-- Written before the search. A criterion is something a source can settle, not a preference.
     Every criterion becomes a row of the comparison table. -->

### CRIT-001 — <what it is measured by>

<Why a split on this criterion splits the decision.>

## Sources

<!-- Recorded the moment it is read. `at:` is a URL or a repository path, `retrieved:` the date it
     was read. One to three sentences of what the source actually says, not what it is hoped to
     say. Prefer primary sources — docs, code, changelogs; a secondary source is fine if said to be one.
     What the source *showed* — an architecture or sequence diagram, a code excerpt, a benchmark
     output — goes under the sentences in a fenced block (```mermaid, ```text, ```<language>),
     redrawn or copied from the source, not invented. Fenced blocks count toward no budget and no
     prose check, so keep the material there and the sentences short. Measured values that compare
     across options go in a table under §Data, not here. -->

### SRC-001 — <what was read>

- at: <URL or repository path>
- retrieved: YYYY-MM-DD

<One to three sentences of what it actually says.>

```mermaid
<the diagram the source showed, when it showed one — otherwise delete this block>
```

### SRC-002 — <what was read>

- at: <URL or repository path>
- retrieved: YYYY-MM-DD

<One to three sentences of what it actually says.>

## Options

<!-- Two or more, each standing on the sources above. An option nobody sourced is an opinion.
     One option is not a comparison — if there was nothing to compare, this is a fact and it goes
     into the spec instead. -->

### OPT-001 — <the option>

- basis: SRC-001

<One or two sentences on what this option actually is. A fenced block below may show how it would
sit in this repository — a call shape, a config excerpt, a data flow — when a sentence cannot.>

### OPT-002 — <the option>

- basis: SRC-002

<One or two sentences on what this option actually is.>

## Data

<!-- Optional — delete the heading when nothing was measured. Numbers a source reported or this
     investigation measured, one table per measurement, with the thing measured in the first column
     and the SRC-* it came from in the header or a caption. Never an ID in the first column: that
     is an entity table and the linter rejects it. Raw output belongs in a fenced block under the
     SRC-* that produced it; this section holds the values that the comparison reads. -->

| <measured on> | OPT-001 <option> | OPT-002 <option> | source |
|---|---:|---:|---|
| <what was measured, with unit> | <value> | <value> | SRC-001 |

## Comparison

<!-- The one genuinely two-dimensional place in this document: criteria × options. Every CRIT is a
     row, every OPT a column. A cell nobody could settle is written «unknown — <what would settle
     it>», never left blank — a blank cell reads as «no difference». A cell states what was
     measured and cites its SRC-*; the figure it comes from is in §Data or under that source. -->

| Criterion | OPT-001 <option> | OPT-002 <option> |
|---|---|---|
| CRIT-001 — <what it is measured by> | <what was measured> (SRC-001) | <what was measured> (SRC-002) |

## Judgement

<!-- What the sources mean, in three labelled parts. Mixing them is how an assumption gets quoted
     later as a fact. -->

### REC-001 — <what the reading means>

- basis: OPT-001

Fact: <what the source says — SRC-001>. Inference: <what was drawn from it>. Assumption: <what was left unverified>.

<!-- Open questions: when any remain, add a `## Open questions` heading and one `### RQ-NNN` item
     per question, each saying what would settle it. When none remain, leave no heading — a
     standing `N/A` is a line written for the checker rather than for a reader. -->
