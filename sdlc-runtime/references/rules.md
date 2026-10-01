# Rule IDs and waivers

Every error and warning `check-artifacts.mjs` and `adr-bindings.mjs` report carries a stable rule
ID. The text report prints it in brackets before the message (`[adr-scope-empty]`); the `--json`
report has it as the problem's `rule` field. A message is display text and changes with wording;
the ID names the defect and does not. One rule reached from two places keeps one ID. Prose rules
from `lint-prose.mjs` have IDs of their own (`vague`, `too-long`, …) and are not listed here.

The registry is `sdlc-runtime/tools/rules.mjs`. It decides, for each ID, its level and whether a
document may waive it. `evals/rules.test.mjs` fails when a tool reports an ID the registry does not
have, when the registry has an ID no tool reports, and when the tables below disagree with the
registry on any ID, level or waivability. A problem reported without a registered ID, or at a level
other than the registered one, is a defect in the tool, not in the document: the tool still reports
it exactly as it would have, cannot waive it, and prints one line about it to stderr — the exit code
and the JSON do not change. The eval runner and the runtime smoke harness hold every checker report
they read to the registry and fail on any such problem; that is where the defect is caught.

## Waivers

A rule can be right in general and not apply to one document: a decision about a vendor has no
code path for `scope` and no test for `confirms`; a spec whose observable contract is a file path
has to name it. Satisfying the rule there means inventing a path or a test name, and leaving it
means CI stays red, since `check-all` runs the checker with `--strict`. A waiver is the third way —
written down, with a reason, and visible on every run, the same idiom as `N/A — <basis>` for a
required section and `paths: []` with `reason:` for a binding.

```yaml
waive:
  - "adr-confirms-empty — a vendor choice; no test can confirm it"
  - "adr-scope-empty — applies to how the team operates, not to a code path"
```

- An entry is `<rule-id> — <basis>`. The separator may be `—`, `–` or a hyphen with a space on
  each side, as for `N/A — <basis>`.
- `waive:` goes in the frontmatter of the document the problem is reported against — an ADR, or
  an intent, spec, plan, finding or research document — and covers every occurrence of that rule
  in that document. It does not reach any other document.
- Only a warning the registry marks waivable can be waived. The line is drawn between rules about
  whether something *applies* to this document (empty `scope` or `confirms`, a source path in a
  spec, a code block in an intent, a missing `### Non-goals`) and rules that protect traceability
  between documents, the integrity of an approval, or report a check that could not run (a dead
  pin, a mention without a pin, an unknown status, a missing band registry). Waiving the second
  kind would let a broken link read as a pass. An error is never waivable.
- A waived warning does not count under `--strict`. Each waiver that removed something is reported
  as a note naming the document, the rule, the count and the basis; `check-all` prints the notes
  of a passing check, so the waiver is on every CI log. The `--json` report also lists applied
  waivers under `waived`, as `{ doc, rule, basis, count }`.
- A waiver that cannot be read is an error, so a typo never reads as a waiver that worked: a rule
  ID the registry does not have (`waiver-rule-unknown`), an error or a non-waivable warning
  (`waiver-not-waivable` — the original problem is still reported), or no basis
  (`waiver-basis-missing`).
- A waiver that matched nothing in a run is a note, «쓰이지 않은 면제», not a warning. The rule may
  have stopped firing for a reason unrelated to the waiver, and removing a line from an accepted
  document costs an approval; a person cleans it up when convenient.

Write `waive:` as a block list of quoted strings, as above. The frontmatter reader splits an
inline list `waive: ["…", "…"]` on every comma, quoted or not, so a basis that contains a comma
breaks into two entries there — the second is then reported as a waiver with an unknown rule. It
also drops everything after ` #` on a line, so a basis cannot carry a `#` preceded by a space.
`—` and `:` inside a quoted item are read as written. The `waive:` lines are the justification of an
opt-out, not artifact prose, so the ID-reference and source-path checks skip them: a basis may name
`config/quota.py` or an ID without raising a problem of its own.

