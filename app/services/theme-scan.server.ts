// Theme JSON-LD detection (PRD §4.2).
//
// Most themes already emit a Product node. Two Product nodes on one page is
// worse than one, and unlike on WordPress we cannot filter the theme's output.
// So we look at the rendered page from outside, once on install and again when
// the theme changes, and let the merchant choose knowingly.
//
// Runs server side, never on a page view.

import db from "../db.server";
import { describeGraphqlBody, named } from "./graphql-errors";
import { NAMESPACE } from "./facts.server";

/** One top-level JSON-LD node, after @graph is flattened. */
export type LdNode = {
  types: string[];
  id: string;
  /**
   * Only present (and only meaningful) on a Product node: true when that
   * node carries its own nested `aggregateRating` property. AggregateRating
   * is never a top-level node on this platform, so this is how its presence
   * is actually determined - see deriveMissingReasons.
   */
  hasAggregateRating?: boolean;
};

export type PageScan = {
  url: string;
  nodes: LdNode[];
  passwordProtected: boolean;
  /** The canonical URL the page declares, null when no canonical tag exists. */
  canonical?: string | null;
  /** True when a robots meta tag on the page contains "noindex". */
  noindex?: boolean;
};

export type RobotsCheck = {
  fetched: boolean;
  content: string;
  /** Disallow lines whose path prefix matches one of the scanned pages. */
  disallowsRelevant: string[];
};

export type ConflictEntry = {
  type: string;
  count: number;
  /** True when one of the repeated nodes carries an @id our own block sets. */
  weEmitOne: boolean;
};

export type ThemeScanResult = {
  hasProductLd: boolean;
  nodeCount: number;
  emitters: string[];
  /** Same detection, for the store-wide Organization node (sameAs). */
  hasOrganizationLd: boolean;
  organizationEmitters: string[];
  checkedUrl: string;
  /** The storefront answered with the password page: nothing can be read. */
  passwordProtected?: boolean;

  /** Part 1/2: full page scans, product and home. */
  product?: PageScan;
  home?: PageScan;
  productConflicts?: ConflictEntry[];
  homeConflicts?: ConflictEntry[];

  /** Part 5: weekly-watch history, appended by the SEO screen and the job. */
  watchChanges?: { page: "product" | "home"; nodeType: string; detectedAt: string }[];

  /**
   * True when the scanned product page's own Product node (theme's or ours)
   * carries a nested aggregateRating. Determined from what the page actually
   * renders, not guessed - see extractLdNodes/scanPage.
   */
  hasAggregateRating?: boolean;
  /** True when the scanned page(s) carry a top-level FAQPage node. */
  hasFAQPage?: boolean;

  /** Crawl tab: robots.txt as served, and canonical/noindex on each scanned page. */
  robots?: RobotsCheck;

  /** Persisted so every tab reads the same values without recomputing. */
  missingReasons?: {
    nodeType: string;
    emitted: boolean;
    reason: string | null;
    fixScreen: string | null;
  }[];
  richResultsUrl?: string;
};

const LD_BLOCK = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function typesOf(node: any): string[] {
  const t = node?.["@type"];
  if (!t) return [];
  return Array.isArray(t) ? t.map(String) : [String(t)];
}

function collectNodes(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed.flatMap(collectNodes);
  if (parsed && typeof parsed === "object") {
    const graph = parsed["@graph"];
    if (Array.isArray(graph)) return graph.flatMap(collectNodes);
    return [parsed];
  }
  return [];
}

/**
 * Every top-level JSON-LD node found in a page's HTML, `@graph` flattened.
 * Malformed JSON in one script block is skipped, never thrown - a broken
 * block is a finding to report, not a reason to fail the whole scan.
 */
