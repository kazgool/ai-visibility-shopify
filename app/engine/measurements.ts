// DICTIONARY-PORT §6. The "#size" term is not a word to look for, it is an
// instruction: read measurements straight out of the prose.
//
// Dimensions cannot be captured by following a keyword: shops write them as
// "l 80, L 130, h 79 cm" or "80x200 cm", where the meaning sits in the numbers
// and the unit, not in the surrounding words.

const CHAIN = /\b\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?){1,2}\s*(?:cm|mm|m|inch|in|")\b/giu;

const NAMES =
  'l|h|w|d|lungime|latime|lățime|inaltime|înălțime|adancime|adâncime|diametru|length|width|height|depth|diameter';
const NAMED = new RegExp(
  `\\b(${NAMES})\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(cm|mm|m|inch|in|")?`,
  "giu",
);

const BARE = /\b\d+(?:[.,]\d+)?\s*(?:cm|mm|kg|g|ml|l)\b/giu;

export function measurements(text: string): string[] {
  const hits: string[] = [];

  for (const m of text.matchAll(CHAIN)) hits.push(m[0]);

  for (const m of text.matchAll(NAMED)) {
    const label = m[1].length === 1 ? m[1] : m[1].toLowerCase();
    const unit = m[3] ? ` ${m[3]}` : "";
    hits.push(`${label} ${m[2]}${unit}`.trim());
  }

  // Fallback only when neither shape above matched.
  if (hits.length === 0) {
    for (const m of text.matchAll(BARE)) hits.push(m[0]);
  }

  return hits;
}
