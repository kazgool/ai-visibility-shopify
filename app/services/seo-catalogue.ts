// The catalogue checks of PRD-SEO-FULL-ONPAGE section 5b: A10 to A16, and
// B28, which is numbered with the page checks and computed here because it
// needs no page (see clickDepthOf at the foot of this file).
//
// Everything here is computed from the Admin API alone - the catalogue read
// source A already holds, plus two per-pass queries (the shop's URL redirects
// and its menus). Not one of them fetches a page, so none of them touches the
// daily budget.
//
// Pure, and with no ".server" suffix, for the same reason seo-scan.ts and
// seo-onpage.ts have none: the checks are asserted without a database, and the
// screens import their labels into the browser bundle.
//
// The rules, the same three the rest of this module keeps:
//
//  1. **A row says what the catalogue has; it never says what to write.** A12
//     names the group of handles sharing a description and stops there.
//     Rewriting is the line this product does not cross, and a findings screen
//     that starts suggesting text is a different product.
//  2. **A read that could not be made is not a finding of zero.** A13 and A16
//     each need one Admin query that the shop's token may refuse. Their inputs
//     are null in that case, the check returns null, and the pass records the
//     code as one that could not run so the card says so instead of "clean".
//  3. **A count carries the denominator it was measured over.** A10 and A11
//     are counted over collections, A12 to A16 over products, and the two are
//     never mixed - which is why A10 and A11 live on the collections report
//     and not in the product aggregate.
//
// A14 of section 5b (automatic geo or currency redirection under Markets) is
// NOT here, and is not built. The reason is in section 9 of the PRD: the
// setting is not exposed by the Admin API. Every field of `Market` and of
// `Shop` was listed against a live shop on 4 September 2026 and none of them
// carries it. A check that could only ever answer "could not be determined" is
// a promise, not a finding.

import { cleanOutput, stripTags } from "../engine/normalize";
import { MAX_CLICK_DEPTH } from "./seo-onpage";
import type { ProductInput } from "./facts.server";
import type { Finding } from "./seo-findings";

/** A10: Craftshift and Charle, quoted in PRD section 5b. Not a target. */
export const COLLECTION_DESCRIPTION_WORDS = 50;

/** A11: a collection holding this many products or fewer (Craftshift). */
export const THIN_COLLECTION_PRODUCTS = 1;

/**
 * A13: how many of a shop's URL redirects one pass reads.
 *
 * A shop that has been migrated twice can hold tens of thousands. The list is
 * read for one question - how many of them point at the home page - and a pass
 * that walked a whole import to answer it would be paying Admin calls for a
 * number that does not change between passes. Beyond the cap the read is
 * marked partial and the row says how many were looked at.
 */
export const REDIRECT_READ_CAP = 2000;

/** Words in a plain string. Empty is zero, not one. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

// --- A10 and A11: the two collection checks --------------------------------

/** As much of a collection as A10 and A11 read. */
export type CollectionLike = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string | null;
  productsCount?: { count: number } | null;
};

export type CollectionCheck = {
  id: string;
  handle: string;
  title: string;
  /** A10: words in the collection's own description text. */
  words?: number;
  /** A11: products in the collection. */
  products?: number;
};

/**
 * A10: the collection's description is empty, or shorter than 50 words.
 *
 * The row states the word count and nothing else. It does not say the
 * description should be longer, because the practitioners who named the figure
 * (Craftshift, Charle) were describing what they see on collections that rank,
 * not stating a rule, and this app does not turn an observation into an
 * instruction.
 */
export function checkCollectionDescription(collection: CollectionLike): CollectionCheck | null {
  const words = countWords(stripTags(collection.descriptionHtml ?? ""));
  if (words >= COLLECTION_DESCRIPTION_WORDS) return null;
  return { id: collection.id, handle: collection.handle, title: collection.title, words };
}

/**
 * A11: the collection holds no products, or one.
 *
 * `productsCount` absent means the read did not carry it, and the check is not
 * asked - never answered as zero, which would put a finding on every
 * collection in the catalogue the first time the query changed.
 */
export function checkCollectionSize(collection: CollectionLike): CollectionCheck | null {
  const count = collection.productsCount?.count;
  if (typeof count !== "number") return null;
  if (count > THIN_COLLECTION_PRODUCTS) return null;
  return { id: collection.id, handle: collection.handle, title: collection.title, products: count };
}

