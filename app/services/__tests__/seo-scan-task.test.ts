// The nightly page-scan task (PRD-SEO-PER-PRODUCT section 3): what it does
// before it fetches anything.
//
// The acceptance row this file exists for is the negative one - "a shop
// without the SEO key gets no seo_scan JobRun at all". A refused row would
// put a job nobody asked for on the dashboard of every shop in the database,
// every night, and a refusal is not a cheaper way of saying "this is not part
// of your plan" when the merchant never pressed anything.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockShopFindMany = vi.fn();
const mockSettingFindUnique = vi.fn();
const mockJobRunCreate = vi.fn();
const mockJobRunUpdate = vi.fn();

vi.mock("../../db.server", () => ({
  default: {
    shop: { findMany: (...a: unknown[]) => mockShopFindMany(...a), findUnique: vi.fn() },
    setting: { findUnique: (...a: unknown[]) => mockSettingFindUnique(...a), upsert: vi.fn() },
    jobRun: {
      create: (...a: unknown[]) => mockJobRunCreate(...a),
      update: (...a: unknown[]) => mockJobRunUpdate(...a),
      findFirst: vi.fn(),
    },
    session: { findFirst: vi.fn() },
  },
}));

const mockIsSeoUnlocked = vi.fn();
const mockMayProcessAutomatically = vi.fn();
vi.mock("../billing.server", () => ({
  hasPaidAccess: vi.fn(),
  isSeoUnlocked: (...a: unknown[]) => mockIsSeoUnlocked(...a),
  mayProcessAutomatically: (...a: unknown[]) => mockMayProcessAutomatically(...a),
  mayProcessAutomaticallyCached: vi.fn(),
}));

const graphql = vi.fn();
const mockAdminGraphql = vi.fn();
vi.mock("../admin.server", () => ({
  adminGraphql: (...a: unknown[]) => mockAdminGraphql(...a),
}));

const mockScanShopPages = vi.fn();
const mockDailyBudget = vi.fn();
const mockRefreshCurrentPageFacts = vi.fn(
  async (_shopId: string): Promise<{ written: boolean; reason?: string }> => ({
    written: false,
    reason: "no_current",
  }),
);
vi.mock("../seo-snapshot.server", () => ({
  refreshCurrentPageFacts: (shopId: string) => mockRefreshCurrentPageFacts(shopId),
}));
vi.mock("../seo-page.server", () => ({
  scanShopPages: (...a: unknown[]) => mockScanShopPages(...a),
  dailyBudget: (...a: unknown[]) => mockDailyBudget(...a),
  // The real clamp, not a stub: the nightly task passes no cap, and a stub
  // that returned the budget unconditionally would hide a wrong argument
  // order here. scripts/run-seo-scan.ts is what passes a cap, and the clamp
  // itself is tested in seo-page.test.ts.
  cappedBudget: (budget: number, cap?: number | null) =>
    cap === null || cap === undefined || !Number.isFinite(cap)
      ? budget
      : Math.max(0, Math.min(budget, Math.floor(cap))),
}));

// Imported by worker/tasks.ts; mocked so importing the task list needs no
// .env and touches no network. Same shape as billing-gates.test.ts.
vi.mock("../extract.server", () => ({
  runBulkExtract: vi.fn(),
  extractOneProduct: vi.fn(),
  withdrawIfIneligible: vi.fn(),
  dictionaryFor: vi.fn(),
  extraStopwordsFor: vi.fn(),
}));
vi.mock("../catalogue.server", () => ({ fetchAllProducts: vi.fn() }));
vi.mock("../alt-text.server", () => ({ writeAltText: vi.fn() }));
vi.mock("../mirror-reconcile.server", () => ({ reconcileMirrors: vi.fn() }));
vi.mock("../eligibility.server", () => ({
  prefsFor: async () => ({ includeOutOfStock: true, includeUnlisted: false }),
}));
vi.mock("../../shopify.server", () => ({
  authenticate: { admin: vi.fn() },
}));

import { seo_scan_products } from "../../../worker/tasks";

const SHOP = { id: "shop1", domain: "nordwood.myshopify.com", plan: "annual" };
const helpers = { logger: { info: vi.fn(), error: vi.fn() } } as any;

const REPORT = {
  budget: 500,
  scanned: 500,
  password: 0,
  failed: 0,
  remaining: 19500,
  nightsToFinish: 39,
  byCode: { B1: 12 },
  stopped: "budget",
  fromCache: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockShopFindMany.mockResolvedValue([SHOP]);
  mockAdminGraphql.mockResolvedValue(graphql);
  graphql.mockResolvedValue({ shop: { url: "https://nordwood.example" } });
  mockDailyBudget.mockResolvedValue(500);
  mockSettingFindUnique.mockResolvedValue({ value: "test-storefront-password" });
  mockJobRunCreate.mockResolvedValue({ id: "job1" });
  mockScanShopPages.mockResolvedValue(REPORT);
});

