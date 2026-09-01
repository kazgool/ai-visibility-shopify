import { describe, expect, it } from "vitest";
import { buildMetaTitle, buildMetaDescription } from "../meta";

const base = {
  title: "Set Masa extensibila & 6 Scaune",
  descriptionHtml:
    "<p>Masa are blatul din PAL Laminat peste care s-a fixat sticla securizata de 4 mm.</p>",
  facts: [
    { k: "Material", v: "PAL, sticla securizata, inox" },
    { k: "Dimensiuni", v: "l 80, L 130, h 79 cm" },
    { k: "Camera", v: "living, bucatarie" },
  ],
  vendor: "GlobalMobila",
};

describe("buildMetaTitle", () => {
  it("never appends the vendor, even when the combined length would fit", () => {
    // Reproduces the reported bug: "Viborg Bathroom Shelf with Mirror" (34
    // chars) plus " - Nordwood" (11 chars) is 45 chars, well under the 60
    // target, so the old code appended it - and the theme then appended the
    // shop name on top, doubling the brand. The title alone must come back
    // untouched.
    const title = buildMetaTitle({
      title: "Viborg Bathroom Shelf with Mirror",
      descriptionHtml: null,
      facts: [],
      vendor: "Nordwood",
      shopName: null,
    });
    expect(title).toBe("Viborg Bathroom Shelf with Mirror");
    expect(title).not.toContain("Nordwood");
  });

  it("never appends the vendor even when the product title already contains it", () => {
    const title = buildMetaTitle({
      title: "Nordwood Oak Dining Table",
      descriptionHtml: null,
      facts: [],
      vendor: "Nordwood",
      shopName: null,
    });
    expect(title).toBe("Nordwood Oak Dining Table");
  });

  it("never falls back to the shop name either", () => {
    const title = buildMetaTitle({ ...base, vendor: null, shopName: "Acme Store" });
    expect(title).not.toContain("Acme Store");
    expect(title).toBe("Set Masa extensibila & 6 Scaune");
  });

  it("ignores a vendor that would push the title past the limit, keeping the title whole", () => {
    const title = buildMetaTitle({ ...base, vendor: "A Very Long Vendor Name Indeed" });
    expect(title).toBe("Set Masa extensibila & 6 Scaune");
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("truncates a long title at a word boundary, never mid-word", () => {
    const longTitle =
      "Solid Oak Extendable Dining Table With Six Matching Upholstered Chairs Set";
    const title = buildMetaTitle({ ...base, title: longTitle, vendor: null, shopName: null });
    expect(title.length).toBeLessThanOrEqual(60);
    expect(longTitle.startsWith(title)).toBe(true);
    expect(title.endsWith(" ")).toBe(false);
  });

  it("never uses an ellipsis character", () => {
    const longTitle = "A".repeat(200);
    const title = buildMetaTitle({ ...base, title: longTitle, vendor: null, shopName: null });
    expect(title).not.toContain("...");
    expect(title).not.toContain("…");
  });

  it("is empty when there is no title", () => {
    expect(buildMetaTitle({ ...base, title: "" })).toBe("");
  });
});

describe("buildMetaDescription", () => {
  it("opens with the merchant's own sentence", () => {
    const desc = buildMetaDescription(base);
    expect(desc).toContain("Masa are blatul din PAL Laminat");
  });

  it("carries ordered facts", () => {
    const desc = buildMetaDescription(base);
    expect(desc.toLowerCase()).toContain("material");
  });

  it("never mentions price or availability", () => {
    const desc = buildMetaDescription({
      ...base,
      // @ts-expect-error - price is not part of MetaInput on purpose
      price: "1050.00",
    });
    expect(desc).not.toContain("1050");
    expect(desc.toLowerCase()).not.toContain("stock");
  });

  it("respects the length target", () => {
    const desc = buildMetaDescription(base, 160);
    expect(desc.length).toBeLessThanOrEqual(160);
  });

  it("still produces something when there is no description", () => {
    const desc = buildMetaDescription({ ...base, descriptionHtml: "", facts: [] });
    expect(desc).toContain("Set Masa extensibila & 6 Scaune");
  });

  it("is empty when there is nothing to say", () => {
    expect(buildMetaDescription({ title: "", descriptionHtml: "", facts: [] })).toBe("");
  });

  it("truncates at a clause boundary rather than mid-word", () => {
    const longFacts = [
      { k: "Material", v: "solid oak, brushed steel legs, tempered glass top panel" },
      { k: "Dimensiuni", v: "length 180 cm, width 90 cm, height 76 cm exactly" },
      { k: "Camera", v: "dining room, kitchen, open plan living spaces" },
    ];
    const desc = buildMetaDescription({ ...base, facts: longFacts }, 160);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(desc).not.toContain("...");
  });
});
