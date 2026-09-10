# Skills

*[한국어](README.ko.md)*

A Claude Code plugin that guides each change through a traceable SDLC artifact workflow —
intent, spec, plan, implementation — and validates traceability **as you write**, not afterward.

> **Artifacts are written in Korean or English**, selected per repository by `lang` in the
> profile. This is a repository setting, not a personal preference: an artifact set is a
> committed contract that everyone in the repository reads, and CI has no conversation
> from which to infer a language. Write to Claude in whichever language you prefer; the
> artifacts follow `lang`.
>
> Contract keywords are always accepted in both languages, regardless of `lang`: `basis:`
> and `근거:`, `[required · all tiers]` and `[필수 · 모든 티어]`. Section titles are not
> part of the contract; structure is determined by ID prefixes and tier markers.
>
> `lang` selects the style bundle: the word lists and character budgets in
> `sdlc-runtime/locales/`. The Korean budgets were measured from 42 Korean artifacts in
> this repository. **The English budgets are derived** by multiplying them by 2.2, based
> on nine matching sections in this README pair. The locale file records both that basis
> and what evidence should eventually replace it. Skills may give the model Korean
> instructions, while the runtime reference documents use English.
>
> A document written in a language other than the one selected by `lang` still receives
> `lang-unsupported`, because a style check that matches nothing is indistinguishable
> from one that passed.

## The problem

An agent that writes code well still leaves you with two questions the diff cannot
answer: *why was this done*, and *does it still match what was agreed*. Notes
written after the fact drift from the code, and nobody notices until the drift has
already cost something.

This plugin keeps those answers next to the change and fails loudly when the
artifacts stop matching.

## Artifact workflow

```text
finding ──┬─ patch
          ├─ dismiss
          └─ intent → spec → plan → code/test/PR/deploy → finding
                ↑      approve  approve   ↑
                └────── ADR ──────────────┘
                   outlives the change

research ── cited by ──▶ intent · ADR
```

For each change, this workflow produces an **artifact set** containing `finding.md`, `intent.md`,
`spec.md`, and `plan.md`. The checker validates **traceability** across IDs and state transitions.

| Document | The question it answers | What it must not contain |
|---|---|---|
| `finding.md` | What was observed, and where does it go | How to fix it |
| `research.md` | What was compared, on which criteria, from which sources | A decision — that belongs in the ADR or intent |
| `intent.md` | Why is this needed, what must change | APIs, frameworks, data models, file order |
| `spec.md` | What observable behaviour satisfies it | Internal classes, functions, libraries, implementation order |
| `plan.md` | How to build and ship it safely | Restating the problem and the requirements |
| `ADR-NNN.md` | Why it was decided this way, what was rejected | Current implementation detail |

Each document is a contract for **this change only** — except the ADR, which records a
constraint the system carries from then on. Code is the source of truth for *what*, but
not for *why*: a diff cannot preserve the rejected alternatives or the assumptions behind
a decision.

## The IDs you will see in documents

Artifacts are written as **identified items**, not paragraphs. A downstream document
cites an upstream one by ID under `근거:` (*basis*), and the checker follows those links —
so the prefix says which document an item belongs to and what kind of thing it is.
`sdlc-runtime/conventions.md` §ID prefixes is authoritative.

### Document IDs

The form comes from each skill's `assets/*-template.md`.

| Form | Document |
|---|---|
| `FND-YYYY-NNN` | finding |
| `RSH-YYYY-NNN` | research |
| `CHG-YYYY-NNN` | intent |
| `SPEC-YYYY-NNN` | spec |
| `PLAN-YYYY-NNN` | plan |
| `ADR-NNN` | ADR — no year; monotonic within the repository, never reused |

### Item IDs

