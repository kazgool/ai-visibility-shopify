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

/**
 * The detail a finding needs to reach a merchant surface (addendum item 9):
 * B1 and B22 are shown only when this app's own output is involved, so a
 * fixture that uses them as ordinary findings carries that detail.
 */
const VISIBLE_DETAIL: Record<string, Record<string, unknown>> = {
  B1: { emitters: ["theme", "app"], productNodes: 2 },
  B22: { ours: true },
};

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
      detail: VISIBLE_DETAIL[code] ?? {},
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
//
// Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the
// stores carried hidden codes, which now render nothing. Each is replaced by a
// visible code with the same basis and owner: B17 by B10 (page, merchant), B2
// and B25 by B1 (page, theme), B12 by B33 (page, theme). The counts are
// unchanged.

function fiftyProducts(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 50; i += 1) {
    const codes: string[] = [];
    if (i < 12) codes.push("B10");
    if (i < 8) codes.push("A5");
    if (i >= 12 && i < 20) codes.push("B1");
    if (i >= 20 && i < 24) codes.push("B15");
    rows.push(row(i, codes));
  }
  return rows;
}

function oneEightyNine(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 189; i += 1) {
    const codes: string[] = ["B33"];
    if (i < 38) codes.push("B10");
    if (i < 23) codes.push("A5");
    if (i >= 100 && i < 114) codes.push("B1");
    if (i >= 150 && i < 161) codes.push("B15");
    rows.push(row(i, codes));
  }
  return rows;
}

