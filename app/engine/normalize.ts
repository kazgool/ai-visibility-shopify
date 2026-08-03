// DICTIONARY-PORT §8. Ported from class-avw-attributes.php (normalize,
// diacritic_pattern). Matching is diacritic-blind so a dictionary written
// with diacritics matches text written without them, and the other way round.

const DIACRITIC_MAP: Record<string, string> = {
  ă: "a", â: "a", î: "i", ș: "s", ş: "s", ț: "t", ţ: "t",
  Ă: "a", Â: "a", Î: "i", Ș: "s", Ş: "s", Ț: "t", Ţ: "t",
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ö: "o", ñ: "n",
};

/** Character classes used when building a match pattern from a dictionary term. */
const EQUIVALENCE: Record<string, string> = {
  a: "aăâ", ă: "aăâ", â: "aăâ",
  i: "iî", î: "iî",
  s: "sșş", ș: "sșş", ş: "sșş",
  t: "tțţ", ț: "tțţ", ţ: "tțţ",
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", eacute: "é", agrave: "à", uuml: "ü",
};

/**
 * Catalogues imported from other platforms carry HTML entities in plain text
 * fields: "Set Masa &#038; 6 Scaune &#8211; Beige". Left alone they end up in
 * alt text and structured data, where they read as gibberish.
 */
export function decodeEntities(input: string): string {
  return String(input ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

export function stripTags(input: string): string {
  return decodeEntities(String(input ?? "").replace(/<[^>]*>/g, " "));
}

/**
 * Strip diacritics and lowercase, so "croială" matches "croiala".
 * Used for stopword comparison, dedup keys and subsumption — never for
 * display: what we capture is shown as written.
 */
export function normalize(input: string): string {
  let text = stripTags(input);
  text = text.replace(/[ăâîșşțţĂÂÎȘŞȚŢáéíóúüöñ]/g, (c) => DIACRITIC_MAP[c] ?? c);
  text = text.toLowerCase();
  text = text.replace(/[^\p{L}\p{N}\s-]+/gu, " ");
  return text.replace(/\s+/gu, " ").trim();
}

function escapeRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Turn a dictionary term into a regex fragment that ignores diacritics.
 * A space in the term becomes \s+ so multi-word terms survive odd spacing.
 */
export function diacriticPattern(term: string): string {
  let out = "";
  for (const char of Array.from(String(term))) {
    const lower = char.toLowerCase();
    if (EQUIVALENCE[lower]) {
      out += `[${EQUIVALENCE[lower]}]`;
    } else if (char === " ") {
      out += "\\s+";
    } else {
      out += escapeRegex(lower);
    }
  }
  return out;
}

/**
 * Prepared text every pattern runs against (DICTIONARY-PORT §8):
 * tags stripped, whitespace collapsed, lowercased, diacritics kept.
 */
export function prepareText(title: string, body: string): string {
  const raw = `${decodeEntities(title ?? "")}. ${stripTags(body ?? "")}`;
  return raw.replace(/\s+/gu, " ").trim().toLowerCase();
}
