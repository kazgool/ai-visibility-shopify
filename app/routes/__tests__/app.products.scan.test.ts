import { describe, it, expect, vi, beforeEach } from "vitest";

// The product editor's "Read this page now" button (PRD-SEO-PER-PRODUCT
// section 4, build step 5, and the acceptance row "The product editor's
// button runs one fetch and the second render shows the new scannedAt").
//
// This file exists because that row had no test. The wave's suite covered
// scanOneProductPage - the service the button calls - and nothing covered the
// action itself or, more to the point, what the screen reads afterwards.
// That is the gap CLAUDE.md names: the verification is not finished until the
// second render is accounted for, and every test being green is exactly how
// two bugs of that shape shipped before. So the assertions here are about the
// route: that the action runs one fetch behind the SEO key and no other gate,
// that its refusals are sentences rather than exceptions, and that the value
// the section shows afterwards comes off the row and never off what the
// action returned.

const authenticate = { admin: vi.fn() };
const db = {
  shop: { findUnique: vi.fn() },
  setting: { findUnique: vi.fn() },
  mirrorCache: { findUnique: vi.fn() },
  jobRun: { findFirst: vi.fn() },
  crawlerCheck: { findMany: vi.fn() },
};
const isSeoUnlocked = vi.fn();
const hasPaidAccess = vi.fn();
const isFreeProduct = vi.fn();
const scanOneProductPage = vi.fn();
const pageBudget = vi.fn();
const robotsBlock = vi.fn();
const scanRowFor = vi.fn();

vi.mock("../../shopify.server", () => ({ authenticate }));
vi.mock("../../db.server", () => ({ default: db }));
vi.mock("../../services/billing.server", () => ({
  isSeoUnlocked,
  hasPaidAccess,
  isFreeProduct,
}));
vi.mock("../../services/seo-page.server", () => ({
  scanOneProductPage,
  pageBudget,
  robotsBlock,
  DEFAULT_DAILY_BUDGET: 500,
  dailyBudget: vi.fn(),
}));
vi.mock("../../services/seo-aggregate.server", () => ({ scanRowFor }));
vi.mock("../../services/seo.server", () => ({
  writeSeo: vi.fn(),
  revertSeo: vi.fn(),
  mayWriteSeo: () => true,
  classifyMetaField: () => "app",
  clearSeoHumanFlag: vi.fn(),
}));

const PRODUCT = {
  id: "gid://shopify/Product/1",
  title: "Oslo sofa, grey",
  handle: "oslo-sofa-grey",
  descriptionHtml: "<p>Grey sofa.</p>",
  seo: { title: null, description: null },
  featuredImage: null,
  media: { nodes: [] },
  metafields: { nodes: [] },
  variants: { nodes: [] },
};

const BUDGET = { budget: 500, spent: 3, remaining: 497, day: "2026-09-03" };

async function action(form: Record<string, string>) {
  const { action: routeAction } = await import("../app.products.$id");
  return routeAction({
    request: new Request("https://example.test/app/products/1", {
      method: "POST",
      body: new URLSearchParams(form),
    }),
    params: { id: "1" },
    context: {},
  } as never) as Promise<Record<string, unknown>>;
}

async function loader() {
  const { loader: routeLoader } = await import("../app.products.$id");
  return routeLoader({
    request: new Request("https://example.test/app/products/1"),
    params: { id: "1" },
    context: {},
  } as never) as Promise<Record<string, any>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.admin.mockResolvedValue({
    admin: {
      graphql: vi.fn().mockResolvedValue({
        json: async () => ({
          data: { product: PRODUCT, shop: { name: "Shop", url: "https://shop.example" } },
        }),
      }),
    },
    session: { shop: "example.myshopify.com" },
  });
  db.shop.findUnique.mockResolvedValue({ id: "shop_1", domain: "example.myshopify.com" });
  db.setting.findUnique.mockResolvedValue(null);
  db.mirrorCache.findUnique.mockResolvedValue(null);
  db.jobRun.findFirst.mockResolvedValue(null);
  db.crawlerCheck.findMany.mockResolvedValue([]);
  isSeoUnlocked.mockResolvedValue(true);
  hasPaidAccess.mockResolvedValue(true);
  isFreeProduct.mockResolvedValue(false);
  pageBudget.mockResolvedValue(BUDGET);
  robotsBlock.mockResolvedValue(null);
  scanRowFor.mockResolvedValue(null);
});

