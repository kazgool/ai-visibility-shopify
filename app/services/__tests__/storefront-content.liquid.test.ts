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