Waivers are not added to templates: they are an opt-out, not a field to fill. Adding one to an
accepted document is an edit of an accepted document, which the approval guard sends to the
approval dialog; one written before acceptance is approved with the document. An older runtime
ignores the key and keeps warning, which misreads nothing, so `waive:` has no schema version.

## Rules

### Any document

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `artifacts-missing` | error | no | The path holds no artifact or no decision record to check. |
| `id-duplicate` | error | no | One ID is defined twice in the same document. |
| `schema-version-unreadable` | error | no | `schema_version` is not an integer. |
| `schema-version-unsupported` | error | no | This runtime does not read the document's `schema_version`. |
| `schema-version-mixed` | error | no | Documents of one set declare different schema versions. |
| `frontmatter-missing-key` | error | no | A frontmatter key the document kind requires is empty. |
| `artifact-kind-mismatch` | error | no | `artifact:` does not match the file the document lives in. |
| `status-unknown` | error | no | `status` is not one of the values the document kind allows. |
| `tier-unknown` | error | no | `tier` is not light, standard or full. |
| `tier-mismatch` | error | no | A spec or plan declares a tier other than its intent's. |
| `superseded-by-missing` | error | no | A superseded document does not say what superseded it. |
| `approved-by-missing` | error | no | An accepted document has no `approved_by`. |
| `self-approval` | error | no | `approved_by` names the writer in `generated_by`. |
| `link-target-missing` | error | no | A frontmatter path to another document (`intent`, `spec`, `from_finding`, `routed_to: intent:`) names no file. |
| `intent-missing` | error | no | A set has a spec or plan but no intent. |

### Delegated approval

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `policy-missing` | error | no | `approved_by: policy:<route>` with no autonomy policy committed. |
| `policy-route-unknown` | error | no | The policy route named in `approved_by` is not in the policy. |
| `policy-route-expired` | error | no | The policy route had expired when the document was approved. |
| `policy-tier-exceeded` | error | no | The document's tier is above the route's `max_tier`. |
| `policy-stage-exceeded` | error | no | The route approved a stage beyond its `advance_to`. |

### Sections and IDs

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `section-marker-unknown` | warn | no | A section marker is none of the four the conventions define. |
| `section-empty` | error | no | A section the tier requires is empty. |
| `na-without-basis` | error | no | A required section is closed with `N/A` and no basis. |
| `section-placeholder` | error | no | A required section holds only template placeholders. |
| `placeholder-left` | warn | no | A required section still has template placeholder lines. |
| `section-markers-absent` | warn | no | A pre-v7 document carries no section markers, so its section checks never run. |
| `id-wrong-document` | error | no | An ID is defined outside the document its prefix belongs to. |
| `id-undefined` | error | no | A referenced ID is defined nowhere. |
| `id-pending` | warn | no | A referenced ID belongs to a document that does not exist yet. |
| `id-prefix-typo` | warn | no | An `XXX-123` token is one edit away from a harness prefix. |

### Version pins

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `version-pin-body-schema` | error | no | A `body:` pin in a document below schema 7. |
| `version-pin-body-locked` | error | no | A `body:` pin in a set pinned by `upstream.lock.json`. |
| `version-pin-unreadable` | error | no | A version pin is neither a commit SHA, a `body:` hash nor a date. |
| `version-pin-stale` | error | no | A version pin no longer matches the upstream document. |
| `version-pin-unverified` | warn | no | A version pin could not be compared — the upstream document or its history is missing. |
| `version-pin-date` | warn | no | A version pin is a date, which no machine can compare. |

