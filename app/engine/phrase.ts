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
/**
 * File names, SKUs and UUIDs look like words to a regex but mean nothing to a
 * buyer: "B6ADC692-C01B-4229-8956-100A9AFB8C46". Catalogues are full of them
 * because image names leak into descriptions during migrations.
 */
export function looksLikeIdentifier(word: string): boolean {
  const w = word.trim();
  const bare = w.replace(/-/g, "");

  // Only strong signals. Being greedy here would throw away real
  // specifications — "160x80", "M8x40", "IP65", "DDR4" are values a buyer
  // compares, and losing them is worse than letting a stray code through.
  if (/^[0-9a-f]{8,4096}$/i.test(bare) && /\d/.test(bare) && /[a-f]/i.test(bare)) {
    return true; // hex block: 3ba7dee8f7bd4e14, or a UUID with hyphens removed
  }
  if (/^[0-9a-z]{16,}$/i.test(bare) && /\d/.test(bare) && /[a-z]/i.test(bare)) {
    return true; // any 16+ character alphanumeric soup
  }
  return false;
}

export function isUsablePhrase(phrase: string, stops: Set<string>): boolean {
  const value = String(phrase ?? "").trim();
  if (value === "") return false;
  if (/^[\d\s.,-]+$/u.test(value)) return false; // bare number, no unit

  for (const word of value.split(/\s+/u)) {
    if (stops.has(normalize(word))) return false;
    if (looksLikeIdentifier(word)) return false;
  }
  return true;
}
