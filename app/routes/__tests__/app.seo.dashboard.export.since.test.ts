import { describe, it, expect, vi, beforeEach } from "vitest";

// The merchant dashboard's then-and-now spreadsheet (QA of 5 September 2026,
// R1 2.4 and R2-12). Same shape as app.seo.export.test.ts and for the same
// two defects: a default export would make Remix render a screen instead of
// sending a file, and a gate inherited from a parent is not enforced on a
// resource route. Both asserted, plus the thing this route exists for: the
// file carries the merchant's words and never the operator's.

const authenticate = { admin: vi.fn() };
const db = { shop: { findUnique: vi.fn() } };
const isSeoUnlocked = vi.fn();
const readSeoDashboardSource = vi.fn();

vi.mock("../../shopify.server", () => ({ authenticate }));
vi.mock("../../db.server", () => ({ default: db }));
vi.mock("../../services/billing.server", () => ({ isSeoUnlocked }));
vi.mock("../../services/seo-dashboard.server", () => ({ readSeoDashboardSource }));

function facts(over: Record<string, unknown> = {}) {
  return {
    takenAt: "2026-09-05T08:00:00.000Z",
    takenBy: "unlock",
    products: 50,
    metaTitleSet: 30,
    metaTitleOurs: 0,
    metaDescriptionSet: 30,
    metaDescriptionOurs: 0,
    withBarcode: 0,
    withVendor: 50,
    withSku: 50,
    withImage: 1,
    productNodeTheme: null,
    productNodeNone: null,
    themeNodeTypes: null,
    findingsByCode: { A1: 50, B17: 12 },
    pagesRead: 0,
    writtenSince: null,
    writtenSinceAt: null,
    ...over,
  };
}

function source(over: Record<string, unknown> = {}) {
  return {
    domain: "republicabio.ro",
    findings: { products: 50, bulkRead: 50, pagesAttempted: 50, pagesRead: 50, couldNotBeRead: 0, neverScanned: 0, rows: [], clean: [] },
    readiness: { products: 50, catalogueRead: 50, pagesRead: 50, readSet: 50, awaitingPage: 0, clean: 50, merchant: 0, theme: 0, app: 0, notChecked: 0, needSomething: 0, groups: [], shopWideCodes: [], lastPageReadAt: null, lastCatalogueReadAt: null },
    blockedBy: null,
    since: {
      before: facts(),
      today: facts({ takenAt: "2026-09-20T03:45:00.000Z", takenBy: "current", metaTitleOurs: 9 }),
    },
    business: null,
    published: { at: null, reasons: [] },
    ...over,
  };
}

async function load() {
  const { loader } = await import("../app.seo_.dashboard.export.since");
  return loader({
    request: new Request("https://example.test/app/seo/dashboard/export/since"),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.admin.mockResolvedValue({
    session: { shop: "mrdigital-dev.myshopify.com" },
    admin: { graphql: vi.fn() },
  });
  db.shop.findUnique.mockResolvedValue({ id: "shop1" });
  isSeoUnlocked.mockResolvedValue(true);
  readSeoDashboardSource.mockResolvedValue(source());
});

describe("the merchant then-and-now export", () => {
  it("writes the merchant's labels, the shop and the date in the name, and no check code", async () => {
    const res = await load();
    const body = await res.text();
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /ai-visibility-seo-republicabio-ro-since-\d{4}-\d{2}-\d{2}\.csv/,
    );
    expect(body).toContain("republicabio.ro - 50 of 50 products fully checked");
    expect(body).toContain("Titles for Google written by this app,0,50,9,50,+9");
    expect(body).not.toMatch(/\b[AB]\d{1,2}\b/);
    expect(body).not.toMatch(/\bmeta\b/i);
    expect(body).not.toMatch(/\bsnapshot\b/i);
    expect(body).not.toContain("by unlock");
  });

  it("puts the byte order mark on the file", async () => {
    const bytes = new Uint8Array(await (await load()).arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("refuses a shop without the SEO key, on this route's own gate, before reading anything", async () => {
    isSeoUnlocked.mockResolvedValue(false);
    const res = await load();
    expect(res.status).toBe(402);
    expect(readSeoDashboardSource).not.toHaveBeenCalled();
  });

  it("refuses a shop with no row at all", async () => {
    db.shop.findUnique.mockResolvedValue(null);
    expect((await load()).status).toBe(402);
    expect(readSeoDashboardSource).not.toHaveBeenCalled();
  });

  it("refuses rather than exporting today's figures under a since heading", async () => {
    readSeoDashboardSource.mockResolvedValue(source({ since: { before: null, today: facts() } }));
    const res = await load();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("nothing to compare today against");
  });

  it("exports no default component, or Remix would render a screen instead", async () => {
    const mod = await import("../app.seo_.dashboard.export.since");
    expect((mod as Record<string, unknown>).default).toBeUndefined();
  });
});
