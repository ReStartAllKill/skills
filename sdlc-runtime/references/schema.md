# Schema and version pinning

`/sdlc-init` and `/iterate-spec` read this document. Skills that write new documents only need to follow step 3 of the shared skill procedure.

Global skills and the repository contract version are separate:

- The current runtime and new templates use v7.
- The profile's `sdlc_version` selects the version for a new artifact set.
- Each document's `schema_version` records the version actually applied.
- Profiles and artifacts without a version are read as v1.
- A spec inherits the intent's schema version; a plan inherits the spec's.
- The intent, spec, and plan in one artifact set use the same version.
- Existing artifact sets are not upgraded automatically while being edited.
- A new error rule applies only at or above the schema version that introduced it.

## v7 — Lighter documents

v7 removes authoring scaffolding from committed documents. Both rules bind only at or above v7; a v6 artifact set behaves exactly as it did.

- **An unmarked `##` heading is required at every tier.** Until v7 only a heading carrying a tier marker such as `` `[required · all tiers]` `` was checked, so every committed document repeated the marker on every section for the checker's benefit alone. At v7 a depth-2 heading with no marker is read as if it carried the all-tiers marker: it must have content, or `N/A — <basis>`, and a section holding only placeholders is an error. Headings that do carry a marker keep their v6 meaning, including `standard+`, `full`, `conditional` and `optional`. `###` and `####` headings without a marker stay unchecked — making item titles required would force an `N/A` under every item. A `##` whose child headings carry markers is still checked through those children rather than on its own. The marker also made a `light` document — the one tier where no other marker survives — look as heavy as a `full` one, so the v7 templates omit it and a light document now carries only its conditional markers.
- **`intent_version` and `spec_version` accept a body hash.** Alongside a commit SHA, v7 accepts `body:<hex>`, at least 12 hex characters of the sha256 of the upstream document's body — everything after the closing `---` of the frontmatter, with CRLF normalised to LF and the ends trimmed. HTML comments are **not** stripped: the tool that writes the pin and the checker that reads it must agree byte for byte, and “the text after the frontmatter” is the only definition that needs no parser. The comparison is by prefix, as it is for a commit SHA. `node <sdlc_runtime>/tools/pin.mjs <upstream-file>` prints the value, and every mismatch names that command. A body pin lets intent, spec and plan be born in one commit, and survives a frontmatter-only edit upstream — an approval no longer invalidates a pin over a body nobody touched. Where `upstream.lock.json` exists, the locked upstream commit still wins and a `body:` pin is an error: a body hash cannot see that upstream has moved ahead. Below v7 `body:` is rejected as neither a commit SHA nor a date, because an older runtime would read it as a malformed SHA and pass.

- **The templates ship fewer sections, and the ones removed were never contract.** Making an unmarked heading required turns every section a template carries into a section every document must fill, so a heading nobody has anything to put under becomes a standing `N/A — <basis>` sentence. The v7 templates drop those: the spec's `Scope` (a prose copy of `intent:` in the frontmatter and of the requirements' `basis:` lines), the plan's `Input and scope` (the same copy, plus a “before starting” checklist that the states already enforce) and `Definition of done` (word for word the same list in every plan, which is what the profile's `verify` and the tier markers say), all three `Open questions` sections, the plan's `Execution log`, and the `History` subsections under `Approvals and history` — a hand-kept `git log` that is stale by the second commit, which is why that section is now just `Approvals`. Open questions are still `Q-*`, `SQ-*`/`SD-*` and `PQ-*` under a heading of the same name; write the heading when a question exists and leave it out when none does. The execution log now belongs to `plan-check mark`, which creates the section on its first entry instead of failing when the plan has none — the tool that owns a section is the one that should make it. Section titles are not contract, so none of this changes what a checker matches; `SECTION.executionLog` and the ID prefixes are unaffected.
- **`created` and `updated` are no longer required frontmatter, at any version.** git holds both, and this repository's rule is that derivable facts are not written down. A hand-kept `updated` is worse than an absent one: a document edited by someone who forgot the field reads as a document nobody touched. This is a loosening, so older artifact sets that still carry the two keys stay valid — nothing else in the checker ever read them.
- **The spec's `Scenarios` is `[required · standard+]` in the v7 templates.** At `light` tier a scenario restated its own acceptance criteria. This is a template change, not a checker rule: an existing spec that carries the heading with no marker is read as required at every tier from v7, as any unmarked heading is.

Removing a section is the only way to say it does not apply. A heading that is present must have content — that rule did not loosen, and at v7 it now reaches unmarked headings too, so a heading left behind after its content was deleted is an error rather than a blank the reader has to interpret. Where a section applies but is genuinely empty, keep the heading and write `N/A — <basis>`.

`generated_from`, `skills_in_force` and `superseded_by` become optional at every version, not only at v7. They were never required keys; only the `generated_by` warning asked for the first two, and it no longer does. `superseded_by` is still required when `status: superseded` — a document replaced by nothing is a document that was lost.

Raising the profile's `sdlc_version` to 7 changes only new artifact sets. Raising an existing document to 7 does change it: a section whose heading has no marker and no content — a heading left as a placeholder for a section never written — newly fails. That is the point of the rule, and `migrate-schema.mjs` reports it before writing. Fill the section or write `N/A — <basis>`; the third option, deleting the heading, is the right one when the section was never meant to be there.

## v6 — Repository boundaries

v6 introduces **repository assignment for acceptance criteria** and the **upstream lock**. A single-repository artifact set behaves exactly as it did in v5: both mechanisms are enabled by profile settings and file presence, not by the version alone.

- A requirement may have a `scope:` line, and an acceptance-criterion line may end in `` `scope: <repo>` ``. An AC without one inherits its parent requirement's scope. Using either form in a document below v6 is an error: an older runtime reads it as part of the title and silently loses the assignment.
- `upstream.lock.json` lives in the artifact directory. `pull-spec.mjs` creates it, and the checker verifies the copied files' hashes and upstream commit. When the lock exists, `intent_version` and `spec_version` are compared with the **locked upstream commit**, rather than a local commit.
- Profile keys `repo`, `upstream_repo`, and `spec_consumers` are described in `profile.md` and “Changes spanning multiple repositories” in `conventions.md`.
- Assignment checking, which rejects an unassigned Must requirement in an upstream repository with `spec_consumers`, applies only to v6 or later specs. Raising the profile version does not make old artifact sets fail; a v5 set may remain unchanged in an upstream repository.

## v5 — Decision records

v5 introduces the fifth artifact, `adr`. An ADR always uses `schema_version: 5`; a repository whose artifact sets use v4 may still have ADRs. The profile's `sdlc_version` governs the intent/spec/plan set, not ADRs.

`decisions:` pins are optional in v4 and checked in v5, so untouched v4 sets continue to pass. In a v5 set, the checker verifies that every pinned ADR exists and has an acceptable status.

When the profile has no `adr_dir`, the repository is treated as having no ADRs and all related checks are skipped.

`spec.intent_version` and `plan.spec_version` are the commit SHAs that last changed their upstream documents. After changing an upstream document, update its downstream documents and pin the new SHA. When upstream is another repository, the SHA is an **upstream repository commit** held by the lock. Recording the commit that imported the copy into the code repository would prevent future upstream changes from ever being detected.