export function extractLdNodes(html: string): LdNode[] {
  const nodes: LdNode[] = [];
  for (const node of extractLdObjects(html)) {
    const types = typesOf(node);
    if (types.length === 0) continue;
    nodes.push({
      types,
      id: String(node["@id"] ?? ""),
      // AggregateRating lives nested inside a Product node on this platform
      // (never as its own top-level node), so this is the only place its
      // presence can be read off the page. Key omitted entirely when absent,
      // so existing shape-equality checks are unaffected.
      ...(node && typeof node === "object" && node.aggregateRating
        ? { hasAggregateRating: true }
        : {}),
    });
  }
  return nodes;
}

/**
 * The same blocks, unparsed: every top-level JSON-LD object on the page with
 * `@graph` flattened, properties and all. extractLdNodes keeps only types and
 * ids, which is all the theme scan ever needed; the per-product page scan
 * needs the Product node's `offers` to compare against what the variants say
 * (check A2), and reading the page twice with two different parsers is how
 * the two come to disagree.
 */
export function extractLdObjects(html: string): any[] {
  const out: any[] = [];
  for (const match of html.matchAll(LD_BLOCK)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      // A broken block is a finding to report, not a reason to fail the scan.
      continue;
    }
    out.push(...collectNodes(parsed));
  }
  return out;
}

// Two pure rules live in ./conflicts (no ".server" suffix) because screens
// apply them in the browser, and re-exported here so every server caller and
// its tests keep the import they already had:
//
//  - organizationPairIsInformational: the SEO screen's components render this
//    judgement client side.
//  - isOurNodeId: an @id our own block would have set. The extension sets
//    `#product` on the Product node, `#collection` on the CollectionPage node
//    and `#organization` on the Organization node it emits itself (when
//    extending the theme's own node it reuses the theme's @id instead).
//    Recognising our suffixes is how a conflict can name us as one of the two
//    sources without guessing at the other, how the scan keeps our own output
//    from counting as "the theme emits one", and - since build step 4 - how
//    the SEO card's B1 aggregate tells a theme node from ours.
export { organizationPairIsInformational, isOurNodeId } from "./conflicts";

import { isOurNodeId } from "./conflicts";

/**
 * Resolve an `@id` to the form it actually identifies, so a relative id from
 * the theme ("/products/x#product") and the absolute form of the same
 * address from us ("https://shop.example/products/x#product") compare equal
 * - a real theme produces exactly this pair, and without resolution the
 * detector would report a conflict against itself in extend mode. `pageUrl`
 * is the page the ids were read from, needed to resolve a relative id per
 * IRI rules (RFC 3986): resolution is against the document's own URL, not
 * some other origin.
 *
 * Returns null for an empty id - an empty id carries no identity, so it can
 * never be said to match another node, empty or not (see detectConflicts).
 * When `pageUrl` is not known, a relative id is left unresolved rather than
 * guessed at: two different-looking ids that might be the same node are
 * reported as a possible conflict instead of being silently merged, because
 * an unearned merge would hide a real duplicate, which is the worse failure
 * of the two (DICTIONARY-PORT §10.1: a filter that removes value silently is
 * worse than noise that stays visible).
 */
export function canonicalNodeId(id: string, pageUrl?: string | null): string | null {
  if (!id) return null;
  if (!pageUrl) return id;
  try {
    return new URL(id, pageUrl).href;
  } catch {
    return id;
  }
}

/**
 * Two top-level nodes of the same @type on one page is a real defect only
 * when they are actually two nodes. Extend mode deliberately emits a node
 * carrying the same `@id` as the theme's own, so the two are read as one
 * node merging, not a conflict - the whole reason extend mode exists. Report
 * every repeated type that survives id-merging, and say plainly when one of
 * the repeats is ours.
 *
 * `pageUrl` lets two ids that name the same address in different forms
 * (relative vs. absolute) merge correctly - see canonicalNodeId. Nodes with
 * no `@id` at all can never be merged with anything, including each other:
 * two id-less nodes of the same type are still two distinct, unverifiable
 * nodes and remain a conflict.
 */
