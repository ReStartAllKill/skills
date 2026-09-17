# SDLC runtime

Personal use can rely on the runtime bundled with the SDLC plugin. Teams and CI should pin the conventions, tools, and references under `.claude/sdlc`.

When the profile has no `sdlc_runtime`, discovery order is the repository's `.claude/sdlc` copy followed by `sdlc-runtime/` in the installed restart-harness plugin. **This order is policy:** the repository-pinned copy takes precedence so the team, hooks, and CI use the same checker.

## Tools

| Tool | Purpose |
|---|---|
| `check-artifacts.mjs` | Check one artifact set's structure and traceability |
| `lint-prose.mjs` | Check artifact prose |
| `check-set.mjs` | Run both of the above over one directory and print one report |
| `check-all.mjs` | Check all artifact sets, bands, and policies |
| `plan-progress.mjs` | Compare completion claims with commits, tests, and verification evidence |
| `verify-run.mjs` | Run verification and record logs and fingerprints |
| `task-evidence.mjs` | Calculate task-definition and file-content fingerprints |
| `pin.mjs` | Print an upstream document's `body:<hex>` pin (v7 and later) |
| `sdlc-metrics.mjs` | Report SDLC flow indicators from git history and the artifacts |
| `usage-ledger.mjs` | Record and report the model tokens an artifact set cost |
| `plan-levels.mjs` | Calculate dependencies and execution levels |
| `task-worktree.mjs` | Create worktrees and commit, merge, and clean up tasks |
| `task-worktree.mjs finish` | Commit, merge, and remove one task in one call, stopping at the first failure |
| `task-brief.mjs` | Generate a writer-agent prompt |
| `guard-approval.sh` | Guard approval transitions and edits to approved documents |
| `gate-artifacts.sh` | Check edited artifacts, record their token usage, and summarize duplicate warnings |
| `sdlc-lib.sh` | Resolve profiles and paths for hooks |
| `install-hook.mjs` | Register hooks while preserving existing settings |
| `bands.mjs` · `autonomy.mjs` | Check bands and autonomous-execution policies |
| `dispatch-auto.mjs` | Run, check, commit, and record an autonomous route |
| `migrate-schema.mjs` | Migrate profile and document versions |
| `vendor-runtime.sh` | Pin, update, and check runtime drift |

## Hooks and CI

Local hooks provide fast feedback. They may not run when the runtime is unavailable, so use direct checks and CI as well. The guard recognizes Edit, Write, and common Bash edits to approval fields; it is not a security boundary that can interpret every shell command.

- Approval edits return `permissionDecision: "ask"`; in `dontAsk` mode they are denied with a reason.
- An approval whose `approved_by` equals `generated_by` is refused outright, with no dialog: the checker rejects that value, so there is nothing a person could approve.
- A person cannot answer during noninteractive execution. Follow `references/autonomy.md` for policy approval.
- The gate checks edited artifact sets; CI checks every artifact set.

```sh
node <sdlc_runtime>/tools/install-hook.mjs <repo-root>
node <sdlc_runtime>/tools/check-all.mjs <repo-root> --required
```

`--required` is the CI mode: a missing profile or zero artifacts fails. Default mode skips repositories without a profile and permits an existing empty artifact directory. With a profile, a missing `spec_dir`, missing configured band or policy file, or read error fails. Band and policy checks still run with no artifact sets. Artifact, prose, and progress checks always run in strict mode. Expired policies produce warnings, and the dispatcher rejects new runs against them.

If no CI exists, report that it is not connected. Verify workflow execution and required-check settings separately with the hosting service.

## Token usage

Every other indicator in this runtime is derived: `plan-progress.mjs` reconstructs what happened from commit trailers and verify-log headers rather than believing the plan. Token usage is the one exception, because there is nothing in the repository to derive it from — the count exists only in the session transcript, which is not committed and does not survive.

So it is captured instead. `gate-artifacts.sh` runs `usage-ledger.mjs record` on every edit to an artifact inside a set, before the blocking checks, and appends one snapshot to `<verify_log_dir>/usage/<set>.json`. Recording before the checks is deliberate: a rejected edit spent its tokens too, and charging only the edits that passed would make rework look free.

```sh
node <sdlc_runtime>/tools/usage-ledger.mjs report <repo-root>          # per set, with dollars
node <sdlc_runtime>/tools/sdlc-metrics.mjs <repo-root>                 # alongside the flow indicators
```

Four properties are worth knowing before reading a number out of it.

- **A snapshot holds a delta, not a cumulative.** A transcript's usage covers the whole session, so what belongs to one artifact is the growth since that session was last recorded anywhere in the repository. The cursor lives in `<verify_log_dir>/usage/.sessions.json`; deleting it makes the next snapshot charge a session's whole history again. The ledgers are evidence and belong in Git with the verify logs, but the cursor is local state about one machine's sessions — ignore it.
- **A snapshot copies the rates it used.** Rates change, and repricing old tokens with a new table silently rewrites what past work cost. `pricing.mjs` is consulted for new snapshots only.
- **Cost is stored in whole micro-USD.** A float total is not reproducible — summing the same snapshots in a different order moves the last digit — so the arithmetic is integer, in BigInt where `tokens × rate` would pass 2^53.
- **An unmeasured set is not a free one.** No ledger, no transcript, or a model with no published rate all report `unmeasured` with a reason. A cost that quietly omitted an unpriced model would be read as a complete total.

These are subscription or API tokens as the transcript reports them, not an invoice. For billed amounts, use the Admin API usage and cost reports.

## Pinning the runtime

```sh
<sdlc_runtime>/tools/vendor-runtime.sh          <repo-root>
<sdlc_runtime>/tools/vendor-runtime.sh --update <repo-root>
<sdlc_runtime>/tools/vendor-runtime.sh --check  <repo-root>
```

After pinning, set `sdlc_runtime` to `.claude/sdlc` in the profile and commit both. `--check` compares the invoked source with the vendored copy by version and content. If the vendored copy is maintained independently, do not require it to match the global copy in CI.

## Language and machine output

`adr-index.mjs` renders the index according to the profile's `lang`; `--check` compares against that same rendering. Regenerate the index after changing the language. For legacy ADRs without frontmatter, the header table accepts both `Status` and `상태` and maps known values to common status codes. Unknown statuses are errors and are never treated as effective decisions.

The `--json` output of `check-artifacts.mjs`, `lint-prose.mjs`, and `check-set.mjs` contains `version: 1`, `problems`, `counts.errors`, `counts.warnings`, `exitCode`, `title`, and `notes`. Use a problem's `level` for decisions; treat `msg` and `hint` as display text and never parse their wording. An environment failure can occur before JSON is emitted, so consumers must handle both nonzero exit codes and JSON parse failures. `--strict` makes warnings fail in JSON mode too. `check-set.mjs` adds a `tool` field (`check` or `lint`) to every problem and exits 2 when either child produced no report. Hook warning aggregation and schema migration consume this machine output.

CLI guidance may still contain Korean. It is not used as a checking criterion for English input.
