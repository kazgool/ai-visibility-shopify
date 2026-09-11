import { describe, expect, it } from "vitest";
import { OUR_NODE_MARKER } from "../conflicts";
import { blockDefaults, ldObjects, ourNodes, renderBlock, SHOP_URL, storefront } from "./liquid-harness";

// CC-PROMPT-AI-READABILITY-4 item 1: the facts go back into structured data,
// published by the block that prints them. A Product fragment under our own
// complete node's @id, carrying exactly the facts the visible list shows, and
// only when the last theme scan saw our complete node on the product page.
// Rendered through liquidjs; invented data.

const EMBED = "ai-visibility-content.liquid";
const HEAD = "ai-visibility.liquid";
const defaults = blockDefaults(EMBED);
const OUR_ID = `${SHOP_URL}/products/oak-chair#product`;
const SEEN = { productId: "", hasProductLd: false, ourProductNode: true };

const FACTS = [
  { k: "Material", v: "Oak" },
  { k: "Width", v: "45 cm" },
  { k: "Finish", v: "Oiled" },
];

const properties = (node: any) =>
  (node.additionalProperty as { name: string; value: string }[]).map((p) => [p.name, p.value]);

describe("the facts fragment in the content snippet", () => {
  it("carries our @id, our marker and the printed facts, and no other property", async () => {
    const html = await renderBlock(EMBED, storefront({ settings: defaults, data: { facts: FACTS }, themeScan: SEEN }));
    const nodes = ourNodes(html, "Product");
    expect(nodes).toHaveLength(1);
    const [fragment] = nodes;
    expect(Object.keys(fragment).sort()).toEqual(
      ["@context", "@id", "@type", "additionalProperty", OUR_NODE_MARKER].sort(),
    );
    expect(fragment["@id"]).toBe(OUR_ID);
    expect(fragment.additionalProperty[0]).toEqual({ "@type": "PropertyValue", name: "Material", value: "Oak" });
    expect(properties(fragment)).toEqual([
      ["Material", "Oak"],
      ["Width", "45 cm"],
      ["Finish", "Oiled"],
    ]);
  });

  it("comes right after the visible list", async () => {
    const html = await renderBlock(EMBED, storefront({ settings: defaults, data: { facts: FACTS }, themeScan: SEEN }));
    const list = html.indexOf("</dl>");
    const fragment = html.indexOf("application/ld+json");
    expect(list).toBeGreaterThan(-1);
    expect(fragment).toBeGreaterThan(list);
  });

  it("leaves out a group switched off on the Dictionary screen, and stays valid JSON when that is the last fact", async () => {
    for (const hidden of [["Finish"], ["Width"], ["Material", "Finish"]]) {
      const html = await renderBlock(
        EMBED,
        storefront({ settings: defaults, data: { facts: FACTS }, themeScan: SEEN, hiddenGroups: hidden }),
      );
      const [fragment] = ourNodes(html, "Product");
      const names = properties(fragment).map(([name]) => name);
      expect(names).toEqual(FACTS.map((f) => f.k).filter((k) => !hidden.includes(k)));
    }
  });

  it("is not emitted when the facts list is not shown", async () => {
    const off = await renderBlock(
      EMBED,
      storefront({ settings: { ...defaults, show_facts: false }, data: { facts: FACTS, summary: "A chair." }, themeScan: SEEN }),
    );
    expect(ourNodes(off, "Product")).toHaveLength(0);

    const allHidden = await renderBlock(
      EMBED,
      storefront({
        settings: defaults,
        data: { facts: FACTS, summary: "A chair." },
        themeScan: SEEN,
        hiddenGroups: ["Material", "Width", "Finish"],
      }),
    );
    expect(ourNodes(allHidden, "Product")).toHaveLength(0);
  });

  it("is not emitted unless the last scan saw our complete node: a lone fragment would be a second product", async () => {
    for (const themeScan of [
      null,
      { productId: "", hasProductLd: false },
      { productId: "", hasProductLd: true, ourProductNode: false },
      { productId: `${SHOP_URL}/products/oak-chair#theme`, hasProductLd: true, ourProductNode: false },
    ]) {
      const html = await renderBlock(EMBED, storefront({ settings: defaults, data: { facts: FACTS }, themeScan }));
      expect(ldObjects(html).filter((n) => n["@type"] === "Product")).toHaveLength(0);
      // The visible list is unaffected.
      expect(html).toContain("<dt");
    }
  });

  it("is never emitted under the theme's @id", async () => {
    const theirs = `${SHOP_URL}/products/another-product#product-theme`;
    const html = await renderBlock(
      EMBED,
      storefront({ settings: defaults, data: { facts: FACTS }, themeScan: { ...SEEN, productId: theirs, hasProductLd: true } }),
    );
    expect(html).not.toContain(theirs);
    expect(ourNodes(html, "Product")[0]["@id"]).toBe(OUR_ID);
  });

  it("does the same in the block a merchant places by hand", async () => {
    const block = "product-content.liquid";
    const html = await renderBlock(
      block,
      storefront({ settings: blockDefaults(block), data: { facts: FACTS }, themeScan: SEEN, hiddenGroups: ["Width"] }),
    );
    const [fragment] = ourNodes(html, "Product");
    expect(fragment["@id"]).toBe(OUR_ID);
    expect(properties(fragment).map(([name]) => name)).toEqual(["Material", "Finish"]);
  });

  it("shares the @id the head block's complete node carries, so the two are one product", async () => {
    const head = await renderBlock(
      HEAD,
      storefront({ settings: { ...blockDefaults(HEAD), mode: "full" }, data: { facts: FACTS }, themeScan: SEEN }),
    );
    const body = await renderBlock(EMBED, storefront({ settings: defaults, data: { facts: FACTS }, themeScan: SEEN }));
    const [complete] = ourNodes(head, "Product");
    const [fragment] = ourNodes(body, "Product");
    expect(complete.name).toBe("Oak chair");
    expect(complete.additionalProperty).toBeUndefined();
    expect(fragment["@id"]).toBe(complete["@id"]);
  });
});
