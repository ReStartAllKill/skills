# Changelog

## 0.6.1 — 2026-09-10

### Fixed

- **A vendored runtime runs on its own again.** `vendor-runtime.sh` copied `tools/`,
  `references/` and the conventions but not `locales/`, which every tool has imported since
  0.2.0, so a repository that updated its vendored copy got a checker that died in
  `useLocale` while the global copy kept passing. The directory is now copied and compared by
  `--check`, and a smoke case runs the vendored checker with no global copy in reach.
- **A legacy ADR whose status row is labelled `상태(Status)` is read.** The label is not
  contract; the value is. A bilingual label turned a known `승인됨` into an unknown status and
  failed `check-all` for a repository whose oldest decisions predate frontmatter.

Both were found by applying `/sdlc-init` to a consumer repository that had vendored v5.

## 0.6.0 — 2026-09-10

### Added

- **`research.md` and `/create-research`.** An investigation — comparing libraries, reading
  other projects, searching the web — used to survive only as a conclusion in an ADR's `ALT-*`
  or an intent's `ASM-*`; the sources, the criteria and the comparison vanished with the
  conversation. A research document keeps them: `CRIT-*` criteria written before the search,
  `SRC-*` sources with where and when they were read, `OPT-*` options each tied to a source, a
  criteria-by-options comparison table, `REC-*` judgements that separate fact from inference,
  and `RQ-*` open questions. It lives under `<spec_dir>/research/`, outside artifact sets, is
  always schema 7, has no tier and no approval — `reviewed` records that a person read it — and
  is cited inline as `RSH-2026-003/SRC-002` from any other document; the checker resolves the
  citation and rejects a dangling one. The skill writes the question and criteria first and
  confirms them once, records each source the moment it is found, and ends at `in_review`.
- **Checker rules for research.** An undated or unlocated source, an unsourced option, a
  criterion or option missing from the comparison, and a judgement citing no option are errors.
  The comparison table is the one table the `entity-table` lint rule leaves alone.

## 0.5.1 — 2026-09-10

### Fixed

- **The five v7 eval cases reach a fresh clone.** An unanchored `docs/` in `.gitignore` swallowed
  their `docs/` fixtures, so the cases passed on the machine that wrote them and failed in CI
  with a missing directory. The pattern is now anchored to the repository root, which is the only
  `docs/` it was ever meant to cover.
- **The `finish` tests run where git has no global identity.** The tool under test commits with
  its own git invocation, so the identity the test helper passed on its own calls never reached
  it; the temporary repository now carries a local identity, as the runtime smoke cases already
  did.

No plugin behaviour changes; 0.5.0's tag carries the same tools and skills with a red CI.

## 0.5.0 — 2026-09-10

### Added

- **Schema v7 — lighter documents.** At v7 a `##` heading with no tier marker is read as
  `[required · all tiers]`, so the marker that sat on nearly every section of every committed
  document is gone from the templates; `standard+`, `full`, `conditional` and `optional` markers
  stay. `intent_version` and `spec_version` accept `body:<hex>`, a sha256 of the upstream
  document's body printed by `pin.mjs`, so intent, spec and plan can be born in one commit and
  an approval no longer invalidates a pin over a body nobody touched. Both rules bind only at or
  above v7. `generated_from`, `skills_in_force` and `superseded_by` are optional at every version.
- **`/create-light`.** Writes intent, spec and plan for a light-tier change in one pass: one
  instruction read, one checker and linter run on the folder, one commit after the three approval
  dialogs. It needs `sdlc_version: 7` and refuses a change that fails the light criteria. Same
  documents, same checker, same evidence chain — it removes the repetition, not the contract.
- **`sdlc-metrics.mjs`.** Reports the AI-native SDLC playbook's stage indicators from git history
  and the artifacts alone: intent-to-accept lead time and survival, spec rework after build
  starts, plan-to-completion time, diff-to-plan deviation share, review returns, first-pass verify
  success, finding-to-route time, and what a set costs in characters, commits and days. A value
  the repository cannot support is `unmeasured — <reason>`, never 0. `--json` for dashboards.
- **Fewer tool calls per document and per task.** `check-set.mjs` runs the checker and the
  linter as one call with one merged report. The approval guard now refuses an `approved_by`
  equal to `generated_by` before the write, so the post-approval re-check is gone from the
  shared procedure: one check call per document instead of four. `task-worktree.mjs finish`
  is commit, merge and remove in one call, naming the step to resume with when one fails.
- **Verification that matches the evidence model.** Intermediate execution levels run the
  profile's `verify_scoped` under `--label scoped`; only the final level runs the full `verify`
  over every task, and only that log is completion evidence — which is what `plan-progress`
  already required. Tasks are marked once, after that run. The independent audit agent runs for
  `standard` and `full` tiers; a light change reports that it was skipped.
