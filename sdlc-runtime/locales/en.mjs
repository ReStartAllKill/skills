/** English prose rules and length limits. Limits are estimates derived from the Korean bundle. */

/** Detect English after removing code spans. Require a Latin-character ratio of at least 0.7. */
export const script = {
  test: /[A-Za-z]/g,
  against: /[가-힣]/g,
  minRatio: 0.7,
  /** Short documents swing too much to judge. */
  minChars: 200,
  name: 'English',
}

/** Use a final period as a heuristic for a complete acceptance criterion. */
export const acSentence = /\.$/

/** Flag vague measurements using word boundaries. Lines containing numbers and code spans are exempt.
 *  `\b` treats a hyphen as a boundary, so `fast` matched inside `fast-forward`, a git operation with
 *  an exact meaning. The lookarounds exempt only compounds that name one thing — fast-forward,
 *  fast-path, fail-fast, slow-path, slow-start, clean up, clean-room. A general «any hyphenated
 *  compound» exemption was rejected: `easy-to-use` and `fast-growing` are as vague as the bare word. */
export const vague = [
  /(?<!\bfail-)\bfast(er)?\b(?!-(?:forward|path)\b)/i, /\bquick(ly)?\b/i, /\bslow\b(?!-(?:path|start)\b)/i,
  /\bappropriate(ly)?\b/i, /\bproper(ly)?\b/i,
  /\beas(y|ily)\b/i, /\bsimple\b/i, /\bseamless(ly)?\b/i, /\brobust\b/i, /\bscalable\b/i,
  /\bflexible\b/i, /\befficient(ly)?\b/i, /\boptimiz(e|ed|ation)\b/i, /\bimprove[ds]?\b/i,
  /\bbetter\b/i, /\benhance[ds]?\b/i, /\bstable\b/i, /\breliable\b/i, /\buser-friendly\b/i,
  /\bintuitive\b/i, /\bclean(er)?\b(?![- ]up\b|-room\b)/i, /\bworks well\b/i, /\bno issues\b/i, /\bsufficient(ly)?\b/i,
  /\bmost of\b/i, /\boften\b/i, /\bas much as possible\b/i, /\bif possible\b/i, /\bsmooth(ly)?\b/i,
  /\band so on\b/i, /\betc\b/i,
]

/** Flag wordiness and passive constructions. */
export const translationese = [
  [/\bis\s+\w+ed\s+by\b/i, 'name the actor — «is processed by A» → «A processes»'],
  [/\bare\s+\w+ed\s+by\b/i, 'name the actor'],
  [/\bin order to\b/i, '«to»'],
  [/\bdue to the fact that\b/i, '«because»'],
  [/\bin the event that\b/i, '«if»'],
  [/\bfor the purpose of\b/i, '«to»'],
  [/\bat this point in time\b/i, '«now»'],
  [/\bhas the ability to\b/i, '«can»'],
  [/\bis able to\b/i, '«can»'],
  [/\bmake use of\b/i, '«use»'],
  [/\butilize[sd]?\b/i, '«use»'],
  [/\bprovides? (the )?(ability|functionality|support|capability)\b/i, 'say what it does — «provides the ability to search» → «searches»'],
  [/\bperforms? (a|an|the)\b/i, 'use the verb — «performs a check» → «checks»'],
  [/\bwith (regard|respect) to\b/i, '«about»'],
  [/\bit should be noted that\b/i, 'drop it — the sentence is the note'],
]

/** Sentences about the document instead of its subject. */
export const meta = [
  [/\bthis (document|section) (describes|explains|covers|outlines|introduces|defines)\b/i,
   'the document is describing itself. Write the content'],
  [/\bthe present document\b/i, '«this document» is usually unnecessary too'],
  [/\b(as (mentioned|described|noted) (above|earlier)|in the (next|following) section|below,? we)\b/i,
   'do not narrate the order — the headings already do that'],
  [/\bfor reference,/i, 'if it belongs in the body, write it; otherwise drop it'],
]

/** Light-tier character limits exclude whitespace. Estimate each limit as the Korean value × 2.2,
 * based on parallel README sections. Recalibrate with representative English artifacts. */
