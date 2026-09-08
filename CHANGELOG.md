# Changelog

## Unreleased

### Added

- **The style rules are a bundle, chosen by `lang`.** The word lists, the character budgets and
  the sentence-ending rule move out of `lint-prose.mjs` into `sdlc-runtime/locales/ko.mjs`, and a
  new `lang` profile key selects which bundle measures a repository's artifacts. `lang` is a
  repository setting, not a person's: the chain is a committed contract, and CI has no
  conversation to read a language from. A `lang` with no bundle stops the linter rather than
  passing — a check that cannot run must not look like a check that found nothing. Only `ko`
  ships; its numbers are measurements of this repository's 42 Korean artifacts and must not be
  copied into another language's bundle.

- **The contract accepts English keywords.** Every word a checker actually reads now lives in
  `sdlc-runtime/tools/keywords.mjs` — thirteen of them — and each takes an English form beside the
  Korean one: `basis:` for `근거:`, `[required · all tiers]` for `[필수 · 모든 티어]`, `N/A —` for
  `해당 없음 —`, and so on down to the task results and the ADR section titles. Both forms always
  pass, independently of any language setting: gating the contract on a language would make a
  Korean repository's documents unreadable in an English one and would break a chain that is
  halfway between the two. Section titles were never part of the contract and still are not —
  structure is decided by ID prefix and tier marker, so `## Outcomes` checks the same as
  `## 목표 결과`.

- **`/create-pr`** — writes the pull request title and body for the current branch and opens it
  with `gh`. Where a branch touched a chain, the body's Intent and Problem are taken from the
  approved `intent.md` and `spec.md` and cite their IDs, rather than being re-derived from the
  diff; the linter refuses a body that touched a chain and cites nothing. Repository-specific
  facts — workspace layout, the split rule, the paths worth a second look — live in the profile
  as `pr_base` · `pr_workspace_dirs` · `pr_split_dir` · `pr_split_hint` · `pr_review_focus`, so
  the skill itself carries no repository's facts.
- **The skill owns its tools.** `scripts/` (context, body lint, body sync), `references/`
  (body rules, stacked PRs), `assets/pr-body-template.md` and `evals/tools.test.mjs` all sit
  under `skills/sdlc/create-pr/`, not in the runtime — nothing but this skill calls them, and
  the runtime is where hooks and CI look. The body linter enforces what a
  script can see — noise, style, hard wraps, a missing Risks section on a path the profile marked
  risky — and says `lang-unsupported` on a non-Korean body so an unchecked body is never mistaken
  for a clean one.

## 0.1.1 — 2026-09-08

### Fixed

- **The assignment rule now applies only to v6 specs.** The rule that rejects a Must acceptance
  criterion assigned to no consumer fired on every spec in a repository declaring
  `spec_consumers`, whatever the document's schema version. That contradicts the rule stated in
  `schema.md` — a new error rule applies only from the schema that introduced it — and it made
  declaring an upstream repository prohibitively expensive: one profile line would have turned
  every existing chain red at once, so nobody would have added it.

## 0.1.0 — 2026-09-08

First release.

### Artifact chain

- **Eight chain skills** — `sdlc-init` · `create-finding` · `create-intent` · `create-spec` ·
  `create-plan` · `implement-spec` · `iterate-spec` · `create-adr`
- **Runtime** — the artifact conventions, the checkers and the reference documents. Skills, hooks
  and CI all read the same copy.
- **Two hooks** — an approval guard that stands *before* a write, and an artifact gate that runs
  the moment a document is saved.
- **CI checker** — reads every chain in a repository at once, where the gate sees only the folder
  you just touched.

### Repo boundaries (schema v6)

- **The checker understands a docs repo upstream of code repos.** A spec stays a single document
  for the whole system rather than being split per repository; each acceptance criterion records
  which repository builds it with `` `scope: <repo>` ``. A code repo covers only its own share,
  and a Must criterion assigned to nobody is rejected upstream, where it is the only place it can
  be seen.
- **`pull-spec.mjs` and `upstream.lock.json`** — approved upstream documents are pulled in by a
  tool, and the lock records the upstream path, commit and content hash. Editing a copy by hand
  breaks the hash; when the upstream moves ahead the checker catches it. `spec_version` is
  therefore compared against the locked upstream commit rather than the copy's local commit — a
  pin that could not cross a repository boundary now does.
- **Three profile keys** — `repo` · `upstream_repo` · `spec_consumers`. Leave all three empty and
  a single-repo chain behaves exactly as it did under v5.

### Evaluation

- **Evaluation harness** — the `agent-eval` skill, two grading agents, the rubric and the runner.
- **Result integrity** — the checker's exit code is verified, standalone runtime runs were fixed,
  and ungraded or harness-error results are refused rather than folded into an aggregate.

### Project

- **Continuous integration** — skill registration plus the evaluation runner, grading, document
  and runtime regression suites, on Linux and macOS.
- **Skill documentation** — one voice across the skills, duplicated explanation removed, and the
  evaluation and aggregation procedures spelled out.

### Note on language

Artifacts are written in Korean. The length budgets were measured on Korean text and the style
checks are lists of Korean phrasings, so an English document earns a `lang-unsupported` warning
rather than silence — a check that never fires is indistinguishable from one that passes.
