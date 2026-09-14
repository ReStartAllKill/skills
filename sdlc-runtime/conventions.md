# Artifact Conventions

*[한국어](conventions.ko.md)*

This is the shared contract for SDLC artifacts. Skills define the authoring process; this
document defines valid output. `check-artifacts.mjs` is authoritative for machine validation.
If the two diverge, update both.

Read conditional details only when needed.

- Repository initialization and profiles: `references/profile.md`
- Prose style and character budgets: `references/prose.md`
- Task format and completion evidence: `references/tasks.md`
- Schema versions and upstream pins: `references/schema.md`
- Changes spanning multiple repositories: `references/multi-repo.md`
- Detection bands: `references/bands.md`
- Hooks, CI, and vendored runtime: `sdlc-runtime/references/runtime.md`
- Autonomous execution policy: `references/autonomy.md`

## Authority and lifetime

Each artifact set is a contract for **this change**, not the truth of the whole system. If
approved external behavior conflicts with existing code during implementation, do not discard
the spec: report the conflict, update the spec with `/iterate-spec`, and continue.

After merge, the code and PR body are authoritative for the current implementation. Do not
reference artifact paths from code or comments.

**The ADR is the sole exception.** Code is authoritative for *what*, not *why*. A hard-to-reverse
decision is a constraint the system keeps carrying, so it is recorded under `<adr_dir>`, outside
the artifact set, and referenced from the set through `decisions:`. See `references/adr.md`.

## Artifact workflow and document boundaries

```text
finding ──┬─ patch
          ├─ dismiss
          └─ intent → spec → plan → code/test/PR/deploy → finding
                ↑      approve  approve   ↑
                └────── ADR ──────────────┘
                   outlives the change

research ── cited by ──▶ intent · ADR
```

| File | Core question | Must not contain |
|---|---|---|
| `finding.md` | What was observed, and where does it go? | How to fix it |
| `research.md` | What was compared, on which criteria, from which sources? | A decision — that belongs in the ADR or intent |
| `intent.md` | Why is this needed, and what must change? | APIs, frameworks, data models, files, ordering |
| `spec.md` | What observable behavior satisfies it? | Internal classes, functions, files, libraries, ordering |
| `plan.md` | How will it be built and delivered safely? | Copies of the problem statement or requirements |
| `ADR-NNN-*.md` | Why was this chosen, and what was rejected? | Current implementation details, owners, schedules |

`plan.md` contains both design and tasks; `/implement-spec` uses this one file as its input.
`finding.md` and `research.md` are inputs rather than members of a set: a finding starts one set,
and a research document precedes the intent and is cited by several documents.

There are two ways in. A person starts with an intent and approves each document; a machine
signal starts with a finding and a predeclared policy approves up to `advance_to`, after which the
set stops in `in_review`. See `references/autonomy.md`.

### Authors and completion owners

| Document | Starts | Completes | `approved_by` |
|---|---|---|---|
| `intent.md` | Initiator (planning/product) | Initiator | Product owner |
| `spec.md` | Initiator — SCN scenarios, FR behavior statements, priority | Engineer — precise ACs, EDGE, NFR, interface contracts, data (`/iterate-spec`) | Engineering lead. Both initiator and engineer review the PR |
| `plan.md` | Engineer | Engineer | Engineering lead |

An initiator-only spec stops at “works correctly”; an engineer-only spec loses the user flows.
The initiator must not invent unknown details: leave them as `SQ-*` items and hand the document
over in `in_review`.

### Changes spanning multiple repositories

Write one spec per system, never one per repository, and say which repository implements each
acceptance criterion: `scope:` on the requirement, or `` `scope: <repo>` `` at the end of the
criterion line. Ownership, the upstream lock, coverage, and where ADRs live are in
`references/multi-repo.md`.

## Artifact syntax

Write items as headings, not table rows: the prose a person reads is the structure the checker
reads. Tables are for genuinely two-dimensional material such as alternative, state-transition,
and metric comparisons.

- Definition: `### <ID> — <title>`; priority is `` `Must|Should|Could|Won't` ``.
- Field: one `key: value` line, such as `basis:`, `verification:`, or `covers:`.
- Acceptance criterion: `- [ ] AC-001 — <when>, the system <does what>`.
- Task: a checkbox followed by five indented fields.
- Examples inside code fences do not count as definitions.
- Remove template comments and placeholders from artifacts.

Every string the checker recognizes lives in `tools/keywords.mjs`: English is authoritative,
Korean is an alias, and both are always accepted regardless of the profile's `lang`.
**Section titles are not contract** — structure comes from ID prefixes and tier markers — except
the plan's execution-log and release-impact sections and the ADR's five sections, which are
matched by title and accept aliases.

## Tiers

Set the tier once in `intent.md`; `spec.md` and `plan.md` inherit it.

