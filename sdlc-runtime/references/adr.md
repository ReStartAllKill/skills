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

- `scope` lists repository-relative code paths constrained by the decision. Agent injection and drift checks both depend on it; an empty scope disconnects the ADR from implementation. A path that no longer exists warns whether or not `confirms` is set — when git shows a commit on the current branch that had it, which is a rename or a deletion. A path no commit on the branch ever had is code still to be written: the «ADR first» rule below accepts the decision before the plan that creates the directory, so that path is a note, and the note says the path check and the `confirms` lookup inside it did not run. The history read is HEAD's, not `--all`, so the verdict depends on the commit checked out and not on which other branches a clone fetched. Without the history to tell — not a git repository, a shallow clone (CI needs `fetch-depth: 0`), no commit yet — the warning stands and its hint says the history was unavailable. A decision that constrains no code path — a vendor choice, an operating policy — leaves `scope` empty and waives `adr-scope-empty` with the reason, rather than naming a path it does not constrain.
- `confirms` is the source of truth for verifying that the decision still holds. Use test names or gate commands; the checker looks for each name within `scope` and `confirms_in`. A decision no single test can confirm leaves it empty and waives `adr-confirms-empty` with the reason, rather than naming a test that does not decide it. The lookup reads at most 400 files per path; when it stops there before finding a name, the warning says the search was cut short (`adr-confirms-search-cut`) rather than that the name is missing — name the test directory in `confirms_in` and it is read on its own budget.
- `confirms_in` (optional) lists further repository-relative paths where the `confirms` names are looked for — `confirms_in: ["test/vault"]` beside `scope: ["src/vault"]`. Tests seldom sit beside the code they confirm (`src/main/java` + `src/test/java`, `pkg/x` + `tests/x`), and widening `scope` to reach them would also widen what the decision is injected into and which plan tasks must pin it. `confirms_in` changes the lookup and nothing else: not injection, not the task-scope check. A `confirms_in` path that is gone is judged like a `scope` path — never in history, a note; there before, a warning (`adr-confirms-in-missing-path`). It is not a template field.
- `waive` lists warnings that do not apply to this decision, one `<rule-id> — <basis>` per item in a block list. It is an opt-out, not a template field; see `references/rules.md` for which rules can be waived and how a waiver is reported.
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

The checker rejects a Consequences section with no accepted constraint. A decision without a cost is post-hoc justification. Describe the strengths of rejected alternatives honestly for the same reason. The checker reads the ordinary ways a cost is named — the template's label («What it costs:», «감수하는 제약:»), "constraint", "drawback", "at the expense of", «받아들인 제약», «단점», «잃는다» and the like (`locales/<lang>.mjs`, `tradeoff`). Words a gain is phrased with as often as a cost — "cannot", "no longer", «못 한다», «부담» — do not count, so a section that lists only gains still fails.

The checker also rejects leftover template placeholders (`<What was decided.>`, `ADR-{NNN}`). Text in a code span or a fenced block is code, not a placeholder: `` `Result<Blob, StoreError>` `` in a decision is the signature it settles. A code span that opens with `<` — `` `<path>` ``, the way the template quotes its own placeholders — still counts.

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

Pair every `ASM-*` with an `RV-*` that detects when the assumption becomes false. Write `RV-*` as a condition with a truth value, not a calendar reminder; “review in six months” is not a condition. The checker warns on the reminder shapes — a review verb next to a point in time («6개월 뒤 재검토», "revisit next quarter", "periodic review") or a point in time alone — and not on a duration that is part of what is measured: “error rate stays above 1% for 3 days” is a condition.

Nothing reads an `RV-*` automatically. No tool watches `revisit:`, and a finding routes only to a patch, an intent or a dismissal, never to an ADR. An `RV-*` is a condition a person, or a finding's diagnosis, can cite by ID; when it becomes true, the response is a successor ADR, reached through an intent like any other change. The frontmatter list and the body must still agree, because that ID is what the citation names.

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
- `superseded`: replaced by the ADR named in `superseded_by`. **Accept the successor, then retire the predecessor.** Only accepted decisions are injected and pinned, so a predecessor moved to `superseded` while its successor is still `draft` or `in_review` leaves its scope with no decision in force: `task-brief` tells the implementing agent nothing, and a plan has nothing live to pin. The checker warns on the superseded ADR when its `superseded_by` chain within this folder — followed through successors that are themselves superseded, and guarded against loops — ends at no accepted decision (`adr-successor-not-in-force`, not waivable). A successor in another repository cannot be read here and is not judged.
- `rejected`: reviewed but not adopted. Keep its number and reasoning so a reopened discussion can see why it was declined.