| Prefix | Meaning | Where it is written |
|---|---|---|
| `OUT-*` | Intended outcome | intent, §목표 결과 |
| `CON-*` | Constraint, invariant | intent, §제약 |
| `ASM-*` | Assumption | intent §가정, ADR §문맥과 결정 요인 |
| `SCN-*` | Scenario | spec, §시나리오 |
| `FR-*` | Functional requirement | spec, §요구사항 |
| `NFR-*` | Non-functional requirement | spec, §비기능 요구사항 |
| `AC-*` | Acceptance criterion | checkbox under an FR or NFR |
| `EDGE-*` | Error and boundary condition | spec, §오류와 경계 |
| `SD-*` | Specification decision | spec, §열린 질문과 결정 |
| `TD-*` | Design decision for this build | plan, §설계 결정 |
| `WP-*` | Work package (a task) | plan, §작업 |
| `RISK-*` | Risk | plan, §위험 |
| `EV-*` | Observation, evidence | finding, §관측 |
| `HYP-*` | Hypothesis | finding, §진단 |
| `ALT-*` | Alternative considered | ADR, §대안 |
| `RV-*` | Revisit condition | ADR, §확인과 재검토 |
| `CRIT-*` | Comparison criterion | research, §Criteria |
| `SRC-*` | Source consulted | research, §Sources |
| `OPT-*` | Option compared | research, §Options |
| `REC-*` | Judgement | research, §Judgement |

### Open questions — the prefix names who answers

| Prefix | Document | Closed by |
|---|---|---|
| `Q-*` | intent | the product owner |
| `SQ-*` | spec | the spec reviewer |
| `PQ-*` | plan | the implementation owner |
| `FQ-*` | finding | the service owner or on-call |
| `RQ-*` | research | the research owner |

An ID is **never reused**, even after the item is deleted — so `FR-003` always points at
one thing.

## What actually enforces it

Three mechanisms run at different stages, each with a distinct purpose.

| | When | What it does |
|---|---|---|
| **Approval guard** | `PreToolUse` | Blocks self-approval, and unapproved edits to approved documents. Runs *before* the write, because a check that runs after cannot undo one. |
| **Artifact gate** | `PostToolUse` | Checks structure, traceability and prose the moment a document is saved — fast enough that you fix it where you are. |
| **CI checker** | `check-all.mjs` | Checks *every* artifact set in the repository. Hooks live on one machine; only CI is a gate for a team. |

The gate looks only at the folder you just touched, so a downstream document can
quietly go stale after its parent changes. That is the most common way this kind
of traceability breaks down, and it is exactly what the CI checker exists to catch.

## Install

```bash
claude plugin marketplace add ReStartAllKill/skills
claude plugin install restart-harness
```

The two names differ because they name different things: `skills` is the repository that
hosts the marketplace, `restart-harness` is the plugin inside it.

Then, **in each repository** where you want the artifact workflow:

```
/sdlc-init
```

That writes a profile (`.claude/spec-profile.yml`), installs the two hooks, and
offers a line to add to CI.

Installing the plugin alone enables nothing. In a repository without a profile, the
hooks **exit silently**. This is not a gate failing open; it is the plugin declining to
touch a repository that never opted in. After all, `intent.md` and `plan.md` are common
filenames.

## Skills

### `sdlc` — artifact workflow

| Skill | Use it when |
|---|---|
| `/sdlc-init` | Setting up the artifact workflow in a repository |
| `/create-finding` | An incident, alert, metric or scan result should become an input |
| `/create-research` | Comparing options or cases before deciding — sources, criteria and comparison kept as evidence |
| `/create-intent` | Starting a change — settling *why* before *what* |
| `/create-spec` | Turning an approved intent into verifiable behaviour |
| `/create-plan` | Turning an approved spec into tasks |
| `/create-light` | A small revertible change — all three documents in one pass |
| `/implement-spec` | Executing the plan, level by level |
| `/iterate-spec` | Feedback or review changed what the spec should say |
| `/create-adr` | A decision is hard to reverse and must outlive the change |
| `/create-pr` | Turning the branch into a pull request — the body draws its rationale from approved artifacts rather than the diff |

Use `/create-light` when the change touches no external contract and no data, and a revert
or a flag takes it back — it writes the same intent, spec and plan, runs the same checker and
linter, and asks for the same three approvals, but in one pass and one commit. Anything else
goes through `/create-intent` → `/create-spec` → `/create-plan`, where each stage stops for
review before the next one is written. It needs `sdlc_version: 7` or later.

`/implement-spec` runs same-level tasks in parallel, each in its own git worktree,
and runs full verification at every join point.

