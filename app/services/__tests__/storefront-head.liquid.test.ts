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

  it("theme node with @id: one node from us, a fragment under the theme's @id", async () => {
    const html = await renderBlock(
      FILE,
      storefront({ settings, data: DATA, themeScan: { productId: THEME_ID, hasProductLd: true } }),
    );
    const nodes = ourNodes(html, "Product");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]["@id"]).toBe(THEME_ID);
    expect(nodes[0].offers).toBeUndefined();
    expect(nodes[0].name).toBeUndefined();
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