export const budget = {
  intent: { doc: 2600, section: 1100, entity: 550 },
  spec: { doc: 4400, section: 1800, entity: 880 },
  plan: { doc: 6600, section: 2600, entity: 770 },
  finding: { doc: 4400, section: 1300, entity: 550 },
  /** ADR takes no tier multiplier. */
  adr: { doc: 5700, section: 2000, entity: 880 },
  /** Research takes no tier multiplier either: evidence carries no risk tier. Sized like a spec,
   *  not an intent — see the Korean bundle for why. */
  research: { doc: 8800, section: 2640, entity: 880 },
}

/** `sentences` is a count, not a length — it does not scale with the language. The rest are ×2.2. */
export const limits = { sentences: 4, title: 88, field: 440, ac: 220, logNote: 260 }

/** Does an ADR's consequences section name a cost? The ordinary ways a cost is named, and the
 *  template's own label («What it costs:», matched by `cost`). Left out on purpose, because a gain
 *  is phrased with them as often as a cost: `cannot` («an unentitled group cannot see it»),
 *  `no longer` («operators no longer push by hand»), `overhead` and `burden` («overhead drops»).
 *  With them in, the seeded costless decision would pass. */
export const tradeoff = /trade-?off|cost|give[s]? up|sacrific|accept(s|ed)? (the )?(risk|limit|constraint)|in exchange|at the price of|at the expense of|constraint|limitation|drawback|downside|\blos(e|es|ing)\b|\bslower\b|penalt/i

/** Is a revisit condition only a deadline? A calendar reminder is a review verb next to a point in
 *  time, or a point in time on its own. A duration inside a measured condition — «error rate stays
 *  above 1% for 3 days» — is part of what is measured and is not matched; the rule once matched any
 *  digit followed by a unit and warned on exactly that. */
const N = String.raw`(?:\d+|an?|one|two|three|four|five|six|nine|twelve|a few|several)`
const UNIT = String.raw`(?:days?|weeks?|months?|quarters?|years?|sprints?|releases?)`
const WHEN = String.raw`(?:(?:in|after|every|within)\s+${N}\s+${UNIT}|${N}\s+${UNIT}\s+(?:from now|later|ha(?:s|ve) passed|after (?:launch|release|adoption|rollout|this decision))|(?:next|each|every|the following)\s+(?:quarter|year|month|week|sprint|release|cycle)|quarterly|annually|yearly|monthly)`
const REVIEW = String.raw`(?:revisit|review|re-?evaluat|reassess|re-?examin|reconsider|look again|check (?:again|back))`
export const deadlineOnly = new RegExp(
  `${REVIEW}[^.;]{0,40}?\\b${WHEN}\\b|\\b${WHEN}\\b[^.;]{0,40}?${REVIEW}|^\\s*${WHEN}\\s*\\.?\\s*$|\\b(?:periodic(?:al)?(?:ly)?|regular|scheduled|annual)\\s+review`, 'i')

/** Text written to artifacts when the profile lang is en. */
export const written = {
  adrIndex: {
    title: 'Title', status: 'Status', legacy: 'legacy', heading: 'Decision log',
    comment: '<!-- Generated by adr-index.mjs. Do not edit manually; ADR files are the source of truth. -->',
    summary: (total, live, legacy) => `${total} decisions · ${live} active.${legacy ? ` ${legacy} legacy documents use H1 and header tables; add frontmatter to record scope.` : ''}`,
    live: 'Active decisions', past: 'Past decisions', empty: 'None yet.',
    history: 'Superseded, deprecated, or rejected decisions. IDs are never reused; these records explain earlier decisions and why they changed.',
  },
  result: { done: 'done', partial: 'partial', failed: 'failed' },
  divergence: 'differs from plan',
  none: 'none',
  noPr: 'no PR',
  // The title `plan-check mark` writes when the plan has no execution-log section yet. It must
  // stay one of SECTION.executionLog's aliases, or the section the tool creates would be invisible
  // to the `completed` rule and to the long-log linter — a section nobody but its author can read.
  executionLog: 'Execution log',
}