`guard-approval.sh` sends every edit of an `accepted`, `superseded`, `deprecated`, or `rejected` ADR to the approval dialog — typo fixes included, since the guard cannot tell a typo from a changed conclusion — and every edit that takes an ADR out of `accepted`, whatever the target. Unlike an intent or a spec, an ADR is not exempt when it is pulled back to `in_review` or `superseded`: for them that is the reviewer-friendly direction, for a decision it removes a constraint code relies on. Retire a decision with one edit that changes only `status` and `superseded_by`, so the dialog shows nothing else. `draft` and `in_review` ADRs are edited freely. No autonomy route delegates a decision, so under `SDLC_AUTONOMY_ROUTE` each of these edits, and an ADR approval, is refused. This immutability is what makes the collection trustworthy.

## Pinning decisions from an artifact set

List decisions in the intent, spec, and plan frontmatter.

```yaml
decisions: ["ADR-005", "acme/docs#ADR-007", "acme/other#ADR-002@a1b2c3d"]
```

- Use only the ID for a same-repository ADR. For a decision in `adr_repo` write `<owner>/<repo>#ADR-NNN`: the committed manifest is this repository's lock on those decisions, so the `@` suffix is optional — and checked when written. An `@body:<hex>` behind the decision's content hash warns on an open set (`decision-pin-behind`) and is a note on a closed one: the decision is still in force, and a finished set truly records the text it was done under. An `@<sha>` behind the commit pulled is a note on any set, offering the `@body:` value: a commit moves with every edit to the file and cannot tell a reworded ADR from a changed decision. A pin naming a third repository is never read against the manifest, even when the manifest has the same number. For a repository with no manifest, write `<owner>/<repo>#ADR-NNN@<sha>`; nothing there can check the pin, so the SHA is what lets someone retrace what was read.
- When a change encounters a hard-to-reverse choice, do not decide it inside the artifact set. Pin an existing ADR or create the ADR first. A diagram, wiki, or meeting note cannot serve as the checked source of truth.
- The checker verifies each pinned ADR's existence and status. Referencing a `superseded`, `deprecated`, or `rejected` ADR is an error.
- An ADR named in the body must be pinned by that document, or the checker warns: a citation in prose has no status anyone watches. The one exception is history. A change that migrates to a successor names what it migrates from — «move aggregation onto ADR-005, which superseded ADR-004» — and pinning ADR-004 would be the error above. So pin the successor, and the mention of the decision it replaced is accepted: the checker follows `superseded_by` from the mentioned decision through every decision that is itself `superseded`, and if it reaches one the document pins, the mention is history. A chain ADR-004 → ADR-005 → ADR-006 with ADR-006 pinned covers both. When the successor is not pinned, the warning names it. `superseded_by` is followed and `supersedes` is not: the retired decision must name its successor and that edit goes to a person, while `supersedes` is optional and written by the successor, so a draft could otherwise excuse citing a decision still in force. Upstream the same walk reads the manifest's `superseded_by`; a chain never crosses from one ID space to the other. The `waive:` lines are not read for mentions.
- A closed set — plan `completed`, or plan or intent `superseded` or `rejected` — is judged against the decisions in force when it closed, read from git. If the pinned ADR was in force at the commit that closed the set and lost force later, the checker prints a note instead of an error: the set is history and is not rewritten. If the ADR had already lost force at that commit, if the closing edit is not yet committed, or if history is too shallow to find the commit (CI needs `fetch-depth: 0`), it stays an error. «Closed» alone cannot excuse a pin, because the edit that writes `completed` is checked with `completed` already in it. The task-scope check below follows the same rule: a closed plan is not asked to pin a decision that was not yet in force when it closed.
- The checker also reads the other direction: a plan task whose `files` fall inside an accepted ADR's `scope` must have that ADR pinned somewhere in the set, or it warns. Agent injection reaches the writer, but design decisions (`TD-*`) are settled in the plan before any task runs, and the pin is the only evidence the plan saw the decision — and the only handle the status check has. Design within the decision and pin it; design against it and write the superseding ADR first, never a `TD-*`.

## Decisions in another repository

When decisions live in a document repository (`adr_repo`), the link from a decision to code is cut in two, and each half belongs to the repository that can check it.

- **The ADR names repositories.** `applies_to: ["rwa-contracts"]`, with `scope` and `confirms` empty. A path in another repository cannot be verified where the ADR lives, and the person who renames it works elsewhere.
- **The code repository names paths and tests,** in `.claude/adr-bindings.yml`:

