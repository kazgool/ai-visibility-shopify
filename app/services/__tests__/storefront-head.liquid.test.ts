import { describe, expect, it } from "vitest";
import { blockDefaults, ldObjects, ourNodes, renderBlock, SHOP_URL, storefront } from "./liquid-harness";

// ai-visibility.liquid, the head embed, rendered whole through liquidjs.
// Each test counts the nodes a page gets from us and reads the @id used.

const FILE = "ai-visibility.liquid";
const settings = { ...blockDefaults(FILE) };
const DATA = {
  summary: "A solid oak chair for small kitchens.",
  facts: [
    { k: "Material", v: "Oak" },
    { k: "Width", v: "45 cm" },
  ],
  fitFor: "small kitchens",
};
const THEME_ID = `${SHOP_URL}/products/oak-chair#theme-product`;
const OUR_ID = `${SHOP_URL}/products/oak-chair#product`;

describe("extend mode: which Product node the page gets (PRD-AI-READABILITY P0.5)", () => {
  it("defaults to extend mode", () => {
    expect(settings.mode).toBe("extend");
  });

  // Until item 10 of the same batch this case emitted a fragment under the
  // theme's @id carrying summary, audience and facts. Those are visible text
  // in the body now, and the head marks up nothing it cannot see is shown, so
  // the fragment is gone and the theme's node stands alone.
  it("theme node with @id: no Product node from us, the theme's stands alone", async () => {
    const html = await renderBlock(
      FILE,
      storefront({ settings, data: DATA, themeScan: { productId: THEME_ID, hasProductLd: true } }),
    );
    expect(ourNodes(html, "Product")).toHaveLength(0);
    expect(html).not.toContain(THEME_ID);
  });

  it("theme node without @id: no Product node from us at all (B33)", async () => {
    const html = await renderBlock(
      FILE,
      storefront({ settings, data: DATA, themeScan: { productId: "", hasProductLd: true } }),
    );
    expect(ourNodes(html, "Product")).toHaveLength(0);
  });

  it("no theme node: the complete node, under our own @id, as full mode emits it", async () => {
    const html = await renderBlock(
      FILE,
      storefront({ settings, data: DATA, themeScan: { productId: "", hasProductLd: false } }),
    );
    const nodes = ourNodes(html, "Product");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]["@id"]).toBe(OUR_ID);
    expect(nodes[0].name).toBe("Oak chair");
    expect(nodes[0].offers).toMatchObject({ "@type": "Offer", price: 129, priceCurrency: "RON" });

    const full = await renderBlock(
      FILE,
      storefront({ settings: { ...settings, mode: "full" }, data: DATA, themeScan: { productId: "", hasProductLd: false } }),
    );
    expect(ourNodes(full, "Product")).toEqual(nodes);
  });

  it("no theme node and nothing extracted: still the complete node, because the page would have none", async () => {
    const html = await renderBlock(
      FILE,
      storefront({ settings, data: {}, themeScan: { productId: "", hasProductLd: false } }),
    );
    expect(ourNodes(html, "Product")).toHaveLength(1);
  });

  it("a scan written before the flag existed holds back, never guesses the complete node", async () => {
    const legacy = await renderBlock(
      FILE,
      storefront({ settings, data: DATA, themeScan: { productId: "", hasOrganizationLd: false } }),
    );
    expect(ourNodes(legacy, "Product")).toHaveLength(0);
    const never = await renderBlock(FILE, storefront({ settings, data: DATA, themeScan: null }));
    expect(ourNodes(never, "Product")).toHaveLength(0);
  });

  it("every case renders JSON that parses", async () => {
    for (const themeScan of [
      { productId: THEME_ID, hasProductLd: true },
      { productId: "", hasProductLd: true },
      { productId: "", hasProductLd: false },
    ]) {
      const html = await renderBlock(FILE, storefront({ settings, data: DATA, themeScan }));
      expect(() => ldObjects(html)).not.toThrow();
    }
  });
});

