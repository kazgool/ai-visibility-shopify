import { describe, it, expect, vi, beforeEach } from "vitest";

// The before-snapshot of PRD-SEO-FULL-ONPAGE section 1.1, and the acceptance
// rows it is asked to satisfy: the snapshot is written before the key, a
// second grantSeoUnlock does not overwrite it, page-derived fields are null
// (never 0) while source B has not run, and the manual path records its origin
// and refuses a second run.
//
// db.server is stubbed the same way billing.server.test.ts stubs it, with one
// addition that carries the first assertion: every write pushes its name onto
// a shared `order` array, so "the snapshot was written before the key" is
// asserted on the actual sequence and not on two independent call counts,
// which would pass in either order.

const order: string[] = [];

const mockSettingUpsert = vi.fn(async () => {
  order.push("setting");
});
const mockSnapshotFindUnique = vi.fn();
const mockSnapshotUpsert = vi.fn(async () => ({}));
const mockSnapshotCreate = vi.fn(async () => {
  order.push("snapshot");
});
const mockScanFindMany = vi.fn(async () => []);
const mockSettingFindMany = vi.fn(async () => []);

var mockDb: any;

vi.mock("../../db.server", () => {
  mockDb = {
    setting: {
      upsert: (...args: unknown[]) => mockSettingUpsert(...(args as [])),
      findMany: (...args: unknown[]) => mockSettingFindMany(...(args as [])),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    seoSnapshot: {
      findFirst: (...args: unknown[]) => mockSnapshotFindUnique(...(args as [])),
      findUnique: (...args: unknown[]) => mockSnapshotFindUnique(...(args as [])),
      create: (...args: unknown[]) => mockSnapshotCreate(...(args as [])),
      upsert: (...args: unknown[]) => mockSnapshotUpsert(...(args as [])),
    },
    seoScan: {
      findMany: (...args: unknown[]) => mockScanFindMany(...(args as [])),
    },
    shop: { update: vi.fn() },
  };
  return { default: mockDb };
});

const mockFetchAllProducts = vi.fn();

// Replaced whole, never with `importOriginal`. catalogue.server imports
// admin.server, which imports shopify.server, which builds a
// PrismaSessionStorage against the client - and against the stub above there
// is no session table, so importing the real module throws at collection time.
// This is the same failure shape CLAUDE.md's "green locally is not green" rule
// is about, and it fails here rather than only in CI.
vi.mock("../catalogue.server", () => ({
  fetchAllProducts: (...args: unknown[]) => mockFetchAllProducts(...(args as [])),
}));

import { grantSeoUnlock } from "../billing.server";
import {
  recordCurrentFacts,
  snapshotFacts,
  takeSeoSnapshot,
  writtenSince,
} from "../seo-snapshot.server";
import type { CatalogueRead } from "../catalogue.server";
import type { ProductInput } from "../facts.server";
import type { ScanRowLike } from "../seo-aggregate";

/** A complete read of the products given, with the counts Shopify would announce. */
function read(products: ProductInput[]): CatalogueRead {
  return {
    products,
    complete: true,
    objectsMatch: true,
    expected: { root: products.length, objects: products.length },
    read: { root: products.length, objects: products.length },
  };
}

function product(over: Partial<ProductInput> = {}): ProductInput {
  return {
    id: "gid://shopify/Product/1",
    title: "Masa Oslo",
    handle: "masa-oslo",
    vendor: "Nordwood",
    imageUrl: "https://cdn/1.jpg",
    variants: [
      {
        id: "gid://shopify/ProductVariant/1",
        sku: "OSL-1",
        barcode: "5901234123457",
        selectedOptions: [],
      },
    ],
    seo: { title: "Masa Oslo, lemn masiv", description: "Masa de sufragerie" },
    metafields: [],
    ...over,
  };
}

/** A SeoScan row as the reader stores it. `status: "ok"` is a page that answered. */
function scanRow(over: Partial<ScanRowLike> = {}): ScanRowLike {
  return {
    productId: "gid://shopify/Product/1",
    handle: "masa-oslo",
    bulkAt: new Date("2026-09-04T00:00:00Z"),
    scannedAt: null,
    status: null,
    findings: [],
    nodes: [],
    ...over,
  };
}

const graphql = (async () => ({})) as any;

/** The `data` of the single seoSnapshot.create call, typed loosely on purpose. */
function createdData(): any {
  return (mockSnapshotCreate.mock.calls as any[])[0][0].data;
}

beforeEach(() => {
  order.length = 0;
  mockSettingUpsert.mockClear();
  mockSnapshotFindUnique.mockReset();
  mockSnapshotCreate.mockClear();
  mockSnapshotUpsert.mockClear();
  mockScanFindMany.mockReset();
  mockScanFindMany.mockResolvedValue([]);
  mockSettingFindMany.mockReset();
  mockSettingFindMany.mockResolvedValue([]);
  mockFetchAllProducts.mockReset();
  mockFetchAllProducts.mockResolvedValue(read([product()]));
});

describe("grantSeoUnlock and the snapshot", () => {
  it("writes the snapshot before it stores the key", async () => {
    mockSnapshotFindUnique.mockResolvedValue(null);

    await grantSeoUnlock("shop1", "code:2026-09-04", graphql);

    // The order is the guarantee: with the key stored first, a catalogue pass
    // could fire between the two writes and the "before" would already
    // contain this app's own output.
    expect(order).toEqual(["snapshot", "setting"]);
    expect(mockSnapshotCreate).toHaveBeenCalledTimes(1);
    expect(createdData().takenBy).toBe("unlock");
  });

  it("does not overwrite the snapshot on a second call, and still refreshes the key", async () => {
    mockSnapshotFindUnique.mockResolvedValue({
      takenAt: new Date("2026-09-01T10:00:00Z"),
      takenBy: "unlock",
    });

    await grantSeoUnlock("shop1", "code:2026-09-04", graphql);

    expect(mockSnapshotCreate).not.toHaveBeenCalled();
    // Re-entering the key stays harmless; only the snapshot is once-only.
    expect(mockSettingUpsert).toHaveBeenCalledTimes(1);
    // And a shop that already has a row costs no bulk operation at all: the
    // existence check comes before the catalogue read.
    expect(mockFetchAllProducts).not.toHaveBeenCalled();
  });

  it("stores no key when the snapshot cannot be taken", async () => {
    mockSnapshotFindUnique.mockResolvedValue(null);
    // A short read: 40 products parsed of 50 announced.
    mockFetchAllProducts.mockResolvedValue({
      ...read([product()]),
      complete: false,
      expected: { root: 50, objects: 50 },
      read: { root: 40, objects: 40 },
    });

    await expect(grantSeoUnlock("shop1", "code", graphql)).rejects.toThrow(/short/i);

    expect(mockSnapshotCreate).not.toHaveBeenCalled();
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });
});

describe("the manual path", () => {
  it("records its origin", async () => {
    mockSnapshotFindUnique.mockResolvedValue(null);

    const result = await takeSeoSnapshot("shop1", graphql, "manual");

    expect(result.written).toBe(true);
    expect(createdData().takenBy).toBe("manual");
  });

  it("refuses a second run for the same shop and reports the existing row", async () => {
    mockSnapshotFindUnique.mockResolvedValue({
      takenAt: new Date("2026-09-05T08:00:00Z"),
      takenBy: "manual",
    });

    const result = await takeSeoSnapshot("shop1", graphql, "manual");

    expect(result).toEqual({
      written: false,
      reason: "exists",
      takenAt: new Date("2026-09-05T08:00:00Z"),
      takenBy: "manual",
    });
    expect(mockSnapshotCreate).not.toHaveBeenCalled();
  });

  it("does not write a second row when two callers race", async () => {
    // The existence check passes, then the unique index refuses the insert.
    mockSnapshotFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ takenAt: new Date("2026-09-05T08:00:00Z"), takenBy: "unlock" });
    mockSnapshotCreate.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));

    const result = await takeSeoSnapshot("shop1", graphql, "manual");

    expect(result).toEqual({
      written: false,
      reason: "exists",
      takenAt: new Date("2026-09-05T08:00:00Z"),
      takenBy: "unlock",
    });
  });
});

