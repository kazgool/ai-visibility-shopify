// Source B of the per-product SEO scan (PRD-SEO-PER-PRODUCT section 3 and the
// acceptance rows for B1 to B5).
//
// Everything here is asserted without a network and without a database,
// because the parts that decide whether a merchant is told the truth are the
// ones that only show up on a page that answered something unexpected: a
// password form, a redirect, a robots.txt that says no. Those cannot be
// produced on demand against a live store, and the one store available cannot
// have its password turned off at all.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockCount = vi.fn();

/**
 * The pass makes two count() calls and they mean different things: one asks how
 * many rows this shop has at all (`rows`, which is what tells "nothing to scan"
 * apart from "nothing left to scan"), and one asks how many are still waiting
 * (`remaining`). Answering both with one number is how the three states got
 * conflated in the first place, so the stub tells them apart the way the code
 * does - by the waiting query's `handle`/`OR` clause.
 */
function counts({ rows: total, waiting }: { rows: number; waiting: number }) {
  mockCount.mockImplementation(async (args: any) =>
    args?.where?.OR ? waiting : total,
  );
}
const mockSettingFindUnique = vi.fn();
const mockSettingUpsert = vi.fn();
const mockScanFindUnique = vi.fn();
const mockSettingDeleteMany = vi.fn();

vi.mock("../../db.server", () => ({
  default: {
    seoScan: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      count: (...a: unknown[]) => mockCount(...a),
      findUnique: (...a: unknown[]) => mockScanFindUnique(...a),
    },
    setting: {
      findUnique: (...a: unknown[]) => mockSettingFindUnique(...a),
      // Build step 4: the nightly pass writes today's spend so the product
      // editor's "Read this page now" button draws from the same allowance.
      upsert: (...a: unknown[]) => mockSettingUpsert(...a),
      // QA of 3 September 2026: a pass that gets through robots.txt clears
      // the "robots.txt stopped the scan" row, so the SEO screen stops saying
      // it the night the merchant fixes robots.txt.
      deleteMany: (...a: unknown[]) => mockSettingDeleteMany(...a),
    },
  },
}));

import type { OfferFacts } from "../seo-scan";
import { OUR_NODE_MARKER } from "../conflicts";
import {
  BUDGET_SETTING_KEY,
  cappedBudget,
  ROBOTS_BLOCK_SETTING_KEY,
  SPEND_SETTING_KEY,
  DEFAULT_DAILY_BUDGET,
  REQUEST_INTERVAL_MS,
  budgetDay,
  pageBudget,
  scanOneProductPage,
  spendPages,
  dailyBudget,
  extractSchemaOffer,
  isPasswordPage,
  parseRobots,
  productsDisallow,
  readProductPage,
  readingOf,
  reviewRobots,
  checkRobotsReview,
  robotsRulesFor,
  scanShopPages,
  type PageRead,
} from "../seo-page.server";
import { describeFinding } from "../seo-aggregate";

// --- fixtures --------------------------------------------------------------

const ORIGIN = "https://shop.example";
const URL_A = `${ORIGIN}/products/a-chair`;

function productLd(id: string, offers = ""): string {
  return (
    '<script type="application/ld+json">' +
    `{"@context":"https://schema.org","@type":"Product","@id":"${id}","name":"A chair"${offers}}` +
    "</script>"
  );
}

/**
 * The same node, but ours: it carries the emitter marker. Ownership is read from
 * the marker and never from the `@id`, because extend mode makes our node share
 * the theme's address on purpose (4 September 2026).
 */
function ourProductLd(id: string, offers = ""): string {
  return (
    '<script type="application/ld+json">' +
    `{"@context":"https://schema.org","@type":"Product","@id":"${id}",` +
    `"${OUR_NODE_MARKER}":"1","name":"A chair"${offers}}` +
    "</script>"
  );
}

const CANONICAL = `<link rel="canonical" href="${URL_A}">`;
const MIRROR_LINK = `<link rel="alternate" href="${ORIGIN}/apps/ai-visibility/a-chair">`;

/**
 * The head and body of a page that gives B10 to B24 nothing to report: a title
 * inside the range a phone result shows, a description inside its own, one H1
 * that is not the logo, the three Open Graph properties and the four Twitter
 * ones, an image with an alt a person wrote, no http resource, no meta
 * keywords, no deprecated node, and enough visible text that B17 is silent.
 *
 * It exists because "a page with nothing wrong with it" has to keep meaning
 * that as checks are added. Before B10 to B24, CLEAN was four tags - which
 * every one of the fifteen new checks would correctly have found something
 * wrong with, and the test asserting on an empty findings list would then have
 * been asserting that the new checks do not run.
 */
const CLEAN_HEAD =
  "<title>A chair in solid oak, natural finish</title>" +
  '<meta name="description" content="A dining chair in solid oak with a natural oil finish, ' +
  'made for everyday use at a kitchen table or a desk.">' +
  '<meta property="og:title" content="A chair">' +
  '<meta property="og:image" content="https://shop.example/chair.jpg">' +
  '<meta property="og:description" content="A dining chair in solid oak.">' +
  '<meta name="twitter:card" content="summary_large_image">' +
  '<meta name="twitter:title" content="A chair">' +
  '<meta name="twitter:description" content="A dining chair in solid oak.">' +
  '<meta name="twitter:image" content="https://shop.example/chair.jpg">';

const CLEAN_BODY =
  "<body><h1>A chair in solid oak</h1>" +
  '<img src="https://shop.example/chair.jpg" alt="A dining chair in solid oak, seen from the front">' +
  "<p>" +
  ("A dining chair in solid oak with a natural oil finish. " +
    "It is made for everyday use at a kitchen table or a desk, and it takes an adult of any height. " +
    "The seat is shaped, the back is slatted, and the frame is joined rather than screwed. ").repeat(
    2,
  ) +
  "</p></body>";

/** A page with nothing wrong with it: one theme node, self canonical, our block. */
const CLEAN =
  CLEAN_HEAD + CANONICAL + productLd(`${URL_A}#product-theme`) + MIRROR_LINK + CLEAN_BODY;

const PASSWORD_FORM =
  '<form method="post" action="/password"><input type="password" name="password"></form>';

function page(html: string, overrides: Partial<PageRead> = {}): PageRead {
  return {
    url: URL_A,
    finalUrl: URL_A,
    status: 200,
    html,
    cacheControl: null,
    age: null,
    xRobotsTag: null,
    passwordProtected: overrides.passwordProtected ?? isPasswordPage(html),
    // One hop, the page answering for itself: the shape readProductPage
    // returns for every page that is not redirected. B19 reads this and stays
    // silent on it, which is what every test written before B19 existed
    // assumes.
    chain: [{ url: URL_A, status: 200 }],
    ...overrides,
  };
}

