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
`upstream.lock.json`. It serves the same role as a package lockfile, and like one it holds no
timestamp: a second pull with nothing changed upstream leaves it byte-identical, so two branches
that both re-pull do not conflict. A lock that still carries `pulled_at` stays valid and loses the
key on the next pull.

```sh
node <sdlc_runtime>/tools/pull-spec.mjs <artifact-directory> [--from <upstream-checkout>]
```

- Commit the copy and lock **together**. Without a lock, the checker treats the set as belonging
  to a single repository.
- The copy is **read-only**. Editing it changes the hash and the gate blocks it. Make changes
  upstream with `/iterate-spec`, then pull it again.
- A plan's `spec_version` is **the upstream commit referenced by the lock**, not the commit that
  brought the copy into the code repository. The latter says only when it was received and cannot
  detect later upstream changes. For the same reason a `body:` pin is rejected in a document the
  consumer writes itself while a lock exists: the text of a copy says nothing about how far
  upstream has moved on.
- The lock does **not** override a pin *inside* the vendored pair — the `intent_version` of a
  pulled `spec.md`. Upstream wrote it against upstream's own history, both files arrive together
  and each is protected by its hash, so a `body:` pin there is checked against the pulled
  `intent.md` and a commit SHA against the lock's `intent.md` commit, exactly as upstream checks
  them. Which documents count as vendored is read from the lock's `files`. A mismatch means
  upstream's pair disagrees with itself; the copies are read-only, so it is fixed upstream and
  pulled again. Whether upstream has moved on since the pull is the freshness check (lock commit
  vs. upstream head), not this pin. When the lock has no commit for `intent.md` (a `--force` pull
  of an uncommitted draft), a commit-SHA pin there cannot be compared and is reported as a
  warning rather than measured against this repository's history.
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

`check-artifacts.mjs` and `plan-progress.mjs` answer «which criteria does this plan owe» from one
module, `tools/owed.mjs`, so the two cannot disagree. In a consumer, `plan-progress` reports another
repository's criterion as information («다른 레포 몫이다») and leaves it out of the «수용 기준 N/M»
denominator; before, it warned that nobody covered it, `check-all` runs it with `--strict`, and a
consumer that obeyed the rule above could never pass. `--json` marks such a criterion with
`owed: false` and `reason: "foreign"`. Being another repository's share wins over priority; the
other cases (`owed`, `deferred`, `unprioritised`) are in `tasks.md` under «Acceptance criteria».

## Check upstream freshness when a checkout is available

The checker does not use the network. If an upstream checkout is available through `SDLC_UPSTREAM`
or a sibling checkout whose origin matches that repository, it compares the locked commit with the
current upstream commit and reports a stale copy as **an error**. Otherwise it checks only copy
integrity and records that limitation as a note. CI checks out upstream and points to it with
`SDLC_UPSTREAM`.

## Keep ADRs in one place

Decisions often cross repository boundaries. Giving every repository an `adr_dir` forces repeated
decisions about where an ADR belongs and splits the numbering space. Designate one document
repository as `adr_repo`; code repositories keep `<repo>#ADR-NNN@<sha>` pins. Organizations
whose decisions never cross a repository boundary may use `adr_dir` instead.

The two keys are not either/or. A code repository may keep its service-local decisions in its own
`adr_dir` and bind the organisation's from `adr_repo`; both are then checked, each on its own
`check-all` line. The numbering spaces overlap, so a bare `ADR-005` — in a pin or in prose — is
always this repository's, and the upstream one is always `<repo>#ADR-005`. «Both: decisions here
and in a document repository» in `adr.md` has the rule.

The ADR names the repositories it constrains (`applies_to`); each code repository names the paths
and tests in its own `.claude/adr-bindings.yml`, next to a manifest `pull-adr.mjs` writes. A path
belongs where it can be checked and where the PR that renames it lands. «Decisions in another
repository» in `adr.md` has the format and the checks.