### Intent and spec

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `requirement-basis-missing` | error | no | An FR or NFR names no OUT or CON as its basis. |
| `outcome-uncovered` | error | no | A Must outcome is covered by no requirement. |
| `requirement-ac-missing` | error | no | A Must requirement has no acceptance criterion. |
| `scenario-priority-missing` | warn | no | One scenario lacks a priority while others carry one. |
| `scenario-unrealised` | warn | no | A Must scenario is realised by no requirement. |
| `scope-schema` | error | no | `scope` is used in a spec below schema 6. |
| `ac-scope-missing` | error | no | In an upstream document repository, a Must criterion has no `scope`. |
| `ac-scope-unknown-repo` | error | no | A criterion's `scope` names a repository not in `spec_consumers`. |
| `intent-code-block` | warn | yes | An intent contains a fenced code block. *Why it may be waived:* An intent that quotes an existing log line, error or query as the observed problem shows the fact a sentence would only paraphrase. |
| `source-path-in-intent` | warn | yes | An intent names a source file path. *Why it may be waived:* When the problem is a file — a config the team edits by hand, a path users import — the path is the subject, not a design choice. |
| `source-path-in-spec` | warn | yes | A spec names a source file path. *Why it may be waived:* A spec whose observable contract is a file — a config path, a published module path — has to name it. |

### Plan

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `task-fields-missing` | error | no | A task lacks one of files · depends · covers · tests · verify. |
| `task-covers-nothing` | error | no | A task covers no requirement or criterion. |
| `ac-uncovered` | error | no | An acceptance criterion this repository owes is covered by no task. |
| `task-covers-foreign` | error | no | A task covers a criterion scoped to another repository. |
| `task-path-invalid` | error | no | A task's `files` entry is absolute or outside the repository. |
| `task-cycle` | error | no | Task `depends` form a cycle. |
| `task-depends-unknown` | error | no | A task depends on a task that does not exist. |
| `task-level-overlap` | error | no | Two tasks on the same level touch the same file. |
| `slice-order` | warn | no | A Must-slice task depends on a task that only serves a later increment. |
| `plan-in-upstream` | warn | yes | An upstream document repository holds a plan. *Why it may be waived:* A repository can be both a document repository for others and the place its own documentation work runs. |
| `plan-completed-open-tasks` | error | no | A completed plan has unfinished tasks. |
| `plan-completed-unlogged` | error | no | A completed plan has tasks missing from the execution log. |
| `plan-completed-unchecked` | error | no | A completed plan has unchecked boxes. |
| `status-ahead-of-parent` | error | no | A document is accepted while its parent is not. |
| `blocked-question-open` | error | no | An accepted document has an open blocking question. |

### Finding

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `finding-band-missing` | error | no | `trigger: band_breach` with no `band`. |
| `band-registry-missing` | warn | no | No band registry, so a finding's band could not be checked. |
| `band-unknown` | error | no | `band` is not in the registry. |
| `band-autonomy-mismatch` | error | no | A finding's `autonomy_tier` differs from its band's. |
| `finding-rejected-unclosed` | error | no | A rejected finding neither adjusts its band nor says «no adjustment — basis». |
| `band-revision-missing` | error | no | A rejected finding's band adjustment is not recorded in the registry. |
| `finding-trigger-unknown` | error | no | `trigger` is not one of the allowed values. |
| `finding-autonomy-unknown` | error | no | `autonomy_tier` is not one of the allowed values. |
| `finding-route-invalid` | error | no | `routed_to` is not patch, intent or dismiss. |
| `finding-route-missing` | error | no | An accepted finding has no `routed_to`. |
| `finding-rejected-not-dismissed` | error | no | A rejected finding is not routed to `dismiss:`. |
| `finding-route-mismatch` | error | no | An intent's `from_finding` and the finding's `routed_to` disagree. |
| `hypothesis-unobserved` | error | no | A hypothesis cites no observation. |

### Research

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `research-schema-version` | error | no | A research document is not schema 7. |
| `research-approval-field` | error | no | A research document carries `tier` or `approved_by`. |
| `research-too-few` | error | no | Too few criteria, sources, options or judgements. |
| `research-source-location-missing` | error | no | A source has no `at:`. |
| `research-source-undated` | error | no | A source has no readable `retrieved:` date. |
| `research-basis-missing` | error | no | An option cites no source, or a judgement cites no option. |
| `research-table-missing` | error | no | No table sets criteria against options. |
| `research-table-criterion-missing` | error | no | A criterion is missing from the comparison table's first column. |
| `research-table-option-missing` | error | no | An option is missing from the comparison table's header. |
| `research-citation-missing` | error | no | A cited research document does not exist. |
| `research-citation-item-missing` | error | no | A cited research item does not exist in that document. |

