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
- Detection bands: `references/bands.md`
- Hooks, CI, and vendored runtime: `sdlc-runtime/references/runtime.md`
- Autonomous execution policy: `references/autonomy.md`

## Authority and lifetime

Each artifact set is a contract for **this change**, not the truth of the whole system. If
approved external behavior conflicts with existing code during implementation, do not discard
the spec. Report any conflict between a code constraint and the spec, update the spec with
`/iterate-spec`, and then continue.

After merge, the code and PR body are authoritative for the current implementation. Do not
reference artifact paths from code or comments.

**The ADR is the sole exception.** Code is authoritative for *what*, not *why*: a diff cannot
preserve rejected alternatives or the assumptions behind a decision. A hard-to-reverse decision
is a constraint the system continues to carry, not merely a contract for one change. Record it
in an ADR under `<adr_dir>`, outside the artifact set, and refer to it from the set through
`decisions:`. See `references/adr.md`.

## Two paths into the artifact workflow

There are two entry paths. They use the same documents, checker, and CI; only these three things
differ.

| | Human-led | Autonomous |
|---|---|---|
| Entry | Human intent | Machine signal — Sentry, band breach, scan |
| Approval | A person approves each document | A predeclared policy approves (`policy:<path>`) |
| Stop point | Each stage | Advance through `advance_to`, then stop at `in_review` |

**Approval does not disappear on the autonomous path; it moves.** Instead of approving every
document, a person approves in advance that a class of work may proceed autonomously to a given
point. That policy becomes a committed artifact. See `references/autonomy.md`.

## Artifact workflow and document boundaries

```text
finding ──┬─ patch
          ├─ dismiss
          └─ intent → spec → plan → code/test/PR/deploy → finding
                ↑      approve  approve   ↑
                └────── ADR ──────────────┘
                   outlives the change
```

| File | Core question | Must not contain |
|---|---|---|
| `finding.md` | What was observed, and where does it go? | How to fix it |
| `intent.md` | Why is this needed, and what must change? | APIs, frameworks, data models, files, ordering |
| `spec.md` | What observable behavior satisfies it? | Internal classes, functions, files, libraries, ordering |
| `plan.md` | How will it be built and delivered safely? | Copies of the problem statement or requirements |
| `ADR-NNN-*.md` | Why was this chosen, and what was rejected? | Current implementation details, owners, schedules |

`plan.md` contains both design and tasks. Both answer *how*, and `/implement-spec` uses this one
file as its execution input.

### Authors and completion owners

| Document | Starts | Completes | `approved_by` |
|---|---|---|---|
| `intent.md` | Initiator (planning/product) | Initiator | Product owner |
| `spec.md` | Initiator — SCN scenarios, FR behavior statements, priority | Engineer — precise ACs, EDGE, NFR, interface contracts, data (`/iterate-spec`) | Engineering lead. Both initiator and engineer review the PR |
| `plan.md` | Engineer | Engineer | Engineering lead |

A spec is not completed by the initiator alone. If the initiator writes all of it, acceptance
criteria tend to stop at “works correctly.” If the engineer writes it from the beginning, user
flows and priorities tend to disappear. The initiator must not invent unknown details; leave them
as `SQ-*` items and hand the document over in `in_review`.

### Changes spanning multiple repositories

**Write one spec per system; do not split it by repository.** When one feature normally crosses
contracts, backend, and frontend, repository-specific specs repeat the same requirement. Once
those copies diverge, nobody can say which one is authoritative for behavior.

Instead, **state which repository implements each acceptance criterion.**

```markdown
### FR-003 — Write-down reduces the outstanding issuance `Must`

basis: OUT-002
scope: rwa-contracts, rwa-backend

Acceptance criteria:

- [ ] AC-007 — Once the write-down is confirmed, the on-chain balance decreases `scope: rwa-contracts`
- [ ] AC-008 — After confirmation, the query API returns the reduced balance `scope: rwa-backend`
```

Write `scope` either on the requirement's `scope:` line or as `` `scope: <repo>` `` at the end of
an acceptance-criterion line. A criterion without one inherits its parent requirement's scope.
Repository names are compared by their final path component, so `acme/api` and `api` name the same
repository. **This syntax is available from v6.** The checker rejects it in documents declaring
an older schema.

#### Ownership by repository

| Location | Owns | Profile |
|---|---|---|
| Document repository (upstream) | Authoritative `intent.md`, `spec.md`, and ADRs | `spec_consumers` |
| Code repository (consumer) | `plan.md`, vendored copies, `upstream.lock.json`, execution evidence | `upstream_repo`, `repo` |

The code repository always owns the plan and execution. It is where `/implement-spec` creates
worktrees and runs verification. If the plan is reviewed in a different PR from the code diff,
plan review has no effect. The checker warns when an upstream document repository contains a plan.

#### Tools create copies; hashes protect them

