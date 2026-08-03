import { describe, expect, it } from "vitest";
import {
  splitFactsByLevel,
  variantFacts,
  varyingOptionNames,
  type VariantLike,
} from "../variants";

const v = (id: string, options: [string, string][]): VariantLike => ({
  id,
  selectedOptions: options.map(([name, value]) => ({ name, value })),
});

describe("variantFacts", () => {
  it("lifts option pairs to facts", () => {
    expect(variantFacts(v("a", [["Culoare", "Gri"], ["Marime", "160 cm"]]))).toEqual([
      { k: "Culoare", v: "Gri" },
      { k: "Marime", v: "160 cm" },
    ]);
  });

  it("ignores Shopify's Default Title placeholder", () => {
    expect(variantFacts(v("a", [["Title", "Default Title"]]))).toEqual([]);
  });

  it("cleans entities in option values", () => {
    expect(variantFacts(v("a", [["Culoare", "Gri &amp; Bej"]]))).toEqual([
      { k: "Culoare", v: "Gri & Bej" },
    ]);
  });
});

describe("varyingOptionNames", () => {
  it("names only options with more than one value", () => {
    const variants = [
      v("a", [["Culoare", "Gri"], ["Material", "Stejar"]]),
      v("b", [["Culoare", "Bej"], ["Material", "Stejar"]]),
    ];
    expect(varyingOptionNames(variants)).toEqual(new Set(["culoare"]));
  });

  it("is empty for a single-variant product", () => {
    expect(varyingOptionNames([v("a", [["Title", "Default Title"]])])).toEqual(new Set());
  });
});

describe("splitFactsByLevel", () => {
  const extracted = [
    { k: "Material", v: "stejar" },
    { k: "Culoare", v: "gri" },
    { k: "Dimensiuni", v: "160 cm" },
  ];

  it("withdraws a product fact the variants contradict", () => {
    const variants = [
      v("v1", [["Culoare", "Gri"]]),
      v("v2", [["Culoare", "Bej"]]),
    ];
    const result = splitFactsByLevel(extracted, variants);
    // "Culoare: gri" is true of one variant and false of the other; it moves.
    expect(result.productFacts.map((f) => f.k)).toEqual(["Material", "Dimensiuni"]);
    expect(result.movedLabels).toEqual(["Culoare"]);
    expect(result.perVariant.get("v1")).toEqual([{ k: "Culoare", v: "Gri" }]);
    expect(result.perVariant.get("v2")).toEqual([{ k: "Culoare", v: "Bej" }]);
  });

  it("leaves everything on the product when nothing varies", () => {
    const variants = [v("v1", [["Title", "Default Title"]])];
    const result = splitFactsByLevel(extracted, variants);
    expect(result.productFacts).toEqual(extracted);
    expect(result.perVariant.size).toBe(0);
    expect(result.movedLabels).toEqual([]);
  });

  it("keeps a product fact whose option has a single value across variants", () => {
    const variants = [
      v("v1", [["Material", "Stejar"], ["Culoare", "Gri"]]),
      v("v2", [["Material", "Stejar"], ["Culoare", "Bej"]]),
    ];
    const result = splitFactsByLevel(extracted, variants);
    // Material does not vary: the product-level claim stays true.
    expect(result.productFacts.map((f) => f.k)).toContain("Material");
    expect(result.productFacts.map((f) => f.k)).not.toContain("Culoare");
  });

  it("matches labels case-insensitively", () => {
    const variants = [
      v("v1", [["culoare", "gri"]]),
      v("v2", [["culoare", "bej"]]),
    ];
    const result = splitFactsByLevel(extracted, variants);
    expect(result.movedLabels).toEqual(["Culoare"]);
  });
});
