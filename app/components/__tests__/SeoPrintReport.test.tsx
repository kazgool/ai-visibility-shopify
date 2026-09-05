import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";

// The printable report, asserted on the markup that goes on paper, and against
// the screen it is a copy of.
//
// The acceptance criterion this file exists for: "a figure on the print page
// and the same figure on the screen cannot diverge, on all five fixture
// stores". The mechanism is that neither page computes a figure - both call
// dashboardDerived and keyFigures - and the assertion below is what proves the
// mechanism is actually wired, on every store, rather than merely intended.
//
// No jsdom: renderToStaticMarkup needs none, and the report uses no Polaris
// component at all, which is the literal form of "no admin chrome on paper".

import { SeoDashboardScreen, type SeoDashboardData } from "../SeoDashboardScreen";
import { SeoPrintReport, type SeoPrintData } from "../SeoPrintReport";
import { readinessOf } from "../../services/seo-readiness";
import { FINDING_OWNER } from "../../services/seo-findings";
import { dashboardDerived, keyFigures } from "../../services/seo-report";
import { aggregateFindings, themeNodeAggregate, type ScanRowLike } from "../../services/seo-aggregate";
import type { FactsRow } from "../../services/seo-since";

const DAY = "2026-09-04T03:45:00.000Z";
const PRODUCED = "2026-09-05T09:00:00.000Z";

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

