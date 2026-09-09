# SDLC runtime

Personal use can rely on the runtime bundled with the SDLC plugin. Teams and CI should pin the conventions, tools, and references under `.claude/sdlc`.

When the profile has no `sdlc_runtime`, discovery order is the repository's `.claude/sdlc` copy followed by `sdlc-runtime/` in the installed restart-harness plugin. **This order is policy:** the repository-pinned copy takes precedence so the team, hooks, and CI use the same checker.

## Tools

| Tool | Purpose |
|---|---|
| `check-artifacts.mjs` | Check one artifact set's structure and traceability |
| `lint-prose.mjs` | Check artifact prose |
| `check-all.mjs` | Check all artifact sets, bands, and policies |
| `plan-progress.mjs` | Compare completion claims with commits, tests, and verification evidence |
| `verify-run.mjs` | Run verification and record logs and fingerprints |
| `task-evidence.mjs` | Calculate task-definition and file-content fingerprints |
| `plan-levels.mjs` | Calculate dependencies and execution levels |
| `task-worktree.mjs` | Create worktrees and commit, merge, and clean up tasks |
| `task-brief.mjs` | Generate a writer-agent prompt |
| `guard-approval.sh` | Guard approval transitions and edits to approved documents |
| `gate-artifacts.sh` | Check edited artifacts and summarize duplicate warnings |
| `sdlc-lib.sh` | Resolve profiles and paths for hooks |
| `install-hook.mjs` | Register hooks while preserving existing settings |
| `bands.mjs` · `autonomy.mjs` | Check bands and autonomous-execution policies |
| `dispatch-auto.mjs` | Run, check, commit, and record an autonomous route |
| `migrate-schema.mjs` | Migrate profile and document versions |
| `vendor-runtime.sh` | Pin, update, and check runtime drift |

## Hooks and CI

Local hooks provide fast feedback. They may not run when the runtime is unavailable, so use direct checks and CI as well. The guard recognizes Edit, Write, and common Bash edits to approval fields; it is not a security boundary that can interpret every shell command.

- Approval edits return `permissionDecision: "ask"`; in `dontAsk` mode they are denied with a reason.
- A person cannot answer during noninteractive execution. Follow `references/autonomy.md` for policy approval.
- The gate checks edited artifact sets; CI checks every artifact set.

```sh
node <sdlc_runtime>/tools/install-hook.mjs <repo-root>
node <sdlc_runtime>/tools/check-all.mjs <repo-root> --required
```

`--required` is the CI mode: a missing profile or zero artifacts fails. Default mode skips repositories without a profile and permits an existing empty artifact directory. With a profile, a missing `spec_dir`, missing configured band or policy file, or read error fails. Band and policy checks still run with no artifact sets. Artifact, prose, and progress checks always run in strict mode. Expired policies produce warnings, and the dispatcher rejects new runs against them.

If no CI exists, report that it is not connected. Verify workflow execution and required-check settings separately with the hosting service.

## Pinning the runtime

```sh
<sdlc_runtime>/tools/vendor-runtime.sh          <repo-root>
<sdlc_runtime>/tools/vendor-runtime.sh --update <repo-root>
<sdlc_runtime>/tools/vendor-runtime.sh --check  <repo-root>
```

After pinning, set `sdlc_runtime` to `.claude/sdlc` in the profile and commit both. `--check` compares the invoked source with the vendored copy by version and content. If the vendored copy is maintained independently, do not require it to match the global copy in CI.

## Language and machine output

`adr-index.mjs` renders the index according to the profile's `lang`; `--check` compares against that same rendering. Regenerate the index after changing the language. For legacy ADRs without frontmatter, the header table accepts both `Status` and `상태` and maps known values to common status codes. Unknown statuses are errors and are never treated as effective decisions.

The `--json` output of `check-artifacts.mjs` and `lint-prose.mjs` contains `version: 1`, `problems`, `counts.errors`, `counts.warnings`, `exitCode`, `title`, and `notes`. Use a problem's `level` for decisions; treat `msg` and `hint` as display text and never parse their wording. An environment failure can occur before JSON is emitted, so consumers must handle both nonzero exit codes and JSON parse failures. `--strict` makes warnings fail in JSON mode too. Hook warning aggregation and schema migration consume this machine output.

CLI guidance may still contain Korean. It is not used as a checking criterion for English input.