// --- A12: two products, one description ------------------------------------

/**
 * The comparison key for a product description.
 *
 * `cleanOutput` first, so two descriptions that differ only in how an imported
 * catalogue encoded its ampersands are one description - which is what Google's
 * own duplicate clustering sees, and the whole reason the check exists. Then
 * case-folded, because a description is duplicated whatever its capitalisation.
 * An empty description is not a key at all: fifty products with no description
 * are fifty instances of nothing, not one group of fifty.
 */
export function descriptionKey(descriptionHtml: string | null | undefined): string | null {
  const text = cleanOutput(stripTags(descriptionHtml ?? "")).toLowerCase();
  return text === "" ? null : text;
}

/**
 * A12, for the whole catalogue at once, because that is the only level at which
 * the question exists.
 *
 * Returns one entry per product that shares its description with at least one
 * other, carrying the other handles. A group of one is never an entry: a
 * description that appears once is not a duplicate of itself, and this is the
 * same rule `duplicationByProduct` keeps for A3.
 */
export function duplicateDescriptions(
  products: Pick<ProductInput, "id" | "handle" | "descriptionHtml">[],
): Map<string, string[]> {
  const byKey = new Map<string, { id: string; handle: string }[]>();
  for (const product of products) {
    const key = descriptionKey(product.descriptionHtml);
    if (key === null) continue;
    const list = byKey.get(key);
    const entry = { id: product.id, handle: (product.handle ?? "").trim() };
    if (list) list.push(entry);
    else byKey.set(key, [entry]);
  }

  const out = new Map<string, string[]>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const member of group) {
      out.set(
        member.id,
        group.filter((other) => other.id !== member.id).map((other) => other.handle),
      );
    }
  }
  return out;
}

/**
 * A12 for one product. `others` is the rest of its group; the row names them
 * and says nothing about what to do, because the answer is sometimes "these are
 * genuinely two sizes of one product" and that is the merchant's call.
 */
export function checkDuplicateDescription(others: string[] | undefined): Finding | null {
  if (!others || others.length === 0) return null;
  return {
    code: "A12",
    source: "A",
    detail: {
      sharedWith: others.length,
      // Capped: a catalogue imported twice can put hundreds in one group, and a
      // row is a sentence rather than a file listing.
      others: others.slice(0, 10),
    },
  };
}

// --- A13: a redirect that lands on the home page ---------------------------

export type RedirectEntry = { path: string; target: string };

export type RedirectRead = {
  entries: RedirectEntry[];
  /** True when the shop holds more than REDIRECT_READ_CAP and the read stopped. */
  partial: boolean;
  /** How many were read, for the row's own sentence. */
  read: number;
};

