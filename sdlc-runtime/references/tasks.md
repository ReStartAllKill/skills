# Task contract

A plan task has the following five fields. Since schema v4, its commit and verification log are required as completion evidence.

```markdown
- [ ] **WP-001 — Exclude archived documents from default search**
  - files: `search/query.ts`, `search/query.test.ts`
  - depends: none
  - covers: FR-001 (AC-001, AC-002)
  - tests: <AC-001 sentence> · <AC-002 sentence>
  - verify: npm run gate
```

- Size one task for roughly one agent invocation and one commit.
- Keep source and tests in the same task. Use a separate task only when adding regression tests is itself the objective.
- Put the AC sentences corresponding to `covers` in `tests`.
- Tasks at the same level must not overlap in `files`. Merge overlapping tasks or order them with `depends`.
- Put the profile's task-scoped verification command in `verify`.

## Execution tools

`plan-levels.mjs` derives levels from dependencies, and `task-worktree.mjs` creates a worktree for each task. `task-brief.mjs` fills `references/writer-prompt.md` with the ACs and applicable rules.

The commit tool stages only additions, modifications, and deletions among the declared files. If an out-of-scope file is already staged, it stops without changing the index. By default, it also refuses to remove a worktree that still has uncommitted changes.

Every task commit contains both trailers. The plan path is relative to the repository root.

```text
SDLC-Task: WP-001
SDLC-Plan: .sdlc/specs/2026-09-05-search/plan.md
```

A commit with the same task ID but a different plan path does not belong to the task.

A squash merge concatenates every task commit's message and joins their trailers, so a merged commit may read `SDLC-Task: WP-001, WP-002` or carry several trailer pairs. Both forms attribute the commit to each task named. A trailer line containing anything that is not a task ID attributes nothing — a garbled line must not be read as a partial match.

Attribution scans every commit reachable from the evidence point, not only those after the plan entered Git. The plan path in the trailer already binds a commit to this plan; a lower bound at the plan's first commit only ever excluded evidence, most visibly in a repository that started tracking an artifact directory it had ignored until then. The file-history hint still starts at that commit, because a file touched before the plan existed says nothing about the plan.

## Verification and completion

Run the profile's complete `verify` command through `verify-run.mjs` at the final level. Run additional gates, and intermediate task-scoped runs, separately with `--label`. Logs go under `<verify_log_dir>/<slug>/` and are committed with the plan update.

The evidence is the header above `---`: it contains the fingerprints, repository hash, HEAD, and exit code, and the checker reads only that header. Output below `---` helps a person investigate failure, so a **passing run keeps only its final 40 lines**. A failed run keeps up to 2,000 lines; beyond that it retains the first 400 lines and the end. The header's `sha256` identifies the complete output for comparison with a separately retained original; the checker does not authenticate that output or prevent edits to a local log. Its `output` field describes what was retained.

Do not put commit SHAs or verification-log names in the Execution log section. `plan-progress.mjs` finds both directly from trailers and the log directory. The only value unique to that line is a deviation from the plan. For tasks completed as planned, `mark` appends their IDs to the earlier line from the same day; the checker scans the whole section, so grouped IDs still count individually.

Write that deviation as one sentence: what differed and how. `mark` refuses a `--note` longer than the profile language's limit, and `lint-prose.mjs` reports `long-log` for a hand-edited entry over it. Cause, attempts and log excerpts belong in the commit message and the verify log; copied here they bury the one thing this section exists to show. If the plan itself was wrong, run `/iterate-spec` instead of writing a longer note.

`plan-progress.mjs` uses the newest log for the same spec and full verification command. It never substitutes an older success for a newer failure. All of these conditions must hold:

- Exit code 0, no label, and a command equal to the profile's `verify`.
- The same spec path and task IDs, and matching task-definition and file-content fingerprints.
- A matching whole-repository fingerprint, including tracked files and untracked files not ignored by Git, while excluding `spec_dir`, `verify_log_dir`, and `.claude/autonomy-runs.jsonl`.
- Neither the task-file nor repository fingerprint changed during verification.
- The verified Git HEAD remains in current history and contains the task commits.

An active plan is compared with current files. For a committed completed plan, the tool reads the files, tests, profile, and verification logs as of the final plan commit, so later artifact-set changes are not applied retroactively. Checkbox and Execution log edits do not affect a task fingerprint. A legacy log without task and repository fingerprints, or a task commit without `SDLC-Plan`, is not v4 completion evidence. Reverify or inspect the real task history instead of fabricating records.

## Acceptance criteria

The spec's `- [ ] AC-001` boxes are never ticked, by any tool or by hand. Schema 7 pins the spec body byte for byte in the plan's `spec_version`, and the approval guard refuses body edits to an accepted document; a spec whose text can drift after approval is a spec nobody approved. A criterion is instead derived: it is satisfied when every task whose `covers` names it — directly, or through its requirement — is checked. `plan-progress.mjs` reports the result under «수용 기준» and in `acceptance` of its `--json` output, and `mark` names the criteria a check completed. A criterion no task covers is reported as uncovered rather than as open, and a box ticked by hand in the spec is reported as a claim without evidence.

The final full verification passes every task ID in the plan to `--tasks`, and its log is the completion evidence for all of them. An intermediate join point may instead run the profile's `verify_scoped` with `--label scoped`, which records what ran without claiming completion: a labelled log is never completion evidence, whatever command it ran. Git-ignored environment files and external-service state are outside the fingerprint, so reverify after those conditions change. Test-name presence is only a supporting check. Determine whether a test verifies its behavior by comparing code and tests against each AC and by independent audit. Check additional gates and required manual verification separately.


## Recovery after interruption

Run `plan-resume.mjs <set> [--json]` before choosing the next action. It distinguishes
pending implementation, commits waiting in a task branch, integrated code, final full
verification, pending completion records, and completion review. `plan-levels` reports
static dependencies and checkbox completion; it is not a recovery cursor.

A scoped passing log allows the next level to run but never checks a task off. The log
must match its committed snapshot and contain the task's commits. Later dependent commits
do not erase that integration evidence; final completion still requires a full run matching
the final repository. A newer scoped failure requires verification again.

`plan-check mark --result partial|failed` records an attempt and leaves the task unchecked.
Only `--result done` checks it after the completion evidence is present. Pending plan edits
and verification logs are expected recovery inputs; unrelated dirty files block recovery.
