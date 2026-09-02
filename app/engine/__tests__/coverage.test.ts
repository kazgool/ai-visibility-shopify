import { describe, it, expect } from "vitest";
import { coverage } from "../index";

// The per-product distribution the Report screen's readability panel is built
// from (PRD-REPORT-SCREEN §1). A dictionary written here rather than the
// default one, so the expected counts are a property of the input and not of
// whatever the built-in list happens to contain today.

const FAMILY_NAMES = [
  "Material",
  "Colour",
  "Dimensions",
  "Weight",
  "Delivery",
  "Assembly",
  "Warranty",
  "Capacity",
  "Care",
  "Origin",
  "Packaging",
  "Seats",
  "Finish",
  "Style",
  "Certification",
  "Battery",
  "Voltage",
  "Grip",
];

const TERM = FAMILY_NAMES.map((_, i) => `alpha${i}`);

const DICTIONARY = FAMILY_NAMES.map((label, i) => `${label}: ${TERM[i]}`).join("\n");

function product(title: string, terms: string[]) {
  return { title, descriptionHtml: terms.join(", ") };
}

describe("coverage depth", () => {
  it("returns one entry per product, in order, including the empty ones", () => {
    const report = coverage(
      [
        product("Nothing to read", []),
        product("Four families", TERM.slice(0, 4)),
        product("Eighteen families", TERM),
      ],
      DICTIONARY,
    );

    expect(report.sampled).toBe(3);
    expect(report.depth).toHaveLength(report.sampled);
    expect(report.depth).toEqual([0, 4, 18]);
    expect(report.none).toBe(1);
  });

  it("counts a family once per product however many values it produced", () => {
    // Two values of the same family are one kind of detail, not two: the
    // question the panel asks is how many different things a product states.
    const report = coverage([product("Twice over", [TERM[0], TERM[0]])], DICTIONARY);
    expect(report.depth).toEqual([1]);
  });

  it("returns an empty distribution for an empty catalogue, never a fabricated row", () => {
    const report = coverage([], DICTIONARY);
    expect(report.depth).toEqual([]);
    expect(report.sampled).toBe(0);
    expect(report.byAttrProducts).toEqual([]);
  });
});

describe("coverage byAttrProducts", () => {
  it("counts products, one per product per family", () => {
    const report = coverage(
      [
        product("Two families", [TERM[0], TERM[1]]),
        product("One family", [TERM[0]]),
        product("Nothing to read", []),
      ],
      DICTIONARY,
    );

    expect(report.sampled).toBe(3);
    expect(Object.fromEntries(report.byAttrProducts)).toEqual({ Material: 2, Colour: 1 });
  });

  it("can never exceed the products read, which is what makes it a fraction", () => {
    // The invariant the "N of M products" label depends on. `byAttr` counts
    // facts and carries no such guarantee: it happens to agree today only
    // because extractFromText emits at most one fact per family per product,
    // joining several matches into one value. That is an implementation
    // detail of the engine and not a promise to the screen, so the screen
    // reads this tally, which is per product by construction.
    const twoTerms = "Material: alpha0, alpha1";
    const report = coverage(
      [
        product("Two materials in one description", ["alpha0", "alpha1"]),
        product("One material", ["alpha0"]),
        product("Nothing to read", []),
      ],
      twoTerms,
    );

    expect(report.sampled).toBe(3);
    expect(Object.fromEntries(report.byAttrProducts).Material).toBe(2);
    for (const [, n] of report.byAttrProducts) {
      expect(n).toBeLessThanOrEqual(report.sampled);
    }
  });
});
