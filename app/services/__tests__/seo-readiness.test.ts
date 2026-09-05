// The four readiness groups behind the merchant dashboard at
// /app/seo/dashboard (PRD-SEO-FULL-ONPAGE section 4.1 as amended 4 September
// 2026).
//
// The acceptance criterion this file exists for is one sentence: the four
// groups partition the read set exactly, so the four numbers on the screen add
// to the denominator printed under the dial. It is asserted on all five
// fixture stores, because a partition that holds on one shape of store and not
// another is not a partition:
//
//   1. A 50-product fixture, every page read.
//   2. A 189-product shop, every page read, with one problem on every single
//      product - the shape amendment 1 exists for.
//   3. A 20,000-product store, 500 pages read and 19,500 waiting.
//   4. An empty store, where nothing may divide by zero.
//   5. A store where the live page read never ran, which is the state every
//      shop is in the day the key is turned on.
//
// The second thing asserted here is the language rule, and it is asserted by
// machine because it is the kind of rule that decays by one careless string:
// nothing a merchant reads on that screen uses the vocabulary of a search
// specification, and no check code ever appears on it.
//
// Pure module, no database and no .env, so nothing is mocked.

import { describe, expect, it } from "vitest";
import {
  CSV_CONTEXT,
  GROUP_ORDER,
  MERCHANT_REASON,
  UNEXPLAINED_REASON,
  allOf,
  buildReadiness,
  codeSource,
  columnAccount,
  createReadinessCounters,
  foldReadinessRow,
  groupsPartitionCatalogue,
  groupsPartitionReadSet,
  listingMethod,
  listingReadiness,
  nProducts,
  readinessMethod,
  readinessOf,
  shopWideCrossReference,
  shopWideItems,
  shopWideMethod,
  shopWideScope,
  unreadSentence,
  type Readiness,
  type SurfaceContext,
} from "../seo-readiness";
import {
  FINDING_OWNER,
  OWNER_LABEL,
  OWNER_STEPS,
  SHOP_WIDE_LABEL,
  type FindingCode,
} from "../seo-findings";
import { CHECKS, aggregateFindings, type ScanRowLike } from "../seo-aggregate";

const DAY = "2026-09-04T03:45:00.000Z";

/** The screen with every referent rendered, for the sentences that point at things. */
const SCREEN: SurfaceContext = {
  surface: "screen",
  groups: "above",
  shopWide: "above",
  counted: true,
  collectionsTotal: true,
  blogTotal: true,
  listingKpi: true,
  dial: true,
  readLine: true,
};

/** One row, with the codes it carries. `page: false` means never read. */
function row(
  id: number,
  codes: string[],
  options: { page?: boolean; catalogue?: boolean; status?: string } = {},
): ScanRowLike {
  const page = options.page ?? true;
  const catalogue = options.catalogue ?? true;
  return {
    productId: `gid://shopify/Product/${id}`,
    handle: `p-${id}`,
    bulkAt: catalogue ? DAY : null,
    scannedAt: page ? DAY : null,
    status: page ? (options.status ?? "ok") : null,
    findings: codes.map((code) => ({ code, source: code.startsWith("A") ? "A" : "B", detail: {} })),
  };
}

// --- the five fixture stores ------------------------------------------------

/** 50 products, every page read, a spread of findings and no shop-wide one. */
function fiftyProducts(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 50; i += 1) {
    const codes: string[] = [];
    if (i < 12) codes.push("B17");
    if (i < 8) codes.push("A5");
    if (i >= 12 && i < 20) codes.push("B2");
    if (i >= 20 && i < 24) codes.push("B15");
    // A product with a merchant gap and a theme gap at once, so the
    // "most immediate owner" rule has something to decide.
    if (i >= 24 && i < 28) codes.push("A15", "B25");
    rows.push(row(i, codes));
  }
  return rows;
}

/**
 * 189 products, every page read, and B12 on every one of them. This is the
 * shape amendment 1 was written for: without it the dial reads zero and the
 * screen says nothing useful about a shop whose only shop-wide fault is one
 * line in a theme.
 */
function oneEightyNine(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 189; i += 1) {
    const codes: string[] = ["B12"];
    if (i < 38) codes.push("B17");
    if (i < 23) codes.push("A5");
    if (i >= 100 && i < 114) codes.push("B25");
    if (i >= 150 && i < 161) codes.push("B15");
    rows.push(row(i, codes));
  }
  return rows;
}

/** 20,000 products, 500 pages read. The other 19,500 are in no group at all. */
function twentyThousand(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 20000; i += 1) {
    if (i < 500) {
      rows.push(row(i, i < 120 ? ["B17"] : i < 200 ? ["B2"] : []));
    } else {
      rows.push(row(i, ["A5"], { page: false }));
    }
  }
  return rows;
}

/** A store where source B has never run: catalogue rows, no page ever fetched. */
function pageReadNeverRan(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 120; i += 1) rows.push(row(i, ["A5", "A15"], { page: false }));
  return rows;
}

const STORES: { name: string; rows: ScanRowLike[] }[] = [
  { name: "a 50-product fixture", rows: fiftyProducts() },
  { name: "a 189-product shop", rows: oneEightyNine() },
  { name: "a 20,000-product store", rows: twentyThousand() },
  { name: "an empty store", rows: [] },
  { name: "a store where the live page read never ran", rows: pageReadNeverRan() },
];

