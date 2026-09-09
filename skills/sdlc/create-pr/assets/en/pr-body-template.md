<!-- If the repository has .github/pull_request_template.md, follow that instead of this file. -->
<!-- Delete every guide comment — pr-body-lint.sh blocks a body that still carries them. -->

## 🎯 Intent

<!-- What state the system should be in once this lands. One or two sentences. The goal, not the
     method. Where an artifact set exists, take it from intent.md's OUT-* and cite «basis: OUT-00N». -->

### Non-goals

<!-- What this deliberately does not do. If there is none, delete this subheading too. -->

-

## 🔍 Problem

<!-- What is uncomfortable, risky or wrong right now. Write the system's current state, not the
     author's motivation. Two numbers at most, the ones that carry the conclusion. Where an artifact set
     exists, take it from finding.md's EV-* and intent.md's problem section. -->

<!-- Keep this only when the cause is what is in dispute:
> **Root cause:**
>
> **Not the cause:**
-->

<!-- Links: Closes #N (fully closes it) · Refs #N (partial or related) · Depends on #N (merge order) -->

## 🔄 Behavior & Changes

<!-- Only when observable behaviour changes or the change runs in several directions. Otherwise
     delete the section. Cells are words (allowed, rejected, idempotent, -). No ✅/❌ — verification
     results belong under Verification. -->

| Scenario | Before | After |
| --- | --- | --- |
|  |  |  |

### Changes

<!-- What was decided comes first; implementation detail drops to sub-bullets. Not a file list. -->

-

## ⚠️ Risks & Review Points

<!-- Only when there is a risk or a place to look. You cannot skip it after touching PII,
     credentials, a write that is hard to undo, a schema, or an authorisation boundary. If only 🟢
     remains, delete the section. Keep the legend line below as it is. -->

Risk is not likelihood but **what it costs to be wrong** — 🔴 stays silently wrong · 🟡 shows itself and can be undone · 🟢 the blast radius is small.

| Area | Risk | Review Point |
| --- | --- | --- |
|  |  |  |

> **Reviewer Focus:**

<!-- Do not mix a question you want answered into the callout:
> **Open question:**
-->

## 🧪 Verification

<!-- Only when there is behaviour or a measure to verify. Measurements go in the prose below the
     table; predictions go in the Expected After column. -->

| Metric | Before | Expected After |
| --- | ---: | ---: |
|  |  |  |

-