const OFFER: OfferFacts = {
  variantsRead: 1,
  available: false,
  minPrice: "100",
  maxPrice: "100",
  currency: "RON",
};

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code);
}

/** A fetch Response as much of one as this code touches. */
function reply(
  body: string,
  init: { status?: number; url?: string; headers?: Record<string, string> } = {},
): Response {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? "",
    headers: new Headers(init.headers ?? {}),
    text: async () => body,
  } as unknown as Response;
}

const ROBOTS_OPEN = "User-agent: *\nDisallow: /admin\nDisallow: /cart\n";

// --- robots.txt ------------------------------------------------------------

describe("robots.txt", () => {
  it("keeps consecutive user-agent lines in one group", () => {
    const groups = parseRobots("User-agent: A\nUser-agent: B\nDisallow: /x\n\nUser-agent: *\nDisallow: /y");
    expect(groups).toHaveLength(2);
    expect(groups[0].agents).toEqual(["a", "b"]);
    expect(groups[0].disallow).toEqual(["/x"]);
    expect(groups[1].agents).toEqual(["*"]);
  });

  it("ignores comments and blank lines", () => {
    const groups = parseRobots("# a comment\nUser-agent: *  # us\n\nDisallow: /admin # why\n");
    expect(groups[0].disallow).toEqual(["/admin"]);
  });

  it("prefers a group that names this app over the wildcard group", () => {
    const content = "User-agent: *\nDisallow: /\n\nUser-agent: AI-Visibility-App\nDisallow: /admin";
    expect(robotsRulesFor(content).disallow).toEqual(["/admin"]);
    expect(productsDisallow(content)).toBeNull();
  });

  it("does not stop on a storefront that only blocks admin and cart", () => {
    expect(productsDisallow(ROBOTS_OPEN)).toBeNull();
  });

  it("stops on a Disallow that covers the product path", () => {
    expect(productsDisallow("User-agent: *\nDisallow: /products/")).toBe("/products/");
    expect(productsDisallow("User-agent: *\nDisallow: /")).toBe("/");
  });

  it("lets a longer Allow win, the rule every crawler applies", () => {
    expect(productsDisallow("User-agent: *\nDisallow: /\nAllow: /products/")).toBeNull();
  });

  it("reads a wildcard rule as a pattern, not as a literal", () => {
    expect(productsDisallow("User-agent: *\nDisallow: /*/products/")).toBeNull();
    expect(productsDisallow("User-agent: *\nDisallow: /prod*")).toBe("/prod*");
  });

  it("treats an empty Disallow as allowing everything", () => {
    expect(productsDisallow("User-agent: *\nDisallow:")).toBeNull();
  });
});

// --- one page --------------------------------------------------------------

describe("what one page says", () => {
  it("finds nothing on a page with one theme node, a self canonical and our block", () => {
    const row = readingOf(page(CLEAN), null);
    expect(row.status).toBe("ok");
    expect(row.findings).toEqual([]);
    expect(row.appBlock).toBe("present");
    expect(row.canonical).toBe(URL_A);
    expect(row.noindex).toBe(false);
  });

  it("records a password page as password, with no finding about the page at all", () => {
    const row = readingOf(page(PASSWORD_FORM), OFFER);
    expect(row.status).toBe("password");
    expect(row.findings).toEqual([]);
    // Not "absent": nobody could look.
    expect(row.appBlock).toBe("unreadable");
    expect(row.nodes).toEqual([]);
  });

  it("reports B5 for a status that is not 200, and reads no nodes from it", () => {
    const row = readingOf(page("<h1>Not found</h1>", { status: 404 }), null);
    expect(row.status).toBe("404");
    expect(codes(row.findings)).toEqual(["B5"]);
    expect(row.findings[0].detail).toMatchObject({ reason: "status", status: 404 });
  });

  it("reports B5 for a page it could not reach", () => {
    const row = readingOf(page("", { error: "fetch failed" }), null);
    expect(row.status).toBe("error");
    expect(row.findings[0].detail).toMatchObject({ reason: "unreachable" });
  });

  it("reports B5 for a product URL that answered from somewhere else", () => {
    const row = readingOf(
      page(CLEAN, { finalUrl: `${ORIGIN}/products/a-chair-2` }),
      null,
    );
    expect(codes(row.findings)).toContain("B5");
    expect(row.findings.find((f) => f.code === "B5")?.detail).toMatchObject({
      reason: "redirect",
      to: `${ORIGIN}/products/a-chair-2`,
    });
  });

  it("B1: names a page with no Product node", () => {
    const row = readingOf(page(CANONICAL + MIRROR_LINK), null);
    expect(codes(row.findings)).toContain("B1");
    expect(row.findings[0].detail).toMatchObject({ productNodes: 0, emitters: [] });
  });

  it("B1: two nodes with different ids are two nodes, and both emitters are named", () => {
    const html =
      CANONICAL + productLd(`${URL_A}#product-theme`) + ourProductLd(`${URL_A}#product`);
    const row = readingOf(page(html), null);
    const b1 = row.findings.find((f) => f.code === "B1");
    expect(b1?.detail).toMatchObject({ productNodes: 2, emitters: ["theme", "app"] });
  });

  it("B1: extend mode reusing the theme's id is one node, not a conflict", () => {
    // Ours at the theme's own address, which is the point of extend mode.
    const html =
      CANONICAL + ourProductLd(`${URL_A}#product`) + productLd(`/products/a-chair#product`);
    const row = readingOf(page(html), null);
    expect(codes(row.findings)).not.toContain("B1");
    expect(row.appBlock).toBe("present");
  });

  it("B2: a canonical pointing elsewhere, and a canonical that is absent", () => {
    const elsewhere = readingOf(
      page(`<link rel="canonical" href="${ORIGIN}/">` + productLd(`${URL_A}#x`) + MIRROR_LINK),
      null,
    );
    expect(codes(elsewhere.findings)).toContain("B2");

    const none = readingOf(page(productLd(`${URL_A}#x`) + MIRROR_LINK), null);
    expect(none.findings.find((f) => f.code === "B2")?.detail).toMatchObject({ canonical: null });
  });

  it("B2: a relative self canonical is not a finding", () => {
    const row = readingOf(
      page('<link rel="canonical" href="/products/a-chair">' + productLd(`${URL_A}#x`) + MIRROR_LINK),
      null,
    );
    expect(codes(row.findings)).not.toContain("B2");
  });

  it("B3: noindex from the meta tag and from the header", () => {
    const meta = readingOf(
      page(CLEAN + '<meta name="robots" content="noindex,follow">'),
      null,
    );
    expect(meta.noindex).toBe(true);
    expect(meta.findings.find((f) => f.code === "B3")?.detail).toEqual({ from: "meta" });

    const header = readingOf(page(CLEAN, { xRobotsTag: "noindex" }), null);
    expect(header.findings.find((f) => f.code === "B3")?.detail).toEqual({ from: "header" });
  });

  it("B4: absent when neither our node nor the mirror link is on the page", () => {
    const row = readingOf(page(CANONICAL + productLd(`${URL_A}#product-theme`)), null);
    expect(row.appBlock).toBe("absent");
    expect(row.findings.find((f) => f.code === "B4")?.detail).toEqual({
      signals: { ourProductNode: false, mirrorLink: false },
    });
  });

  it("A2: the page says in stock while every variant is sold out", () => {
    const html =
      CANONICAL +
      productLd(
        `${URL_A}#product-theme`,
        ',"offers":{"@type":"Offer","availability":"https://schema.org/InStock","price":"100"}',
      ) +
      MIRROR_LINK;
    const row = readingOf(page(html), OFFER);
    expect(codes(row.findings)).toContain("A2");
    expect(row.findings.find((f) => f.code === "A2")?.source).toBe("A+B");
  });

  it("A2: no finding when the page and the variants agree", () => {
    const html =
      CANONICAL +
      productLd(
        `${URL_A}#product-theme`,
        ',"offers":{"@type":"Offer","availability":"https://schema.org/OutOfStock","price":"100"}',
      ) +
      MIRROR_LINK;
    expect(codes(readingOf(page(html), OFFER).findings)).not.toContain("A2");
  });

  it("A2: nothing is claimed when source A never read a variant", () => {
    const html =
      CANONICAL +
      productLd(`${URL_A}#product-theme`, ',"offers":{"availability":"InStock","price":"9"}') +
      MIRROR_LINK;
    expect(codes(readingOf(page(html), null).findings)).not.toContain("A2");
  });

  it("reads an aggregate offer's lowPrice", () => {
    const html = productLd(
      `${URL_A}#x`,
      ',"offers":{"@type":"AggregateOffer","lowPrice":"80","availability":"InStock"}',
    );
    expect(extractSchemaOffer(html)).toEqual({
      availability: "InStock",
      price: "80",
    });
  });

  it("records what the cache said, whatever it said", () => {
    const row = readingOf(page(CLEAN, { cacheControl: "max-age=300", age: "120" }), null);
    expect(row.cacheControl).toBe("max-age=300");
    expect(row.age).toBe("120");
    // A cached page is a finding about the cache, not about the theme: the
    // page's own findings are unaffected.
    expect(row.findings).toEqual([]);
  });
});