describe("snapshotFacts", () => {
  it("counts the catalogue half against the same predicates check A1 uses", () => {
    const facts = snapshotFacts(
      [
        product({ id: "gid://shopify/Product/1" }),
        product({
          id: "gid://shopify/Product/2",
          vendor: "",
          imageUrl: null,
          variants: [{ id: "v2", sku: "", barcode: null, selectedOptions: [] }],
          seo: { title: "", description: null },
        }),
      ],
      [],
    );

    expect(facts.products).toBe(2);
    expect(facts.withBarcode).toBe(1);
    expect(facts.withSku).toBe(1);
    expect(facts.withVendor).toBe(1);
    expect(facts.withImage).toBe(1);
    expect(facts.metaTitleSet).toBe(1);
    expect(facts.metaDescriptionSet).toBe(1);
  });

  it("counts as ours only a meta field this app wrote, by the shared classifier", () => {
    const state = JSON.stringify({
      seo_title: { source: "auto", at: "2026-08-01T00:00:00Z" },
    });
    const facts = snapshotFacts(
      [
        product({ id: "p1", metafields: [{ key: "state", value: state }] }),
        // A value with no state entry came from outside this app and is not ours.
        product({ id: "p2", metafields: [] }),
      ],
      [],
    );

    expect(facts.metaTitleSet).toBe(2);
    expect(facts.metaTitleOurs).toBe(1);
    expect(facts.metaDescriptionOurs).toBe(0);
  });

  it("leaves every page-derived field null, never 0, when source B has not run", () => {
    const facts = snapshotFacts([product()], [
      scanRow({ productId: "p1" }),
      scanRow({ productId: "p2" }),
    ]);

    expect(facts.pagesRead).toBe(0);
    expect(facts.productNodeTheme).toBeNull();
    expect(facts.productNodeNone).toBeNull();
    expect(facts.themeNodeTypes).toBeNull();
  });

  it("leaves them null when every page answered with the storefront password form", () => {
    // The distinction that matters: these rows were attempted. Reporting 0
    // theme nodes over them would be a claim about the theme that nobody made.
    const facts = snapshotFacts([product()], [
      scanRow({ productId: "p1", scannedAt: new Date(), status: "password" }),
      scanRow({ productId: "p2", scannedAt: new Date(), status: "password" }),
    ]);

    expect(facts.pagesRead).toBe(0);
    expect(facts.productNodeTheme).toBeNull();
    expect(facts.productNodeNone).toBeNull();
    expect(facts.themeNodeTypes).toBeNull();
  });

  it("fills the page-derived fields once a page has answered", () => {
    const facts = snapshotFacts([product()], [
      scanRow({
        productId: "p1",
        scannedAt: new Date(),
        status: "ok",
        nodes: [
          { types: ["Product"], id: "https://shop/products/a#product" },
          { types: ["BreadcrumbList"], id: "" },
          // Ours is excluded from themeNodeTypes: the question is what the
          // theme emits, and in extend mode our node wears the theme's address.
          { types: ["FAQPage"], id: "https://shop/products/a#faq", ours: true },
        ],
        findings: [],
      }),
      scanRow({
        productId: "p2",
        scannedAt: new Date(),
        status: "ok",
        nodes: [],
        findings: [{ code: "B1", source: "B", detail: { productNodes: 0 } }],
      }),
    ]);

    expect(facts.pagesRead).toBe(2);
    expect(facts.productNodeTheme).toBe(1);
    expect(facts.productNodeNone).toBe(1);
    expect(facts.themeNodeTypes).toEqual(["BreadcrumbList", "Product"]);
  });

  it("counts findings per code across rows, and keeps null apart from empty", () => {
    expect(snapshotFacts([product()], []).findingsByCode).toBeNull();

    const facts = snapshotFacts([product()], [
      scanRow({ productId: "p1", findings: [{ code: "A1", source: "A", detail: {} }] }),
      scanRow({
        productId: "p2",
        findings: [
          { code: "A1", source: "A", detail: {} },
          { code: "A5", source: "A", detail: {} },
        ],
      }),
      scanRow({ productId: "p3", findings: [] }),
    ]);

    expect(facts.findingsByCode).toEqual({ A1: 2, A5: 1 });
  });
});

