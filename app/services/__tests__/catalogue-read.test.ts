// Section I.3 change 1 and the J.7 availability rows.
//
// A bare array could not say the one thing a caller that deletes has to know.
// A truncated download looks exactly like a catalogue that shrank, and acting
// on the difference empties the mirror for a shop whose products are all
// still on sale - audit item 6.9, which the weekly sweep could hit and never
// checked for.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../admin.server", () => ({ sleep: async () => {} }));
vi.mock("../../db.server", () => ({ default: { setting: { upsert: vi.fn() } } }));

import { fetchAllProducts, productsBulkQuery } from "../catalogue.server";

const RESULT_URL = "https://storage.example/bulk.jsonl";

/** One bulk operation that completes, reporting the counts given. */
function admin(counts: { root: number; objects: number }) {
  const calls: { query: string; variables?: any }[] = [];
  const fn = async (query: string, variables?: any) => {
    calls.push({ query, variables });
    if (query.includes("bulkOperationRunQuery")) {
      return { bulkOperationRunQuery: { bulkOperation: { id: "1", status: "CREATED" }, userErrors: [] } };
    }
    return {
      currentBulkOperation: {
        id: "1",
        status: "COMPLETED",
        errorCode: null,
        // UnsignedInt64 arrives as a string.
        objectCount: String(counts.objects),
        rootObjectCount: String(counts.root),
        url: RESULT_URL,
      },
    };
  };
  return { fn: fn as any, calls };
}

function jsonl(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

function productLine(id: number, extra: Record<string, unknown> = {}) {
  return {
    id: `gid://shopify/Product/${id}`,
    handle: `p${id}`,
    status: "ACTIVE",
    title: `Product ${id}`,
    onlineStoreUrl: `https://x/products/p${id}`,
    ...extra,
  };
}

function variantLine(id: number, parent: number, availableForSale: boolean) {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    __parentId: `gid://shopify/Product/${parent}`,
    title: "Default",
    sku: null,
    availableForSale,
    selectedOptions: [],
  };
}