| Tier | Criteria |
|---|---|
| `light` | No external contract or data changes, and an immediate rollback is available through revert or a flag |
| `standard` | Default. User-visible behavior, performance, or error handling changes |
| `full` | Includes migrations, public contracts, personal data, regulatory concerns, security boundaries, or a large rollout |

When uncertain, choose the higher tier. If the plan reveals greater risk, raise the tier starting
from the intent. `finding.md` is an input to the workflow, so it does not inherit a tier; assign
one from the finding's own impact.

A `##` heading with no marker is required at every tier; an unmarked `###` heading is not checked.
Markers narrow that.

| Section marker | Meaning |
|---|---|
| `[required · standard+]` | Required for standard and full |
| `[required · full]` | Required for full |
| `[conditional · <condition>]` | Required when the condition holds; otherwise write `N/A — <basis>` |
| `[optional]` | Use only when helpful |

## ID prefixes

| Prefix | Meaning | Defined in |
|---|---|---|
| `OUT-*` | Intended outcome | intent §Outcomes |
| `CON-*` | Constraint or invariant | intent §Constraints |
| `ASM-*` | Assumption | intent §Assumptions |
| `Q-*` | Open question | intent §Open questions |
| `SCN-*` | Scenario | spec §Scenarios |
| `FR-*` | Functional requirement | spec §Requirements |
| `NFR-*` | Non-functional requirement | spec §Non-functional requirements |
| `AC-*` | Acceptance criterion | Checkbox under an FR/NFR |
| `EDGE-*` | Error or boundary condition | spec §Errors and boundaries |
| `SQ-*`, `SD-*` | Open question, specification decision | spec §Open questions and decisions |
| `TD-*` | Design decision | plan §Design decisions |
| `WP-*` | Work package | plan §Work |
| `RISK-*` | Risk | plan §Risks |
| `PQ-*` | Open question | plan §Open questions |
| `EV-*` | Observation | finding §Observations |
| `HYP-*` | Hypothesis | finding §Diagnosis |
| `FQ-*` | Open question | finding §Open questions |
| `ALT-*` | Alternative | ADR §Alternatives |
| `RV-*` | Revisit condition | ADR §Confirmation and revisit |
| `ASM-*` | Assumption | ADR §Context and decision drivers (same meaning as an intent assumption) |
| `CRIT-*` | Comparison criterion | research §Criteria |
| `SRC-*` | Source | research §Sources |
| `OPT-*` | Option | research §Options |
| `REC-*` | Judgement | research §Judgement |
| `RQ-*` | Open question | research §Open questions |

Question prefixes identify who must answer. `Q` belongs to the product owner, `SQ` to the spec
reviewer, `PQ` to the implementation owner, `FQ` to the service owner or on-call engineer, and
`RQ` to the research owner.
Never reuse an ID, even after deleting its item.

## States and approval

```text
draft → in_review → accepted ─────────→ superseded
                  ↘ rejected

plan only: accepted → in_progress → completed
```

Finding states have different meanings.

| Value | intent, spec, plan | finding |
|---|---|---|
| `in_review` | Under review | Being triaged |
| `accepted` | Approved as input to the next stage | Route decided (`routed_to` required) |
| `rejected` | Will not proceed | Dismissed (`routed_to: dismiss:…` required) |

- A downstream document cannot advance beyond its upstream document.
- A document with a blocking Open question cannot become `accepted`.
- When meaning changes, return that document and affected downstream documents to `in_review`.
  Typographical fixes preserve state.
- `superseded_by` is required when the state is `superseded`.

A downstream document pins its upstream with `intent_version` or `spec_version`, written as
`body:<hex>` — the value `node <sdlc_runtime>/tools/pin.mjs <file>` prints for the upstream
document. A frontmatter-only edit such as an approval leaves the pin valid; a body edit breaks it.
When `upstream.lock.json` exists the lock's upstream commit governs instead; see
`references/multi-repo.md`.

A research document has its own states, `draft → in_review → reviewed`; `reviewed` means a person
read it, not that anything was approved. Other documents cite it inline as `RSH-2026-003` or
`RSH-2026-003/SRC-002` (also `/OPT-`, `/REC-`) anywhere in the text of an intent, spec, plan,
finding, or ADR. The checker resolves both the document and the item, and a dangling citation is
an error. No frontmatter key is needed.

### A person approves

- An intent, spec, or plan at `accepted` or later requires `approved_by`, which must differ from
  `generated_by`. The guard refuses an approval by the writer before any dialog.
- An approval transition goes through the **approval dialog**: when an agent attempts the
  approval edit, the guard returns `ask` and the person approves or rejects there, without typing
  a command. Interactive sessions show the dialog regardless of permission mode; non-interactive
  `-p` sessions reject the transition.
- Under an autonomy route the approver is `policy:<route-id>`, and a document beyond the
  delegation stays in `in_review` with `approved_by` empty. Human sessions cannot use `policy:`.
  `references/autonomy.md` has the rules.
- A finding's `accepted` means its route was decided, not that it was approved, so it does not
  require `approved_by`.
