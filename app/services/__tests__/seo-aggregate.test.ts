// The aggregate behind every per-product SEO screen (PRD-SEO-PER-PRODUCT
// section 4 and section 5's screen rows).
//
// Tested against the function and never against a component, because the
// acceptance criterion is about four shapes of store and a component test
// would only ever prove that one of them renders. The four shapes, each of
// which has broken a screen somewhere in this app before:
//
//   1. A 50-product fixture, part-way through its first source B pass.
//   2. A 20,000-product store, where 500 pages a night means the screen has
//      to read correctly for 39 more nights and the denominators are the only
//      thing keeping it honest.
//   3. An empty store, where every count is zero and no sentence may divide
//      by it.
//   4. A store where source B has never run, which is the state every shop is
//      in the day the key is turned on - and the one where a count of zero
//      would be a lie about what was never looked at.
//
// The pure module has no database and no .env, so nothing here is mocked.

import { describe, expect, it } from "vitest";
import {
  CHECKS,
  aggregateFindings,
  cleanSentence,
  describeFinding,
  findingsForProduct,
  pageStateOf,
  pagesReadSentence,
  themeNodeAggregate,
  themeNodeAdvice,
  themeNodeSentence,
  type ScanRowLike,
} from "../seo-aggregate";
import type { Finding } from "../seo-scan";

// --- builders --------------------------------------------------------------

const BULK = new Date("2026-09-03T02:00:00Z");
const SCAN = new Date("2026-09-03T03:45:00Z");

function f(code: string, source: "A" | "B" | "A+B", detail: Record<string, unknown> = {}): Finding {
  return { code, source, detail } as Finding;
}

const THEME_NODE = { types: ["Product"], id: "https://shop.example/products/a#product-theme" };
const OUR_NODE = { types: ["Product"], id: "https://shop.example/products/a#product" };

function row(i: number, over: Partial<ScanRowLike> = {}): ScanRowLike {
  return {
    productId: `gid://shopify/Product/${i}`,
    handle: `p-${i}`,
    bulkAt: BULK,
    scannedAt: null,
    status: null,
    findings: [],
    nodes: null,
    ...over,
  };
}

/** Shape 1: 50 products, source A on all of them, 20 pages read so far. */
function fixture50(): ScanRowLike[] {
  return Array.from({ length: 50 }, (_, i) => {
    const scanned = i < 20;
    const findings: Finding[] = [];
    // 30 of the 50 are missing an identifier; 6 share a meta title.
    if (i < 30) findings.push(f("A1", "A", { missing: ["barcode", "sku"] }));
    if (i < 6) findings.push(f("A3", "A", { fields: [{ field: "title", sharedWith: 5 }] }));
    // Of the 20 pages read, 4 have no canonical of their own.
    if (scanned && i < 4) findings.push(f("B2", "B", { canonical: null, page: "x" }));
    return row(i, {
      scannedAt: scanned ? SCAN : null,
      status: scanned ? "ok" : null,
      findings,
      nodes: scanned ? [THEME_NODE] : null,
    });
  });
}

/** Shape 2: 20,000 products, one night of scanning done (500 pages). */
function store20k(): ScanRowLike[] {
  return Array.from({ length: 20000 }, (_, i) => {
    const scanned = i < 500;
    const findings: Finding[] = [];
    if (i % 2 === 0) findings.push(f("A5", "A", { missing: ["description"] }));
    if (scanned && i < 100) findings.push(f("B4", "B", { signals: {} }));
    return row(i, {
      scannedAt: scanned ? SCAN : null,
      status: scanned ? "ok" : null,
      findings,
      nodes: scanned ? [THEME_NODE] : null,
    });
  });
}

/** Shape 4: source A has run over the whole catalogue, source B never. */
function neverScanned(n = 50): ScanRowLike[] {
  return Array.from({ length: n }, (_, i) =>
    row(i, { findings: i < 7 ? [f("A1", "A", { missing: ["vendor"] })] : [] }),
  );
}

// --- shape 1: the 50-product fixture ---------------------------------------