describe("the four groups partition the read set", () => {
  for (const store of STORES) {
    it(`sums to the denominator on ${store.name}`, () => {
      const readiness = readinessOf(store.rows);
      expect(groupsPartitionReadSet(readiness)).toBe(true);
      expect(
        readiness.groups.reduce((sum, group) => sum + group.count, 0),
      ).toBe(readiness.readSet);
    });

    it(`never divides by zero or invents a percentage on ${store.name}`, () => {
      const readiness = readinessOf(store.rows);
      for (const group of readiness.groups) {
        expect(Number.isFinite(group.percent)).toBe(true);
        // The catalogue, and the same denominator the headline KPI prints
        // beside the same number. They used to differ: the card said "0 of 50"
        // and the group beneath it said "Nothing to fix - 0 of 46".
        expect(group.denominator).toBe(readiness.products);
        if (readiness.products === 0) expect(group.percent).toBe(0);
      }
    });
  }

  it("renders the four groups in the order the screen shows them", () => {
    const readiness = readinessOf(fiftyProducts());
    expect(readiness.groups.map((g) => g.group)).toEqual(GROUP_ORDER);
  });
});

describe("the read set is both reads, never either", () => {
  it("counts a product only once its catalogue row and its page have been read", () => {
    const readiness = readinessOf(twentyThousand());
    expect(readiness.products).toBe(20000);
    expect(readiness.catalogueRead).toBe(20000);
    expect(readiness.pagesRead).toBe(500);
    expect(readiness.readSet).toBe(500);
    expect(readiness.awaitingPage).toBe(19500);
  });

  it("puts a store whose pages were never read in no group at all, rather than calling it clean", () => {
    const readiness = readinessOf(pageReadNeverRan());
    expect(readiness.readSet).toBe(0);
    expect(readiness.clean).toBe(0);
    expect(readiness.merchant).toBe(0);
    expect(readiness.theme).toBe(0);
    expect(readiness.app).toBe(0);
    expect(readiness.awaitingPage).toBe(120);
  });

  it("does not count a page that answered with something other than a crawler's view", () => {
    const rows = [row(1, [], { status: "password" }), row(2, [], { status: "404" }), row(3, [])];
    const readiness = readinessOf(rows);
    expect(readiness.readSet).toBe(1);
    expect(readiness.clean).toBe(1);
  });

  it("an empty store reports zeros with no group and no shop-wide code", () => {
    const readiness = readinessOf([]);
    expect(readiness.readSet).toBe(0);
    expect(readiness.shopWideCodes).toEqual([]);
    expect(readiness.needSomething).toBe(0);
  });
});

describe("amendment 1: a finding on the whole read set leaves the grouping", () => {
  it("removes a code at exactly 100 percent and lists it as shop-wide", () => {
    const readiness = readinessOf(oneEightyNine());
    expect(readiness.readSet).toBe(189);
    expect(readiness.shopWideCodes).toContain("B12");
    // The dial is not pinned at zero, which is the whole reason for the rule.
    expect(readiness.clean).toBeGreaterThan(0);
    expect(readiness.clean + readiness.needSomething).toBe(189);
    // And B12 does not appear inside any group's steps.
    for (const group of readiness.groups) {
      expect(group.rows.map((r) => r.code)).not.toContain("B12");
    }
  });

  it("keeps a code on all but one product as a per-product finding", () => {
    const rows = [];
    for (let i = 0; i < 10; i += 1) rows.push(row(i, i === 9 ? [] : ["B12"]));
    const readiness = readinessOf(rows);
    expect(readiness.shopWideCodes).toEqual([]);
    expect(readiness.theme).toBe(9);
    expect(readiness.clean).toBe(1);
  });

  it("names no shop-wide code on a store with no read set, whatever the rows carry", () => {
    const readiness = readinessOf(pageReadNeverRan());
    expect(readiness.shopWideCodes).toEqual([]);
  });
});

describe("group assignment is a total function on the owner order", () => {
  // Three clean rows beside the interesting one, so no code reaches 100
  // percent of the read set and amendment 1 does not carry it off to the
  // shop-wide card before the owner order is asked anything.
  const beside = [row(90, []), row(91, []), row(92, [])];

  it("puts a product with a merchant gap and a theme gap under the merchant", () => {
    const readiness = readinessOf([row(1, ["A15", "B25"]), ...beside]);
    expect(readiness.merchant).toBe(1);
    expect(readiness.theme).toBe(0);
  });

  it("puts a product with an app gap and a theme gap under the app", () => {
    const readiness = readinessOf([row(1, ["B15", "B25"]), ...beside]);
    expect(readiness.app).toBe(1);
    expect(readiness.theme).toBe(0);
  });

  it("counts a product whose only codes state no verdict as having nothing to fix", () => {
    const readiness = readinessOf([row(1, ["B29", "B32"]), ...beside]);
    expect(readiness.clean).toBe(4);
    expect(readiness.needSomething).toBe(0);
  });

  it("ignores a code this release does not know rather than guessing an owner", () => {
    const readiness = readinessOf([row(1, ["Z9"]), ...beside]);
    expect(readiness.clean).toBe(4);
    expect(groupsPartitionReadSet(readiness)).toBe(true);
  });

  // A one-product shop: everything found is by definition on 100 percent of
  // the read set, so it is a shop-wide fix and the product is clean. That
  // reads oddly and is exactly what the amendment says, so it is asserted
  // here rather than left to be discovered.
  it("treats every finding on a one-product read set as shop-wide", () => {
    const readiness = readinessOf([row(1, ["A15", "B25"])]);
    expect(readiness.readSet).toBe(1);
    expect(readiness.clean).toBe(1);
    expect(readiness.shopWideCodes).toEqual(["A15", "B25"]);
  });

  it("folds a row at a time to the same answer as folding the array", () => {
    const rows = fiftyProducts();
    const counters = createReadinessCounters();
    for (const r of rows) foldReadinessRow(counters, r);
    expect(buildReadiness(counters)).toEqual(readinessOf(rows));
  });
});

