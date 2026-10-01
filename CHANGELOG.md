# Changelog

## Unreleased

### Fixed

- **The Bash approval guard refuses approval rewrites of artifacts instead of ordinary commands.**
  It matched tool words as substrings of the whole command, so `superseded`, `closed` and `based`
  read as `sed` and `committee` as `tee`, and a commit message or a read-only `grep` that
  mentioned `status: accepted` was refused — while `echo 'approved_by: "lee"' >> plan.md` and a
  `cat` heredoc into an artifact passed, the quoted value and `cat` both escaping the rule. The
  decision moved into `approval-bash.mjs` and now needs three facts together: a command word in
  command position that can write, or an output redirection — an interpreter only when the
  command carries its program (inline flag, heredoc, here-string, pipe into a bare interpreter),
  since a named script that rewrote an approval would hold the words in its file, out of the
  guard's sight, and counting it refused `node tools/pin.mjs … && grep "status: accepted" …`; the approval pattern as before, now
  also with a quoted value; and a path that is an artifact by the same rule the Edit branch uses
  (intent, spec or plan under `spec_dir`, an ADR under `adr_dir`, task worktrees included). A
  writer and the pattern with no recognisable file at all, as in `sed -i … "$f"`, or a writer
  fed its files by `xargs` or `find -exec`, is still refused as an unknown target; passing it was rejected because it would make a variable a
  silent way round the guard that the old rule did not have. A repository with no profile is no
  longer guarded on Bash, as it was not on Edit. Variable paths beside a named harmless one, `cd`
  before a relative path and files written by a script the command only names stay uncovered,
  and say so in `references/runtime.md`.
- **A finished set no longer turns red when a decision it pinned is superseded later.** Pins
  were judged against today's ADR statuses, and `check-all` walks every set, so superseding an
  ADR failed CI on every completed set that had pinned it — history nobody can rewrite. A closed
  set (plan `completed`, or plan or intent `superseded` or `rejected`) is now judged against the
  decision's status at the commit that closed it, read from git; a decision in force then and
  dead now is a note. «Closed» alone was rejected as the test: the edit that writes `completed`
  is checked with `completed` already in it, so a set could close on top of a dead decision and
  pass. A set closed on a decision already dead, an uncommitted closing edit, and history too
  shallow to find the commit all stay errors. The task-scope warning follows the same rule: a
  closed plan is not asked to pin a decision accepted after it closed, and still is for one
  accepted before. Notes from these checks now reach the report; an `info` pushed into problems
  used to vanish.
- **`check-all` prints the notes of a check that passed.** It ran each check as a child and
  printed its output only on failure, so a passing check's notes never reached CI: under
  `adr_repo` with no upstream checkout, «체크아웃이 없다 — 매니페스트가 최신인지 대조하지 않았다»
  became a bare `결정 바인딩 통과`, and the closed-set notes above were dropped the same way.
  Artifact, prose, ADR-folder and binding checks now run in `--json`, and their `notes` are
  printed under the `통과` line; a failing check is run again in text mode so its report reads
  as before. The schema-and-runtime line every set carries is left out, recognised by a matcher
  that sits beside the one function writing it — turning notes into objects to tell that one line
  apart was rejected as a change to `--json` for every consumer. `plan-progress` stays in text
  mode, since a run that passes `--strict` holds only info-level hints. Output that is not JSON
  from a run that exited 0 now fails rather than passing unread.
- **The closed-set history is read only when a verdict depends on it.** It costs a `git log`
  and a `git show` per commit that touched the plan, and both the pin check and the task-scope
  check read it for every closed set; a plan with 13 commits took ~620 ms instead of ~110 ms, on
  every set `check-all` walks. It is now read once per run, and only for a pinned decision that is
  no longer in force or a task that meets an unpinned decision. A closed set with live pins makes
  one git call where it made 31, and its report is unchanged.

## 0.10.0 — 2026-09-30

### Changed

- **A code repository owns the paths that bind it to a decision kept in another repository.**
  Under `adr_repo`, an ADR's `scope` held another repository's paths (`rwa-contracts:src/vault`).
  The document repository skips paths it does not own, the code repository's drift check had no
  caller, and a rename owed a second PR nobody asked for. Now the ADR names repositories
  (`applies_to`) and the code repository names paths and tests in `.claude/adr-bindings.yml`.
  `pull-adr.mjs` writes `.claude/adr-manifest.json` (status, `applies_to`, the digest
  `task-brief` injects; never a path) with an integrity hash, and prints a binding skeleton that
  carries old-form paths across. `adr-bindings.mjs`, run by `check-all`, checks a missing or
  hand-edited manifest, an applicable decision left unbound, a binding read at an older decision
  (`at`), a path or test that is gone, an opt-out with no `reason`, and — next to an upstream
  checkout — a manifest behind upstream. The plan's task-scope check and `task-brief` match
  against binding `paths`, so a decision from another repository reaches the writer at last.
  A pin into the manifest's repository is checked against it instead of passing on its SHA shape.
