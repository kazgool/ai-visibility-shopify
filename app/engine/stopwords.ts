// DICTIONARY-PORT §11, verbatim from the WordPress engine.
//
// A term captured next to one of these reads as a sentence fragment rather
// than an attribute, and a fragment in structured data is worse than a gap.
// These came from real failures on a live furniture catalogue — do not prune
// this list to make extraction "find more".

import { normalize } from "./normalize";

export const DEFAULT_STOPWORDS: string[] = [
  // Romanian connectors, articles and prepositions.
  "si", "și", "cu", "iar", "dar", "care", "pentru", "din", "la", "in", "în",
  "pe", "ce", "sau", "a", "al", "ale", "ai", "de", "ca", "cat", "cât", "un",
  "o", "unei", "unui", "cel", "cea", "prin", "sub", "peste", "intre", "între",
  "dupa", "după", "catre", "către", "fara", "fără", "lui", "lor", "sa", "sa-",
  "se", "isi", "își", "nu", "mai", "foarte", "atat", "atât",
  // Romanian verbs that show up mid-sentence and end up glued to a term.
  "este", "e", "sunt", "era", "au", "are", "aveti", "aveți", "fi", "fost",
  "face", "fac", "realizat", "realizata", "realizată", "fixat", "fixata",
  "fixată", "aflat", "aflata", "aflată", "gasesc", "găsesc", "gaseste",
  "găsește", "poate", "pot", "va", "vor", "contine", "conține", "livreaza",
  "livrează", "ambalat", "montat", "demontat",
  // English equivalents, for shops writing in English.
  "and", "or", "with", "the", "a", "an", "of", "for", "from", "to", "in",
  "on", "at", "by", "is", "are", "was", "were", "be", "been", "has", "have",
  "had", "it", "its", "this", "that", "which", "made", "comes", "come",
];

/**
 * Normalized stopword set. Merchant additions (settings) are appended, so a
 * shop writing in another language can extend the list without code.
 */
export function stopwordSet(extra: string[] = []): Set<string> {
  const all = [...DEFAULT_STOPWORDS, ...extra];
  return new Set(all.map((w) => normalize(w)).filter((w) => w !== ""));
}
