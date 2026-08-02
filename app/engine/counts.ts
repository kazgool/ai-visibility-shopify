// DICTIONARY-PORT §7. "* term" reads a number written before the word, which
// is where a count always sits: "6 scaune", "4 persoane".

import { diacriticPattern } from "./normalize";

export function counted(text: string, base: string): string[] {
  const pattern = new RegExp(
    `\\b(\\d+)\\s+${diacriticPattern(base)}(?![\\p{L}\\p{N}])`,
    "gu",
  );
  const hits: string[] = [];
  for (const m of text.matchAll(pattern)) {
    hits.push(`${m[1]} ${base}`);
  }
  return hits;
}
