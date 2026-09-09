Task {task_id} — {task_title}

Working directory: {worktree}
**Work only here.** You may read files in the main worktree, but do not modify them.

Set up dependencies first: `{bootstrap}`

Specification: {spec_dir}/ — read intent.md, spec.md, and plan.md directly when needed.

## Files you may modify — do not modify anything else

{files}

## Requirements to satisfy — each acceptance-criterion sentence is the test name

{requirements}

{decisions}## Tests

{tests}

Use each acceptance-criterion sentence verbatim as its test name. Write source and tests together; tests are not a separate task.

## Repository rules — they are attached when files open, but read them first

{rules}

## Verification — this task's scope only

```sh
{verify}
```

{parallel_note}

**Do not commit.** At the integration point, the runner selects only this task's `files` and commits them with trailers.

You cannot ask follow-up questions. If this prompt is insufficient, that is a runner-preparation failure: report the blocker in your final report and stop. Do not make assumptions and push ahead.

## Reference snippets

{snippets}

## Final report

- Files changed and what changed in each
- For every acceptance criterion, the `file:line` of the test that verifies it
- Scoped verification result, including command and summary
- Deviations from the plan and blockers
