# Changelog

## 0.2.0 — 2026-09-09

### Added

- **English artifact support.** `lang: en` selects English templates and the English prose bundle
  for intents, specs, plans, findings, ADRs, and pull request bodies. English progress-report
  templates are also available.
- **Bilingual contract keywords.** Checkers accept the English and Korean forms of all contract
  keywords regardless of `lang`, including fields, tier markers, task results, band adjustments,
  and the plan and ADR section titles that are parsed as text.
- **`/create-pr`.** The new skill creates a pull request from the current branch with `gh`. When a
  branch changes an artifact set, the body cites the approved intent and spec instead of deriving
  their rationale from the diff. Repository-specific PR settings live in the profile.

### Changed

- **Artifact language is repository-owned.** The profile's `lang` selects artifact templates,
  prose rules, and pull request body rules. Progress reports follow the conversation language
  because they are not committed to the repository.
- **Prose rules are locale bundles.** Word lists, character budgets, and sentence-ending rules now
  live in `sdlc-runtime/locales/ko.mjs` and `en.mjs`. English word lists support regular expressions
  so checks can use word boundaries. An unsupported `lang` stops the linter with
  `lang-unsupported` instead of producing a false pass.
- **Artifact templates are organized by language.** Korean and English variants live under each
  skill's `assets/ko/` and `assets/en/` directories, and smoke tests require both sets to have the
  same structure.
- **Execution evidence is concise and durable.** Implementation stores evidence in a verification
  log and records only facts established by that log instead of preserving the full transcript.
- **Terminology uses “artifact set.”** User-facing documentation and skill instructions replace
  the former “artifact chain” name.
- **Documentation is bilingual.** The root README and artifact conventions now have matching
  English and Korean versions. `sdlc-runtime/conventions.md` is the English canonical path, with
  its Korean counterpart at `sdlc-runtime/conventions.ko.md`.

### Fixed

- **The approval guard is installed and executed correctly.** Repository initialization also
  commits the generated profile, or reports when it cannot do so.
- **English prose checks count sentence endings correctly.** Periods inside identifiers and other
  non-terminal positions no longer inflate the sentence count.
- **Migration documentation names the accepted flag.** The schema migration instructions now use
  the option recognized by `migrate-schema.mjs`.

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