describe("the closed state of a group carries its own count and one line", () => {
  it("says what the group is without being opened", () => {
    const readiness = readinessOf(oneEightyNine());
    for (const group of readiness.groups) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.summary.length).toBeGreaterThan(0);
      if (group.count > 0 && group.group !== "clean") {
        expect(group.rows.length).toBeGreaterThan(0);
        expect(group.foot.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives every row inside a group a count, a denominator and somewhere to go", () => {
    const readiness = readinessOf(oneEightyNine());
    for (const group of readiness.groups) {
      for (const line of group.rows) {
        expect(line.count).toBeGreaterThan(0);
        expect(line.denominator).toBe(readiness.readSet);
        expect(line.what.length).toBeGreaterThan(0);
        expect(line.where.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the fixes that cover the whole shop", () => {
  const readiness = readinessOf(oneEightyNine());

  it("carries the shop-wide checks plus the two facts no product row holds", () => {
    const items = shopWideItems(readiness, {
      deliveryStated: false,
      returnsStated: false,
      barcode: { have: 0, of: 189 },
      brand: null,
      productCode: null,
      photo: null,
      catalogue: 189,
      publishedReasons: null,
    });
    expect(items.map((i) => i.key)).toContain("business");
    expect(items.map((i) => i.key)).toContain("barcode");
    expect(items.map((i) => i.key)).toContain("B12");
  });

  it("says nothing about delivery, returns or barcodes when nobody measured them", () => {
    const items = shopWideItems(readiness, {
      deliveryStated: null,
      returnsStated: null,
      barcode: null,
      brand: null,
      productCode: null,
      photo: null,
      catalogue: 189,
      publishedReasons: null,
    });
    expect(items.map((i) => i.key)).toEqual(["B12"]);
  });

  it("does not list a barcode fix on a shop where some products carry one", () => {
    const items = shopWideItems(readiness, {
      deliveryStated: true,
      returnsStated: true,
      barcode: { have: 4, of: 189 },
      brand: null,
      productCode: null,
      photo: null,
      catalogue: 189,
      publishedReasons: null,
    });
    expect(items.map((i) => i.key)).toEqual(["B12"]);
  });

  it("states the 100 percent threshold in its own method line", () => {
    const items = shopWideItems(readiness, {
      deliveryStated: true,
      returnsStated: true,
      barcode: null,
      brand: null,
      productCode: null,
      photo: null,
      catalogue: 189,
      publishedReasons: null,
    });
    expect(shopWideMethod(readiness, items, SCREEN)).toContain("100 percent");
    expect(shopWideMethod(readiness, [], SCREEN)).toContain("Nothing affects every product");
  });
});

describe("Google's free product listings", () => {
  it("counts what was measured and refuses to state a condition nobody recorded", () => {
    const listing = listingReadiness(
      { products: 189, withVendor: 189, withImage: 171, withBarcode: 0 },
      { deliveryStated: false, returnsStated: false },
      189,
    );
    const by = new Map(listing.properties.map((p) => [p.key, p]));
    expect(by.get("brand")).toMatchObject({ have: 189, of: 189 });
    expect(by.get("photo")).toMatchObject({ have: 171, of: 189 });
    expect(by.get("barcode")).toMatchObject({ have: 0, of: 189 });
    expect(by.get("delivery")).toMatchObject({ have: 0, of: 189 });
    // Never a gauge, because the app deliberately publishes no condition.
    expect(by.get("condition")?.have).toBeNull();
    expect(by.get("condition")?.note).toBeTruthy();
    expect(listing.inPlace).toBe(5);
    expect(listing.total).toBe(10);
  });

  it("says the catalogue has not been read rather than showing ten zeros", () => {
    const listing = listingReadiness(null, null, 0);
    expect(listing.unmeasured).toBe(true);
    expect(listing.inPlace).toBe(0);
    for (const property of listing.properties) {
      expect(property.have).toBeNull();
      expect(property.note).toBeTruthy();
    }
  });
});


// --- the fixes of 4 September 2026 ------------------------------------------

describe("the five segments partition the catalogue", () => {
  for (const store of STORES) {
    it(`the four groups plus the unchecked add to the catalogue on ${store.name}`, () => {
      const readiness = readinessOf(store.rows);
      expect(groupsPartitionCatalogue(readiness)).toBe(true);
      expect(readiness.notChecked).toBe(readiness.products - readiness.readSet);
    });
  }

  it("cannot read as finished while products remain unexamined", () => {
    // 50 products, 12 pages read: the old headline was "12 of 12", which is
    // arithmetically true and says from two metres away that the shop is done.
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 50; i += 1) rows.push(row(i, [], { page: i < 12 }));
    const readiness = readinessOf(rows);
    expect(readiness.clean).toBe(12);
    expect(readiness.readSet).toBe(12);
    expect(readiness.products).toBe(50);
    expect(readiness.notChecked).toBe(38);
    expect(readiness.clean).toBeLessThan(readiness.products);
  });
});

describe("every check in the vocabulary is accounted for in a column", () => {
  const codes = Object.keys(FINDING_OWNER) as FindingCode[];

  it("assigns every code to exactly one column", () => {
    const a = codes.filter((c) => codeSource(c) === "A").length;
    const b = codes.filter((c) => codeSource(c) === "B").length;
    expect(a + b).toBe(codes.length);
  });

  for (const store of STORES) {
    it(`balances both columns on ${store.name}`, () => {
      const findings = aggregateFindings(store.rows);
      const readiness = readinessOf(store.rows);
      let total = 0;
      for (const source of ["A", "B"] as const) {
        const account = columnAccount({
          source,
          rows: findings.rows,
          clean: findings.clean,
          shopWideCodes: readiness.shopWideCodes,
          ctx: SCREEN,
        });
        expect(account.balanced, `${source} column on ${store.name}`).toBe(true);
        total += account.total;
      }
      expect(total).toBe(codes.length);
    });
  }
});

describe("the Google listing card answers from the same source as the rest of the screen", () => {
  for (const store of STORES) {
    it(`agrees with the catalogue column on ${store.name}`, () => {
      const findings = aggregateFindings(store.rows);
      // No snapshot row at all: the state a shop is in between its first
      // catalogue read and the pass that writes the rolling figures.
      const listing = listingReadiness(null, null, findings.bulkRead);
      expect(listing.unmeasured).toBe(findings.bulkRead === 0);
    });
  }

  it("does not claim the catalogue is unread on a shop whose rows it has just counted", () => {
    const findings = aggregateFindings(fiftyProducts());
    expect(findings.bulkRead).toBe(50);
    const listing = listingReadiness(null, null, findings.bulkRead);
    expect(listing.unmeasured).toBe(false);
    // The four Shopify supplies are in place; the three counted ones say so
    // rather than showing a zero.
    expect(listing.inPlace).toBe(4);
    for (const key of ["brand", "photo", "barcode"]) {
      const property = listing.properties.find((p) => p.key === key)!;
      expect(property.have).toBeNull();
      expect(property.note).toContain("Not counted yet");
    }
  });

  it("keeps the headline count and the method line from ever disagreeing", () => {
    const listing = listingReadiness(
      { products: 189, withVendor: 189, withImage: 171, withBarcode: 0 },
      { deliveryStated: false, returnsStated: false },
      189,
    );
    const method = listingMethod(listing, SCREEN);
    // The number the KPI prints, printed again by the sentence that explains it.
    expect(method).toContain(`${listing.inPlace} of ${listing.total} above`);
    // And where the tile is not rendered, the same figure without the pointer
    // (R1 1.3, R2-07): never "above" on a surface with nothing above.
    const alone = listingMethod(listing, { surface: "screen", listingKpi: false });
    expect(alone).toContain(`${listing.inPlace} of ${listing.total} in place`);
    expect(alone).not.toContain("above");
    expect(listingMethod(listing, CSV_CONTEXT)).not.toContain("above");
    const byConstruction = listing.properties.filter((p) => p.basis === "byConstruction");
    expect(byConstruction.length).toBe(4);
    expect(method).toContain(`those ${byConstruction.length} are in place`);
    expect(listing.inPlace).toBeGreaterThanOrEqual(byConstruction.length);
  });

  it("claims nothing either way when nothing has been read", () => {
    const listing = listingReadiness(null, null, 0);
    expect(listing.inPlace).toBe(0);
    expect(listingMethod(listing, SCREEN)).toContain("not been read yet");
    expect(listingMethod(listing, SCREEN)).not.toContain("are in place");
  });
});

describe("the shop-wide card", () => {
  const readiness = readinessOf(oneEightyNine());
  const items = shopWideItems(readiness, {
    deliveryStated: false,
    returnsStated: false,
    barcode: { have: 0, of: 355 },
    brand: null,
    productCode: null,
    photo: null,
    catalogue: 355,
    publishedReasons: null,
  });

  it("titles every row as a sentence, never as a bar label with a count on the end", () => {
    for (const item of items) {
      expect(/, on all \d+$/.test(item.title), item.title).toBe(false);
      expect(item.title.length).toBeGreaterThan(10);
    }
  });

  it("gives each row its own scope, because they are not all the same number", () => {
    const business = items.find((i) => i.key === "business")!;
    const barcode = items.find((i) => i.key === "barcode")!;
    const check = items.find((i) => i.key === "B12")!;
    // The catalogue is 355 and the read set is 189. Two of these three are
    // facts about the catalogue.
    expect(business.appliesTo).toContain("355");
    expect(barcode.appliesTo).toContain("355");
    expect(check.appliesTo).toContain("189");
  });

  it("counts the rows it renders in the sentence that points at it", () => {
    expect(shopWideCrossReference(readiness, items, "below")).toContain(`${items.length} fixes`);
    expect(shopWideCrossReference(readiness, items, "below")).toContain("1 of them from a check");
    expect(shopWideCrossReference(readiness, [], "below")).toBe("");
  });
});

describe("the row that says this app is not working", () => {
  function withB6(): ScanRowLike[] {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 20; i += 1) rows.push(row(i, ["B6"]));
    return rows;
  }
  const readiness = readinessOf(withB6());

  it("names the cause on the card when the app recorded one", () => {
    const items = shopWideItems(readiness, {
      deliveryStated: true,
      returnsStated: true,
      barcode: null,
      brand: null,
      productCode: null,
      photo: null,
      catalogue: 20,
      publishedReasons: [
        { nodeType: "Product", emitted: false, reason: "The app embed is not active in the theme." },
        { nodeType: "Organization", emitted: false, reason: "The app embed is not active in the theme." },
      ],
    });
    const item = items.find((i) => i.key === "B6")!;
    // The recorded reason, in the merchant's words and never the operator's
    // string (R1 2.3).
    expect(item.why).toContain(MERCHANT_REASON["The app embed is not active in the theme."]);
    expect(item.why).not.toContain("The app embed is not active in the theme.");
    expect(item.why).toContain("The product itself");
    // Said once, not once per kind.
    expect(item.why!.split("not switched on in your theme").length - 1).toBe(1);
  });

  it("says what it does not know and what would settle it when it has no cause", () => {
    const items = shopWideItems(readiness, {
      deliveryStated: true,
      returnsStated: true,
      barcode: null,
      brand: null,
      productCode: null,
      photo: null,
      catalogue: 20,
      publishedReasons: null,
    });
    const item = items.find((i) => i.key === "B6")!;
    expect(item.why).toContain("We cannot say");
    expect(item.why).toContain("next nightly page read");
  });
});

// --- the fixes of 5 September 2026 ------------------------------------------

describe("the shop-wide threshold is 100 percent of the total the check is measured over (M1)", () => {
  /** 50 catalogue rows, 46 pages read; a catalogue check on all 50, a page check on all 46. */
  function fortySixOfFifty(catalogueCode = "A5", pageCode = "B12"): ScanRowLike[] {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 46; i += 1) rows.push(row(i, [catalogueCode, pageCode]));
    for (let i = 46; i < 50; i += 1) rows.push(row(i, [catalogueCode], { status: "error" }));
    return rows;
  }

  it("measures a catalogue check over the catalogue and a page check over the read set", () => {
    const readiness = readinessOf(fortySixOfFifty());
    expect(readiness.catalogueRead).toBe(50);
    expect(readiness.readSet).toBe(46);
    expect(readiness.shopWideCodes).toEqual(["A5", "B12"]);
    expect(shopWideScope("A5", readiness)).toEqual({ over: "catalogue", of: 50 });
    expect(shopWideScope("B12", readiness)).toEqual({ over: "readSet", of: 46 });
    const items = shopWideItems(readiness, {
      deliveryStated: true,
      returnsStated: true,
      barcode: null,
      brand: null,
      productCode: null,
      photo: null,
      catalogue: 50,
      publishedReasons: null,
    });
    expect(items.find((i) => i.key === "A5")!.appliesTo).toContain("Found on all 50 products in your catalogue.");
    expect(items.find((i) => i.key === "B12")!.appliesTo).toContain("Found on all 46 products whose page we read.");
    // The method line names both totals rather than one for all.
    const method = shopWideMethod(readiness, items, SCREEN);
    expect(method).toContain("all 50 products in your catalogue");
    expect(method).toContain("all 46 products whose page we read");
  });

  it("keeps a catalogue check on every read page but not every catalogue row as per-product", () => {
    // A5 on the 46 read rows only: 46 of 46 read, 46 of 50 in the catalogue.
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 46; i += 1) rows.push(row(i, ["A5"]));
    for (let i = 46; i < 50; i += 1) rows.push(row(i, [], { status: "error" }));
    const readiness = readinessOf(rows);
    expect(readiness.shopWideCodes).toEqual([]);
    expect(readiness.merchant).toBe(46);
  });

  for (const store of STORES) {
    it(`holds on ${store.name}`, () => {
      const readiness = readinessOf(store.rows);
      const findings = aggregateFindings(store.rows);
      for (const code of readiness.shopWideCodes) {
        const scope = shopWideScope(code, readiness);
        const found = findings.rows.find((r) => r.code === code)!;
        // The shop-wide sentence and the findings row name the same total.
        expect(found.count, `${store.name}: ${code}`).toBe(scope.of);
        expect(found.denominator, `${store.name}: ${code}`).toBe(scope.of);
      }
      expect(groupsPartitionReadSet(readiness)).toBe(true);
    });
  }
});

describe("the clean line groups by denominator (R1 1.1)", () => {
  it("names both totals when the page column has two", () => {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 46; i += 1) rows.push(row(i, []));
    for (let i = 46; i < 50; i += 1) rows.push(row(i, [], { status: "error" }));
    const findings = aggregateFindings(rows);
    const readiness = readinessOf(rows);
    const b5 = findings.clean.find((r) => r.code === "B5")!;
    expect(b5.denominator).toBe(50);
    expect(findings.pagesRead).toBe(46);
    const account = columnAccount({
      source: "B",
      rows: findings.rows,
      clean: findings.clean,
      shopWideCodes: readiness.shopWideCodes,
      ctx: SCREEN,
    });
    const clean = account.lines[0];
    expect(clean).toMatch(/\d+ checks found nothing at all on 46 pages; 1 check found nothing at all on 50 pages, so there is nothing to show\./);
    expect(account.balanced).toBe(true);
  });
});

describe("sentences point only at what the surface renders (root cause A)", () => {
  const rows = fiftyProducts();
  const findings = aggregateFindings(rows);
  const readiness = readinessOf(rows);
  const REFERENTS = [
    /\babove\b/,
    /\bbelow\b/,
    /\bthis screen\b/,
    /\bthis report\b/,
    /\bthis card\b/,
    /\bthe dial\b/,
    /\bthe line above\b/,
    /\bfoot of\b/,
  ];

  it("names nothing on a spreadsheet", () => {
    const lines = [
      ...(["A", "B"] as const).flatMap(
        (source) =>
          columnAccount({
            source,
            rows: findings.rows,
            clean: findings.clean,
            shopWideCodes: readiness.shopWideCodes,
            ctx: CSV_CONTEXT,
          }).lines,
      ),
      shopWideMethod(readiness, [], CSV_CONTEXT),
      readinessMethod(readiness, [], CSV_CONTEXT),
      unreadSentence(readinessOf(twentyThousand()), 0, CSV_CONTEXT) ?? "",
      listingMethod(listingReadiness(null, null, 50), CSV_CONTEXT),
    ];
    for (const line of lines) {
      for (const referent of REFERENTS) {
        expect(referent.test(line), `"${referent.source}" in a spreadsheet line: ${line}`).toBe(false);
      }
    }
  });

  it("points at the counted card only when it is rendered", () => {
    const b = (ctx: SurfaceContext) =>
      columnAccount({ source: "B", rows: findings.rows, clean: findings.clean, shopWideCodes: [], ctx });
    expect(b({ ...SCREEN, counted: true }).lines.join(" ")).toContain("at the foot of this screen");
    expect(b({ ...SCREEN, counted: false }).lines.join(" ")).not.toContain("foot of");
    expect(b({ surface: "paper", counted: true }).lines.join(" ")).toContain("at the foot of this report");
  });

  it("points at a collections or blog total only when one is rendered", () => {
    const a = columnAccount({ source: "A", rows: findings.rows, clean: findings.clean, shopWideCodes: [], ctx: { ...SCREEN, collectionsTotal: false } });
    expect(a.lines.join(" ")).toContain("counted against your collections");
    expect(a.lines.join(" ")).not.toContain("own total above");
    const b = columnAccount({ source: "B", rows: findings.rows, clean: findings.clean, shopWideCodes: [], ctx: { ...SCREEN, blogTotal: false } });
    expect(b.lines.join(" ")).toContain("counted against your blog posts");
    expect(b.lines.join(" ")).not.toContain("own total above");
    expect(columnAccount({ source: "B", rows: findings.rows, clean: findings.clean, shopWideCodes: [], ctx: SCREEN }).lines.join(" ")).toContain("own total above");
  });

  it("says where the groups are, or nothing, from the shop-wide method line", () => {
    expect(shopWideMethod(readiness, [], { surface: "screen", groups: "above" })).toContain("in the groups above");
    expect(shopWideMethod(readiness, [], { surface: "paper", groups: "below" })).toContain("in the groups below");
    expect(shopWideMethod(readiness, [], { surface: "screen", groups: null })).not.toContain("above");
  });

  it("names the dial only where it is drawn", () => {
    expect(readinessMethod(readiness, [], { surface: "screen", dial: true, shopWide: "below" })).toContain("The dial is drawn");
    expect(readinessMethod(readiness, [], { surface: "screen", dial: false, shopWide: "below" })).not.toContain("dial");
  });

  it("says nothing was shown above when no bar is drawn", () => {
    const empty = aggregateFindings([]);
    const a = columnAccount({ source: "A", rows: empty.rows, clean: empty.clean, shopWideCodes: [], ctx: SCREEN });
    expect(a.lines[a.lines.length - 1]).toContain("none with something found");
    expect(a.lines[a.lines.length - 1]).not.toContain("0 shown above");
  });
});

describe("the products in no group, in one sentence (R2-16)", () => {
  it("tells apart pages never opened from pages that could not be read, and says they are the same pages", () => {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 46; i += 1) rows.push(row(i, []));
    for (let i = 46; i < 50; i += 1) rows.push(row(i, ["B5"], { status: "error" }));
    const readiness = readinessOf(rows);
    const findings = aggregateFindings(rows);
    expect(readiness.awaitingPage).toBe(4);
    expect(findings.couldNotBeRead).toBe(4);
    const sentence = unreadSentence(readiness, findings.couldNotBeRead, SCREEN)!;
    expect(sentence).toContain("4 of 50 products have been read from your catalogue, and their page was opened but could not be read");
    expect(sentence).toContain("the same 4 the line above counts as could not be read");
    expect(sentence).not.toContain("not been opened yet");
    // Without the read line above it, the sentence stands on its own.
    expect(unreadSentence(readiness, findings.couldNotBeRead, { surface: "paper" })).not.toContain("line above");
  });

  it("names both kinds when both exist", () => {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 40; i += 1) rows.push(row(i, []));
    for (let i = 40; i < 46; i += 1) rows.push(row(i, [], { page: false }));
    for (let i = 46; i < 50; i += 1) rows.push(row(i, ["B5"], { status: "error" }));
    const sentence = unreadSentence(readinessOf(rows), aggregateFindings(rows).couldNotBeRead, SCREEN)!;
    expect(sentence).toContain("10 of 50 products have a catalogue row but are not fully checked yet");
    expect(sentence).toContain("6 have not had their page opened yet");
    expect(sentence).toContain("4 were opened but could not be read");
  });

  it("is null when every product is fully checked", () => {
    expect(unreadSentence(readinessOf(fiftyProducts()), 0, SCREEN)).toBeNull();
  });
});

