/** Stable IDs for every problem `check-artifacts`, `adr-check` and `adr-bindings` report.
 *
 * The message is for a person and changes with wording; runtime.md tells consumers never to parse
 * it, which left them nothing to key on. An ID names the defect, not the sentence, and one rule
 * reached from two call sites keeps one ID. This registry is what an unknown ID in a waiver is
 * judged against and what `references/rules.md` is checked against (`evals/rules.test.mjs`).
 *
 * `waivable` says whether a document may opt out of a warning with `waive: ["<id> — <basis>"]`.
 * The line drawn: a rule about whether something *applies* to this document may be waived with a
 * stated basis; a rule that protects traceability between documents, the integrity of an approval,
 * or that reports a check which could not run may not — waiving those would let a broken link or
 * an unseen check read as a pass. An error is never waivable. `why` records the call for each
 * waivable rule, since that is the one a reviewer will question.
 *
 * Prose rules (`lint-prose.mjs`) are not here: they have their own `lint_warnings` policy. */

const E = (what) => ({ level: 'error', waivable: false, what })
const W = (what) => ({ level: 'warn', waivable: false, what })
const WAIVABLE = (what, why) => ({ level: 'warn', waivable: true, what, why })

export const RULES = {
  // ── Any document ───────────────────────────────────────────────────────────────────────────
  'artifacts-missing': E('The path holds no artifact or no decision record to check.'),
  'id-duplicate': E('One ID is defined twice in the same document.'),
  'schema-version-unreadable': E('`schema_version` is not an integer.'),
  'schema-version-unsupported': E('This runtime does not read the document\'s `schema_version`.'),
  'schema-version-mixed': E('Documents of one set declare different schema versions.'),
  'frontmatter-missing-key': E('A frontmatter key the document kind requires is empty.'),
  'artifact-kind-mismatch': E('`artifact:` does not match the file the document lives in.'),
  'status-unknown': E('`status` is not one of the values the document kind allows.'),
  'tier-unknown': E('`tier` is not light, standard or full.'),
  'tier-mismatch': E('A spec or plan declares a tier other than its intent\'s.'),
  'superseded-by-missing': E('A superseded document does not say what superseded it.'),
  'approved-by-missing': E('An accepted document has no `approved_by`.'),
  'self-approval': E('`approved_by` names the writer in `generated_by`.'),
  'link-target-missing': E('A frontmatter path to another document (`intent`, `spec`, `from_finding`, `routed_to: intent:`) names no file.'),
  'intent-missing': E('A set has a spec or plan but no intent.'),

  // ── Delegated approval (autonomy policy) ───────────────────────────────────────────────────
  'policy-missing': E('`approved_by: policy:<route>` with no autonomy policy committed.'),
  'policy-route-unknown': E('The policy route named in `approved_by` is not in the policy.'),
  'policy-route-expired': E('The policy route had expired when the document was approved.'),
  'policy-tier-exceeded': E('The document\'s tier is above the route\'s `max_tier`.'),
  'policy-stage-exceeded': E('The route approved a stage beyond its `advance_to`.'),

  // ── Sections and IDs ───────────────────────────────────────────────────────────────────────
  'section-marker-unknown': W('A section marker is none of the four the conventions define.'),
  'section-empty': E('A section the tier requires is empty.'),
  'na-without-basis': E('A required section is closed with `N/A` and no basis.'),
  'section-placeholder': E('A required section holds only template placeholders.'),
  'placeholder-left': W('A required section still has template placeholder lines.'),
  'section-markers-absent': W('A pre-v7 document carries no section markers, so its section checks never run.'),
  'id-wrong-document': E('An ID is defined outside the document its prefix belongs to.'),
  'id-undefined': E('A referenced ID is defined nowhere.'),
  'id-pending': W('A referenced ID belongs to a document that does not exist yet.'),
  'id-prefix-typo': W('An `XXX-123` token is one edit away from a harness prefix.'),

  // ── Version pins (`intent_version`, `spec_version`) ────────────────────────────────────────
  'version-pin-body-schema': E('A `body:` pin in a document below schema 7.'),
  'version-pin-body-locked': E('A `body:` pin in a set pinned by `upstream.lock.json`.'),
  'version-pin-unreadable': E('A version pin is neither a commit SHA, a `body:` hash nor a date.'),
  'version-pin-stale': E('A version pin no longer matches the upstream document.'),
  'version-pin-unverified': W('A version pin could not be compared — the upstream document or its history is missing.'),
  'version-pin-date': W('A version pin is a date, which no machine can compare.'),

  // ── Intent and spec ────────────────────────────────────────────────────────────────────────
  'requirement-basis-missing': E('An FR or NFR names no OUT or CON as its basis.'),
  'outcome-uncovered': E('A Must outcome is covered by no requirement.'),
  'requirement-ac-missing': E('A Must requirement has no acceptance criterion.'),
  'scenario-priority-missing': W('One scenario lacks a priority while others carry one.'),
  'scenario-unrealised': W('A Must scenario is realised by no requirement.'),
  'scope-schema': E('`scope` is used in a spec below schema 6.'),
  'ac-scope-missing': E('In an upstream document repository, a Must criterion has no `scope`.'),
  'ac-scope-unknown-repo': E('A criterion\'s `scope` names a repository not in `spec_consumers`.'),
  'intent-code-block': WAIVABLE('An intent contains a fenced code block.',
    'An intent that quotes an existing log line, error or query as the observed problem shows the fact a sentence would only paraphrase.'),
  'source-path-in-intent': WAIVABLE('An intent names a source file path.',
    'When the problem is a file — a config the team edits by hand, a path users import — the path is the subject, not a design choice.'),
  'source-path-in-spec': WAIVABLE('A spec names a source file path.',
    'A spec whose observable contract is a file — a config path, a published module path — has to name it.'),

  // ── Plan ───────────────────────────────────────────────────────────────────────────────────
  'task-fields-missing': E('A task lacks one of files · depends · covers · tests · verify.'),
  'task-covers-nothing': E('A task covers no requirement or criterion.'),
  'ac-uncovered': E('An acceptance criterion this repository owes is covered by no task.'),
  'task-covers-foreign': E('A task covers a criterion scoped to another repository.'),
  'task-path-invalid': E('A task\'s `files` entry is absolute or outside the repository.'),
  'task-cycle': E('Task `depends` form a cycle.'),
  'task-depends-unknown': E('A task depends on a task that does not exist.'),
  'task-level-overlap': E('Two tasks on the same level touch the same file.'),
  'slice-order': W('A Must-slice task depends on a task that only serves a later increment.'),
  'plan-in-upstream': WAIVABLE('An upstream document repository holds a plan.',
    'A repository can be both a document repository for others and the place its own documentation work runs.'),
  'plan-completed-open-tasks': E('A completed plan has unfinished tasks.'),
  'plan-completed-unlogged': E('A completed plan has tasks missing from the execution log.'),
  'plan-completed-unchecked': E('A completed plan has unchecked boxes.'),
  'status-ahead-of-parent': E('A document is accepted while its parent is not.'),
  'blocked-question-open': E('An accepted document has an open blocking question.'),

  // ── Finding ────────────────────────────────────────────────────────────────────────────────
  'finding-band-missing': E('`trigger: band_breach` with no `band`.'),
  'band-registry-missing': W('No band registry, so a finding\'s band could not be checked.'),
  'band-unknown': E('`band` is not in the registry.'),
  'band-autonomy-mismatch': E('A finding\'s `autonomy_tier` differs from its band\'s.'),
  'finding-rejected-unclosed': E('A rejected finding neither adjusts its band nor says «no adjustment — basis».'),
  'band-revision-missing': E('A rejected finding\'s band adjustment is not recorded in the registry.'),
  'finding-trigger-unknown': E('`trigger` is not one of the allowed values.'),
  'finding-autonomy-unknown': E('`autonomy_tier` is not one of the allowed values.'),
  'finding-route-invalid': E('`routed_to` is not patch, intent or dismiss.'),
  'finding-route-missing': E('An accepted finding has no `routed_to`.'),
  'finding-rejected-not-dismissed': E('A rejected finding is not routed to `dismiss:`.'),
  'finding-route-mismatch': E('An intent\'s `from_finding` and the finding\'s `routed_to` disagree.'),
  'hypothesis-unobserved': E('A hypothesis cites no observation.'),

  // ── Research ───────────────────────────────────────────────────────────────────────────────
  'research-schema-version': E('A research document is not schema 7.'),
  'research-approval-field': E('A research document carries `tier` or `approved_by`.'),
  'research-too-few': E('Too few criteria, sources, options or judgements.'),
  'research-source-location-missing': E('A source has no `at:`.'),
  'research-source-undated': E('A source has no readable `retrieved:` date.'),
  'research-basis-missing': E('An option cites no source, or a judgement cites no option.'),
  'research-table-missing': E('No table sets criteria against options.'),
  'research-table-criterion-missing': E('A criterion is missing from the comparison table\'s first column.'),
  'research-table-option-missing': E('An option is missing from the comparison table\'s header.'),
  'research-citation-missing': E('A cited research document does not exist.'),
  'research-citation-item-missing': E('A cited research item does not exist in that document.'),

  // ── Vendored sets (`upstream.lock.json`) ───────────────────────────────────────────────────
  'lock-broken': E('`upstream.lock.json` cannot be read.'),
  'lock-repo-missing': E('A set pulled from upstream, in a repository whose profile has no `repo`.'),
  'lock-self-upstream': E('The lock names this repository as its own upstream.'),
  'lock-file-missing': E('A file the lock lists is not in the folder.'),
  'lock-hash-missing': E('A lock entry has no `hash`.'),
  'vendored-copy-modified': E('A vendored copy differs from the hash in the lock.'),
  'upstream-ahead': E('The upstream document moved past the vendored copy.'),

  // ── Decisions (ADR) ────────────────────────────────────────────────────────────────────────
  'adr-filename': E('An ADR file name is not `ADR-NNN-kebab-slug.md`.'),
  'adr-legacy-status-unknown': E('A legacy ADR without frontmatter has no readable status.'),
  'adr-id-mismatch': E('The number in the file name and `id` differ.'),
  'adr-number-reused': E('Two ADRs share a number.'),
  'adr-schema-version': E('An ADR is not schema 5.'),
  'adr-supersede-target-missing': WAIVABLE('`supersedes` or `superseded_by` names an ADR not in this folder.',
    'A decision replaced by, or replacing, one in another repository names an ID this folder cannot hold.'),
  'adr-supersede-unreciprocated': W('The other ADR does not name this one back.'),
  'adr-section-missing': E('One of the five ADR sections is missing.'),
  'adr-non-goals-missing': WAIVABLE('`## Decision` has no `### Non-goals`.',
    'A decision narrow enough that nothing adjacent could be mistaken for it has no scope argument to pre-empt.'),
  'adr-alternatives-too-few': E('Fewer than two alternatives.'),
  'adr-chosen-count': E('The number of «(chosen)» alternatives is not exactly one where one is required.'),
  'adr-tradeoff-missing': E('`## Consequences` names no constraint accepted in exchange.'),
  'adr-revisit-missing': W('The ADR has assumptions but no revisit condition.'),
  'adr-revisit-undefined': W('`revisit:` lists an RV not defined in the body.'),
  'adr-revisit-unlisted': W('An RV in the body is missing from `revisit:`.'),
  'adr-revisit-deadline': WAIVABLE('An RV title reads as a deadline rather than a condition.',
    'The deadline test is a word list; a condition that mentions a period («three weeks running») can match it.'),
  'adr-applies-to-invalid': E('An `applies_to` entry is not a repository name.'),
  'adr-scope-foreign-with-applies-to': E('`scope` names another repository\'s path while `applies_to` is set.'),
  'adr-scope-foreign': W('`scope` names another repository\'s path.'),
  'adr-scope-empty': WAIVABLE('A live ADR has no `scope` and no `applies_to`.',
    'A vendor choice or an operating policy constrains how the team works, not a code path.'),
  'adr-confirms-empty': WAIVABLE('A live ADR has no `confirms`.',
    'A decision no single test can confirm — a vendor, a process — would otherwise need an invented test name.'),
  'adr-confirms-unplaced': W('`confirms` is set on an ADR that reaches code only through `applies_to`.'),
  'adr-scope-missing-path': W('A `scope` path does not exist.'),
  'adr-confirms-not-found': W('A `confirms` name is not found under `scope`.'),
  'adr-template-residue': E('Template placeholders remain in the ADR.'),
  'adr-comment-left': W('Template guidance comments remain in a submitted ADR.'),

  // ── Decision pins (`decisions:`) and plan scope ────────────────────────────────────────────
  'decision-pin-unreadable': E('A `decisions:` entry is not `ADR-NNN` or `<owner>/<repo>#ADR-NNN@<sha>`.'),
  'decision-pin-sha-missing': W('A pin to another repository\'s decision carries no `@<sha>`.'),
  'decision-pin-unknown': E('A pinned ADR does not exist.'),
  'pin-dead': E('A pinned ADR is deprecated, superseded or rejected.'),
  'decision-pin-unaccepted': W('A pinned ADR is still draft or in review.'),
  'adr-mention-unpinned': W('The body names an ADR that `decisions:` does not pin.'),
  'task-adr-unpinned': W('A task touches the scope of an accepted ADR the set does not pin.'),

  // ── Decision bindings (`adr-bindings.mjs`) ─────────────────────────────────────────────────
  // Reported against the bindings file or the manifest, which carry no frontmatter and so no
  // `waive:`. The bindings file has its own opt-out: `paths: []` with a `reason:`.
  'bindings-parse': E('`.claude/adr-bindings.yml` has a line that cannot be read.'),
  'manifest-missing': W('No decision manifest — every check against the other repository\'s decisions is off.'),
  'manifest-broken': E('The decision manifest cannot be read.'),
  'manifest-modified': E('The decision manifest differs from what `pull-adr` wrote.'),
  'manifest-source-mismatch': E('The manifest\'s source differs from the profile\'s `adr_repo`.'),
  'bindings-source-mismatch': E('The bindings\' `source` differs from the manifest\'s.'),
  'binding-missing': W('An accepted decision applies here and has no binding.'),
  'binding-unknown-decision': E('A binding names a decision the manifest does not have.'),
  'binding-dead': E('A binding holds code to a deprecated, superseded or rejected decision.'),
  'binding-unaccepted': W('A binding holds code to a decision not yet accepted.'),
  'binding-at-missing': E('A binding has no `at`.'),
  'binding-at-invalid': E('A binding\'s `at` is not a commit SHA.'),
  'binding-stale': E('The decision changed after it was bound.'),
  'binding-at-unverified': W('The upstream ADR was uncommitted when pulled, so `at` could not be compared.'),
  'binding-not-applicable': W('A bound decision\'s `applies_to` does not name this repository.'),
  'binding-paths-missing': E('A binding has no `paths`.'),
  'binding-reason-missing': E('`paths: []` without a `reason`.'),
  'binding-path-missing': W('A bound path does not exist.'),
  'binding-confirms-empty': W('A binding has no `confirms`.'),
  'binding-confirms-not-found': W('A bound `confirms` name is not found under `paths`.'),
  'manifest-decision-unknown': E('Upstream has decisions the manifest does not list.'),
  'manifest-decision-gone': E('A manifest decision is gone upstream.'),
  'manifest-decision-changed': E('A manifest decision changed upstream after it was pulled.'),

  // ── Waivers ────────────────────────────────────────────────────────────────────────────────
  'waiver-rule-unknown': E('A waiver names a rule ID the registry does not have.'),
  'waiver-not-waivable': E('A waiver names an error or a warning the registry marks not waivable.'),
  'waiver-basis-missing': E('A waiver has no basis after the separator.'),
}