function serve(body: string) {
  vi.stubGlobal("fetch", async () => new Response(body));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("the bulk query", () => {
  it("carries the filter it was given and asks for the product's own status", () => {
    const query = productsBulkQuery("status:active,unlisted AND published_status:published");
    expect(query).toContain('products(query: "status:active,unlisted AND published_status:published")');
    expect(query).toMatch(/\n\s+status\n/);
    expect(query).toContain("availableForSale");
  });

  // Source A of the per-product SEO scan (PRD-SEO-PER-PRODUCT section 2): the
  // three variant fields ride along on a read the catalogue pass already pays
  // for. Asserted on the query string because a field silently dropped here
  // makes check A1 report every product as missing its GTIN.
  it("carries the variant fields the SEO scan reads", () => {
    const query = productsBulkQuery("status:active");
    // The variant block, not the whole query: "price" alone would match
    // priceRangeV2 on the product and pass with no variant price at all.
    const variantBlock = query.slice(query.indexOf("variants"));
    expect(variantBlock).toContain("barcode");
    expect(variantBlock).toContain("compareAtPrice");
    expect(variantBlock).toContain("price");
  });
});

describe("fetchAllProducts reports whether the download was whole", () => {
  it("is complete when both counts match what was parsed", async () => {
    const body = jsonl([productLine(1), productLine(2)]);
    serve(body);
    const { fn } = admin({ root: 2, objects: 2 });

    const read = await fetchAllProducts(fn);

    expect(read.complete).toBe(true);
    expect(read.read).toEqual({ root: 2, objects: 2 });
    expect(read.expected).toEqual({ root: 2, objects: 2 });
    expect(read.products.map((p) => p.handle)).toEqual(["p1", "p2"]);
  });

  it("is incomplete when Shopify counted more products than arrived", async () => {
    // The audit's case, in miniature: 355 announced, 354 delivered.
    const lines = Array.from({ length: 354 }, (_, i) => productLine(i + 1));
    serve(jsonl(lines));
    const { fn } = admin({ root: 355, objects: 355 });

    const read = await fetchAllProducts(fn);

    expect(read.complete).toBe(false);
    expect(read.read.root).toBe(354);
    expect(read.expected.root).toBe(355);
  });

  it("stays complete when a child line is missing but every product arrived", async () => {
    // A delete is made from the set of product handles, so a missing variant
    // or metafield line cannot make the delete wrong. Vetoing on it would
    // instead risk the opposite failure: if Shopify's object count and this
    // parser's line count ever disagree by one, every read would be marked
    // incomplete, nothing would ever be withdrawn, and the fix would be
    // silently inert. The mismatch is reported rather than obeyed.
    serve(jsonl([productLine(1), variantLine(11, 1, true)]));
    const { fn } = admin({ root: 1, objects: 3 });

    const read = await fetchAllProducts(fn);

    expect(read.complete).toBe(true);
    expect(read.objectsMatch).toBe(false);
    expect(read.expected.objects).toBe(3);
    expect(read.read.objects).toBe(2);
  });

  it("refuses a completed export whose file is missing while products were announced", async () => {
    // The dangerous shape: Shopify says 355 products and writes no file. Read
    // as a whole catalogue of nothing, the reconciliation would withdraw every
    // page the shop has. The root comparison is what stops it.
    const fn = (async (query: string) => {
      if (query.includes("bulkOperationRunQuery")) {
        return { bulkOperationRunQuery: { bulkOperation: {}, userErrors: [] } };
      }
      return {
        currentBulkOperation: {
          status: "COMPLETED",
          objectCount: "0",
          rootObjectCount: "355",
          url: null,
        },
      };
    }) as any;

    const read = await fetchAllProducts(fn);

    expect(read.products).toHaveLength(0);
    expect(read.complete).toBe(false);
    expect(read.expected.root).toBe(355);
    expect(read.read.root).toBe(0);
  });

  it("treats a completed export with no file as a whole read of nothing", async () => {
    // Shopify writes no result file when the query matched nothing. Read as a
    // failure, a shop that unpublished everything could never have its pages
    // withdrawn.
    const fn = (async (query: string) => {
      if (query.includes("bulkOperationRunQuery")) {
        return { bulkOperationRunQuery: { bulkOperation: {}, userErrors: [] } };
      }
      return {
        currentBulkOperation: {
          status: "COMPLETED",
          objectCount: "0",
          rootObjectCount: "0",
          url: null,
        },
      };
    }) as any;

    const read = await fetchAllProducts(fn);

    expect(read.complete).toBe(true);
    expect(read.products).toEqual([]);
    expect(read.read).toEqual({ root: 0, objects: 0 });
  });
});

describe("availability is asked of the variants, not of totalInventory", () => {
  it("is in stock when any variant can be ordered", async () => {
    serve(
      jsonl([
        productLine(1, { totalInventory: 0 }),
        variantLine(11, 1, false),
        variantLine(12, 1, true),
      ]),
    );
    const { fn } = admin({ root: 1, objects: 3 });

    const read = await fetchAllProducts(fn);

    expect(read.products[0].available).toBe(true);
  });

  it("is out of stock only when no variant can be ordered", async () => {
    serve(jsonl([productLine(1), variantLine(11, 1, false), variantLine(12, 1, false)]));
    const { fn } = admin({ root: 1, objects: 3 });

    const read = await fetchAllProducts(fn);

    expect(read.products[0].available).toBe(false);
  });

  it("is unknown, not false, when no variant row was read", async () => {
    serve(jsonl([productLine(1, { totalInventory: 0 })]));
    const { fn } = admin({ root: 1, objects: 1 });

    const read = await fetchAllProducts(fn);

    // A made-to-order product with tracking off used to read "out of stock"
    // here on the strength of totalInventory alone.
    expect(read.products[0].available).toBeUndefined();
  });
});