describe("counts in words (R2-24, R2-27)", () => {
  it("pluralises and separates thousands", () => {
    expect(nProducts(1)).toBe("1 product");
    expect(nProducts(20000)).toBe("20,000 products");
    expect(allOf(1, "whose page we read")).toBe("the one product whose page we read");
    expect(allOf(46, "whose page we read")).toBe("all 46 products whose page we read");
  });

  it("reads as English on a one-product store", () => {
    const readiness = readinessOf([row(1, ["A15", "B25"])]);
    const items = shopWideItems(readiness, {
      deliveryStated: true,
      returnsStated: true,
      barcode: { have: 0, of: 1 },
      brand: null,
      productCode: null,
      photo: null,
      catalogue: 1,
      publishedReasons: null,
    });
    const text = [
      ...items.flatMap((i) => [i.appliesTo, i.title, i.what]),
      shopWideMethod(readiness, items, SCREEN),
      shopWideCrossReference(readiness, items, "below"),
      listingMethod(listingReadiness({ products: 1, withVendor: 1, withImage: 1, withBarcode: 0 }, null, 1), SCREEN),
    ].join(" ");
    expect(text).not.toMatch(/\ball 1\b/);
    expect(text).not.toMatch(/\b1 products\b/);
    expect(text).toContain("the one product");
  });
});