function data(
  rows: ScanRowLike[],
  over: Partial<Extract<SeoDashboardData, { unlocked: true }>> = {},
): Extract<SeoDashboardData, { unlocked: true }> {
  return {
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
}

function text(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function renderScreen(value: SeoDashboardData): string {
  return text(
    renderToStaticMarkup(
      <AppProvider i18n={{}}>
        <SeoDashboardScreen data={value} />
      </AppProvider>,
    ),
  );
}

function renderPrint(value: SeoPrintData): string {
  return renderToStaticMarkup(<SeoPrintReport data={value} />);
}

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

const STORES: [string, Extract<SeoDashboardData, { unlocked: true }>][] = [
  ["50 products", data(fiftyProducts())],
  [
    "189 products",
    data(oneEightyNine(), {
      business: { deliveryStated: false, returnsStated: false },
      since: { before: facts(), today: facts({ takenAt: DAY, takenBy: "current", withBarcode: 4 }) },
      published: {
        at: DAY,
        reasons: [{ nodeType: "Product", emitted: false, reason: "The app embed is not active in the theme." }],
      },
    }),
  ],
  ["20,000 products", data(twentyThousand())],
  ["empty", data([])],
  ["page read never ran", data(pageReadNeverRan())],
];

function printFrom(
  value: Extract<SeoDashboardData, { unlocked: true }>,
): Extract<SeoPrintData, { unlocked: true }> {
  return {
    unlocked: true,
    domain: value.domain,
    findings: value.findings,
    readiness: value.readiness,
    since: value.since,
    business: value.business,
    published: value.published,
    producedAt: PRODUCED,
  };
}

// ---------------------------------------------------------------------------

describe("the report and the screen cannot show different figures", () => {
  for (const [name, value] of STORES) {
    it(`prints the same headline figures on ${name}`, () => {
      const screen = renderScreen(value);
      const paper = text(renderPrint(printFrom(value)));
      const figures = keyFigures(printFrom(value), dashboardDerived(printFrom(value)));

      expect(figures.length).toBeGreaterThan(0);
      for (const figure of figures) {
        // The figure the report prints is the figure the screen prints. Not a
        // recomputation that happens to agree today: the same string, from the
        // same call, asserted present in both renders.
        expect(paper, `${name}: ${figure.key} missing from the report`).toContain(figure.value);
        expect(screen, `${name}: ${figure.key} missing from the screen`).toContain(figure.value);
        if (figure.of !== null) {
          expect(paper, `${name}: ${figure.key} denominator missing on paper`).toContain(figure.of);
        }
      }
    });

    it(`gives every group its own count and denominator on ${name}`, () => {
      const paper = text(renderPrint(printFrom(value)));
      for (const group of value.readiness.groups) {
        expect(paper, `${name}: ${group.group}`).toContain(
          `${group.title} - ${group.count} of ${group.denominator}`,
        );
      }
    });
  }
});

describe("what a merchant hands to a client or a developer", () => {
  const paper = renderPrint(printFrom(STORES[1][1]));

  it("carries the shop, the date and the scope in its first lines", () => {
    expect(text(paper)).toContain("republicabio.ro");
    expect(text(paper)).toContain("2026-09-05");
    expect(text(paper)).toContain("189 of 189 products fully checked");
  });

  it("carries a method line under the figures", () => {
    expect(text(paper)).toContain("counted once, under the owner of its most immediate problem");
  });

  it("keeps every group open, with no disclosure control at all", () => {
    // Paper has no triangle to press. Built for Shopify's collapsed-section
    // rule and the merchant's photocopier want the same thing here.
    expect(paper).not.toContain("aria-expanded");
    expect(paper).not.toContain("Polaris");
    expect(text(paper)).toContain("Every group is open here");
  });

  it("asks the printer not to break a card down the middle", () => {
    expect(paper).toContain("break-inside: avoid");
    expect(paper).toContain("page-break-inside: avoid");
    expect(paper).toContain("@page");
  });

  it("hides the button and its note when the page is printed", () => {
    expect(paper).toContain(".noprint { display: none !important; }");
    // And the note is on the page in the first place: the frame can refuse the
    // dialog, and a merchant left pressing a dead button is the failure.
    expect(text(paper)).toContain("Print frame");
  });

  it("uses the merchant vocabulary and never a check code", () => {
    expect(text(paper)).not.toMatch(/\b[AB]\d{1,2}\b/);
  });

  it("names the cause of a shop-wide app problem rather than delegating it", () => {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 12; i += 1) rows.push(row(i, ["B6"]));
    const value = data(rows, {
      published: {
        at: DAY,
        reasons: [
          { nodeType: "Product", emitted: false, reason: "The app embed is not active in the theme." },
        ],
      },
    });
    expect(text(renderPrint(printFrom(value)))).toContain(
      "The app embed is not active in the theme.",
    );
  });
});

describe("a store nothing has read yet", () => {
  const paper = text(renderPrint(printFrom(data([]))));

  it("says the catalogue size rather than claiming a share of it", () => {
    expect(paper).toContain("0 products in the catalogue");
    expect(paper).not.toContain("100%");
  });

  it("says there is no comparison rather than printing an empty table", () => {
    expect(paper).toContain("What has changed since we started");
  });
});

describe("a shop without the SEO module", () => {
  it("prints a sentence and no figure", () => {
    const paper = text(renderPrint({ unlocked: false }));
    expect(paper).toContain("switched on per shop");
    expect(paper).not.toContain("of 189");
  });
});

// ---------------------------------------------------------------------------

/**
 * The words a shop owner would have to look up, and the check codes.
 *
 * This guard is asserted on the RENDERED MARKUP of both merchant screens, not
 * on the label records. The version that read the records passed while the
 * printed report carried "Open Graph tags absent", "The first image on the
 * page is lazy-loaded" and "Title tag absent, or a length that a phone result
 * often cuts" - because the component rendered `row.label`, which is
 * CHECK_LABEL, a field the record-level guard never looks at. A test that can
 * pass while the words are on the page is not the test.
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
  { name: "meta title", pattern: /\bmeta\b/i },
  { name: "tag absent", pattern: /\btags? absent\b/i },
  { name: "a check code", pattern: /\b[AB]\d{1,2}\b/ },
];

/**
 * A store carrying every code in the vocabulary at once, so every plain label,
 * every step and every group row is actually rendered by the guard below. The
 * five fixture stores between them touch a handful of codes; a word can only
 * be caught on a page it is printed on.
 */
function everyCode(): ScanRowLike[] {
  const codes = Object.keys(FINDING_OWNER);
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 12; i += 1) {
    // Every code on the first product, and a spread over the rest, so codes
    // land both as ordinary findings and as shop-wide ones.
    rows.push(row(i, i === 0 ? codes : codes.filter((_, n) => n % 3 === i % 3)));
  }
  return rows;
}

