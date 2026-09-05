import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";

// The card's own sentences, asserted on the markup a merchant reads rather
// than on the functions behind it.
//
// This is the acceptance row the per-product wave declined ("Every count on
// the card is asserted on the rendered string, not only on the aggregate"), and
// the reason it was right is here: seo-since.test.ts can prove that
// `figure(30, 50)` is "30 of 50" and still not prove the card places the
// snapshot's figure in the snapshot's column. Rendering is the only thing that
// does.
//
// No jsdom and no testing-library: `renderToStaticMarkup` needs neither, and
// Polaris renders under it with an `AppProvider` and an empty i18n. The whole
// point of putting this card in its own module was to make that possible - a
// route module cannot be imported in a test at all.

import { SeoSinceCard } from "../SeoSinceCard";
import type { FactsRow } from "../../services/seo-since";

function facts(over: Partial<FactsRow> = {}): FactsRow {
  return {
    takenAt: "2026-09-05T08:00:00.000Z",
    takenBy: "unlock",
    products: 50,
    metaTitleSet: 30,
    metaTitleOurs: 0,
    metaDescriptionSet: 30,
    metaDescriptionOurs: 0,
    withBarcode: 0,
    withVendor: 50,
    withSku: 50,
    withImage: 1,
    productNodeTheme: null,
    productNodeNone: null,
    themeNodeTypes: null,
    findingsByCode: null,
    pagesRead: 0,
    ...over,
  };
}

/** The markup as plain text, with tags removed, so a sentence split across
 *  elements is still one sentence to assert on. */
function render(before: FactsRow | null, today: FactsRow | null): string {
  const html = renderToStaticMarkup(
    <AppProvider i18n={{}}>
      <SeoSinceCard before={before} today={today} />
    </AppProvider>,
  );
  // React escapes an apostrophe in text as a hex numeric entity, which is correct HTML and
  // reaches the reader as "'". Decoding here keeps the assertions written the
  // way the sentence is written in the source.
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

describe("the card with no snapshot", () => {
  const text = render(null, null);

  it("says why there is nothing to compare, and offers no table", () => {
    expect(text).toContain("No before snapshot exists for this shop");
    expect(text).toContain("what the store looks like today but not what changed");
    expect(text).not.toContain("of 50");
  });
});

describe("the card with a snapshot and a catalogue that grew", () => {
  const text = render(
    facts(),
    facts({
      takenAt: "2026-09-20T03:45:00.000Z",
      products: 60,
      metaTitleSet: 45,
      metaTitleOurs: 15,
      // Pages have been read since, so the page rows have a today and the
      // snapshot's side is the only unmeasured half.
      pagesRead: 60,
      productNodeTheme: 58,
      productNodeNone: 2,
    }),
  );

  it("heads the card with the engagement date", () => {
    expect(text).toContain("Since this engagement began, 5 September 2026");
  });

  it("renders both denominators side by side on the row that grew", () => {
    expect(text).toContain("Products with a meta title 30 of 50 45 of 60 +15");
  });

  it("renders the catalogue total with no denominator", () => {
    expect(text).toContain("Products in the catalogue 50 60 +10");
  });

  it("renders a page figure as not read at the time, never as a zero", () => {
    expect(text).toContain(
      "Pages where the theme emits a Product node not read at the time 58 of 60",
    );
    expect(text).toContain("No page had been read at the time");
  });

  it("collapses the unchanged figures into one counted line", () => {
    expect(text).toMatch(/\d+ figures are unchanged\./);
  });

  it("names the date today's column came from", () => {
    expect(text).toContain("Today's catalogue figures are from the catalogue pass of 20 September 2026");
    expect(text).toContain("page figures are refreshed after every nightly page scan");
  });
});

describe("the card for a snapshot taken by hand", () => {
  const text = render(facts({ takenBy: "manual" }), facts({ takenAt: "2026-09-20T03:45:00.000Z" }));

  it("shows the date and never claims the start", () => {
    expect(text).toContain("Since 5 September 2026");
    expect(text).not.toContain("Since this engagement began");
    expect(text).toContain("since-this-date and not a since-the-start");
  });
});

describe("written by this app since then", () => {
  it("renders each key with its count and its span", () => {
    const text = render(
      facts(),
      facts({
        takenAt: "2026-09-20T03:45:00.000Z",
        writtenSinceAt: "2026-09-05T08:00:00.000Z",
        writtenSince: {
          seo_title: {
            count: 20,
            earliest: "2026-09-06T01:00:00Z",
            latest: "2026-09-19T01:00:00Z",
          },
        },
      }),
    );
    expect(text).toContain("Meta titles 20 6 September 2026 to 19 September 2026");
  });

  it("says nothing has been written when the count is real and empty", () => {
    const text = render(
      facts(),
      facts({
        takenAt: "2026-09-20T03:45:00.000Z",
        writtenSinceAt: "2026-09-05T08:00:00.000Z",
        writtenSince: {},
      }),
    );
    expect(text).toContain("Nothing this app writes has been written on this store since then.");
  });

  it("says it is not counted yet when the figures predate the snapshot", () => {
    const text = render(
      facts(),
      facts({
        takenAt: "2026-09-20T03:45:00.000Z",
        writtenSinceAt: "2026-09-01T00:00:00.000Z",
        writtenSince: { seo_title: { count: 9, earliest: null, latest: null } },
      }),
    );
    expect(text).toContain("Not counted yet");
    // And the figure counted against the wrong date is nowhere on the screen.
    expect(text).not.toContain("Meta titles 9");
  });

  it("always states that alt texts and structured data nodes are not counted", () => {
    const text = render(facts(), facts({ takenAt: "2026-09-20T03:45:00.000Z" }));
    expect(text).toContain("Alt texts are counted one per photo");
    expect(text).toContain("Structured data nodes are not counted");
  });
});

describe("the exports", () => {
  it("links both CSVs from the card", () => {
    const html = renderToStaticMarkup(
      <AppProvider i18n={{}}>
        <SeoSinceCard before={facts()} today={null} />
      </AppProvider>,
    );
    expect(html).toContain('href="/app/seo/export/since"');
    expect(html).toContain('href="/app/seo/export/written"');
  });
});