describe("the reasons the page read records reach the merchant in plain words (R1 2.3)", () => {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 12; i += 1) rows.push(row(i, ["B6"]));
  const readiness = readinessOf(rows);
  const facts = (reason: string) => ({
    deliveryStated: true,
    returnsStated: true,
    barcode: null,
    brand: null,
    productCode: null,
    photo: null,
    catalogue: 12,
    publishedReasons: [{ nodeType: "WebSite/SearchAction", emitted: false, reason }],
  });

  it("translates a recorded reason and never prints the operator's sentence", () => {
    const raw =
      "The SEO module is enabled but the last scan did not find this node on the page - check that the app embed is active in the current theme.";
    const item = shopWideItems(readiness, facts(raw)).find((i) => i.key === "B6")!;
    expect(item.why).toContain(MERCHANT_REASON[raw]);
    expect(item.why).not.toContain("node");
    expect(item.why).toContain("Your shop and its search box");
  });

  it("says so when it cannot explain a reason, rather than printing it", () => {
    const item = shopWideItems(readiness, facts("Something new the scan wrote.")).find((i) => i.key === "B6")!;
    expect(item.why).toContain(UNEXPLAINED_REASON);
    expect(item.why).not.toContain("Something new the scan wrote");
  });
});

// --- the vocabulary ---------------------------------------------------------

