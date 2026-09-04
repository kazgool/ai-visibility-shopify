// The on-page checks of PRD-SEO-FULL-ONPAGE sections 3, 5a and 5b: B10 to
// B24, and then B25 to B32 (the practitioner layer, built 4 September 2026).
//
// Pure, and with no ".server" suffix, for the same two reasons seo-findings.ts
// and seo-aggregate.ts have none. Every function here takes a string of HTML
// (or a handle, or a list of link results) and returns a Finding or null, so
// each check is asserted from a fixture with no network and no database - the
// only way the interesting cases can be produced at all against a dev store
// whose storefront password cannot be turned off.
//
// Three rules bind every check in this file, and they are the reason several
// of them are narrower than their name suggests:
//
//  1. **No check produces a score, and no string is advice.** A row states
//     what the page has. B17 reports word counts and never says more words
//     would help; B22 says a deprecated node earns nothing in Google and never
//     says to remove it; B24 says Google does not use the tag and never says
//     to delete it. The merchant decides; we count.
//  2. **A threshold is quoted as its source, never as our rule.** B10 and B11
//     carry Google's own wording - truncation is by device width, there is no
//     length limit - and the 30/60 and 70/160 figures are named as industry
//     estimates of what fits. "Over the limit" is a sentence this app must not
//     write, because Google does not have one.
//  3. **A check that could not be asked says so.** B17 reports a null
//     description word count when the page states no description anywhere,
//     rather than counting it as zero words and firing.
//
// B23's robots.txt review is NOT here: it needs the parser in
// seo-page.server.ts, which is a server module. B16's fetching half is not
// here either, for the same reason; its two pure halves (which links to check,
// and what a set of results means) are.

import { looksLikeMachineAlt } from "../engine/alt-text";
import { cleanOutput, decodeEntities } from "../engine/normalize";
import type { Finding } from "./seo-findings";

// --- thresholds, each with the source it is quoted from --------------------

/**
 * Google: "there's no limit on how long a title element can be, the title link
 * is truncated as needed, typically to fit the device width." So these two are
 * not limits. They are the industry's estimate of what a phone shows in full,
 * and the row says so in those words.
 */
export const TITLE_MIN_CHARS = 30;
export const TITLE_MAX_CHARS = 60;

/** Same wording, same status, for the meta description. */
export const DESCRIPTION_MIN_CHARS = 70;
export const DESCRIPTION_MAX_CHARS = 160;

/** B16: at most this many links checked per page (PRD section 3). */
export const LINK_CHECK_CAP = 20;

/** B17: the two counts, from PRD section 3. Neither is advice. */
export const THIN_DESCRIPTION_WORDS = 40;
export const THIN_PAGE_WORDS = 80;

/**
 * B13 and B14: the tags each row names when they are absent. Open Graph is the
 * three properties PRD section 3 lists; the Twitter set is the four a card
 * needs to render at all.
 */
export const OG_TAGS = ["og:title", "og:image", "og:description"] as const;
export const TWITTER_TAGS = [
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
] as const;

/**
 * B22: structured data types Google has stated it no longer shows.
 *
 * `HowTo` was removed from Search results in 2023. `FAQPage` was restricted in
 * 2023 and deprecated outright on 7 May 2026 - the Search Console report and
 * the Rich Results Test support were removed in June (PRD section 5a).
 *
 * The sitelinks search box, also retired, is deliberately not in this list: it
 * is a property (`potentialAction`) on a `WebSite` node and not a type, so a
 * type list cannot express it, and this app emits a `WebSite` node itself on
 * the home page. A check that flagged a node by its type would report our own
 * output as deprecated on a page it is correct on.
 */
export const DEPRECATED_LD_TYPES = ["FAQPage", "HowTo"] as const;

// --- small parsers, shared by several checks -------------------------------

/**
 * Entity decoding and output hygiene both come from the engine, which is where
 * every other text this app shows or writes gets them (CLAUDE.md: plain
 * characters only, no entities, no em dashes, no curly quotes).
 *
 * This file carried its own six-entry entity table until a real page was read
 * on 4 September 2026 and a dev-store title came back as "Aarhus Round Dining
 * Set & 4 Chairs - Nordwood &ndash; MRDigital-dev". The local table did not
 * know `ndash`, so the row would have printed an entity at a merchant and
 * counted it as seven characters instead of one. The engine's table knows it,
 * and `cleanOutput` turns the dash it decodes to into "-".
 *
 * Which of the two is used is not interchangeable. `decodeEntities` alone is
 * for attribute values, because a `src` or an `href` must come back byte for
 * byte as an address; `cleanOutput` is for anything a screen prints or a check
 * counts characters in.
 */

/** Attribute value off one tag, quoted or bare. */
export function attributeOf(tag: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  if (quoted) return decodeEntities(quoted[1]);
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, "i").exec(tag);
  return bare ? decodeEntities(bare[1]) : null;
}