```yaml
source: "acme/docs"
bindings:
  ADR-012:
    at: "body:3f9a0c7d21be"   # the decision's content hash when it was read — pull-adr prints it
    paths: ["src/vault", "src/nav"]
    confirms: ["test_Deposit_MintsAtCurrentPrice"]
    confirms_in: ["test/vault"]
  ADR-001:
    at: "9f8e7d6c5b4a"        # a commit SHA still works, and stops on every commit to the file
    paths: []
    reason: "pricing lives in the backend; nothing here computes it"
```

  `at` names what was read when the binding was written. Its content form, `body:<hex>` (12 or more hex characters, compared by prefix), is a hash over exactly what a code repository binds to: the whole Decision section with its `### Non-goals`, every alternative's title with its chosen marker, `status`, and `superseded_by`. HTML comments are dropped and every run of whitespace counts as one space, so a reflowed paragraph is no change. Not covered: the title, `applies_to`, the other four sections, the rest of the frontmatter. A legacy ADR whose Decision section the checker cannot find is hashed over its whole body instead — stricter than needed, never blind. A typo in Context, an `applies_to` edit or a squash merge leaves the hash where it was; a changed Decision sentence, Non-goal, alternative, status or successor moves it, and the binding fails until someone re-reads the decision and raises `at`. The commit-SHA form is still accepted with the same errors, and while it is current the checker prints a note with the `body:` value to switch to; it is not a warning, because under `--strict` that would fail every repository that bound before the content form existed. The same move schema 7 made for spec pins (`references/schema.md`).

  `confirms_in` is optional and means what it means on an ADR: where else the `confirms` names are looked for, without widening which tasks the binding reaches. The skeleton `pull-adr` prints leaves it out.

- **The decision text arrives as a manifest.** `node <sdlc_runtime>/tools/pull-adr.mjs [--from <checkout>]` writes `.claude/adr-manifest.json` — status, `applies_to`, the digest `task-brief` injects and, per decision, the content hash `digest` that `at` and a pin's `@body:` are compared with, never a path — with an integrity hash. Commit it; never edit it. It prints a binding skeleton, `at` in the content form, for every accepted decision that applies here and has none, and lists the bindings whose `at` is behind.

`pull-adr` writes no `pulled_at`: a second pull with nothing changed upstream leaves the manifest byte-identical, so two branches that both re-pull do not conflict. When it changed is git's to say. A manifest that still carries the key stays valid and loses it on the next pull.

`adr-bindings.mjs`, which `check-all` runs whenever the profile has `adr_repo` — with or without `adr_dir` — checks in the code repository:

| Condition | Level |
|---|---|
| No manifest | warn — pins, task scope and injection are all off |
| Manifest edited by hand, or from another source | error |
| Accepted decision whose `applies_to` names this repository, with no binding | warn |
| Binding to a decision not in the manifest, or to one no longer in force | error |
| `at` missing, or behind the decision — its content hash for `body:`, its commit for a SHA | error — re-read it, then raise `at` |
| `at` is a current commit SHA and the manifest has the content hash | note — the `body:` value to switch to |
| `paths` missing, or `paths: []` without `reason` | error |
| A path that no longer exists, a `confirms` name not found under `paths` and `confirms_in`, a lookup cut short at its file budget, empty `confirms` | warn |
| A `paths` or `confirms_in` entry no commit on the branch ever had | note — the directory is still to be written; the checks that need it did not run |
| Binding to a decision superseded by one not yet accepted | the dead-binding error, with a hint that no decision is in force until the successor is accepted upstream |
| Upstream checkout (`SDLC_UPSTREAM`, `--from`, or a sibling checkout whose `origin` is `adr_repo`) shows a decision's content hash, status or successor changed, or the decision is gone | error when the decision is bound here or its `applies_to` names this repository; otherwise a note |
| Upstream has a decision the manifest does not list | error when its `applies_to` names this repository; otherwise a note |
| Upstream changed a decision's file but not its content hash | note — the manifest can be refreshed at leisure |
| No `repo` in the profile | every upstream change above is an error, as before — nothing can tell what applies here |
| A manifest pulled before content hashes | note; it is compared with upstream by commit, as before, until it is pulled again |
| No upstream checkout | note — freshness was not checked |

A consumer's CI fails for a decision that constrains it and for nothing else. Failing on every move of the document repository kept every consumer of a busy one red most of the time, and a gate that is always red is read as noise — including the day it reports a decision that does bind here.

The plan's task-scope check and `task-brief` match plan `files` against binding `paths`, so a rename is fixed in the PR that makes it; the task-scope warning prints the pin to copy, with the current `@body:` value. A pin into the manifest's repository is checked against the manifest, so `acme/docs#ADR-009` for a decision that does not exist is an error rather than a SHA-shape check.

An ADR is always schema 5, so no version can mark where the new form begins; `applies_to` does. An ADR that has `applies_to` and still names another repository's path in `scope` is an error — the same link held twice, and the upstream copy is the one nothing checks. An ADR without `applies_to` that names one is a warning: it was valid when written, and it stays readable. `pull-adr` treats the repositories such an entry names as its `applies_to` and carries its paths and `confirms` into the skeleton, so a code repository can bind before the document repository migrates.

