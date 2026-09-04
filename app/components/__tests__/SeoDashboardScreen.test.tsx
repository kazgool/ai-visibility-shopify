import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";

// The merchant SEO dashboard, asserted on the markup a merchant reads.
//
// The acceptance row of PRD-SEO-FULL-ONPAGE section 5, kept here rather than
// declined: "every count on the card is asserted on the rendered string, not
// only on the aggregate". seo-readiness.test.ts can prove the four groups
// partition the read set and still not prove the screen prints the four
// numbers, or that it prints a sentence rather than a zero on a store where no
// page was ever read. Rendering is the only thing that does.
//
// The five stores of section 4.2, each rendered whole: a 50-product fixture, a
// 189-product shop, a 20,000-product store, an empty store, and a store where
// the live page read never ran.
//
// No jsdom and no testing-library: renderToStaticMarkup needs neither, and
// Polaris renders under it with an AppProvider and an empty i18n. This is why
// the screen is a component and the route is a loader.

import { SeoDashboardScreen, type SeoDashboardData } from "../SeoDashboardScreen";
import { readinessOf } from "../../services/seo-readiness";
import { aggregateFindings, themeNodeAggregate, type ScanRowLike } from "../../services/seo-aggregate";
import type { FactsRow } from "../../services/seo-since";

const DAY = "2026-09-04T03:45:00.000Z";

function row(
  id: number,
  codes: string[],
  options: { page?: boolean; status?: string } = {},
): ScanRowLike {
  const page = options.page ?? true;
  return {
    productId: `gid://shopify/Product/${id}`,
    handle: `p-${id}`,
    bulkAt: DAY,
    scannedAt: page ? DAY : null,
    status: page ? (options.status ?? "ok") : null,
    findings: codes.map((code) => ({
      code,
      source: code.startsWith("A") ? "A" : "B",
      detail: {},
    })),
    nodes: [],
  };
}

function facts(over: Partial<FactsRow> = {}): FactsRow {
  return {
    takenAt: "2026-08-15T08:00:00.000Z",
    takenBy: "unlock",
    products: 189,
    metaTitleSet: 62,
    metaTitleOurs: 0,
    metaDescriptionSet: 41,
    metaDescriptionOurs: 0,
    withBarcode: 0,
    withVendor: 189,
    withSku: 189,
    withImage: 171,
    productNodeTheme: null,
    productNodeNone: null,
    themeNodeTypes: null,
    findingsByCode: null,
    pagesRead: 0,
    ...over,
  };
}

function data(rows: ScanRowLike[], over: Partial<Extract<SeoDashboardData, { unlocked: true }>> = {}) {
  const full: Extract<SeoDashboardData, { unlocked: true }> = {
    unlocked: true,
    domain: "republicabio.ro",
    findings: aggregateFindings(rows),
    themeNodes: themeNodeAggregate(rows),
    readiness: readinessOf(rows),
    budget: 500,
    blockedBy: null,
    since: { before: null, today: null },
    business: null,
    blogPosts: null,
    collections: null,
    published: { at: null, reasons: [] },
    ...over,
  };
  return full;
}

/** The markup as plain text, so a sentence split across elements is one sentence. */
function render(value: SeoDashboardData): string {
  const html = renderToStaticMarkup(
    <AppProvider i18n={{}}>
      <SeoDashboardScreen data={value} />
    </AppProvider>,
  );
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// --- the five stores --------------------------------------------------------

function fiftyProducts(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 50; i += 1) {
    const codes: string[] = [];
    if (i < 12) codes.push("B17");
    if (i < 8) codes.push("A5");
    if (i >= 12 && i < 20) codes.push("B2");
    if (i >= 20 && i < 24) codes.push("B15");
    rows.push(row(i, codes));
  }
  return rows;
}

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

function twentyThousand(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 20000; i += 1) {
    if (i < 500) rows.push(row(i, i < 120 ? ["B17"] : []));
    else rows.push(row(i, ["A5"], { page: false }));
  }
  return rows;
}

function pageReadNeverRan(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 120; i += 1) rows.push(row(i, ["A5"], { page: false }));
  return rows;
}

describe("a shop without the SEO module", () => {
  it("renders no figure at all, only the sentence", () => {
    const text = render({ unlocked: false });
    expect(text).toContain("not enabled for this shop");
    expect(text).not.toContain("of 189");
  });
});

describe("a 50-product fixture, every page read", () => {
  const rows = fiftyProducts();
  const readiness = readinessOf(rows);
  const text = render(data(rows));

  it("prints the four group counts and the denominator they add to", () => {
    expect(readiness.readSet).toBe(50);
    expect(readiness.clean + readiness.merchant + readiness.theme + readiness.app).toBe(50);
    expect(text).toContain("of 50 products");
    expect(text).toContain(String(readiness.clean));
  });

  it("names the groups in the merchant's words and never a check code", () => {
    expect(text).toContain("Nothing to fix");
    expect(text).toContain("You can fix these yourself, no developer");
    expect(text).toContain("These need a change to your theme");
    expect(text).toContain("We can fix these, once you have read them");
    expect(text).not.toMatch(/\bB17\b/);
    expect(text).not.toMatch(/\bA5\b/);
  });

  it("carries a denominator beside every count it states", () => {
    expect(text).toContain("Products with very little text on the page");
    expect(text).toContain("12 of 50");
  });
});

