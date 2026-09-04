// The on-page checks of PRD-SEO-FULL-ONPAGE sections 3 and 5a: B10 to B24.
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