function twentyThousand(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 20000; i += 1) {
    if (i < 500) rows.push(row(i, i < 120 ? ["B10"] : []));
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

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the fixture's merchant page code is B10 (replacing hidden B17), so B10 is the code asserted absent from the text.
  it("names the groups in the merchant's words and never a check code", () => {
    expect(text).toContain("Nothing to fix");
    expect(text).toContain("You can fix these yourself, no developer");
    expect(text).toContain("These need a change to your theme");
    expect(text).toContain("We can fix these, once you have read them");
    expect(text).not.toMatch(/\bB10\b/);
    expect(text).not.toMatch(/\bA5\b/);
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the 12-product row is B10, which replaced the hidden B17, so its label is the one on the screen.
  it("carries a denominator beside every count it states", () => {
    expect(text).toContain("Titles that are missing, or get cut off in a search result on a phone");
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

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the problem on every product is B33, which replaced the hidden B12, so its shop-wide sentence is the one on the card.
  it("moves the problem that flags every product into the shop-wide card", () => {
    expect(text).toContain("fixes that cover the whole shop");
    // A sentence, not a bar label with a count glued on the end.
    expect(text).toContain("Your theme's product description blocks ours, on every product page");
    expect(text).not.toMatch(/, on all \d+/);
    expect(text).toContain("100 percent");
  });

  it("lists the two shop-wide facts that no product row carries", () => {
    expect(text).toContain("Your delivery time and return window are blank");
    expect(text).toContain("No product in your catalogue carries a barcode");
    // The scope of each row is its own, and two of the three are the whole
    // catalogue rather than the products whose page was read.
    expect(text).toContain("it applies to all 189 products in your catalogue");
    expect(text).toContain("Not one of your 189 products carries one");
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

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the one check among the three rows is B33, which replaced the hidden B12 in the fixture.
  it("counts the rows the shop-wide card renders, not the checks behind some of them", () => {
    // The card lists three: two facts about the shop and one check. A method
    // line saying "2" beside a card showing 3 is two true numbers
    // contradicting each other on one screen.
    expect(text).toContain("The shop-wide card below carries 3 fixes");
    expect(text).toContain("The shop-wide card above carries 3 fixes");
    expect(text).toContain("1 of them from a check that flagged all 189 products");
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the merchant and theme rows are B10 and B1, which replaced the hidden B17 and B25, so their labels carry the group words.
  it("names the group of every row in words and not only in colour", () => {
    // One row per group, each carrying its owner as a word.
    expect(text).toContain("Titles that are missing, or get cut off in a search result on a phone You");
    expect(text).toContain("Pages that describe no product to search engines, or describe two Your theme");
    expect(text).toContain("Photos with no description of what is in them Us");
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the columns account only for the 13 codes a merchant can see, 4 on the admin side (A3, A5, A6, B6) and 9 on the page side.
  it("accounts for every check in the vocabulary, on both sides", () => {
    // Since addendum item 9 only the checks a merchant can see are counted:
    // A3, A5, A6 and B6 on the admin side (B6 is computed in source A's pass),
    // and B1, B4, B7, B10, B11, B15, B22, B33 and B34 on the page side.
    expect(text).toContain("That is all 4 checks on this side");
    expect(text).toContain("That is all 9 checks on this side");
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
    // With a thousands separator, on every merchant surface (R2-27).
    expect(text).toContain("500 of 20,000 products fully checked");
    expect(text).toContain("19,500 of 20,000 products have been read from your catalogue");
    // The headline is drawn against the catalogue, so it cannot read as
    // complete while 19,500 products have never been examined.
    expect(text).toContain("of 20,000 products");
    expect(text).toContain("Not checked yet 19,500 of 20,000");
    expect(text).not.toContain("380 of 380");
    expect(text).not.toContain("20000");
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the 120 read products with a gap carry B10, which replaced the hidden B17 in the fixture, so 380 of the 500 read are clean again.
  it("never claims a product nobody read is clean", () => {
    const readiness = readinessOf(rows);
    expect(readiness.clean).toBe(380);
    expect(readiness.awaitingPage).toBe(19500);
  });
});

describe("an empty store", () => {
  const text = render(data([]));

  it("says there is nothing to read rather than printing zeros", () => {
    // In the merchant's words: no "this table" on a screen with no table and
    // no button named from another screen (R2-20).
    expect(text).toContain("No product has been read from your catalogue yet");
    expect(text).not.toContain("this table");
    expect(text).not.toContain("Fill catalogue");
    expect(text).toContain("No product has been fully checked yet");
    expect(text).not.toContain("0 of 0");
  });

  it("says the products have not been read instead of drawing ten empty bars", () => {
    expect(text).toContain("Your products have not been read yet");
  });

  it("says it once, and not once per row", () => {
    const said = text.split("Your products have not been read yet").length - 1;
    expect(said).toBe(2); // the card's own sentence, and the method line under it
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
  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B29 and B32 are hidden, so their averages are no longer drawn; the card renders B34, the only visible counted check, as its count of pages with the pages beside it.
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
          { code: "B34", source: "B", detail: {} },
        ],
      },
      row(2, []),
    ];
    const text = render(data(rows));
    expect(text).toContain("Counted, with no verdict");
    expect(text).toContain("Visible on the page: 1 of 2 eligible products");
    expect(text).not.toContain("average over");
    expect(text).toContain("nobody credible states a target");
    // And it never turns into a finding: the product carrying them is clean.
    expect(readinessOf(rows).clean).toBe(2);
  });
});

describe("the layout the admin iframe has room for", () => {
  // Built for Shopify 4.1.2 fails a screen whose columns do not stack and a
  // section that is collapsed with no way to expand it. Neither can be proved
  // without a browser, so what is proved here is the mechanical half: nothing
  // on the screen declares a width that cannot shrink, so nothing can push the
  // page wider than the frame it is in. The iframe is roughly 250 to 300 px
  // narrower than the browser window, which is why the two-column breakpoints
  // in this screen are lg and not md.
  const stores: [string, SeoDashboardData][] = [
    ["50 products", data(fiftyProducts())],
    ["189 products", data(oneEightyNine(), { business: { deliveryStated: false, returnsStated: false } })],
    ["20,000 products", data(twentyThousand())],
    ["empty", data([])],
    ["page read never ran", data(pageReadNeverRan())],
  ];

  for (const [name, value] of stores) {
    it(`declares no unshrinkable width on ${name}`, () => {
      const html = renderToStaticMarkup(
        <AppProvider i18n={{}}>
          <SeoDashboardScreen data={value} />
        </AppProvider>,
      );
      // The hero dial's max-width is the one documented fixed measurement.
      const widths = [...html.matchAll(/(?<!max-)width:\s*(\d+)px/g)].map((m) => Number(m[1]));
      const tooWide = widths.filter((w) => w > 250);
      expect(tooWide, `fixed widths over 250px: ${tooWide.join(", ")}`).toEqual([]);
      const minWidths = [...html.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
      expect(minWidths.filter((w) => w > 220)).toEqual([]);
      expect(html).not.toContain("white-space:nowrap");
      // Polaris's own cards set overflow-x:clip, which is the opposite
      // problem. What must not appear is a box that scrolls sideways.
      expect(html).not.toContain("overflow-x:scroll");
      expect(html).not.toContain("overflow-x:auto");
    });
  }

  it("keeps every collapsed group openable without a script, with its steps in the markup", () => {
    // A native <details>/<summary>: the summary is a focusable, keyboard
    // operable control the browser provides, and the steps are in the server
    // markup whether or not hydration ever runs (R1 2.5, R2-26). Polaris
    // Collapsible rendered no children when closed.
    const html = renderToStaticMarkup(
      <AppProvider i18n={{}}>
        <SeoDashboardScreen data={data(fiftyProducts())} />
      </AppProvider>,
    );
    const readiness = readinessOf(fiftyProducts());
    const withSteps = readiness.groups.filter((g) => g.rows.length > 0);
    expect((html.match(/<details/g) ?? []).length).toBe(withSteps.length);
    expect((html.match(/<summary/g) ?? []).length).toBe(withSteps.length);
    expect(html).not.toContain("<details open");
    expect(html).toContain("What to do");
    for (const step of withSteps.flatMap((g) => g.rows)) {
      expect(html).toContain(step.where);
    }
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B5 is hidden and was the only row with its own denominator, so the screen now carries no scope line at all; B17 in the fixture is B10.
  it("carries the B5 scope line on the screen, not only on paper (R2-17)", () => {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 46; i += 1) rows.push(row(i, i < 20 ? ["B10"] : []));
    for (let i = 46; i < 50; i += 1) rows.push(row(i, ["B5"], { status: "error" }));
    const text = render(data(rows));
    expect(text).not.toContain("is counted out of");
    // And one sentence about those four pages, not three (R2-16).
    expect(text).toContain("46 of 50 pages read; 4 more could not be read");
    expect(text).toContain("the same 4 the line above counts as could not be read");
    expect(text).not.toContain("did not answer the way a search engine would see them");
    expect(text).not.toContain("has not been opened yet");
  });

  it("points the then-and-now button at the merchant's file, and the caption is true of all five", () => {
    const html = renderToStaticMarkup(
      <AppProvider i18n={{}}>
        <SeoDashboardScreen
          data={data(oneEightyNine(), { since: { before: facts(), today: facts({ takenAt: DAY }) } })}
        />
      </AppProvider>,
    );
    expect(html).toContain("/app/seo/dashboard/export/since");
    expect(html).not.toContain("/app/seo/export/since");
    expect(html).toContain("with the shop and the date in its name");
  });

  it("names the shop's own settings, and where to look, when a crawler is turned away (R2-19)", () => {
    const text = render(data(pageReadNeverRan(), { blockedBy: "GPTBot" }));
    expect(text).toContain("Your shop's own settings turn GPTBot away");
    expect(text).toContain("Online Store, Themes");
    expect(text).not.toMatch(/\brobots\b/i);
    expect(text).not.toMatch(/\bliquid\b/i);
  });
});
