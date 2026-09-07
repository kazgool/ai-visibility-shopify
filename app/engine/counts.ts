// DICTIONARY-PORT §7. "* term" reads a number written before the word, which
// is where a count always sits: "6 scaune", "4 persoane".

import { diacriticPattern } from "./normalize";

export function counted(text: string, base: string): string[] {
  // The number may carry separators the merchant wrote: "29,7 g", "7.000 mg".
  // Reading only the digits after the last separator published "7 g" for a
  // 29,7 g pack, and the lookbehind is what stops the match from starting in
  // the middle of a number - that is where the "0 mg" values came from.
  // The separator is kept exactly as written; we do not reformat numbers.
  //
  // The space between number and unit is required, deliberately. Without it
  // every figure in a nutrition table ("per 100g", "Proteine 22g") joins the
  // pack-weight family and the per-group cap evicts the real pack weight.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}.,])(\\d+(?:[.,]\\d+)*)\\s+${diacriticPattern(base)}(?![\\p{L}\\p{N}])`,
    "gu",
  );
  const hits: string[] = [];
  for (const m of text.matchAll(pattern)) {
    hits.push(`${m[1]} ${base}`);
  }
  return hits;
}
