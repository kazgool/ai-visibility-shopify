// Source B of the per-product SEO scan: one GET of the product's public page,
// read as a crawler reads it (PRD-SEO-PER-PRODUCT section 3, checks B1 to B5).
//
// This is the only metered part of the feature. Source A is free because a
// catalogue pass was going to happen anyway; every page here is a request to
// the merchant's storefront, so the pass is bounded by a per-shop daily
// budget, paced one request at a time, and stops when the shop's own
// robots.txt says it should.
//
// Four rules this module keeps, and the reason for each:
//
//  1. **The two sources never overwrite each other.** `findings` is one
//     column holding both halves. Source A owns the findings whose `source`
//     is "A"; source B owns the rest ("B", and "A+B" for A2, which is
//     computed here from the offer facts source A stored). Each rewrites only
//     its own half - otherwise every catalogue pass would erase the page
//     findings and every page scan would erase the catalogue findings.
//  2. **A page that could not be read produces no finding about the page.**
//     A password form is not "no Product node". It is recorded as
//     `status: "password"` with no source B findings at all, so the aggregate
//     can only ever say "could not be read".
//  3. **A page that was attempted has its `scannedAt` moved**, including one
//     that failed. Otherwise the ordering - which is the cursor - would hand
//     the same broken product back every night for ever and the rest of the
//     catalogue would never be reached.
//  4. **What the cache said is recorded, not assumed.** The request asks for
//     a fresh copy; `Cache-Control` and `Age` as they came back go into the
//     row and the report, because a stale page is a finding about the cache
//     and never about the theme.

import db from "../db.server";
import {
  checkOfferConsistency,
  findingsOf,
  isSourceAFinding,
  type Finding,
  type OfferFacts,
  type SchemaOffer,
} from "./seo-scan";
import {
  SCAN_USER_AGENT,
  canonicalNodeId,
  extractCanonical,
  extractLdNodes,
  extractLdObjects,
  extractNoindex,
  isOurNode,
  storefrontCookie,
  type LdNode,
} from "./theme-scan.server";
import {
  LINK_CHECK_CAP,
  checkDeprecatedNodes,
  checkDuplicateTitle,
  checkH1,
  checkHandle,
  checkInternalLinks,
  checkMetaDescription,
  checkMetaKeywords,
  checkMixedContent,
  checkPageAltText,
  checkRedirectChain,
  checkThinContent,
  checkTitleTag,
  checkOpenGraph,
  checkTwitterCard,
  extractTitleTag,
  internalLinks,
  pageDescription,
  titleKey,
  type Hop,
  type LinkPlan,
  type LinkResult,
} from "./seo-onpage";

/** Section 3: 500 page fetches per shop per day unless an operator says otherwise. */
export const DEFAULT_DAILY_BUDGET = 500;

/** Per-shop Setting row an operator can raise for a client who pays for it. */
export const BUDGET_SETTING_KEY = "seo_scan_daily_budget";

/** One request at a time per shop, this far apart. 500 pages is about four minutes. */
export const REQUEST_INTERVAL_MS = 500;

/** The path space the whole scan lives in, and the one robots.txt is asked about. */
export const PRODUCTS_PATH = "/products/";

/**
 * Deliberately NOT `describeGraphqlError`, and this is the reason.
 *
 * Every error this module catches is a `fetch` to a merchant's storefront -
 * this file makes no Admin GraphQL call at all - and the string goes into
 * finding B5's detail, which the product editor renders as "The page could not
 * be reached: ...". A log formatter belongs in a log: stack frames and an
 * "Error:" prefix on a merchant's screen are noise, and the existing test
 * "turns a thrown request into a read that says so" asserts the bare message.
 * `describeGraphqlError` is for what is logged; this is for what is shown.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The shop's budget for tonight. Absent, unparseable or non-positive means
 * the default: a typo in an operator-set row must not silently turn the scan
 * off, and a scan of zero pages that reports "0 of 20,000 read" every night
 * is the kind of silence this app is written against.
 */
export async function dailyBudget(shopId: string): Promise<number> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: BUDGET_SETTING_KEY } },
  });
  const value = Number(row?.value);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DAILY_BUDGET;
  return Math.floor(value);
}

/**
 * The shop's budget, optionally lowered for one run and never raised.
 *
 * `scripts/run-seo-scan.ts` takes `--limit N` so a night's scan can be watched
 * on a few pages instead of five hundred. The clamp is here, next to
 * `dailyBudget`, and is a `Math.min` in one direction only: a development
 * runner that could raise the ceiling would be a second budget, and the whole
 * point of `seo_scan_daily_budget` is that one setting an operator controls is
 * the only thing that decides how many pages a shop's storefront is asked for
 * in a day. An absent, unparseable or negative cap leaves the shop's budget
 * exactly as it is.
 */
export function cappedBudget(shopBudget: number, cap?: number | null): number {
  if (cap === null || cap === undefined || !Number.isFinite(cap)) return shopBudget;
  return Math.max(0, Math.min(shopBudget, Math.floor(cap)));
}

// --- what has been spent today ---------------------------------------------

/** Pages fetched today, nightly pass and merchant clicks together. */
export const SPEND_SETTING_KEY = "seo_scan_spent";

/**
 * The day a spend belongs to, in UTC, because the nightly pass runs at 03:45
 * UTC and a local-time day would split one night's work across two budgets.
 */
export function budgetDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type BudgetStatus = { budget: number; spent: number; remaining: number; day: string };

/**
 * How much of tonight's budget is left. Counted rather than inferred from the
 * rows: a merchant who presses "Read this page now" on the same product ten
 * thousand times would move one row's scannedAt ten thousand times and a
 * row-based count would read that as one page (PRD section 4 - the button is
 * "counted against it, so a merchant cannot spend 10,000 fetches by
 * clicking"). A stored counter is the only thing that can say no.
 */
export async function pageBudget(shopId: string, now = new Date()): Promise<BudgetStatus> {
  const budget = await dailyBudget(shopId);
  const day = budgetDay(now);
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SPEND_SETTING_KEY } },
  });
  let spent = 0;
  try {
    const parsed = row?.value ? JSON.parse(row.value) : null;
    // A counter from an earlier day is not this day's spend. Read as zero
    // rather than reset here: a read must not write.
    if (parsed && parsed.day === day && Number.isFinite(Number(parsed.pages))) {
      spent = Math.max(0, Math.floor(Number(parsed.pages)));
    }
  } catch {
    spent = 0;
  }
  return { budget, spent, remaining: Math.max(0, budget - spent), day };
}

/** Add to today's counter. Rolls over by overwriting a counter from another day. */
export async function spendPages(shopId: string, pages: number, now = new Date()): Promise<void> {
  if (pages <= 0) return;
  const { spent, day } = await pageBudget(shopId, now);
  const value = JSON.stringify({ day, pages: spent + pages });
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: SPEND_SETTING_KEY } },
    create: { shopId, key: SPEND_SETTING_KEY, value },
    update: { value },
  });
}

/**
 * The storefront unlock, and never a reason the night fails.
 *
 * `storefrontCookie` POSTs to `/password` with a bare fetch. A storefront
 * that refuses the connection therefore threw out of the whole nightly pass -
 * JobRun failed, zero pages, and it repeats every night - and out of the
 * product editor's action, where the merchant got a 500 instead of one of the
 * four refusal sentences that path was written to give. Without a cookie the
 * pages answer with the password form, which the row already records as
 * `status: "password"` and every screen already reads as "could not be read".
 * That is the honest outcome; a stack trace is not. QA of 3 September 2026.
 */
async function unlockQuietly(
  origin: string,
  password: string | null | undefined,
  fetchImpl: typeof fetch,
  log: ((message: string) => void) | null | undefined,
): Promise<string | null> {
  if (!password) return null;
  try {
    return await storefrontCookie(origin, password, fetchImpl);
  } catch (error) {
    log?.(
      `seo_scan ${origin}: the storefront password could not be sent - ${describeError(error)}`,
    );
    return null;
  }
}

/**
 * Where the last nightly pass recorded that robots.txt turned it away, so the
 * SEO screen can say why nothing is being read instead of promising a night
 * that will fetch nothing. The value is the Disallow path that matched; the
 * row is removed as soon as a pass gets through, so a merchant who fixes
 * robots.txt sees the sentence go on the next night rather than for ever.
 */
export const ROBOTS_BLOCK_SETTING_KEY = "seo_scan_robots_block";