describe("the request itself", () => {
  it("asks for a fresh copy, identifies itself, and records the response headers", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: any) =>
      reply(CLEAN, { headers: { "cache-control": "max-age=300", age: "7" }, url: URL_A }),
    );
    const read = await readProductPage(URL_A, "storefront_digest=abc", fetchImpl as any);

    const headers = (fetchImpl.mock.calls[0][1] as any).headers;
    expect(headers["Cache-Control"]).toBe("no-cache");
    expect(headers["User-Agent"]).toContain("AI-Visibility-App");
    expect(headers.Cookie).toBe("storefront_digest=abc");
    expect(read.cacheControl).toBe("max-age=300");
    expect(read.age).toBe("7");
    expect(read.status).toBe(200);
  });

  it("turns a thrown request into a read that says so", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const read = await readProductPage(URL_A, null, fetchImpl as any);
    expect(read.error).toBe("ECONNRESET");
    expect(read.status).toBe(0);
  });
});

// --- the nightly pass ------------------------------------------------------

type Row = {
  id: string;
  productId: string;
  handle: string | null;
  offer: unknown;
  findings: unknown;
  scannedAt: Date | null;
};

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `row${i}`,
    productId: `gid://shopify/Product/${i}`,
    handle: `p${i}`,
    offer: null,
    findings: [],
    scannedAt: null,
  }));
}

/**
 * findMany as Postgres would answer it, honouring the orderBy the code asked
 * for - including its null placement. A test that sorts the rows itself would
 * pass whatever the code asked for, and the null placement is the whole
 * cursor: Postgres puts NULLs LAST on ASC, so asking for the default would
 * rescan the same pages for ever.
 */
function answerFindMany(all: Row[]) {
  return async (args: any) => {
    // The pass makes two findMany calls of different shapes, and only one of
    // them is the ordered cursor this stub exists to model. The other is
    // B21's title map (no orderBy, `pageTitle: { not: null }`), and it is
    // answered from the same rows so a store whose pages carry titles reports
    // the duplicates it has.
    if (!args.orderBy) {
      return all
        .filter((row) => (row as any).pageTitle != null)
        .map((row) => ({ handle: row.handle, pageTitle: (row as any).pageTitle }));
    }
    const spec = args.orderBy[0].scannedAt;
    const nullsFirst = typeof spec === "object" && spec?.nulls === "first";
    const sorted = [...all].sort((a, b) => {
      const an = a.scannedAt === null;
      const bn = b.scannedAt === null;
      if (an && bn) return a.productId.localeCompare(b.productId);
      if (an) return nullsFirst ? -1 : 1;
      if (bn) return nullsFirst ? 1 : -1;
      if (a.scannedAt!.getTime() !== b.scannedAt!.getTime()) {
        return a.scannedAt!.getTime() - b.scannedAt!.getTime();
      }
      return a.productId.localeCompare(b.productId);
    });
    return sorted.slice(0, args.take);
  };
}

/**
 * `sitemap` defaults to a 404, so these tests keep asserting on product pages
 * alone. The pass fetches the shop's sitemap once (PRD-SEO-FULL-ONPAGE section
 * 2, check A7); a fetch that answers with anything but XML leaves A7 silent,
 * which is the state every store here is in.
 */
function routedFetch(
  pages: (url: string) => Response,
  robots = ROBOTS_OPEN,
  sitemap: (url: string) => Response = () => reply("not found", { status: 404 }),
) {
  const productUrls: string[] = [];
  const sitemapUrls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    if (url.endsWith("/robots.txt")) return reply(robots);
    if (url.includes("/sitemap")) {
      sitemapUrls.push(url);
      return sitemap(url);
    }
    productUrls.push(url);
    return pages(url);
  });
  return { impl, productUrls, sitemapUrls };
}

