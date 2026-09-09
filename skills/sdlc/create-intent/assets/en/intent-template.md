---
artifact: intent
schema_version: 4
id: "CHG-YYYY-NNN"
title: "<the change you intend, in one sentence>"
status: draft # draft | in_review | accepted | rejected | superseded
tier: standard # light | standard | full — this sets the weight of the entire artifact set
owner: "<the person or team who decides>"
created: YYYY-MM-DD
updated: YYYY-MM-DD
superseded_by: null # required once status is superseded
from_finding: null # path to the finding.md this came from — **relative to this file's folder**
                   # e.g. "../findings/FND-2026-007-ci-failure-rate/finding.md"
approved_by: null # required from status accepted on — the **person** who approved. Cannot equal generated_by
generated_by: null # e.g. "claude-opus-5" — fill in when an agent wrote this
generated_from: null # the prompt or slash command of that session
skills_in_force: [] # e.g. ["brand@a3f2c1"]
---

# Intent: <title>

<!-- Written for the product owner and the person proposing the change. If a way to build it
     appears here, it belongs in the spec or the plan. -->

## Problem `[required · all tiers]`

<!-- The problem, not the solution. Keep observation separate from reading. Two to four sentences. -->

<Today [who] hits [problem] under [circumstance]. It costs [what].>

### Evidence `[required · standard+]`

- <e.g. support tickets — 42 of the same kind in the last 30 days. [dashboard link]>

## Outcomes `[required · all tiers]`

<!-- Observable results. Every Must has to be covered by a requirement in the spec. -->

### OUT-001 — <one line> `Must`

<What becomes possible.>

check: <how it is observed or measured.>

### OUT-002 — <one line> `Should`

<What becomes possible.>

check: <how it is observed or measured.>

## Non-goals `[required · all tiers]`

- <e.g. reworking the admin screens is not part of this.>

## Constraints `[required · all tiers]`

<!-- Boundaries to hold. Do not prescribe an implementation. If none, write `N/A — <basis>`. -->

### CON-001 — <one line>

<What must hold. Why. What happens if it does not.>

## Open questions `[required · all tiers]`

<!-- An Open question marked `blocked` keeps this out of accepted. If none, write `N/A — <basis>`. -->

### Q-001 — <what has to be decided or confirmed>

impact: <blocked / high / low>
owner: <name>
state: Open

## Reach and measures `[required · standard+]`

<!-- If a baseline is unknown, write «unmeasured» and how it will be measured. Never 0, never blank. -->

Affected: <user group · internal operations · connected systems>

- Success — <measure>: <now> → <target> (<over what period>, <source>)
- Guard — <measure>: <now>, must stay inside <band> (<source>)

## Assumptions `[required · standard+]`

### ASM-001 — <what is taken as given>

verify: <how it gets checked> · if wrong: <what changes> · owner/by: <name / date>

## Alternatives rejected `[required · full]`

- <option> — <expected effect> / rejected because: <reason>

## Approvals and history `[required · standard+]`

- <role> <name> — <approved/conditional/rejected>, YYYY-MM-DD. <comment>

### History

- YYYY-MM-DD <name> — first draft. <background>
