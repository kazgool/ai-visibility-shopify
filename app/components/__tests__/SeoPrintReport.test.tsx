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
import { FINDING_OWNER, OWNER_LABEL } from "../../services/seo-findings";
import { MERCHANT_REASON } from "../../services/seo-readiness";
import { dashboardDerived, keyFigures } from "../../services/seo-report";
import { aggregateFindings, themeNodeAggregate, type ScanRowLike } from "../../services/seo-aggregate";
import type { CollectionSeoQueue } from "../../services/seo-collections.server";
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
    blockedBy: value.blockedBy,
    since: value.since,
    business: value.business,
    published: value.published,
    producedAt: PRODUCED,
  };
}

/**
 * A token with digit boundaries on both sides, so "5" cannot pass on "50 of
 * 50" and "500 of 20" cannot pass on "500 of 20,000". A comma is a boundary
 * only when a digit follows it, so "of 50, so" still matches.
 */
function bounded(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\d|\\d,)${escaped}(?!\\d|,\\d)`);
}

/** The text between two headings, so a figure is asserted in its own region and not anywhere on the page. */
function between(markup: string, from: string, to: string | null): string {
  const start = markup.indexOf(from);
  expect(start, `region "${from}" missing`).toBeGreaterThanOrEqual(0);
  const end = to === null ? -1 : markup.indexOf(to, start + from.length);
  return end === -1 ? markup.slice(start) : markup.slice(start, end);
}

/**
 * Where each figure lives on each surface. The strip tiles are asserted
 * inside the strip and the group counts inside the groups: a mutated tile
 * printing "5" was passed by the group heading two sections down carrying
 * the true "26 of 50", which is the same figure from the same object and not
 * the tile at all.
 */
function region(surface: "screen" | "paper", markup: string, key: string): string {
  const strip = key !== "listing" && !key.startsWith("group-");
  if (surface === "paper") {
    if (strip) return between(markup, "Where this shop stands today", "What to do, and who does it");
    if (key.startsWith("group-")) return between(markup, "What to do, and who does it", "What Google asks for on a product listing");
    return between(markup, "What Google asks for on a product listing", "Every check, and what it found");
  }
  if (strip) return between(markup, "Where this shop stands today", "How ready your shop is");
  if (key.startsWith("group-")) return between(markup, "How ready your shop is", "ixes that cover the whole shop");
  return between(markup, "Ready for Google's free product listings", "What search engines and AI read");
}

// ---------------------------------------------------------------------------

describe("the report and the screen cannot show different figures", () => {
  for (const [name, value] of STORES) {
    it(`prints the same headline figures on ${name}`, () => {
      const screen = renderScreen(value);
      const paper = text(renderPrint(printFrom(value)));
      const figures = keyFigures(printFrom(value), dashboardDerived(printFrom(value)));

      // An empty store and a store with no page read carry no figure at all;
      // both surfaces print a sentence instead, asserted below.
      if (value.readiness.readSet > 0) expect(figures.length).toBeGreaterThan(0);
      for (const figure of figures) {
        // The figure the report prints is the figure the screen prints. Not a
        // recomputation that happens to agree today: the same string, from the
        // same call, asserted present in both renders - as the exact "N of M"
        // token with word boundaries, on both, because a bare `toContain` of
        // the value let "5" pass on any page containing "50" (R1 4.3, R2-15).
        expect(
          region("paper", paper, figure.key),
          `${name}: ${figure.key} "${figure.token}" missing from its region of the report`,
        ).toMatch(bounded(figure.token));
        expect(
          region("screen", screen, figure.key),
          `${name}: ${figure.key} "${figure.token}" missing from its region of the screen`,
        ).toMatch(bounded(figure.token));
      }
    });

    it(`gives every group its own count and denominator on ${name}, or one sentence`, () => {
      const paper = text(renderPrint(printFrom(value)));
      const screen = renderScreen(value);
      if (value.readiness.readSet === 0) {
        // No tiles of "0 of 0" and no empty groups: the same sentence as the
        // screen (R2-09, R2-10).
        expect(paper).toContain("No product has been fully checked yet, so there is nothing to group");
        expect(screen).toContain("No product has been fully checked yet, so there is nothing to group");
        expect(paper).not.toMatch(/\b0 of 0\b/);
        expect(paper).not.toContain("Nothing to fix -");
        return;
      }
      for (const group of value.readiness.groups) {
        expect(paper, `${name}: ${group.group}`).toMatch(
          bounded(`${group.title} - ${group.count.toLocaleString("en-US")} of ${group.denominator.toLocaleString("en-US")}`),
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

  it("asks the printer to break between table rows, never through one, and never after a heading", () => {
    // Row level, not card level (5 September 2026): a card may split between
    // rows, a row and a heading never split, and a heading is never the last
    // thing on a page.
    expect(paper).toContain(".avp tr { break-inside: avoid; page-break-inside: avoid; }");
    expect(paper).toContain(".avp thead { display: table-header-group; }");
    expect(paper).toMatch(/\.avp h1, \.avp h2, \.avp h3 \{ break-after: avoid; page-break-after: avoid;/);
    expect(paper).toMatch(/\.avp section \{[^}]*break-inside: auto;/);
    expect(paper).toContain("@page");
    // The screen-level rule no longer asks for the whole card to be kept
    // together, which is what left the pages half empty.
    expect(paper).not.toMatch(/\.avp section \{[^}]*break-inside: avoid/);
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
    // In the merchant's words: the recorded reason is the operator's sentence
    // and is translated, never printed raw (R1 2.3).
    const paper = text(renderPrint(printFrom(value)));
    expect(paper).toContain(MERCHANT_REASON["The app embed is not active in the theme."]);
    expect(paper).not.toContain("The app embed is not active in the theme.");
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
  { name: "metafield", pattern: /\bmetafields?\b/i },
  { name: "snapshot", pattern: /\bsnapshots?\b/i },
  { name: "operator", pattern: /\boperators?\b/i },
  { name: "setup code", pattern: /\bsetup code\b/i },
  { name: "robots.txt", pattern: /\brobots\b/i },
  { name: "liquid", pattern: /\bliquid\b/i },
  { name: "Fill catalogue", pattern: /\bfill catalogue\b/i },
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

/** 46 pages that answered and 4 that did not, so B5's denominator is 50. */
function fourPagesUnread(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 46; i += 1) rows.push(row(i, i < 20 ? ["B17"] : []));
  for (let i = 46; i < 50; i += 1) rows.push(row(i, ["B5"], { status: "error" }));
  return rows;
}

function collectionsQueue(): CollectionSeoQueue {
  return {
    checked: 12,
    withFinding: 5,
    missingTitle: 3,
    missingDescription: 4,
    outsideApp: 0,
    editedByYou: 0,
    writtenByApp: 0,
    rows: [],
    protectedRows: [],
    findings: [],
    thinDescription: [],
    thinMembership: [],
  };
}

/**
 * The twelve stores QA round 2 rendered: the five fixtures, the every-code
 * store, and the six forced paths - four pages that did not answer, B6 on
 * every page with no recorded reason, a store whose settings turn a crawler
 * away, a one-product store with a formula for a handle, a store with
 * collections and blog posts and both snapshots, and a mixed-case domain.
 */
const TWELVE: [string, Extract<SeoDashboardData, { unlocked: true }>][] = [
  ...STORES,
  [
    "every code at once",
    data(everyCode(), {
      business: { deliveryStated: false, returnsStated: false },
      since: { before: facts(), today: facts({ takenAt: DAY, takenBy: "current" }) },
      published: {
        at: DAY,
        reasons: [
          { nodeType: "Product", emitted: false, reason: "The app embed is not active in the theme." },
        ],
      },
    }),
  ],
  [
    "four pages that did not answer",
    data(fourPagesUnread(), {
      since: { before: null, today: facts({ takenAt: DAY, takenBy: "current", products: 50 }) },
    }),
  ],
  [
    "B6 on every page, no reason recorded",
    data(
      (() => {
        const rows: ScanRowLike[] = [];
        for (let i = 0; i < 12; i += 1) rows.push(row(i, ["B6"]));
        return rows;
      })(),
    ),
  ],
  ["a crawler turned away", data(pageReadNeverRan(), { blockedBy: "GPTBot" })],
  [
    "one product",
    data([{ ...row(1, ["A15", "B25"]), handle: "=cmd|' /C calc'!A0" }], {
      since: { before: null, today: facts({ takenAt: DAY, takenBy: "current", products: 1, withVendor: 1, withSku: 1, withImage: 1 }) },
    }),
  ],
  [
    "collections, blog posts and both snapshots",
    data(fiftyProducts(), {
      collections: collectionsQueue(),
      blogPosts: { read: 9, withoutLinks: 2 },
      business: { deliveryStated: true, returnsStated: true },
      since: {
        before: facts({ products: 50, findingsByCode: { B17: 12 } }),
        today: facts({
          takenAt: DAY,
          takenBy: "current",
          products: 50,
          metaTitleOurs: 7,
          findingsByCode: { B17: 12 },
          writtenSinceAt: "2026-08-15T08:00:00.000Z",
          writtenSince: { seo_title: { count: 7, earliest: DAY, latest: DAY } },
        }),
      },
    }),
  ],
  ["a mixed-case domain", data(oneEightyNine(), { domain: "Republica-BIO.myshopify.com" })],
];

describe("the vocabulary rule, asserted on what is rendered", () => {
  for (const [name, value] of TWELVE) {
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

  it("reads the group steps on the screen, because they are in the server markup", () => {
    // <details>/<summary>, not Collapsible: the steps are on the page with
    // no script, so this guard can actually see them (R2-14, R2-26).
    const value = TWELVE[5][1];
    const html = renderToStaticMarkup(
      <AppProvider i18n={{}}>
        <SeoDashboardScreen data={value} />
      </AppProvider>,
    );
    const screen = text(html);
    const steps = value.readiness.groups.flatMap((g) => g.rows);
    expect(steps.length).toBeGreaterThan(30);
    for (const step of steps) {
      expect(screen, step.code).toContain(step.what);
      expect(screen, step.code).toContain(`${step.label}: ${step.count} of ${step.denominator}.`);
    }
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).not.toContain("aria-expanded");
    // Proper nouns keep their case (R2-21).
    expect(screen).not.toContain("for google");
    expect(screen).not.toContain("on x,");
  });
});

// ---------------------------------------------------------------------------
// Sentences that point at another element point only at one that is there
// (root cause A, 5 September 2026).

/**
 * Each referent phrase, and the test that its referent is on the same
 * surface in the same state. A phrase not listed here is not allowed to
 * point at all; the last two patterns catch any pointer this list does not
 * know.
 */
const REFERENTS: { phrase: RegExp; present: (markup: string, value: Extract<SeoDashboardData, { unlocked: true }>) => boolean; name: string }[] = [
  {
    name: "the shop-wide card",
    phrase: /\bshop-wide card (above|below)\b/,
    present: (m) => /\bfix(es)? that covers? the whole shop\b/i.test(m),
  },
  {
    name: "the groups",
    phrase: /\b(in|of) the (four )?groups (above|below)\b/,
    present: (m) => m.includes("Nothing to fix") && m.includes("You can fix these yourself"),
  },
  {
    name: "the four groups",
    phrase: /\bcounted in none of the four groups (above|below)\b/,
    present: (m) => m.includes("Nothing to fix") && m.includes("You can fix these yourself"),
  },
  {
    name: "the counted card",
    phrase: /\bfoot of this (screen|report)\b/,
    present: (m) => m.includes("Counted, with no verdict"),
  },
  {
    name: "the collections total",
    phrase: /count your collections rather than your products, so (it carries its|they carry their) own total above/,
    present: (m) => !m.includes("Your collections have not been checked yet"),
  },
  {
    name: "the blog posts total",
    phrase: /count your blog posts rather than your product pages, so (it carries its|they carry their) own total above/,
    present: (m) => !m.includes("Your blog posts have not been checked yet"),
  },
  {
    name: "the Google tile",
    phrase: /\bcounted in the \d+ of \d+ above\b/,
    present: (m) => m.includes("details Google asks for, in place"),
  },
  {
    name: "the dial",
    phrase: /\bThe dial is drawn\b/,
    present: (m) => m.includes("Each product is counted once, under whoever has to move first."),
  },
  {
    name: "the read line",
    phrase: /\bthe line above counts as could not be read\b/,
    present: (m) => /\bcould not be read\b.*\bthe line above\b/.test(m),
  },
  {
    name: "the found bars",
    phrase: /\b\d+ shown above\b/,
    present: (m, value) => {
      const wide = new Set(value.readiness.shopWideCodes);
      return value.findings.rows
        .filter((r) => r.state === "found" && !wide.has(r.code))
        .every((r) => m.includes(OWNER_LABEL[r.code]));
    },
  },
  {
    name: "this card",
    phrase: /\bthis card\b/i,
    // Only the screen has cards; on paper the sentence says "this report".
    present: (m) => m.includes("How ready your shop is") || m.includes("Take this away"),
  },
];

/** Any "above" or "below" not covered by a listed referent is a pointer nobody checked. */
const KNOWN_POINTERS = [
  /\bshop-wide card (above|below)\b/g,
  /\b(in|of) the (four )?groups (above|below)\b/g,
  /own total above\b/g,
  /\bcounted in the \d+ of \d+ above\b/g,
  /\bthe line above\b/g,
  /\b\d+ shown above\b/g,
  /\bshop-wide one (above|below)\b/g,
  // Inside a group: the group's own count is in the same panel as the sentence.
  /\bThe [\d,]+ above is products\b/g,
  /\bcounted once above\b/g,
  /\beach line above names the change\b/g,
  // The report's first line: everything is below it.
  /\bEvery figure below carries the denominator\b/g,
  // The read warning on the screen: the four groups are below it.
  /\bcounted in none of the four groups (above|below)\b/g,
];

describe("every pointer on a surface points at something rendered on it", () => {
  for (const [name, value] of TWELVE) {
    for (const [surface, render] of [
      ["screen", () => renderScreen(value)],
      ["paper", () => text(renderPrint(printFrom(value)))],
    ] as const) {
      it(`on the ${surface}, ${name}`, () => {
        const markup = render();
        for (const referent of REFERENTS) {
          if (!referent.phrase.test(markup)) continue;
          expect(
            referent.present(markup, value),
            `${surface}, ${name}: says "${markup.match(referent.phrase)?.[0]}" and ${referent.name} is not there`,
          ).toBe(true);
        }
        // Paper has no screen and no card.
        if (surface === "paper") {
          expect(markup).not.toMatch(/\bthis (screen|card)\b/i);
        }
        // Every remaining "above" or "below" is unaccounted for.
        let rest = markup;
        for (const known of KNOWN_POINTERS) rest = rest.replace(known, " ");
        const stray = rest.match(/[^.]*\b(above|below)\b[^.]*/);
        expect(stray, `${surface}, ${name}: unlisted pointer: "${stray?.[0]}"`).toBeNull();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// The defects read off the printed page, 5 September 2026. Each of these fails
// if the thing that was on paper comes back.

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
        expect(kpi.of, name).toBe(`of ${clean.denominator.toLocaleString("en-US")} in your catalogue`);
        expect(kpi.value, name).toBe(clean.count.toLocaleString("en-US"));
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
    // And on the screen, which the CHANGELOG had claimed and the screen had
    // not (R2-17).
    expect(renderScreen(value)).toContain("is counted out of 50, not 46");
  });

  it("states the unchecked products as a number on paper, with the reason (R2-11, M2)", () => {
    const paper = text(renderPrint(printFrom(STORES[2][1])));
    expect(paper).toContain("19,500");
    expect(paper).toContain("products not checked yet");
    expect(paper).toContain("of 20,000 in your catalogue");
    expect(paper).toContain("19,500 of 20,000 products have been read from your catalogue but their live page has not been opened yet");
    const b5 = text(renderPrint(printFrom(data(fourPagesUnread()))));
    expect(b5).toMatch(bounded("4 of 50"));
    expect(b5).toContain("products not checked yet");
    expect(b5).toContain("4 of 50 products have been read from your catalogue, and their page was opened but could not be read");
  });

  it("carries the since card's unchanged line and written block on paper (R2-29)", () => {
    const value = TWELVE[10][1];
    const paper = text(renderPrint(printFrom(value)));
    const screen = renderScreen(value);
    expect(paper).toContain("figures are unchanged.");
    expect(paper).toContain("Written by this app since then");
    expect(paper).toContain("Titles for Google 7");
    expect(screen).toContain("figures are unchanged.");
    // The same count on both.
    const line = screen.match(/\d+ figures are unchanged\./)![0];
    expect(paper).toContain(line);
  });

  it("names the cause on paper when the shop's own settings turn a crawler away (R2-19)", () => {
    const paper = text(renderPrint(printFrom(TWELVE[8][1])));
    expect(paper).toContain("Your shop's own settings turn GPTBot away");
    expect(paper).not.toMatch(/\brobots\b/i);
  });

  it("tells the two shared-link checks apart by where the preview is missing (M3)", () => {
    expect(OWNER_LABEL.B13).toContain("WhatsApp, Facebook and most apps");
    expect(OWNER_LABEL.B14).toContain("X, formerly Twitter");
  });

  it("reads as English (9)", () => {
    const paper = text(renderPrint(printFrom(STORES[1][1])));
    expect(paper).toContain("What to do, and who does it");
    expect(paper).not.toContain("by who does it");
    expect(paper).toContain("How strongly Google asks for it");
    expect(paper).not.toContain("Whose it is");
  });
});