const noSleep = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

describe("the nightly pass", () => {
  it("stops at the budget and says how many nights the rest will take", async () => {
    const all = rows(12);
    mockFindMany.mockImplementation(answerFindMany(all));
    // Seven rows are still waiting after tonight's five.
    counts({ rows: 12, waiting: 7 });
    const { impl, productUrls, sitemapUrls } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      // Six, not five: the one sitemap fetch is charged to the same allowance
      // (PRD-SEO-FULL-ONPAGE section 2), so a budget of five would read four
      // pages. Stated here rather than hidden, because a budget that quietly
      // means something other than what an operator set is the failure this
      // whole allowance exists to prevent.
      budget: 6,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(sitemapUrls).toEqual([`${ORIGIN}/sitemap.xml`]);
    expect(productUrls).toHaveLength(5);
    expect(report.scanned).toBe(5);
    expect(report.remaining).toBe(7);
    expect(report.nightsToFinish).toBe(2);
    expect(report.stopped).toBe("budget");
    expect(mockUpdate).toHaveBeenCalledTimes(5);
    // One request at a time, 500 ms apart: four gaps between five pages.
    expect(noSleep).toHaveBeenCalledTimes(4);
    expect(noSleep).toHaveBeenCalledWith(REQUEST_INTERVAL_MS);
  });

  // The three states, one test each. They are never the same sentence: a shop
  // with no rows has not finished, it has not started (4 September 2026 - it
  // used to report "catalogue" with zero of everything, which reads as done).
  it("says every page is up to date when rows exist and none are waiting", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(3)));
    counts({ rows: 3, waiting: 0 });
    const { impl } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(report.stopped).toBe("up_to_date");
    expect(report.rows).toBe(3);
    expect(report.nightsToFinish).toBe(0);
  });

  it("says no catalogue has been read when the shop has no rows at all", async () => {
    mockFindMany.mockImplementation(answerFindMany([]));
    counts({ rows: 0, waiting: 0 });
    const logged: string[] = [];
    const { impl, productUrls } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep, log: (m) => logged.push(m) },
    });

    // Not "catalogue", which read as finished, and not a page fetched.
    expect(report.stopped).toBe("no_catalogue");
    expect(report.rows).toBe(0);
    expect(report.scanned).toBe(0);
    expect(productUrls).toEqual([]);
    // And the log names the thing to do first rather than reporting zeros.
    expect(logged.join(" ")).toContain("no products have been read yet");
    expect(logged.join(" ")).toContain("Fill catalogue");
  });

  it("says the budget stopped it when pages are still waiting", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(4)));
    counts({ rows: 12, waiting: 8 });
    const { impl } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 4,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(report.stopped).toBe("budget");
    expect(report.rows).toBe(12);
    expect(report.remaining).toBe(8);
    expect(report.nightsToFinish).toBe(2);
  });

  it("reads the never-scanned pages before the oldest ones", async () => {
    const all: Row[] = [
      { ...rows(1)[0], id: "old", productId: "p-old", handle: "old", scannedAt: new Date("2026-01-01") },
      { ...rows(1)[0], id: "older", productId: "p-older", handle: "older", scannedAt: new Date("2025-01-01") },
      { ...rows(1)[0], id: "never", productId: "p-never", handle: "never", scannedAt: null },
    ];
    mockFindMany.mockImplementation(answerFindMany(all));
    counts({ rows: 3, waiting: 0 });
    const { impl, productUrls } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      // Four: three pages plus the one sitemap fetch the pass now makes.
      budget: 4,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(productUrls).toEqual([
      `${ORIGIN}/products/never`,
      `${ORIGIN}/products/older`,
      `${ORIGIN}/products/old`,
    ]);
    // And the ordering the query asks for is the one that produces it. Found
    // by shape rather than by position: the pass also reads the stored title
    // tags for B21, and which of the two queries goes first is not the thing
    // this test is about.
    const ordered = mockFindMany.mock.calls.find((call: any[]) => call[0]?.orderBy);
    expect(ordered?.[0].orderBy[0]).toEqual({
      scannedAt: { sort: "asc", nulls: "first" },
    });
  });

  it("writes a password page as password with no findings, and keeps source A's", async () => {
    const stored = [
      { code: "A1", source: "A", detail: { missing: ["barcode"] } },
      { code: "B1", source: "B", detail: { productNodes: 0 } },
    ];
    mockFindMany.mockImplementation(async () => [
      { id: "row0", productId: "p0", handle: "p0", offer: OFFER, findings: stored, scannedAt: null },
    ]);
    counts({ rows: 3, waiting: 0 });
    const { impl } = routedFetch(() => reply(PASSWORD_FORM, { url: `${ORIGIN}/password` }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(report.password).toBe(1);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("password");
    // Source A's finding survives; the stale page finding does not, and no new
    // one takes its place. "Could not be read" is the only thing that can be
    // said about this page.
    expect(data.findings).toEqual([stored[0]]);
    expect(data.scannedAt).toBeInstanceOf(Date);
  });

  it("moves scannedAt even for a page that could not be reached", async () => {
    mockFindMany.mockImplementation(async () => [
      { id: "row0", productId: "p0", handle: "p0", offer: null, findings: [], scannedAt: null },
    ]);
    counts({ rows: 3, waiting: 0 });
    const impl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) return reply(ROBOTS_OPEN);
      throw new Error("ECONNRESET");
    });

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(report.failed).toBe(1);
    expect(mockUpdate.mock.calls[0][0].data.scannedAt).toBeInstanceOf(Date);
  });

  it("counts a page that answered from a cache", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(1)));
    counts({ rows: 3, waiting: 0 });
    const { impl } = routedFetch(() =>
      reply(CLEAN, { url: URL_A, headers: { "cache-control": "max-age=300", age: "42" } }),
    );

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(report.fromCache).toBe(1);
    expect(mockUpdate.mock.calls[0][0].data.cacheControl).toBe("max-age=300");
  });

  it("a Disallow covering the products path stops the scan, and is itself B5", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(10)));
    counts({ rows: 10, waiting: 10 });
    const { impl, productUrls } = routedFetch(
      () => reply(CLEAN, { url: URL_A }),
      "User-agent: *\nDisallow: /products/",
    );

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(productUrls).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(report.stopped).toBe("robots");
    expect(report.scanned).toBe(0);
    expect(report.robots?.code).toBe("B5");
    expect(report.robots?.detail).toMatchObject({ reason: "robots", disallow: "/products/" });
    // Not a promise the scan will finish tomorrow, because it will not.
    expect(report.nightsToFinish).toBe(0);
    expect(report.remaining).toBe(10);
    // And the reason is written where a screen can read it. The B5 above goes
    // into the JobRun report, which nothing renders: before this, the SEO
    // screen showed every page row as "waiting for the nightly page read" and
    // promised a night that had already decided to fetch nothing. The
    // acceptance row says the Disallow "is reported as B5"; reported into a
    // log is not reported (QA of 3 September 2026).
    expect(mockSettingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shopId: "shop1",
          key: ROBOTS_BLOCK_SETTING_KEY,
          value: "/products/",
        }),
      }),
    );
  });

  it("clears the robots block the night the merchant fixes robots.txt", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(2)));
    counts({ rows: 3, waiting: 0 });
    const { impl } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(mockSettingDeleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop1", key: ROBOTS_BLOCK_SETTING_KEY },
    });
  });

  it("an unreachable robots.txt does not stop the scan", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(1)));
    counts({ rows: 3, waiting: 0 });
    const impl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) return reply("", { status: 404 });
      return reply(CLEAN, { url: URL_A });
    });

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(report.scanned).toBe(1);
    expect(report.stopped).toBe("up_to_date");
  });

  it("unlocks the storefront once, not once per page", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(3)));
    counts({ rows: 3, waiting: 0 });
    const unlocks: string[] = [];
    const impl = vi.fn(async (url: string, _init?: any) => {
      if (url.endsWith("/robots.txt")) return reply(ROBOTS_OPEN);
      if (url.endsWith("/password")) {
        unlocks.push(url);
        return {
          ok: true,
          status: 302,
          url,
          headers: new Headers({ "set-cookie": "storefront_digest=abc; path=/" }),
          text: async () => "",
        } as unknown as Response;
      }
      return reply(CLEAN, { url: URL_A });
    });

    await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      password: "massive",
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(unlocks).toHaveLength(1);
    const productCall = impl.mock.calls.find(([url]) => String(url).includes("/products/"));
    expect((productCall?.[1] as any).headers.Cookie).toBe("storefront_digest=abc");
  });
});