/** The page's `<title>`, decoded and trimmed. Null when there is no tag. */
export function extractTitleTag(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  // cleanOutput, not a bare decode: this string is printed on a screen and its
  // characters are counted, so it goes through the same hygiene as every other
  // text this app shows.
  return cleanOutput(match[1]);
}

/**
 * A `<meta>` value by `name` or `property`, whichever the tag used. Open Graph
 * uses `property`, Twitter uses `name`, and themes mix them; reading only one
 * would report a present tag as absent.
 */
export function extractMetaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = attributeOf(tag, "name") ?? attributeOf(tag, "property");
    if (!name || !new RegExp(`^${escaped}$`, "i").test(name.trim())) continue;
    const content = attributeOf(tag, "content");
    if (content !== null) return content.trim();
  }
  return null;
}

export type H1 = {
  /** The visible text, tags stripped and whitespace collapsed. */
  text: string;
  /** True when the heading contains an image, which is the logo-in-H1 case. */
  hasImage: boolean;
  /** True when the heading or something inside it is classed as a logo. */
  hasLogoClass: boolean;
  /** True when the heading carries a link to the home page. */
  linksHome: boolean;
};

/** Every `<h1>` on the page, with what B12 needs to name the logo case. */
export function extractH1s(html: string): H1[] {
  const out: H1[] = [];
  for (const match of html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) {
    const whole = match[0];
    const inner = match[1];
    out.push({
      text: stripTags(inner),
      hasImage: /<(img|svg)\b/i.test(inner),
      hasLogoClass: /\bclass\s*=\s*["'][^"']*logo/i.test(whole),
      linksHome: /<a\b[^>]*\bhref\s*=\s*["']\/?["']/i.test(inner),
    });
  }
  return out;
}

/** Tags out, entities decoded, whitespace collapsed. */
export function stripTags(html: string): string {
  return cleanOutput(html.replace(/<[^>]*>/g, " "));
}

export type PageImage = { src: string | null; alt: string | null };

/** Every `<img>` on the page. `alt: null` means the attribute is absent. */
export function extractImages(html: string): PageImage[] {
  const out: PageImage[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    out.push({ src: attributeOf(match[0], "src"), alt: attributeOf(match[0], "alt") });
  }
  return out;
}

/**
 * Words of body text, with script, style, noscript and template removed first.
 * A word count read off raw HTML counts JSON-LD and inline JavaScript, which on
 * a Shopify theme is several thousand "words".
 */
export function visibleWords(html: string): number {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const source = body ? body[1] : html;
  const text = stripTags(
    source.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " "),
  );
  return countWords(text);
}

/** Words in a plain string. Empty is zero, not one. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

// --- B10 and B11: the two lengths -------------------------------------------

/**
 * B10: the title tag's length, and the fact that it is absent.
 *
 * The detail carries the number and the tag; the sentence on the screen quotes
 * Google. Neither ever says "over the limit" - Google states there is none.
 */
export function checkTitleTag(html: string): Finding | null {
  const title = extractTitleTag(html);
  if (title === null || title === "") {
    return { code: "B10", source: "B", detail: { present: false, title: null, length: 0 } };
  }
  const length = [...title].length;
  if (length >= TITLE_MIN_CHARS && length <= TITLE_MAX_CHARS) return null;
  return {
    code: "B10",
    source: "B",
    detail: {
      present: true,
      title,
      length,
      shorterThan: TITLE_MIN_CHARS,
      longerThan: TITLE_MAX_CHARS,
      side: length < TITLE_MIN_CHARS ? "short" : "long",
    },
  };
}

/** B11, the same reading of the meta description. */
export function checkMetaDescription(html: string): Finding | null {
  const description = extractMetaContent(html, "description");
  if (description === null || description === "") {
    return { code: "B11", source: "B", detail: { present: false, length: 0 } };
  }
  const length = [...description].length;
  if (length >= DESCRIPTION_MIN_CHARS && length <= DESCRIPTION_MAX_CHARS) return null;
  return {
    code: "B11",
    source: "B",
    detail: {
      present: true,
      // Shown on a screen, so it carries no entities and no typographic
      // characters. The length above is the decoded one either way.
      description: cleanOutput(description),
      length,
      shorterThan: DESCRIPTION_MIN_CHARS,
      longerThan: DESCRIPTION_MAX_CHARS,
      side: length < DESCRIPTION_MIN_CHARS ? "short" : "long",
    },
  };
}

// --- B12: the H1s -----------------------------------------------------------

/**
 * B12: how many H1s the page has and what they say, plus the named case from
 * PRD section 5b (B12a): the H1 wraps the logo, so the page's one heading says
 * the shop's name on every page rather than this product's.
 *
 * Exactly one H1 that is not the logo is silent. One H1 that is the logo is a
 * finding of its own: the count is right and the heading is still not about
 * this page.
 */
export function checkH1(html: string): Finding | null {
  const h1s = extractH1s(html);
  const texts = h1s.map((h) => h.text);
  const logo = h1s.some((h) => h.hasImage || h.hasLogoClass || h.linksHome);
  if (h1s.length === 1 && !logo) return null;
  return {
    code: "B12",
    source: "B",
    detail: {
      count: h1s.length,
      texts: texts.slice(0, 10),
      logoInH1: logo,
      // Which of the three signals fired, so the sentence names what was seen
      // rather than asserting "this is your logo" from a class name alone.
      logoSignals: logo
        ? {
            image: h1s.some((h) => h.hasImage),
            logoClass: h1s.some((h) => h.hasLogoClass),
            linksHome: h1s.some((h) => h.linksHome),
          }
        : null,
    },
  };
}

// --- B13 and B14: the social tags -------------------------------------------

function missingTags(html: string, tags: readonly string[]): string[] {
  return tags.filter((tag) => {
    const value = extractMetaContent(html, tag);
    return value === null || value === "";
  });
}

/** B13: which of the three Open Graph properties the page does not carry. */
export function checkOpenGraph(html: string): Finding | null {
  const missing = missingTags(html, OG_TAGS);
  if (missing.length === 0) return null;
  return {
    code: "B13",
    source: "B",
    detail: { missing, present: OG_TAGS.filter((t) => !missing.includes(t)) },
  };
}

/** B14: the same for the Twitter card tags. */
export function checkTwitterCard(html: string): Finding | null {
  const missing = missingTags(html, TWITTER_TAGS);
  if (missing.length === 0) return null;
  return {
    code: "B14",
    source: "B",
    detail: { missing, present: TWITTER_TAGS.filter((t) => !missing.includes(t)) },
  };
}

// --- B15: alt text on the page ----------------------------------------------

/**
 * B15: images with no alt attribute, with an empty one, and with an alt that
 * reads as machine output.
 *
 * The third uses `looksLikeMachineAlt` from the engine, the same predicate the
 * alt text writer uses to decide what it may replace. Two screens disagreeing
 * about what counts as a filename would be worse than either being wrong.
 *
 * The empty alt is counted separately and not merged into "missing", because
 * `alt=""` is the correct markup for a decorative image and a merchant who
 * wrote it deliberately should see it named as what it is.
 */
export function checkPageAltText(html: string): Finding | null {
  const images = extractImages(html);
  if (images.length === 0) return null;

  const noAlt: string[] = [];
  const emptyAlt: string[] = [];
  const machineAlt: { src: string | null; alt: string }[] = [];
  for (const image of images) {
    if (image.alt === null) noAlt.push(image.src ?? "");
    else if (image.alt.trim() === "") emptyAlt.push(image.src ?? "");
    else if (looksLikeMachineAlt(image.alt)) machineAlt.push({ src: image.src, alt: image.alt });
  }

  const count = noAlt.length + emptyAlt.length + machineAlt.length;
  if (count === 0) return null;
  return {
    code: "B15",
    source: "B",
    detail: {
      count,
      images: images.length,
      noAlt: noAlt.length,
      emptyAlt: emptyAlt.length,
      machineAlt: machineAlt.length,
      // Capped: a collection-heavy template carries hundreds, and a row is a
      // sentence, not a file listing.
      examples: machineAlt.slice(0, 5).map((m) => m.alt),
    },
  };
}

// --- B16: internal links, the two pure halves -------------------------------

export type LinkPlan = {
  /** The distinct same-origin URLs this page would have checked, in order. */
  urls: string[];
  /** How many distinct internal links the page carries in total. */
  total: number;
  /** True when `total` exceeded the cap and `urls` is the first `cap` of them. */
  capped: boolean;
};

/**
 * Which links B16 would check on this page: distinct, same-origin, and at most
 * `cap` of them.
 *
 * Distinct by resolved URL without its fragment, because a page that links to
 * the same collection from the breadcrumb, the menu and the footer is one
 * address to check and not three - and each distinct URL is charged once to
 * the daily budget (PRD section 3).
 *
 * The page's own address is excluded: it was just fetched, and re-fetching it
 * to ask whether it answers would spend a request to learn what the caller
 * already knows.
 */
export function internalLinks(html: string, pageUrl: string, cap = LINK_CHECK_CAP): LinkPlan {
  let origin: string;
  let self: string;
  try {
    const page = new URL(pageUrl);
    origin = page.origin;
    self = withoutFragment(page.href);
  } catch {
    return { urls: [], total: 0, capped: false };
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attributeOf(match[0], "href");
    if (!href) continue;
    const raw = href.trim();
    // Not addresses a crawler follows: an in-page anchor, and the schemes a
    // storefront routinely carries.
    if (raw === "" || raw.startsWith("#")) continue;
    if (/^(mailto:|tel:|javascript:|data:|sms:)/i.test(raw)) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    const key = withoutFragment(resolved.href);
    if (key === self) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(key);
  }

  return { urls: urls.slice(0, cap), total: urls.length, capped: urls.length > cap };
}

function withoutFragment(href: string): string {
  return href.split("#")[0];
}

export type LinkResult = {
  url: string;
  /** The HTTP status, or 0 when the request could not be made at all. */
  status: number;
};

/**
 * B16 from a set of results.
 *
 * `checked` is stated separately from `total` and is not always the cap: the
 * daily budget can run out part-way through a page, and "20 of 200 checked"
 * and "3 of 200 checked" are different sentences the row has to tell apart. A
 * page whose links were not reached at all produces nothing - "not checked" is
 * never rendered as "nothing broken".
 */
export function checkInternalLinks(
  results: LinkResult[],
  plan: Pick<LinkPlan, "total" | "capped">,
  checked: number,
): Finding | null {
  const broken = results.filter((r) => r.status === 0 || r.status >= 400);
  if (broken.length === 0) return null;
  return {
    code: "B16",
    source: "B",
    detail: {
      broken: broken.slice(0, LINK_CHECK_CAP),
      count: broken.length,
      checked,
      total: plan.total,
      capped: plan.capped,
    },
  };
}

// --- B17: the two word counts -----------------------------------------------

/**
 * The product description this page states, and where it was read from.
 *
 * The Product node's `description` and nothing else. The meta description is
 * deliberately NOT a fallback, and the reason is that the two checks would
 * then contradict each other: B11 reports a meta description longer than about
 * 160 characters, and 160 characters cannot hold the 40 words B17 asks for. A
 * page that satisfied one would fail the other on every product in every
 * catalogue, which is not a finding, it is a rule nobody can keep.
 *
 * When the page's structured data states no description, the answer is null -
 * the check could not be asked, and B17 then reports the page's word count
 * alone rather than counting a description it never saw as zero words.
 */
export function pageDescription(
  _html: string,
  ldDescription: string | null,
): { text: string | null; source: string | null } {
  if (ldDescription && ldDescription.trim() !== "") {
    return { text: stripTags(ldDescription), source: "structured data" };
  }
  return { text: null, source: null };
}

/**
 * B17: how many words the product's description has and how many the page has.
 *
 * The description is taken from the page's own Product node first and from the
 * meta description second, and which one was used is on the row: they are
 * different texts, and a count without its source cannot be checked by anyone.
 * When the page states neither, the description count is null - the check could
 * not be asked, and a null is not zero (rule 3 at the top of this file).
 *
 * The row states two numbers. It does not say that more words would help,
 * because nobody here knows that.
 */
export function checkThinContent(
  html: string,
  description: string | null,
  descriptionSource: string | null,
): Finding | null {
  const pageWords = visibleWords(html);
  const descriptionWords = description === null ? null : countWords(description);
  const thinDescription = descriptionWords !== null && descriptionWords < THIN_DESCRIPTION_WORDS;
  const thinPage = pageWords < THIN_PAGE_WORDS;
  if (!thinDescription && !thinPage) return null;
  return {
    code: "B17",
    source: "B",
    detail: {
      descriptionWords,
      descriptionSource,
      pageWords,
      descriptionUnder: THIN_DESCRIPTION_WORDS,
      pageUnder: THIN_PAGE_WORDS,
      thinDescription,
      thinPage,
    },
  };
}

// --- B18: the handle --------------------------------------------------------

// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7F]/;

/**
 * B18: what is in the handle that does not belong in a URL.
 *
 * Four cases, named separately because the merchant fixes them in different
 * ways and because a handle can carry more than one. Nothing here is a
 * judgement about the words: a Romanian handle with diacritics is reported as
 * non-ASCII with the characters named, and the merchant decides.
 */
export function checkHandle(handle: string | null): Finding | null {
  if (handle === null || handle === "") return null;
  const issues: string[] = [];
  if (/[A-Z]/.test(handle)) issues.push("uppercase");
  if (/\s/.test(handle)) issues.push("spaces");
  if (NON_ASCII.test(handle)) issues.push("non-ASCII characters");
  if (/[.,;:!?_-]$/.test(handle)) issues.push("a trailing punctuation mark");
  if (issues.length === 0) return null;
  return {
    code: "B18",
    source: "B",
    detail: {
      handle,
      issues,
      nonAscii: [...new Set([...handle].filter((c) => NON_ASCII.test(c)))],
    },
  };
}

// --- B19: the redirect chain ------------------------------------------------

export type Hop = { url: string; status: number };

/**
 * B19: the product URL answered after more than one hop, or went round in a
 * circle.
 *
 * One hop is not a finding here and is deliberately left to B5, which already
 * has a sentence for "the address you gave answered from somewhere else". This
 * check is about the chain: two or more hops cost a crawler two or more
 * requests for one page, and a loop means the page cannot be reached at all.
 */
export function checkRedirectChain(chain: Hop[]): Finding | null {
  const hops = Math.max(0, chain.length - 1);
  const seen = new Set<string>();
  let loop = false;
  for (const hop of chain) {
    if (seen.has(hop.url)) {
      loop = true;
      break;
    }
    seen.add(hop.url);
  }
  if (!loop && hops <= 1) return null;
  return { code: "B19", source: "B", detail: { chain, hops, loop } };
}

// --- B20: mixed content -----------------------------------------------------

const RESOURCE_ATTRIBUTES: { tag: string; attribute: string }[] = [
  { tag: "script", attribute: "src" },
  { tag: "img", attribute: "src" },
  { tag: "iframe", attribute: "src" },
  { tag: "audio", attribute: "src" },
  { tag: "video", attribute: "src" },
  { tag: "source", attribute: "src" },
  { tag: "embed", attribute: "src" },
  { tag: "link", attribute: "href" },
];

/**
 * B20: `http://` resources on an `https://` page.
 *
 * Only resources, never links: an `<a href="http://...">` to another site is a
 * link a browser follows on a click, not content the page pulls in, and
 * reporting it as mixed content would put a finding on every page that links
 * to a supplier.
 *
 * Silent on a page that is not itself https, because "mixed" has no meaning
 * there and the whole page is then the finding, which B5 owns.
 */
export function checkMixedContent(html: string, pageUrl: string): Finding | null {
  let secure = false;
  try {
    secure = new URL(pageUrl).protocol === "https:";
  } catch {
    return null;
  }
  if (!secure) return null;

  const resources: { tag: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const { tag, attribute } of RESOURCE_ATTRIBUTES) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    for (const match of html.matchAll(pattern)) {
      const value = attributeOf(match[0], attribute);
      if (!value || !/^http:\/\//i.test(value.trim())) continue;
      const url = value.trim();
      if (seen.has(url)) continue;
      seen.add(url);
      resources.push({ tag, url });
    }
  }
  if (resources.length === 0) return null;
  return {
    code: "B20",
    source: "B",
    detail: { resources: resources.slice(0, 20), count: resources.length },
  };
}

// --- B21: two pages, one title ----------------------------------------------

/**
 * Comparison is on the trimmed, case-folded, whitespace-collapsed title,
 * because two titles that differ only in a double space are the same title to
 * anyone reading a results page.
 */
export function titleKey(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * B21: another page in this shop carries the same title tag.
 *
 * `titlesByKey` comes from the titles stored on the other rows, because the
 * pages being compared were read on other nights - 500 a night means a large
 * catalogue spreads one comparison over many of them. A title no page has been
 * read for is absent from that map, so this check under-reports on a
 * half-scanned catalogue and never invents a duplicate.
 */
export function checkDuplicateTitle(
  title: string | null,
  handle: string | null,
  titlesByKey: Map<string, string[]>,
): Finding | null {
  if (title === null || title.trim() === "") return null;
  const key = titleKey(title);
  const others = (titlesByKey.get(key) ?? []).filter((h) => h !== handle);
  if (others.length === 0) return null;
  return {
    code: "B21",
    source: "B",
    detail: { title, others: others.slice(0, 10), sharedWith: others.length },
  };
}

// --- B22: structured data Google no longer shows ----------------------------

/**
 * B22: a node on the page whose type Google has stopped showing.
 *
 * The row says the node costs nothing and earns nothing in Google. It never
 * says to remove it, and the reason is in this app's own output: it emits a
 * `FAQPage` deliberately, because assistants still read it and because it is
 * still valid schema.org (PRD section 5a). `ours` on each entry says whether
 * the node carries this app's emitter marker, so the sentence can name which
 * of the two it is looking at rather than blaming a theme for our node.
 */
export function checkDeprecatedNodes(nodes: { types: string[]; ours?: boolean }[]): Finding | null {
  const found = new Map<string, { type: string; count: number; ours: boolean }>();
  for (const node of nodes) {
    for (const type of node.types) {
      if (!(DEPRECATED_LD_TYPES as readonly string[]).includes(type)) continue;
      const entry = found.get(type);
      if (entry) {
        entry.count += 1;
        entry.ours = entry.ours || node.ours === true;
      } else {
        found.set(type, { type, count: 1, ours: node.ours === true });
      }
    }
  }
  if (found.size === 0) return null;
  const types = [...found.values()].sort((a, b) => a.type.localeCompare(b.type));
  return { code: "B22", source: "B", detail: { types, ours: types.some((t) => t.ours) } };
}

// --- B24: the keywords tag --------------------------------------------------

/**
 * B24: the page carries a meta keywords tag.
 *
 * Google states it does not use this tag, so it has no effect on indexing. The
 * row exists so a merchant who is still maintaining a list of terms in an app
 * or a theme setting can stop doing that; it never looks at what the terms are
 * beyond counting them, and it never suggests any.
 */
export function checkMetaKeywords(html: string): Finding | null {
  const content = extractMetaContent(html, "keywords");
  if (content === null || content === "") return null;
  return {
    code: "B24",
    source: "B",
    detail: {
      terms: content
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean).length,
      sample: content.slice(0, 120),
    },
  };
}

// ===========================================================================
// B25 to B32: the practitioner layer of PRD-SEO-FULL-ONPAGE section 5b, built
// 4 September 2026 (build step 4b).
//
// The three rules at the top of this file bind these as tightly as they bind
// B10 to B24, and two of them are the reason B29 and B32 look unlike every
// other check here. Neither produces a verdict: they report counts and stop,
// because no named source states a target number for either, and Break The
// Web's own rule for an audit is not to report what the merchant cannot act
// on. So both are "reports" codes in CHECKS and both render at the bottom of
// the card with their numbers and no found-or-clean framing.
//
// Two of section 5b's page-half codes are not in this file:
//
//  - **B27 is not a code at all.** "Two Product nodes from two different
//    sources, each with its own AggregateRating" is B1 with the sources named,
//    so B1's detail gained `origins` rather than the vocabulary gaining a
//    second row that says the same thing about the same page. Ilana Davis's
//    case is the theme and a review app both emitting a rating; what a
//    merchant needs is which node came from where, and that belongs on the row
//    that already reports the count. See `readingOf` in seo-page.server.ts.
//  - **B28 is in seo-catalogue.ts**, because it is computed from the menu tree
//    and collection membership with no page fetch at all, in source A's pass
//    where the one `menus` query already happens for A16. Its denominator is
//    the catalogue, not the pages read, and it says so.
// ===========================================================================

/**
 * B25: at most this many collection pages one pass reads.
 *
 * A collection page is a page fetch like any other and comes out of the same
 * daily budget, so a shop with 400 collections must not be able to spend a
 * night's whole allowance before the first product page is read. Beyond the
 * cap the read is partial and the row says how many were looked at.
 */
export const COLLECTION_PAGE_CAP = 20;

/**
 * B30: at most this many blog posts one pass reads, and they are read last.
 *
 * Last because they spend budget that products have the first claim on: a
 * shop whose product pages are not all read yet is not helped by a report on
 * its blog. What is left after the products is what the blog gets, which on a
 * catalogue larger than the nightly budget is nothing at all - and B30 then
 * says it read no posts rather than that no post lacks a link.
 */
export const BLOG_POST_CAP = 25;

/** B28's figure, from Break The Web. Quoted, not invented. */
export const MAX_CLICK_DEPTH = 3;

// --- B25: the two shapes of a product link ---------------------------------

export type ProductLink = {
  /** The product handle the link names. */
  handle: string;
  /** True for /collections/x/products/y, false for the plain /products/y. */
  long: boolean;
  /** The address as resolved, for the row's own sentence. */
  href: string;
};

/**
 * Every link on this page that names a product, and which of the two shapes it
 * uses.
 *
 * Shopify serves a product at both /products/y and, inside a collection,
 * /collections/x/products/y. Only the first is the canonical address. The
 * Ahrefs Help Center describes the consequence on Shopify stores specifically:
 * when a theme's collection grid links the long form, the canonical URL has no
 * internal link pointing at it, so the address the shop is asking Google to
 * index is the one address nothing on the shop links to.
 *
 * A market or locale prefix (/en-gb/products/y) is part of neither shape and
 * is skipped rather than counted as long: it is a different market's copy of
 * the same page and belongs to B9's question, not this one.
 */
export function productLinks(html: string, pageUrl: string): ProductLink[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  const out: ProductLink[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attributeOf(match[0], "href");
    if (!href) continue;
    const raw = href.trim();
    if (raw === "" || raw.startsWith("#")) continue;
    if (/^(mailto:|tel:|javascript:|data:|sms:)/i.test(raw)) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    const path = resolved.pathname;
    const long = /^\/collections\/[^/]+\/products\/([^/?#]+)\/?$/i.exec(path);
    if (long) {
      out.push({ handle: decodeURIComponent(long[1]), long: true, href: resolved.href });
      continue;
    }
    const short = /^\/products\/([^/?#]+)\/?$/i.exec(path);
    if (short) {
      out.push({ handle: decodeURIComponent(short[1]), long: false, href: resolved.href });
    }
  }
  return out;
}

/** How many links of each shape one page carries. B25's per-page half. */
export type LinkFormCount = { long: number; short: number };

export function countLinkForms(links: ProductLink[]): LinkFormCount {
  return {
    long: links.filter((l) => l.long).length,
    short: links.filter((l) => !l.long).length,
  };
}

/**
 * B25 for one product: every link the pass saw pointing at it used the long
 * form, so its canonical address has no internal link.
 *
 * Silent when the product was linked at least once by its plain address - the
 * canonical is then linked and the check has nothing to report, however many
 * long-form links sit beside it. Silent, too, when the pass saw no link to
 * this product at all: `undefined` is a product that appeared on no collection
 * page this pass read, and a product nobody links to is A16's finding and not
 * this one. A zero here would claim the canonical was checked.
 */
export function checkLongFormLinks(counts: LinkFormCount | undefined): Finding | null {
  if (!counts) return null;
  if (counts.long === 0) return null;
  if (counts.short > 0) return null;
  return {
    code: "B25",
    source: "B",
    detail: { long: counts.long, short: counts.short },
  };
}

// --- B26: noindex on a product that is only out of stock -------------------

/**
 * B26: the page says noindex, and the only thing wrong with the product is
 * that it is out of stock.
 *
 * Matthew Edgar and Glenn Davidson (Tomango) make the same argument from
 * different directions: a noindexed page behaves like a soft 404, so the
 * address loses the standing it had, and it does not get it back when the
 * product comes back into stock - the page has to be found and re-evaluated
 * from nothing. Their reasoning is what the row states; it does not say to
 * remove the tag, because a product that is gone for good is a case where
 * noindex is a reasonable thing to have done and only the merchant knows
 * which of the two this is.
 *
 * Both halves must be present. A noindex on a product that is in stock is
 * B3's finding and not this one, and an out-of-stock product with no noindex
 * is not a finding at all. A page that states no availability produces
 * nothing: "not stated" is not "out of stock".
 */
export function checkNoindexOutOfStock(
  noindex: boolean,
  availability: string | null,
): Finding | null {
  if (!noindex) return null;
  const said = (availability ?? "").trim();
  if (said === "") return null;
  if (!/OutOfStock|SoldOut|Discontinued/i.test(said)) return null;
  return { code: "B26", source: "B", detail: { availability: said } };
}

// --- the region reader B29 shares with itself ------------------------------

/**
 * The inner HTML of every element of one of `tags` whose opening tag matches
 * `pattern`, with nesting counted so a div class="breadcrumb" containing three
 * more divs closes where it really closes.
 *
 * A regex is not a parser and this does not pretend to be one. It exists
 * because B29 has to say which part of the page a link sits in, and the
 * alternative - classifying a link by its own href alone - cannot tell a
 * breadcrumb link to a collection from a footer link to the same collection.
 * Where it is wrong it over-counts a region rather than losing one, which is
 * the direction that keeps a real number visible (DICTIONARY-PORT 10.1).
 */
export function elementRegions(html: string, tags: string[], pattern: RegExp): string[] {
  const out: string[] = [];
  const opener = new RegExp(`<(${tags.join("|")})\\b[^>]*>`, "gi");
  for (const match of html.matchAll(opener)) {
    if (!pattern.test(match[0])) continue;
    if (/\/>\s*$/.test(match[0])) continue;
    const tag = match[1].toLowerCase();
    const start = (match.index ?? 0) + match[0].length;
    // Forward from here, counting opens and closes of this tag name only.
    const scanner = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    scanner.lastIndex = start;
    let depth = 1;
    let end = html.length;
    let step: RegExpExecArray | null;
    while ((step = scanner.exec(html)) !== null) {
      depth += step[1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = step.index;
        break;
      }
    }
    out.push(html.slice(start, end));
  }
  return out;
}

const BREADCRUMB = /breadcrumb/i;
const RELATED = /related|recommend|you-may-also|complementary|also-bought/i;
const DESCRIPTION = /product[-_]{0,2}description|product__description|\brte\b/i;

// --- B29: internal links on the product page, by kind ----------------------

export type LinkKinds = {
  breadcrumb: number;
  related: number;
  collection: number;
  inDescription: number;
  /** Distinct same-origin addresses on the page, from B16's own counter. */
  total: number;
};

/**
 * B29: how many internal links this product page carries, by kind.
 *
 * Counts, and nothing else. No named practitioner states a target for any of
 * the four, so this app states none either - the row reports what the page has
 * and the merchant decides whether it is enough. That is why B29 is a reports
 * code and never renders as found or clean.
 *
 * **The four kinds overlap and are not a partition.** A related-products grid
 * whose links are collection-prefixed is counted under `related` and under
 * `collection` both, because it is both, and a row that silently picked one
 * would be answering a question nobody asked. `total` is B16's own count of
 * distinct internal addresses and is not the sum of the four.
 */
export function linksByKind(html: string, pageUrl: string): LinkKinds {
  const countLinks = (fragment: string) => [...fragment.matchAll(/<a\b[^>]*\bhref\s*=/gi)].length;
  const inRegions = (tags: string[], pattern: RegExp) =>
    elementRegions(html, tags, pattern).reduce((sum, region) => sum + countLinks(region), 0);

  let collection = 0;
  let origin: string | null = null;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = null;
  }
  if (origin !== null) {
    for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
      const href = attributeOf(match[0], "href");
      if (!href) continue;
      try {
        const resolved = new URL(href.trim(), pageUrl);
        if (resolved.origin !== origin) continue;
        if (/^(?:\/[a-z-]{2,10})?\/collections\//i.test(resolved.pathname)) collection += 1;
      } catch {
        continue;
      }
    }
  }

  return {
    breadcrumb: inRegions(["nav", "ol", "ul", "div", "section"], BREADCRUMB),
    related: inRegions(["div", "section", "ul", "aside"], RELATED),
    collection,
    inDescription: inRegions(["div", "section", "p"], DESCRIPTION),
    total: internalLinks(html, pageUrl, Number.MAX_SAFE_INTEGER).total,
  };
}

/**
 * B29 as a row. Always present on a page that answered, because the row is a
 * count and a count of zero is the interesting one: a product page with no
 * breadcrumb and no related products is a real thing to know, and it is the
 * one case that would disappear if this returned null on nothing found.
 */
export function checkInternalLinkKinds(kinds: LinkKinds): Finding | null {
  return { code: "B29", source: "B", detail: { ...kinds } };
}

// --- B31: the first image, lazy-loaded -------------------------------------

export type FirstImage = { src: string | null; loading: string | null };

/**
 * The first img inside body, and the `loading` attribute as found.
 *
 * The first image in the body and not "the LCP element", which no server-side
 * read can identify: what paints largest depends on the viewport, and this app
 * fetches one HTML document with no browser. Stated plainly in the method
 * line, because on many themes the first image is the shop's logo and a lazy
 * logo is a different, smaller fact from a lazy hero.
 */
export function firstImage(html: string): FirstImage | null {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const source = body ? body[1] : html;
  const match = /<img\b[^>]*>/i.exec(source);
  if (!match) return null;
  return {
    src: attributeOf(match[0], "src"),
    loading: attributeOf(match[0], "loading"),
  };
}

/**
 * B31: the first image on the page is lazy-loaded.
 *
 * Mechanically certain even though the practice source is unnamed: a browser
 * defers a loading="lazy" image until layout says it is near the viewport, so
 * an above-the-fold image marked lazy is fetched later than it would have
 * been. The row states the attribute as found and says nothing about page
 * speed scores, which are out of scope by PRD section 6.
 */
export function checkLazyFirstImage(html: string): Finding | null {
  const image = firstImage(html);
  if (!image) return null;
  if ((image.loading ?? "").trim().toLowerCase() !== "lazy") return null;
  return { code: "B31", source: "B", detail: { loading: "lazy", src: image.src } };
}

// --- B32: what else the page loads -----------------------------------------

export type ScriptOrigin = { origin: string; count: number };

/**
 * Every script tag on the page, grouped by where it comes from.
 *
 * `inline` is its own group: a script with no src is markup the theme or an
 * app wrote into the page, and folding it in with a CDN would hide the
 * difference. A relative src resolves to the shop's own host and is grouped
 * there, because that is where the browser fetches it from.
 */
export function scriptOrigins(html: string, pageUrl: string): ScriptOrigin[] {
  const counts = new Map<string, number>();
  const add = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attributeOf(match[0], "src");
    if (!src || src.trim() === "") {
      add("inline");
      continue;
    }
    try {
      add(new URL(src.trim(), pageUrl).host);
    } catch {
      add("unparseable");
    }
  }
  return [...counts.entries()]
    .map(([origin, count]) => ({ origin, count }))
    .sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));
}

/**
 * B32: the scripts this page loads, counted by origin. Never a verdict.
 *
 * Break The Web's "ghost code" is the practice this comes from - scripts left
 * behind by apps that were uninstalled - and the count is a fact while the
 * judgement is entirely the merchant's: this app cannot know that an analytics
 * host is wanted and a review host is not. So the row counts and stops, and it
 * sits at the bottom of the card with B29 under the rule Break The Web states
 * for an audit: do not report what the merchant cannot act on.
 *
 * The theme's app embed blocks are the other half of this row and are not read
 * from the page at all - they come from settings_data.json via `readAppEmbeds`
 * in embed-check.server.ts, because an embed that is present and switched off
 * renders nothing and so cannot be seen in HTML.
 */
export function checkScriptOrigins(html: string, pageUrl: string): Finding | null {
  const origins = scriptOrigins(html, pageUrl);
  const scripts = origins.reduce((sum, o) => sum + o.count, 0);
  return {
    code: "B32",
    source: "B",
    detail: {
      scripts,
      origins: origins.length,
      // Capped: a storefront with a dozen apps carries a long tail, and a row
      // is a sentence rather than a file listing.
      top: origins.slice(0, 8),
    },
  };
}

// --- B30: a blog post that links to nothing you sell -----------------------

/**
 * B30: this blog post links to no product and no collection.
 *
 * One fetch per post, charged to the same daily budget as every other request
 * (PRD section 3), and read last so products keep the first claim on it. The
 * row states what the post links to and never that it should link to
 * something: a shipping-policy post that sells nothing is doing its job.
 *
 * A post has no product row to sit on, so B30 is recorded per shop and
 * rendered with its own denominator - the posts this pass read - exactly as
 * A10 and A11 are rendered from the collections report. Its `Finding` shape
 * exists so the code reads like every other one and so the weekly diff sees
 * the same vocabulary.
 */
export function checkBlogPostLinks(html: string, pageUrl: string): Finding | null {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return null;
  }
  let products = 0;
  let collections = 0;
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attributeOf(match[0], "href");
    if (!href) continue;
    let resolved: URL;
    try {
      resolved = new URL(href.trim(), pageUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    const path = resolved.pathname;
    if (/^(?:\/[a-z-]{2,10})?\/products\//i.test(path)) products += 1;
    else if (/^(?:\/[a-z-]{2,10})?\/collections\//i.test(path)) collections += 1;
  }
  if (products > 0 || collections > 0) return null;
  return { code: "B30", source: "B", detail: { products: 0, collections: 0, url: pageUrl } };
}