describe("a 189-product shop with one problem on every product", () => {
  const rows = oneEightyNine();
  const text = render(
    data(rows, {
      since: { before: facts(), today: facts({ takenAt: DAY, metaTitleSet: 189, pagesRead: 189 }) },
      business: { deliveryStated: false, returnsStated: false },
    }),
  );

  it("does not pin the dial at zero, which is what amendment 1 is for", () => {
    const readiness = readinessOf(rows);
    expect(readiness.clean).toBeGreaterThan(0);
    expect(text).toContain(`${readiness.clean}`);
    expect(text).toContain("of 189 products");
  });

  it("moves the problem that flags every product into the shop-wide card", () => {
    expect(text).toContain("fixes that cover the whole shop");
    expect(text).toContain("Pages whose largest heading is not the product, on all 189");
    expect(text).toContain("100 percent");
  });

  it("lists the two shop-wide facts that no product row carries", () => {
    expect(text).toContain("Your delivery time and return window are blank");
    expect(text).toContain("No product has a barcode, on all 189");
  });

  it("counts the checks that found nothing per column, against that column's own denominator", () => {
    // One line under each heading, and never one line merging the two: on a
    // shop that has read every page both denominators are 189, and a shared
    // sentence quotes one number under the other heading.
    expect(text).toContain("products, so there is nothing to show");
    expect(text).toContain("pages, so there is nothing to show");
  });

  it("heads the then-and-now table so a reader knows which column is which", () => {
    expect(text).toContain("Then");
    expect(text).toContain("Now");
    expect(text).toContain("Change");
  });

  it("says one problem is not repeated below, in the singular", () => {
    expect(text).toContain("one of them is in the shop-wide card below");
    expect(text).toContain("is not repeated here; it is in the shop-wide card above");
  });

  it("shows what moved since the snapshot, in plain words", () => {
    expect(text).toContain("Products with a title for Google");
    expect(text).not.toContain("meta title");
  });
});

describe("a 20,000-product store part-way through its first page read", () => {
  const rows = twentyThousand();
  const text = render(data(rows));

  it("counts against the pages actually read and says how many are waiting", () => {
    expect(text).toContain("500 of 20000 products fully checked");
    expect(text).toContain("19500 of 20000 products have been read from your catalogue");
    expect(text).toContain("of 500 products");
  });

  it("never claims a product nobody read is clean", () => {
    const readiness = readinessOf(rows);
    expect(readiness.clean).toBe(380);
    expect(readiness.awaitingPage).toBe(19500);
  });
});

describe("an empty store", () => {
  const text = render(data([]));

  it("says there is nothing to read rather than printing zeros", () => {
    expect(text).toContain("No products have been read into this table yet");
    expect(text).toContain("No product has been fully checked yet");
    expect(text).not.toContain("0 of 0");
  });

  it("says the catalogue has not been read instead of drawing ten empty gauges", () => {
    expect(text).toContain("Your catalogue has not been read yet");
  });
});

describe("a store where the live page read never ran", () => {
  const rows = pageReadNeverRan();
  const text = render(data(rows));

  it("groups nothing and says why, rather than calling 120 products clean", () => {
    expect(text).toContain("No product has been fully checked yet");
    expect(text).toContain("120 of 120 products have been read from your catalogue");
    expect(text).not.toContain("120 of 120 products fully checked");
  });

  it("says nothing at all about what the pages publish", () => {
    expect(text).toContain("No product page has been read yet");
  });

  it("still refuses to state a condition nobody recorded", () => {
    const withFacts = render(data(rows, { since: { before: null, today: facts() } }));
    expect(withFacts).toContain("New or used");
    expect(withFacts).toContain("not published");
    expect(withFacts).toContain("would be a claim you never made");
  });
});

describe("the counts that state no verdict", () => {
  it("renders them apart, as an average with the pages beside it", () => {
    const rows = [
      {
        ...row(1, []),
        findings: [
          {
            code: "B29",
            source: "B",
            detail: { breadcrumb: 2, related: 4, collection: 6, inDescription: 0, total: 12 },
          },
          { code: "B32", source: "B", detail: { scripts: 14, origins: 3 } },
        ],
      },
      row(2, []),
    ];
    const text = render(data(rows));
    expect(text).toContain("Counted, with no verdict");
    expect(text).toContain("average over 1 pages");
    expect(text).toContain("nobody credible states a target");
    // And it never turns into a finding: the product carrying them is clean.
    expect(readinessOf(rows).clean).toBe(2);
  });
});
