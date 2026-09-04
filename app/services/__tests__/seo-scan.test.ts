// Source A of the per-product SEO scan (PRD-SEO-PER-PRODUCT section 5, the
// acceptance rows for A1 to A5).
//
// Every check is exercised on three shapes of product, because the row has to
// be right on any catalogue and not only on the one store anyone happens to
// be looking at: a product with every field present, a product with every
// field absent, and a product whose variants were not read at all. The third
// is the one that catches a wrong answer nobody would notice - a check that
// reports "no barcode" when what happened is that nobody looked.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../db.server", () => ({
  default: {
    seoScan: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));
vi.mock("../billing.server", () => ({ isSeoUnlocked: vi.fn() }));

import db from "../../db.server";
import { isSeoUnlocked } from "../billing.server";
import type { ProductInput } from "../facts.server";
import {
  checkDuplication,
  checkIdentifiers,
  checkMetaFields,
  checkOfferConsistency,
  checkRedirect,
  duplicationByProduct,
  offerFacts,
  sourceAFindings,
} from "../seo-scan";
import { REDIRECT_LOOKUP_CAP, computeSourceA, lookupRedirect } from "../seo-scan.server";

// --- the three shapes ------------------------------------------------------

/** Every field a source A check can read, present and non-empty. */
function complete(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    id: "gid://shopify/Product/1",
    handle: "a-chair",
    title: "A chair",
    vendor: "Acme",
    imageUrl: "https://cdn/x.jpg",
    imageAlt: "A chair",
    price: "100",
    currency: "RON",
    seo: { title: "A chair - Acme", description: "A chair, in oak." },
    metafields: [],
    variants: [
      {
        id: "gid://shopify/ProductVariant/11",
        title: "Default",
        sku: "CH-1",
        barcode: "5901234123457",
        price: "100",
        compareAtPrice: null,
        availableForSale: true,
        selectedOptions: [],
        metafields: [],
      },
    ],
    ...overrides,
  };
}

/** The same product with every one of those fields empty - but read. */
function empty(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    id: "gid://shopify/Product/2",
    handle: "b-chair",
    title: "B chair",
    vendor: "",
    imageUrl: null,
    imageAlt: null,
    price: null,
    currency: null,
    seo: { title: "", description: null },
    metafields: [],
    variants: [
      {
        id: "gid://shopify/ProductVariant/22",
        title: "Default",
        sku: null,
        barcode: null,
        price: null,
        compareAtPrice: null,
        availableForSale: false,
        selectedOptions: [],
        metafields: [],
      },
    ],
    ...overrides,
  };
}

/** Product-level fields present; no variant row arrived at all. */
function noVariantsRead(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    id: "gid://shopify/Product/3",
    handle: "c-chair",
    title: "C chair",
    vendor: "Acme",
    imageUrl: "https://cdn/y.jpg",
    price: "100",
    currency: "RON",
    seo: { title: "C chair - Acme", description: "A chair, in ash." },
    metafields: [],
    variants: [],
    ...overrides,
  };
}

// --- A1 --------------------------------------------------------------------

