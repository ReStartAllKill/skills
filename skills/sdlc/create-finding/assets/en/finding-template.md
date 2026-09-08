---
artifact: finding
schema_version: 4
id: "FND-YYYY-NNN"
title: "<what was observed, in one sentence>"
status: draft # draft | in_review(being triaged) | accepted(route settled) | rejected | superseded
tier: light # light by default — this document gets written where nobody is watching
owner: "<the service owner or whoever is on call>"
created: YYYY-MM-DD
updated: YYYY-MM-DD
detected_at: "YYYY-MM-DDTHH:MM:SSZ" # when the signal fired, not when it was noticed
trigger: band_breach # band_breach | scheduled_scan | ticket | channel | manual
band: null # required when trigger is band_breach — the band id in .claude/bands.yml
autonomy_tier: diagnose # log | diagnose | propose — what this trigger **permitted**
routed_to: null # required once accepted: "patch:<PR>" | "intent:<path>" | "dismiss:<reason>"
                # the intent path is **relative to this file's folder**, while the intent's own
                # from_finding is relative to its folder. Both are «relative to my own folder».
                # e.g. "intent:../../2026-09-04-search-exclude-archived/intent.md"
superseded_by: null
generated_by: null
generated_from: null
skills_in_force: []
---

# Finding: <title>

<!-- Three ways out: patch, intent, dismiss. How to fix it is not settled here. Keep §Observations
     (what was measured) apart from §Diagnosis (what is guessed). -->

## Summary `[required · all tiers]`

<What, when, where. Three sentences at most.>

## Trigger `[required · all tiers]`

<!-- Who or what started this. -->

trigger: <band_breach / scheduled_scan / ticket / channel / manual> — <the detector, scan, ticket or thread>
band: <the same id as `band` in the frontmatter> — <the registry's metric, window and rule>
autonomy tier: <log / diagnose / propose>
what it permitted: <concretely — read-only tools / up to opening a PR / up to calling runbook <name>>

## Observations `[required · all tiers]`

<!-- Only what was measured. Reproduce with a query or a command. What was not measured is «unmeasured». -->

### EV-001 — <what was measured>

<measured value> vs <baseline or band>
reproduce: `<query or command>`
at: <ISO>

### EV-002 — <another signal that moved with it>

<measured value> vs <baseline or band>
reproduce: `<query or command>`
at: <ISO>

## Diagnosis `[required · all tiers]`

<!-- The model's reading. A hypothesis points at EV ids and carries a way to disprove it. -->

### HYP-001 — <a reading of the cause>

basis: EV-001, EV-002
confidence: <high/medium/low> · state: <under review/confirmed/rejected>

disproved by: <what, if true, would mean this was not it>

### Not looked at

<!-- What has no record was not looked at. -->

- <e.g. application logs for the 30 minutes around the deploy were past retention and could not be read.>

## Actions taken `[required · all tiers]`

<!-- What was actually done, and what was not. The second matters more in an audit. -->

- <ISO> <action> — permitted by: autonomy tier <value> · result: <what it revealed>

### Not done

- <e.g. no revert PR was opened — the autonomy tier is diagnose, so the propose path is closed.>

## Route `[required · all tiers]`

<!-- Choose by size. When unsure, intent. When dismissing, say whether the band moves. -->

route: <patch / intent / dismiss>
basis: HYP-001
next artifact: <PR link / intent.md path (starting tier light|standard|full) / what the band adjustment is>

If dismissed — band adjustment: <what changes how, or «no adjustment — <basis>»> · fires again when: <what would be different then>

<!-- If the band moved, record it under `revised:` in bands.yml too — the checker reads both directions. -->

## Preventing a repeat `[required · all tiers]`

<!-- An eval case, a test, a hook or a band adjustment for this class. Needed on the patch route too. -->

- class: <the defect class this belongs to> → <eval case / test / hook / band adjustment> · <path> · <when>

## Open questions `[required · all tiers]`

<!-- A question that stops the route from being settled is `blocked`. If none, write `N/A — <basis>`. -->

### FQ-001 — <the question that decides the route>

impact: <blocked/high/low> · owner: <name> · state: Open

## Impact `[required · standard+]`

- <user group or system> — <what did not work> · scale <count or share> · <start to recovery> · basis EV-001

## Timeline `[required · standard+]`

- <ISO> <band breach> — <detector log>
- <ISO> <diagnosis started> — <run record>
- <ISO> <route settled> — <the commit of this document>

## Triage and history `[required · standard+]`

- <role> <name> — <fix now / schedule it / dismiss>, YYYY-MM-DD. <comment>

### History

- YYYY-MM-DD <name or Agent> — generated. <trigger>
