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
 * Output hygiene for every piece of text this app writes (alt text,
 * summaries, mirrors). Catalogues imported from elsewhere carry HTML
 * entities and typographic dashes; published output uses plain characters
 * only: "-" for dashes, "&" for ampersands, straight quotes.
 */
export function cleanOutput(input: string): string {
  return decodeEntities(String(input ?? ""))
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
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
 * The same preparation as prepareText, minus the lowercasing.
 *
 * Only measurements() needs this. Romanian furniture copy writes "L 130, l 80"
 * and means length 130, width 80; lowercased, both read as l and the length
 * gets published as a width. Every other pattern still runs against the
 * lowercased text, because that is what the WordPress port matched.
 */
/**
 * A run of two or more single letters each followed by a dot is one word a
 * person reads as one word: "S.N.P.M.A.P.S.", "M.S.". Left as written, every
 * pattern sees a one-letter token and a sentence full of full stops, which is
 * how "notificat de S.N.P.M.A.P.S. 1378/2023" published "notificat de s".
 *
 * The run has to be single letters throughout, so "1.5" and "www.example.com"
 * are untouched - the lookbehind is what keeps the middle of a domain from
 * starting a run.
 */
const DOTTED_ABBREVIATION = /(?<![\p{L}\p{N}.])(?:\p{L}\.){2,}/gu;

export function collapseDottedAbbreviations(input: string): string {
  return String(input ?? "").replace(DOTTED_ABBREVIATION, (run) =>
    run.replace(/\./g, ""),
  );
}

export function prepareTextCased(title: string, body: string): string {
  const raw = `${decodeEntities(title ?? "")}. ${stripTags(body ?? "")}`;
  return collapseDottedAbbreviations(raw.replace(/\s+/gu, " ").trim());
}

/**
 * Prepared text every pattern runs against (DICTIONARY-PORT §8):
 * tags stripped, whitespace collapsed, lowercased, diacritics kept.
 */
export function prepareText(title: string, body: string): string {
  return prepareTextCased(title, body).toLowerCase();
}