export function detectConflicts(nodes: LdNode[], pageUrl?: string | null): ConflictEntry[] {
  const byType = new Map<string, LdNode[]>();
  for (const node of nodes) {
    for (const type of node.types) {
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(node);
    }
  }
  const conflicts: ConflictEntry[] = [];
  for (const [type, list] of byType) {
    // Merge nodes that share a canonical @id into one entity; an id-less
    // node never merges with anything, so each counts on its own.
    const byId = new Map<string, boolean>(); // canonical id -> weEmitOne so far
    let distinctCount = 0;
    let weEmitOne = false;
    for (const node of list) {
      const canonical = canonicalNodeId(node.id, pageUrl);
      const emitsOurs = isOurNodeId(node.id);
      if (canonical === null) {
        distinctCount += 1;
        weEmitOne = weEmitOne || emitsOurs;
        continue;
      }
      if (!byId.has(canonical)) {
        distinctCount += 1;
        byId.set(canonical, emitsOurs);
      } else if (emitsOurs) {
        byId.set(canonical, true);
      }
    }
    weEmitOne = weEmitOne || Array.from(byId.values()).some(Boolean);

    if (distinctCount < 2) continue;
    conflicts.push({ type, count: distinctCount, weEmitOne });
  }
  return conflicts.sort((a, b) => a.type.localeCompare(b.type));
}

const CANONICAL_TAG = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i;
const CANONICAL_TAG_REVERSED = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i;
const ROBOTS_META_TAG = /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i;
const ROBOTS_META_TAG_REVERSED = /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["']/i;

/** The canonical URL a page declares, or null when it has no canonical tag. */
export function extractCanonical(html: string): string | null {
  const match = CANONICAL_TAG.exec(html) ?? CANONICAL_TAG_REVERSED.exec(html);
  return match ? match[1] : null;
}

/**
 * True when the page carries a robots meta tag whose content includes
 * "noindex" - the single most damaging finding this screen can surface, so
 * it is read directly off the page rather than inferred.
 */
export function extractNoindex(html: string): boolean {
  const match = ROBOTS_META_TAG.exec(html) ?? ROBOTS_META_TAG_REVERSED.exec(html);
  if (!match) return false;
  return /noindex/i.test(match[1]);
}

const DISALLOW_LINE = /^\s*Disallow:\s*(\S+)\s*$/gim;

/**
 * Fetch robots.txt as actually served by the storefront and report which of
 * its Disallow rules would block one of the scanned pages. A plain prefix
 * match: robots.txt rules are path prefixes, not full expressions, so this
 * is what actually determines a block for the simple cases this screen
 * covers. Never throws - an unreachable robots.txt is a finding, not a
 * failure.
 */
export async function fetchRobotsCheck(
  origin: string,
  scannedPaths: string[],
): Promise<RobotsCheck> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": SCAN_USER_AGENT },
    });
    if (!res.ok) {
      return { fetched: false, content: "", disallowsRelevant: [] };
    }
    const content = await res.text();
    const disallows: string[] = [];
    for (const match of content.matchAll(DISALLOW_LINE)) {
      disallows.push(match[1]);
    }
    const disallowsRelevant = disallows.filter((path) =>
      scannedPaths.some((scanned) => path !== "" && scanned.startsWith(path)),
    );
    return { fetched: true, content, disallowsRelevant };
  } catch {
    return { fetched: false, content: "", disallowsRelevant: [] };
  }
}

/**
 * Our user agent, sent by every page read this app makes. Identify honestly;
 * some merchants log user agents, and the nightly page scan matches its own
 * robots.txt group against this string.
 */
export const SCAN_USER_AGENT = "AI-Visibility-App/1.0 (+https://apps.shopify.com)";

/**
 * Unlock a password-protected storefront and return the cookie that keeps it
 * unlocked, or null when there is no password or the unlock produced no
 * cookie. Exported because the per-product page scan
 * (PRD-SEO-PER-PRODUCT section 3) has to send the password "exactly as
 * scanPage does": one implementation, so the two cannot drift.
 *
 * `fetchImpl` exists for tests only; production always passes nothing.
 */