describe("the vocabulary rule, asserted on what is rendered", () => {
  const withEveryCode = data(everyCode(), {
    business: { deliveryStated: false, returnsStated: false },
    since: { before: facts(), today: facts({ takenAt: DAY, takenBy: "current" }) },
    published: {
      at: DAY,
      reasons: [
        { nodeType: "Product", emitted: false, reason: "The app embed is not active in the theme." },
      ],
    },
  });
  const all: [string, Extract<SeoDashboardData, { unlocked: true }>][] = [
    ...STORES,
    ["every code at once", withEveryCode],
  ];

  for (const [name, value] of all) {
    it(`keeps the printed report free of it on ${name}`, () => {
      const paper = text(renderPrint(printFrom(value)));
      for (const word of FORBIDDEN) {
        const hit = paper.match(word.pattern);
        expect(hit === null, `${name}: the report says "${hit?.[0]}" (${word.name})`).toBe(true);
      }
    });

    it(`keeps the screen free of it on ${name}`, () => {
      const screen = renderScreen(value);
      for (const word of FORBIDDEN) {
        const hit = screen.match(word.pattern);
        expect(hit === null, `${name}: the screen says "${hit?.[0]}" (${word.name})`).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The defects read off the printed page, 5 September 2026. Each of these fails
// if the thing that was on paper comes back.

/** 46 pages that answered and 4 that did not, so B5's denominator is 50. */
function fourPagesUnread(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 46; i += 1) rows.push(row(i, i < 20 ? ["B17"] : []));
  for (let i = 46; i < 50; i += 1) rows.push(row(i, ["B5"], { status: "error" }));
  return rows;
}

describe("the printed page, read on paper", () => {
  const shopWide = () => {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 12; i += 1) rows.push(row(i, ["A1", "B25"]));
    return rows;
  };
  const shopWideValue = data(shopWide(), {
    business: { deliveryStated: true, returnsStated: true },
    since: {
      before: null,
      today: facts({
        takenAt: DAY,
        takenBy: "current",
        products: 50,
        withBarcode: 0,
        withVendor: 50,
        withSku: 12,
        withImage: 44,
      }),
    },
  });

  it("prints no raw identifier in the Google table (2)", () => {
    for (const [name, value] of STORES) {
      const paper = text(renderPrint(printFrom(value)));
      // "measured" is left out on purpose: it is also an ordinary English word,
      // and the report's own method line says a figure "was measured over" a
      // denominator. The three that are only identifiers are the test.
      for (const raw of ["byConstruction", "notPublished", "fromBusiness"]) {
        expect(paper.includes(raw), `${name}: the report prints "${raw}"`).toBe(false);
      }
    }
  });

  it("explains the two scopes inside every group that has rows (4)", () => {
    for (const [name, value] of STORES) {
      const paper = text(renderPrint(printFrom(value)));
      const withRows = value.readiness.groups.filter((g) => g.rows.length > 0);
      for (const group of withRows) {
        expect(group.scope, `${name}: ${group.group} has no scope sentence`).not.toBe("");
        expect(paper, `${name}: ${group.group}`).toContain(group.scope);
      }
    }
  });

  it("gives the clean count one denominator, not two (5)", () => {
    for (const [name, value] of STORES) {
      const clean = value.readiness.groups.find((g) => g.group === "clean")!;
      expect(clean.denominator, name).toBe(value.readiness.products);
      const derived = dashboardDerived(printFrom(value));
      const kpi = keyFigures(printFrom(value), derived).find((f) => f.key === "clean");
      if (kpi) {
        expect(kpi.of, name).toBe(`of ${clean.denominator} in your catalogue`);
        expect(kpi.value, name).toBe(String(clean.count));
      }
    }
  });

  it("states the true shape of each shop-wide fix (6)", () => {
    const derived = dashboardDerived(printFrom(shopWideValue));
    expect(derived.wide.length).toBeGreaterThan(0);
    const perProduct = derived.wide.filter((w) => w.key === "A1");
    expect(perProduct.length).toBe(1);
    // A1 is one field per product. It must not be sold as a setting.
    expect(perProduct[0].appliesTo).toContain("one field per product");
    expect(perProduct[0].appliesTo).not.toContain("One setting");
    // B25 is a theme change and genuinely is made once.
    const theme = derived.wide.find((w) => w.key === "B25");
    expect(theme?.appliesTo).toContain("One change to the theme");
  });

  it("names which of the four identifiers is actually absent (7)", () => {
    const derived = dashboardDerived(printFrom(shopWideValue));
    const a1 = derived.wide.find((w) => w.key === "A1")!;
    // The row may not read as a claim about all four.
    expect(a1.title).toContain("at least one of");
    // Brand is on every product, so the row says so rather than leaving the
    // Google table two pages later to contradict it.
    expect(a1.why).toContain("Already on every product: a brand");
    expect(a1.why).toContain("a barcode, on 50 of 50");
    expect(a1.why).toContain("a product code, on 38 of 50");
    expect(text(renderPrint(printFrom(shopWideValue)))).toContain("Already on every product");
  });

  it("says so when a row is counted against a different total (8)", () => {
    const value = data(fourPagesUnread());
    const b5 = value.findings.rows.find((r) => r.code === "B5")!;
    expect(b5.state).toBe("found");
    expect(b5.denominator).toBe(50);
    expect(value.findings.pagesRead).toBe(46);
    const paper = text(renderPrint(printFrom(value)));
    expect(paper).toContain("is counted out of 50, not 46");
  });

  it("reads as English (9)", () => {
    const paper = text(renderPrint(printFrom(STORES[1][1])));
    expect(paper).toContain("What to do, and who does it");
    expect(paper).not.toContain("by who does it");
    expect(paper).toContain("How strongly Google asks for it");
    expect(paper).not.toContain("Whose it is");
  });
});