describe("seo_scan_products", () => {
  it("creates no JobRun, and asks Shopify nothing, for a shop without the SEO key", async () => {
    mockIsSeoUnlocked.mockResolvedValue(false);

    await seo_scan_products({}, helpers);

    expect(mockJobRunCreate).not.toHaveBeenCalled();
    expect(mockAdminGraphql).not.toHaveBeenCalled();
    expect(mockScanShopPages).not.toHaveBeenCalled();
  });

  it("creates no JobRun for a shop with the key but no subscription", async () => {
    mockIsSeoUnlocked.mockResolvedValue(true);
    mockMayProcessAutomatically.mockResolvedValue(false);

    await seo_scan_products({}, helpers);

    expect(mockJobRunCreate).not.toHaveBeenCalled();
    expect(mockScanShopPages).not.toHaveBeenCalled();
    expect(helpers.logger.info).toHaveBeenCalled();
  });

  it("scans the shop's own primary domain, under its own budget, with its password", async () => {
    mockIsSeoUnlocked.mockResolvedValue(true);
    mockMayProcessAutomatically.mockResolvedValue(true);

    await seo_scan_products({}, helpers);

    expect(mockJobRunCreate.mock.calls[0][0].data).toMatchObject({
      shopId: "shop1",
      kind: "seo_scan",
      status: "running",
    });
    expect(mockScanShopPages.mock.calls[0][0]).toMatchObject({
      shopId: "shop1",
      origin: "https://nordwood.example",
      password: "test-storefront-password",
      budget: 500,
    });
  });

  it("writes scanned, remaining and nightsToFinish into the JobRun report", async () => {
    mockIsSeoUnlocked.mockResolvedValue(true);
    mockMayProcessAutomatically.mockResolvedValue(true);

    await seo_scan_products({}, helpers);

    const data = mockJobRunUpdate.mock.calls.at(-1)?.[0].data;
    expect(data.status).toBe("done");
    expect(data.report).toMatchObject({ scanned: 500, remaining: 19500, nightsToFinish: 39 });
    expect(data.progress).toBe(500);
    // The denominator is the catalogue still waiting, not tonight's budget.
    expect(data.total).toBe(20000);
  });

  it("refreshes the since card's today row, page half, once the scan is done (R2 U3)", async () => {
    mockIsSeoUnlocked.mockResolvedValue(true);
    mockMayProcessAutomatically.mockResolvedValue(true);
    mockRefreshCurrentPageFacts.mockClear();

    await seo_scan_products({}, helpers);

    expect(mockRefreshCurrentPageFacts).toHaveBeenCalledTimes(1);
    expect(mockRefreshCurrentPageFacts).toHaveBeenCalledWith("shop1");
    // After the JobRun is marked done, so a failed refresh cannot undo a scan
    // that happened.
    const doneIndex = mockJobRunUpdate.mock.calls.findIndex((c) => c[0].data.status === "done");
    expect(doneIndex).toBeGreaterThanOrEqual(0);
    expect(mockRefreshCurrentPageFacts.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockJobRunUpdate.mock.invocationCallOrder[doneIndex],
    );
  });

  it("still returns a done scan when the refresh throws", async () => {
    mockIsSeoUnlocked.mockResolvedValue(true);
    mockMayProcessAutomatically.mockResolvedValue(true);
    mockRefreshCurrentPageFacts.mockRejectedValueOnce(new Error("Neon away"));

    await seo_scan_products({}, helpers);

    const data = mockJobRunUpdate.mock.calls.at(-1)?.[0].data;
    expect(data.status).toBe("done");
  });

  // CC-PROMPT-AI-READABILITY-2 item 3: a scan past 30 minutes read "stuck"
  // under job-stale.ts while it ran, because neither row was written between
  // its start and its end.
  it("beats on the scan's own row and on the request row while pages are read", async () => {
    mockIsSeoUnlocked.mockResolvedValue(true);
    mockMayProcessAutomatically.mockResolvedValue(true);
    let t = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => t);
    mockScanShopPages.mockImplementation(async (input: any) => {
      for (let page = 1; page <= 25; page++) {
        // A slow minute in the middle of the night's read.
        if (page === 15) t += 61_000;
        await input.deps.onProgress(page, 500);
      }
      return REPORT;
    });
    try {
      await seo_scan_products({ shopId: "shop1", jobRunId: "req1" }, helpers);
    } finally {
      spy.mockRestore();
    }

    const writes = mockJobRunUpdate.mock.calls.map((call) => call[0]);
    // The scan's own row: the page count every ten pages, or after a minute.
    expect(
      writes
        .filter((w) => w.where.id === "job1" && w.data.status === undefined)
        .map((w) => w.data),
    ).toEqual([
      { progress: 10, total: 500 },
      { progress: 15, total: 500 },
      { progress: 25, total: 500 },
    ]);
    // The request row counts shops, so it only gets a sign of life, once.
    const touches = writes.filter((w) => w.where.id === "req1" && w.data.updatedAt);
    expect(touches).toHaveLength(1);
    expect(touches[0].data).toEqual({ updatedAt: expect.any(Date) });
    // And the request row still ends done.
    expect(writes.filter((w) => w.where.id === "req1").at(-1)?.data.status).toBe("done");
  });

  it("marks the JobRun failed and does not take the other shops down with it", async () => {
    mockIsSeoUnlocked.mockResolvedValue(true);
    mockMayProcessAutomatically.mockResolvedValue(true);
    mockShopFindMany.mockResolvedValue([SHOP, { ...SHOP, id: "shop2", domain: "b.myshopify.com" }]);
    mockScanShopPages.mockRejectedValueOnce(new Error("storefront down"));

    await seo_scan_products({}, helpers);

    const failed = mockJobRunUpdate.mock.calls[0][0].data;
    expect(failed.status).toBe("failed");
    expect(failed.report.error).toContain("storefront down");
    // The second shop still had its night.
    expect(mockScanShopPages).toHaveBeenCalledTimes(2);
  });
});