/** The rule ID at a call site. It returns its argument and checks nothing at run time: an unknown
 *  ID is our defect, not the document's, and it must not stop a save hook on a document that may be
 *  fine. `evals/rules.test.mjs` finds every `R(<id>)` call by reading the source and fails on an ID the
 *  registry lacks, or one reported at another level. */
export const R = (id) => id

/** Problems whose rule is missing from the registry or registered at another level, one line each.
 *  The tools only print these to stderr (`noteDrift`); the suites fail on them, through
 *  `driftInReport`, on every checker report they read. Throwing here was rejected: a slip in our
 *  bookkeeping on a path no eval reaches would have crashed the checker for a user. */
export function ruleDrift(problems) {
  const out = []
  for (const p of problems) {
    if (p.level !== 'error' && p.level !== 'warn') continue
    const r = RULES[p.rule]
    if (!r) out.push(`${p.doc ?? '?'}: no registered rule (${p.rule ?? 'none'}) — ${p.msg}`)
    else if (r.level !== p.level) out.push(`${p.doc ?? '?'}: ${p.rule} is registered as ${r.level} but reported as ${p.level}`)
  }
  return out
}

/** One stderr line when a report carries rule drift. stdout, the exit code and the JSON stay as they
 *  would have been — the problem is still reported, it just cannot be waived. */
