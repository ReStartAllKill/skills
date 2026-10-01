---
artifact: intent
id: "CHG-2026-031"
title: "Keep archived documents out of search"
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

# Intent: Keep archived documents out of search

## Problem `[required · all tiers]`

Operators keep meeting documents they already archived. They filter the results by eye, which costs them a second pass over every search, and the screen never says a result was archived.

## Outcomes `[required · all tiers]`

### OUT-001 — A default search returns no archived document `Must`

An operator searches and only unarchived documents stand in the results.

check: index one archived and one plain document, search a word that matches both, and see that only the plain one comes back.

### OUT-002 — Archived documents remain reachable on request `Should`

Turning on archive inclusion returns both.

check: send the same query with the flag on.

## Non-goals `[required · all tiers]`

- The archiving policy itself stays as it is.
- Read permission on archived documents stays as it is.

## Constraints `[required · all tiers]`

### CON-001 — The search API response shape does not change

Other consumers already read it. A change to the shape breaks them without a sound.

## Open questions `[required · all tiers]`

N/A — the archive field is already indexed, so only the behaviour needs settling.
