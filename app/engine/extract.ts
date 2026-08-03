// DICTIONARY-PORT §3–§5, §9. The assembly loop.

import { counted } from "./counts";
import { parseDictionary, type DictionaryGroup } from "./dictionary";
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
};

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

/** Remove terms contained in a longer matched term: "Chantilly lace" beats "lace". */
function dropSubsumed(hits: string[]): string[] {
  const normalized = hits.map((h) => normalize(h));
  return hits.filter((_, i) => {
    const needle = normalized[i];
    return !normalized.some(
      (other, j) => j !== i && other.length > needle.length && other.includes(needle),
    );
  });
}

function prefixCapture(
  text: string,
  base: string,
  stops: Set<string>,
): string[] {
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${diacriticPattern(base)}\\s+((?:[\\p{L}\\p{N}-]+\\s+){0,2}[\\p{L}\\p{N}-]+)`,
    "gu",
  );

  const hits: string[] = [];
  for (const match of text.matchAll(pattern)) {
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

    const phrase = trimPhrase(captured, stops);
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

export function extractFromText(
  text: string,
  dictionary: DictionaryGroup[] | string,
  options: ExtractOptions = {},
): Fact[] {
  const groups =
    typeof dictionary === "string" ? parseDictionary(dictionary) : dictionary;
  const stops = stopwordSet(options.extraStopwords ?? []);
  const maxValues = options.maxValues ?? 4;

  if (!text || text.trim() === "") return [];

  const found: Fact[] = [];

  for (const group of groups) {
    let hits: string[] = [];

    for (const term of group.terms) {
      if (term.trim().toLowerCase() === "#size") {
        hits = hits.concat(measurements(text));
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
        hits = hits.concat(prefixCapture(text, base, stops));
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
        const before = text.slice(Math.max(0, m.index! - 30), m.index!);
        if (APPEARANCE_QUALIFIER.test(before)) continue;
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