export function noteDrift(problems, tool) {
  const d = ruleDrift(problems)
  if (d.length) process.stderr.write(`${tool}: 규칙 등록부와 어긋난 지적 ${d.length}건 — 도구의 결함이다(문서가 아니라): ${d.join(' | ')}\n`)
}

/** The problems of a checker report, from its `--json` output or its text output, for the suites.
 *  Text is read the way `report()` in artifact-parse.mjs prints it: a `✗ … 건` or `⚠ … 건` heading,
 *  then one `  <doc>[:line]  [rule] msg` line per problem. Returns null when the output is neither. */
export function problemsInReport(out) {
  const s = String(out ?? '').trim()
  if (s.startsWith('{')) {
    try { const j = JSON.parse(s); return Array.isArray(j.problems) ? j.problems : null } catch { return null }
  }
  if (!/^(?:산출물 추적성 검사|결정 기록 검사|결정 바인딩 검사)/m.test(s)) return null
  const ESC = String.fromCharCode(27)
  const problems = []
  let level = null
  for (const line of s.replace(new RegExp(ESC + '\\[[0-9;]*m', 'g'), '').split('\n')) {
    if (/^✗ .*\d+건$/.test(line)) { level = 'error'; continue }
    if (/^⚠ .*\d+건$/.test(line)) { level = 'warn'; continue }
    if (!level) continue
    const m = /^ {2}(\S+?)(?::\d+)?\s{2}(?:\[([a-z0-9-]+)\] )?(.*)$/.exec(line)
    if (m) problems.push({ level, doc: m[1], rule: m[2], msg: m[3] })
    else if (line.trim() && !/^\s{4,}/.test(line)) level = null
  }
  return problems
}