export async function storefrontCookie(
  origin: string,
  storefrontPassword: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const unlock = await fetchImpl(`${origin}/password`, {
    method: "POST",
    headers: {
      "User-Agent": SCAN_USER_AGENT,
      Accept: "text/html",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      form_type: "storefront_password",
      utf8: "✓",
      password: storefrontPassword,
    }),
    redirect: "manual",
  });
  // headers.get("set-cookie") comma-joins multiple Set-Cookie headers into
  // one string, and splitting that on ";" can hand back a mangled value -
  // a correct password then still reads as a password wall. getSetCookie()
  // returns them separately; the storefront_digest cookie is the session
  // unlock, so it is selected explicitly, with the joined form only as a
  // fallback for runtimes without getSetCookie.
  const setCookies =
    typeof unlock.headers.getSetCookie === "function" ? unlock.headers.getSetCookie() : [];
  const digest = setCookies.find((c) => c.startsWith("storefront_digest="));
  const cookie = digest ?? setCookies[0] ?? unlock.headers.get("set-cookie");
  return cookie ? cookie.split(";")[0] : null;
}

async function fetchWithPasswordUnlock(
  url: string,
  storefrontPassword?: string | null,
): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": SCAN_USER_AGENT,
    Accept: "text/html",
  };

  // Development stores cannot turn password protection off, and a live store
  // left password-protected is the first reason assistants cannot see it. If
  // the merchant gave us the password we unlock a session for the scan; the
  // crawler check reports the protection either way.
  if (storefrontPassword) {
    const origin = new URL(url).origin;
    const cookie = await storefrontCookie(origin, storefrontPassword);
    if (cookie) headers.Cookie = cookie;
  }

  const res = await fetch(url, { headers, redirect: "follow" });
  return res.text();
}