describe("writtenSince", () => {
  const snapshotAt = new Date("2026-09-05T08:00:00.000Z");

  function stated(entries: Record<string, { source: string; at: string }>) {
    return product({ metafields: [{ key: "state", value: JSON.stringify(entries) }] });
  }

  it("counts an auto entry stamped after the snapshot, with its span", () => {
    const out = writtenSince(
      [
        stated({ seo_title: { source: "auto", at: "2026-09-06T10:00:00.000Z" } }),
        stated({ seo_title: { source: "auto", at: "2026-09-19T10:00:00.000Z" } }),
      ],
      snapshotAt,
    );

    expect(out.seo_title).toEqual({
      count: 2,
      earliest: "2026-09-06T10:00:00.000Z",
      latest: "2026-09-19T10:00:00.000Z",
    });
  });

  it("never counts a field a human wrote, however recent", () => {
    const out = writtenSince(
      [stated({ seo_title: { source: "human", at: "2026-09-19T10:00:00.000Z" } })],
      snapshotAt,
    );
    // A field a person wrote through this app is the merchant's work. Claiming
    // it on an invoice is the opposite of the never-overwrite promise.
    expect(out.seo_title).toBeUndefined();
  });

  it("never counts an entry stamped before the snapshot", () => {
    // The manual-path case: on a shop unlocked months ago, most auto entries
    // predate the snapshot and describe work the engagement did not do.
    const out = writtenSince(
      [stated({ facts: { source: "auto", at: "2026-08-01T10:00:00.000Z" } })],
      snapshotAt,
    );
    expect(out.facts).toBeUndefined();
  });

  it("does not count an entry stamped exactly at the snapshot", () => {
    const out = writtenSince(
      [stated({ facts: { source: "auto", at: snapshotAt.toISOString() } })],
      snapshotAt,
    );
    expect(out.facts).toBeUndefined();
  });

  it("skips an unparseable timestamp rather than treating it as the epoch", () => {
    // At the epoch it would sort before every snapshot and never be counted -
    // the same outcome, reached deliberately instead of by accident.
    const out = writtenSince([stated({ facts: { source: "auto", at: "whenever" } })], snapshotAt);
    expect(out.facts).toBeUndefined();
  });

  it("counts every key this app stamps, and no key it does not", () => {
    const out = writtenSince(
      [
        stated({
          seo_title: { source: "auto", at: "2026-09-06T10:00:00.000Z" },
          seo_description: { source: "auto", at: "2026-09-06T10:00:00.000Z" },
          questions: { source: "auto", at: "2026-09-06T10:00:00.000Z" },
          facts: { source: "auto", at: "2026-09-06T10:00:00.000Z" },
          summary: { source: "auto", at: "2026-09-06T10:00:00.000Z" },
          fit_for: { source: "auto", at: "2026-09-06T10:00:00.000Z" },
          something_else: { source: "auto", at: "2026-09-06T10:00:00.000Z" },
        }),
      ],
      snapshotAt,
    );
    expect(Object.keys(out).sort()).toEqual([
      "facts",
      "fit_for",
      "questions",
      "seo_description",
      "seo_title",
      "summary",
    ]);
  });
});

