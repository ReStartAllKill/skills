Independent audit — determine whether the implementation satisfies the specification by **reading only**. Do not modify files.

Specification: {spec_dir}/
Change scope: `git diff --stat {born}..HEAD` and each task's `files` in plan.md
Verification logs: {verify_logs}

## Acceptance criteria to assess

{acceptance}

## Assessment format — one line per AC

```
AC-001  satisfied    code <path>:<line>  test <path>:<line>
AC-002  partial      code <path>:<line>  no test — <what remains unverified>
AC-003  unsatisfied  <evidence>
```

- Mark an AC `satisfied` only when you can point to **both** code and a test.
- If a test verifies something **different** from the AC sentence, mark it `partial` and explain the difference.
- If any level has a nonzero exit code in its verification log, state that at the top.
- Mark anything you cannot assess as `unverified` and explain why. Do not guess that it is `satisfied`.

End with a three-line summary: satisfied n · partial n · unsatisfied n, followed by any AC whose assessment differs from the runner's requirements comparison.