export async function recordRobotsBlock(
  shopId: string,
  disallow: string | null,
): Promise<void> {
  if (disallow) {
    await db.setting.upsert({
      where: { shopId_key: { shopId, key: ROBOTS_BLOCK_SETTING_KEY } },
      create: { shopId, key: ROBOTS_BLOCK_SETTING_KEY, value: disallow },
      update: { value: disallow },
    });
    return;
  }
  await db.setting.deleteMany({ where: { shopId, key: ROBOTS_BLOCK_SETTING_KEY } });
}

/** What the SEO screen shows: the Disallow that stopped the scan, or null. */
export async function robotsBlock(shopId: string): Promise<string | null> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: ROBOTS_BLOCK_SETTING_KEY } },
  });
  return row?.value ?? null;
}

// --- markets and the sitemap: two per-shop reads, recorded where a screen
// --- can find them ---------------------------------------------------------

/** What the last pass found about this shop's markets. Read by the SEO card. */
export const MARKETS_SETTING_KEY = "seo_markets";

/** Sitemap entries with no product row: withdrawn products still listed. */
export const SITEMAP_STALE_SETTING_KEY = "seo_sitemap_stale";

/**
 * Recorded per shop rather than per row, because it is a fact about the shop.
 *
 * B9 produces no finding at all on a single-market shop, and a check that
 * produces no finding reads as "ran and found nothing" - which would claim a
 * check passed that was never applicable. The card reads this row instead and
 * says "not applicable" (PRD section 2). Same mechanism as `recordRobotsBlock`,
 * and for the same reason: a fact the aggregate cannot derive from the rows.
 */
export async function recordMarkets(shopId: string, markets: MarketsInfo | null): Promise<void> {
  if (!markets) {
    await db.setting.deleteMany({ where: { shopId, key: MARKETS_SETTING_KEY } });
    return;
  }
  const value = JSON.stringify(markets);
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: MARKETS_SETTING_KEY } },
    create: { shopId, key: MARKETS_SETTING_KEY, value },
    update: { value },
  });
}

/** What the SEO card reads to decide whether B9 applies at all. */
export async function marketsInfo(shopId: string): Promise<MarketsInfo | null> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: MARKETS_SETTING_KEY } },
  });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    const count = Number(parsed?.count);
    if (!Number.isFinite(count)) return null;
    return {
      count,
      locales: Array.isArray(parsed?.locales) ? parsed.locales.map(String) : [],
    };
  } catch {
    return null;
  }
}

/**
 * The half of A7 that cannot be a row: handles the sitemap lists that this
 * shop has no product row for.
 *
 * A withdrawn product has no `SeoScan` row - source A deletes rows for
 * products a whole catalogue read did not contain - so there is nothing to
 * attach the finding to. It is a fact about the shop and is stored as one.
 * Capped at 50 so an import that unpublished a thousand products cannot put a
 * thousand handles in a Setting row; the count is kept whole either way, so
 * the card can say "50 of 340 listed".
 */
export const STALE_SITEMAP_CAP = 50;

export type StaleSitemap = { handles: string[]; total: number; at: string };

export async function recordStaleSitemapEntries(
  shopId: string,
  handles: string[] | null,
): Promise<void> {
  if (handles === null) {
    // The sitemap could not be read at all. Deleting is right: a stale list
    // from a week ago presented as tonight's finding is worse than no list.
    await db.setting.deleteMany({ where: { shopId, key: SITEMAP_STALE_SETTING_KEY } });
    return;
  }
  const value = JSON.stringify({
    handles: handles.slice(0, STALE_SITEMAP_CAP),
    total: handles.length,
    at: new Date().toISOString(),
  } satisfies StaleSitemap);
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: SITEMAP_STALE_SETTING_KEY } },
    create: { shopId, key: SITEMAP_STALE_SETTING_KEY, value },
    update: { value },
  });
}

export async function staleSitemapEntries(shopId: string): Promise<StaleSitemap | null> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SITEMAP_STALE_SETTING_KEY } },
  });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed?.handles)) return null;
    return {
      handles: parsed.handles.map(String),
      total: Number(parsed.total) || parsed.handles.length,
      at: String(parsed.at ?? ""),
    };
  } catch {
    return null;
  }
}

/** Every `<loc>` in an XML document, in order. */
export function locsOf(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1].trim());
}

/**
 * The product handles a `/products/<handle>` URL names, from a sitemap URL.
 * Anything else - a page, a collection, a blog - is not this check's business
 * and is skipped rather than counted.
 */
export function productHandleOf(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const match = /^(?:\/[a-z-]{2,10})?\/products\/([^/]+)\/?$/i.exec(path);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * The shop's sitemap: the index, then every product sitemap it names.
 *
 * Shopify splits `sitemap.xml` into an index that points at
 * `sitemap_products_1.xml` and so on, so one fetch is never enough and the
 * number of fetches is the number of sitemaps the shop has - about one per
 * 5,000 products. They are counted against the same daily budget as pages,
 * because they are requests to the same storefront.
 *
 * Returns null on any failure, and A7 then says nothing at all. A sitemap that
 * could not be fetched is not a sitemap that omits every product: on a shop
 * with a storefront password - every development store - the sitemap answers
 * with the password form, and reading that as "no product is listed" would put
 * a finding on the entire catalogue.
 */
export async function fetchSitemap(
  origin: string,
  fetchImpl: typeof fetch,
  options: { maxSitemaps?: number; cookie?: string | null } = {},
): Promise<{ read: SitemapRead | null; fetches: number; error?: string }> {
  const maxSitemaps = options.maxSitemaps ?? 20;
  let fetches = 0;

  const get = async (url: string): Promise<string | null> => {
    fetches += 1;
    try {
      const headers: Record<string, string> = {
        "User-Agent": SCAN_USER_AGENT,
        Accept: "application/xml,text/xml",
      };
      // The same unlock the page reads use, and for the same reason. Without
      // it every sitemap on a password-protected shop answers 200 with the
      // password form, this function correctly refuses to read HTML as XML,
      // and A7 reports nothing at all - on every development store and on
      // every client store still behind a password, which is exactly the
      // period when the operator is looking at the screen. Found 4 September
      // 2026 while writing scripts/read-onpage-checks.ts, which passed the
      // cookie and read 50 product URLs where the pass read none.
      if (options.cookie) headers.Cookie = options.cookie;
      const res = await fetchImpl(url, {
        headers,
        redirect: "follow",
      });
      if (!res.ok) return null;
      const text = await res.text();
      // A password form answers 200 with HTML. An XML document it is not.
      if (!/<(?:urlset|sitemapindex)\b/i.test(text)) return null;
      return text;
    } catch {
      return null;
    }
  };

  const index = await get(`${origin}/sitemap.xml`);
  if (index === null) return { read: null, fetches, error: "sitemap.xml could not be read" };

  const handles = new Set<string>();
  let urls = 0;

  const addFrom = (xml: string) => {
    for (const loc of locsOf(xml)) {
      const handle = productHandleOf(loc);
      if (handle === null) continue;
      urls += 1;
      handles.add(handle);
    }
  };

  // An index lists sitemaps; a urlset lists pages. A small shop's sitemap.xml
  // can be either, so both are handled rather than assumed.
  if (/<sitemapindex\b/i.test(index)) {
    const children = locsOf(index).filter((loc) => /sitemap_products/i.test(loc));
    for (const child of children.slice(0, maxSitemaps)) {
      const xml = await get(child);
      if (xml) addFrom(xml);
    }
    if (children.length > maxSitemaps) {
      return {
        read: null,
        fetches,
        error: `the index lists ${children.length} product sitemaps, more than the ${maxSitemaps} this pass reads`,
      };
    }
  } else {
    addFrom(index);
  }

  return { read: { handles, urls }, fetches };
}

// --- robots.txt ------------------------------------------------------------

export type RobotsGroup = { agents: string[]; allow: string[]; disallow: string[] };

/**
 * robots.txt as groups. Consecutive `User-agent` lines share the rules that
 * follow them, which is the one part of the format that is easy to get wrong
 * and changes the answer: a file that names three agents and then one
 * Disallow means all three are disallowed, not just the last.
 */
export function parseRobots(content: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let collectingAgents = false;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!collectingAgents || !current) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    collectingAgents = false;
    if (field === "disallow") current.disallow.push(value);
    else if (field === "allow") current.allow.push(value);
  }
  return groups;
}

/**
 * The group that applies to us: a group naming this app wins over the `*`
 * group, which is what the standard says and what lets a merchant allow us
 * while blocking everything else.
 */
export function robotsRulesFor(content: string, userAgent = SCAN_USER_AGENT): RobotsGroup {
  const groups = parseRobots(content);
  const agent = userAgent.toLowerCase();
  const named = groups.find((g) =>
    g.agents.some((a) => a !== "" && a !== "*" && agent.includes(a)),
  );
  const wildcard = groups.find((g) => g.agents.includes("*"));
  return named ?? wildcard ?? { agents: [], allow: [], disallow: [] };
}