describe("a 50-product fixture, part-way through its first page pass", () => {
  const aggregate = aggregateFindings(fixture50());

  it("counts every A check against the catalogue and every B check against the pages read", () => {
    expect(aggregate.products).toBe(50);
    expect(aggregate.bulkRead).toBe(50);
    expect(aggregate.pagesRead).toBe(20);

    const a1 = aggregate.rows.find((r) => r.code === "A1")!;
    expect(a1).toMatchObject({ count: 30, denominator: 50, state: "found" });

    const b2 = aggregate.rows.find((r) => r.code === "B2")!;
    expect(b2).toMatchObject({ count: 4, denominator: 20, state: "found" });
  });

  it("orders rows by the count this store actually has, nothing hard-coded", () => {
    const found = aggregate.rows.filter((r) => r.state === "found").map((r) => r.code);
    expect(found).toEqual(["A1", "A3", "B2"]);
    expect(aggregate.rows.filter((r) => r.state === "found").map((r) => r.count)).toEqual([
      30, 6, 4,
    ]);
  });

  it("collapses the checks that ran and found nothing, with their own denominators", () => {
    // Every check that ran and found nothing. A2 needs the page as well as
    // the catalogue, so it is counted over the 20 pages read, not over 50 -
    // this is the grouping the sentence exists for.
    expect(aggregate.clean.map((r) => r.code)).toEqual([
      "A2", "A4", "A5", "B1", "B3", "B4", "B5",
    ]);
    expect(cleanSentence(aggregate)).toBe(
      "5 checks found nothing on 20 products; 2 checks found nothing on 50 products.",
    );
  });

  it("states the pages-read sentence with the shop's own budget", () => {
    expect(pagesReadSentence(aggregate, 500)).toBe("20 of 50 pages read; the rest by tomorrow night.");
    expect(pagesReadSentence(aggregate, 10)).toBe("20 of 50 pages read; the rest over the next 3 nights.");
  });
});

// --- shape 2: 20,000 products ----------------------------------------------

describe("a 20,000-product store, one night in", () => {
  const aggregate = aggregateFindings(store20k());

  it("never lets a B count borrow the catalogue's denominator", () => {
    expect(aggregate.products).toBe(20000);
    expect(aggregate.pagesRead).toBe(500);
    expect(aggregate.rows.find((r) => r.code === "A5")).toMatchObject({
      count: 10000,
      denominator: 20000,
    });
    expect(aggregate.rows.find((r) => r.code === "B4")).toMatchObject({
      count: 100,
      denominator: 500,
    });
  });

  it("says how many nights the rest takes rather than implying it is done", () => {
    expect(pagesReadSentence(aggregate, 500)).toBe(
      "500 of 20000 pages read; the rest over the next 39 nights.",
    );
  });

  it("puts the largest real problem first without knowing what it is in advance", () => {
    expect(aggregate.rows[0].code).toBe("A5");
  });
});

// --- shape 3: an empty store ------------------------------------------------

describe("an empty store", () => {
  const aggregate = aggregateFindings([]);

  it("reads every check as not yet read, never as a clean zero", () => {
    expect(aggregate.products).toBe(0);
    expect(aggregate.clean).toEqual([]);
    expect(aggregate.rows).toHaveLength(CHECKS.length);
    expect(aggregate.rows.every((r) => r.state === "notYetRead")).toBe(true);
    expect(cleanSentence(aggregate)).toBeNull();
  });

  it("divides by nothing in the pages-read sentence", () => {
    expect(pagesReadSentence(aggregate, 500)).toBe(
      "No products have been read yet, so there are no pages to fetch.",
    );
    expect(pagesReadSentence(aggregate, 0)).toContain("no pages to fetch");
  });

  it("has no structured-data verdict at all", () => {
    const nodes = themeNodeAggregate([]);
    expect(nodes.verdict).toBe("unknown");
    expect(themeNodeSentence(nodes)).toContain("No product page has been read yet");
    expect(themeNodeAdvice(nodes)).toContain("Leave the app embed as it is");
  });
});

// --- shape 4: source B has never run ---------------------------------------