### Vendored sets

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `lock-broken` | error | no | `upstream.lock.json` cannot be read. |
| `lock-repo-missing` | error | no | A set pulled from upstream, in a repository whose profile has no `repo`. |
| `lock-self-upstream` | error | no | The lock names this repository as its own upstream. |
| `lock-file-missing` | error | no | A file the lock lists is not in the folder. |
| `lock-hash-missing` | error | no | A lock entry has no `hash`. |
| `vendored-copy-modified` | error | no | A vendored copy differs from the hash in the lock. |
| `upstream-ahead` | error | no | The upstream document moved past the vendored copy. |

### Decision records

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `adr-filename` | error | no | An ADR file name is not `ADR-NNN-kebab-slug.md`. |
| `adr-legacy-status-unknown` | error | no | A legacy ADR without frontmatter has no readable status. |
| `adr-id-mismatch` | error | no | The number in the file name and `id` differ. |
| `adr-number-reused` | error | no | Two ADRs share a number. |
| `adr-schema-version` | error | no | An ADR is not schema 5. |
| `adr-supersede-target-missing` | warn | yes | `supersedes` or `superseded_by` names an ADR not in this folder. *Why it may be waived:* A decision replaced by, or replacing, one in another repository names an ID this folder cannot hold. |
| `adr-supersede-unreciprocated` | warn | no | The other ADR does not name this one back. |
| `adr-successor-not-in-force` | warn | no | A superseded ADR's successor chain in this folder ends at no accepted decision. |
| `adr-section-missing` | error | no | One of the five ADR sections is missing. |
| `adr-non-goals-missing` | warn | yes | `## Decision` has no `### Non-goals`. *Why it may be waived:* A decision narrow enough that nothing adjacent could be mistaken for it has no scope argument to pre-empt. |
| `adr-alternatives-too-few` | error | no | Fewer than two alternatives. |
| `adr-chosen-count` | error | no | The number of «(chosen)» alternatives is not exactly one where one is required. |
| `adr-tradeoff-missing` | error | no | `## Consequences` names no constraint accepted in exchange. |
| `adr-revisit-missing` | warn | no | The ADR has assumptions but no revisit condition. |
| `adr-revisit-undefined` | warn | no | `revisit:` lists an RV not defined in the body. |
| `adr-revisit-unlisted` | warn | no | An RV in the body is missing from `revisit:`. |
| `adr-revisit-deadline` | warn | yes | An RV title reads as a deadline rather than a condition. *Why it may be waived:* The deadline test is a word list; a condition that mentions a period («three weeks running») can match it. |
| `adr-applies-to-invalid` | error | no | An `applies_to` entry is not a repository name. |
| `adr-scope-foreign-with-applies-to` | error | no | `scope` names another repository's path while `applies_to` is set. |
| `adr-scope-foreign` | warn | no | `scope` names another repository's path. |
| `adr-scope-empty` | warn | yes | A live ADR has no `scope` and no `applies_to`. *Why it may be waived:* A vendor choice or an operating policy constrains how the team works, not a code path. |
| `adr-confirms-empty` | warn | yes | A live ADR has no `confirms`. *Why it may be waived:* A decision no single test can confirm — a vendor, a process — would otherwise need an invented test name. |
| `adr-confirms-unplaced` | warn | no | `confirms` is set on an ADR that reaches code only through `applies_to`. |
| `adr-scope-missing-path` | warn | no | A `scope` path does not exist and was there before, or history cannot tell. |
| `adr-confirms-not-found` | warn | no | A `confirms` name is not found under `scope` or `confirms_in`. |
| `adr-confirms-in-missing-path` | warn | no | A `confirms_in` path does not exist and was there before. |
| `adr-confirms-search-cut` | warn | no | The `confirms` search stopped at its file budget before finding a name. |
| `adr-template-residue` | error | no | Template placeholders remain in the ADR. |
| `adr-comment-left` | warn | no | Template guidance comments remain in a submitted ADR. |

