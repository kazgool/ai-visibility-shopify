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
const mockSettingFindUnique = vi.fn();

vi.mock("../../db.server", () => ({
  default: {
    seoScan: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      count: (...a: unknown[]) => mockCount(...a),
    },
    setting: { findUnique: (...a: unknown[]) => mockSettingFindUnique(...a) },
  },
}));

import type { OfferFacts } from "../seo-scan";
import {
  DEFAULT_DAILY_BUDGET,
  REQUEST_INTERVAL_MS,
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
    mockCount.mockResolvedValue(7);
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

  it("says the catalogue is finished when nothing is left", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(3)));
    mockCount.mockResolvedValue(0);
    const { impl } = routedFetch(() => reply(CLEAN, { url: URL_A }));

    const report = await scanShopPages({
      shopId: "shop1",
      origin: ORIGIN,
      budget: 500,
      deps: { fetchImpl: impl as any, sleep: noSleep },
    });

    expect(report.stopped).toBe("catalogue");
    expect(report.nightsToFinish).toBe(0);
  });

  it("reads the never-scanned pages before the oldest ones", async () => {
    const all: Row[] = [
      { ...rows(1)[0], id: "old", productId: "p-old", handle: "old", scannedAt: new Date("2026-01-01") },
      { ...rows(1)[0], id: "older", productId: "p-older", handle: "older", scannedAt: new Date("2025-01-01") },
      { ...rows(1)[0], id: "never", productId: "p-never", handle: "never", scannedAt: null },
    ];
    mockFindMany.mockImplementation(answerFindMany(all));
    mockCount.mockResolvedValue(0);
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
    mockCount.mockResolvedValue(0);
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
    mockCount.mockResolvedValue(0);
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
    mockCount.mockResolvedValue(0);
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
    mockCount.mockResolvedValue(10);
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
  });

  it("an unreachable robots.txt does not stop the scan", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(1)));
    mockCount.mockResolvedValue(0);
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
    expect(report.stopped).toBe("catalogue");
  });

  it("unlocks the storefront once, not once per page", async () => {
    mockFindMany.mockImplementation(answerFindMany(rows(3)));
    mockCount.mockResolvedValue(0);
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
