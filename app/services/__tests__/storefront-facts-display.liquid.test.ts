import { describe, expect, it } from "vitest";
import { blockDefaults, renderBlock, storefront } from "./liquid-harness";

// CC-PROMPT-AI-READABILITY-3 item 3: a dictionary group switched off on the
// Dictionary screen ("Show on the product page") leaves the visible facts
// list, and only that list. Rendered through liquidjs in both storefront
// languages. Invented data.

const EMBED = "ai-visibility-content.liquid";
const defaults = blockDefaults(EMBED);

const FACTS = [
  { k: "Material", v: "Oak" },
  { k: "Width", v: "45 cm" },
  { k: "Finish", v: "Oiled" },
];

const pairs = (html: string) =>
  [...html.matchAll(/<dt[^>]*>([^<]*)<\/dt>\s*<dd[^>]*>([^<]*)<\/dd>/g)].map((m) => m[1]);

for (const locale of ["en", "ro"]) {
  describe(`the facts list, storefront in ${locale}`, () => {
    it("shows every group when none is switched off", async () => {
      const html = await renderBlock(EMBED, storefront({ settings: defaults, data: { facts: FACTS } }), locale);
      expect(pairs(html)).toEqual(["Material", "Width", "Finish"]);
    });

    it("leaves out a switched-off group and keeps the others in order", async () => {
      const html = await renderBlock(
        EMBED,
        storefront({ settings: defaults, data: { facts: FACTS }, hiddenGroups: ["Width"] }),
        locale,
      );
      expect(pairs(html)).toEqual(["Material", "Finish"]);
      expect(html).not.toContain("45 cm");
    });

    it("prints no empty list when every group is switched off", async () => {
      const html = await renderBlock(
        EMBED,
        storefront({
          settings: defaults,
          data: { facts: FACTS, summary: "A solid oak chair." },
          hiddenGroups: ["Material", "Width", "Finish"],
        }),
        locale,
      );
      expect(html).not.toContain("<dl");
      expect(html).toContain("A solid oak chair.");
    });

    it("does the same in the block a merchant places by hand", async () => {
      const block = "product-content.liquid";
      const html = await renderBlock(
        block,
        storefront({ settings: blockDefaults(block), data: { facts: FACTS }, hiddenGroups: ["Material"] }),
        locale,
      );
      expect(pairs(html)).toEqual(["Width", "Finish"]);
    });

    it("renders nothing at all when the facts were the only part and all are switched off", async () => {
      const html = await renderBlock(
        EMBED,
        storefront({
          settings: { ...defaults, show_links: false },
          data: { facts: FACTS },
          hiddenGroups: ["Material", "Width", "Finish"],
        }),
        locale,
      );
      expect(html.trim()).toBe("");
    });
  });
}
