import { describe, it, expect, vi, beforeEach } from "vitest";

// The since-card's CSV route (PRD-SEO-FULL-ONPAGE section 1.3).
//
// Same shape as app.report.export.test.ts, and it exists for the same two
// defects that route's header describes: a default export would make Remix
// render a screen instead of sending a file, and an entitlement inherited from
// a parent route is not enforced at all on a resource route, because Remix runs
// only this loader on this request. Both are asserted rather than assumed.

const authenticate = { admin: vi.fn() };
const db = { shop: { findUnique: vi.fn() } };
const isSeoUnlocked = vi.fn();
const readSeoSnapshot = vi.fn();
const readCurrentFacts = vi.fn();

vi.mock("../../shopify.server", () => ({ authenticate }));
vi.mock("../../db.server", () => ({ default: db }));
vi.mock("../../services/billing.server", () => ({ isSeoUnlocked }));
vi.mock("../../services/seo-snapshot.server", async () => {
  // serialiseFacts is the real one: the route and the screen must flatten a
  // row the same way, and a stub here would let them drift.
  const actual = await vi.importActual<Record<string, unknown>>("../../services/seo-snapshot.server");
  return {
    ...actual,
    readSeoSnapshot: (...a: unknown[]) => readSeoSnapshot(...(a as [])),
    readCurrentFacts: (...a: unknown[]) => readCurrentFacts(...(a as [])),
  };
});

// seo-snapshot.server reaches catalogue.server, which reaches shopify.server
// through nothing at all now - but fetchAllProducts is still a real bulk
// operation and has no business being importable here.
vi.mock("../../services/catalogue.server", () => ({ fetchAllProducts: vi.fn() }));

function row(over: Record<string, unknown> = {}) {
  return {
    takenAt: new Date("2026-09-05T08:00:00.000Z"),
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
    findingsByCode: null,
    pagesRead: 0,
    writtenSince: null,
    writtenSinceAt: null,
    ...over,
  };
}

async function load(table: string) {
  const { loader } = await import("../app.seo.export.$table");
  return loader({
    request: new Request(`https://example.test/app/seo/export/${table}`),
    params: { table },
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
  readSeoSnapshot.mockResolvedValue(row());
  readCurrentFacts.mockResolvedValue(
    row({ takenAt: new Date("2026-09-20T03:45:00.000Z"), takenBy: "current", metaTitleSet: 45 }),
  );
});

describe("the SEO export route", () => {
  it("exports the comparison as a CSV attachment", async () => {
    const res = await load("since");
    const body = await res.text();

    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("ai-visibility-seo-since.csv");
    expect(body).toContain("2026-09-05T08:00:00.000Z");
    expect(body).toContain("2026-09-20T03:45:00.000Z");
    expect(body).toContain("Products with a meta title,30,50,45,50,+15");
  });

  it("puts the byte order mark on the file, for Excel on Windows", async () => {
    // Asserted on the bytes and not on the text: Response.text() strips a
    // leading BOM by specification, so a string assertion here can only ever
    // fail. The Report export's test found this first.
    const bytes = new Uint8Array(await (await load("since")).arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("exports the written list as its own file", async () => {
    const res = await load("written");
    expect(res.headers.get("Content-Disposition")).toContain("ai-visibility-seo-written.csv");
    expect(await res.text()).toContain("Snapshot taken");
  });

  it("refuses a shop without the SEO key, on this route's own gate", async () => {
    isSeoUnlocked.mockResolvedValue(false);
    const res = await load("since");
    expect(res.status).toBe(402);
  });

  it("refuses rather than exporting today's figures under a since heading", async () => {
    readSeoSnapshot.mockResolvedValue(null);
    const res = await load("since");
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("nothing to compare today against");
  });

  it("answers 404 for a table it does not have", async () => {
    expect((await load("families")).status).toBe(404);
  });

  it("exports no default component, or Remix would render a screen instead", async () => {
    const mod = await import("../app.seo.export.$table");
    expect((mod as Record<string, unknown>).default).toBeUndefined();
  });
});
