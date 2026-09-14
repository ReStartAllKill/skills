# Autonomous execution

A policy approved and committed in advance delegates the scope for writing documents. Each document's approver is `policy:<route-id>`, and the policy's `owner` is accountable for the delegation.

## Policy format

Use the profile's `autonomy` path, which defaults to `.claude/autonomy.yml`.

```yaml
version: 1
owner: "Platform team lead"
routes:
  ci-failure-triage:
    trigger: band_breach
    bands: [ci_test_failure_rate]
    max_tier: light
    advance_to: intent
    tools: "Read,Grep,Glob,Edit,Write"
    expires: 2026-12-31
    max_turns: 80
```

Every route requires `trigger`, `max_tier`, `advance_to`, `tools`, and `expires`.
`max_tier` is `light` or `standard`; autonomous policy cannot approve `full`.
Choose `advance_to` from `finding`, `intent`, `spec`, and `plan`. The compatibility value `implement` requires `target_branch`, but the current dispatcher only writes through plan and does not run implementation.

## Execution

```sh
node <sdlc_runtime>/tools/dispatch-auto.mjs <repo> \
  --route ci-failure-triage --signal "CI failure rate 12.4%" [--dry-run]
```

1. Check the profile, policy, expiry, and guard registration. A real run starts only from a clean Git worktree.
2. Keep `spec_dir` outside `.claude/`; see `references/profile.md` for the reason and default.
3. Add `Skill`, the three Git read operations, and the checker, linter, and band-check commands to the policy's tools before execution. The default turn limit is 80. A tool allowlist does not replace a sandbox that restricts complete file paths.
4. After the agent exits, check the complete artifact set in required mode. Commit only the artifacts after confirming agent success, check success, artifact changes, and an empty index. Treat a commit failure as an execution failure.
5. Append the allowed scope, actual tool use, denial count, cost, checks, and commit result to `.claude/autonomy-runs.jsonl`. Exclude only that log file from the preflight worktree check; all other modified and untracked files still block execution.

`--dry-run` only displays the execution command. It does not invoke the agent or commit anything.

## What the writing skills do under a route

The dispatcher's prompt begins with “자율 실행이다” and sets `SDLC_AUTONOMY_ROUTE`. In such a run the shared skill procedure of `conventions.md` changes in three places.

- Ask nothing. Record anything that would require asking as an open question and leave that
  document in `in_review`.
- Set approval edits to `approved_by: policy:<route-id>`. Do not approve a document beyond the
  delegation's `max_tier` or after `advance_to`.
- The dispatcher performs the commit and final validation. Do not attempt tools outside the
  allowed set; record them as work that could not be done.

## Approval boundary

The guard permits only the policy approval matching the run's `SDLC_AUTONOMY_ROUTE`.
The checker compares policy existence, expiry, maximum tier, and final stage. Do not use `policy:` approval in a human session.

When the work exceeds the delegation or lacks enough information for a decision, leave `approved_by` empty and the status `in_review`. Record open questions and actions not taken. A person decides when to run `/implement-spec`.

```sh
node <sdlc_runtime>/tools/autonomy.mjs <repo> --strict
```


## Historical approvals and execution limits

Expiry stops new delegated approvals after the end of the expiry date (UTC). Existing
contracts are checked against the policy and commit time of their matching accepted Git
version. Plan checkboxes and execution notes do not change that contract. Changing the
contract or approver requires a current delegation or a new human approval. Keep full Git
history in artifact CI (`fetch-depth: 0`); shallow history cannot establish old approvals.
Policy removal stops future use without erasing a valid historical approval.

The dispatcher compares non-artifact files before and after the agent. An out-of-scope edit
is preserved and fails the run before checking or committing artifacts. This is detection,
not filesystem isolation. `max_turns` and optional `timeout_ms` must be positive integers;
the process timeout defaults to 30 minutes. Failed and timed-out work remains for inspection.