/** Drift in one checker report's output, or null when the output is not a checker report. */
export function driftInReport(out) {
  const problems = problemsInReport(out)
  return problems ? { problems: problems.length, drift: ruleDrift(problems) } : null
}

// `—` and `–` may touch the ID; a hyphen must stand apart, since every rule ID is made of hyphens.
// The same three separators `N/A — basis` accepts (RE_NA_WITH_BASIS in keywords.mjs).
const WAIVER = /^([^\s—–]+?)(?:\s*[—–]|\s+-(?=\s|$))\s*(.*)$/

/** Parse `waive:` of each document and take the waived warnings out of `problems`.
 *  `docs` are loaded documents (`name`, `fm`). Returns `{ problems, notes, waived }`: problems with
 *  waived ones removed and malformed waivers added as errors, a note per applied or unused waiver,
 *  and the applied waivers for the JSON report. A waiver is the document's own statement, so it
 *  applies only to problems reported against that document. */
export function applyWaivers(problems, docs) {
  noteDrift(problems, 'check-artifacts')
  const notes = []
  const waived = []
  const added = []
  const valid = []
  for (const d of docs) {
    for (const raw of [].concat(d.fm?.waive ?? []).map(String).map((s) => s.trim()).filter(Boolean)) {
      const m = WAIVER.exec(raw)
      const id = m ? m[1] : raw.split(/\s+/)[0]
      const basis = m ? m[2].trim() : ''
      const rule = RULES[id]
      const bad = (r, msg, hint) => added.push({ level: 'error', doc: d.name, rule: r, msg, hint })
      if (!rule) {
        bad(R('waiver-rule-unknown'), `\`waive\` 의 \`${id}\` 는 아는 규칙 ID 가 아니다`,
          '오타면 고친다 — 모르는 ID 를 면제로 읽으면 아무것도 면제하지 않은 줄이 면제한 것처럼 보인다. 규칙 ID 는 보고서의 `[규칙]` 과 `references/rules.md` 에 있다. 문체 규칙(lint-prose)은 면제가 아니라 프로필의 `lint_warnings` 가 정한다.')
      } else if (rule.level !== 'warn' || !rule.waivable) {
        bad(R('waiver-not-waivable'), `\`${id}\` 는 면제할 수 없는 규칙이다 (${rule.level === 'error' ? '오류' : '면제 불가 경고'})`,
          rule.level === 'error'
            ? '오류는 면제하지 않는다. 문서를 고친다.'
            : '면제할 수 있는 것은 «이 규칙이 이 문서에 해당하는가» 를 묻는 경고뿐이다. 추적 관계·승인·돌지 못한 검사를 알리는 경고는 면제하면 끊긴 것이 통과로 읽힌다. 문서를 고친다 — 규칙마다의 판정은 `references/rules.md` 에 있다.')
      } else if (!basis) {
        bad(R('waiver-basis-missing'), `\`${id}\` 면제에 근거가 없다`,
          '`<규칙 ID> — <근거>` 로 쓴다. 근거 없는 면제는 «이 규칙이 여기 해당하지 않는다» 와 «경고를 끄고 싶었다» 를 같은 글자로 만든다.')
      } else {
        valid.push({ doc: d.name, rule: id, basis, count: 0 })
      }
    }
  }
  const kept = problems.filter((p) => {
    // A problem whose rule the registry places at another level is never waived: the registry is
    // what a waiver was judged against, and it does not describe this problem.
    if (p.level !== 'warn' || RULES[p.rule]?.level !== 'warn') return true
    const w = valid.find((v) => v.doc === p.doc && v.rule === p.rule)
    if (!w) return true
    w.count++
    return false
  })
  for (const w of valid) {
    if (w.count) {
      notes.push(`${w.doc} — \`${w.rule}\` 면제 ${w.count}건: ${w.basis}`)
      waived.push(w)
    } else {
      notes.push(`${w.doc} — 쓰이지 않은 면제 \`${w.rule}\`: 이번 실행에서 이 문서에 걸리지 않았다. 규칙이 더는 해당하지 않으면 지운다.`)
    }
  }
  return { problems: [...kept, ...added], notes, waived }
}