- A research document is never approved, because it is evidence rather than a decision.
  `reviewed_by` records who read it; the decision it serves is approved in the ADR or intent.

## Shared invariants

- One document contains one change intent.
- Do not leave required sections empty. When none applies, write `N/A — <basis>`.
- Refer to upstream content by ID and relative link instead of copying it.
- Distinguish verified facts, decisions, and assumptions.
- Keep implementation methods out of intent and spec; do not copy requirement text into the plan.
- Investigate questions the code can answer. Ask only for judgments a person must make.
- Close open questions with decision IDs.
- When an agent writes the document, populate `generated_by`; `generated_from` and
  `skills_in_force` are optional.

## Paths and validation

```text
<spec_dir>/
├── findings/FND-YYYY-NNN-<slug>/finding.md
├── research/RSH-YYYY-NNN-<slug>/research.md
└── YYYY-MM-DD-<slug>/
    ├── intent.md              # vendored copy when upstream exists
    ├── spec.md                # vendored copy when upstream exists
    ├── upstream.lock.json     # only with upstream; created by pull-spec.mjs
    └── plan.md
```

Each relative path between a finding and an intent is resolved from the directory of **its own
document**, and the checker verifies that both point at the same file.

| Key | Document | Relative to | Example |
|---|---|---|---|
| `routed_to` | `finding.md` | Finding directory | `intent:../../2026-09-04-search/intent.md` |
| `from_finding` | `intent.md` | Intent directory | `../findings/FND-2026-007-ci/finding.md` |

```sh
node <sdlc_runtime>/tools/check-set.mjs <artifact-directory> [--strict]
```

This runs the checker and the linter over one directory and prints one report;
`check-artifacts.mjs` is the authority where they disagree, and either can be run alone with the
same arguments. Fix errors and run again; evaluate warnings and report why any remain.

## Shared skill procedure

`/create-finding`, `/create-research`, `/create-intent`, `/create-spec`, `/create-plan`,
`/create-light`, and `/create-adr` follow this procedure; each skill body contains only what is
unique to its stage. `/create-research` always takes `schema_version: 7`, skips step 6's approval
edit, and ends at `in_review`; a person sets `reviewed` after reading it.

Start:

1. Read `.claude/spec-profile.yml`. If it is missing, run `/sdlc-init` first; do not invent a
   profile. When `sdlc_runtime` is absent, follow the discovery order in `references/runtime.md`.
   **The artifact language is the profile's `lang`** (default `ko`), never the conversation's —
   use that language's template and say so in one line when the two differ.
2. Read this document. Read `references/prose.md` only when a reported lint rule needs
   interpretation or a `full`-tier budget must be planned; `check-set.mjs` enforces the same rules
   and names the one that fired. Read another reference only when the skill directs you to it.
   Do not read runtime tool source; run the checker to learn what it reports.
3. For the first document in a set (finding or intent), take `schema_version` from the profile's
   `sdlc_version`; a downstream document inherits it from its upstream. Preserve the set's version
   even when it differs from the profile, and report the difference.
4. Remove template comments and placeholders while preserving heading levels. Populate
   `generated_by`.

Finish:

5. Run `check-set.mjs` directly, once, and report its result unchanged. Do not omit this step,
   because hooks can silently be disabled.
6. After validation passes, save with `status: in_review`, report a summary (path, tier, validation
   result, and remaining questions), and **immediately attempt the approval edit**: `status:
   accepted` and `approved_by` in one edit. The guard turns that edit into the approval dialog, so
   do not ask “Approve?” in the conversation first. If rejected, leave the document unchanged and
   ask why. Do not attempt approval while a blocking question remains open.
   - A light set with `approval_mode: batch_light` follows `/create-light`'s digest-bound batch procedure instead of three edits.
   - `approved_by` is the profile's `owner`, or `git config user.name` when no owner exists. It
     must be a person's name and differ from `generated_by`; if neither value exists, ask once.
   - A finding is routed rather than approved: populate `routed_to` and `status` instead.
   - An ADR is outside the artifact set, always has `schema_version: 5`, and has no upstream
     document. The rest of the procedure is the same.
7. After approval, commit. Do not run the tools again: the only rule an approval edit can break is
   refused by the guard before the write, and `check-all` in CI re-reads every set.

Under an autonomy route (`SDLC_AUTONOMY_ROUTE` is set), also follow `references/autonomy.md`
“What the writing skills do under a route”.


## Light-set approval and recovery

A repository with `approval_mode: batch_light` can review and approve a v7+ light set together.
`approve-set.mjs --prepare` shows the exact before/after documents and digest; its matching
`--apply` receives one approval dialog. Changes to documents, profile, or approver invalidate
the digest. Other tiers and profiles retain document-by-document approval.

Use `plan-resume.mjs <set>` after an interruption. A scoped passing integration check advances
the next level without checking the task off; only final full verification permits completion.
Failed and partial attempts also leave the task unchecked.