- `applies_to` marks the new form, since an ADR is always schema 5: with it, a repo-prefixed
  `scope` entry is an error; without it, a warning, which gates only where CI runs `--strict`.
- An ADR `scope` path that no longer exists now warns even when `confirms` is empty. The check
  used to run only alongside `confirms`, so a scope-only ADR pointed at a deleted directory
  silently.

## 0.9.0 — 2026-09-17

### Added

Four things spec-kit does that this harness did not, each taken in the form this harness can
check deterministically rather than the form spec-kit's agent prompts judge.

- **A plan that touches code an accepted ADR constrains must pin that ADR.** spec-kit's
  Constitution Check makes the plan confront the project's standing rules before design; here the
  standing rules are ADRs, and the deterministic form is `scope`. When a task's `files` fall inside
  an accepted ADR's `scope` and no document in the set pins it in `decisions:`, the checker warns.
  `task-brief` already injects the decision into the writer prompt, but `TD-*` is settled in the
  plan before any task runs, and the pin is the only evidence the plan saw it — and the only
  handle the status check has. A warning: CI runs `--strict` and gates there; a hook does not
  turn a set written before the rule red. Design against the decision goes into a superseding ADR,
  never a `TD-*`.
- **A scenario can name a release slice.** spec-kit prioritises user stories so that one story
  alone is a shippable MVP. A scenario here may now carry `` `Must` ``/`` `Should` ``/`` `Could` ``,
  and a requirement names the scenarios it realises with `scenario:` — that field is how the slice
  reaches the plan, whose tasks cite requirements only. The checker warns on a `Must` scenario no
  requirement realises, on a set where only some scenarios carry a priority, and on a `Must`-slice
  task that waits — directly or transitively — on a task realising only `Should`/`Could`
  scenarios. `plan-levels.mjs` prints each slice with the level at which it completes. A spec
  without priorities has one slice and behaves as before.
- **`pr-context.sh` lists the files no task declared.** spec-kit's `converge` classifies work
  the spec never asked for as `unrequested`; the deterministic half of that is a changed file
  outside every task's `files`. The task commit tool keeps each task inside its scope, but a
  branch also carries fix-ups made outside any task, and that is where behaviour the spec never
  asked for arrives. `/create-pr` settles each one before writing the body: the plan is stale,
  the commit leaves the PR, or `### Changes` carries it with `(spec 밖)`.
- **`term-drift` in the linter.** One backticked name spelled two ways across the set —
  `user_id` and `userId`, `CANCELLED` and `Cancelled`. Only backticked spans, because that is
  where the author has marked «this is the exact name», and only spelling variants: a different
  name for the same thing is beyond a deterministic tool, and the rule does not pretend to see it.

## 0.8.0 — 2026-09-17

### Added

- **An artifact set records what it cost in model tokens.** Nothing in a repository says how
  many tokens a document took to write — the count lives only in the session transcript, which
  is not committed and does not survive, so it is the one indicator here that is captured rather
  than derived. `gate-artifacts.sh` now appends a snapshot to `<verify_log_dir>/usage/<set>.json`
  on every edit to an artifact inside a set, and `usage-ledger.mjs report` and `sdlc-metrics.mjs`
  read it back as tokens and dollars.

  The snapshot is a delta against the session's last recorded point *anywhere* in the repository,
  not against the last entry in that ledger: a session that touched two sets would otherwise have
  its whole cumulative usage charged to both. It is written before the blocking checks, not after
  — a rejected edit spent its tokens too, and charging only the edits that passed would make
  rework look free.

- **`pricing.mjs`** holds the published Anthropic rates in whole micro-USD, and every snapshot
  copies the rows it applied. A ledger that stored only tokens and repriced at read time would
  rewrite what past work cost the moment the table was edited. Cache writes are priced by the TTL
  the transcript reports rather than by one assumed rate, and fast mode is a separate row.

### Fixed