describe("one WebSite node on the home page (PRD-AI-READABILITY P0.4)", () => {
  const home = (themeScan: Record<string, unknown> | null) =>
    renderBlock(FILE, storefront({ template: "index", settings, themeScan, seoUnlocked: true }));

  it("emits ours, marked, when the theme has no WebSite node", async () => {
    const nodes = ourNodes(await home({ hasWebSiteLd: false }), "WebSite");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].url).toBe(SHOP_URL);
  });

  it("emits none when the theme has its own", async () => {
    const html = await home({ hasWebSiteLd: true });
    expect(ldObjects(html).filter((n) => n["@type"] === "WebSite")).toHaveLength(0);
  });

  it("holds back on a scan written before the flag existed", async () => {
    const html = await home({ productId: "", hasOrganizationLd: false });
    expect(ldObjects(html).filter((n) => n["@type"] === "WebSite")).toHaveLength(0);
  });

  it("never emits it on a product page", async () => {
    const html = await renderBlock(
      FILE,
      storefront({ settings, data: DATA, themeScan: { hasWebSiteLd: false }, seoUnlocked: true }),
    );
    expect(ldObjects(html).filter((n) => n["@type"] === "WebSite")).toHaveLength(0);
  });
});

describe("the head marks up only what the page shows (PRD-AI-READABILITY P0.3)", () => {
  const QUESTIONS = [{ q: "Is it solid wood?", a: "Yes." }];
  const WITH_QUESTIONS = { ...DATA, questions: QUESTIONS };

  it("emits no FAQPage on a product page in any mode, whatever the questions", async () => {
    for (const mode of ["extend", "full"]) {
      for (const themeScan of [{ productId: "", hasProductLd: false }, { productId: THEME_ID, hasProductLd: true }]) {
        const html = await renderBlock(
          FILE,
          storefront({ settings: { ...settings, mode }, data: WITH_QUESTIONS, themeScan }),
        );
        expect(ldObjects(html).filter((n) => n["@type"] === "FAQPage")).toHaveLength(0);
      }
    }
  });

  it("the complete node takes the theme's own description, never the summary, and carries no facts", async () => {
    const html = await renderBlock(
      FILE,
      storefront({ settings: { ...settings, mode: "full" }, data: WITH_QUESTIONS, themeScan: null }),
    );
    const [node] = ourNodes(html, "Product");
    expect(node.description).toBe("A solid oak chair &amp; cushion.");
    expect(node.description).not.toContain(DATA.summary);
    expect(node.additionalProperty).toBeUndefined();
    expect(node.audience).toBeUndefined();
    expect(html).not.toContain("45 cm");
  });

  it("on a collection page: a CollectionPage from the collection's own text, no criteria, no FAQPage", async () => {
    const collection = {
      title: "Chairs",
      url: "/collections/chairs",
      description: "<p>All our chairs.</p>",
      products_count: 1,
      products: [{ title: "Oak chair", url: "/products/oak-chair" }],
      metafields: {
        $app: {
          summary: { value: "Twelve chairs in oak and pine." },
          criteria: { value: ["Material", "Width"] },
          questions: { value: QUESTIONS },
        },
      },
    };
    const html = await renderBlock(FILE, storefront({ template: "collection", settings, collection }));
    const [page] = ourNodes(html, "CollectionPage");
    expect(page.description).toBe("All our chairs.");
    expect(page.additionalProperty).toBeUndefined();
    expect(html).not.toContain("Twelve chairs");
    expect(ldObjects(html).filter((n) => n["@type"] === "FAQPage")).toHaveLength(0);
  });

  it("a collection with no description of its own gets a CollectionPage without one, still valid JSON", async () => {
    const collection = {
      title: "Chairs",
      url: "/collections/chairs",
      description: "",
      products_count: 0,
      products: [],
      metafields: { $app: { summary: { value: "Twelve chairs." } } },
    };
    const html = await renderBlock(FILE, storefront({ template: "collection", settings, collection }));
    const [page] = ourNodes(html, "CollectionPage");
    expect(page.description).toBeUndefined();
    expect(page.name).toBe("Chairs");
  });
});

