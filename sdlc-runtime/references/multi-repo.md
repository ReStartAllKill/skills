# Changes spanning multiple repositories

Read this when the profile has `repo`, `upstream_repo`, or `spec_consumers`. Without them an
artifact set belongs to one repository and none of this applies; `conventions.md` keeps the
two rules that hold everywhere — one spec per system, and `scope:` on acceptance criteria.

**Write one spec per system; do not split it by repository.** When one feature normally crosses
contracts, backend, and frontend, repository-specific specs repeat the same requirement. Once
those copies diverge, nobody can say which one is authoritative for behavior.

Instead, **state which repository implements each acceptance criterion.**

```markdown
### FR-003 — Write-down reduces the outstanding issuance `Must`

basis: OUT-002
scope: rwa-contracts, rwa-backend

Acceptance criteria:

- [ ] AC-007 — Once the write-down is confirmed, the on-chain balance decreases `scope: rwa-contracts`
- [ ] AC-008 — After confirmation, the query API returns the reduced balance `scope: rwa-backend`
```

Write `scope` either on the requirement's `scope:` line or as `` `scope: <repo>` `` at the end of
an acceptance-criterion line. A criterion without one inherits its parent requirement's scope.
Repository names are compared by their final path component, so `acme/api` and `api` name the same
repository. **This syntax is available from v6.** The checker rejects it in documents declaring
an older schema.

## Ownership by repository

| Location | Owns | Profile |
|---|---|---|
| Document repository (upstream) | Authoritative `intent.md`, `spec.md`, and ADRs | `spec_consumers` |
| Code repository (consumer) | `plan.md`, vendored copies, `upstream.lock.json`, execution evidence | `upstream_repo`, `repo` |

The code repository always owns the plan and execution. It is where `/implement-spec` creates
worktrees and runs verification. If the plan is reviewed in a different PR from the code diff,
plan review has no effect. The checker warns when an upstream document repository contains a plan.

## Tools create copies; hashes protect them

Manual copying leaves provenance only in someone's memory. `pull-spec.mjs` retrieves approved
upstream documents and records the **upstream path, upstream commit, and content hash** in
`upstream.lock.json`. It serves the same role as a package lockfile.

```sh
node <sdlc_runtime>/tools/pull-spec.mjs <artifact-directory> [--from <upstream-checkout>]
```

- Commit the copy and lock **together**. Without a lock, the checker treats the set as belonging
  to a single repository.
- The copy is **read-only**. Editing it changes the hash and the gate blocks it. Make changes
  upstream with `/iterate-spec`, then pull it again.
- A plan's `spec_version` is **the upstream commit referenced by the lock**, not the commit that
  brought the copy into the code repository. The latter says only when it was received and cannot
  detect later upstream changes. For the same reason a `body:` pin is rejected while a lock
  exists: the text of a copy says nothing about how far upstream has moved on.
- Approval happens upstream. Documents not in `accepted` are not pulled. `--force` may be used to
  inspect a draft early, but it must be pulled again after approval.

## Coverage has two layers

| Location | Checks |
|---|---|
| Code repository | Does its plan cover every Must acceptance criterion whose `scope` is this repository? (rule 5-5) |
| Document repository | Is every Must acceptance criterion assigned to **at least one consumer repository**? |

A repository cannot detect locally that its entire share is missing; only upstream can. Work that
covers another repository's share is also rejected, because duplicate implementations can diverge
when integrated.

## Check upstream freshness when a checkout is available

The checker does not use the network. If an upstream checkout is available through `SDLC_UPSTREAM`
or a sibling checkout whose origin matches that repository, it compares the locked commit with the
current upstream commit and reports a stale copy as **an error**. Otherwise it checks only copy
integrity and records that limitation as a note. CI checks out upstream and points to it with
`SDLC_UPSTREAM`.

## Keep ADRs in one place

Decisions often cross repository boundaries. Giving every repository an `adr_dir` forces repeated
decisions about where an ADR belongs and splits the numbering space. Designate one document
repository as `adr_repo`; code repositories keep only `<repo>#ADR-NNN@<sha>` pins. Organizations
whose decisions never cross a repository boundary may use `adr_dir` instead.