- **Task attribution no longer vanishes when a repository starts tracking its artifacts late.**
  `plan-progress.mjs` scanned only `born..HEAD`, `born` being the commit that first added
  `plan.md`. In a repository that had ignored `.sdlc/` and then un-ignored it, `born` was the
  newest commit, the window held zero commits, and every task in every plan read «no attributed
  commit» while its trailered commits sat right below — so `mark` refused to check a single box.
  The `SDLC-Plan:` trailer already binds a commit to its plan, so the scan now covers the whole
  reachable history, as `sdlc-metrics.mjs` always did. The file-history hint keeps the bound.
- **A squash-merged trailer that names several tasks is read.** GitHub joins the task commits'
  trailers into `SDLC-Task: WP-001, WP-002`; the reader accepted only one id per line, so every
  task in a squashed PR lost its commit at once. Commas and whitespace both separate now, and a
  line carrying anything that is not a task id attributes nothing rather than partially.

### Added (acceptance criteria)

- **Acceptance criteria are derived, not ticked.** The spec's `- [ ] AC-…` boxes were never
  written by any tool, and cannot be: schema 7 pins the spec body byte for byte in the plan's
  `spec_version`, and the approval guard refuses body edits to an accepted document. So
  `plan-progress.mjs` now reports each criterion as satisfied when every task covering it is
  checked, in text and under `acceptance` in `--json`; `mark` names the criteria a check
  completed. A criterion no task covers is reported as uncovered, and a box ticked by hand in
  the spec is reported as a claim without evidence. Writing `[x]` into the spec was rejected —
  it would break every plan's pin and make the spec assert its own completion.

### Changed

- `sdlc-lib.sh` gains `sdlc_hook_slurp`, which reads the hook's stdin once so a hook can take
  more than one field from it. Without it the second `sdlc_hook_field` returns empty, and that
  empty value is indistinguishable from an absent field. `sdlc_resolve` now also sets `SDLC_KIND`
  (`set` or `adr`), because an ADR has no set directory and a caller that guessed one from
  `dirname` would treat the whole decision directory as a single set.
- `sdlc-metrics.mjs` reports `usage_tokens` and `usage_cost` under Cost. A set with no ledger is
  `unmeasured`, never 0 — it must not join a median as a free set — and a set containing a model
  with no published rate reports no cost at all rather than a total that quietly omits it.

## 0.7.1 — 2026-09-15

### Fixed

- **A research document can carry what a source showed.** The research budgets were the
  intent's, so a diagram or a benchmark output redrawn under its `SRC-*` pushed the section
  over budget and the model folded it into one sentence — which is the thing the document
  existed to keep. Fenced blocks are now outside every budget and every prose check, and the
  budgets are sized like a spec's (ko 4000/1200/400, en ×2.2). A smoke case holds the control:
  the same length as unfenced prose still warns, so «fences are outside» stays distinct from
  «the budget is off».
- **A data table is not mistaken for the comparison table.** The checker took the first table
  whose header carried `OPT-*`, so a §Data table with options as columns and measurements as
  rows was read as the comparison and failed for «missing criteria». It now prefers the table
  whose first column carries `CRIT-*` and falls back to the first candidate only when none
  does, so a genuinely missing comparison still points at the right table.

### Changed

- The research template gains an optional `§Data` section for measured values and a `mermaid`
  fence under each source; `/create-research` says to copy material into fences rather than
  paraphrase it, and to keep numbers the comparison reads in one table with the thing measured
  in the first column. A `research-with-material` negative-control case pins the baseline.

## 0.7.0 — 2026-09-14

### Fixed

- Approval guards parse proposed documents with the checker's frontmatter parser. Quoted
  statuses, body examples, duplicate approval fields and simultaneous author edits no longer
  escape or confuse the approval decision.
- Failed and partial attempts remain unchecked. Directory task scopes include descendants
  consistently in overlap detection and staging, including staged directory deletions.
- Autonomous runs preserve and reject out-of-scope edits before running checkers or committing.
  Positive turn/time limits are validated and execution has a default 30-minute timeout.
- Unchanged historical policy approvals use their accepted Git version's policy and timestamp;
  expiry prevents new approvals without invalidating old contracts. Expiry includes its UTC day.

### Added

- Read-only `plan-resume.mjs` derives the next action from task branches, integration logs and
  full verification. Scoped integration advances execution without pretending a task is complete.
- Opt-in `approval_mode: batch_light` prepares an exact reviewed digest and asks once to approve
  a v7+ light document set. Stale digests are refused; interrupted writes retain recovery records.
- `lint_warnings: advisory|error` aligns the selected prose-warning policy across save and CI.
  Existing profiles retain legacy behavior; new profiles use advisory warnings.
- Regression scenarios cover interruption and recovery, approval changes after review, scope
  conflicts, failed attempts, policy expiry, and autonomous out-of-scope edits.


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