/** A robots.txt rule is a path prefix, with `*` and a terminating `$`. */
function ruleMatches(pattern: string, path: string): boolean {
  if (pattern === "") return false;
  // `*` is escaped here with everything else and turned into `.*` below. Left
  // unescaped it stays a regex quantifier, and "/*/products/" then matches
  // "/products/" - a rule about one sub-path silently stopping the whole scan.
  let body = pattern.replace(/[.+?^${}()|[\]\\*]/g, "\\$&");
  let anchored = false;
  if (body.endsWith("\\$")) {
    body = body.slice(0, -2);
    anchored = true;
  }
  body = body.replace(/\\\*/g, ".*");
  try {
    return new RegExp("^" + body + (anchored ? "$" : "")).test(path);
  } catch {
    return false;
  }
}

/**
 * The Disallow rule that stops tonight's scan, or null. Longest match wins
 * and Allow wins a tie, the rule every major crawler applies - so a file that
 * disallows everything and then allows `/products/` does not stop us.
 *
 * Asked about the path space rather than about one product: this decides
 * whether the whole scan runs, and a merchant who blocks `/products/` has
 * said no to all of it.
 */
export function productsDisallow(content: string, userAgent = SCAN_USER_AGENT): string | null {
  const rules = robotsRulesFor(content, userAgent);
  const longest = (list: string[]) =>
    list
      .filter((pattern) => ruleMatches(pattern, PRODUCTS_PATH))
      .sort((a, b) => b.length - a.length)[0] ?? null;

  const disallow = longest(rules.disallow);
  if (!disallow) return null;
  const allow = longest(rules.allow);
  if (allow !== null && allow.length >= disallow.length) return null;
  return disallow;
}

/**
 * The Disallow lines Shopify's own robots.txt ships with, as of 4 September
 * 2026, normalised to lower case.
 *
 * This list exists to answer one question and nothing else: is a line in this
 * shop's file one that Shopify put there, or one a person added. It is a
 * snapshot of a generated file that Shopify changes without telling anyone, so
 * a line NOT in this list is reported as "not part of the file Shopify ships
 * as this app knows it" and never as "you edited this". That wording is the
 * whole point: getting it wrong in the other direction sends a merchant
 * looking for an edit they never made.
 */
const SHOPIFY_DEFAULT_DISALLOWS = new Set(
  [
    // Read off a live Shopify storefront on 4 September 2026
    // (mrdigital-dev.myshopify.com), not from memory. The file had changed
    // shape since the forms most references quote: it now carries an Allow
    // block, agent instructions in comments, and rules about UCP endpoints.
    // Reading it was the difference between this check reporting 0 custom
    // lines on a stock store and reporting 15.
    "/admin",
    "/cart",
    "/cart/",
    "/*/cart/",
    "/cart.js",
    "/*/cart.js",
    "/carts",
    "/checkout",
    "/*/checkout",
    "/checkouts/",
    "/*/checkouts/",
    "/orders",
    "/*/orders",
    "/account",
    "/*/account",
    "/services",
    "/sf_*",
    "/recommendations/products",
    "/*/recommendations/products",
    "/collections/*sort_by*",
    "/*/collections/*sort_by*",
    "/collections/*+*",
    "/collections/*%2b*",
    "/collections/*%2B*",
    "/*/collections/*+*",
    "/*/collections/*%2b*",
    "/*/collections/*%2B*",
    "/collections/*filter*&*filter*",
    "/*/collections/*filter*&*filter*",
    "/blogs/*+*",
    "/blogs/*%2b*",
    "/blogs/*%2B*",
    "/*/blogs/*+*",
    "/*/blogs/*%2b*",
    "/*/blogs/*%2B*",
    "/*?*ls=*&ls=*",
    "/*?*ls%3*ls%3*",
    "/*?*oseid=*",
    "/*?*preview_theme_id=*",
    "/*?*preview_script_id=*",
    "/*preview_theme_id*",
    "/*preview_script_id*",
    "/cdn/wpm/*.js",
    // Older forms of the same file, kept so a store on an earlier generation
    // of robots.txt.liquid does not read as edited.
    "/search",
    "/apple-app-site-association",
    "/.well-known/shopify/monitoring",
    "/.well-known/shopify/data-sales-opt-out",
    "/policies/",
    "/*/policies/",
    "/*/*.atom?*",
  ].map((line) => line.toLowerCase()),
);

/**
 * Shopify also disallows the store's own numeric id as a path. It is
 * generated, not typed, and matching it by value is impossible - so it is
 * matched by shape. A path that is nothing but digits is Shopify's.
 */
const SHOPIFY_NUMERIC_PATH = /^\/\d+$/;

function isShopifyDefault(line: string): boolean {
  return SHOPIFY_DEFAULT_DISALLOWS.has(line.toLowerCase()) || SHOPIFY_NUMERIC_PATH.test(line);
}

/** The two path spaces B23 is asked about by name (PRD section 5a). */
const REVIEWED_PATHS = ["/products/", "/collections/"];

export type RobotsReview = {
  fetched: boolean;
  /** Lines this app recognises as Shopify's own. */
  defaults: string[];
  /** Lines it does not recognise, which is not the same as "the merchant's". */
  custom: string[];
  /** Path spaces a Disallow covers, with the rule that covers them. */
  blocking: { path: string; rule: string }[];
};

/**
 * B23: what this shop's robots.txt says.
 *
 * Reported, never acted on. Shopify calls editing `robots.txt.liquid` an
 * unsupported customisation that "can result in loss of all traffic", so a
 * merchant who touched it should be able to see what they did without opening
 * the theme editor. The default lines are listed apart from the rest because a
 * file full of Shopify's own disallows is not a file anybody edited, and
 * reporting forty lines as findings would teach a reader to skip the row.
 *
 * The finding fires on two things only: a line this app does not recognise, or
 * a Disallow covering `/products/` or `/collections/`. A stock file produces
 * nothing at all, which is the correct reading of an untouched theme.
 */
export function reviewRobots(read: RobotsRead, userAgent = SCAN_USER_AGENT): RobotsReview {
  if (!read.fetched) return { fetched: false, defaults: [], custom: [], blocking: [] };
  const rules = robotsRulesFor(read.content, userAgent);
  const defaults: string[] = [];
  const custom: string[] = [];
  for (const line of rules.disallow) {
    if (line === "") continue; // "Disallow:" with no value allows everything.
    if (isShopifyDefault(line)) defaults.push(line);
    else custom.push(line);
  }

  const blocking: { path: string; rule: string }[] = [];
  for (const path of REVIEWED_PATHS) {
    const longest = (list: string[]) =>
      list.filter((pattern) => ruleMatches(pattern, path)).sort((a, b) => b.length - a.length)[0] ??
      null;
    const disallow = longest(rules.disallow);
    if (!disallow) continue;
    const allow = longest(rules.allow);
    // The same precedence productsDisallow applies: longest match wins, and
    // Allow wins a tie. A file that disallows everything and then allows
    // /products/ is not blocking /products/.
    if (allow !== null && allow.length >= disallow.length) continue;
    blocking.push({ path, rule: disallow });
  }

  return { fetched: true, defaults, custom, blocking };
}

/** B23 as a finding, or null when the file is stock and blocks nothing. */
export function checkRobotsReview(review: RobotsReview | null): Finding | null {
  if (!review || !review.fetched) return null;
  if (review.custom.length === 0 && review.blocking.length === 0) return null;
  return {
    code: "B23",
    source: "B",
    detail: {
      custom: review.custom,
      defaults: review.defaults.length,
      blocking: review.blocking,
    },
  };
}

export type RobotsRead = { fetched: boolean; content: string };

/** Never throws: an unreachable robots.txt is not a permission to be blocked by. */
export async function fetchRobots(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RobotsRead> {
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, {
      headers: { "User-Agent": SCAN_USER_AGENT },
    });
    if (!res.ok) return { fetched: false, content: "" };
    return { fetched: true, content: await res.text() };
  } catch {
    return { fetched: false, content: "" };
  }
}

// --- one page --------------------------------------------------------------

export type PageRead = {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  cacheControl: string | null;
  age: string | null;
  xRobotsTag: string | null;
  passwordProtected: boolean;
  /**
   * Every address the request passed through, first to last, with the status
   * each answered. One entry means the page answered directly. Check B19 reads
   * this; nothing else does.
   */
  chain: Hop[];
  /** Set when the request itself failed; then nothing else here is meaningful. */
  error?: string;
};

/**
 * How many redirects are followed before the chain is called a chain and
 * abandoned. Five is well past anything a working store produces, and stopping
 * matters more than finishing: a loop is a finding, not a reason to spend the
 * night on one product.
 */