### Decision pins

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `decision-pin-unreadable` | error | no | A `decisions:` entry is not `ADR-NNN` or `<owner>/<repo>#ADR-NNN[@<sha> \| @body:<hex>]`, or puts `@body:` on a pin to this repository. |
| `decision-pin-sha-missing` | warn | no | A pin to another repository's decision carries no `@<sha>`. |
| `decision-pin-unknown` | error | no | A pinned ADR does not exist. |
| `pin-dead` | error | no | A pinned ADR is deprecated, superseded or rejected. |
| `decision-pin-unaccepted` | warn | no | A pinned ADR is still draft or in review. |
| `decision-pin-behind` | warn | no | An open set pins a manifest decision `@body:<hex>` and the decision's content has since changed (a stale `@<sha>`, or a closed set, is a note). |
| `adr-mention-unpinned` | warn | no | The body names an ADR that `decisions:` does not pin, and no pinned ADR replaced it through `superseded_by`. |
| `task-adr-unpinned` | warn | no | A task touches the scope of an accepted ADR the set does not pin. |

### Decision bindings

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `bindings-parse` | error | no | `.claude/adr-bindings.yml` has a line that cannot be read. |
| `manifest-missing` | warn | no | No decision manifest — every check against the other repository's decisions is off. |
| `manifest-broken` | error | no | The decision manifest cannot be read. |
| `manifest-modified` | error | no | The decision manifest differs from what `pull-adr` wrote. |
| `manifest-source-mismatch` | error | no | The manifest's source differs from the profile's `adr_repo`. |
| `bindings-source-mismatch` | error | no | The bindings' `source` differs from the manifest's. |
| `binding-missing` | warn | no | An accepted decision applies here and has no binding. |
| `binding-unknown-decision` | error | no | A binding names a decision the manifest does not have. |
| `binding-dead` | error | no | A binding holds code to a deprecated, superseded or rejected decision. |
| `binding-unaccepted` | warn | no | A binding holds code to a decision not yet accepted. |
| `binding-at-missing` | error | no | A binding has no `at`. |
| `binding-at-invalid` | error | no | A binding's `at` is neither a commit SHA nor `body:<hex>`. |
| `binding-stale` | error | no | The decision changed after it was bound — its content hash for `at: "body:…"`, its commit for a SHA `at`. |
| `binding-at-unverified` | warn | no | `at` could not be compared — the upstream ADR was uncommitted when pulled, or the manifest predates content hashes. |
| `binding-not-applicable` | warn | no | A bound decision's `applies_to` does not name this repository. |
| `binding-paths-missing` | error | no | A binding has no `paths`. |
| `binding-reason-missing` | error | no | `paths: []` without a `reason`. |
| `binding-path-missing` | warn | no | A bound path does not exist and was there before, or history cannot tell. |
| `binding-confirms-empty` | warn | no | A binding has no `confirms`. |
| `binding-confirms-not-found` | warn | no | A bound `confirms` name is not found under `paths` or `confirms_in`. |
| `binding-confirms-in-missing-path` | warn | no | A binding's `confirms_in` path does not exist and was there before. |
| `binding-confirms-search-cut` | warn | no | The bound `confirms` search stopped at its file budget before finding a name. |
| `manifest-decision-unknown` | error | no | Upstream has a decision the manifest does not list whose `applies_to` names this repository (any, without `repo`). |
| `manifest-decision-gone` | error | no | A manifest decision bound here or applying here is gone upstream. |
| `manifest-decision-changed` | error | no | A manifest decision bound here or applying here changed upstream after it was pulled — its content hash, or its commit in a manifest without one. |

### Waivers

| Rule | Level | Waivable | Meaning |
|---|---|---|---|
| `waiver-rule-unknown` | error | no | A waiver names a rule ID the registry does not have. |
| `waiver-not-waivable` | error | no | A waiver names an error or a warning the registry marks not waivable. |
| `waiver-basis-missing` | error | no | A waiver has no basis after the separator. |
