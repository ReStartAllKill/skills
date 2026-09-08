# Changelog

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