/** Fetch one page as a plain client and report every JSON-LD node found. */
export async function scanPage(
  url: string,
  storefrontPassword?: string | null,
): Promise<PageScan> {
  const html = await fetchWithPasswordUnlock(url, storefrontPassword);

  // A password page is not a theme finding - say so plainly.
  if (/name=["']password["']/i.test(html) && !/ld\+json/i.test(html)) {
    return { url, nodes: [], passwordProtected: true, canonical: null, noindex: false };
  }

  return {
    url,
    nodes: extractLdNodes(html),
    passwordProtected: false,
    canonical: extractCanonical(html),
    noindex: extractNoindex(html),
  };
}

/**
 * Fetch a product page as a plain client and report what structured data the
 * theme already publishes. Deliberately not authenticated: this is what a
 * crawler sees.
 */
export async function scanThemeForProductLd(
  productUrl: string,
  storefrontPassword?: string | null,
): Promise<ThemeScanResult> {
  const page = await scanPage(productUrl, storefrontPassword);

  if (page.passwordProtected) {
    return {
      hasProductLd: false,
      nodeCount: 0,
      emitters: [],
      hasOrganizationLd: false,
      organizationEmitters: [],
      checkedUrl: productUrl,
      passwordProtected: true,
      product: page,
    };
  }

  const productNodes = page.nodes.filter((n) => n.types.includes("Product"));
  // hasOrganizationLd means "the THEME emits an Organization node", so our
  // own node (recognisable by its #organization @id) is excluded here.
  // Without this exclusion the flag oscillated: scan 1 finds no theme node,
  // the block emits ours; scan 2 reads our own node back as the theme's and
  // the block suppressed itself; scan 3 finds none again - the self-feed
  // class CLAUDE.md rule 3 names, filling the weekly watch history with
  // changes this app produced itself.
  const orgNodes = page.nodes.filter(
    (n) => n.types.includes("Organization") && !isOurNodeId(n.id),
  );

  return {
    hasProductLd: productNodes.length > 0,
    nodeCount: productNodes.length,
    emitters: productNodes.map((n) => n.id).filter(Boolean),
    hasOrganizationLd: orgNodes.length > 0,
    organizationEmitters: orgNodes.map((n) => n.id),
    checkedUrl: productUrl,
    product: page,
    productConflicts: detectConflicts(page.nodes, productUrl),
    hasAggregateRating: productNodes.some((n) => n.hasAggregateRating === true),
    hasFAQPage: page.nodes.some((n) => n.types.includes("FAQPage")),
  };
}

/**
 * Scan both a product page and the home page. They emit different things -
 * WebSite with SearchAction is home-page only - so a single scan would
 * report the home page's nodes as missing from products, or the reverse.
 */
export async function scanStorefront(
  productUrl: string,
  homeUrl: string,
  storefrontPassword?: string | null,
): Promise<ThemeScanResult> {
  const base = await scanThemeForProductLd(productUrl, storefrontPassword);
  if (base.passwordProtected) return base;

  const home = await scanPage(homeUrl, storefrontPassword);

  // Crawl tab (PRD - EXPERIENCE-PRD §6): cheap because both pages are
  // already fetched above; robots.txt is the one extra request, done once.
  let robots: RobotsCheck | undefined;
  try {
    const origin = new URL(homeUrl).origin;
    const productPath = new URL(productUrl).pathname;
    const homePath = new URL(homeUrl).pathname;
    robots = await fetchRobotsCheck(origin, [productPath, homePath]);
  } catch {
    robots = { fetched: false, content: "", disallowsRelevant: [] };
  }

  return {
    ...base,
    home,
    homeConflicts: home.passwordProtected ? undefined : detectConflicts(home.nodes, homeUrl),
    hasFAQPage: base.hasFAQPage || home.nodes.some((n) => n.types.includes("FAQPage")),
    robots,
  };
}

// --- Part 3: why the missing ones are missing -----------------------------

export type MissingReasonInput = {
  embedActive: boolean;
  mode: "extend" | "full" | "unknown";
  hasFacts: boolean;
  hasSummary: boolean;
  hasFitFor: boolean;
  hasReturnDays: boolean;
  hasDeliveryTime: boolean;
  /** null when the scanned page could not be read at all (e.g. password wall). */
  hasRating: boolean | null;
  /**
   * Whether the scanned home page actually carried a WebSite node, and the
   * scanned product page a BreadcrumbList node - read from the scan's own
   * node lists, null when that page could not be read. These were once
   * asserted "emitted" purely because seoUnlocked was true, while the real
   * nodes sat unconsulted in the same scan result - a guess on the screen
   * whose subtitle says "never a guess".
   */
  hasWebSiteNode: boolean | null;
  hasBreadcrumbNode: boolean | null;
  hasCollectionQuestions: boolean | null;
  hasSocialProfiles: boolean;
  seoUnlocked: boolean;
  isCollectionPage: boolean;
};

export type MissingReason = {
  nodeType: string;
  emitted: boolean;
  reason: string | null;
  fixScreen: string | null;
};

/**
 * For each node type the extension is capable of emitting, say whether it is
 * emitted and, when not, the concrete reason - derived from real state, not
 * a static checklist. Read against ai-visibility.liquid's own conditions.
 */
export function deriveMissingReasons(input: MissingReasonInput): MissingReason[] {
  const reasons: MissingReason[] = [];

  if (!input.embedActive) {
    return [
      "Product",
      "Organization",
      "WebSite/SearchAction",
      "BreadcrumbList",
      "CollectionPage",
      "FAQPage",
    ].map((nodeType) => ({
      nodeType,
      emitted: false,
      reason: "The app embed is not active in the theme.",
      fixScreen: "/app/diagnostics",
    }));
  }

  // Product node: full mode emits unconditionally; extend mode only when
  // there are facts or a generated summary to add.
  if (input.mode === "full") {
    reasons.push({ nodeType: "Product", emitted: true, reason: null, fixScreen: null });
  } else if (input.hasFacts || input.hasSummary) {
    reasons.push({ nodeType: "Product", emitted: true, reason: null, fixScreen: null });
  } else {
    reasons.push({
      nodeType: "Product",
      emitted: false,
      reason: "Extend mode has nothing to add yet - this product has no extracted attributes or generated summary.",
      fixScreen: "/app/products",
    });
  }

  // Organization / sameAs.
  reasons.push(
    input.hasSocialProfiles
      ? { nodeType: "Organization", emitted: true, reason: null, fixScreen: null }
      : {
          nodeType: "Organization",
          emitted: false,
          reason: "No store social profile URLs are filled in on the Business screen.",
          fixScreen: "/app/business",
        },
  );

  // WebSite + SearchAction (home page) and BreadcrumbList (product page):
  // gated on seo_unlocked, but "emitted" is read off what the scan actually
  // found on the page, never inferred from the gate being open - the same
  // pattern hasRating uses.
  const scanned: { nodeType: string; found: boolean | null }[] = [
    { nodeType: "WebSite/SearchAction", found: input.hasWebSiteNode },
    { nodeType: "BreadcrumbList", found: input.hasBreadcrumbNode },
  ];
  for (const { nodeType, found } of scanned) {
    if (!input.seoUnlocked) {
      reasons.push({
        nodeType,
        emitted: false,
        reason: "This property is part of the operator-configured SEO module, not yet enabled for this shop.",
        fixScreen: null,
      });
    } else if (found === true) {
      reasons.push({ nodeType, emitted: true, reason: null, fixScreen: null });
    } else if (found === null) {
      reasons.push({
        nodeType,
        emitted: false,
        reason: "Could not be determined - the last scan could not read this page.",
        fixScreen: "/app/diagnostics",
      });
    } else {
      reasons.push({
        nodeType,
        emitted: false,
        reason: "The SEO module is enabled but the last scan did not find this node on the page - check that the app embed is active in the current theme.",
        fixScreen: "/app/diagnostics",
      });
    }
  }

  // AggregateRating - read directly off the scanned page (it is nested
  // inside the Product node, never a top-level node of its own).
  if (input.hasRating === true) {
    reasons.push({ nodeType: "AggregateRating", emitted: true, reason: null, fixScreen: null });
  } else if (input.hasRating === null) {
    reasons.push({
      nodeType: "AggregateRating",
      emitted: false,
      reason: "Could not be determined - the last scan could not read this page.",
      fixScreen: "/app/diagnostics",
    });
  } else {
    reasons.push({
      nodeType: "AggregateRating",
      emitted: false,
      reason: "The last scan found no rating on this product's page - no review app has written rating metafields for it yet.",
      fixScreen: null,
    });
  }

  // hasMerchantReturnPolicy - depends on Business screen return window.
  reasons.push(
    input.hasReturnDays
      ? { nodeType: "MerchantReturnPolicy", emitted: true, reason: null, fixScreen: null }
      : {
          nodeType: "MerchantReturnPolicy",
          emitted: false,
          reason: "The return window is empty on the Business screen.",
          fixScreen: "/app/business",
        },
  );

  // OfferShippingDetails - depends on Business screen delivery time.
  reasons.push(
    input.hasDeliveryTime
      ? { nodeType: "OfferShippingDetails", emitted: true, reason: null, fixScreen: null }
      : {
          nodeType: "OfferShippingDetails",
          emitted: false,
          reason: "Delivery time is empty, or marked as varying, on the Business screen.",
          fixScreen: "/app/business",
        },
  );

  // CollectionPage / FAQPage, only relevant on a collection page.
  if (input.isCollectionPage) {
    reasons.push(
      input.hasSummary
        ? { nodeType: "CollectionPage", emitted: true, reason: null, fixScreen: null }
        : {
            nodeType: "CollectionPage",
            emitted: false,
            reason: "This collection has no generated summary yet - it is written when collections are processed.",
            fixScreen: "/app/collections",
          },
    );
    if (input.hasCollectionQuestions === true) {
      reasons.push({ nodeType: "FAQPage", emitted: true, reason: null, fixScreen: null });
    } else if (input.hasCollectionQuestions === null) {
      reasons.push({
        nodeType: "FAQPage",
        emitted: false,
        reason: "Could not be determined - the last scan could not read this page.",
        fixScreen: "/app/diagnostics",
      });
    } else {
      reasons.push({
        nodeType: "FAQPage",
        emitted: false,
        reason: "This collection has no generated questions yet.",
        fixScreen: "/app/collections",
      });
    }
  }

  return reasons;
}

const SHOP_ID = `#graphql
  query ShopId { shop { id } }
`;

const SET_METAFIELD = `#graphql
  mutation SetShopThemeScan($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/**
 * Mirror the Organization detection to a shop metafield, so the storefront
 * block can decide extend-or-emit at render time without a fetch. The block
 * needs the actual identifier, not just a boolean: a theme Organization node
 * with no @id of its own gives us nothing to reference, so organizationId
 * stays empty and the block falls back to emitting its own node.
 */
async function mirrorThemeScanMetafield(
  shopId: string,
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
  result: ThemeScanResult,
): Promise<void> {
  const idRes = await named("ShopId", () => graphql(SHOP_ID));
  const idJson = await idRes.json();
  // A 200 carrying top-level errors reaches some callers as a value rather
  // than a throw, and reading `data?.shop?.id` off it returns undefined - so
  // this used to return silently and the metafield was never written, with
  // nothing logged. Say what the API said (4 September 2026).
  const idFailure = describeGraphqlBody(idJson, "ShopId");
  if (idFailure) throw new Error(idFailure);
  const shopGid = idJson.data?.shop?.id;
  if (!shopGid) return;

  const organizationId = result.organizationEmitters.find((id) => id !== "") ?? "";

  const value = JSON.stringify({
    hasOrganizationLd: result.hasOrganizationLd,
    organizationId,
  });

  const res = await named("SetShopThemeScan", () =>
    graphql(SET_METAFIELD, {
    variables: {
      metafields: [
        {
          ownerId: shopGid,
          namespace: NAMESPACE,
          key: "theme_scan",
          type: "json",
          value,
        },
      ],
    },
    }),
  );
  const json = await res.json();
  // Top-level errors first: throttling, an access-scope refusal and a document
  // Shopify will not run all arrive as HTTP 200 with `errors` and no `data`,
  // and reading userErrors off that finds an empty array and reports success.
  const failure = describeGraphqlBody(json, "SetShopThemeScan");
  if (failure) throw new Error(`${failure} | valueBytes=${Buffer.byteLength(value)}`);
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(
      `metafieldsSet (shop theme_scan): ${JSON.stringify(errors)} | ` +
        `valueBytes=${Buffer.byteLength(value)}`,
    );
  }
}

/**
 * The ThemeScan row is keyed by theme id, and the two writers used two
 * different spellings of the same theme: admin routes store the GraphQL gid
 * (gid://shopify/OnlineStoreTheme/123), while the themes/publish webhook
 * payload carries the bare numeric id. That split the same theme across two
 * rows, and the SEO loader's "most recent of anything" read then surfaced
 * whichever was written last. Every writer normalises through this helper so
 * one theme is one row. A non-numeric, non-gid value (the webhook's "current"
 * fallback) is left as-is rather than dressed up as a gid it is not.
 */
export function themeRowKey(id: string | number): string {
  const s = String(id);
  if (s.startsWith("gid://")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/OnlineStoreTheme/${s}`;
  return s;
}