describe("the budget setting", () => {
  it("is 500 when the shop has no row", async () => {
    mockSettingFindUnique.mockResolvedValue(null);
    expect(await dailyBudget("shop1")).toBe(DEFAULT_DAILY_BUDGET);
  });

  it("is what an operator set", async () => {
    mockSettingFindUnique.mockResolvedValue({ value: "2000" });
    expect(await dailyBudget("shop1")).toBe(2000);
  });

  it("falls back to the default rather than scanning nothing on a bad value", async () => {
    mockSettingFindUnique.mockResolvedValue({ value: "not a number" });
    expect(await dailyBudget("shop1")).toBe(DEFAULT_DAILY_BUDGET);
    mockSettingFindUnique.mockResolvedValue({ value: "0" });
    expect(await dailyBudget("shop1")).toBe(DEFAULT_DAILY_BUDGET);
  });
});

// --- the development runner's --limit --------------------------------------

// scripts/run-seo-scan.ts runs the real nightly pass for one shop so it can be
// watched without waiting for 03:45, and takes --limit N so it can be watched
// on five pages instead of five hundred. The one thing that must be true of
// that flag is that it is a ceiling and not a second budget: an operator sets
// seo_scan_daily_budget, and nothing on a developer's laptop may ask a
// merchant's storefront for more pages in a day than that setting allows.
describe("the --limit ceiling of the development runner", () => {
  it("lowers the shop's budget", () => {
    expect(cappedBudget(500, 5)).toBe(5);
    expect(cappedBudget(2000, 500)).toBe(500);
    expect(cappedBudget(20, 19)).toBe(19);
  });

  it("never raises it, whatever the flag says", () => {
    expect(cappedBudget(500, 5000)).toBe(500);
    expect(cappedBudget(500, 501)).toBe(500);
    expect(cappedBudget(5, 500)).toBe(5);
    // The operator lowered this shop deliberately; --limit cannot undo that.
    expect(cappedBudget(10, Number.MAX_SAFE_INTEGER)).toBe(10);
  });

  it("equals the budget when the flag is absent", () => {
    expect(cappedBudget(500)).toBe(500);
    expect(cappedBudget(500, null)).toBe(500);
    expect(cappedBudget(500, undefined)).toBe(500);
  });

  it("leaves the budget alone on a value that is not a number", () => {
    expect(cappedBudget(500, Number.NaN)).toBe(500);
    expect(cappedBudget(500, Number.POSITIVE_INFINITY)).toBe(500);
  });

  it("floors a fraction and never goes below zero", () => {
    expect(cappedBudget(500, 5.9)).toBe(5);
    expect(cappedBudget(500, -1)).toBe(0);
  });
});

// --- the shared daily allowance (build step 4) ------------------------------
//
// The product editor's "Read this page now" button and the nightly pass spend
// from one budget. A counter is the only thing that can enforce that: a
// merchant pressing the button on the same product ten thousand times moves
// one row's scannedAt ten thousand times, so counting rows would read that as
// one page (PRD section 4).

const DAY = new Date("2026-09-03T10:00:00Z");

/**
 * Answers the budget key and the spend key separately, as the shop would, and
 * - unlike a static stub - remembers what was spent.
 *
 * The counter has to accumulate for this to test anything: the nightly pass
 * spends one page at a time rather than once at the end (QA of 3 September
 * 2026, so a pass that dies half way does not hand its whole allowance back),
 * and against a stub that answers the same number for ever every write would
 * read the same starting point and the last one would win.
 */
function settings(spentToday: number | null, budget: string | null = null) {
  let spent = spentToday;
  mockSettingFindUnique.mockImplementation(async ({ where }: any) =>
    where.shopId_key.key === BUDGET_SETTING_KEY
      ? budget === null
        ? null
        : { value: budget }
      : spent === null
        ? null
        : { value: JSON.stringify({ day: budgetDay(new Date()), pages: spent }) },
  );
  mockSettingUpsert.mockImplementation(async ({ create }: any) => {
    if (create?.key !== SPEND_SETTING_KEY) return {};
    spent = JSON.parse(create.value).pages;
    return {};
  });
}

