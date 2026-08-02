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

      // Word-boundary match so "tul" does not match "tulpina".
      const exact = new RegExp(
        `(?<![\\p{L}\\p{N}])${diacriticPattern(base)}(?![\\p{L}\\p{N}])`,
        "u",
      );
      if (exact.test(text)) hits.push(term);
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