export const MAX_REDIRECT_HOPS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The same test scanPage makes: a password form and no structured data. */
export function isPasswordPage(html: string): boolean {
  return /name=["']password["']/i.test(html) && !/ld\+json/i.test(html);
}

/**
 * One product page, fetched as a plain client. `cookie` is the storefront
 * unlock from storefrontCookie, obtained once per shop rather than once per
 * page - 500 unlock requests a night would be a worse citizen than the scan
 * itself.
 */
export async function readProductPage(
  url: string,
  cookie: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<PageRead> {
  const headers: Record<string, string> = {
    "User-Agent": SCAN_USER_AGENT,
    Accept: "text/html",
    // Ask for what a crawler arriving now would get. Our own proxy answers
    // with max-age=300 and Shopify's edge caches as well; what actually came
    // back is recorded either way (rule 4).
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
  if (cookie) headers.Cookie = cookie;

  // Followed by hand rather than with `redirect: "follow"`, and this costs no
  // extra request: following a chain is the same sequence of HTTP calls either
  // way. What changes is that the chain is visible, which is the whole of check
  // B19 - "follow" hands back only where it ended up, so a two-hop chain and a
  // one-hop one were indistinguishable.
  const chain: Hop[] = [];
  let current = url;
  const visited = new Set<string>();

  try {
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      const res = await fetchImpl(current, { headers, redirect: "manual" });
      chain.push({ url: current, status: res.status });

      const location = res.headers.get("location");
      const isRedirect = REDIRECT_STATUSES.has(res.status) && location;
      // A loop is recorded and then stopped: the address is already in the
      // chain, so B19 can name the circle, and following it again would be
      // spending requests to learn what the chain already says.
      if (isRedirect && !visited.has(current) && hop < MAX_REDIRECT_HOPS) {
        visited.add(current);
        let next: string;
        try {
          next = new URL(location, current).href;
        } catch {
          next = location;
        }
        if (visited.has(next)) {
          chain.push({ url: next, status: res.status });
          // Fall through to reading this response's body: there is nothing
          // else to fetch, and the status recorded is the redirect's.
        } else {
          current = next;
          continue;
        }
      }

      const html = await res.text();
      return {
        url,
        finalUrl: res.url || current,
        status: res.status,
        html,
        cacheControl: res.headers.get("cache-control"),
        age: res.headers.get("age"),
        xRobotsTag: res.headers.get("x-robots-tag"),
        passwordProtected: isPasswordPage(html),
        chain,
      };
    }

    // More hops than MAX_REDIRECT_HOPS. Reported as a chain, not as an error:
    // the addresses are known and B19 states them.
    return {
      url,
      finalUrl: current,
      status: chain[chain.length - 1]?.status ?? 0,
      html: "",
      cacheControl: null,
      age: null,
      xRobotsTag: null,
      passwordProtected: false,
      chain,
      error: `more than ${MAX_REDIRECT_HOPS} redirects`,
    };
  } catch (error) {
    return {
      url,
      finalUrl: current,
      status: 0,
      html: "",
      cacheControl: null,
      age: null,
      xRobotsTag: null,
      passwordProtected: false,
      chain,
      error: describeError(error),
    };
  }
}

/**
 * One internal link, asked only whether it answers. HEAD first, because that
 * is what the question needs and it is the cheaper request for the merchant's
 * own storefront; a server that refuses HEAD (405, or 501) is asked again with
 * GET, because "this server does not do HEAD" is not "this link is broken".
 */
export async function checkOneLink(
  url: string,
  cookie: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkResult> {
  const headers: Record<string, string> = { "User-Agent": SCAN_USER_AGENT };
  if (cookie) headers.Cookie = cookie;
  try {
    const head = await fetchImpl(url, { method: "HEAD", headers, redirect: "follow" });
    if (head.status !== 405 && head.status !== 501) return { url, status: head.status };
    const get = await fetchImpl(url, { method: "GET", headers, redirect: "follow" });
    return { url, status: get.status };
  } catch {
    // Zero, never a 5xx: the request could not be made, which is a different
    // thing from a server answering badly, and B16 prints them differently.
    return { url, status: 0 };
  }
}

function typesOf(node: any): string[] {
  const t = node?.["@type"];
  if (!t) return [];
  return Array.isArray(t) ? t.map(String) : [String(t)];
}

/**
 * What the page's own Product node states about the offer, for check A2.
 * The first offer that states anything is taken: the comparison in
 * checkOfferConsistency is against the whole min-max interval, so a page that
 * correctly states one variant's price out of several still passes.
 */
export function extractSchemaOffer(html: string): SchemaOffer | null {
  for (const node of extractLdObjects(html)) {
    if (!typesOf(node).includes("Product")) continue;
    const offers = node?.offers;
    const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
    for (const offer of list) {
      const availability = offer?.availability != null ? String(offer.availability) : null;
      const raw = offer?.price ?? offer?.lowPrice ?? offer?.priceSpecification?.price;
      const price = raw != null ? String(raw) : null;
      if (availability !== null || price !== null) return { availability, price };
    }
  }
  return null;
}

// --- B8, B9 and A7: the three checks added by PRD section 2 -----------------

/**
 * What a pass knows that one page does not, handed to `readingOf` so the three
 * checks below stay pure functions over a string of HTML plus a value.
 *
 * All three are per-pass reads: one `markets` Admin query, one fetch of the
 * sitemap index and the sitemaps it names. None of them costs anything per
 * product, which is the only reason they can sit inside a loop that already
 * has a 500-page budget.
 */
export type PageContext = {
  /** The product's handle, so B8 knows the address the canonical should carry. */
  handle: string | null;
  /** Null when the markets query was not made or failed: B9 then says nothing. */
  markets: MarketsInfo | null;
  /** Null when the sitemap could not be read: A7 then says nothing. */
  sitemap: SitemapRead | null;
  /**
   * B23. The one robots.txt read this pass already made, reviewed. Null when
   * the file could not be fetched, and the row then says nothing at all rather
   * than reporting an empty file as a clean one.
   */
  robots?: RobotsReview | null;
  /**
   * B21. Title tag to handles, built once per pass from what is stored on the
   * shop's other rows. Null means the comparison was not made - on a single
   * page read from the product editor, for instance - and B21 is then silent.
   */
  titlesByKey?: Map<string, string[]> | null;
  /**
   * B16. What the link fetches answered, and how many of the page's links they
   * covered. Null means no link was fetched, and B16 says nothing: "not
   * checked" is never rendered as "nothing broken".
   */
  links?: { results: LinkResult[]; plan: LinkPlan; checked: number } | null;
};

export type MarketsInfo = {
  /** How many enabled markets the shop has. One means B9 is not applicable. */
  count: number;
  /** Every locale across those markets, lower-cased, deduplicated, sorted. */
  locales: string[];
};

export type SitemapRead = {
  /** Product handles listed anywhere in the shop's product sitemaps. */
  handles: Set<string>;
  /** How many product URLs were parsed, for the row's method line. */
  urls: number;
};

/**
 * B8: the shape of the canonical, which is a different question from B2.
 *
 * B2 asks whether the canonical is this page's own address. B8 asks whether it
 * is the plain product URL, and names which of the two Shopify-specific wrong
 * shapes it is:
 *
 *  - a variant URL (`?variant=`), which splits one product across as many
 *    addresses as it has variants;
 *  - a collection-prefixed URL (`/collections/x/products/y`), which Shopify's
 *    own `within` filter produces for every product in every collection. The
 *    canonical is theme-owned and not automatic, so a theme that echoes the
 *    request path gives every product one canonical per collection it is in.
 *    Section 5a of the PRD listed this as a separate case; it is this check.
 *
 * Absent is not this check's business - B2 already has a sentence for it, and
 * two rows saying "no canonical" is a reader deciding which to believe.
 */
export function checkCanonicalShape(
  canonical: string | null,
  handle: string | null,
  pageUrl: string,
): Finding | null {
  if (canonical === null || handle === null || handle === "") return null;

  let url: URL;
  try {
    url = new URL(canonical, pageUrl);
  } catch {
    // Unparseable: reported as it stands rather than guessed at.
    return {
      code: "B8",
      source: "B",
      detail: { canonical, shouldBe: `${PRODUCTS_PATH}${handle}`, reason: "unparseable" },
    };
  }

  const expected = `${PRODUCTS_PATH}${handle}`;
  const path = url.pathname.replace(/\/$/, "");
  const hasVariant = url.searchParams.has("variant");
  const collectionPrefixed = /^\/collections\/[^/]+\/products\//.test(path);

  if (path === expected && !hasVariant) return null;

  const reason = hasVariant
    ? "variant"
    : collectionPrefixed
      ? "collection"
      : "other";

  return {
    code: "B8",
    source: "B",
    detail: {
      // As fetched, not as resolved: the row shows the merchant what is in
      // their page, and a resolved absolute URL is not what they will find
      // when they open the source.
      canonical,
      resolved: url.href,
      shouldBe: expected,
      reason,
      ...(reason === "collection"
        ? {
            note: "Shopify's `within` filter gives every product in a collection a second URL of this shape.",
          }
        : {}),
    },
  };
}

/** `hreflang` values the page declares, lower-cased. */
export function extractHreflangs(html: string): string[] {
  const out = new Set<string>();
  // Every link element on the page; the two tests below are what narrow it to
  // an alternate with an hreflang, so the tag match itself stays loose.
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    const lang = /hreflang\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (lang) out.add(lang[1].trim().toLowerCase());
  }
  return [...out].sort();
}

/**
 * B9: hreflang on a shop with more than one market.
 *
 * Narrowed by the research of 4 September (PRD section 5a): Shopify Markets
 * adds hreflang and canonical automatically through `content_for_header`
 * unless the merchant turned it off. So an absent set of links is a platform
 * setting, not a broken theme, and the row says exactly that - a sentence
 * accusing the theme would send a merchant to edit Liquid for a checkbox.
 *
 * A single-market shop produces no finding at all. It also must not read as
 * "clean", which would claim a check ran and passed; the pass records the
 * market count per shop and the card reads "not applicable" from it.
 */
export function checkHreflang(html: string, markets: MarketsInfo | null): Finding | null {
  if (!markets) return null;
  if (markets.count <= 1) return null;

  const present = extractHreflangs(html);
  if (present.length === 0) {
    return {
      code: "B9",
      source: "B",
      detail: {
        markets: markets.count,
        locales: markets.locales,
        present: [],
        missing: markets.locales,
        cause: "platform_setting",
      },
    };
  }

  // Present but not for every locale. Still the platform's doing, so the
  // sentence does not change - only the list does.
  const missing = markets.locales.filter((locale) => !present.includes(locale));
  if (missing.length === 0) return null;

  return {
    code: "B9",
    source: "B",
    detail: {
      markets: markets.count,
      locales: markets.locales,
      present,
      missing,
      cause: "platform_setting",
    },
  };
}

/**
 * A7: this product is not in the shop's sitemap.
 *
 * Report only. Shopify owns `sitemap.xml`, regenerates it on content changes
 * and offers no way to edit it, so the row can say "absent" and nothing else;
 * the fix is always a product setting (published, in a sales channel), never a
 * file. That is the whole finding, and PRD section 5a says so.
 *
 * `source: "A+B"` and not `"A"`, and the reason is the ownership rule: this is
 * computed in source B's pass, from a fetch source A never makes, so source A
 * must not own it or the next catalogue pass would erase a value it cannot
 * recompute. Same reasoning as A2.
 *
 * The other half of the check - a withdrawn product still listed - cannot be a
 * row, because a withdrawn product has no row: source A deletes rows for
 * products a whole read did not contain. It is recorded per shop instead, by
 * `recordStaleSitemapEntries`, and the card states it under this row.
 */
export function checkSitemap(handle: string | null, sitemap: SitemapRead | null): Finding | null {
  if (!sitemap || handle === null || handle === "") return null;
  if (sitemap.handles.has(handle)) return null;
  return {
    code: "A7",
    source: "A+B",
    detail: {
      handle,
      urlsInSitemap: sitemap.urls,
      fix: "product_setting",
    },
  };
}

/** Everything source B writes onto one row, plus what only the report wants. */
export type PageRow = {
  status: string;
  nodes: LdNode[];
  canonical: string | null;
  noindex: boolean | null;
  appBlock: string | null;
  cacheControl: string | null;
  age: string | null;
  findings: Finding[];
  /**
   * The page's title tag, for the SeoScan column B21 compares against on later
   * nights. Null when the page carries no title tag or could not be read.
   */
  pageTitle: string | null;
};

/**
 * B7: the same structured-data node appearing on the page more than once.
 *
 * Distinct from B1, and the distinction is the whole point. B1 canonicalises
 * every `@id` against the page before counting, so two nodes that resolve to
 * one address merge into one - which is exactly what extend mode is for, and
 * is why B1 is silent when the theme emits a Product node and we extend it by
 * reusing its address. That merge also means **no existing check could ever
 * see our own output rendered twice**, and CLAUDE.md's rule is that we never
 * produce a second complete Product node.
 *
 * So this one compares **raw** `@id` strings and never canonicalises. Two
 * nodes carrying a byte-identical `@id` and the same type are the same block
 * emitted twice; a theme's relative `/products/x#product` beside our absolute
 * `https://shop/products/x#product` are two different strings and are not a
 * finding here, correctly. Verified against the dev store on 4 September 2026,
 * where that is precisely the pair on the page.
 *
 * `ours` says the duplicated node carries our emitter marker, so we emitted it.
 * A node without the marker is the theme's, and the finding is then phrased
 * about the page repeating a node rather than about our output.
 */
export function duplicateNodes(nodes: LdNode[]): {
  type: string;
  count: number;
  ours: boolean;
}[] {
  const seen = new Map<string, { type: string; count: number; ours: boolean }>();
  for (const node of nodes) {
    const id = typeof node.id === "string" ? node.id : "";
    if (id === "") continue; // No id, nothing to be identical to.
    for (const type of node.types) {
      // JSON, not a separator character: a URL may legally contain almost
      // anything, and a key that can collide would merge two different nodes.
      const key = JSON.stringify([id, type]);
      const entry = seen.get(key);
      if (entry) entry.count += 1;
      else seen.set(key, { type, count: 1, ours: isOurNode(node) });
    }
  }
  return [...seen.values()].filter((entry) => entry.count > 1);
}

function sameAddress(a: string, b: string): boolean {
  const strip = (value: string) => value.split("#")[0].replace(/\/$/, "");
  return strip(a) === strip(b);
}

/**
 * The checks, given a page that has been read. Pure: no fetch, no database,
 * so every row below can be asserted on from a string of HTML.
 */
export function readingOf(
  page: PageRead,
  offer: OfferFacts | null,
  context: PageContext = { handle: null, markets: null, sitemap: null },
): PageRow {
  const base = {
    nodes: [] as LdNode[],
    canonical: null,
    noindex: null,
    appBlock: null,
    cacheControl: page.cacheControl,
    age: page.age,
    pageTitle: null,
  };

  // B19 is asked before every other branch, and this is the reason: a redirect
  // loop never reaches a 200, so a chain check that ran only on a page that
  // answered would be silent on exactly the case it exists for. B5 says the
  // page could not be read; B19 says why, with the addresses.
  const b19 = checkRedirectChain(page.chain ?? []);

  if (page.error) {
    return {
      ...base,
      status: "error",
      findings: [
        { code: "B5", source: "B", detail: { reason: "unreachable", error: page.error } },
        ...(b19 ? [b19] : []),
      ],
    };
  }

  // Rule 2. A password wall says nothing about the theme, the structured data
  // or the app block, so it produces no finding at all - only a status the
  // aggregate reads as "could not be read".
  if (page.passwordProtected) {
    return { ...base, status: "password", appBlock: "unreadable", findings: [] };
  }

  if (page.status !== 200) {
    return {
      ...base,
      status: String(page.status),
      appBlock: "unreadable",
      findings: [
        {
          code: "B5",
          source: "B",
          detail: {
            reason: "status",
            status: page.status,
            url: page.url,
            finalUrl: page.finalUrl,
          },
        },
        ...(b19 ? [b19] : []),
      ],
    };
  }

  const findings: Finding[] = [];
  const nodes = extractLdNodes(page.html);

  // B1: how many distinct Product nodes this page carries, and who emitted
  // them. Extend mode deliberately reuses the theme's @id, so two nodes that
  // resolve to one address are one node - the whole reason extend mode exists.
  const productNodes = nodes.filter((n) => n.types.includes("Product"));
  const ids = new Set<string>();
  let idless = 0;
  for (const node of productNodes) {
    const canonical = canonicalNodeId(node.id, page.finalUrl);
    if (canonical === null) idless += 1;
    else ids.add(canonical);
  }
  const distinct = ids.size + idless;
  const ours = productNodes.some((n) => isOurNode(n));
  const emitters = [
    ...(productNodes.some((n) => !isOurNode(n)) ? ["theme"] : []),
    ...(ours ? ["app"] : []),
  ];
  if (distinct !== 1) {
    findings.push({
      code: "B1",
      source: "B",
      detail: { productNodes: distinct, emitters, ids: [...ids] },
    });
  }

  // B7, over every node type and not only Product: the same node twice on one
  // page. Raised from the raw ids, so B1's merge cannot hide it.
  const duplicates = duplicateNodes(nodes);
  if (duplicates.length > 0) {
    findings.push({
      code: "B7",
      source: "B",
      detail: {
        duplicates: duplicates.map((d) => ({ type: d.type, count: d.count, ours: d.ours })),
        ours: duplicates.some((d) => d.ours),
      },
    });
  }

  // B2: the canonical this page declares. Absent is a finding of its own -
  // "none" and "points elsewhere" are different sentences.
  const canonical = extractCanonical(page.html);
  if (canonical === null) {
    findings.push({ code: "B2", source: "B", detail: { canonical: null, page: page.finalUrl } });
  } else {
    let resolved = canonical;
    try {
      resolved = new URL(canonical, page.finalUrl).href;
    } catch {
      // Left as written: an unparseable canonical is reported as it stands.
    }
    if (!sameAddress(resolved, page.finalUrl)) {
      findings.push({
        code: "B2",
        source: "B",
        detail: { canonical: resolved, page: page.finalUrl },
      });
    }
  }

  // B3: noindex, from the meta tag or the header. The most damaging thing a
  // page can say, so both places are read.
  const metaNoindex = extractNoindex(page.html);
  const headerNoindex = /noindex/i.test(page.xRobotsTag ?? "");
  const noindex = metaNoindex || headerNoindex;
  if (noindex) {
    findings.push({
      code: "B3",
      source: "B",
      detail: { from: metaNoindex && headerNoindex ? "both" : metaNoindex ? "meta" : "header" },
    });
  }

  // B4: our block on this page, per product rather than per theme. Two
  // signals, because in extend mode with nothing to add the block emits no
  // node of its own and only the discovery link is left.
  const mirrorLink = page.html.includes("/apps/ai-visibility/");
  const appBlock = ours || mirrorLink ? "present" : "absent";
  if (appBlock === "absent") {
    findings.push({
      code: "B4",
      source: "B",
      detail: { signals: { ourProductNode: ours, mirrorLink } },
    });
  }

  // B5 on a page that answered 200: it answered from somewhere else. A
  // product URL that redirects is a finding about the URL, not about a
  // failure, which is why it is separate from the status branch above.
  if (!sameAddress(page.finalUrl, page.url)) {
    findings.push({
      code: "B5",
      source: "B",
      detail: { reason: "redirect", from: page.url, to: page.finalUrl, status: page.status },
    });
  }

  // B8: the shape of the canonical, which B2 does not ask. Both can fire on
  // one page and they say different things - B2 that it is not this page's
  // address, B8 that it is not the plain product URL - so neither subsumes the
  // other and the merchant sees the address in each sentence.
  const b8 = checkCanonicalShape(canonical, context.handle, page.finalUrl);
  if (b8) findings.push(b8);

  // B9: hreflang, from the one markets query this pass made. Silent on a
  // single-market shop, and silent when the query was not made at all.
  const b9 = checkHreflang(page.html, context.markets);
  if (b9) findings.push(b9);

  // A7: in the shop's sitemap or not. Silent when the sitemap could not be
  // read, which is every shop behind a storefront password.
  const a7 = checkSitemap(context.handle, context.sitemap);
  if (a7) findings.push(a7);

  // A2: the page's offer against what the variants said on the last catalogue
  // pass. Returns null when either half is missing - "not yet read" is not
  // "they agree".
  const a2 = offer ? checkOfferConsistency(offer, extractSchemaOffer(page.html)) : null;
  if (a2) findings.push(a2);

  // B10 to B24 (PRD-SEO-FULL-ONPAGE sections 3 and 5a). Every one is a pure
  // function over this page's HTML, and every one is pushed in code order so
  // the row's findings read the same way twice. Three of them need something a
  // single page does not have, and each returns null rather than guessing when
  // the caller did not supply it: B16 the results of the link fetches, B21 the
  // other pages' titles, B23 the shop's robots.txt.
  const pageTitle = extractTitleTag(page.html);

  const onPage: (Finding | null)[] = [
    checkTitleTag(page.html),
    checkMetaDescription(page.html),
    checkH1(page.html),
    checkOpenGraph(page.html),
    checkTwitterCard(page.html),
    checkPageAltText(page.html),
    context.links
      ? checkInternalLinks(context.links.results, context.links.plan, context.links.checked)
      : null,
    thinContentOf(page.html),
    checkHandle(context.handle),
    b19,
    checkMixedContent(page.html, page.finalUrl),
    context.titlesByKey ? checkDuplicateTitle(pageTitle, context.handle, context.titlesByKey) : null,
    checkDeprecatedNodes(nodes),
    checkRobotsReview(context.robots ?? null),
    checkMetaKeywords(page.html),
  ];
  for (const finding of onPage) if (finding) findings.push(finding);

  return {
    status: "ok",
    nodes,
    canonical,
    noindex,
    appBlock,
    cacheControl: page.cacheControl,
    age: page.age,
    findings,
    pageTitle,
  };
}

/**
 * B17, with the description taken off the page rather than out of the
 * catalogue: this is the source B row, and what the merchant's admin holds is
 * not necessarily what the theme rendered.
 */
function thinContentOf(html: string): Finding | null {
  let ldDescription: string | null = null;
  for (const node of extractLdObjects(html)) {
    const types = node?.["@type"];
    const list = Array.isArray(types) ? types.map(String) : types ? [String(types)] : [];
    if (!list.includes("Product")) continue;
    if (typeof node?.description === "string" && node.description.trim() !== "") {
      ldDescription = node.description;
      break;
    }
  }
  const { text, source } = pageDescription(html, ldDescription);
  return checkThinContent(html, text, source);
}

// --- the nightly pass ------------------------------------------------------

export type SourceBReport = {
  budget: number;
  /** Pages fetched tonight, including the ones that answered password or an error. */
  scanned: number;
  /** Of those, pages that answered with the password form: read nothing. */
  password: number;
  /** Of those, pages the request could not reach at all. */
  failed: number;
  /** Pages still waiting: never scanned, or last scanned before tonight. */
  remaining: number;
  /** ceil(remaining / budget). Zero when robots.txt stopped the scan. */
  nightsToFinish: number;
  byCode: Record<string, number>;
  /**
   * Why the pass ended, and the three states are never conflated.
   *
   * `no_catalogue` - there is not one SeoScan row for this shop, so the
   *   catalogue has never been read and there is nothing to scan yet. This used
   *   to report as `catalogue` with zero of everything, which reads as
   *   "finished" when nothing started - the same class as the "0 of 50" bug in
   *   CLAUDE.md, and fixed on 4 September 2026.
   * `up_to_date` - rows exist and every one of them was scanned this pass or
   *   later. Genuinely finished.
   * `budget` - stopped early with pages still waiting.
   * `robots` - the shop's own robots.txt turned the scan away.
   */
  stopped: "budget" | "up_to_date" | "no_catalogue" | "robots";
  /** Rows this shop has at all. Zero is what `no_catalogue` is read from. */
  rows: number;
  /** Set when robots.txt stopped the scan; it is itself finding B5. */
  robots?: Finding;
  /** How many answered from a cache (an Age header above zero). */
  fromCache: number;
  /**
   * What the pass learned about the shop, once, for the three checks PRD
   * section 2 added. Each says plainly when it could not be established, so
   * the JobRun never leaves a reader to guess whether a check ran.
   */
  markets?: { count: number; locales: string[] } | null;
  sitemap?: {
    read: boolean;
    /** Product URLs found across the shop's product sitemaps. */
    urls?: number;
    /** Sitemap fetches this pass spent, counted against the same budget. */
    fetches: number;
    /** Handles listed with no product row: withdrawn products still in the file. */
    stale?: number;
    error?: string;
  };
  /**
   * B16's spend. Link fetches come out of the same daily budget as the pages
   * (PRD section 3), so a night that read 480 pages and 20 links spent 500 -
   * and the report says which was which rather than leaving a reader to
   * wonder why 480 pages exhausted a 500-page allowance.
   */
  links?: {
    /** Distinct link addresses fetched tonight, across every page. */
    fetched: number;
    /** Pages whose links were checked at all. */
    pages: number;
    /** Pages that carried more links than the per-page cap. */
    capped: number;
  };
};

export type ScanDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (message: string) => void;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One title into B21's map. Silent on a null title or a null handle: a page
 * that has never been read has nothing to compare and must not become a
 * duplicate of every other unread page.
 */
function addTitle(
  map: Map<string, string[]>,
  title: string | null,
  handle: string | null,
): void {
  if (!title || title.trim() === "" || !handle) return;
  const key = titleKey(title);
  const list = map.get(key);
  if (!list) map.set(key, [handle]);
  else if (!list.includes(handle)) list.push(handle);
}

/** The columns tonight's pass reads back before it writes. */
type Candidate = {
  id: string;
  productId: string;
  handle: string | null;
  offer: unknown;
  findings: unknown;
};

/**
 * Tonight's pages for one shop.
 *
 * The order is the cursor: never scanned first, then oldest first. Postgres
 * sorts NULLs last on ASC, so `nulls: "first"` is not decoration - without it
 * a store would rescan the same pages for ever and never reach the ones it
 * has never read.
 */
export async function scanShopPages(input: {
  shopId: string;
  origin: string;
  password?: string | null;
  budget: number;
  /**
   * From the one `markets` Admin query the caller makes per pass. Null when it
   * was not made or failed, and B9 is then silent rather than guessed at - the
   * caller owns the Admin API, this module owns the storefront.
   */
  markets?: MarketsInfo | null;
  deps?: ScanDeps;
}): Promise<SourceBReport> {
  const { shopId, origin, budget } = input;
  const fetchImpl = input.deps?.fetchImpl ?? fetch;
  const sleep = input.deps?.sleep ?? realSleep;
  const now = input.deps?.now ?? (() => new Date());
  const log = input.deps?.log;
  const startedAt = now();

  const report: SourceBReport = {
    budget,
    scanned: 0,
    password: 0,
    failed: 0,
    remaining: 0,
    nightsToFinish: 0,
    byCode: {},
    stopped: "up_to_date",
    rows: 0,
    fromCache: 0,
  };

  const waiting = () =>
    db.seoScan.count({
      where: {
        shopId,
        handle: { not: null },
        OR: [{ scannedAt: null }, { scannedAt: { lt: startedAt } }],
      },
    });

  // Counted before anything else, because "nothing to scan" and "nothing left
  // to scan" are different sentences and only this number tells them apart.
  report.rows = await db.seoScan.count({ where: { shopId } });

  const robots = await fetchRobots(origin, fetchImpl);
  const blocked = robots.fetched ? productsDisallow(robots.content) : null;
  // Recorded where a screen can read it, in both directions. The B5 finding
  // below goes into the JobRun report, which nothing renders, so before this
  // a shop whose robots.txt turns the scan away saw every page row read
  // "Waiting for the nightly page read" and the card promise "starting
  // tonight" - for a night that had already decided to fetch nothing. The
  // acceptance row in PRD section 5 says the Disallow "is reported as B5";
  // reported into a log is not reported. QA of 3 September 2026.
  await recordRobotsBlock(shopId, blocked);
  if (blocked) {
    report.stopped = "robots";
    report.robots = {
      code: "B5",
      source: "B",
      detail: {
        reason: "robots",
        disallow: blocked,
        userAgent: SCAN_USER_AGENT,
        path: PRODUCTS_PATH,
      },
    };
    report.remaining = await waiting();
    log?.(`seo_scan ${origin}: robots.txt disallows ${blocked}, no page was fetched`);
    return report;
  }

  const cookie = await unlockQuietly(origin, input.password, fetchImpl, log);

  // The two per-pass reads, before any page. Both are recorded per shop as
  // well as reported, because the card needs them on a request that fetches
  // nothing: B9's "not applicable" cannot be derived from the rows, and A7's
  // stale half has no row to sit on.
  const markets = input.markets ?? null;
  await recordMarkets(shopId, markets);
  report.markets = markets;

  // What is left of today's allowance, read before anything is fetched, because
  // the sitemap is charged to it like any other request.
  const spentAlready = (await pageBudget(shopId, startedAt)).spent;
  const allowanceBeforeSitemap = Math.max(0, budget - spentAlready);

  // Not fetched at all in two cases, and both are promises this pass makes
  // elsewhere. With no rows there is nothing to check a sitemap against and
  // the stale half would name every URL in the file. With no allowance left,
  // the pass asks the storefront for nothing at all - which is the whole point
  // of a budget a merchant's clicks share.
  const sitemap =
    report.rows === 0 || allowanceBeforeSitemap === 0
      ? {
          read: null,
          fetches: 0,
          error: report.rows === 0 ? "no products have been read yet" : "no allowance left today",
        }
      : await fetchSitemap(origin, fetchImpl, { cookie });
  // The sitemap costs storefront requests like any page, so it is charged to
  // the same daily budget rather than being quietly free.
  if (sitemap.fetches > 0) await spendPages(shopId, sitemap.fetches, startedAt);
  report.sitemap = { read: sitemap.read !== null, fetches: sitemap.fetches };
  if (sitemap.read) {
    report.sitemap.urls = sitemap.read.urls;
    // A7's other half: handles the file lists that this shop has no row for.
    // Computed from the handles source A wrote, so it names exactly the
    // products the catalogue read no longer contains.
    const rows = await db.seoScan.findMany({
      where: { shopId, handle: { not: null } },
      select: { handle: true },
    });
    const known = new Set(rows.map((r: { handle: string | null }) => r.handle));
    const stale = [...sitemap.read.handles].filter((handle) => !known.has(handle)).sort();
    await recordStaleSitemapEntries(shopId, stale);
    report.sitemap.stale = stale.length;
  } else {
    report.sitemap.error = sitemap.error;
    await recordStaleSitemapEntries(shopId, null);
    log?.(`seo_scan ${origin}: ${sitemap.error}, so nothing is reported about the sitemap`);
  }

  // What is left for pages, not the whole budget: the product editor's "Read
  // this page now" button spends from the same allowance (PRD section 4), and
  // a nightly pass that ignored that would let a shop fetch more pages in a
  // day than its operator set. The sitemap fetches above come out of the same
  // number, so a 500-page budget reads 499 pages on a shop with one product
  // sitemap - understating what this app asks of a storefront would make the
  // budget a figure rather than a limit.
  const allowance = Math.max(0, allowanceBeforeSitemap - sitemap.fetches);

  // B23: the robots.txt this pass already fetched, reviewed once and written
  // onto every page row. Not a second request.
  const robotsReview = reviewRobots(robots);

  // B21: every title tag this shop has stored, by its comparison key. Read
  // once, before the loop, because the pages that share a title were read on
  // other nights - 500 a night means a large catalogue spreads one comparison
  // over many of them. Rows read tonight are folded into the same map as they
  // are read, so two products scanned in the same pass see each other too.
  //
  // Not read at all when there is no allowance left: a pass that will fetch
  // nothing asks the database nothing either, which is the same promise the
  // sitemap fetch above keeps.
  const titlesByKey = new Map<string, string[]>();
  if (allowance > 0) {
    for (const stored of await db.seoScan.findMany({
      where: { shopId, handle: { not: null }, pageTitle: { not: null } },
      select: { handle: true, pageTitle: true },
    })) {
      addTitle(titlesByKey, stored.pageTitle, stored.handle);
    }
  }

  const candidates: Candidate[] =
    allowance === 0
      ? []
      : await db.seoScan.findMany({
          where: { shopId, handle: { not: null } },
          orderBy: [{ scannedAt: { sort: "asc", nulls: "first" } }, { productId: "asc" }],
          take: allowance,
          select: { id: true, productId: true, handle: true, offer: true, findings: true },
        });

  // What is left of tonight's allowance, decremented by every request this
  // loop makes - pages and B16's links alike. `candidates` was taken at
  // `allowance` on the assumption that every request is a page; link checks
  // spend from the same number, so a night that checks links reads fewer
  // pages, and the pass stops when this reaches zero rather than when the
  // candidate list runs out. Without this the budget would be a figure about
  // pages rather than a limit on what this app asks of a storefront.
  let left = allowance;
  const linkCache = new Map<string, number>();
  const linkSpend = { fetched: 0, pages: 0, capped: 0 };

  let first = true;
  for (const row of candidates) {
    if (left <= 0) break;
    if (!first) await sleep(REQUEST_INTERVAL_MS);
    first = false;

    const url = `${origin}${PRODUCTS_PATH}${row.handle}`;
    const page = await readProductPage(url, cookie, fetchImpl);
    left -= 1;

    // B16, and only on a page that answered: fetching the links of a password
    // form would spend the budget checking the theme's login page.
    let links: { results: LinkResult[]; plan: LinkPlan; checked: number } | null = null;
    if (page.status === 200 && !page.passwordProtected && !page.error) {
      const plan = internalLinks(page.html, page.finalUrl, LINK_CHECK_CAP);
      if (plan.urls.length > 0) {
        const results: LinkResult[] = [];
        let checked = 0;
        for (const link of plan.urls) {
          // Each distinct address is charged once per pass. A storefront links
          // to the same collection from the breadcrumb, the menu and the
          // footer on every one of its pages; paying for that once a night is
          // the difference between B16 costing 20 requests a page and costing
          // 20 requests a store.
          const cached = linkCache.get(link);
          if (cached !== undefined) {
            results.push({ url: link, status: cached });
            checked += 1;
            continue;
          }
          if (left <= 0) break;
          await sleep(REQUEST_INTERVAL_MS);
          const result = await checkOneLink(link, cookie, fetchImpl);
          left -= 1;
          linkCache.set(link, result.status);
          await spendPages(shopId, 1, startedAt);
          linkSpend.fetched += 1;
          results.push(result);
          checked += 1;
        }
        if (checked > 0) {
          links = { results, plan, checked };
          linkSpend.pages += 1;
          if (plan.capped) linkSpend.capped += 1;
        }
      }
    }

    const reading = readingOf(page, (row.offer as OfferFacts | null) ?? null, {
      handle: row.handle,
      markets,
      sitemap: sitemap.read,
      robots: robotsReview,
      titlesByKey,
      links,
    });
    addTitle(titlesByKey, reading.pageTitle, row.handle);

    // Spent as it is spent, not once at the end. A throw from the update
    // below, or the worker machine going away mid-pass, used to discard the
    // accounting for every page already fetched tonight: the counter read
    // zero and the "Read this page now" button would then hand out the whole
    // allowance again. It also closes the window where a merchant clicking
    // during the pass had their +1 overwritten by the pass's single final
    // write (PRD section 6's amendment - the counter exists so a merchant
    // cannot spend the budget by clicking). QA of 3 September 2026.
    await spendPages(shopId, 1, startedAt);

    report.scanned += 1;
    if (reading.status === "password") report.password += 1;
    if (reading.status === "error") report.failed += 1;
    if (Number(reading.age ?? 0) > 0) report.fromCache += 1;
    for (const finding of reading.findings) {
      report.byCode[finding.code] = (report.byCode[finding.code] ?? 0) + 1;
    }

    // Rule 1: source A's half of the column is carried through untouched.
    const keptFromSourceA = findingsOf(row.findings).filter(isSourceAFinding);

    // Rule 3: scannedAt moves even for a page that failed.
    await db.seoScan.update({
      where: { id: row.id },
      data: {
        scannedAt: now(),
        status: reading.status,
        nodes: reading.nodes as any,
        canonical: reading.canonical,
        noindex: reading.noindex,
        appBlock: reading.appBlock,
        cacheControl: reading.cacheControl,
        pageTitle: reading.pageTitle,
        findings: [...keptFromSourceA, ...reading.findings] as any,
      },
    });
  }

  report.links = linkSpend;

  report.remaining = await waiting();
  // Three states, never conflated. A shop with no rows has not finished; it has
  // not started, and the thing to do is the catalogue pass, not another night.
  // `left`, not `scanned >= allowance`: B16's link fetches spend from the same
  // number, so a night can exhaust the budget with fewer pages read than the
  // allowance it started with. Counting pages here would report that night as
  // "up to date" while pages were still waiting.
  report.stopped =
    report.rows === 0
      ? "no_catalogue"
      : left <= 0 && report.remaining > 0
        ? "budget"
        : "up_to_date";
  report.nightsToFinish = budget > 0 ? Math.ceil(report.remaining / budget) : 0;

  if (report.stopped === "no_catalogue") {
    log?.(
      `seo_scan ${origin}: no products have been read yet, so there are no pages to fetch - ` +
        `run a catalogue pass first (Fill catalogue)`,
    );
    return report;
  }

  log?.(
    `seo_scan ${origin}: ${report.scanned} pages read, ${report.password} behind the password form, ` +
      `${report.failed} unreachable, ${report.remaining} waiting`,
  );
  return report;
}

// --- one page, on demand ---------------------------------------------------

export type OneScanOutcome =
  | { ok: true; scannedAt: Date; status: string; findings: Finding[]; budget: BudgetStatus }
  | {
      ok: false;
      reason: "budget" | "no_row" | "no_handle" | "robots";
      detail?: string;
      budget: BudgetStatus;
    };

/**
 * "Read this page now" on the product editor (PRD section 4 and decision 2 of
 * section 7): source B for one product, outside the nightly pass but counted
 * against the same daily budget, so a merchant cannot spend 10,000 fetches by
 * clicking.
 *
 * It writes the same row the nightly pass writes, by the same rules - source
 * A's half of `findings` is carried through untouched, `scannedAt` moves even
 * when the page failed - so the editor's second render reads the new values
 * from the row and never from what this function happened to return. Refusals
 * are values, not exceptions: the screen has a sentence for each of them.
 */
export async function scanOneProductPage(input: {
  shopId: string;
  productId: string;
  origin: string;
  password?: string | null;
  deps?: ScanDeps;
}): Promise<OneScanOutcome> {
  const fetchImpl = input.deps?.fetchImpl ?? fetch;
  const now = input.deps?.now ?? (() => new Date());
  const at = now();

  const budget = await pageBudget(input.shopId, at);
  if (budget.remaining <= 0) return { ok: false, reason: "budget", budget };

  const row = await db.seoScan.findUnique({
    where: { shopId_productId: { shopId: input.shopId, productId: input.productId } },
    select: { id: true, handle: true, offer: true, findings: true },
  });
  if (!row) return { ok: false, reason: "no_row", budget };
  if (!row.handle) return { ok: false, reason: "no_handle", budget };

  // The merchant's own robots.txt still decides, exactly as it does at night.
  // A shop that has said no to /products/ has said no to this button too.
  const robots = await fetchRobots(input.origin, fetchImpl);
  const blocked = robots.fetched ? productsDisallow(robots.content) : null;
  if (blocked) return { ok: false, reason: "robots", detail: blocked, budget };

  const cookie = await unlockQuietly(input.origin, input.password, fetchImpl, null);
  const page = await readProductPage(
    `${input.origin}${PRODUCTS_PATH}${row.handle}`,
    cookie,
    fetchImpl,
  );
  // One page, so the two per-pass reads are not made again: refetching a
  // shop's sitemaps because a merchant pressed a button on one product would
  // spend several requests to answer one row's question. Markets comes from
  // what the last pass recorded, which costs a Setting read.
  const markets = await marketsInfo(input.shopId);
  const reading = readingOf(page, (row.offer as OfferFacts | null) ?? null, {
    handle: row.handle,
    markets,
    sitemap: null,
    // B23 costs nothing extra: robots.txt was fetched two lines above, because
    // this button obeys the same Disallow the nightly pass obeys.
    robots: reviewRobots(robots),
    // B16 and B21 are deliberately not asked here.
    //
    // B16 would spend up to twenty more storefront requests on one click, and
    // the guard on this action is one page of budget. A merchant pressing a
    // button must not be able to spend twenty-one.
    //
    // B21 compares this page's title against every other page's, and that
    // comparison is a query over the whole table; the nightly pass makes it
    // once for the whole catalogue. Both are carried forward below rather than
    // recomputed, so a press never clears a finding it did not re-ask.
    titlesByKey: null,
    links: null,
  });

  const keptFromSourceA = findingsOf(row.findings).filter(isSourceAFinding);
  // A7 is not asked here, so it must not be answered here either. Source B
  // owns the code and rewrites its whole half, so without this a button press
  // would silently clear a finding the nightly pass established - "not
  // re-checked" reported as "no longer true". The same applies to B9 when the
  // markets read is unavailable, and to B16 and B21, which this path never
  // asks at all.
  const carried = findingsOf(row.findings).filter(
    (f) =>
      (f.code === "A7" && !reading.findings.some((n) => n.code === "A7")) ||
      (f.code === "B9" && markets === null) ||
      f.code === "B16" ||
      f.code === "B21",
  );
  reading.findings = [...reading.findings, ...carried];
  const scannedAt = now();
  await db.seoScan.update({
    where: { id: row.id },
    data: {
      scannedAt,
      status: reading.status,
      nodes: reading.nodes as any,
      canonical: reading.canonical,
      noindex: reading.noindex,
      appBlock: reading.appBlock,
      cacheControl: reading.cacheControl,
      pageTitle: reading.pageTitle,
      findings: [...keptFromSourceA, ...reading.findings] as any,
    },
  });

  // Spent after the fetch, not before: a page that could not be reached still
  // cost a request and still counts, but a refusal above costs nothing.
  await spendPages(input.shopId, 1, at);

  return {
    ok: true,
    scannedAt,
    status: reading.status,
    findings: reading.findings,
    budget: { ...budget, spent: budget.spent + 1, remaining: budget.remaining - 1 },
  };
}