Manual copying leaves provenance only in someone's memory. `pull-spec.mjs` retrieves approved
upstream documents and records the **upstream path, upstream commit, and content hash** in
`upstream.lock.json`. It serves the same role as a package lockfile.

```sh
node <sdlc_runtime>/tools/pull-spec.mjs <artifact-directory> [--from <upstream-checkout>]
```

- Commit the copy and lock **together**. Without a lock, the checker treats the set as belonging
  to a single repository.
- The copy is **read-only**. Editing it changes the hash and the gate blocks it. Make changes
  upstream with `/iterate-spec`, then pull it again.
- A plan's `spec_version` is **the upstream commit referenced by the lock**, not the commit that
  brought the copy into the code repository. The latter says only when it was received and cannot
  detect later upstream changes.
- Approval happens upstream. Documents not in `accepted` are not pulled. `--force` may be used to
  inspect a draft early, but it must be pulled again after approval.

#### Coverage has two layers

| Location | Checks |
|---|---|
| Code repository | Does its plan cover every Must acceptance criterion whose `scope` is this repository? (rule 5-5) |
| Document repository | Is every Must acceptance criterion assigned to **at least one consumer repository**? |

A repository cannot detect locally that its entire share is missing; only upstream can. Work that
covers another repository's share is also rejected, because duplicate implementations can diverge
when integrated.

#### Check upstream freshness when a checkout is available

The checker does not use the network. If an upstream checkout is available through `SDLC_UPSTREAM`
or a sibling checkout whose origin matches that repository, it compares the locked commit with the
current upstream commit and reports a stale copy as **an error**. Otherwise it checks only copy
integrity and records that limitation as a note. CI checks out upstream and points to it with
`SDLC_UPSTREAM`.

#### Keep ADRs in one place

Decisions often cross repository boundaries. Giving every repository an `adr_dir` forces repeated
decisions about where an ADR belongs and splits the numbering space. Designate one document
repository as `adr_repo`; code repositories keep only `<repo>#ADR-NNN@<sha>` pins. Organizations
whose decisions never cross a repository boundary may use `adr_dir` instead.

## Artifact syntax

Write items as headings, not table rows. Human-readable prose must also be the machine-readable
structure. Tables are acceptable for genuinely two-dimensional material such as alternative,
state-transition, and metric comparisons.

```markdown
### FR-001 — Default search excludes archived documents `Must`

basis: OUT-001

Unless instructed otherwise, search queries exclude archived documents from results.

Acceptance criteria:

- [ ] AC-001 — When archived and active documents both match, the system returns only active documents
```

- Definition: `### <ID> — <title>`; priority is `` `Must|Should|Could|Won't` ``.
- Field: one `key: value` line, such as `basis:`, `verification:`, or `covers:`.
- Acceptance criterion: `- [ ] AC-001 — <when>, the system <does what>`.
- Task: a checkbox followed by five indented fields.
- Examples inside code fences do not count as definitions.
- Remove template comments and placeholders from artifacts.

### Contract keywords accept both languages

Every string recognized by the checker is in `tools/keywords.mjs`. **English is authoritative,
Korean is an alias, and both are always accepted.** `basis:` and `근거:`,
`[required · all tiers]` and `[필수 · 모든 티어]`, and `N/A —` and `해당 없음 —` are read as
equivalent pairs.

This is independent of the profile language. Language-specific contracts would prevent a Korean
repository's documents from being read by an English repository and block a whole artifact set
while it contains mixed languages during migration.

**Section titles are not part of the contract.** Structure is determined by ID prefixes and tier
markers, so `## 목표 결과` and `## Outcomes` produce the same result. Only the plan's execution
record and release-impact sections and the ADR's five sections are matched by title; those also
accept aliases.

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

| Section marker | Meaning |
|---|---|
| `[required · all tiers]` | Always required |
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

Question prefixes identify who must answer. `Q` belongs to the product owner, `SQ` to the spec
reviewer, `PQ` to the implementation owner, and `FQ` to the service owner or on-call engineer.
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

### A person approves

Applies to schema v3 and later.

- An intent, spec, or plan at `accepted` or later requires `approved_by`, which must differ from
  `generated_by`.
- An approval transition goes through the **approval dialog**. When an agent attempts the approval
  edit, the guard returns `ask`, allowing a person to approve or reject it there. The judgment is
  human, but the person need not type the command. Interactive sessions show the dialog regardless
  of permission mode; non-interactive `-p` sessions reject the transition.
- Autonomous execution is approved **per policy**, not per document. Write
  `approved_by: policy:<route-id>`; the guard permits only its own route ID. The checker validates
  the route's existence, expiry, `max_tier`, and `advance_to`. Human sessions cannot use `policy:`.
- A document beyond the delegation is not eligible for approval. Leave `approved_by` empty, keep
  it in `in_review`, and record what exceeded the delegation. **Stopping there is evidence that
  the delegation actually worked.**
- A finding's `accepted` means its route was decided, not that it was approved, so it does not
  require `approved_by`.

