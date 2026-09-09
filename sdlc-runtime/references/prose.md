# Artifact prose

`lint-prose.mjs` checks readability and verifiability. Most findings are warnings, and source templates are excluded.

## Principles

- The primary readers of an intent are its proposer and product owner. Put implementation detail in the spec and plan.
- Replace vague language in outcomes, requirements, and acceptance criteria with measurable values or conditions.
- Do not mechanically remove subjective language from the problem description.
- Do not compress lists into table rows. Use tables only for genuinely two-dimensional comparisons.
- Keep titles within 40 characters and list items within four sentences.
- Write each acceptance criterion as one declarative sentence within 100 characters.

## Linter rules

| Rule | Detects |
|---|---|
| `entity-table` | A table whose first column contains IDs |
| `wide-table` | An intent or spec table with five or more columns |
| `comment` | Template comments left in a document |
| `vague` | Vague terms such as “quickly”, “appropriately”, or “sufficiently” where measurement is required |
| `translationese` | Awkward translated constructions |
| `meta` | Metatext such as “this document explains” |
| `too-long` | Document, section, item, or AC over its budget |
| `long-item` · `long-title` | Long items or titles |
| `untestable-ac` | An acceptance criterion that is not a declarative sentence |
| `test-drift` | A mismatch between a task's `tests:` and its acceptance criteria |
| `lang-unsupported` | An artifact written in a language other than the profile language |

## Character budgets

Budgets are measured without whitespace for the `light` tier.

| Document | ko total | section | item | | en total | section | item |
|---|---:|---:|---:|---|---:|---:|---:|
| intent | 1200 | 500 | 250 | | 2600 | 1100 | 550 |
| spec | 2000 | 800 | 400 | | 4400 | 1800 | 880 |
| plan | 3000 | 1200 | 350 | | 6600 | 2600 | 770 |
| finding | 2000 | 600 | 250 | | 4400 | 1300 | 550 |

The Korean budgets were measured from 42 Korean artifacts in this repository. The English budgets were derived by multiplying them by 2.2, based on nine matching sections in the parallel READMEs (mean 2.16, median 2.21, range 1.90–2.49). Revisit them when enough English artifact sets exist. `locales/en.mjs` records the derivation and its limitations.

The `standard` tier uses ×1.6 and `full` uses ×2.4. Exceeding a budget is a warning; exceeding twice the budget is an error.

## Language

The profile's `lang` selects the **artifact language** (default: `ko`). Both the prose lists (`translationese`, `meta`, and `vague`) and character budgets are defined in one place: `sdlc-runtime/locales/<lang>.mjs`.

Contract keywords such as `basis:` and `근거:` do not depend on this setting; both languages are always accepted. See “Contract keywords accept both languages” in `conventions.md`.

A document written in another language creates two failures at once: none of the three prose-list checks fire, and its length is measured with another language's budget. The silent prose-check failure is more dangerous because it is indistinguishable from a pass.

The linter reports `lang-unsupported` in that case. A document is treated as another language when the expected script makes up less than 30% of its characters. The 42 measured Korean artifacts range from 0.52 to 0.97 (median 0.92), while other-language documents are near zero. Documents shorter than 200 characters are not classified because their ratios are unstable.

This warning does not stop artifact checking, but it makes the missing prose validation visible on every run. Supporting another language requires all three prose lists and budgets measured from artifacts in that language. Do not copy existing budgets: languages need different character counts to express the same meaning.
