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
  isOurNodeId,
  storefrontCookie,
  type LdNode,
} from "./theme-scan.server";

/** Section 3: 500 page fetches per shop per day unless an operator says otherwise. */
export const DEFAULT_DAILY_BUDGET = 500;

/** Per-shop Setting row an operator can raise for a client who pays for it. */
export const BUDGET_SETTING_KEY = "seo_scan_daily_budget";

/** One request at a time per shop, this far apart. 500 pages is about four minutes. */
export const REQUEST_INTERVAL_MS = 500;

/** The path space the whole scan lives in, and the one robots.txt is asked about. */
export const PRODUCTS_PATH = "/products/";

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
  /** Set when the request itself failed; then nothing else here is meaningful. */
  error?: string;
};

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

  try {
    const res = await fetchImpl(url, { headers, redirect: "follow" });
    const html = await res.text();
    return {
      url,
      finalUrl: res.url || url,
      status: res.status,
      html,
      cacheControl: res.headers.get("cache-control"),
      age: res.headers.get("age"),
      xRobotsTag: res.headers.get("x-robots-tag"),
      passwordProtected: isPasswordPage(html),
    };
  } catch (error) {
    return {
      url,
      finalUrl: url,
      status: 0,
      html: "",
      cacheControl: null,
      age: null,
      xRobotsTag: null,
      passwordProtected: false,
      error: describeError(error),
    };
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
};

function sameAddress(a: string, b: string): boolean {
  const strip = (value: string) => value.split("#")[0].replace(/\/$/, "");
  return strip(a) === strip(b);
}

/**
 * The checks, given a page that has been read. Pure: no fetch, no database,
 * so every row below can be asserted on from a string of HTML.
 */
export function readingOf(page: PageRead, offer: OfferFacts | null): PageRow {
  const base = {
    nodes: [] as LdNode[],
    canonical: null,
    noindex: null,
    appBlock: null,
    cacheControl: page.cacheControl,
    age: page.age,
  };

  if (page.error) {
    return {
      ...base,
      status: "error",
      findings: [
        { code: "B5", source: "B", detail: { reason: "unreachable", error: page.error } },
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
  const ours = productNodes.some((n) => isOurNodeId(n.id));
  const emitters = [
    ...(productNodes.some((n) => !isOurNodeId(n.id)) ? ["theme"] : []),
    ...(ours ? ["app"] : []),
  ];
  if (distinct !== 1) {
    findings.push({
      code: "B1",
      source: "B",
      detail: { productNodes: distinct, emitters, ids: [...ids] },
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

  // A2: the page's offer against what the variants said on the last catalogue
  // pass. Returns null when either half is missing - "not yet read" is not
  // "they agree".
  const a2 = offer ? checkOfferConsistency(offer, extractSchemaOffer(page.html)) : null;
  if (a2) findings.push(a2);

  return {
    status: "ok",
    nodes,
    canonical,
    noindex,
    appBlock,
    cacheControl: page.cacheControl,
    age: page.age,
    findings,
  };
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
  stopped: "budget" | "catalogue" | "robots";
  /** Set when robots.txt stopped the scan; it is itself finding B5. */
  robots?: Finding;
  /** How many answered from a cache (an Age header above zero). */
  fromCache: number;
};

export type ScanDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (message: string) => void;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
    stopped: "catalogue",
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

  // What is left of today's budget, not the whole budget: the product
  // editor's "Read this page now" button spends from the same allowance
  // (PRD section 4), and a nightly pass that ignored that would let a shop
  // fetch more pages in a day than its operator set.
  const spentAlready = (await pageBudget(shopId, startedAt)).spent;
  const allowance = Math.max(0, budget - spentAlready);

  const candidates: Candidate[] =
    allowance === 0
      ? []
      : await db.seoScan.findMany({
          where: { shopId, handle: { not: null } },
          orderBy: [{ scannedAt: { sort: "asc", nulls: "first" } }, { productId: "asc" }],
          take: allowance,
          select: { id: true, productId: true, handle: true, offer: true, findings: true },
        });

  let first = true;
  for (const row of candidates) {
    if (!first) await sleep(REQUEST_INTERVAL_MS);
    first = false;

    const url = `${origin}${PRODUCTS_PATH}${row.handle}`;
    const page = await readProductPage(url, cookie, fetchImpl);
    const reading = readingOf(page, (row.offer as OfferFacts | null) ?? null);

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
        findings: [...keptFromSourceA, ...reading.findings] as any,
      },
    });
  }

  report.remaining = await waiting();
  report.stopped =
    report.scanned >= allowance && report.remaining > 0 ? "budget" : "catalogue";
  report.nightsToFinish = budget > 0 ? Math.ceil(report.remaining / budget) : 0;

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
  const reading = readingOf(page, (row.offer as OfferFacts | null) ?? null);

  const keptFromSourceA = findingsOf(row.findings).filter(isSourceAFinding);
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
