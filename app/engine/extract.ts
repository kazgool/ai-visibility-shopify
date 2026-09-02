// DICTIONARY-PORT §3–§5, §9. The assembly loop.

import { counted } from "./counts";
import {
  DEFAULT_NEGATORS,
  parseDictionary,
  parseDictionaryOptions,
  type DictionaryGroup,
} from "./dictionary";
import { measurements } from "./measurements";
import { diacriticPattern, normalize } from "./normalize";
import { isUsablePhrase, trimPhrase } from "./phrase";
import { stopwordSet } from "./stopwords";

export type Fact = { k: string; v: string };

export type ExtractOptions = {
  /** Extra stopwords a shop adds in settings. */
  extraStopwords?: string[];
  /** Max values joined per label. WordPress used 4. */
  maxValues?: number;
  /** Same text with its original capitals, used only by measurements. */
  casedText?: string;
  /** Negation words, when the caller has them already parsed. */
  negators?: string[];
};

/**
 * How far back a negator is looked for. Three tokens covers "produsul nu
 * contine gluten" and stops well short of the previous clause, where a "nu"
 * belongs to something else entirely.
 */
const NEGATION_WINDOW = 3;

function negatorSet(words: string[]): Set<string> {
  return new Set(words.map((w) => normalize(w)).filter((w) => w !== ""));
}

/**
 * Is the occurrence at `index` denied by what stands in front of it?
 *
 * "nu contine gluten" published "contine gluten" - the one class of false
 * fact that is worse than no fact at all, because the merchant's own text
 * says the opposite. The window is read from the start of the sentence, so a
 * full stop ends it, and only from the tokens *before* the matched span: the
 * negator is part of the term itself in "fara gluten", and checking inside
 * the match would silence every such term in the dictionary.
 */
