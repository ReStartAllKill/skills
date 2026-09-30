# Architecture decision records (ADRs)

An ADR is the fifth SDLC artifact and the only one intended to outlive a change. After merge, code replaces intent, spec, and plan as the source of truth for what the system does. Code does not preserve why a choice was made, which alternatives were rejected, or which assumptions supported it.

| Question | Source of truth |
|---|---|
| Why was this chosen, and what was rejected? | **ADR** |
| How does it work now: fields, formulas, signatures? | Code, schema, and tests |
| Which observable behavior constitutes success? | Spec |
| Who implements it, and when? | Plan tasks and issues |

Quote only what is necessary to understand the decision. Exact field lists and regression fixtures belong in code.

## What qualifies as an ADR

**Prerequisite:** there was a real, reasonable alternative. With no choice, the statement is a fact and belongs in the spec.

Given that prerequisite, create an ADR when at least one condition applies:

- Reversal is expensive, as with a deployed contract, migrated schema, or public commitment.
- The choice changes a system boundary or the meaning of data.
- It affects an external contract or a security, regulatory, accounting, or audit boundary.
- It constrains multiple teams or repositories.
- It will continue to restrict future implementation choices.

If only the prerequisite applies, record the choice as a plan `TD-*` or in the PR. Neither the number of alternatives nor the number of decision factors determines whether an ADR is needed.

Too many trivial ADRs bury the useful signal. Conversely, a decision recorded only in a diagram, wiki, or meeting note lives outside the checker and can be reversed without the artifact system noticing.

## Files and numbering

Use `<adr_dir>/ADR-{NNN}-{kebab-slug}.md`. `NNN` has three digits, increases monotonically within the repository, and is **never reused**, including after rejection or deprecation. This keeps `ADR-007` permanently unambiguous.

Generate the index with `adr-index.mjs`; never edit it manually.

## Frontmatter

```yaml
---
artifact: adr
schema_version: 5
id: "ADR-005"
title: "RwaVault initial issue price — settlement asset and shares at 1:1"
status: draft
scope: ["src/vault", "packages/db/schema"]
supersedes: null
superseded_by: null
approved_by: null
generated_by: "<model or person>"
confirms: ["test_FirstEpochUsesGenesisPricing"]
revisit: ["RV-001"]
---
```

- `scope` lists repository-relative code paths constrained by the decision. Agent injection and drift checks both depend on it; an empty scope disconnects the ADR from implementation. A path that no longer exists warns whether or not `confirms` is set.
- `confirms` is the source of truth for verifying that the decision still holds. Use test names or gate commands; the checker looks for each name within `scope`.
- `revisit` lists the `RV-*` entries in Review and revisit.
- `applies_to` lists the repositories a decision constrains when its code lives in another repository — `applies_to: ["rwa-contracts"]`. That repository holds the paths and tests in its own bindings; see «Decisions in another repository». Repository names compare by final path component.

## Five required sections

| Section | When | Contents |
|---|---|---|
| Decision | Always | A direct declarative decision and `### Non-goals` |
| Context and forces | Always | The problem or risk and the **shared axes** used to compare alternatives |
| Alternatives | Always | Mutually exclusive `ALT-*` choices, exactly one marked `(chosen)` |
| Consequences | Always | Benefits and **constraints consciously accepted** |
| Review and revisit | Required when `accepted` | What `confirms` points to, `RV-*` conditions, and links |

Delete an optional section instead of writing “none,” but never remove these five. The checker treats “and” variants in localized section titles as equivalent.

Keep one decision per ADR. Split choices that can be reversed independently. A small naming change needed to explain the chosen option may remain in the Decision section.

The checker rejects a Consequences section with no accepted constraint. A decision without a cost is post-hoc justification. Describe the strengths of rejected alternatives honestly for the same reason.

### Two valid alternative formats

```markdown
### ALT-001 — Let an administrator configure the issue price
### ALT-002 — Fix settlement assets and shares at 1:1 (chosen)
```

```markdown
| Evaluation axis | Administrator setting | Fixed 1:1 (chosen) | Pass a ratio to settlement |
|---|---|---|---|
| Persistence of errors | Input errors persist | No configuration error | Call-site errors remain possible |
```

Prefer a table when there are at least three alternatives or three axes. Empty cells reveal unexamined axes and discourage judging alternatives by different standards. With a table, omit per-alternative detail sections and add only two or three lines explaining why the chosen option won.

The checker only needs the alternative count and chosen option. It reads headings when any exist; otherwise it reads the table header and ignores the first, axis-name cell. Do not mix formats, because headings become authoritative and the alternatives appear twice.

When a research document already compared the options, each `ALT-*` cites it — `basis: RSH-2026-003/OPT-002` — instead of restating the comparison, and the checker resolves the citation.

### Legacy documents without frontmatter

The checker allows pre-contract ADRs based on filename and number and emits a note. Rejecting all legacy files would prevent adoption until migration was complete. This follows the same compatibility rule that reads unversioned artifact sets as v1.

Until frontmatter is added, however, the approval guard cannot protect the decision and pinned artifact sets cannot verify its status. Add frontmatter first when migrating.

## ID prefixes

| Prefix | Meaning | Defined in |
|---|---|---|
| `ALT-*` | Alternative | Alternatives |
| `ASM-*` | Assumption | Context and forces; same meaning as an intent assumption |
| `RV-*` | Revisit condition | Review and revisit |

Pair every `ASM-*` with an `RV-*` that detects when the assumption becomes false. Write `RV-*` as a condition with a truth value, not a calendar reminder; “review in six months” is not a condition.

## Status and immutability