describe("A1 names the absent identifiers", () => {
  it("says nothing about a product that has all four", () => {
    expect(checkIdentifiers(complete())).toBeNull();
  });

  it("names exactly the absent ones and no others", () => {
    // The acceptance row: barcode and vendor present, no SKU.
    const product = complete({
      variants: [
        {
          id: "v",
          sku: "",
          barcode: "5901234123457",
          availableForSale: true,
          selectedOptions: [],
        },
      ],
    });
    const finding = checkIdentifiers(product);
    expect(finding?.detail.missing).toEqual(["sku"]);
    expect(finding?.detail.notRead).toBeUndefined();
  });

  it("names all four when all four are absent", () => {
    const finding = checkIdentifiers(empty());
    expect(finding?.detail.missing).toEqual(["barcode", "vendor", "sku", "image"]);
  });

  it("does not report a barcode or a SKU as missing when no variant was read", () => {
    // The whole point of the third shape. barcode and sku live on variants,
    // so with no variant row the honest answer is "not read", and a merchant
    // must never be sent to Shopify admin to fix a field that is already set.
    const finding = checkIdentifiers(noVariantsRead({ vendor: "", imageUrl: null }));
    expect(finding?.detail.missing).toEqual(["vendor", "image"]);
    expect(finding?.detail.notRead).toEqual(["barcode", "sku"]);
  });

  it("raises nothing at all when the only unknowns are unread, not absent", () => {
    expect(checkIdentifiers(noVariantsRead())).toBeNull();
  });

  it("names the same identifiers in the same order on two passes", () => {
    // The row is compared as JSON to decide whether to rewrite it; an
    // unstable order would rewrite every row on every pass.
    const a = checkIdentifiers(empty());
    const b = checkIdentifiers(empty());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// --- A2 --------------------------------------------------------------------

describe("A2 compares the page's offer with the product's variants", () => {
  it("reads availability and the price range off the variants", () => {
    const offer = offerFacts(
      complete({
        variants: [
          { id: "v1", price: "100", availableForSale: false, selectedOptions: [] },
          { id: "v2", price: "180", availableForSale: true, selectedOptions: [] },
        ],
      }),
    );
    expect(offer).toEqual({
      variantsRead: 2,
      available: true,
      minPrice: "100",
      maxPrice: "180",
      currency: "RON",
    });
  });

  it("flags a page that says InStock while every variant is sold out", () => {
    const offer = offerFacts(empty());
    const finding = checkOfferConsistency(offer, {
      availability: "https://schema.org/InStock",
      price: null,
    });
    expect(finding?.code).toBe("A2");
    expect(finding?.detail.mismatch).toBe("availability");
  });

  it("does not flag a page that says InStock when a variant is for sale", () => {
    const offer = offerFacts(complete());
    expect(
      checkOfferConsistency(offer, { availability: "https://schema.org/InStock", price: null }),
    ).toBeNull();
  });

  it("flags the other direction too: OutOfStock while a variant is for sale", () => {
    const offer = offerFacts(complete());
    const finding = checkOfferConsistency(offer, {
      availability: "https://schema.org/OutOfStock",
      price: null,
    });
    expect(finding?.detail.mismatch).toBe("availability");
  });

  it("accepts a price anywhere inside the variant range and flags one outside", () => {
    const offer = offerFacts(
      complete({
        variants: [
          { id: "v1", price: "100", availableForSale: true, selectedOptions: [] },
          { id: "v2", price: "180", availableForSale: true, selectedOptions: [] },
        ],
      }),
    );
    expect(
      checkOfferConsistency(offer, { availability: null, price: "180" }),
    ).toBeNull();
    const finding = checkOfferConsistency(offer, { availability: null, price: "70" });
    expect(finding?.detail).toMatchObject({ mismatch: "price", pageSays: "70", live: "100-180" });
  });

  it("says nothing when the page has not been read", () => {
    // Not yet read is a different sentence from "the offer agrees", and the
    // row must not be able to claim the second when it means the first.
    expect(checkOfferConsistency(offerFacts(empty()), null)).toBeNull();
  });

  it("says nothing when no variant was read, whatever the page says", () => {
    const offer = offerFacts(noVariantsRead());
    expect(offer.available).toBeNull();
    expect(
      checkOfferConsistency(offer, { availability: "https://schema.org/InStock", price: "1" }),
    ).toBeNull();
  });
});

// --- A3 --------------------------------------------------------------------

describe("A3 counts duplicate meta fields across the catalogue", () => {
  const shared = (id: string, title: string, description?: string) =>
    ({ id, seo: { title, description: description ?? null } }) as ProductInput;

  it("counts three products sharing a title and never counts a title once", () => {
    // The acceptance row: three sharing, one alone.
    const map = duplicationByProduct([
      shared("1", "Chair"),
      shared("2", "Chair"),
      shared("3", "Chair"),
      shared("4", "Table"),
    ]);
    expect(map.get("1")?.title).toBe(2);
    expect(map.get("3")?.title).toBe(2);
    expect(map.get("4")?.title).toBe(0);
    expect(checkDuplication(map.get("4"))).toBeNull();
    expect(checkDuplication(map.get("1"))?.detail).toEqual({
      fields: [{ field: "title", sharedWith: 2 }],
    });
  });

  it("never treats absent values as a collision", () => {
    // Fifty products with no meta title are fifty instances of A5, not one
    // collision of fifty. Counting them as duplicates would put the loudest
    // number on the screen next to the wrong check.
    const map = duplicationByProduct([empty(), empty({ id: "x" }), noVariantsRead()]);
    expect(map.get(empty().id)?.title).toBe(0);
    expect(map.get("x")?.title).toBe(0);
    expect(checkDuplication(map.get("x"))).toBeNull();
  });

  it("counts the description separately from the title", () => {
    const map = duplicationByProduct([
      shared("1", "Chair A", "Same text"),
      shared("2", "Chair B", "Same text"),
    ]);
    expect(checkDuplication(map.get("1"))?.detail).toEqual({
      fields: [{ field: "description", sharedWith: 1 }],
    });
  });

  it("ignores surrounding whitespace when deciding two values are the same", () => {
    const map = duplicationByProduct([shared("1", "Chair"), shared("2", "  Chair  ")]);
    expect(map.get("1")?.title).toBe(1);
  });
});

// --- A4 --------------------------------------------------------------------

describe("A4 finds a rename with no redirect", () => {
  it("lists a renamed product with no redirect", () => {
    const finding = checkRedirect({
      previousHandle: "old-chair",
      handle: "new-chair",
      redirectExists: false,
    });
    expect(finding?.code).toBe("A4");
    expect(finding?.detail).toEqual({
      previousHandle: "old-chair",
      handle: "new-chair",
      redirect: false,
    });
  });

  it("does not list one that has a redirect", () => {
    expect(
      checkRedirect({ previousHandle: "old", handle: "new", redirectExists: true }),
    ).toBeNull();
  });

  it("does not list a product that was never renamed", () => {
    expect(
      checkRedirect({ previousHandle: "same", handle: "same", redirectExists: false }),
    ).toBeNull();
  });

  it("does not list a product seen for the first time", () => {
    // No stored handle means no rename can be known, and reporting one would
    // flag the whole catalogue on the first pass.
    expect(
      checkRedirect({ previousHandle: null, handle: "new", redirectExists: false }),
    ).toBeNull();
  });

  it("does not list one whose redirect could not be looked up", () => {
    expect(
      checkRedirect({ previousHandle: "old", handle: "new", redirectExists: null }),
    ).toBeNull();
  });

  it("asks Shopify for the old path and reads the answer", async () => {
    const calls: { query: string; variables?: any }[] = [];
    const graphql = (async (query: string, variables?: any) => {
      calls.push({ query, variables });
      return { urlRedirects: { nodes: [{ id: "1", path: "/products/old", target: "/products/new" }] } };
    }) as any;

    await expect(lookupRedirect(graphql, "/products/old")).resolves.toBe(true);
    expect(calls[0].variables.query).toBe('path:"/products/old"');
  });

  it("reads a redirect for a different path as no redirect for this one", async () => {
    const graphql = (async () => ({
      urlRedirects: { nodes: [{ id: "1", path: "/products/other", target: "/x" }] },
    })) as any;
    await expect(lookupRedirect(graphql, "/products/old")).resolves.toBe(false);
  });

  it("returns null, not false, when the lookup fails", async () => {
    const graphql = (async () => {
      throw new Error("429");
    }) as any;
    await expect(lookupRedirect(graphql, "/products/old")).resolves.toBeNull();
  });
});

// --- A5 --------------------------------------------------------------------

describe("A5 reports an absent meta field", () => {
  it("says nothing when both are written", () => {
    expect(checkMetaFields(complete())).toBeNull();
  });

  it("names both when both are absent", () => {
    expect(checkMetaFields(empty())?.detail).toEqual({ missing: ["title", "description"] });
  });

  it("names only the absent one", () => {
    const product = complete({ seo: { title: "A chair - Acme", description: "" } });
    expect(checkMetaFields(product)?.detail).toEqual({ missing: ["description"] });
  });

  it("treats an empty field as missing even with a state entry claiming otherwise", () => {
    // classifyMetaField's rule, relied on rather than reimplemented: a badge
    // that keeps claiming "Edited by you" over an empty box is the failure.
    const product = complete({
      seo: { title: "", description: "A chair, in oak." },
      metafields: [
        {
          key: "state",
          value: JSON.stringify({ seo_title: { source: "human", at: "2026-01-01", prev: "" } }),
        },
      ],
    });
    expect(checkMetaFields(product)?.detail).toEqual({ missing: ["title"] });
  });

  it("is unaffected by whether variants were read", () => {
    expect(checkMetaFields(noVariantsRead())).toBeNull();
  });
});

// --- all of source A together ----------------------------------------------

describe("source A over one product", () => {
  it("finds nothing on a product with every field present", () => {
    const map = duplicationByProduct([complete()]);
    expect(
      sourceAFindings({
        product: complete(),
        duplication: map.get(complete().id),
        previousHandle: "a-chair",
        redirectExists: null,
      }),
    ).toEqual([]);
  });

  it("finds A1 and A5 on a product with every field absent, in code order", () => {
    const map = duplicationByProduct([empty()]);
    const findings = sourceAFindings({
      product: empty(),
      duplication: map.get(empty().id),
      previousHandle: "b-chair",
      redirectExists: null,
    });
    expect(findings.map((f) => f.code)).toEqual(["A1", "A5"]);
    expect(findings.every((f) => f.source === "A")).toBe(true);
  });

  it("finds nothing on a product whose variants were not read but whose own fields are set", () => {
    const map = duplicationByProduct([noVariantsRead()]);
    expect(
      sourceAFindings({
        product: noVariantsRead(),
        duplication: map.get(noVariantsRead().id),
        previousHandle: "c-chair",
        redirectExists: null,
      }),
    ).toEqual([]);
  });
});

// --- persistence -----------------------------------------------------------

const seoScan = (db as any).seoScan;

function resetDb(existing: any[] = []) {
  seoScan.findMany.mockReset().mockResolvedValue(existing);
  seoScan.create.mockReset().mockResolvedValue({});
  seoScan.update.mockReset().mockResolvedValue({});
  seoScan.updateMany.mockReset().mockResolvedValue({ count: 0 });
  seoScan.deleteMany.mockReset().mockResolvedValue({ count: 0 });
}

const noGraphql = (async () => ({})) as any;

describe("computeSourceA", () => {
  it("writes nothing at all for a shop without the SEO key", async () => {
    resetDb();
    vi.mocked(isSeoUnlocked).mockResolvedValue(false);

    const report = await computeSourceA("shop", noGraphql, {
      products: [complete()],
      complete: true,
    });

    expect(report).toBeNull();
    expect(seoScan.findMany).not.toHaveBeenCalled();
    expect(seoScan.create).not.toHaveBeenCalled();
  });

  // The cap is the only thing between a handle-rewriting import and thousands
  // of Admin requests in one catalogue pass, and nothing asserted it until QA
  // of 3 September 2026. The remainder must read as "not checked" and never as
  // "no redirect": A4 on a product nobody looked up is not a finding.
  it("checks at most REDIRECT_LOOKUP_CAP renamed handles in one pass, and accuses nobody else", async () => {
    const renamed = Array.from({ length: REDIRECT_LOOKUP_CAP + 10 }, (_, i) =>
      complete({ id: `gid://shopify/Product/${i}`, handle: `new-handle-${i}` }),
    );
    resetDb(
      renamed.map((p, i) => ({
        id: `row-${i}`,
        productId: p.id,
        handle: `old-handle-${i}`,
        findings: [],
        offer: null,
      })),
    );
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);

    const graphql = vi.fn(async () => ({ urlRedirects: { nodes: [] } })) as any;
    const report = await computeSourceA("shop", graphql, {
      products: renamed,
      complete: true,
    });

    expect(graphql).toHaveBeenCalledTimes(REDIRECT_LOOKUP_CAP);
    expect(report?.redirectsChecked).toBe(REDIRECT_LOOKUP_CAP);
    // Exactly the ones that were looked up carry A4. The ten past the cap were
    // not asked about, so they are silent rather than accused.
    expect(report?.byCode.A4).toBe(REDIRECT_LOOKUP_CAP);
  });

  it("creates one row per product on the first pass and counts the findings by code", async () => {
    resetDb();
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);

    const report = await computeSourceA("shop", noGraphql, {
      products: [complete(), empty()],
      complete: true,
    });

    expect(report?.created).toBe(2);
    expect(report?.updated).toBe(0);
    expect(report?.byCode).toEqual({ A1: 1, A5: 1 });
    const written = seoScan.create.mock.calls.map((c: any[]) => c[0].data);
    expect(written[0].handle).toBe("a-chair");
    expect(written[0].findings).toEqual([]);
    expect(written[0].offer.variantsRead).toBe(1);
  });

  it("refreshes bulkAt in one statement for rows whose content did not change", async () => {
    // Rule 1: five catalogue passes a week over a large store must not rewrite
    // every row five times for nothing.
    const product = complete();
    resetDb([
      {
        id: "row-1",
        productId: product.id,
        handle: product.handle,
        // Key order deliberately different from what the code builds, the way
        // Postgres hands JSONB back.
        findings: [],
        offer: {
          currency: "RON",
          maxPrice: "100",
          minPrice: "100",
          available: true,
          variantsRead: 1,
        },
      },
    ]);
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);

    const report = await computeSourceA("shop", noGraphql, {
      products: [product],
      complete: true,
    });

    expect(report?.touched).toBe(1);
    expect(report?.updated).toBe(0);
    expect(seoScan.update).not.toHaveBeenCalled();
    expect(seoScan.updateMany).toHaveBeenCalledTimes(1);
    expect(seoScan.updateMany.mock.calls[0][0].where.id.in).toEqual(["row-1"]);
  });

  it("leaves source B's half of the findings alone when it rewrites a row", async () => {
    // Rule 4 (seo-page.server.ts): one column, two sources, months apart.
    // Without this the next catalogue pass would erase every page finding -
    // and the unchanged check above would see a changed row every time and
    // rewrite the whole table on every pass.
    const product = empty();
    const fromSourceB = { code: "B1", source: "B", detail: { productNodes: 0 } };
    resetDb([
      {
        id: "row-b",
        productId: product.id,
        handle: product.handle,
        findings: [fromSourceB],
        offer: null,
      },
    ]);
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);

    await computeSourceA("shop", noGraphql, { products: [product], complete: true });

    const written = seoScan.update.mock.calls[0][0].data.findings;
    expect(written.map((f: any) => f.code)).toEqual(["A1", "A5", "B1"]);
    expect(written.at(-1)).toEqual(fromSourceB);
  });

  it("does not rewrite a row just because source B added a finding to it", async () => {
    const product = complete();
    resetDb([
      {
        id: "row-b2",
        productId: product.id,
        handle: product.handle,
        findings: [{ code: "B3", source: "B", detail: { from: "meta" } }],
        offer: {
          variantsRead: 1,
          available: true,
          minPrice: "100",
          maxPrice: "100",
          currency: "RON",
        },
      },
    ]);
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);

    const report = await computeSourceA("shop", noGraphql, {
      products: [product],
      complete: true,
    });

    expect(report?.touched).toBe(1);
    expect(seoScan.update).not.toHaveBeenCalled();
  });

  it("rewrites a row whose findings changed", async () => {
    const product = empty();
    resetDb([
      { id: "row-2", productId: product.id, handle: product.handle, findings: [], offer: null },
    ]);
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);

    const report = await computeSourceA("shop", noGraphql, {
      products: [product],
      complete: true,
    });

    expect(report?.updated).toBe(1);
    expect(report?.touched).toBe(0);
    expect(seoScan.update.mock.calls[0][0].data.findings.map((f: any) => f.code)).toEqual([
      "A1",
      "A5",
    ]);
  });

  it("deletes rows for products a whole read did not contain", async () => {
    resetDb([{ id: "gone", productId: "gid://shopify/Product/99", handle: "x", findings: [], offer: null }]);
    seoScan.deleteMany.mockResolvedValue({ count: 1 });
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);

    const report = await computeSourceA("shop", noGraphql, {
      products: [complete()],
      complete: true,
    });

    expect(report?.removed).toBe(1);
    expect(seoScan.deleteMany.mock.calls[0][0].where.id.in).toEqual(["gone"]);
  });

  it("keeps them, and says so, when the read was short", async () => {
    // Rule 2, the same one reconcileMirrors obeys: a truncated download looks
    // exactly like a catalogue that shrank.
    resetDb([{ id: "gone", productId: "gid://shopify/Product/99", handle: "x", findings: [], offer: null }]);
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);

    const report = await computeSourceA("shop", noGraphql, {
      products: [complete()],
      complete: false,
    });

    expect(report?.removed).toBe(0);
    expect(report?.keptOnShortRead).toBe(1);
    expect(seoScan.deleteMany).not.toHaveBeenCalled();
  });

  it("looks a redirect up only for a product whose handle changed", async () => {
    const product = complete({ handle: "new-chair" });
    resetDb([
      { id: "row-3", productId: product.id, handle: "old-chair", findings: [], offer: null },
    ]);
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);
    const paths: string[] = [];
    const graphql = (async (_q: string, variables: any) => {
      paths.push(variables.query);
      return { urlRedirects: { nodes: [] } };
    }) as any;

    const report = await computeSourceA("shop", graphql, {
      products: [product],
      complete: true,
    });

    expect(paths).toEqual(['path:"/products/old-chair"']);
    expect(report?.redirectsChecked).toBe(1);
    expect(report?.byCode.A4).toBe(1);
  });

  it("reports a failure instead of taking the catalogue pass down with it", async () => {
    // Source A was added to passes that did their job without it. A database
    // error here must not be the reason Fill catalogue, the weekly sweep or an
    // alt-text run fails - but it must not look like "no SEO key" either.
    resetDb();
    seoScan.findMany.mockRejectedValue(new Error("relation \"SeoScan\" does not exist"));
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);

    const report = await computeSourceA("shop", noGraphql, {
      products: [complete()],
      complete: true,
    });

    expect(report).not.toBeNull();
    expect(report?.error).toContain("does not exist");
    expect(report?.created).toBe(0);
  });

  it("makes no Admin call at all when no handle changed", async () => {
    const product = complete();
    resetDb([
      { id: "row-4", productId: product.id, handle: product.handle, findings: [], offer: null },
    ]);
    vi.mocked(isSeoUnlocked).mockResolvedValue(true);
    const graphql = vi.fn();

    const report = await computeSourceA("shop", graphql as any, {
      products: [product],
      complete: true,
    });

    expect(graphql).not.toHaveBeenCalled();
    expect(report?.redirectsChecked).toBe(0);
  });
});
