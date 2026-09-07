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
  // The 31 August 2026 rule still holds: no vendor, no shop name, ever - the
  // theme appends the shop name itself and doubled the brand. What changed on
  // 6 September 2026 is what stands in the brand's place. Shopify keeps
  // seo.title as an override of the product title and does not store one
  // that equals it (seen on 35 products written through productUpdate and
  // through Shopify's own CSV importer: the field read back empty both
  // times), so the bare title is not a proposal either. The title is
  // followed by the merchant's own extracted facts, or by nothing.

  it("never appends the vendor, even when the combined length would fit", () => {
    // "Viborg Bathroom Shelf with Mirror" (34 chars) plus " - Nordwood"
    // (11 chars) is 45 chars, well under the 60 target, so the old code
    // appended it. With no facts there is nothing else to add either, and
    // the honest answer is no proposal at all.
    const title = buildMetaTitle({
      title: "Viborg Bathroom Shelf with Mirror",
      descriptionHtml: null,
      facts: [],
      vendor: "Nordwood",
      shopName: null,
    });
    expect(title).not.toContain("Nordwood");
    expect(title).toBe("");
  });

  it("never appends the vendor even when the product title already contains it", () => {
    const title = buildMetaTitle({
      title: "Nordwood Oak Dining Table",
      descriptionHtml: null,
      facts: [{ k: "Material", v: "solid oak" }],
      vendor: "Nordwood",
      shopName: null,
    });
    expect(title).toBe("Nordwood Oak Dining Table - solid oak");
    expect(title.match(/Nordwood/g)).toHaveLength(1);
  });

  it("never falls back to the shop name either", () => {
    const title = buildMetaTitle({ ...base, vendor: null, shopName: "Acme Store" });
    expect(title).not.toContain("Acme Store");
    expect(title.startsWith("Set Masa extensibila & 6 Scaune - ")).toBe(true);
  });

  it("ignores a vendor that would push the title past the limit, keeping the title whole", () => {
    const title = buildMetaTitle({ ...base, vendor: "A Very Long Vendor Name Indeed" });
    expect(title).not.toContain("Vendor");
    expect(title.startsWith("Set Masa extensibila & 6 Scaune")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("is never the bare product title, because Shopify would not store it", () => {
    const title = buildMetaTitle(base);
    expect(title).not.toBe(base.title);
    expect(title.startsWith(`${base.title} - `)).toBe(true);
  });

  it("appends the merchant's own facts, values only, in fact order, within the target", () => {
    const title = buildMetaTitle({
      title: "Wireless Earbuds X2",
      descriptionHtml: null,
      facts: [
        { k: "Connectivity", v: "Bluetooth, USB-C" },
        { k: "Warranty", v: "2 years" },
      ],
    });
    expect(title.startsWith("Wireless Earbuds X2 - ")).toBe(true);
    expect(title).toContain("Bluetooth, USB-C");
    expect(title).not.toContain("Connectivity");
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("returns nothing when there are no facts to add", () => {
    expect(buildMetaTitle({ title: "Wireless Earbuds X2", descriptionHtml: null, facts: [] })).toBe("");
  });

  it("skips a fact whose value already sits in the title", () => {
    // "5G" is in the title; repeating it adds nothing, and with no other fact
    // the honest result is no proposal.
    const title = buildMetaTitle({
      title: "Smartphone Basic Call 5G",
      descriptionHtml: null,
      facts: [{ k: "Connectivity", v: "5G" }],
    });
    expect(title).toBe("");
  });

  it("takes values one at a time, not a whole group, so a word in the title is not repeated", () => {
    const title = buildMetaTitle({
      title: "Warm Fleece Hoodie",
      descriptionHtml: null,
      facts: [{ k: "Material", v: "cotton, fleece" }],
    });
    expect(title).toBe("Warm Fleece Hoodie - cotton");
  });

  it("puts values with a number first", () => {
    const title = buildMetaTitle({
      title: "Miere de salcam",
      descriptionHtml: null,
      facts: [
        { k: "Certificare", v: "ecologic" },
        { k: "Gramaj", v: "950 g" },
      ],
    });
    expect(title).toBe("Miere de salcam - 950 g, ecologic");
  });

  it("never adds a lone word of three letters or fewer without a digit", () => {
    // "bio", "vnr", "RAM" alone tell a searcher nothing; "14k" has a digit
    // and stays.
    const title = buildMetaTitle({
      title: "Harta mineralelor - eBook",
      descriptionHtml: null,
      facts: [
        { k: "Certificare", v: "bio" },
        { k: "Portie", v: "vnr" },
      ],
    });
    expect(title).toBe("");
    expect(
      buildMetaTitle({ title: "Classic Ring", descriptionHtml: null, facts: [{ k: "Purity", v: "14k" }] }),
    ).toBe("Classic Ring - 14k");
  });

  it("never adds a value that opens with a connector, which is prose", () => {
    const title = buildMetaTitle({
      title: "Vitamin C 1000 Tablets",
      descriptionHtml: null,
      facts: [
        { k: "Active ingredient", v: "with your own doctor" },
        { k: "Diet", v: "vegan" },
      ],
    });
    expect(title).toBe("Vitamin C 1000 Tablets - vegan");
  });

  it("tidies a cut title: no trailing comma, no unclosed bracket", () => {
    const cut = buildMetaTitle({
      title: "Metabolism Booster, pachet promotional (Apple Cider Vinegar, Green Tea, Guarana)",
      descriptionHtml: null,
      facts: [],
    });
    expect(cut.length).toBeLessThanOrEqual(60);
    expect(cut).toBe("Metabolism Booster, pachet promotional");
    const comma = buildMetaTitle({
      title: "Mega Pack Cele mai bune paste Reteta 6 Porumb Ovaz Spanac, Quinoa",
      descriptionHtml: null,
      facts: [],
    });
    expect(comma.endsWith(",")).toBe(false);
    // A cut that lands after a connector drops the connector too.
    const conj = buildMetaTitle({
      title: "Mega Pack Sanatele BIO din Mazare si Linte, ecologic, fara gluten, 6 x 200 g",
      descriptionHtml: null,
      facts: [],
    });
    expect(conj).toBe("Mega Pack Sanatele BIO din Mazare si Linte, ecologic");
  });

  it("matches 'already in the title' on whole words, not substrings", () => {
    // "phone" is inside "Smartphone" as letters, not as a word; the detail
    // is real and is kept.
    const title = buildMetaTitle({
      title: "Smartphone Nova 12",
      descriptionHtml: null,
      facts: [{ k: "Included", v: "phone" }],
    });
    expect(title).toBe("Smartphone Nova 12 - phone");
  });

  it("never appends a value that is only punctuation", () => {
    const title = buildMetaTitle({
      title: "Lamp",
      descriptionHtml: null,
      facts: [
        { k: "Finish", v: "-" },
        { k: "Colour", v: "..." },
      ],
    });
    expect(title).toBe("");
  });

  it("drops a fact that would not fit and keeps going, then stops once one is in", () => {
    const title = buildMetaTitle({
      title: "Wireless Earbuds X2",
      descriptionHtml: null,
      facts: [
        { k: "Included", v: "a very long list of things that does not fit in sixty characters" },
        { k: "Connectivity", v: "Bluetooth" },
      ],
    });
    expect(title).toBe("Wireless Earbuds X2 - Bluetooth");
  });

  it("still truncates a title longer than the target, which already makes it differ", () => {
    const longTitle =
      "Solid Oak Extendable Dining Table With Six Matching Upholstered Chairs Set";
    const title = buildMetaTitle({ ...base, title: longTitle, facts: [], vendor: null, shopName: null });
    expect(title).not.toBe("");
    expect(title.length).toBeLessThanOrEqual(60);
    expect(longTitle.startsWith(title)).toBe(true);
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
