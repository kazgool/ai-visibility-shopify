import { describe, it, expect, vi, beforeEach } from "vitest";

// The CSV export route. This is the test that would have caught the defect it
// exists because of: the export used to live on the Report screen's own
// loader, and that route has a default export, so Remix treated the Response
// as loader data and rendered the screen instead of sending a file. A route
// with no default export is a resource route and its Response goes out as it
// stands - which is only true as long as nobody adds a component to this file,
// so that is asserted too.

const authenticate = { admin: vi.fn() };
const db = {
  shop: { findUnique: vi.fn() },
  jobRun: { findFirst: vi.fn() },
};
const hasPaidAccess = vi.fn();

vi.mock("../../shopify.server", () => ({ authenticate }));
vi.mock("../../db.server", () => ({ default: db }));
vi.mock("../../services/billing.server", () => ({ hasPaidAccess }));

const REPORT = {
  sampled: 5,
  none: 1,
  byAttr: [
    ["Material", 5],
    ["Dimensions", 4],
  ],
  byAttrProducts: [
    ["Material", 4],
    ["Dimensions", 3],
  ],
  depth: [0, 1, 4, 6, 18],
  wouldSkip: 0,
  weakest: [{ title: "Oslo sofa, grey", families: ["Material"], id: "gid://shopify/Product/1" }],
};

async function load(table: string) {
  const { loader } = await import("../app.report.export.$table");
  return loader({
    request: new Request(`https://example.test/app/report/export/${table}`),
    params: { table },
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.admin.mockResolvedValue({
    admin: { graphql: vi.fn() },
    session: { shop: "example.myshopify.com" },
  });
  db.shop.findUnique.mockResolvedValue({ id: "shop_1", domain: "example.myshopify.com" });
  db.jobRun.findFirst.mockResolvedValue({
    status: "done",
    report: REPORT,
    startedAt: new Date("2026-08-31T08:00:00.000Z"),
    finishedAt: new Date("2026-08-31T08:04:00.000Z"),
  });
  hasPaidAccess.mockResolvedValue(true);
});

describe("the CSV export route", () => {
  it("is a resource route: no default export, so Remix sends the Response itself", async () => {
    const mod = await import("../app.report.export.$table");
    expect((mod as Record<string, unknown>).default).toBeUndefined();
  });

  it("returns a real CSV file, with the header Content-Disposition needs", async () => {
    const res = await load("families");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    // The shop and the date in the name, like every other download of this
    // app (5 September 2026); "report" because the attribute pass is not the
    // SEO module.
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="ai-visibility-report-example-families-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(await res.text()).toBe(
      [
        // No byte order mark here: Response.text() strips a leading BOM by
        // specification, so this asserts the content and the test below
        // asserts the three bytes on the wire.
        "Attribute family,Products stating it,Products read",
        "Material,4,5",
        "Dimensions,3,5",
        "",
      ].join("\r\n"),
    );
  });

  it("exports the weakest table under its own name", async () => {
    const res = await load("weakest");
    const body = await res.text();
    expect(res.headers.get("Content-Disposition")).toMatch(
      /ai-visibility-report-example-weakest-\d{4}-\d{2}-\d{2}\.csv/,
    );
    expect(body).toContain("Product,Families found,Families in this catalogue,Missing");
    expect(body).toContain('"Oslo sofa, grey",1,2,Dimensions');
  });

  it("starts both files with a UTF-8 byte order mark, for Excel on Windows", async () => {
    // Without it Excel opens a UTF-8 CSV in the system code page and mangles
    // the diacritics in family names and product titles. The content type is
    // unchanged; the mark is three bytes at the front of the body.
    for (const table of ["families", "weakest"]) {
      const res = await load(table);
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    }
  });

  it("carries the paid gate itself, because no parent loader runs on this path", async () => {
    hasPaidAccess.mockResolvedValue(false);
    const res = await load("families");
    expect(res.status).toBe(402);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });

  it("refuses to invent a file when no pass has finished", async () => {
    db.jobRun.findFirst.mockResolvedValue({
      status: "failed",
      report: { error: "Admin API returned 502" },
      startedAt: new Date("2026-08-31T08:00:00.000Z"),
      finishedAt: new Date("2026-08-31T08:01:00.000Z"),
    });
    const res = await load("families");
    expect(res.status).toBe(409);
  });

  it("does not serve a table it does not have", async () => {
    const res = await load("everything");
    expect(res.status).toBe(404);
  });
});
