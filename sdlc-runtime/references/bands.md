# Detection bands

When a `finding.md` begins with `band_breach`, the registry, rather than the model, must define the normal range.
The source of truth is the profile's `bands` path, which defaults to `.claude/bands.yml`.

## Format

```yaml
version: 1
bands:
  ci_test_failure_rate:
    metric: "CI test failure rate"
    source: "gh run list --limit 200 --json conclusion"
    window: "rolling_30d"
    rule: "western_electric 3σ"
    autonomy_tier: diagnose
    owner: "Platform team"
    revised:
      - "2026-09-04 FND-2026-001 — 3σ → 4σ · normal variation during deployment window"
```

Every band requires `metric`, `source`, `window`, `rule`, `autonomy_tier`, and `owner`. `source` must be a reproducible command, not a sentence.

## Linking a finding

- A finding with `trigger: band_breach` must name a `band` that exists in the registry.
- The finding's `autonomy_tier` must match the registry value.
- When changing a band, record the date, finding ID, and reason under `revised:`.
- When leaving it unchanged, write `band adjustment: none — <basis>` in the finding's Route decision section.

```sh
node <sdlc_runtime>/tools/bands.mjs <repo-root>
```