Use the standard artifact statuses rather than ADR conventions such as `proposed`, because `guard-approval.sh` and the checker must recognize a status to enforce transitions.

```text
draft → in_review ──┬─→ accepted ──┬─→ deprecated
                    │              └─→ superseded (`superseded_by` required)
                    └─→ rejected
```

- `draft`, `in_review`: editable and not yet safe for code to depend on.
- `accepted`: effective. Do not change its conclusion in place; only fix typos and links. A changed conclusion requires a new ADR and moves this one to `superseded`.
- `deprecated`: no longer applicable and has no replacement, usually because its feature was removed. Keep it as history. The `accepted → deprecated` transition requires approval because it removes an effective constraint.
- `superseded`: replaced by the ADR named in `superseded_by`.
- `rejected`: reviewed but not adopted. Keep its number and reasoning so a reopened discussion can see why it was declined.

`guard-approval.sh` blocks substantive edits to accepted ADRs. Their immutability is what makes the collection trustworthy.

## Pinning decisions from an artifact set

List decisions in the intent, spec, and plan frontmatter, just as `spec_version` pins an upstream document to a commit SHA.

```yaml
decisions: ["ADR-005", "acme/docs#ADR-007@a1b2c3d"]
```

- Use only the ID for a same-repository ADR; use `<owner>/<repo>#ADR-NNN@<sha>` across repositories.
- When a change encounters a hard-to-reverse choice, do not decide it inside the artifact set. Pin an existing ADR or create the ADR first. A diagram, wiki, or meeting note cannot serve as the checked source of truth.
- The checker verifies each pinned ADR's existence and status. Referencing a `superseded`, `deprecated`, or `rejected` ADR is an error.
- The checker also reads the other direction: a plan task whose `files` fall inside an accepted ADR's `scope` must have that ADR pinned somewhere in the set, or it warns. Agent injection reaches the writer, but design decisions (`TD-*`) are settled in the plan before any task runs, and the pin is the only evidence the plan saw the decision — and the only handle the status check has. Design within the decision and pin it; design against it and write the superseding ADR first, never a `TD-*`.

## Decisions in another repository

When decisions live in a document repository (`adr_repo`), the link from a decision to code is cut in two, and each half belongs to the repository that can check it.

- **The ADR names repositories.** `applies_to: ["rwa-contracts"]`, with `scope` and `confirms` empty. A path in another repository cannot be verified where the ADR lives, and the person who renames it works elsewhere.
- **The code repository names paths and tests,** in `.claude/adr-bindings.yml`:

```yaml
source: "acme/docs"
bindings:
  ADR-012:
    at: "a1b2c3d4e5f6"        # the upstream commit that last changed the ADR, when it was read
    paths: ["src/vault", "src/nav"]
    confirms: ["test_Deposit_MintsAtCurrentPrice"]
  ADR-001:
    at: "9f8e7d6c5b4a"
    paths: []
    reason: "pricing lives in the backend; nothing here computes it"
```

- **The decision text arrives as a manifest.** `node <sdlc_runtime>/tools/pull-adr.mjs [--from <checkout>]` writes `.claude/adr-manifest.json` — status, `applies_to` and the digest `task-brief` injects, never a path — with an integrity hash. Commit it; never edit it. It prints a binding skeleton for every accepted decision that applies here and has none.

`adr-bindings.mjs`, which `check-all` runs when the profile has `adr_repo`, checks in the code repository:

| Condition | Level |
|---|---|
| No manifest | warn — pins, task scope and injection are all off |
| Manifest edited by hand, or from another source | error |
| Accepted decision whose `applies_to` names this repository, with no binding | warn |
| Binding to a decision not in the manifest, or to one no longer in force | error |
| `at` missing, or behind the decision's current commit | error — re-read it, then raise `at` |
| `paths` missing, or `paths: []` without `reason` | error |
| A path that no longer exists, a `confirms` name not found under `paths`, empty `confirms` | warn |
| Upstream checkout (`SDLC_UPSTREAM`, `--from`) shows the manifest is behind | error; without a checkout, a note |

The plan's task-scope check and `task-brief` match plan `files` against binding `paths`, so a rename is fixed in the PR that makes it. A pin into the manifest's repository is checked against the manifest, so `acme/docs#ADR-009@…` for a decision that does not exist is an error rather than a SHA-shape check.

An ADR is always schema 5, so no version can mark where the new form begins; `applies_to` does. An ADR that has `applies_to` and still names another repository's path in `scope` is an error — the same link held twice, and the upstream copy is the one nothing checks. An ADR without `applies_to` that names one is a warning: it was valid when written, and it stays readable. `pull-adr` treats the repositories such an entry names as its `applies_to` and carries its paths and `confirms` into the skeleton, so a code repository can bind before the document repository migrates.

## Profile seam

```yaml
adr_dir: "docs/adr"              # Omit when this repository has no ADRs
adr_repo: "acme/docs"            # Optional; decisions live in another repository
adr_index: "docs/adr/index.md"   # Default: <adr_dir>/index.md
adr_manifest: ".claude/adr-manifest.json"  # Default when adr_repo is set without adr_dir
adr_bindings: ".claude/adr-bindings.yml"   # Default when adr_repo is set
```

## Agent injection

When a task's `files` overlap an ADR's `scope` — or, for a decision in another repository, its binding's `paths` — `task-brief.mjs` injects the ADR's **decision, Non-goals, and rejected-alternative titles** into the writer prompt and supplies only a link to the full text.

This injection is how an ADR reaches implementation. Without it, an agent can apply a default that contradicts the decision or reopen a settled debate. An ADR with an empty `scope` is therefore only decoration.