See `sdlc-runtime/references/runtime.md` for guard behavior by mode and
`references/autonomy.md` for policy structure and validation.

## Shared invariants

- One document contains one change intent.
- Do not leave required sections empty. When none applies, write `N/A — <basis>`.
- Refer to upstream content by ID and relative link instead of copying it.
- Distinguish verified facts, decisions, and assumptions.
- Keep implementation methods out of intent and spec; do not copy requirement text into the plan.
- Investigate questions the code can answer. Ask only for judgments a person must make.
- Close open questions with decision IDs.
- When an agent writes the document, populate `generated_by`, `generated_from`, and
  `skills_in_force`.

## Paths and validation

```text
<spec_dir>/
├── findings/FND-YYYY-NNN-<slug>/finding.md
└── YYYY-MM-DD-<slug>/
    ├── intent.md              # vendored copy when upstream exists
    ├── spec.md                # vendored copy when upstream exists
    ├── upstream.lock.json     # only with upstream; created by pull-spec.mjs
    └── plan.md
```

Findings and intents live in different directories. Each relative path connecting them is resolved
from the directory containing **its own document**. Because the base directories differ, copying
one side's path shape to the other breaks the link.

| Key | Document | Relative to | Example |
|---|---|---|---|
| `routed_to` | `finding.md` | Finding directory | `intent:../../2026-09-04-search/intent.md` |
| `from_finding` | `intent.md` | Intent directory | `../findings/FND-2026-007-ci/finding.md` |

The checker verifies that both paths point to **the same file**. Merely resolving successfully is
not enough; otherwise one finding could silently be reused as the source of several intents.

```sh
node <sdlc_runtime>/tools/check-artifacts.mjs <artifact-directory> [--strict]
node <sdlc_runtime>/tools/lint-prose.mjs      <artifact-directory> [--strict]
```

The checker validates structure and traceability; the linter validates prose. Fix errors and run
the tools again. Evaluate warnings and report why any remain. Local hooks may silently be disabled,
so do not skip these direct invocations.

## Shared skill procedure

`/create-finding`, `/create-intent`, `/create-spec`, `/create-plan`, and `/create-adr` follow the
procedure below. Each skill body contains only what is unique to that stage.

Start:

1. Read `.claude/spec-profile.yml`. If it is missing, run `/sdlc-init` first; do not invent a
   profile. A profile without a version is v1. When `sdlc_runtime` is absent, follow the discovery
   order in `references/runtime.md`.

   **The artifact language is the profile's `lang`** (default: `ko`). **Do not follow the
   conversation language.** An artifact set is a committed contract and must use one language per
   repository; CI has no conversation from which to infer one. If the conversation uses another
   language, write the artifact in `lang` and state that fact in one line. Use the template for
   that language. Contract keywords such as `basis:` and `근거:` work in both languages regardless
   of `lang`; see “Contract keywords accept both languages” above.
2. Read this document and `references/prose.md`. Read another reference only when the skill directs
   you to it. Do not read runtime tool source; run the checker to learn what it reports.
3. For the first document in a set (finding or intent), take `schema_version` from the profile's
   `sdlc_version`. For a downstream document (spec or plan), inherit it from the upstream document.
   Preserve the set's version even when it differs from the profile, and report the difference.
   Omit the line for v1. The checker determines whether the runtime supports the version while
   reading the document; do not check separately.
4. Remove template comments and placeholders while preserving heading levels. Populate
   `generated_by`, `generated_from`, and `skills_in_force`.

Finish:

5. Run both tools directly and report their results unchanged (see “Paths and validation”). Do not
   omit this step, because hooks can silently be disabled.
6. After validation passes, save with `status: in_review`, report a summary (path, tier, validation
   result, and remaining questions), and **immediately attempt the approval edit**. Write
   `status: accepted` and `approved_by` in one edit. The guard sends that edit to an approval
   dialog, so **the dialog itself is the approval question**. Do not first ask “Approve?” in the
   conversation; that makes the person answer twice. If rejected, leave the document unchanged and
   ask why. Do not attempt approval while a blocking question remains open.
   - Set `approved_by` to the profile's `owner`, or to `git config user.name` when no owner exists.
     It must be a person's name and differ from `generated_by`. If neither value exists, ask once
     before attempting approval.
   - A finding is routed rather than approved. Populate `routed_to` and `status` instead of making
     an approval edit.
   - An ADR is outside the artifact set, always has `schema_version: 5`, and has no upstream
     document. The rest of the procedure is the same.
7. After approval, run both tools again and commit.

For autonomous execution (the prompt begins with “자율 실행이다” and `SDLC_AUTONOMY_ROUTE` exists):

- Ask nothing. Record anything that would require asking as an open question and leave that
  document in `in_review`.
- Set approval edits to `approved_by: policy:<route-id>`. Do not approve a document beyond the
  delegation's `max_tier` or after `advance_to`.
- The dispatcher performs the commit and final validation. Do not attempt tools outside the
  allowed set; record them as work that could not be done.
