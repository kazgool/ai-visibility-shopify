// SPEC-EXTRACTION-QUALITY, batch 5 item 6. The mechanical delimitation rules:
// six classes of error, one rule each, every rule derived from the corpus with
// its counts in _shopify/corpus/facts-error-classes.md.
//
// "Mechanical" is the boundary Marius set on 12 September 2026. These rules
// decide where a value ENDS and whether what was captured is whole. They do
// not decide whether a whole, correctly delimited value belongs under the
// label it was found for - that is the largest error class (1,195 of 4,091,
// 29.2%) and it needs an abstention threshold, which is his to set. Nothing
// here abstains beyond these six.
//
// Pure: no Shopify, no Prisma, no I/O, like the rest of app/engine.

import { normalize } from "./normalize";

// --- rule 1: a bound or an operator is kept, never dropped -----------------

/**
 * Words and symbols that bound a figure. A figure published without the bound
 * in front of it states as a fact what the merchant stated as a limit: "up to
 * 20,000 Hz" became "Screen: 20,000 Hz", and "the unit weighs under 2 kg"
 * became "Size: 2kg".
 *
 * 127 errors of 4,091 carry this class; 92 of them are one group (Screen,
 * 110 errors of 121 values). The rule KEEPS the bound rather than dropping the
 * value, because a bounded figure is still a figure a buyer compares - this is
 * the one class where precision and coverage do not trade against each other.
 *
 * Romanian and English together, because one dictionary serves both and a
 * bound is not a dictionary term.
 */
const BOUNDS = [
  "<", ">", "≤", "≥", "~",
  "up to", "under", "over", "at least", "at most", "less than", "more than",
  "approximately", "approx", "about", "min", "max", "minimum", "maximum",
  "pana la", "până la", "de la", "sub", "peste", "cel putin",
  "cel puțin", "cel mult", "aproximativ", "circa", "maxim", "minim",
];

/**
 * Longest first, so "cel putin" wins over "cel".
 *
 * The leading lookbehind is batch 6 item 1. Without it the pattern matched the
 * TAIL of a longer word: "Tetra Algumin 100 ml" read "min" out of "Algumin"
 * and published "min 100 ml" - a limit the merchant never stated, on a
 * product whose volume is exact. Seven occurrences in the corpus, all "min",
 * all on animax.ro's Tetra Algumin (100 ml and 250 ml); the same shape is
 * open to every merchant word ending in a listed bound ("termin 5 minute"
 * read "min" too). A bound has to start where a word starts.
 */
