// DICTIONARY-PORT §6. The "#size" term is not a word to look for, it is an
// instruction: read measurements straight out of the prose.
//
// Dimensions cannot be captured by following a keyword: shops write them as
// "l 80, L 130, h 79 cm" or "80x200 cm", where the meaning sits in the numbers
// and the unit, not in the surrounding words.

import { atMostOneBareMeasurement, withBound, withoutMergedDimensions } from "./delimit";

const CHAIN = /\b\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?){1,2}\s*(?:cm|mm|m|inch|in|")\b/giu;

const NAMES =
  'l|h|w|d|lungime|latime|lățime|inaltime|înălțime|adancime|adâncime|diametru|length|width|height|depth|diameter';
const NAMED = new RegExp(
  `\\b(${NAMES})\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(cm|mm|m|inch|in|")?`,
  "giu",
);

const BARE = /\b\d+(?:[.,]\d+)?\s*(?:cm|mm|kg|g|ml|l)\b/giu;

export function measurements(text: string): string[] {
  // Batch 5 item 6, rule 1: a bound in front of a figure is part of the
  // figure. "up to 20,000 Hz" published as "20,000 Hz" states a limit as a
  // fact, which is 92 of the 110 Screen errors in the corpus.
  const chain: string[] = [];
  for (const m of text.matchAll(CHAIN)) chain.push(withBound(text, m.index!, m[0]));

  const named: string[] = [];
  for (const m of text.matchAll(NAMED)) {
    const label = m[1].length === 1 ? m[1] : m[1].toLowerCase();
    const unit = m[3] ? ` ${m[3]}` : "";
    named.push(withBound(text, m.index!, `${label} ${m[2]}${unit}`.trim()));
  }

  // Batch 5 item 6, rule 3, IMPLEMENTED AND NOT ENABLED. Two figures for one
  // named dimension mean the text describes more than one piece, and nothing
  // in it says which figure belongs to which.
  //
  // It is off because it contradicts fixture C, which is a contract with the
  // WordPress original (CLAUDE.md: "If one fails, the port has drifted - fix
  // the code, never the fixture"). Fixture C's text is
  //   "Dimensiuni: -Masa: l 80, L 130, h 79 cm -Scaune: adancime 50, h scaun 94 cm"
  // and it asserts that Dimensiuni contains "130". That value is a table and
  // its chairs merged into one - h 79 and h 94 - which is exactly the defect
  // this rule exists to stop, and it is exactly what the fixture asserts we
  // publish. The rule cannot be narrowed to spare the fixture without being
  // narrowed to spare the 309 corpus errors it is for.
  //
  // So this is a decision for Marius, not a patch: either the fixture is
  // amended, with the port documented as deliberately diverging here, or the
  // rule goes. Reported in the batch 5 handover; the function and its tests
  // stay so the answer is one line either way.
  const MERGED_DIMENSIONS_RULE = false;
  const hits = [...chain, ...(MERGED_DIMENSIONS_RULE ? withoutMergedDimensions(named) : named)];
  if (hits.length > 0) return hits;

  // Fallback only when neither shape above matched. Batch 5 item 6, rule 4:
  // a bare figure has no dimension name, so more than one of them is a puzzle
  // rather than a size ("16cm, 8cm, 15cm" on a bed frame).
  const bare: string[] = [];
  for (const m of text.matchAll(BARE)) bare.push(withBound(text, m.index!, m[0]));
  return atMostOneBareMeasurement(bare);
}