describe("a store where source B has never run", () => {
  const aggregate = aggregateFindings(neverScanned());

  it("answers every A check and refuses to answer any B check", () => {
    expect(aggregate.pagesAttempted).toBe(0);
    expect(aggregate.neverScanned).toBe(50);

    const a1 = aggregate.rows.find((r) => r.code === "A1")!;
    expect(a1).toMatchObject({ count: 7, denominator: 50, state: "found" });

    for (const code of ["A2", "B1", "B2", "B3", "B4", "B5"]) {
      const check = aggregate.rows.find((r) => r.code === code)!;
      expect(check.state).toBe("notYetRead");
      expect(check.denominator).toBe(0);
      expect(check.notRead).toBe(50);
    }
  });

  it("collapses only the A checks that ran, and says 50 rather than 0", () => {
    expect(aggregate.clean.map((r) => r.code)).toEqual(["A3", "A4", "A5"]);
    expect(cleanSentence(aggregate)).toBe("3 checks found nothing on 50 products.");
  });

  it("puts the not-yet-read rows after the ones that found something", () => {
    expect(aggregate.rows[0].code).toBe("A1");
    expect(aggregate.rows.slice(1).every((r) => r.state === "notYetRead")).toBe(true);
  });

  it("says no pages have been read and how long the catalogue will take", () => {
    expect(pagesReadSentence(aggregate, 500)).toBe(
      "No product pages have been read yet, out of 50. The nightly pass reads up to 500 a night, starting tonight.",
    );
    expect(pagesReadSentence(aggregate, 10)).toBe(
      "No product pages have been read yet, out of 50. The nightly pass reads up to 10 a night, so this catalogue takes 5 nights.",
    );
  });
});

// --- a store behind the password form --------------------------------------

describe("a store whose pages answered with the password form", () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    row(i, { scannedAt: SCAN, status: "password", findings: [f("A1", "A", { missing: ["sku"] })] }),
  );
  const aggregate = aggregateFindings(rows);

  it("has attempted every page and read none of them", () => {
    expect(aggregate.pagesAttempted).toBe(12);
    expect(aggregate.pagesRead).toBe(0);
    expect(aggregate.couldNotBeRead).toBe(12);
  });

  it("says not yet read for every page check, never 'no Product node'", () => {
    for (const code of ["B1", "B2", "B3", "B4", "B5"]) {
      expect(aggregate.rows.find((r) => r.code === code)!.state).toBe("notYetRead");
    }
  });

  it("refuses to recommend Full mode from pages nobody could read", () => {
    const nodes = themeNodeAggregate(rows);
    expect(nodes.pagesRead).toBe(0);
    expect(nodes.verdict).toBe("unknown");
  });
});

// --- the Structured data verdict -------------------------------------------

describe("the B1 aggregate behind the Structured data card", () => {
  it("recommends Extend when any scanned page has a theme node", () => {
    const rows = [
      row(1, { scannedAt: SCAN, status: "ok", nodes: [THEME_NODE] }),
      row(2, { scannedAt: SCAN, status: "ok", nodes: [] }),
      row(3, { scannedAt: SCAN, status: "ok", nodes: [] }),
    ];
    const nodes = themeNodeAggregate(rows);
    expect(nodes).toMatchObject({ pagesRead: 3, theme: 1, none: 2, two: 0, verdict: "extend" });
    expect(themeNodeSentence(nodes)).toBe(
      "Product node from the theme on 1 of 3 pages read; none on 2.",
    );
  });

  it("recommends Full only when no scanned page has one, and says how many", () => {
    const rows = [
      row(1, { scannedAt: SCAN, status: "ok", nodes: [] }),
      row(2, { scannedAt: SCAN, status: "ok", nodes: [OUR_NODE] }),
      // Never scanned, so it is not part of the verdict either way.
      row(3),
    ];
    const nodes = themeNodeAggregate(rows);
    expect(nodes).toMatchObject({ pagesRead: 2, theme: 0, appOnly: 1, verdict: "full" });
    expect(themeNodeAdvice(nodes)).toContain("any of the 2 pages read");
  });

  it("reads extend mode's shared @id as one node and not as two", () => {
    const shared = { types: ["Product"], id: "https://shop.example/products/a#product" };
    const nodes = themeNodeAggregate([
      row(1, { scannedAt: SCAN, status: "ok", nodes: [shared, { ...shared }] }),
    ]);
    expect(nodes.two).toBe(0);
    expect(nodes.none).toBe(0);
  });

  it("counts two genuinely different Product nodes on one page", () => {
    const nodes = themeNodeAggregate([
      row(1, { scannedAt: SCAN, status: "ok", nodes: [THEME_NODE, OUR_NODE] }),
    ]);
    expect(nodes).toMatchObject({ two: 1, theme: 1, verdict: "extend" });
  });
});