const BOUND_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(${BOUNDS.slice()
    .sort((a, b) => b.length - a.length)
    .map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\\s*$`,
  "iu",
);

/** How much text to read back for a bound. Longer than the longest bound. */
const BOUND_LOOKBACK = 18;

/**
 * The bound standing immediately in front of `index`, or "".
 *
 * Only immediately: a bound further back belongs to a different figure. "de
 * la 10 lei, greutate 2 kg" must not put "de la" on the weight.
 */
export function boundBefore(text: string, index: number): string {
  const from = Math.max(0, index - BOUND_LOOKBACK);
  let before = text.slice(from, index);
  // The lookback can cut a word in half, and half a word looks exactly like
  // the start of the string to the lookbehind above - which is how a word
  // longer than the window would still fabricate a bound. When the character
  // before the window is a letter or a digit, the first token in the window
  // is that word's tail: drop it.
  if (from > 0 && /[\p{L}\p{N}]/u.test(text[from - 1]!)) {
    const space = before.search(/\s/u);
    before = space === -1 ? "" : before.slice(space);
  }
  const m = BOUND_PATTERN.exec(normalize(before));
  return m ? m[1] : "";
}

/** The value with its bound restored, or unchanged when there was none. */
export function withBound(text: string, index: number, value: string): string {
  const bound = boundBefore(text, index);
  return bound === "" ? value : `${bound} ${value}`;
}

// --- rule 2: a negation inside the captured span kills the capture ---------

/**
 * The engine's isNegated reads what stands BEFORE a match, which is right for
 * a plain term and blind to a prefix capture that swallowed the negator:
 * "with no harsh sulfates" was published as a key ingredient, and "no harsh
 * sulfates" is the opposite of an ingredient.
 *
 * 73 errors of 4,091. The rule is narrow on purpose - the negator has to be
 * inside the words that were kept, and a term that opens with one carries its
 * own polarity and is untouched, exactly as isNegated already decides.
 */
export function containsNegator(words: string[], negators: Set<string>): boolean {
  return words.some((w) => negators.has(normalize(w)));
}

// --- rule 3: two figures for one dimension is a pack, not a product -------

/**
 * Two values for the same named dimension mean the text describes more than
 * one piece: "L 130, l 75, h 60 cm, L 65" is a sofa and an armchair, and
 * "l 80, L 130, h 79 cm, L 170" is a table closed and extended. Nothing in
 * the text says which figure belongs to which, so nothing is publishable.
 *
 * 309 errors of 4,091, the great majority of them Dimensions on furniture.
 * Detected from the product's own data - repeated dimension names - and never
 * from one merchant's wording, which is what SPEC-EXTRACTION-QUALITY section
 * 4 requires.
 *
 * Returns the hits unchanged when no name repeats, and [] when one does. The
 * whole group goes, not the duplicate: keeping the first of two lengths is
 * choosing one at random, which is the error this rule exists to stop.
 */
export function withoutMergedDimensions(hits: string[]): string[] {
  const byName = new Map<string, Set<string>>();
  for (const hit of hits) {
    // The shape measurements() writes: "<name> <number>[ unit]". A chain
    // ("80x200 cm") carries no name and cannot collide.
    const m = /^(\p{L}+)\s+([\d.,]+)/u.exec(hit.trim());
    if (!m) continue;
    // Case is significant for a one-letter name and only for that: this
    // engine writes "L 130" for length and "l 80" for width, and
    // measurements() preserves the capital deliberately. Lowercasing them
    // made every furniture product collide with itself and deleted its whole
    // Dimensions group - caught by units.test.ts and by fixture C, which is a
    // contract with the WordPress original.
    const key = m[1].length === 1 ? m[1] : normalize(m[1]);
    const seen = byName.get(key) ?? new Set<string>();
    byName.set(key, seen);
    // Two DIFFERENT figures under one name are two pieces. The same figure
    // twice is the merchant repeating himself - a title that restates the
    // dimensions of the description, which is most of a furniture catalogue.
    // Counting occurrences rather than distinct values deleted every one of
    // them.
    seen.add(m[2].replace(",", "."));
  }
  for (const values of byName.values()) if (values.size > 1) return [];
  return hits;
}

// --- rule 4: a figure with nothing saying what it measures -----------------

/**
 * A word that is a number carrying a unit: "140mg", "6oz", "35h".
 *
 * The unit is required, and it is what makes the rule safe. A capture ending
 * in a plain integer is usually a number the merchant meant to state - a
 * notification number ("notificat de S.N.P.M.A.P.S. 1378/2023"), a model, a
 * year - and dropping those removed noise and value together, which is the
 * loss DICTIONARY-PORT section 10.1 says to prefer the noise to. Two tests in
 * abbreviations.test.ts caught it before this file was measured once.
 */
const FIGURE_WITH_UNIT = /^[\d.,]+\s?[\p{L}"']{1,4}$/u;

export function isFigure(word: string): boolean {
  return /\d/u.test(word) && FIGURE_WITH_UNIT.test(word.trim());
}

/**
 * A capture that ends on a figure has lost the noun the figure measured:
 * "contains approximately 140mg" drops "of caffeine per 6oz serving", and
 * under Ingredients it no longer says 140 mg of what. 107 errors of 4,091.
 *
 * Only the END of the capture. A figure in the middle is a value with its
 * noun still attached ("2 kg bag"), and a capture that is only a figure is
 * already refused by isUsablePhrase.
 */
export function endsOnLooseFigure(words: string[]): boolean {
  return words.length > 1 && isFigure(words[words.length - 1]);
}

/**
 * Bare measurements - a figure and a unit with no dimension name - are only
 * publishable one at a time. "16cm, 8cm, 15cm" on a bed frame is the mattress
 * offset, the beam cross-section and something else, listed as three numbers
 * with nothing saying what each measures. One such figure is a size a buyer
 * can use; three are a puzzle.
 */
export function atMostOneBareMeasurement(hits: string[]): string[] {
  if (hits.length <= 1) return hits;
  // Same unit only. Three figures in cm on a bed frame are three unrelated
  // lengths with nothing saying which is which; "45cm" and "8mm" on a
  // necklace are a chain length and a pearl, two different quantities that
  // are not ambiguous at all. capture-stops.test.ts caught the difference.
  const units = new Set(hits.map((h) => h.replace(/[\d\s.,]/gu, "").toLowerCase()));
  return units.size === 1 ? [] : hits;
}

// --- rule 5: a capture cut by the window, not by a boundary ----------------

/**
 * The prefix capture reads at most three words after its term. When all three
 * are taken and the sentence carries straight on, the value is not a value -
 * it is the first three words of a phrase: "with our new nourishing", "with
 * heads measuring within", "for ladies could".
 *
 * 944 errors of 4,091 are a value cut before the words that carry its
 * meaning, the second largest class, and this is the mechanical half of it.
 * A capture that ended because it reached punctuation, a connector or the end
 * of the sentence is untouched: that one ended where the merchant ended it.
 */
export function cutByWindow(text: string, endIndex: number, keptAll: boolean): boolean {
  if (!keptAll) return false;
  const next = text.slice(endIndex, endIndex + 2);
  // A word character straight after the last captured word means the match
  // stopped because it ran out of window.
  return /^\s+[\p{L}\p{N}]/u.test(next);
}

// --- rule 6: safety is published whole or not at all ----------------------

/**
 * The labels where a fragment is not a partial answer but a dangerous one.
 * Read off the 69 labels the corpus actually uses, in both languages the
 * dictionaries are written in; a merchant who names the group something else
 * gets the ordinary rules, which is the honest limit of a label-name test and
 * is stated here rather than hidden.
 *
 * "Alergeni" is 39 errors of 54 values today. An allergen line cut at "urme"
 * states the opposite of what the merchant wrote, and on a food shop that is
 * the worst value this app can publish.
 */
const SAFETY_LABELS = new Set(
  [
    "alergeni",
    "avertismente de eticheta",
    "avertismente",
    "valabilitate",
    "allergens",
    "allergen",
    "warnings",
    "warning",
    "expiry",
    "shelf life",
    "precautions",
    "contraindicatii",
    "contraindications",
  ].map((s) => normalize(s)),
);

export function isSafetyLabel(label: string): boolean {
  return SAFETY_LABELS.has(normalize(label));
}

/**
 * Under a safety label, a capture that was truncated at all - by the window
 * or by a connector - is not published. Either the merchant's whole statement
 * or nothing.
 */
export function safetyAllows(label: string, truncated: boolean): boolean {
  return !isSafetyLabel(label) || !truncated;
}

/**
 * The same rule for a PLAIN term, where nothing was truncated by us and the
 * fragment is the term itself.
 *
 * Republica BIO writes "poate contine urme de soia" and the merchant's own
 * dictionary carries "poate contine urme" as a term. The match is whole, the
 * capture machinery never runs, and what goes out is "Alergeni: poate contine
 * urme" - a trace-allergen warning with the allergen removed. 39 of 54
 * Alergeni values on that store, and on a food shop it is the worst value
 * this app can publish.
 *
 * His dictionary is his and is not rewritten (SPEC-EXTRACTION-QUALITY, the
 * decisions of 12 September 2026). What changes is what we do with the match:
 * under a safety label the statement is published only when the term reaches
 * the end of its own clause. A word following it means the merchant's
 * sentence carries on and our value is its first half.
 *
 * Safety labels only. Everywhere else a partial value is explicitly not an
 * error under the rubric ("a value that is true but partial"), and applying
 * this generally would delete most of the catalogue.
 */
export function safetyTermIsWhole(label: string, text: string, endIndex: number): boolean {
  if (!isSafetyLabel(label)) return true;
  // Only a preposition that was about to name the thing. Every one of the 39
  // Alergeni errors on Republica BIO is this shape - "cut before 'de soia'",
  // "cut before 'de sulfiti'", "cut before naming the traces" - and the
  // preposition is what proves the object is missing rather than merely
  // incomplete.
  //
  // A following "si lactoza" is deliberately allowed. "contine gluten si
  // lactoza" cut to "contine gluten" is a true statement that is not
  // exhaustive, which the rubric names explicitly as not an error ("a value
  // that is true but partial"). Dropping those too would remove value along
  // with noise, and negation.test.ts caught it on the first run.
  return !DANGLING_PREPOSITION.test(text.slice(endIndex, endIndex + 12));
}

/** A preposition that was about to name the thing our term stopped short of. */
const DANGLING_PREPOSITION = /^\s+(de|din|d'|of|with|containing|cu)\s+\p{L}/iu;