/**
 * Merge a narrow scan (product page only - scanThemeForProductLd) into the
 * rich detail the SEO screen's scanStorefront wrote, updating only the
 * fields the narrow scan actually measured. Without this, Diagnostics' "Run
 * the check" and the themes/publish webhook replaced the whole detail JSON,
 * permanently erasing the home-page scan, robots findings, missingReasons
 * and the weekly watch history - and the SEO screen then rendered "no
 * problems" from a scan that never looked at those things.
 *
 * Rules:
 * - No previous detail: the narrow result stands on its own.
 * - Narrow scan hit the password wall: it measured nothing, so the previous
 *   detail is returned unchanged (callers skip the write entirely).
 * - Otherwise: product-page fields are taken from the narrow scan;
 *   home/homeConflicts/robots/watchChanges/missingReasons/richResultsUrl are
 *   preserved from the previous detail. hasFAQPage spans both pages, so it
 *   is recomputed from the fresh product page plus the preserved home page.
 *
 * Pure and exported for tests.
 */
export function mergeNarrowScanIntoDetail(
  previous: ThemeScanResult | null,
  narrow: ThemeScanResult,
): ThemeScanResult {
  if (!previous) return narrow;
  if (narrow.passwordProtected) return previous;

  const homeHasFaq =
    previous.home && !previous.home.passwordProtected
      ? previous.home.nodes.some((n) => n.types.includes("FAQPage"))
      : false;

  return {
    ...previous,
    hasProductLd: narrow.hasProductLd,
    nodeCount: narrow.nodeCount,
    emitters: narrow.emitters,
    hasOrganizationLd: narrow.hasOrganizationLd,
    organizationEmitters: narrow.organizationEmitters,
    checkedUrl: narrow.checkedUrl,
    passwordProtected: narrow.passwordProtected,
    product: narrow.product,
    productConflicts: narrow.productConflicts,
    hasAggregateRating: narrow.hasAggregateRating,
    hasFAQPage: Boolean(narrow.hasFAQPage) || homeHasFaq,
  };
}

