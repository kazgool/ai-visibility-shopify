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

/** Is this "alt text" actually a camera filename nobody wrote? */
export function looksLikeFilename(value: string): boolean {
  const clean = value.trim().replace(/\.(jpe?g|png|webp|gif|avif)$/i, "");
  if (clean === "") return true;
  return FILENAME_PATTERNS.some((re) => re.test(clean));
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
  const base = product.title.trim();

  if (visual.length === 0) {
    return truncate(position === 0 ? base : `${base}, view ${position + 1}`);
  }

  // Rotate which attributes lead, so gallery images do not read identically.
  const rotated = visual.slice(position % visual.length).concat(visual.slice(0, position % visual.length));
  const descriptors = rotated
    .slice(0, 2)
    .map((f) => f.v.split(",")[0].trim())
    .filter(Boolean);

  const detail = descriptors.join(", ");
  const suffix = position === 0 ? "" : `, view ${position + 1}`;
  return truncate(detail ? `${base} — ${detail}${suffix}` : `${base}${suffix}`);
}