// Batch 5 item 2. Republica BIO, 12 September 2026: 3 of 182 product pages
// carried no Product node at all. The cause was ours - a review app had
// written reviews.rating_count as text, `av_rating_count > 0` raised
// "comparison of String with 0 failed" in Shopify's Liquid, and the error
// comment Shopify printed in place of the tag landed inside this block's own
// JSON-LD script, so the Product node was unparseable and every consumer
// dropped it without a word.
describe("a review app's metafields, whatever type it wrote them as", () => {
  const noTheme = { productId: "", hasProductLd: false };

  it("publishes no rating when the shop has no reviews at all", async () => {
    const html = await renderBlock(FILE, storefront({ settings, data: DATA, themeScan: noTheme }));
    const node = ourNodes(html, "Product")[0];
    expect(node.aggregateRating).toBeUndefined();
  });

  it("still emits a parseable Product node when the count is text, not a number", async () => {
    const html = await renderBlock(
      FILE,
      storefront({
        settings,
        data: DATA,
        themeScan: noTheme,
        reviews: { rating: { value: { value: "4.7" } }, rating_count: { value: "12" } },
      }),
    );
    // The whole point: the node is there and parses. ldObjects would have
    // thrown, or found nothing, on the markup this replaces.
    const node = ourNodes(html, "Product")[0];
    expect(node).toBeDefined();
    expect(node.name).toBe("Oak chair");
    // And the numbers go out as numbers, which is what Google asks for.
    expect(node.aggregateRating).toMatchObject({ ratingValue: 4.7, reviewCount: 12 });
  });

  it("publishes no rating when the count is text that states no number", async () => {
    const html = await renderBlock(
      FILE,
      storefront({
        settings,
        data: DATA,
        themeScan: noTheme,
        reviews: { rating: { value: { value: "4.7" } }, rating_count: { value: "" } },
      }),
    );
    const node = ourNodes(html, "Product")[0];
    expect(node).toBeDefined();
    expect(node.aggregateRating).toBeUndefined();
  });

  it("publishes no rating when there are reviews but no rating value", async () => {
    const html = await renderBlock(
      FILE,
      storefront({ settings, data: DATA, themeScan: noTheme, reviews: { rating_count: { value: 12 } } }),
    );
    expect(ourNodes(html, "Product")[0].aggregateRating).toBeUndefined();
  });

  // Batch 6 item 3. The gap batch 5's coercion left open. A Romanian review
  // app writes the rating with a decimal comma, and `plus: 0` does not refuse
  // it the way it refuses text: Shopify's Liquid reads the digits it
  // understands and stops, so "4,5" became 4. That publishes a WRONG rating
  // instead of none, which is the opposite direction from the one the fix
  // claimed to fail in.
  //
  // The harness is liquidjs, not Ruby Liquid, and on this input the two
  // disagree about the SYMPTOM: liquidjs makes "4,5" NaN and publishes no
  // rating, where Shopify publishes 4. So this test cannot show the wrong
  // rating a shopper would have seen; what it pins is the outcome both
  // engines must reach after the fix, and it fails on both without it
  // (checked by reverting the filter chain: "expected undefined to match
  // object { ratingValue: 4.5 }").
  it("reads a rating written with a decimal comma as the number it states", async () => {
    const html = await renderBlock(
      FILE,
      storefront({
        settings,
        data: DATA,
        themeScan: noTheme,
        reviews: { rating: { value: { value: "4,5" } }, rating_count: { value: "12" } },
      }),
    );
    expect(ourNodes(html, "Product")[0].aggregateRating).toMatchObject({
      ratingValue: 4.5,
      reviewCount: 12,
    });
  });

  // Same item, the symmetry half: the count now reads .value.value before
  // .value, as the rating value always has, because a review app is free to
  // define either metafield as a composite type.
  it("reads a count a review app nested one level deeper", async () => {
    const html = await renderBlock(
      FILE,
      storefront({
        settings,
        data: DATA,
        themeScan: noTheme,
        reviews: { rating: { value: { value: "4.7" } }, rating_count: { value: { value: 12 } } },
      }),
    );
    expect(ourNodes(html, "Product")[0].aggregateRating).toMatchObject({
      ratingValue: 4.7,
      reviewCount: 12,
    });
  });
});