// --- the Products list column ----------------------------------------------

describe("the Page column's four states", () => {
  it("is grey for a product with no row at all and for one never scanned", () => {
    expect(pageStateOf(null)).toBe("unread");
    expect(pageStateOf(row(1))).toBe("unread");
  });

  it("is green only when the page was read and the page half found nothing", () => {
    expect(
      pageStateOf(row(1, { scannedAt: SCAN, status: "ok", findings: [f("A1", "A")] })),
    ).toBe("clean");
  });

  it("is amber when the page read found something", () => {
    expect(
      pageStateOf(row(1, { scannedAt: SCAN, status: "ok", findings: [f("B3", "B", { from: "meta" })] })),
    ).toBe("findings");
    // A2 is computed from the page as well, so it colours this column too.
    expect(
      pageStateOf(row(1, { scannedAt: SCAN, status: "ok", findings: [f("A2", "A+B", {})] })),
    ).toBe("findings");
  });

  it("has its own state for a page that could not be read", () => {
    expect(pageStateOf(row(1, { scannedAt: SCAN, status: "password", findings: [] }))).toBe(
      "unreadable",
    );
    expect(pageStateOf(row(1, { scannedAt: SCAN, status: "404", findings: [] }))).toBe(
      "unreadable",
    );
  });
});

// --- the editor's section ---------------------------------------------------

describe("one product's findings, for the editor", () => {
  it("puts the page half first and keeps the catalogue half", () => {
    const r = row(1, {
      scannedAt: SCAN,
      status: "ok",
      findings: [f("A1", "A"), f("B3", "B", { from: "meta" }), f("A5", "A", { missing: ["title"] })],
    });
    expect(findingsForProduct(r).map((x) => x.code)).toEqual(["B3", "A1", "A5"]);
  });

  it("is empty for a product with no row", () => {
    expect(findingsForProduct(null)).toEqual([]);
  });

  it("describes a finding from what the row recorded and never invents a cause", () => {
    expect(describeFinding(f("A1", "A", { missing: ["barcode", "vendor"] }))).toBe(
      "Absent on this product: barcode, vendor.",
    );
    expect(describeFinding(f("A1", "A", { missing: ["vendor"], notRead: ["sku"] }))).toContain(
      "Not checked on this pass: sku.",
    );
    expect(
      describeFinding(f("A2", "A+B", { mismatch: "availability", pageSays: "InStock", everyVariantSoldOut: true })),
    ).toBe("The page says InStock while every variant is sold out.");
    expect(describeFinding(f("B5", "B", { reason: "robots", disallow: "/products/" }))).toBe(
      "robots.txt disallows /products/, so this page was never fetched.",
    );
    expect(describeFinding(f("B1", "B", { productNodes: 0, emitters: [] }))).toBe(
      "No Product node on this page at all.",
    );
    // An unrecognised shape falls back to the check's label, not to raw JSON.
    expect(describeFinding(f("B5", "B", {}))).toBe(
      "The page could not be read as a crawler would read it",
    );
  });
});

// --- a finding recorded twice on one product -------------------------------

describe("counting", () => {
  it("counts a product once per code however many findings carry it", () => {
    const aggregate = aggregateFindings([
      row(1, { findings: [f("A1", "A", { missing: ["sku"] }), f("A1", "A", { missing: ["vendor"] })] }),
    ]);
    expect(aggregate.rows.find((r) => r.code === "A1")!.count).toBe(1);
  });

  it("survives a findings column that is not an array", () => {
    const aggregate = aggregateFindings([row(1, { findings: "not json" }), row(2, { findings: null })]);
    expect(aggregate.products).toBe(2);
    // A1 ran over both rows and found nothing, so it is clean, not a row.
    expect(aggregate.clean.find((r) => r.code === "A1")).toMatchObject({
      count: 0,
      denominator: 2,
    });
  });

  it("has no row for B6, which is not built", () => {
    expect(CHECKS.some((c) => (c.code as string) === "B6")).toBe(false);
  });
});