/**
 * Every code the vocabulary knows, taken from the owner record itself rather
 * than from a list written here, so a code added tomorrow is covered without
 * this file being touched.
 */
const CODES = Object.keys(FINDING_OWNER) as FindingCode[];

/**
 * The words a shop owner would have to look up. Matched with word boundaries
 * so an ordinary word that happens to contain one of them does not fail the
 * suite, and case-insensitively so a capitalised one does not slip through.
 */
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "canonical", pattern: /\bcanonical\b/i },
  { name: "structured data", pattern: /\bstructured data\b/i },
  { name: "schema", pattern: /\bschema\b/i },
  { name: "node", pattern: /\bnodes?\b/i },
  { name: "hreflang", pattern: /\bhreflang\b/i },
  { name: "GTIN", pattern: /\bgtin\b/i },
  { name: "alt text", pattern: /\balt[- ]?text\b/i },
  { name: "lazy load", pattern: /\blazy[- ]?load/i },
  { name: "Open Graph", pattern: /\bopen graph\b/i },
  { name: "H1", pattern: /\bh1\b/i },
  { name: "meta", pattern: /\bmeta\b/i },
  { name: "metafield", pattern: /\bmetafields?\b/i },
  { name: "snapshot", pattern: /\bsnapshots?\b/i },
  { name: "operator", pattern: /\boperators?\b/i },
  { name: "setup code", pattern: /\bsetup code\b/i },
  { name: "robots.txt", pattern: /\brobots\b/i },
  { name: "liquid", pattern: /\bliquid\b/i },
  { name: "Fill catalogue", pattern: /\bfill catalogue\b/i },
  { name: "a check code", pattern: /\b[AB]\d{1,2}\b/ },
];

