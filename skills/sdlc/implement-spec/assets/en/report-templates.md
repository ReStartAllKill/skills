# Report formats

## Progress (Step 1b)

```
spec: <name>  (<spec_dir>/<slug>/)
main tree: <path>   branch: <target_branch>  (clean)

level 1 [parallel]: [x] WP-001  [x] WP-002   — done
level 2 [parallel]: [ ] WP-003  [ ] WP-004   — starting here
level 3 [main]:     [ ] WP-005

Starting level 2 (WP-003 and WP-004 in parallel).
```

## Level complete (Step 2f)

```
level <N> complete — WP-003, WP-004, full verify passed (.sdlc/verify/<slug>/L<N>-….log)
(if any) manual verification left: <item>

Moving to level <N+1> (WP-005).
```

## Final report (Step 3b)

```
Implementation <complete / automated checks complete, manual verification pending>: <spec name>

tasks: 6/6
full verify: passed  (gates that applied: <list>) · records .sdlc/verify/<slug>/ <n> files
plan-progress: 0 mismatches (tests sentences · verify records · attributed commits)
independent audit: <agrees / diverges on AC-00x — unconfirmed / skipped — no audit_agent>

requirement coverage:
- FR-001 / AC-001 — <path>:<line> / test <path>:<line>
- FR-002 / AC-003 — <path>:<line>

manual verification left:
- [ ] <item>

next:
- [ ] open the PR
```