describe("the daily allowance", () => {
  it("reads a counter from an earlier day as nothing spent, and never writes on a read", async () => {
    mockSettingFindUnique.mockImplementation(async ({ where }: any) =>
      where.shopId_key.key === BUDGET_SETTING_KEY
        ? null
        : { value: JSON.stringify({ day: "2026-09-02", pages: 500 }) },
    );
    const status = await pageBudget("shop1", DAY);
    expect(status).toMatchObject({ budget: 500, spent: 0, remaining: 500, day: "2026-09-03" });
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });

  it("adds to today's counter", async () => {
    mockSettingFindUnique.mockImplementation(async ({ where }: any) =>
      where.shopId_key.key === BUDGET_SETTING_KEY
        ? null
        : { value: JSON.stringify({ day: "2026-09-03", pages: 12 }) },
    );
    await spendPages("shop1", 3, DAY);
    expect(mockSettingUpsert.mock.calls[0][0].update.value).toBe(
      JSON.stringify({ day: "2026-09-03", pages: 15 }),
    );
  });

  it("lets the nightly pass read only what is left of the budget, and records what it spent", async () => {
    settings(496);
    mockFindMany.mockImplementation(answerFindMany(rows(12)));
    counts({ rows: 12, waiting: 9 });
    const { impl, productUrls } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    // 500 budget less the 496 already spent today leaves four requests, and
    // the sitemap takes the first of them: three pages, not twelve.
    expect(mockFindMany.mock.calls.find((c: any[]) => c[0]?.orderBy)?.[0].take).toBe(3);
    expect(productUrls).toHaveLength(3);
    expect(report.scanned).toBe(3);
    expect(report.stopped).toBe("budget");
    // One write per page as it is spent, plus one for the sitemap, and the
    // counter reaches the budget.
    const spends = mockSettingUpsert.mock.calls.filter(
      (c: any) => c[0].create.key === SPEND_SETTING_KEY,
    );
    expect(spends).toHaveLength(4);
    expect(spends[spends.length - 1][0].update.value).toContain('"pages":500');
  });

  it("fetches nothing at all once the allowance is gone", async () => {
    settings(500);
    counts({ rows: 40, waiting: 40 });
    const { impl, productUrls } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(productUrls).toHaveLength(0);
    expect(report.scanned).toBe(0);
    expect(report.stopped).toBe("budget");
    // Nothing was fetched, so nothing is added to the counter.
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });
});