/** Is this redirect target the shop's front page and nothing else? */
export function targetsHomePage(target: string): boolean {
  const value = (target ?? "").trim();
  if (value === "") return false;
  if (value === "/" || value === "") return true;
  // An absolute address whose path is the root. Anything with a path, a query
  // or a fragment is a redirect to a page, not to the home page.
  try {
    const url = new URL(value);
    return (url.pathname === "" || url.pathname === "/") && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

/**
 * Which of a shop's redirects land on the home page, and which product each one
 * belongs to when the path names a product this catalogue still holds.
 *
 * Matthew Edgar, quoting John Mueller (PRD section 5b): a redirect to the home
 * page is treated as a soft 404, so the old address earns nothing and the
 * visitor lands somewhere that does not answer their question. The row states
 * the old path and the target; it never says to change either, because the
 * right target is a question about the catalogue that only the merchant can
 * answer.
 *
 * A path that names no product in this read has no row to sit on. Those are
 * counted and recorded per shop, exactly as A7's withdrawn-product half is,
 * and the card states them under the row rather than dropping them.
 */
export function homePageRedirects(read: RedirectRead | null): {
  byHandle: Map<string, RedirectEntry[]>;
  unmatched: RedirectEntry[];
  total: number;
} | null {
  if (!read) return null;
  const byHandle = new Map<string, RedirectEntry[]>();
  const unmatched: RedirectEntry[] = [];
  let total = 0;

  for (const entry of read.entries) {
    if (!targetsHomePage(entry.target)) continue;
    total += 1;
    const match = /^\/products\/([^/?#]+)/.exec((entry.path ?? "").trim());
    if (!match) {
      unmatched.push(entry);
      continue;
    }
    const handle = match[1];
    const list = byHandle.get(handle);
    if (list) list.push(entry);
    else byHandle.set(handle, [entry]);
  }

  return { byHandle, unmatched, total };
}

export function checkHomeRedirect(
  entries: RedirectEntry[] | undefined,
  read: RedirectRead | null,
): Finding | null {
  if (!entries || entries.length === 0) return null;
  return {
    code: "A13",
    source: "A",
    detail: {
      redirects: entries.slice(0, 5).map((e) => ({ path: e.path, target: e.target })),
      count: entries.length,
      redirectsRead: read?.read ?? null,
      partial: read?.partial ?? false,
    },
  };
}

// --- A15: filenames a camera or a phone chose ------------------------------

/**
 * The filename part of an image URL: no query string, no CDN size suffix.
 *
 * Shopify's CDN appends `?v=` and, on transformed variants, `_1024x1024`
 * before the extension. Neither is the merchant's doing and neither is what
 * this check is about, so both come off before the name is judged.
 */
export function fileNameOf(url: string): string {
  const withoutQuery = (url ?? "").split("?")[0].split("#")[0];
  const last = withoutQuery.split("/").pop() ?? "";
  return last.replace(/_\d+x\d*(?=\.[a-z0-9]+$)/i, "");
}

/**
 * A15's predicate: a filename a camera, a phone or an upload dialogue chose.
 *
 * The prefixes are the ones `looksLikeMachineAlt` already knows, because a
 * catalogue whose alt text reads "IMG_20260527" got it from a file called
 * IMG_20260527.jpg and the two checks must agree about what that is. A UUID is
 * the other shape: a file renamed by a migration tool.
 *
 * Deliberately narrow. A filename with any word in it passes, including
 * "chair-img-2.jpg", because a filter that removes noise and value together is
 * worse than the noise (DICTIONARY-PORT section 10.1) - and here the value it
 * would remove is a merchant's own naming.
 */
export function looksLikeDefaultFilename(url: string): boolean {
  const name = fileNameOf(url).replace(/\.[a-z0-9]+$/i, "");
  if (name === "") return false;
  if (/^(img|dsc|dscn|dcim|pxl|mvimg|photo|image|screenshot|whatsapp[ _-]?image)[ _-]?\d/i.test(name)) {
    return true;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) return true;
  // A bare 32-character hex string: the same file, renamed by a tool that
  // dropped the hyphens.
  if (/^[0-9a-f]{32}$/i.test(name)) return true;
  return false;
}

/**
 * A15: how many of this product's image files carry a default name.
 *
 * The denominator is the images the catalogue read carries, which today is the
 * featured image alone - the bulk query asks for `featuredImage` and no other
 * media. Stated on the row rather than hidden, because "1 of 1" and "3 of 12"
 * are different sentences and a merchant is entitled to know which one they are
 * reading. A product with no image read produces nothing at all: A1 already has
 * a sentence for a product with no image, and two rows for one absence is a
 * reader deciding which to believe.
 */
export function checkImageFilenames(product: Pick<ProductInput, "imageUrl">): Finding | null {
  const urls = [product.imageUrl].filter((u): u is string => typeof u === "string" && u.trim() !== "");
  if (urls.length === 0) return null;
  const flagged = urls.filter((url) => looksLikeDefaultFilename(url));
  if (flagged.length === 0) return null;
  return {
    code: "A15",
    source: "A",
    detail: {
      count: flagged.length,
      images: urls.length,
      names: flagged.slice(0, 5).map((url) => fileNameOf(url)),
    },
  };
}

// --- A16: a product nothing links to ---------------------------------------

/**
 * What one `menus` query per pass yields: every product a menu links to, by id
 * and by handle. Both, because a menu item can carry a `resourceId` (a link
 * picked from the product list) or only a `url` (a link typed by hand), and a
 * product linked by one and not the other is still linked.
 */
export type MenuLinks = {
  productIds: Set<string>;
  handles: Set<string>;
  /**
   * B28: the shallowest menu level that links each product directly, keyed by
   * both its id and its handle for the same reason the two sets above exist -
   * a menu item carries one or the other, and a product linked by either is
   * linked. Level 1 is a top-level menu item, so the product is one click from
   * the home page.
   */
  productDepth: Map<string, number>;
  /** B28: the same, for collections, keyed by handle and by id. */
  collectionDepth: Map<string, number>;
};

/**
 * A16: the product is in no collection and no menu links to it.
 *
 * Ahrefs Help and Break The Web (PRD section 5b): a product nothing links to is
 * reached only from the sitemap, so it is crawled last and rarely. Computed
 * from the catalogue read and one menus query - no crawl, and no page fetch.
 *
 * Null when the menus could not be read: a product in no collection might be
 * linked from a menu nobody looked at, and reporting it as an orphan would
 * accuse the merchant of something we did not check. The pass records A16 as a
 * check that could not run.
 */
export function checkOrphan(
  product: Pick<ProductInput, "id" | "handle" | "collections">,
  menus: MenuLinks | null,
): Finding | null {
  if (!menus) return null;
  const collections = product.collections ?? [];
  if (collections.length > 0) return null;
  const handle = (product.handle ?? "").trim();
  if (menus.productIds.has(product.id)) return null;
  if (handle !== "" && menus.handles.has(handle)) return null;
  return {
    code: "A16",
    source: "A",
    detail: { inCollections: 0, inMenus: 0, handle: handle || null },
  };
}

// --- B28: how many clicks from the home page ------------------------------

/**
 * B28: a product more than three clicks from the home page.
 *
 * Break The Web state the figure and the reason: the further a page is from
 * the home page through the site's own navigation, the less often it is
 * crawled and the less of the site's own standing reaches it. Three is their
 * number, quoted, not invented here (MAX_CLICK_DEPTH in seo-onpage.ts).
 *
 * **Computed with no crawl at all**, which is why a B-numbered check lives in
 * this file and runs in source A's pass: the menu tree comes from the one
 * `menus` query A16 already makes, and collection membership comes from the
 * catalogue read. Its denominator is therefore the catalogue and not the pages
 * read, and `CHECKS` says so. The precedent is A7, an A-numbered check that
 * runs in source B's pass for the mirror-image reason.
 *
 * The model, stated plainly because it is the whole of the check:
 *
 *  - the home page is depth 0;
 *  - a menu item at the first level of a menu is depth 1, one nested inside it
 *    is depth 2, and so on;
 *  - a product a menu links to directly is at that item's depth;
 *  - a product in a collection a menu links to is one click further, because
 *    the visitor clicks the collection and then the product;
 *  - the shortest of those routes is the product's depth.
 *
 * What it is not: a crawl. A product reachable in two clicks through a link in
 * a page's body text is three clicks by this check and two to a browser. The
 * method line says so, and the same caveat is on A16 for the same reason.
 */
export function clickDepthOf(
  product: Pick<ProductInput, "id" | "handle" | "collections">,
  menus: MenuLinks | null,
): number | null {
  if (!menus) return null;
  const handle = (product.handle ?? "").trim();
  const routes: number[] = [];

  const direct = [
    menus.productDepth.get(product.id),
    handle === "" ? undefined : menus.productDepth.get(handle),
  ].filter((d): d is number => typeof d === "number");
  routes.push(...direct);

  for (const collection of product.collections ?? []) {
    const depth = menus.collectionDepth.get((collection.handle ?? "").trim());
    // One click further than the collection: the collection page, then this
    // product on it.
    if (typeof depth === "number") routes.push(depth + 1);
  }

  if (routes.length === 0) return null;
  return Math.min(...routes);
}

/**
 * B28 as a row.
 *
 * Null on a product no menu route reaches at all. That is not "infinitely
 * deep", it is A16's finding - the product is an orphan - and two rows saying
 * the same absence differently is a reader deciding which to believe. Null,
 * too, when the menus could not be read; the pass records B28 as a check that
 * could not run, exactly as it does for A16.
 */
export function checkClickDepth(
  product: Pick<ProductInput, "id" | "handle" | "collections">,
  menus: MenuLinks | null,
): Finding | null {
  const depth = clickDepthOf(product, menus);
  if (depth === null) return null;
  if (depth <= MAX_CLICK_DEPTH) return null;
  return {
    code: "B28",
    source: "A",
    detail: { depth, limit: MAX_CLICK_DEPTH },
  };
}
