// DICTIONARY-PORT §5.1–5.2. Phrase hygiene: what separates an attribute from
// a piece of a sentence.

import { normalize } from "./normalize";

/**
 * Drop filler words from both ends, so "drept si bretele" becomes "drept".
 */
export function trimPhrase(phrase: string, stops: Set<string>): string {
  let words = String(phrase ?? "").trim().split(/\s+/u).filter(Boolean);

  while (words.length > 0) {
    const last = normalize(words[words.length - 1]);
    if (last === "" || stops.has(last)) {
      words.pop();
      continue;
    }
    break;
  }

  // A phrase that starts with filler is not descriptive either.
  while (words.length > 0) {
    const first = normalize(words[0]);
    if (first === "" || stops.has(first)) {
      words.shift();
      continue;
    }
    break;
  }

  return words.join(" ").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "");
}

/**
 * Would this read as an attribute, or as a fragment? Stricter than the trim:
 * a stopword anywhere in the phrase kills it. "masă are blatul" tells an
 * assistant nothing and costs trust, so it is dropped rather than published.
 */
export function isUsablePhrase(phrase: string, stops: Set<string>): boolean {
  const value = String(phrase ?? "").trim();
  if (value === "") return false;
  if (/^[\d\s.,-]+$/u.test(value)) return false; // bare number, no unit

  for (const word of value.split(/\s+/u)) {
    if (stops.has(normalize(word))) return false;
  }
  return true;
}