describe("recordCurrentFacts", () => {
  it("writes nothing on a short read", () => {
    // A products total below the real catalogue would put a fiction behind
    // every difference on the card, on every screen load, until the next whole
    // pass. Stale but true beats fresh and short.
    return recordCurrentFacts("shop1", [product()], false).then((result) => {
      expect(result).toEqual({ written: false, reason: "short_read" });
      expect(mockSnapshotUpsert).not.toHaveBeenCalled();
    });
  });

  it("upserts the current row, never creating a second one", async () => {
    mockSnapshotFindUnique.mockResolvedValue(null);

    await recordCurrentFacts("shop1", [product()], true);

    expect(mockSnapshotCreate).not.toHaveBeenCalled();
    const call = (mockSnapshotUpsert.mock.calls as any[])[0][0];
    expect(call.where.shopId_takenBy).toEqual({ shopId: "shop1", takenBy: "current" });
    expect(call.update.takenBy).toBe("current");
  });

  it("counts written-since against the before row and records which date it used", async () => {
    const takenAt = new Date("2026-09-05T08:00:00.000Z");
    mockSnapshotFindUnique.mockResolvedValue({ takenAt, takenBy: "unlock" });

    await recordCurrentFacts(
      "shop1",
      [
        product({
          metafields: [
            {
              key: "state",
              value: JSON.stringify({
                seo_title: { source: "auto", at: "2026-09-06T10:00:00.000Z" },
              }),
            },
          ],
        }),
      ],
      true,
    );

    const data = (mockSnapshotUpsert.mock.calls as any[])[0][0].update;
    expect(data.writtenSince.seo_title.count).toBe(1);
    expect(data.writtenSinceAt).toEqual(takenAt);
  });

  it("leaves written-since unset for a shop with no snapshot to count since", async () => {
    mockSnapshotFindUnique.mockResolvedValue(null);

    await recordCurrentFacts("shop1", [product()], true);

    const data = (mockSnapshotUpsert.mock.calls as any[])[0][0].update;
    expect(data.writtenSince).toBeUndefined();
    expect(data.writtenSinceAt).toBeNull();
  });
});