### Both: decisions here and in a document repository

A repository may set `adr_dir` **and** `adr_repo` — service-local decisions next to the code, organisation-wide ones in a document repository. Then both halves run: `check-all` prints a «결정 기록» line for the folder and a «결정 바인딩» line for the manifest and bindings, each with its own verdict, and the task-scope check and `task-brief` match a task's `files` against local `scope` and against binding `paths` alike. `adr_manifest` defaults as `adr_bindings` does; `pull-adr` once refused to run until it was spelled out next to `adr_dir`, and the checker then ignored the manifest anyway.

The two ID spaces overlap — `ADR-005` here and `ADR-005` upstream are different decisions — so a pin is read by its form:

| Written | Names | Checked against |
|---|---|---|
| `ADR-005` | this repository's decision | `adr_dir` |
| `acme/docs#ADR-005`, optionally `@body:<hex>` or `@<sha>`, where `acme/docs` is `adr_repo` | the upstream decision | the manifest, suffix included |
| `acme/other#ADR-005@<sha>` with only `adr_repo` set | a third repository | SHA shape only — never the manifest |
| `acme/contracts#ADR-005`, where `acme/contracts` is `repo` | this repository's decision | `adr_dir` |
| any other `<owner>/<repo>#ADR-005@<sha>` | a third repository | SHA shape only |

A local pin never satisfies an upstream requirement or the reverse, and the warning for a missing pin suggests the form for its source. A prose mention follows the same rule: a bare `ADR-005` in the body is this repository's decision, and the upstream one is written `acme/docs#ADR-005`. Reading a bare mention as «either» was rejected; it would let an upstream pin silence the citation of a local decision. With only one of the two keys there is one space, and every pin reads against it as before.

## When a decision changes

Retiring a decision changes the footing of every set that rests on it, and the save hook checks only the folder that was edited. Ask first what the change touches:

```sh
node <sdlc_runtime>/tools/adr-impact.mjs <repo-root> ADR-005             # this repository's decision
node <sdlc_runtime>/tools/adr-impact.mjs <repo-root> acme/docs#ADR-005   # an upstream decision, in a consumer
```

It is a read-only report and exits 0 whatever it finds. It lists the sets that pin the decision, open apart from closed, the open plans whose task `files` touch its `scope` or binding `paths` and whether they pin it, the sets whose prose names it without a pin, the binding in a consumer, and what each would need if the decision were retired. Pins and mentions are read as the checker reads them, ID space included.

**In the repository that holds the decision:**

1. Run `adr-impact` and read the open sets it names.
2. Write the successor and accept it.
3. Retire the predecessor — one edit of `status` and `superseded_by`.
4. In each open set, read the successor, decide whether the design (`TD-*`) and tasks still stand, and move the pin (`/iterate-spec`). A running plan goes back to `in_review` first. Closed sets are history and are not edited.

**In a consumer repository:**

1. Re-pull with `pull-adr.mjs` and read what it prints or what `adr-bindings.mjs` then reports — `binding-dead` for a retired decision, `binding-stale` for one whose text changed.
2. Re-read the decision, or its successor; then raise the binding's `at`, or move the binding to the successor.
3. Run `adr-impact` and move the pins of the open sets it names (`decision-pin-behind` warns on an `@body:` pin left behind).

Work does not continue across the change unnoticed. `plan-resume.mjs` returns `blocked` when the set has a decision-pin error — a pin to a decision no longer in force (`pin-dead`), to one that does not exist (`decision-pin-unknown`), or one it cannot read (`decision-pin-unreadable`) — and names the decision and its successor. `task-brief.mjs` refuses the same set: it prints the reason on stderr, nothing on stdout, and exits 1, because the decisions it injects are matched against what is in force now, and level N+1 would be briefed under a different decision than level N. Warnings, such as a pin behind the manifest's text or a pin to a draft, stop neither.

## Profile seam

```yaml
adr_dir: "docs/adr"              # Omit when this repository has no ADRs
adr_repo: "acme/docs"            # Optional; decisions live in another repository — may sit beside adr_dir
adr_index: "docs/adr/index.md"   # Default: <adr_dir>/index.md
adr_manifest: ".claude/adr-manifest.json"  # Default when adr_repo is set
adr_bindings: ".claude/adr-bindings.yml"   # Default when adr_repo is set
```

## Agent injection

When a task's `files` overlap an ADR's `scope` — or, for a decision in another repository, its binding's `paths` — `task-brief.mjs` injects the ADR's **decision, Non-goals, and rejected-alternative titles** into the writer prompt and supplies only a link to the full text.

This injection is how an ADR reaches implementation. Without it, an agent can apply a default that contradicts the decision or reopen a settled debate. An ADR with an empty `scope` is therefore only decoration.
