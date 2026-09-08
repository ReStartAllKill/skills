# restart-harness

*[한국어](README.ko.md)*

A Claude Code plugin that makes changes go through a written chain — intent, spec,
plan, implementation — and checks that chain **as you write it**, not after.

> **Artifacts are written in Korean or English**, set once per repository with
> `lang` in the profile. It is a repository setting, not a person's: the chain is a
> committed contract everyone in the repository reads, and CI has no conversation to
> take a language from. Write to Claude in whichever language you like — the
> artifacts follow `lang`.
>
> The contract keywords take both forms always, whatever `lang` says: `basis:` and
> `근거:`, `[required · all tiers]` and `[필수 · 모든 티어]`. Section titles were
> never part of the contract — structure is decided by ID prefix and tier marker.
>
> `lang` selects the style bundle: the word lists and the character budgets in
> `sdlc-runtime/locales/`. Korean's numbers are measured on this repository's 42
> Korean artifacts. **English's are derived**, at 2.2× the Korean ones, from nine
> matching sections of this README pair — the file says so, and says what would
> replace it. The skills and reference documents are still Korean; they are read by
> the model, not by you.
>
> A document written in a language `lang` does not name still gets `lang-unsupported`,
> because a style check that matches nothing is indistinguishable from one that passed.

## The problem

An agent that writes code well still leaves you with two questions the diff cannot
answer: *why was this done*, and *does it still match what was agreed*. Notes
written after the fact drift from the code, and nobody notices until the drift has
already cost something.

This plugin keeps those answers next to the change, and makes them fail loudly
when they stop matching.

## The chain

```text
finding ──┬─ patch
          ├─ dismiss
          └─ intent → spec → plan → code/test/PR/deploy → finding
                ↑      approve  approve   ↑
                └────── ADR ──────────────┘
                   outlives the change
```

| Document | The question it answers | What it must not contain |
|---|---|---|
| `finding.md` | What was observed, and where does it go | How to fix it |
| `intent.md` | Why is this needed, what must change | APIs, frameworks, data models, file order |
| `spec.md` | What observable behaviour satisfies it | Internal classes, functions, libraries |
| `plan.md` | How to build and ship it safely | Restating the problem and the requirements |
| `ADR-NNN.md` | Why it was decided this way, what was rejected | Current implementation detail |

Each document is a contract for **this change only** — except the ADR, which
records a constraint the system carries from then on. Code is the source of truth
for *what*; it is never the source of truth for *why*.

## The IDs you will see in documents

Artifacts are written as **identified items**, not paragraphs. A downstream document
cites an upstream one by ID under `근거:` (*basis*), and the checker follows those links —
so the prefix says which document an item belongs to and what kind of thing it is.
`sdlc-runtime/conventions.md` §ID 접두 is authoritative.

### Document IDs

The form comes from each skill's `assets/*-template.md`.

| Form | Document |
|---|---|
| `FND-YYYY-NNN` | finding |
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

### Open questions — the prefix names who answers

| Prefix | Document | Closed by |
|---|---|---|
| `Q-*` | intent | the product owner |
| `SQ-*` | spec | the spec reviewer |
| `PQ-*` | plan | the implementation owner |
| `FQ-*` | finding | the service owner or on-call |

An ID is **never reused**, even after the item is deleted — so `FR-003` always points at
one thing.

## What actually enforces it

Three things run, at three different times. They are deliberately different.

| | When | What it does |
|---|---|---|
| **Approval guard** | `PreToolUse` | Blocks self-approval, and unapproved edits to approved documents. Runs *before* the write, because a check that runs after cannot undo one. |
| **Artifact gate** | `PostToolUse` | Checks structure, traceability and prose the moment a document is saved — fast enough that you fix it where you are. |
| **CI checker** | `check-all.mjs` | Checks *every* chain in the repository. Hooks live on one machine; only CI is a gate for a team. |

The gate looks only at the folder you just touched, so a downstream document can
quietly go stale after its parent changes. That is the most common way this kind
of chain collapses, and it is exactly what the CI checker exists to catch.

## Install

```bash
claude plugin marketplace add ReStartAllKill/restart-harness
claude plugin install restart-harness
```

Then, **in each repository** where you want the chain:

```
/sdlc-init
```

That writes a profile (`.claude/spec-profile.yml`), installs the two hooks, and
offers a line to add to CI.

Installing the plugin alone turns nothing on. In a repository with no profile the
hooks **exit silently** — not a gate failing open, but the plugin refusing to touch
repositories that never asked for it. `intent.md` and `plan.md` are common filenames.

## Skills

### `sdlc` — the chain

| Skill | Use it when |
|---|---|
| `/sdlc-init` | Setting the chain up in a repository |
| `/create-finding` | An incident, alert, metric or scan result should become an input |
| `/create-intent` | Starting a change — settling *why* before *what* |
| `/create-spec` | Turning an approved intent into verifiable behaviour |
| `/create-plan` | Turning an approved spec into tasks |
| `/implement-spec` | Executing the plan, level by level |
| `/iterate-spec` | Feedback or review changed what the spec should say |
| `/create-adr` | A decision is hard to reverse and must outlive the change |
| `/create-pr` | Turning the branch into a pull request — the body cites the chain rather than re-deriving it |

`/implement-spec` runs same-level tasks in parallel, each in its own git worktree,
and runs full verification at every join point.

`/create-pr` is the one skill that writes outward. It only runs when you ask for it:
`/implement-spec` commits and merges, but never pushes or opens a pull request.

### `eval` — measuring the agents

| Skill | Use it when |
|---|---|
| `/agent-eval` | You changed a harness and want to know whether it actually got better |

It seeds defects at three difficulty tiers, runs two configurations *k* times each
in parallel, grades against a rubric, and reports the comparison — answering "did
that prompt change help?" with a number rather than an impression.

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

Do not install a copy. One symlink makes Claude Code load this repository in place,
so an edit is live and `git pull` is the update.

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
node --test sdlc-runtime/evals/runner.test.mjs \
  skills/sdlc/create-pr/evals/tools.test.mjs      # runner + create-pr script regressions
python3 -m unittest discover -s skills/eval/agent-eval/scripts -p 'test_*.py'
```

GitHub Actions runs these regression tests and the skill registration check on Linux and
macOS for every push and pull request, using Node.js 24 and Python 3.12 without model API
calls. See the [evaluation guide](sdlc-runtime/evals/README.md) for coverage.

### Adding a skill

The `skills` array in `plugin.json` is authoritative. Auto-discovery only goes one
level into `skills/`, and this repository groups skills by category — so only what
the array lists is loaded. A skill you create but forget to declare has no symptom
other than not appearing. `scripts/list-skills.sh` is what catches that.

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
