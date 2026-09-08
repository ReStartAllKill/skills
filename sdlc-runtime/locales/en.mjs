/** English style bundle — the ruler `lint-prose.mjs` and `adr-check.mjs` measure prose with.
 *
 * The contract (`tools/keywords.mjs`) does not come through here. That layer is what a checker
 * reads to *parse* a document and must never depend on a language; this file is what measures
 * prose a person will read, and that can only be per-language.
 *
 * **The numbers here are derived, not measured on English artifacts.** See §Budget below for the
 * derivation and for what would replace it. The word lists are authored; the Korean bundle's
 * lists are not translations of these and neither is a translation of the other.
 */

/** Does this bundle own the document's language?
 *
 *  Measured on this repository's parallel README pair: README.md is 0.989 Latin, README.ko.md is
 *  0.124 Latin. A 0.7 threshold sits clear of both, the way `ko`'s 0.3 sits clear of 0.876 and
 *  0.011. Code spans are stripped before counting, so identifiers do not pull a Korean document up.
 */
export const script = {
  test: /[A-Za-z]/g,
  against: /[가-힣]/g,
  minRatio: 0.7,
  /** Short documents swing too much to judge. */
  minChars: 200,
  name: 'English',
}

/** Does an acceptance criterion read as a full statement?
 *  A final period is the proxy, the way `다` is in Korean. Like that rule it is only a proxy —
 *  «AC-001 — only archived.» passes it and is still not a criterion. */
export const acSentence = /\.$/

/** Words that stand where a measurement belongs. Matched with word boundaries: without them
 *  `most` fires inside `almost` and `fast` inside `breakfast`. A line carrying a number is exempt. */
export const vague = [
  /\bfast(er)?\b/i, /\bquick(ly)?\b/i, /\bslow\b/i, /\bappropriate(ly)?\b/i, /\bproper(ly)?\b/i,
  /\beas(y|ily)\b/i, /\bsimple\b/i, /\bseamless(ly)?\b/i, /\brobust\b/i, /\bscalable\b/i,
  /\bflexible\b/i, /\befficient(ly)?\b/i, /\boptimiz(e|ed|ation)\b/i, /\bimprove[ds]?\b/i,
  /\bbetter\b/i, /\benhance[ds]?\b/i, /\bstable\b/i, /\breliable\b/i, /\buser-friendly\b/i,
  /\bintuitive\b/i, /\bclean(er)?\b/i, /\bworks well\b/i, /\bno issues\b/i, /\bsufficient(ly)?\b/i,
  /\bmost of\b/i, /\boften\b/i, /\bas much as possible\b/i, /\bif possible\b/i, /\bsmooth(ly)?\b/i,
  /\band so on\b/i, /\betc\b/i,
]

/** Wordiness and hidden actors. English's equivalent of the Korean list's 번역체 — the passive
 *  voice hides who does the work, and the long forms say nothing the short ones do not. */
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

/** Characters excluding whitespace, at the `light` tier.
 *
 *  **Derivation, not measurement.** Each value is the `ko` bundle's × 2.2. The ratio comes from
 *  this repository's parallel READMEs: nine matching sections, English over Korean, mean 2.16,
 *  median 2.21, range 1.90–2.49 — a tight spread across sections of different length and subject.
 *
 *  What is weak about it: a README is explanatory prose, and an artifact is short ID-headed items,
 *  tables and acceptance criteria. Korean artifacts also use a clipped nominal ending that
 *  compresses them further, so the artifact ratio is more likely above 2.2 than below. And a
 *  budget is a judgement about how much a document should *say*, which a character ratio only
 *  approximates.
 *
 *  One artifact pair now exists to check it against: the `english-chain` and `clean-spec` eval
 *  cases hold the same intent and spec in both languages, and they come out at 2.25 and 1.97 —
 *  inside the README range rather than above it. That is two documents, not a measurement.
 *
 *  Replace these once a handful of English chains exist: measure them the way the Korean values
 *  were measured (42 artifacts), and delete this note. */
export const budget = {
  intent: { doc: 2600, section: 1100, entity: 550 },
  spec: { doc: 4400, section: 1800, entity: 880 },
  plan: { doc: 6600, section: 2600, entity: 770 },
  finding: { doc: 4400, section: 1300, entity: 550 },
  /** ADR takes no tier multiplier. */
  adr: { doc: 5700, section: 2000, entity: 880 },
}

/** `sentences` is a count, not a length — it does not scale with the language. The rest are ×2.2. */
export const limits = { sentences: 4, title: 88, field: 440, ac: 220 }

/** Does an ADR's consequences section name a cost? */
export const tradeoff = /trade-?off|cost|give[s]? up|sacrific|accept(s|ed)? (the )?(risk|limit|constraint)|in exchange|at the price of/i
/** Is a revisit condition only a deadline? */
export const deadlineOnly = /\d\s*(months?|weeks?|quarters?|years?|days?)|next quarter|periodic(ally)? review|revisit (in|after)/i
