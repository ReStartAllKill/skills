# Repository profile

Global skills define the method. Repository facts and the applicable SDLC version belong in `.claude/spec-profile.yml`; `/sdlc-init` creates and updates it.

## Keys

| Key | Purpose | Default |
|---|---|---|
| `sdlc_version` | Schema for new artifact sets | `1`, for compatibility with legacy profiles |
| `sdlc_runtime` | Path to conventions and checkers | Discovery order in `runtime.md` |
| `lang` | **Artifact language**: `ko` or `en`; selects prose lists and budgets | `ko` |
| `spec_dir` | Artifact location; keep it outside `.claude/` | `.sdlc/specs` |
| `owner` | Default `approved_by` identity | `git config user.name` |
| `verify`, `verify_scoped`, `scope_hint` | Full and task-scoped verification; `/implement-spec` runs `verify_scoped` at intermediate join points and `verify` once at the final level | Discover from CI and build configuration |
| `bootstrap` | Dependency setup for a new worktree | Run tasks sequentially when absent |
| `source_roots`, `worktree_dir` | Source and worktree paths | Repository root and `.claude/worktrees` |
| `writer_agent`, `pattern_agent`, `prior_work_agent`, `audit_agent` | Agent for each role | `general-purpose` or `Explore` |
| `commit` | Commit-message convention | Infer from `git log` |
| `bands` | Detection-band registry | `.claude/bands.yml` |
| `extra_gates` | Repository-specific gates | None |
| `verify_log_dir` | Committed integration verification logs | `.sdlc/verify` |
| `repo` | This repository's `<owner>/<name>`; defines assignment and ADR scope boundaries | None; boundary checks are skipped |
| `upstream_repo` | Documentation repository supplying intent and spec | None; single-repository mode |
| `spec_consumers` | Code repositories consuming this repository's specs | None; this is not an upstream repository |
| `adr_dir` | Decision-record directory | None; ADR checks are skipped |
| `adr_repo` | `<owner>/<repo>` when decisions live elsewhere | None; same repository |
| `adr_index` | Generated decision index | `<adr_dir>/index.md` |
| `pr_base` | Default base branch for `/create-pr` | `main` |
| `pr_workspace_dirs` | Top-level directories used to group changes | Top-level directory names only |
| `pr_split_dir`, `pr_split_hint` | Ask about splitting when changes span multiple children | None |
| `pr_review_focus` | `<regex> => <name>` rules that require direct diff review and a Risks section | None |

Contract keywords are bilingual regardless of `lang`.

## Committed and local settings

**Commit the profile.** It defines how CI checks every artifact set. If it exists only outside Git, local runs and CI can apply different rules while both appear to pass. `check-all.mjs` reports both ignored and untracked profiles.

Repository-contract keys must be committed: `sdlc_version`, `sdlc_runtime`, `lang`, `spec_dir`, `verify`, `source_roots`, `extra_gates`, `bands`, `adr_dir`, `repo`, `upstream_repo`, `spec_consumers`, and `pr_*`.

Machine- or person-specific keys are `owner`, role-specific agent names, `worktree_dir`, and `bootstrap`. Omit only the keys whose values differ between contributors.

`owner` is a default, not an authorization rule. In a shared repository, omit it so each contributor's `git config user.name` becomes `approved_by`. If approval eligibility must be restricted, define a separate allowlist and guard; do not overload `owner`.

## Creation rules

A new profile uses the runtime's current `VERSION` as `sdlc_version`. Read an existing unversioned profile as v1 and never upgrade it automatically.

An old profile causes new artifact sets to omit newer rules silently. `migrate-schema.mjs` separates rules currently missing from changes that would fail after migration. Raising the profile affects only new sets; raising a document's `schema_version` applies new rules retroactively, so completed sets usually remain at their original version.

```yaml
sdlc_version: 5
# Set sdlc_runtime only for a vendored runtime.
# sdlc_runtime: ".claude/sdlc"
spec_dir: ".sdlc/specs"
repo: "acme/backend"       # Only when work spans repositories
upstream_repo: "acme/docs" # Remove for a single repository
adr_dir: "docs/adr"        # Remove if this repository has no ADRs
```

`lang` is a repository setting, not a user preference. A committed artifact set uses one language, and CI has no conversation from which to infer it. Write artifacts in this language even when the conversation uses another. The linter stops when no bundle exists for the configured language so an unavailable check cannot look like a pass.

Only `/create-pr` reads the PR keys. Write `pr_review_focus` as a block sequence so every matching rule is independently visible in output.

```yaml
pr_base: "main"
pr_workspace_dirs: "apps packages"
pr_split_dir: "apps"
pr_split_hint: "Changes span two or more apps; CI requires exactly one deployment label"
pr_review_focus:
  - "^packages/db/ => database schema"
  - "(authz|permission|role|session|jwt) => authorization and sessions"
  - "(secret|credential|password) => credentials and secret handling"
```

An upstream documentation repository instead uses:

```yaml
sdlc_version: 6
spec_dir: "docs/specs"
repo: "acme/docs"
spec_consumers:
  - acme/backend
  - acme/web
adr_dir: "docs/adr"
```

- Discover verification commands from `package.json`, `Makefile`, `justfile`, and CI workflows; CI is authoritative.
- Discover scope from workspace configuration. Leave it empty for a single package.
- Select agents from descriptions in `.claude/agents/*.md`.
- Never invent missing values. Leave them empty and ask the user.
- Warn when `spec_dir` is ignored by Git because SHA pinning becomes weaker. Always commit the profile.
- Never ignore `adr_dir`. ADRs preserve constraints and rejected alternatives after an artifact set is obsolete. Use `adr_repo` when decisions live elsewhere.
- In a repository with `upstream_repo`, never ignore `spec_dir`. Commit both the imported copies and `upstream.lock.json`; only `pull-spec.mjs` should update them, and their hashes protect them.
- Each `spec_consumers` entry is compared with a consumer profile's `repo` and final path component. Typos produce an “unregistered repository” error.
- Do not put `spec_dir` under `.claude/`. Claude Code treats each Write or Edit as a settings change that requires confirmation; autonomous routes are denied. Migrate legacy `.claude/specs` directories to `.sdlc/specs`.

Check whether the selected runtime supports the configured schema:

```sh
node <sdlc_runtime>/tools/check-artifacts.mjs --supports-schema <sdlc_version>
```

If it does not, align the runtime version or perform an explicit migration.
