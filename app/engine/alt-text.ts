// Alt text (PRD §4.3).
//
// Rules paid for by the WordPress module, kept verbatim in spirit:
//
//  - Never put the summary in alt text. Screen readers read alt aloud in full,
//    and keyword-stuffed alt reads as spam to search engines. Short and
//    specific in alt; the long description belongs elsewhere.
//  - 125 characters, hard cap.
//  - Build it only from visually descriptive attributes, in priority order.
//    "Warranty" or "Room" tell you nothing about what the picture shows.
//  - Gallery images get distinct text, so image three does not repeat image one.

import type { Fact } from "./extract";
import { decodeEntities } from "./normalize";
import { looksLikeIdentifier } from "./phrase";

export const ALT_MAX_CHARS = 125;

/** Attributes that describe how something looks, in priority order. */
const VISUAL_KEYS = [
  "material", "materials", "fabric", "finish", "finisaj",
  "cut", "silhouette", "shape", "style", "stil",
  "colour", "color", "culoare",
  "neckline", "sleeves", "back",
  "length", "size", "dimensions", "dimensiuni",
  "details", "pattern", "features",
];

const FILENAME_PATTERNS = [
  /^dsc[\s_-]?\d+$/i,
  /^img[\s_-]?\d+$/i,
  /^image[\s_-]?\d+$/i,
  /^photo[\s_-]?\d+$/i,
  /^p\d{6,}$/i,
  /^\d{8,}$/,
  /^[a-f0-9]{8,}$/i,
  /^(screenshot|whatsapp|untitled)/i,
];

/**
 * Is this "alt text" actually a filename nobody wrote?
 *
 * Merchants rarely name their images, so what arrives is DSC_4471,
 * image_123650291, or a UUID from a migration. Publishing that as a
 * description is worse than leaving the field empty: a screen reader reads it
 * aloud, character by character.
 */
export function looksLikeFilename(value: string): boolean {
  const clean = value.trim().replace(/\.(jpe?g|png|webp|gif|avif)$/i, "");
  if (clean === "") return true;
  if (FILENAME_PATTERNS.some((re) => re.test(clean))) return true;

  // A single token that reads as an identifier rather than a description.
  const words = clean.split(/\s+/);
  if (words.length === 1 && looksLikeIdentifier(words[0])) return true;

  return false;
}

function visualFacts(facts: Fact[]): Fact[] {
  const rank = (f: Fact) => {
    const i = VISUAL_KEYS.indexOf(f.k.toLowerCase());
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return facts.filter((f) => rank(f) !== Number.MAX_SAFE_INTEGER).sort((a, b) => rank(a) - rank(b));
}

function truncate(text: string, max = ALT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Short, specific, and different per position. Position 0 is the main image.
 */
export function buildAltText(
  product: { title: string; productType?: string | null },
  facts: Fact[],
  position = 0,
): string {
  const visual = visualFacts(facts);
  const base = decodeEntities(product.title).replace(/\s+/g, " ").trim();

  if (visual.length === 0) {
    return truncate(position === 0 ? base : `${base}, view ${position + 1}`);
  }

  // Rotate which attributes lead, so gallery images do not read identically.
  const rotated = visual.slice(position % visual.length).concat(visual.slice(0, position % visual.length));
  const descriptors = rotated
    .map((f) => f.v.split(",")[0].trim())
    // A stray SKU or migration UUID in an attribute value must not reach alt
    // text: a screen reader would read it out character by character. Values
    // can also be human-written, so this guard cannot live only in extraction.
    .filter((d) => d !== "" && !d.split(/\s+/).some(looksLikeIdentifier))
    .slice(0, 2);

  const detail = descriptors.join(", ");
  const suffix = position === 0 ? "" : `, view ${position + 1}`;
  return truncate(detail ? `${base} — ${detail}${suffix}` : `${base}${suffix}`);
}