function isNegated(
  text: string,
  index: number,
  negators: Set<string>,
  term: string,
  terms: Set<string> = new Set(),
): boolean {
  // A term that opens with a negator carries its own polarity: "fara arome"
  // after "fara coloranti" is a second free-from claim, not a denial of the
  // first. Without this, a list of "fara x, fara y" published only its first
  // entry - the same trap as row four of the acceptance table, one term along.
  const firstWord = normalize(term).split(" ")[0] ?? "";
  if (negators.has(firstWord)) return false;

  // The window ends at the clause, not only at the sentence. "Fulgi de ovaz
  // fara gluten, Bio (Avena sativa)" denies gluten and states a species; a
  // window that reads across the comma would drop the species.
  const sentence = text.slice(0, index).split(/[.!?;,:\n()[\]]/u).pop() ?? "";
  // The whole clause is tokenized, but only the last NEGATION_WINDOW tokens may
  // *hold* a negator. The earlier tokens are read for the tail test alone: the
  // word that identifies a negator as the tail of a term can sit outside the
  // acceptance window, and cutting the slice at the window meant that in "free
  // shipping and email support" nothing at all stood in front of "free".
  const tokens = normalize(sentence).split(" ").filter(Boolean);
  const windowStart = Math.max(0, tokens.length - NEGATION_WINDOW);
  const termWords = wordsOfTerms(terms);

  for (let start = windowStart; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= tokens.length; end += 1) {
      if (!negators.has(tokens.slice(start, end).join(" "))) continue;
      // A negator that is the tail of a dictionary term belongs to that term,
      // not to what comes after it. English writes free-from claims backwards
      // - "dairy free" - so in "dairy free and gluten free" the first "free"
      // filled the window and suppressed the second claim entirely. The test
      // is exact rather than a guess: the occurrence is ignored only when the
      // words in front of it plus the negator itself spell out a term this
      // dictionary actually carries. "produsul nu contine gluten" is
      // untouched, because "produsul nu" is no term.
      if (isTailOfTerm(tokens, start, end, terms)) continue;
      if (!reachesMatch(tokens, end, termWords)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Does the negator that ends at `end` still have the match in its scope?
 *
 * A negator introduces one noun phrase and denies that. It keeps reaching
 * forward across an elided list - "fara gluten si lactoza" denies both, and
 * "fara ingrediente de origine animala" denies the origin four tokens later.
 * It stops only where the sentence has moved on to a second, independent
 * thing: a coordinator that comes *after* a word belonging to no term of this
 * dictionary. That word is what the negator was actually modifying, so the
 * negator is the head of a phrase naming something the merchant offers, not a
 * denial of what follows. "Free shipping and email support" is the shape:
 * "shipping" is in no term, so "and" ends the scope and the support survives.
 * "Free updates and email support" is not, because "updates" is a term word
 * and the phrase is still the denied list.
 */
function reachesMatch(tokens: string[], end: number, termWords: Set<string>): boolean {
  let sawForeignWord = false;
  for (let i = end; i < tokens.length; i += 1) {
    if (COORDINATORS.has(tokens[i])) {
      if (sawForeignWord) return false;
      continue;
    }
    if (!termWords.has(tokens[i])) sawForeignWord = true;
  }
  return true;
}

/** Words that join two items, or two independent statements. */
const COORDINATORS = new Set(["si", "sau", "and", "or", "nor", "ori"]);

function wordsOfTerms(terms: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const term of terms) for (const word of term.split(" ")) if (word) out.add(word);
  return out;
}

/**
 * Do the tokens ending at `end` and starting at or before `start` spell a term?
 * The look-back reaches further than the acceptance window, because the term a
 * negator belongs to can begin before it.
 */
function isTailOfTerm(
  tokens: string[],
  start: number,
  end: number,
  terms: Set<string>,
): boolean {
  for (let from = start - 1; from >= 0; from -= 1) {
    if (terms.has(tokens.slice(from, end).join(" "))) return true;
  }
  return false;
}

/**
 * Connectors that end a captured value: what follows one is prose about the
 * value, not more of the value. "produs in Franta per portie" is an origin
 * and then a serving size, and publishing the pair as one origin states
 * something the merchant never wrote. The stop never applies to the first
 * captured word, so a value is truncated rather than lost - keeping the part
 * that is a value and dropping the part that is prose (DICTIONARY-PORT
 * §10.1). Commas, brackets and colons need no entry here: the capture
 * pattern already ends at anything that is not a word character.
 *
 * "de" and "din" are deliberately absent, though they are connectors too:
 * they sit inside real values ("faina din seminte de dovleac"), and stopping
 * there turns a value into a truncation. On the Republica BIO catalogue that
 * cost a real ingredient, which is the loss §10.1 says to prefer the noise to.
 */
const CAPTURE_STOPS = new Set([
  "per", "cu", "si", "sau", "pentru", "la", "for", "with", "and", "or",
]);

/**
 * Plain terms that collide with a connector or verb and are therefore never
 * matched. Surfaced in the dictionary editor so the merchant can rename them
 * rather than wonder why nothing matches.
 */
export function collidingTerms(
  dictionary: DictionaryGroup[] | string,
  extraStopwords: string[] = [],
): { label: string; term: string }[] {
  const groups =
    typeof dictionary === "string" ? parseDictionary(dictionary) : dictionary;
  const stops = stopwordSet(extraStopwords);
  const out: { label: string; term: string }[] = [];

  for (const group of groups) {
    for (const term of group.terms) {
      if (term.startsWith("*") || term.endsWith("*")) continue;
      if (term.trim().toLowerCase() === "#size") continue;
      if (stops.has(normalize(term))) out.push({ label: group.label, term });
    }
  }
  return out;
}

/**
 * Words that only ever introduce a value, never form part of one. Two hits that
 * differ by nothing but one of these are the same fact written twice, once as
 * prose: "with retinol" and "retinol", "contains salmon" and "salmon",
 * "compatible with ios" and "iOS".
 */
const CONNECTOR_LEADS = new Set([
  ...CAPTURE_STOPS, "contains", "contain", "includes", "including", "compatible", "contine",
]);

function stripLeadingConnectors(value: string): string {
  const words = value.split(" ").filter(Boolean);
  let i = 0;
  while (i < words.length - 1 && CONNECTOR_LEADS.has(words[i])) i += 1;
  return words.slice(i).join(" ");
}

/** Remove terms contained in a longer matched term: "Chantilly lace" beats "lace". */
function dropSubsumed(hits: string[]): string[] {
  const normalized = hits.map((h) => normalize(h));
  const stripped = normalized.map(stripLeadingConnectors);
  return hits.filter((_, i) => {
    const needle = normalized[i];
    // The connector-led form loses to the plain one. A prefix capture that
    // truncates at a connector revives values like "with retinol", which are
    // longer than "retinol" and would otherwise subsume it - swapping a clean
    // value for the prose around it, and losing the plain term's capitals with
    // it ("compatible with ios" for "iOS").
    if (stripped[i] !== needle && normalized.some((o, j) => j !== i && o === stripped[i])) {
      return false;
    }
    return !normalized.some(
      (other, j) =>
        j !== i &&
        other.length > needle.length &&
        other.includes(needle) &&
        stripLeadingConnectors(other) !== needle,
    );
  });
}

/** Every dictionary term, normalized, with its wildcards stripped. */
function termSet(groups: DictionaryGroup[]): Set<string> {
  const out = new Set<string>();
  for (const group of groups) for (const key of groupTermSet(group)) out.add(key);
  return out;
}

function groupTermSet(group: DictionaryGroup, plainOnly = false): Set<string> {
  const out = new Set<string>();
  for (const term of group.terms) {
    const trimmed = term.trim();
    if (trimmed.toLowerCase() === "#size") continue;
    const wildcard = trimmed.startsWith("*") || trimmed.endsWith("*");
    if (plainOnly && wildcard) continue;
    const base = trimmed.replace(/^\*+|\*+$/g, "").trim();
    if (base === "") continue;
    const key = normalize(base);
    if (key !== "") out.add(key);
  }
  return out;
}

function prefixCapture(
  text: string,
  base: string,
  stops: Set<string>,
  negators: Set<string>,
  terms: Set<string>,
  groupTerms: Set<string>,
): string[] {
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${diacriticPattern(base)}\\s+((?:[\\p{L}\\p{N}-]+\\s+){0,2}[\\p{L}\\p{N}-]+)`,
    "gu",
  );

  const hits: string[] = [];
  for (const match of text.matchAll(pattern)) {
    if (isNegated(text, match.index!, negators, base, terms)) continue;

    const captured = match[1];
    const words = captured.trim().split(/\s+/u);
    const first = normalize(words[0] ?? "");

    // A connector or verb straight after the term means the term was used in
    // a sentence, not as a label: "masa are blatul din PAL". Trimming the verb
    // would leave "masa blatul", which is worse than admitting there is
    // nothing here.
    if (stops.has(first)) continue;

    // A number straight after the term is a measurement or a count. Both have
    // their own handling and belong under a different label.
    if (/^\d/u.test(first)) continue;

    const kept: string[] = [];
    for (const word of words) {
      if (kept.length > 0 && CAPTURE_STOPS.has(normalize(word))) break;
      kept.push(word);
    }

    // Truncation keeps the part that is a value and drops the part that is
    // prose, but on one shape it keeps prose: "square neckline finished with
    // delicate lace" published "neckline finished". The rule, stated: drop
    // the capture when a single word survives the truncation, that word is
    // not itself a dictionary term, and the label word was used attributively
    // - a plain term of this same family stands immediately in front of it,
    // as "square" does before "neckline". English puts the value before the
    // label, so the value is already matched by that term and what follows
    // the label is the sentence carrying on. Publish nothing rather than a
    // verb.
    //
    // Both halves of that condition are load-bearing, and the catalogue
    // proved it. "produs in Franta per portie" truncates to the same shape
    // and is a real origin, so "one word left and it is not a term" alone
    // would delete it. Widening the word in front to any family instead of
    // this one deleted "produs in italia" on twelve products, because
    // "ecologic" stood before it and is a term under Certificari; counting
    // wildcard terms as values deleted ten more, because the merchant writes
    // "origine produs in Spania" and "origine *" is a term of this family.
    if (kept.length === 1 && kept.length < words.length && !terms.has(normalize(kept[0]))) {
      const before = text.slice(0, match.index!).trimEnd().split(/\s+/u).pop() ?? "";
      if (groupTerms.has(normalize(before))) continue;
    }

    const phrase = trimPhrase(kept.join(" "), stops);
    if (!isUsablePhrase(phrase, stops)) continue;

    hits.push(`${base} ${phrase}`);
  }
  return hits;
}

/**
 * Words that, immediately before a term, say "looks like" rather than "is":
 * aspect de marmura, tip marmura, imitatie de lemn, efect de catifea.
 * Narrow on purpose (DICTIONARY-PORT §10.1): each entry is an explicit
 * disclaimer written by the merchant, not a guess of ours. "stil" is
 * deliberately absent - it would reject the Stil group's own matches
 * ("stil contemporan"), a filter eating value along with noise.
 */
const APPEARANCE_QUALIFIER =
  /(?:aspect(?:\s+de)?|tip|imita[tț]ie(?:\s+de)?|efect(?:\s+de)?|imitation|faux|look(?:\s+of)?|effect)\s*$/iu;

/**
 * English puts the disclaimer after the noun: "marble effect", "marble-look",
 * "oak style veneer". Same idea, opposite direction. "finish" is deliberately
 * absent - "oiled oak finish" is a real oak finish, not an imitation.
 */
const APPEARANCE_QUALIFIER_AFTER = /^\s*[-\s]?\s*(?:effect|look(?:alike)?|style)\b/iu;

export function extractFromText(
  text: string,
  dictionary: DictionaryGroup[] | string,
  options: ExtractOptions = {},
): Fact[] {
  const groups =
    typeof dictionary === "string" ? parseDictionary(dictionary) : dictionary;
  const stops = stopwordSet(options.extraStopwords ?? []);
  const negators = negatorSet(
    options.negators ??
      (typeof dictionary === "string"
        ? parseDictionaryOptions(dictionary).negators
        : DEFAULT_NEGATORS),
  );
  const maxValues = options.maxValues ?? 4;
  const terms = termSet(groups);

  if (!text || text.trim() === "") return [];

  const found: Fact[] = [];

  for (const group of groups) {
    let hits: string[] = [];
    // Plain terms only: a wildcard term is a label, not a value, and
    // "origine" standing before "produs in Spania" is the merchant labelling
    // the field, not a value already stated.
    const ownTerms = groupTermSet(group, true);

    for (const term of group.terms) {
      if (term.trim().toLowerCase() === "#size") {
        hits = hits.concat(measurements(options.casedText ?? text));
        continue;
      }

      const isCount = term.startsWith("*");
      const isPrefix = term.endsWith("*");
      const base = term.replace(/^\*+|\*+$/g, "").trim();
      if (base === "") continue;

      if (isCount) {
        hits = hits.concat(counted(text, base));
        continue;
      }

      if (isPrefix) {
        hits = hits.concat(prefixCapture(text, base, stops, negators, terms, ownTerms));
        continue;
      }

      // A plain term that is also a connector or a verb cannot be trusted:
      // Romanian "in" (linen) is also the preposition "in", so every product
      // would claim to be made of linen. Skip it and let the dictionary test
      // report the collision (collidingTerms below).
      if (stops.has(normalize(base))) continue;

      // Word-boundary match so "tul" does not match "tulpina".
      const exact = new RegExp(
        `(?<![\\p{L}\\p{N}])${diacriticPattern(base)}(?![\\p{L}\\p{N}])`,
        "ug",
      );
      // "aspect de marmura" is not marble - it says so itself. A term
      // preceded by an appearance qualifier describes what a thing looks
      // like, not what it is, and claiming otherwise is exactly the false
      // fact this engine exists to never write. Only occurrences without
      // the qualifier count; a text that also says "blat din marmura"
      // elsewhere still matches there.
      for (const m of text.matchAll(exact)) {
        // "nu contine gluten" is a denial, not a claim. Scanning continues to
        // the next occurrence: a text can deny it in one sentence and state
        // it in another, and only the stated one is ours to publish.
        if (isNegated(text, m.index!, negators, base, terms)) continue;
        const before = text.slice(Math.max(0, m.index! - 30), m.index!);
        if (APPEARANCE_QUALIFIER.test(before)) continue;
        const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 20);
        if (APPEARANCE_QUALIFIER_AFTER.test(after)) continue;
        hits.push(term);
        break;
      }
    }

    // Unique on the normalized form, so "piele ecologica" and "piele
    // ecologică" do not both end up in the same list.
    const seen = new Map<string, string>();
    for (const hit of hits) {
      const key = normalize(hit);
      if (key === "" || seen.has(key)) continue;
      seen.set(key, hit);
    }
    hits = Array.from(seen.values());

    if (hits.length === 0) {
      if (group.fallback !== "") found.push({ k: group.label, v: group.fallback });
      continue;
    }

    hits = dropSubsumed(hits);
    found.push({ k: group.label, v: hits.slice(0, maxValues).join(", ") });
  }

  return found;
}