- **A warning for a template newer than its schema.** A marker-free document declaring a schema
  below 7 would have had its required-section checks silently off; the checker now says so.
- **Bilingual pairs are checked for shape.** README and conventions now have the same heading
  parity test the templates had.

### Changed

- **`conventions.md` states the v7 contract and nothing older.** What an earlier schema did,
  and why a rule changed, lives in `references/schema.md`; the checker reads older documents,
  the author does not. The multi-repository material moved to `references/multi-repo.md` and
  the autonomous-route procedure to `references/autonomy.md`, each read only when the profile
  calls for it. Skills no longer read `references/prose.md` up front: `check-set.mjs` enforces
  the same rules and names the one that fired, so the document is read when a hint needs
  interpreting or a `full`-tier budget must be planned. Every skill read all of this on every
  invocation; most invocations needed none of it.
- **Templates carry only contract.** `schema_version: 7`, no all-tiers markers, and no
  `created`, `updated`, `generated_from`, `skills_in_force` or `superseded_by` lines — git
  holds the dates and the rest is optional provenance. The plan template loses `Input and
  scope`, `Definition of done`, `Open questions` and `Execution log`: the first two restated
  the frontmatter and a fixed checklist, open-question sections are added only when a question
  exists, and `plan-check mark` now creates the execution log. The spec template loses `Scope`
  and its `Open questions and decisions` scaffold, and `Scenarios` is required from `standard`.
  The `History` subsections are gone; git log is the history. A light plan is four sections.

### Upgrading

Nothing changes for existing artifact sets. New sets follow the profile: raise `sdlc_version`
to 7 to get marker-free templates, body pins and `/create-light`; `migrate-schema.mjs` reports
what a raised document would newly fail before writing. A repository that keeps an older
`sdlc_version` and authors from the new templates sees the new warning rather than a silent pass.

## 0.4.0 — 2026-09-09

### Added

- **A length limit on execution-log notes.** `plan-check mark` refuses a `--note` longer than the
  profile language's limit (`limits.logNote`: ko 120, en 260), and `lint-prose.mjs` reports
  `long-log` for an entry that got there by hand. Execution-log entries are not entities, so none
  of the item limits reached them: a single 800-character note passed as long as the section total
  fit. Only the note after the deviation label is measured; the date, task IDs and result in front
  of it are written by the tool. `/implement-spec` and the plan template now ask for one sentence,
  saying what differed and how.
- **`test-drift-lang`.** Where a repository writes its acceptance criteria in the profile language
  and its test names as code identifiers, the word overlap `test-drift` measures is structurally
  zero and the rule fires on every task. The linter now says once per document that the comparison
  cannot be made, and leaves it to a person.

### Fixed

- Vendored intent and spec documents are read again for cross-reference instead of being deleted.
  Skipping their prose also removed the tier that sizes every budget and the acceptance criteria
  `test-drift` compares against, so in a consumer repository a `full` plan was measured against
  `standard` budgets and `test-drift` never ran at all. A plan's own `tier` is now the last resort
  behind the intent's, for an artifact directory that holds no intent or finding.

### Upgrading

Existing plans can newly fail. `check-all` runs the prose linter in strict mode, so a long
execution-log entry fails CI as a warning, and an entry over twice the limit is an error in every
mode. Both are fixed by shortening the note: the cause, the attempts and the log excerpts it
usually carries are already in the commit message and the verify log. Consumer repositories that
vendor their upstream documents will also see budgets recomputed at the intent's tier, which is
usually more generous than the `standard` they were being measured against.

## 0.3.0 — 2026-09-09

### Added

- **`--json` on `check-artifacts.mjs` and `lint-prose.mjs`.** Both emit structured diagnostics, so
  the artifact gate's warning count and the schema migration read a machine-readable result rather
  than parsing terminal output whose wording changes with the profile language.
- **More contract keyword aliases.** The change-history section title, the legacy ADR header-table
  status values, and case variations of every parsed section title are now accepted in both
  languages.

### Changed

- **Runtime sources and tests use English prose.** Reference documents, prompt templates,
  JavaScript comments, and test names now use English consistently. Redundant comments were
  removed while preserving the compatibility fixtures for bilingual artifact contracts.
- **Generated hook comments use English.** The approval and artifact-gate shims now explain
  runtime discovery and their responsibilities in English, and the README title is `Skills`.

### Fixed

- ADR indexes render in the profile language and check against that same rendering. Legacy status
  tables accept English and Korean values and reject unknown states.
- English change-history headings no longer count task IDs as execution evidence; ADR summaries
  remove both chosen markers and accept section-title case variations.
- Runtime smoke tests await asynchronous checks before recording their results, including the
  locale bundle and template parity checks — a failure in either was recorded as a pass.
- `repository` in `plugin.json` named `ReStartAllKill/restart-harness`, which does not exist. The
  plugin lives in `ReStartAllKill/skills`.

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