describe("the language rule of the merchant dashboard", () => {
  it("has a plain label, a shop-wide sentence, a step and an owner for every code", () => {
    for (const code of CODES) {
      expect(OWNER_LABEL[code], code).toBeTruthy();
      expect(SHOP_WIDE_LABEL[code], code).toBeTruthy();
      expect(OWNER_STEPS[code]?.what, code).toBeTruthy();
      expect(OWNER_STEPS[code]?.where, code).toBeTruthy();
      expect(FINDING_OWNER[code], code).toBeTruthy();
    }
  });

  it("covers every check the screens render", () => {
    for (const check of CHECKS) {
      expect(OWNER_LABEL[check.code], check.code).toBeTruthy();
      expect(OWNER_STEPS[check.code], check.code).toBeTruthy();
    }
  });

  it("uses none of the vocabulary a merchant would have to look up", () => {
    for (const code of CODES) {
      const strings = [
        OWNER_LABEL[code],
        SHOP_WIDE_LABEL[code],
        OWNER_STEPS[code].what,
        OWNER_STEPS[code].where,
      ];
      for (const text of strings) {
        for (const word of FORBIDDEN) {
          expect(
            word.pattern.test(text),
            `${code} says "${word.name}" in: ${text}`,
          ).toBe(false);
        }
      }
    }
  });

  it("never prints a check code on the merchant's screen", () => {
    for (const code of CODES) {
      const strings = [OWNER_LABEL[code], OWNER_STEPS[code].what, OWNER_STEPS[code].where];
      for (const text of strings) {
        expect(/\b[AB]\d{1,2}\b/.test(text), `${code} names a check code in: ${text}`).toBe(false);
      }
    }
  });

  it("keeps every sentence the screen assembles free of the same vocabulary", () => {
    const readiness: Readiness = readinessOf(oneEightyNine());
    const findings = aggregateFindings(oneEightyNine());
    const items = shopWideItems(readiness, {
      deliveryStated: false,
      returnsStated: false,
      barcode: { have: 0, of: 189 },
      brand: null,
      productCode: null,
      photo: null,
      catalogue: 189,
      publishedReasons: [
        { nodeType: "Product", emitted: false, reason: "The app embed is not active in the theme." },
      ],
    });
    const strings = [
      ...readiness.groups.flatMap((g) => [g.title, g.summary, g.foot]),
      ...items.flatMap((i) => [i.title, i.what, i.why ?? "", i.where, i.appliesTo, i.ownerNote]),
      shopWideMethod(readiness, items, SCREEN),
      shopWideMethod(readiness, items, CSV_CONTEXT),
      shopWideCrossReference(readiness, items, "below"),
      shopWideCrossReference(readiness, items, "above"),
      shopWideCrossReference(readiness, items, null),
      readinessMethod(readiness, items, SCREEN),
      readinessMethod(readiness, items, { surface: "screen", groups: null, shopWide: null }),
      unreadSentence(readinessOf(twentyThousand()), 0, SCREEN) ?? "",
      listingMethod(
        listingReadiness(
          { products: 189, withVendor: 189, withImage: 171, withBarcode: 0 },
          { deliveryStated: false, returnsStated: false },
          189,
        ),
        SCREEN,
      ),
      ...(["A", "B"] as const).flatMap((source) =>
        [SCREEN, CSV_CONTEXT].flatMap(
          (ctx) =>
            columnAccount({
              source,
              rows: findings.rows,
              clean: findings.clean,
              shopWideCodes: readiness.shopWideCodes,
              ctx,
            }).lines,
        ),
      ),
      ...Object.values(MERCHANT_REASON),
      UNEXPLAINED_REASON,
    ];
    for (const text of strings) {
      for (const word of FORBIDDEN) {
        expect(word.pattern.test(text), `"${word.name}" in: ${text}`).toBe(false);
      }
      expect(/\b[AB]\d{1,2}\b/.test(text), `a check code in: ${text}`).toBe(false);
    }
  });

  it("writes plain characters only, everywhere the merchant reads", () => {
    // Em dash, en dash, curly quotes, the ellipsis character, HTML entities.
    const plain = /^[^–—‘’“”…]*$/;
    const readiness = readinessOf(oneEightyNine());
    const strings = [
      ...CODES.flatMap((code) => [
        OWNER_LABEL[code],
        SHOP_WIDE_LABEL[code],
        OWNER_STEPS[code].what,
        OWNER_STEPS[code].where,
      ]),
      ...readiness.groups.flatMap((g) => [g.title, g.summary, g.foot]),
      ...shopWideItems(readiness, {
        deliveryStated: false,
        returnsStated: false,
        barcode: { have: 0, of: 189 },
        brand: null,
        productCode: null,
        photo: null,
        catalogue: 189,
        publishedReasons: null,
      }).flatMap((i) => [i.title, i.what, i.where, i.appliesTo, i.ownerNote]),
    ];
    for (const text of strings) {
      expect(plain.test(text), `not plain characters: ${text}`).toBe(true);
      expect(/&[a-z]+;|&#\d+;/i.test(text), `HTML entity in: ${text}`).toBe(false);
    }
  });
});
