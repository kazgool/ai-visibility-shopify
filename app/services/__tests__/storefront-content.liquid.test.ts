import { describe, expect, it } from "vitest";
import { blockDefaults, renderBlock, SHOP_URL, storefront } from "./liquid-harness";

// The visible content embed (PRD-AI-READABILITY P0.1), rendered whole through
// liquidjs with the shared snippet. Invented data.

const EMBED = "ai-visibility-content.liquid";
const defaults = blockDefaults(EMBED);

const FULL = {
  summary: "A solid oak chair for small kitchens.",
  facts: [
    { k: "Material", v: "Oak" },
    { k: "Width", v: "45 cm" },
    { k: "Finish", v: "Oiled" },
  ],
  fitFor: "small kitchens",
  questions: [
    { q: "Is it solid wood?", a: "Yes, solid oak." },
    { q: "Does it need assembly?", a: "No." },
  ],
};

const render = (options: Parameters<typeof storefront>[0], file = EMBED) =>
  renderBlock(file, storefront({ settings: defaults, ...options }));

/** The visible text of the output, tags stripped and whitespace collapsed. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the visible product block: what it shows", () => {
  it("ships with every part on, heading 'About this product' at h2, and manual placement off", () => {
    expect(defaults).toMatchObject({
      heading: "About this product",
      heading_level: "h2",
      show_summary: true,
      show_facts: true,
      show_fit: true,
      show_questions: true,
      show_links: true,
      manual_placement: false,
    });
  });

  it("prints the summary and the three label and value pairs as text, in stored order", async () => {
    const html = await render({ data: FULL });
    expect(html).toContain('<section class="ai-visibility-content" style="margin:2rem 0;max-width:72rem;">');
    expect(text(html)).toContain("A solid oak chair for small kitchens.");
    const pairs = [...html.matchAll(/<dt[^>]*>([^<]*)<\/dt>\s*<dd[^>]*>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]);
    expect(pairs).toEqual([
      ["Material", "Oak"],
      ["Width", "45 cm"],
      ["Finish", "Oiled"],
    ]);
  });

  it("prints the parts in the PRD's order: heading, summary, facts, suits, questions, links", async () => {
    const t = text(await render({ data: FULL }));
    const order = [
      "About this product",
      "A solid oak chair",
      "Material",
      "Suits: small kitchens",
      "Is it solid wood?",
      "Plain-text version of this page",
      "All products as plain text",
    ].map((s) => t.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("links the mirror and llms.txt on the shop's own address", async () => {
    const html = await render({ data: FULL });
    expect(html).toContain(`<a href="${SHOP_URL}/apps/ai-visibility/oak-chair">Plain-text version of this page</a>`);
    expect(html).toContain(`<a href="${SHOP_URL}/apps/ai-visibility/llms.txt">All products as plain text</a>`);
  });

  it("puts questions one level below the heading", async () => {
    expect(await render({ data: FULL })).toMatch(/<h2[^>]*>About this product<\/h2>[\s\S]*<h3[^>]*>Is it solid wood\?<\/h3>/);
    const h3 = await render({ data: FULL, settings: { ...defaults, heading_level: "h3" } });
    expect(h3).toMatch(/<h3[^>]*>About this product<\/h3>[\s\S]*<h4[^>]*>Is it solid wood\?<\/h4>/);
  });

  it("drops each part its setting switches off, and keeps the others", async () => {
    const html = await render({ data: FULL, settings: { ...defaults, show_questions: false, show_links: false } });
    expect(text(html)).not.toContain("Is it solid wood?");
    expect(html).not.toContain("/apps/ai-visibility/");
    expect(text(html)).toContain("Material");
  });

  it("escapes every value: markup in the data prints as text", async () => {
    const html = await render({
      data: { summary: "Under <b>30</b> & light", facts: [{ k: "Size <x>", v: "<30 cm & 2\"" }] },
    });
    expect(html).not.toContain("<b>");
    expect(html).toContain("Under &lt;b&gt;30&lt;/b&gt; &amp; light");
    expect(html).toContain("<dt style=\"margin:0;\">Size &lt;x&gt;</dt>");
    // The quote's entity differs by renderer (&quot; on Shopify, &#34; in
    // liquidjs); what matters is that no raw quote survives inside the value.
    const dd = html.match(/<dd style="margin:0;">([^<]*)<\/dd>/)![1];
    expect(dd).toMatch(/^&lt;30 cm &amp; 2(&quot;|&#34;)$/);
  });

  it("sets no font and no colour, and carries no script", async () => {
    const html = await render({ data: FULL });
    for (const style of html.matchAll(/style="([^"]*)"/g)) {
      expect(style[1]).not.toMatch(/font|color|background/i);
    }
    expect(html).not.toMatch(/<script(?![^>]*application\/ld\+json)/);
  });
});

describe("the visible product block: when it renders nothing at all", () => {
  it("renders nothing for a product with no summary, facts, fit or questions", async () => {
    expect((await render({ data: {} })).trim()).toBe("");
    expect((await render({ data: { summary: "", facts: [], fitFor: "", questions: [] } })).trim()).toBe("");
  });

  it("renders nothing when the parts with content are all switched off, not a heading over links", async () => {
    const html = await render({
      data: { summary: "Only a summary." },
      settings: { ...defaults, show_summary: false },
    });
    expect(html.trim()).toBe("");
  });

  it("renders nothing off the product template", async () => {
    for (const template of ["index", "collection", "page", "search"]) {
      expect((await render({ template, data: FULL })).trim()).toBe("");
    }
  });

  it("renders nothing on a product page when the merchant placed the block themselves", async () => {
    const html = await render({ data: FULL, settings: { ...defaults, manual_placement: true } });
    expect(html.trim()).toBe("");
  });

  it("prints no heading when the heading text is blank, and still prints the content", async () => {
    const html = await render({ data: FULL, settings: { ...defaults, heading: "" } });
    expect(html).not.toMatch(/<h2/);
    expect(text(html)).toContain("A solid oak chair");
  });
});

// Collection pages (P0.2).

const TABLE = {
  columns: ["Material", "Width"],
  rows: [
    { title: "Oak chair", handle: "oak-chair", cells: ["Oak", "45 cm"] },
    { title: "Pine & ash chair", handle: "", cells: ["Pine", ""] },
  ],
};

function collection(meta: {
  summary?: string;
  criteria?: string[];
  questions?: { q: string; a: string }[];
  table?: typeof TABLE | null;
}) {
  const mf = (value: unknown) => (value === undefined || value === null ? undefined : { value });
  return {
    title: "Chairs",
    handle: "chairs",
    url: "/collections/chairs",
    metafields: {
      $app: {
        summary: mf(meta.summary),
        criteria: mf(meta.criteria),
        questions: mf(meta.questions),
        table: mf(meta.table),
      },
    },
  };
}

const FULL_COLLECTION = collection({
  summary: "Twelve chairs in oak and pine.",
  criteria: ["Material", "Width"],
  questions: [{ q: "Which is widest?", a: "The oak chair, at 45 cm." }],
  table: TABLE,
});

describe("the visible collection block", () => {
  const onCollection = (c: ReturnType<typeof collection>, settings = defaults) =>
    renderBlock(EMBED, storefront({ template: "collection", collection: c, settings }));

  it("prints summary, criteria, questions, then the table, under the collection heading", async () => {
    const html = await onCollection(FULL_COLLECTION);
    const t = text(html);
    const order = ["About this collection", "Twelve chairs", "Material Width", "Which is widest?", "Oak chair"].map(
      (s) => t.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("<li>Material</li>");
    expect(html).toContain(`<a href="${SHOP_URL}/products/oak-chair">Oak chair</a>`);
    expect(html).toContain("Pine &amp; ash chair");
    expect(html).toContain(`<a href="${SHOP_URL}/apps/ai-visibility/llms.txt">All products as plain text</a>`);
    expect(html).not.toContain("Plain-text version of this page");
  });

  it("sets no font and no colour on collection pages either", async () => {
    const html = await onCollection(FULL_COLLECTION);
    for (const style of html.matchAll(/style="([^"]*)"/g)) {
      expect(style[1]).not.toMatch(/font-family|font-size|color|background/i);
    }
  });

  it("renders nothing for a collection with nothing written, or an empty table only", async () => {
    expect((await onCollection(collection({}))).trim()).toBe("");
    expect((await onCollection(collection({ table: { columns: [], rows: [] } as any }))).trim()).toBe("");
  });

  it("with manual placement, keeps only the questions: the comparison block shows the rest", async () => {
    const html = await onCollection(FULL_COLLECTION, { ...defaults, manual_placement: true });
    expect(text(html)).toContain("Which is widest?");
    expect(text(html)).not.toContain("Twelve chairs");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<li>");
    const noQuestions = await onCollection(
      collection({ summary: "Twelve chairs.", table: TABLE }),
      { ...defaults, manual_placement: true },
    );
    expect(noQuestions.trim()).toBe("");
  });
});

describe("the comparison-table block after the table moved into a snippet", () => {
  it("still renders its heading, summary, criteria and the table, with its own borders", async () => {
    const html = await renderBlock(
      "comparison-table.liquid",
      storefront({ template: "collection", collection: FULL_COLLECTION, settings: blockDefaults("comparison-table.liquid") }),
    );
    expect(html).toContain('<section class="ai-visibility-compare"');
    expect(text(html)).toContain("Compare these products");
    expect(html).toContain("<caption class=\"visually-hidden\">Chairs: product comparison</caption>");
    expect(html).toContain("border-bottom: 1px solid currentColor;");
    expect(html).toContain("border-bottom: 1px solid rgba(128,128,128,0.3);");
    expect(html).toContain(`<a href="${SHOP_URL}/products/oak-chair">Oak chair</a>`);
    expect((html.match(/<tr>/g) ?? []).length).toBe(3);
  });

  it("still renders nothing when there is no table", async () => {
    const html = await renderBlock(
      "comparison-table.liquid",
      storefront({ template: "collection", collection: collection({ summary: "x" }), settings: {} }),
    );
    expect(html.trim()).toBe("");
  });
});
