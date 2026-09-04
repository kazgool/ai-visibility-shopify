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
  robotsRulesFor,
  scanShopPages,
  type PageRead,
} from "../seo-page.server";

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

const CANONICAL = `<link rel="canonical" href="${URL_A}">`;
const MIRROR_LINK = `<link rel="alternate" href="${ORIGIN}/apps/ai-visibility/a-chair">`;

/** A page with nothing wrong with it: one theme node, self canonical, our block. */
const CLEAN = CANONICAL + productLd(`${URL_A}#product-theme`) + MIRROR_LINK;

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
      CANONICAL + productLd(`${URL_A}#product-theme`) + productLd(`${URL_A}#product`);
    const row = readingOf(page(html), null);
    const b1 = row.findings.find((f) => f.code === "B1");
    expect(b1?.detail).toMatchObject({ productNodes: 2, emitters: ["theme", "app"] });
  });

  it("B1: extend mode reusing the theme's id is one node, not a conflict", () => {
    const html = CANONICAL + productLd(`${URL_A}#product`) + productLd(`/products/a-chair#product`);
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

function routedFetch(pages: (url: string) => Response, robots = ROBOTS_OPEN) {
  const productUrls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    if (url.endsWith("/robots.txt")) return reply(robots);
    productUrls.push(url);
    return pages(url);
  });
  return { impl, productUrls };
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
    const { impl, productUrls } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 5,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

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
      budget: 3,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(productUrls).toEqual([
      `${ORIGIN}/products/never`,
      `${ORIGIN}/products/older`,
      `${ORIGIN}/products/old`,
    ]);
    // And the ordering the query asks for is the one that produces it.
    expect(mockFindMany.mock.calls[0][0].orderBy[0]).toEqual({
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
    settings(497);
    mockFindMany.mockImplementation(answerFindMany(rows(12)));
    counts({ rows: 12, waiting: 9 });
    const { impl, productUrls } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    // 500 budget less the 497 already spent today: three pages, not twelve.
    expect(mockFindMany.mock.calls[0][0].take).toBe(3);
    expect(productUrls).toHaveLength(3);
    expect(report.scanned).toBe(3);
    expect(report.stopped).toBe("budget");
    // One write per page, as it is spent, and the counter reaches the budget.
    const spends = mockSettingUpsert.mock.calls.filter(
      (c: any) => c[0].create.key === SPEND_SETTING_KEY,
    );
    expect(spends).toHaveLength(3);
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