describe("Read this page now", () => {
  const ROW = {
    id: "row1",
    handle: "a-chair",
    offer: null,
    findings: [{ code: "A1", source: "A", detail: { missing: ["barcode"] } }],
  };

  it("reads one page, writes the row and spends one from the same allowance", async () => {
    settings(10);
    mockScanFindUnique.mockResolvedValue(ROW);
    const { impl, productUrls } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const outcome = await scanOneProductPage({
      shopId: "shop1",
      productId: "gid://shopify/Product/1",
      origin: ORIGIN,
      deps: { fetchImpl: impl as any },
    });

    expect(outcome.ok).toBe(true);
    expect(productUrls).toEqual([`${ORIGIN}/products/a-chair`]);
    expect(mockSettingUpsert.mock.calls[0][0].update.value).toContain('"pages":11');

    // Source A's half of the column survives and scannedAt moved: this is
    // exactly what the editor's second render reads back off the row.
    const written = mockUpdate.mock.calls[0][0].data;
    expect(written.scannedAt).toBeInstanceOf(Date);
    expect(written.status).toBe("ok");
    expect(written.findings.map((f: any) => f.code)).toContain("A1");
  });

  it("refuses when the allowance is gone, and fetches nothing", async () => {
    settings(500);
    const { impl, productUrls } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const outcome = await scanOneProductPage({
      shopId: "shop1",
      productId: "gid://shopify/Product/1",
      origin: ORIGIN,
      deps: { fetchImpl: impl as any },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "budget" });
    expect(productUrls).toHaveLength(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("obeys the shop's own robots.txt, exactly as the nightly pass does", async () => {
    settings(0);
    mockScanFindUnique.mockResolvedValue(ROW);
    const { impl, productUrls } = routedFetch(
      () => reply(CLEAN, { url: URL_A }),
      "User-agent: *\nDisallow: /products/",
    );

    const outcome = await scanOneProductPage({
      shopId: "shop1",
      productId: "gid://shopify/Product/1",
      origin: ORIGIN,
      deps: { fetchImpl: impl as any },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "robots", detail: "/products/" });
    expect(productUrls).toHaveLength(0);
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });

  it("moves scannedAt and still spends when the page could not be reached", async () => {
    settings(0);
    mockScanFindUnique.mockResolvedValue(ROW);
    const impl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/robots.txt")) return reply("");
      throw new Error("ECONNREFUSED");
    });

    const outcome = await scanOneProductPage({
      shopId: "shop1",
      productId: "gid://shopify/Product/1",
      origin: ORIGIN,
      deps: { fetchImpl: impl as any },
    });

    expect(outcome).toMatchObject({ ok: true, status: "error" });
    expect(mockUpdate.mock.calls[0][0].data.scannedAt).toBeInstanceOf(Date);
    expect(mockSettingUpsert).toHaveBeenCalled();
  });

  it("says so rather than throwing when the product has no row yet", async () => {
    settings(0);
    mockScanFindUnique.mockResolvedValue(null);
    const { impl } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const outcome = await scanOneProductPage({
      shopId: "shop1",
      productId: "gid://shopify/Product/1",
      origin: ORIGIN,
      deps: { fetchImpl: impl as any },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "no_row" });
  });
});

// --- B7: our own output twice on one page ----------------------------------

// The check that exists because no other check could ever see this. B1
// canonicalises every @id before counting, so two nodes that resolve to one
// address merge into one node - which is what extend mode is for, and which
// also means our own block rendered twice would look like one node for ever.
// Read off the dev store on 4 September 2026: every product page carried two
// Product nodes, one absolute and one relative, both ending in "#product".
describe("B7, the same node twice on one page", () => {
  const ABS = `${URL_A}#product`;
  const REL = "/products/a-chair#product";

  function findingsOn(html: string) {
    return readingOf(page(CANONICAL + html + MIRROR_LINK), null).findings;
  }

  it("fires when the identical @id appears twice, which is our block rendered twice", () => {
    const findings = findingsOn(ourProductLd(ABS) + ourProductLd(ABS));
    const b7 = findings.find((f) => f.code === "B7");
    expect(b7).toBeDefined();
    expect(b7!.source).toBe("B");
    expect((b7!.detail as any).ours).toBe(true);
    expect((b7!.detail as any).duplicates).toEqual([
      { type: "Product", count: 2, ours: true },
    ]);
  });

  // The dev store's actual pair. The theme emits a relative @id and we extend it
  // with an absolute one; they merge for B1 by design and are two different
  // strings here, so B7 must stay silent or it would fire on every correctly
  // extended page in existence.
  it("stays silent on a theme node and our extension of it, absolute beside relative", () => {
    const findings = findingsOn(productLd(REL) + ourProductLd(ABS));
    expect(findings.find((f) => f.code === "B7")).toBeUndefined();
    // And B1 is silent too, because the two merge to one address.
    expect(findings.find((f) => f.code === "B1")).toBeUndefined();
  });

  it("is distinct from B1: B1 merges the pair, B7 counts the raw strings", () => {
    // Two identical ids: one node to B1, two to B7.
    const findings = findingsOn(ourProductLd(ABS) + ourProductLd(ABS));
    expect(findings.find((f) => f.code === "B1")).toBeUndefined();
    expect(findings.find((f) => f.code === "B7")).toBeDefined();
  });

  it("says the page repeats a node, not that we did, when the id is not ours", () => {
    const themeId = `${URL_A}#schema-product`;
    const b7 = findingsOn(productLd(themeId) + productLd(themeId)).find((f) => f.code === "B7");
    expect(b7).toBeDefined();
    expect((b7!.detail as any).ours).toBe(false);
  });

  it("ignores nodes with no @id, which cannot be identical to anything", () => {
    const noId =
      '<script type="application/ld+json">' +
      '{"@context":"https://schema.org","@type":"BreadcrumbList"}' +
      "</script>";
    expect(findingsOn(noId + noId).find((f) => f.code === "B7")).toBeUndefined();
  });

  it("raises nothing on a clean page", () => {
    expect(findingsOn(productLd(`${URL_A}#product-theme`)).find((f) => f.code === "B7"))
      .toBeUndefined();
  });

  it("counts three of the same node as three", () => {
    const b7 = findingsOn(ourProductLd(ABS) + ourProductLd(ABS) + ourProductLd(ABS)).find(
      (f) => f.code === "B7",
    );
    expect((b7!.detail as any).duplicates[0].count).toBe(3);
  });
});

// --- B19: the redirect chain, as the fetcher produces it ---------------------

describe("B19, the chain readProductPage records", () => {
  it("records one hop for a page that answered directly", async () => {
    const impl = vi.fn(async () => reply(CLEAN, { url: URL_A }));
    const page = await readProductPage(URL_A, null, impl as any);
    expect(page.chain).toEqual([{ url: URL_A, status: 200 }]);
    expect(readingOf(page, null).findings.some((f) => f.code === "B19")).toBe(false);
  });

  it("follows two redirects by hand and reports the chain, not just where it ended", async () => {
    const impl = vi.fn(async (url: string) => {
      if (url.endsWith("/products/old")) {
        return reply("", { status: 301, url, headers: { location: "/products/older" } });
      }
      if (url.endsWith("/products/older")) {
        return reply("", { status: 301, url, headers: { location: "/products/a-chair" } });
      }
      return reply(CLEAN, { url: URL_A });
    });
    const page = await readProductPage(`${ORIGIN}/products/old`, null, impl as any);
    expect(page.status).toBe(200);
    expect(page.chain.map((h) => h.status)).toEqual([301, 301, 200]);
    const b19 = readingOf(page, null).findings.find((f) => f.code === "B19");
    expect((b19!.detail as any).hops).toBe(2);
    expect((b19!.detail as any).loop).toBe(false);
  });

  it("names a loop rather than following it round for ever", async () => {
    const impl = vi.fn(async (url: string) =>
      url.endsWith("/a")
        ? reply("", { status: 302, url, headers: { location: `${ORIGIN}/b` } })
        : reply("", { status: 302, url, headers: { location: `${ORIGIN}/a` } }),
    );
    const page = await readProductPage(`${ORIGIN}/a`, null, impl as any);
    const b19 = readingOf(page, null).findings.find((f) => f.code === "B19");
    expect((b19!.detail as any).loop).toBe(true);
    // Three requests at most, not an endless walk round the circle.
    expect(impl.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

// --- B23: the robots.txt review ---------------------------------------------

describe("B23, the robots.txt review", () => {
  it("says nothing about a file that is only Shopify's own disallows", () => {
    const stock =
      "User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\n" +
      "Disallow: /search\nDisallow: /policies/\n";
    expect(checkRobotsReview(reviewRobots({ fetched: true, content: stock }))).toBeNull();
  });

  it("says nothing at all when robots.txt could not be fetched", () => {
    // Silent, never "clean": an unreachable file is not an unedited one.
    expect(checkRobotsReview(reviewRobots({ fetched: false, content: "" }))).toBeNull();
    expect(checkRobotsReview(null)).toBeNull();
  });

  it("separates the lines Shopify ships from the ones it does not recognise", () => {
    const edited = "User-agent: *\nDisallow: /admin\nDisallow: /secret-sale\n";
    const review = reviewRobots({ fetched: true, content: edited });
    expect(review.defaults).toEqual(["/admin"]);
    expect(review.custom).toEqual(["/secret-sale"]);
    const finding = checkRobotsReview(review)!;
    expect((finding.detail as any).defaults).toBe(1);
    const sentence = describeFinding(finding);
    expect(sentence).toContain("not part of the file Shopify ships");
    expect(sentence).toContain("/secret-sale");
    expect(sentence).toContain("robots.txt.liquid");
  });

  it("names a rule that blocks products or collections, with the rule itself", () => {
    const review = reviewRobots({
      fetched: true,
      content: "User-agent: *\nDisallow: /collections/\nDisallow: /admin\n",
    });
    expect(review.blocking).toEqual([{ path: "/collections/", rule: "/collections/" }]);
    expect(describeFinding(checkRobotsReview(review)!)).toContain("robots.txt blocks /collections/");
  });

  it("obeys the same precedence productsDisallow does: a longer Allow wins", () => {
    const review = reviewRobots({
      fetched: true,
      content: "User-agent: *\nDisallow: /\nAllow: /products/\nAllow: /collections/\n",
    });
    expect(review.blocking).toEqual([]);
  });
});

// --- B16 and B21 inside the pass: the budget and the cross-page comparison ---

describe("B16 and the daily budget", () => {
  /** A page carrying `n` distinct internal links and nothing else wrong. */
  function pageWithLinks(n: number): string {
    const hrefs = Array.from({ length: n }, (_, i) => `<a href="/collections/c${i}">x</a>`).join("");
    return CLEAN.replace("</body>", `${hrefs}</body>`);
  }

  function linkRoutedFetch(page: string, linkStatus: (url: string) => number) {
    const productUrls: string[] = [];
    const linkUrls: string[] = [];
    const impl = vi.fn(async (url: string, init?: any) => {
      if (url.endsWith("/robots.txt")) return reply(ROBOTS_OPEN);
      if (url.includes("/sitemap")) return reply("not found", { status: 404 });
      if (url.includes("/collections/")) {
        linkUrls.push(`${init?.method ?? "GET"} ${url}`);
        return reply("", { status: linkStatus(url), url });
      }
      productUrls.push(url);
      return reply(page, { url: URL_A });
    });
    return { impl, productUrls, linkUrls };
  }

  it("checks at most 20 links on a page with 200, and says so on the row", async () => {
    settings(0);
    mockFindMany.mockImplementation(answerFindMany(rows(1)));
    counts({ rows: 1, waiting: 0 });
    const { impl, linkUrls } = linkRoutedFetch(pageWithLinks(200), (url) =>
      url.endsWith("/c3") ? 404 : 200,
    );

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    // Exactly the cap, and HEAD rather than GET: the question is whether the
    // address answers, and HEAD is the cheaper request for the merchant's own
    // storefront.
    expect(linkUrls).toHaveLength(20);
    expect(linkUrls.every((call) => call.startsWith("HEAD "))).toBe(true);
    expect(report.links).toEqual({ fetched: 20, pages: 1, capped: 1 });

    const written = mockUpdate.mock.calls[0][0].data.findings as any[];
    const b16 = written.find((f) => f.code === "B16");
    expect(b16.detail.checked).toBe(20);
    expect(b16.detail.total).toBe(200);
    expect(b16.detail.capped).toBe(true);
    expect(describeFinding(b16)).toContain("20 of 200 links on the page were checked");
  });

  it("charges each distinct link once to the budget, however many pages carry it", async () => {
    // The arithmetic, stated: 3 pages, each carrying the same 2 links.
    // 1 sitemap fetch (404) + 3 page fetches + 2 link fetches = 6 requests,
    // and the second and third page cost no link fetch at all.
    settings(0);
    mockFindMany.mockImplementation(answerFindMany(rows(3)));
    counts({ rows: 3, waiting: 0 });
    const page = CLEAN.replace(
      "</body>",
      '<a href="/collections/a">a</a><a href="/collections/b">b</a></body>',
    );
    const { impl, productUrls, linkUrls } = linkRoutedFetch(page, () => 200);

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(productUrls).toHaveLength(3);
    expect(linkUrls).toHaveLength(2);
    expect(report.links).toEqual({ fetched: 2, pages: 3, capped: 0 });

    // And every one of those six requests is on the counter. A budget that
    // counted only pages would be a figure about pages rather than a limit on
    // what this app asks of a storefront.
    const spends = mockSettingUpsert.mock.calls.filter(
      (c: any) => c[0].create.key === SPEND_SETTING_KEY,
    );
    expect(spends).toHaveLength(6);
    expect(spends[spends.length - 1][0].update.value).toContain('"pages":6');
  });

  it("reads fewer pages when links spend the allowance, and stops on budget", async () => {
    // 5 of budget: 1 sitemap + 1 page + 3 links = 5, and the second page is
    // never fetched. `scanned` is 1, not 2, and the pass says the budget
    // stopped it - counting pages alone would have called this night finished.
    settings(0);
    mockFindMany.mockImplementation(answerFindMany(rows(4)));
    counts({ rows: 4, waiting: 3 });
    const page = CLEAN.replace(
      "</body>",
      '<a href="/collections/a">a</a><a href="/collections/b">b</a><a href="/collections/c">c</a></body>',
    );
    const { impl, productUrls, linkUrls } = linkRoutedFetch(page, () => 200);

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 5,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(productUrls).toHaveLength(1);
    expect(linkUrls).toHaveLength(3);
    expect(report.scanned).toBe(1);
    expect(report.stopped).toBe("budget");
  });

  it("stops checking links mid-page when the allowance runs out, and says how many it checked", async () => {
    // 3 of budget: 1 sitemap + 1 page + 1 link. Two of the page's three links
    // are never fetched, and the row says one was checked - never that the
    // other two answered.
    settings(0);
    mockFindMany.mockImplementation(answerFindMany(rows(1)));
    counts({ rows: 1, waiting: 0 });
    const page = CLEAN.replace(
      "</body>",
      '<a href="/collections/a">a</a><a href="/collections/b">b</a><a href="/collections/c">c</a></body>',
    );
    const { impl, linkUrls } = linkRoutedFetch(page, () => 404);

    await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 3,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(linkUrls).toHaveLength(1);
    const written = mockUpdate.mock.calls[0][0].data.findings as any[];
    const b16 = written.find((f) => f.code === "B16");
    expect(b16.detail.checked).toBe(1);
    expect(b16.detail.total).toBe(3);
    expect(describeFinding(b16)).toContain("1 of 3 links on the page were checked");
  });

  it("spends nothing on the links of a page that answered with the password form", async () => {
    settings(0);
    mockFindMany.mockImplementation(answerFindMany(rows(1)));
    counts({ rows: 1, waiting: 0 });
    const { impl, linkUrls } = linkRoutedFetch(
      PASSWORD_FORM + '<a href="/collections/a">a</a>',
      () => 200,
    );

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(linkUrls).toEqual([]);
    expect(report.links).toEqual({ fetched: 0, pages: 0, capped: 0 });
  });
});

describe("B21 across the pass", () => {
  it("names the other handle sharing the title, from a title stored on an earlier night", async () => {
    settings(0);
    const all = [
      { ...rows(1)[0], id: "r1", productId: "p1", handle: "chair-a", scannedAt: null },
      {
        ...rows(1)[0],
        id: "r2",
        productId: "p2",
        handle: "chair-b",
        scannedAt: new Date("2026-01-01"),
        // Read on an earlier night; only its stored title takes part tonight.
        pageTitle: "A chair in solid oak, natural finish",
      },
    ] as any;
    mockFindMany.mockImplementation(answerFindMany(all));
    counts({ rows: 2, waiting: 0 });
    const { impl } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 3,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    const first = mockUpdate.mock.calls[0][0].data;
    expect(first.pageTitle).toBe("A chair in solid oak, natural finish");
    const b21 = (first.findings as any[]).find((f) => f.code === "B21");
    expect(b21.detail.others).toEqual(["chair-b"]);
    expect(b21.detail.sharedWith).toBe(1);
  });

  it("stays silent when no other page has been read yet", async () => {
    settings(0);
    mockFindMany.mockImplementation(answerFindMany(rows(1)));
    counts({ rows: 1, waiting: 0 });
    const { impl } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 3,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    const findings = mockUpdate.mock.calls[0][0].data.findings as any[];
    expect(findings.some((f) => f.code === "B21")).toBe(false);
  });
});
