# Schema and version pinning

`/sdlc-init` and `/iterate-spec` read this document. Skills that write new documents only need to follow step 3 of the shared skill procedure.

Global skills and the repository contract version are separate:

- The current runtime and new templates use v6.
- The profile's `sdlc_version` selects the version for a new artifact set.
- Each document's `schema_version` records the version actually applied.
- Profiles and artifacts without a version are read as v1.
- A spec inherits the intent's schema version; a plan inherits the spec's.
- The intent, spec, and plan in one artifact set use the same version.
- Existing artifact sets are not upgraded automatically while being edited.
- A new error rule applies only at or above the schema version that introduced it.

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