/**
 * Persist a narrow (product-page-only) scan without clobbering the canonical
 * rich detail - the writer Diagnostics and the themes/publish webhook use.
 * The SEO screen's scanStorefront keeps calling recordThemeScan directly,
 * because its result is the full detail and IS the canonical row content.
 */
export async function recordNarrowThemeScan(
  shopId: string,
  themeId: string,
  narrow: ThemeScanResult,
  graphql?: (query: string, options?: { variables?: object }) => Promise<Response>,
) {
  const key = themeRowKey(themeId);
  const existing = await db.themeScan.findUnique({
    where: { shopId_themeId: { shopId, themeId: key } },
  });
  const previous = (existing?.detail as unknown as ThemeScanResult) ?? null;

  // A password wall measured nothing; leave the stored detail and the shop
  // metafield exactly as they were rather than recording an empty result.
  if (previous && narrow.passwordProtected) return;

  await recordThemeScan(shopId, key, mergeNarrowScanIntoDetail(previous, narrow), graphql);
}

export async function recordThemeScan(
  shopId: string,
  themeId: string,
  result: ThemeScanResult,
  graphql?: (query: string, options?: { variables?: object }) => Promise<Response>,
) {
  // Normalised so every caller lands on the same row - see themeRowKey.
  const key = themeRowKey(themeId);
  await db.themeScan.upsert({
    where: { shopId_themeId: { shopId, themeId: key } },
    create: {
      shopId,
      themeId: key,
      hasProductLd: result.hasProductLd,
      detail: result as any,
    },
    update: {
      hasProductLd: result.hasProductLd,
      detail: result as any,
      scannedAt: new Date(),
    },
  });

  if (graphql) {
    try {
      await mirrorThemeScanMetafield(shopId, graphql, result);
    } catch (error) {
      // The ThemeScan row above is already committed. A caller that turns this
      // throw into a sentence for a merchant has to know that, or it will say
      // the scan was lost when the scan was saved and only the storefront
      // mirror is stale (4 September 2026). Marked rather than swallowed: the
      // mirror failing is still a failure.
      if (error && typeof error === "object") {
        (error as Record<string, unknown>).themeScanRowWritten = true;
      }
      throw error;
    }
  }
}

/**
 * Did `recordThemeScan` get its database row written before it threw?
 *
 * True means the scan result is persisted and only the shop metafield that
 * mirrors `hasOrganizationLd` / `organizationId` to the storefront block is
 * stale. The next successful scan overwrites it; nothing is lost either way,
 * but the two are different sentences on a screen.
 */
export function themeScanRowWasWritten(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && (error as Record<string, unknown>).themeScanRowWritten,
  );
}