`/create-pr` is the only skill that changes remote state, and it runs only when you ask
for it. `/implement-spec` commits and merges locally, but never pushes or opens a pull
request.

### `eval` — measuring the agents

| Skill | Use it when |
|---|---|
| `/agent-eval` | You changed a harness and want to know whether it actually got better |

It seeds defects at three difficulty tiers, runs two configurations *k* times each in
parallel, grades the results against a rubric, and reports the comparison. It answers
"Did that prompt change help?" with a number rather than an impression.

## Repository layout

```
.claude-plugin/     plugin.json (the skills array is authoritative) · marketplace.json
skills/             skills only — everything here has a SKILL.md
  sdlc/<name>/      SKILL.md · assets/<lang>/ · references/ · scripts/ · evals/
  eval/agent-eval/  SKILL.md · rubrics/ · scripts/ · cases/
sdlc-runtime/       conventions, checkers, reference docs — used by skills, hooks and CI
agents/             eval-case-author · eval-grader
commands/           eval-agent
scripts/            maintainer tooling
```

`agents/` sits at the plugin root because agents nested inside a skill folder are
not registered. `sdlc-runtime/` sits outside `skills/` because hooks and CI call it
too, and because it keeps one rule true: everything under `skills/` is a skill.

## Where the runtime is loaded from

The conventions and checkers in `sdlc-runtime/` are found in this order:

1. `sdlc_runtime` in the repository's profile
2. `.claude/sdlc` in the repository — a vendored copy
3. the installed plugin

**The order is the policy.** A copy pinned in the repository wins, because making a
team and its CI run the same checker is the only reason to vendor one
(`sdlc-runtime/tools/vendor-runtime.sh`) — and if the hooks read a different copy
than the skills do, that reason collapses.

CI runners have neither a plugin nor a home directory, so vendoring is in practice
the only way to put the checker in a merge gate.

## Development

For development, use a symlink instead of installing a copy. Claude Code then loads this
repository in place, so edits take effect immediately and `git pull` performs the update.

```bash
./scripts/link-plugin.sh     # ~/.claude/skills/restart-harness -> this repo
```

Then `/reload-plugins`. Installing through the marketplace instead puts a **copy**
in the plugin cache, which does not move until `claude plugin update`.

```bash
./scripts/list-skills.sh                        # disk vs. plugin.json
claude plugin validate .
claude plugin details restart-harness           # components and token cost
node sdlc-runtime/evals/run.mjs                 # checker + runtime suites
node --test sdlc-runtime/evals/*.test.mjs \
  skills/sdlc/create-pr/evals/tools.test.mjs      # runner + create-pr script regressions
python3 -m unittest discover -s skills/eval/agent-eval/scripts -p 'test_*.py'
```

GitHub Actions runs these regression tests and the skill registration check on Linux and
macOS for every push and pull request, using Node.js 24 and Python 3.12 without model API
calls. See the [evaluation guide](sdlc-runtime/evals/README.md) for coverage.

### Adding a skill

The `skills` array in `plugin.json` is authoritative. Auto-discovery only goes one
level into `skills/`, and this repository groups skills by category — so only what
the array lists is loaded. If you create a skill but forget to declare it, the only
symptom is that it does not appear. `scripts/list-skills.sh` catches this omission.

## Releasing

**Nothing reaches anyone until `version` in `plugin.json` goes up.** `claude plugin update`
compares that value, not the files — change the content and leave the version alone and it
reports "already at the latest version".

```bash
# 1. Raise version in plugin.json and record it in CHANGELOG.md
# 2. Check
./scripts/list-skills.sh
claude plugin validate .
node sdlc-runtime/evals/run.mjs
node --test sdlc-runtime/evals/runner.test.mjs skills/sdlc/create-pr/evals/tools.test.mjs
python3 -m unittest discover -s skills/eval/agent-eval/scripts -p 'test_*.py'
# 3. Push
git push
```

Consumers run `claude plugin update restart-harness`. An update creates a new version
directory and **does not remove the old copy**, so the hooks' search path can match several
versions at once. It picks the newest by mtime (`ls -td`) — lexical order would pick `0.1.9`
over `0.1.10`.

## License

MIT
