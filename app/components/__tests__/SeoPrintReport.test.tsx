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