describe("the product editor's Read this page now button", () => {
  it("runs exactly one page read and reports no refusal", async () => {
    scanOneProductPage.mockResolvedValue({
      ok: true,
      scannedAt: new Date("2026-09-03T22:00:00.000Z"),
      status: "ok",
      findings: [],
      budget: BUDGET,
    });

    const result = await action({ intent: "seo_scan_page" });

    expect(scanOneProductPage).toHaveBeenCalledTimes(1);
    expect(scanOneProductPage.mock.calls[0][0]).toMatchObject({
      shopId: "shop_1",
      productId: "gid://shopify/Product/1",
    });
    expect(result).toEqual({ scanRefusal: null });
  });

  // Decision 2 of PRD section 7: the key is what is paid for, so the button
  // exists on a free-tier shop's three products. A subscription gate here
  // would take a paid capability away from the shop that bought it.
  it("needs the SEO key and nothing else - not a subscription, not a free slot", async () => {
    hasPaidAccess.mockResolvedValue(false);
    isFreeProduct.mockResolvedValue(false);
    scanOneProductPage.mockResolvedValue({
      ok: true,
      scannedAt: new Date(),
      status: "ok",
      findings: [],
      budget: BUDGET,
    });

    const result = await action({ intent: "seo_scan_page" });

    expect(scanOneProductPage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ scanRefusal: null });
  });

  it("refuses without the SEO key, and fetches nothing", async () => {
    isSeoUnlocked.mockResolvedValue(false);

    const result = await action({ intent: "seo_scan_page" });

    expect(scanOneProductPage).not.toHaveBeenCalled();
    expect(result.error).toContain("not enabled");
  });

  // Refusals are values, not exceptions: the screen has a sentence for each.
  it("turns a spent allowance into a sentence naming the budget", async () => {
    scanOneProductPage.mockResolvedValue({
      ok: false,
      reason: "budget",
      budget: { budget: 500, spent: 500, remaining: 0, day: "2026-09-03" },
    });

    const result = await action({ intent: "seo_scan_page" });

    expect(String(result.scanRefusal)).toContain("500 page reads");
    expect(result.error).toBeUndefined();
  });

  it("turns a robots.txt Disallow into a sentence naming the path", async () => {
    scanOneProductPage.mockResolvedValue({
      ok: false,
      reason: "robots",
      detail: "/products/",
      budget: BUDGET,
    });

    const result = await action({ intent: "seo_scan_page" });

    expect(String(result.scanRefusal)).toContain("/products/");
    expect(String(result.scanRefusal)).toContain("robots.txt.liquid");
  });
});

describe("the second render, after the button", () => {
  // The acceptance row. The action returns only a refusal; every value on the
  // section is read off the row, so what the merchant sees after pressing the
  // button is what was actually written and not what the call happened to
  // return. Asserted by answering scanRowFor with a row the action never saw.
  it("shows the scannedAt and the findings from the row, not from the action", async () => {
    scanRowFor.mockResolvedValue({
      productId: "gid://shopify/Product/1",
      handle: "oslo-sofa-grey",
      bulkAt: new Date("2026-09-03T04:00:00.000Z"),
      scannedAt: new Date("2026-09-03T22:00:00.000Z"),
      status: "ok",
      canonical: "https://shop.example/collections/all/products/oslo-sofa-grey",
      noindex: false,
      appBlock: "present",
      cacheControl: "max-age=300",
      nodes: [],
      findings: [
        { code: "B2", source: "B", detail: { canonical: "https://shop.example/x" } },
        { code: "A1", source: "A", detail: { missing: ["barcode"] } },
      ],
    });

    const data = await loader();

    expect(data.crawlerPage.hasRow).toBe(true);
    expect(data.crawlerPage.scannedAt).toBe("2026-09-03T22:00:00.000Z");
    expect(data.crawlerPage.status).toBe("ok");
    expect(data.crawlerPage.cacheControl).toBe("max-age=300");
    // Both halves of the column, the page's own first: the section is what a
    // crawler sees on this page, and a catalogue finding is context for it.
    expect(data.crawlerPage.findings.map((f: any) => f.code)).toEqual(["B2", "A1"]);
  });

  it("says the page has never been read when the row has no scannedAt", async () => {
    scanRowFor.mockResolvedValue({
      productId: "gid://shopify/Product/1",
      handle: "oslo-sofa-grey",
      bulkAt: new Date("2026-09-03T04:00:00.000Z"),
      scannedAt: null,
      status: null,
      findings: [],
      nodes: null,
    });

    const data = await loader();

    expect(data.crawlerPage.hasRow).toBe(true);
    expect(data.crawlerPage.scannedAt).toBeNull();
  });

  // ENTITLEMENT: no key, no section - the same key the action is behind.
  it("renders no section at all without the SEO key", async () => {
    isSeoUnlocked.mockResolvedValue(false);

    const data = await loader();

    expect(data.crawlerPage).toBeNull();
    expect(scanRowFor).not.toHaveBeenCalled();
  });
});
