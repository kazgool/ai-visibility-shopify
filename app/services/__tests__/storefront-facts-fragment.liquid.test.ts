import { describe, expect, it } from "vitest";
import { OUR_NODE_MARKER } from "../conflicts";
import { blockDefaults, ldObjects, ourNodes, renderBlock, SHOP_URL, storefront } from "./liquid-harness";

// CC-PROMPT-AI-READABILITY-4 item 1: the facts go back into structured data,
// published by the block that prints them. A Product fragment under our own
// complete node's @id, carrying exactly the facts the visible list shows, and
// only when this product's own public-page observation saw our complete node.
// Rendered through liquidjs; invented data.

const EMBED = "ai-visibility-content.liquid";
const HEAD = "ai-visibility.liquid";
const defaults = blockDefaults(EMBED);
const OUR_ID = `${SHOP_URL}/products/oak-chair#product`;
const SEEN = { productNode: "complete", version: 1 };

const FACTS = [
  { k: "Material", v: "Oak" },
  { k: "Width", v: "45 cm" },
  { k: "Finish", v: "Oiled" },
];

const properties = (node: any) =>
  (node.additionalProperty as { name: string; value: string }[]).map((p) => [p.name, p.value]);

describe("the facts fragment in the content snippet", () => {
  it("carries our @id, our marker and the printed facts, and no other property", async () => {
    const html = await renderBlock(EMBED, storefront({ settings: defaults, data: { facts: FACTS }, schemaObservation: SEEN }));
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
    const html = await renderBlock(EMBED, storefront({ settings: defaults, data: { facts: FACTS }, schemaObservation: SEEN }));
    const list = html.indexOf("</dl>");
    const fragment = html.indexOf("application/ld+json");
    expect(list).toBeGreaterThan(-1);
    expect(fragment).toBeGreaterThan(list);
  });

  it("leaves out a group switched off on the Dictionary screen, and stays valid JSON when that is the last fact", async () => {
    for (const hidden of [["Finish"], ["Width"], ["Material", "Finish"]]) {
      const html = await renderBlock(
        EMBED,
        storefront({ settings: defaults, data: { facts: FACTS }, schemaObservation: SEEN, hiddenGroups: hidden }),
      );
      const [fragment] = ourNodes(html, "Product");
      const names = properties(fragment).map(([name]) => name);
      expect(names).toEqual(FACTS.map((f) => f.k).filter((k) => !hidden.includes(k)));
    }
  });

  it("is not emitted when the facts list is not shown", async () => {
    const off = await renderBlock(
      EMBED,
      storefront({ settings: { ...defaults, show_facts: false }, data: { facts: FACTS, summary: "A chair." }, schemaObservation: SEEN }),
    );
    expect(ourNodes(off, "Product")).toHaveLength(0);

    const allHidden = await renderBlock(
      EMBED,
      storefront({
        settings: defaults,
        data: { facts: FACTS, summary: "A chair." },
        schemaObservation: SEEN,
        hiddenGroups: ["Material", "Width", "Finish"],
      }),
    );
    expect(ourNodes(allHidden, "Product")).toHaveLength(0);
  });

  it("is not emitted unless this product was observed with our complete node: a lone fragment would be a second product", async () => {
    for (const schemaObservation of [
      null,
      {},
      { productNode: "absent", version: 1 },
      { productNode: "complete", version: 2 },
    ]) {
      const html = await renderBlock(EMBED, storefront({ settings: defaults, data: { facts: FACTS }, schemaObservation }));
      expect(ldObjects(html).filter((n) => n["@type"] === "Product")).toHaveLength(0);
      // The visible list is unaffected.
      expect(html).toContain("<dt");
    }
  });

  it("does not use a shop-level observation from a different product", async () => {
    const theirs = `${SHOP_URL}/products/another-product#product-theme`;
    const html = await renderBlock(
      EMBED,
      storefront({ settings: defaults, data: { facts: FACTS }, themeScan: { productId: theirs, ourProductNode: false }, schemaObservation: SEEN }),
    );
    expect(html).not.toContain(theirs);
    expect(ourNodes(html, "Product")[0]["@id"]).toBe(OUR_ID);
  });

  it("does the same in the block a merchant places by hand", async () => {
    const block = "product-content.liquid";
    const html = await renderBlock(
      block,
      storefront({ settings: blockDefaults(block), data: { facts: FACTS }, schemaObservation: SEEN, hiddenGroups: ["Width"] }),
    );
    const [fragment] = ourNodes(html, "Product");
    expect(fragment["@id"]).toBe(OUR_ID);
    expect(properties(fragment).map(([name]) => name)).toEqual(["Material", "Finish"]);
  });

  it("shares the @id the head block's complete node carries, so the two are one product", async () => {
    const head = await renderBlock(
      HEAD,
      storefront({ settings: { ...blockDefaults(HEAD), mode: "full" }, data: { facts: FACTS }, schemaObservation: SEEN }),
    );
    const body = await renderBlock(EMBED, storefront({ settings: defaults, data: { facts: FACTS }, schemaObservation: SEEN }));
    const [complete] = ourNodes(head, "Product");
    const [fragment] = ourNodes(body, "Product");
    expect(complete.name).toBe("Oak chair");
    expect(complete.additionalProperty).toBeUndefined();
    expect(fragment["@id"]).toBe(complete["@id"]);
  });
});
