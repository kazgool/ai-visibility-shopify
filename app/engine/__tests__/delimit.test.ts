import { describe, expect, it } from "vitest";

import {
  atMostOneBareMeasurement,
  boundBefore,
  containsNegator,
  cutByWindow,
  endsOnLooseFigure,
  isSafetyLabel,
  safetyAllows,
  safetyTermIsWhole,
  withBound,
  withoutMergedDimensions,
} from "../delimit";
import { extractFromText } from "../extract";
import { measurements } from "../measurements";

// SPEC-EXTRACTION-QUALITY, batch 5 item 6. One describe per error class, named
// for the class, every fixture a real string from the corpus. Counts in
// _shopify/corpus/facts-error-classes.md; reproduce with
// `npx tsx scripts/facts-error-classes.ts`.

const NEGATORS = new Set(["nu", "fara", "no", "without", "free"]);

describe("rule 1: a bound or an operator is kept, never dropped", () => {
  // jlab.com, Screen: 110 errors of 121 values, 92 of them this class.
  it("keeps an English upper bound on the figure", () => {
    expect(boundBefore("frequency response up to 20,000 Hz", "frequency response up to ".length)).toBe("up to");
    expect(withBound("frequency response up to 20,000 Hz", 25, "20,000 Hz")).toBe("up to 20,000 Hz");
  });

  // aquaframe.ro: "Size: 2kg" from "the unit weighs under 2 kg".
  it("keeps 'under', which turned a limit into a stated weight", () => {
    const text = "the unit weighs under 2 kg";
    expect(withBound(text, text.indexOf("2 kg"), "2 kg")).toBe("under 2 kg");
  });

  it("keeps the Romanian bounds a dictionary never carries as terms", () => {
    expect(boundBefore("livrare de la 2 kg", "livrare de la ".length)).toBe("de la");
    expect(boundBefore("greutate sub 5 kg", "greutate sub ".length)).toBe("sub");
    expect(boundBefore("pana la 30 zile", "pana la ".length)).toBe("pana la");
  });

  // A bound belongs to the figure it stands in front of, not to the next one.
  it("does not carry a bound across to another figure", () => {
    const text = "de la 10 lei, greutate 2 kg";
    expect(withBound(text, text.indexOf("2 kg"), "2 kg")).toBe("2 kg");
  });

  it("leaves a figure with no bound exactly as it was", () => {
    expect(withBound("greutate 2 kg", "greutate ".length, "2 kg")).toBe("2 kg");
  });

  it("reaches the measurement path, so #size publishes the bound", () => {
    expect(measurements("inaltime maxim 79 cm")).toEqual(["maxim 79 cm"]);
  });
});

describe("rule 2: a negation inside the captured span kills the capture", () => {
  // beardbrand.com, Key ingredients: "with no harsh sulfates".
  it("refuses a capture that swallowed the negator", () => {
    expect(containsNegator(["no", "harsh", "sulfates"], NEGATORS)).toBe(true);
    expect(containsNegator(["fara", "gluten"], NEGATORS)).toBe(true);
  });

  it("leaves a capture with no negator in it alone", () => {
    expect(containsNegator(["organic", "grass-fed", "beef"], NEGATORS)).toBe(false);
  });
});

describe("rule 3: two figures for one dimension is a pack, not a product", () => {
  // globalmobila-fixture.csv, Dimensions: a sofa and an armchair merged.
  it("publishes nothing when a dimension name repeats", () => {
    expect(withoutMergedDimensions(["L 130", "l 75", "h 60 cm", "L 65"])).toEqual([]);
  });

  // The table closed and extended, which is the same fault in one piece.
  it("publishes nothing for two lengths on one table", () => {
    expect(withoutMergedDimensions(["l 80", "L 130", "h 79 cm", "L 170"])).toEqual([]);
  });

  // The whole group goes, not the duplicate: keeping the first of two lengths
  // is choosing one at random.
  it("does not keep one of the two and drop the other", () => {
    expect(withoutMergedDimensions(["L 130", "L 65"])).toEqual([]);
  });

  it("leaves a single set of dimensions untouched", () => {
    const one = ["lungime 225 cm", "latime 110 cm", "inaltime 93 cm"];
    expect(withoutMergedDimensions(one)).toEqual(one);
  });

  // A chain carries no name and states a whole footprint by itself.
  it("does not read a chain as a repeated name", () => {
    expect(withoutMergedDimensions(["80x200 cm", "90x200 cm"])).toEqual(["80x200 cm", "90x200 cm"]);
  });
});

describe("rule 4: a figure with nothing saying what it measures", () => {
  // deathwishcoffee.com, Ingredients: "contains approximately 140mg", cut
  // before "of caffeine per 6oz serving".
  it("refuses a capture that ends on a figure carrying a unit", () => {
    expect(endsOnLooseFigure(["contains", "approximately", "140mg"])).toBe(true);
  });

  // The narrowing abbreviations.test.ts forced: a plain integer at the end is
  // usually a number the merchant meant, and dropping those removed value
  // with the noise.
  it("leaves a notification number alone, because it has no unit", () => {
    expect(endsOnLooseFigure(["notificat", "de", "snpmaps", "1378"])).toBe(false);
  });

  it("leaves a figure that still has its noun after it", () => {
    expect(endsOnLooseFigure(["2kg", "bag"])).toBe(false);
  });

  // rusticart.ro, Dimensions: "16cm, 8cm, 15cm" - the mattress offset, the
  // beam cross-section and a third figure, with nothing saying which is which.
  it("publishes one bare measurement but never three", () => {
    expect(atMostOneBareMeasurement(["200cm"])).toEqual(["200cm"]);
    expect(atMostOneBareMeasurement(["16cm", "8cm", "15cm"])).toEqual([]);
  });
});

describe("rule 5: a capture cut by the window, not by a boundary", () => {
  // colourpop.com, Key ingredients: "with our new nourishing".
  it("refuses a three-word capture the sentence carries straight on from", () => {
    const text = "made with our new nourishing formula";
    expect(cutByWindow(text, text.indexOf(" formula"), true)).toBe(true);
  });

  it("keeps a capture that ended at the end of the sentence", () => {
    const text = "made with organic cold-pressed oil.";
    expect(cutByWindow(text, text.length - 1, true)).toBe(false);
  });

  it("keeps a capture that ended because it hit a connector", () => {
    const text = "made with organic beef and rice";
    // keptAll false: the capture stopped at "and", not at the window.
    expect(cutByWindow(text, text.indexOf(" and"), false)).toBe(false);
  });
});

describe("rule 6: safety is published whole or not at all", () => {
  it("knows which labels are safety labels, in both languages", () => {
    expect(isSafetyLabel("Alergeni")).toBe(true);
    expect(isSafetyLabel("Avertismente de eticheta")).toBe(true);
    expect(isSafetyLabel("Valabilitate")).toBe(true);
    expect(isSafetyLabel("Allergens")).toBe(true);
    expect(isSafetyLabel("Warnings")).toBe(true);
    expect(isSafetyLabel("Material")).toBe(false);
    expect(isSafetyLabel("Ingredients")).toBe(false);
  });

  it("refuses a truncated capture under a safety label and allows it elsewhere", () => {
    expect(safetyAllows("Alergeni", true)).toBe(false);
    expect(safetyAllows("Alergeni", false)).toBe(true);
    expect(safetyAllows("Material", true)).toBe(true);
  });

  // Republica BIO, 39 of 54 Alergeni values. The merchant's own dictionary
  // carries "poate contine urme" as a term, so nothing is truncated by us -
  // the term itself is half the sentence, and what goes out is a trace
  // allergen warning with the allergen removed.
  it("refuses a safety term the merchant's sentence carries on from", () => {
    const text = "poate contine urme de soia";
    expect(safetyTermIsWhole("Alergeni", text, "poate contine urme".length)).toBe(false);
    expect(safetyTermIsWhole("Alergeni", "poate contine urme de sulfiti", 18)).toBe(false);
  });

  it("allows the same term when it stands whole", () => {
    expect(safetyTermIsWhole("Alergeni", "nu contine alergeni.", 19)).toBe(true);
    expect(safetyTermIsWhole("Alergeni", "poate contine urme", 18)).toBe(true);
  });

  // The rubric names a true-but-partial value as NOT an error, and dropping
  // these would remove value along with noise. negation.test.ts caught it.
  it("allows a list that carries on, which is partial and not wrong", () => {
    const text = "produsul contine gluten si lactoza";
    expect(safetyTermIsWhole("Alergeni", text, "produsul contine gluten".length)).toBe(true);
  });

  it("never touches a label that is not a safety label", () => {
    expect(safetyTermIsWhole("Ingrediente", "faina de grau", 5)).toBe(true);
  });
});

describe("the rules together, through the engine", () => {
  const dictionary = "Alergeni: poate contine urme, nu contine alergeni\nIngrediente: contine *\n";

  it("publishes no allergen at all rather than one with its allergen cut off", () => {
    const facts = extractFromText("poate contine urme de soia.", dictionary);
    expect(facts.find((f) => f.k === "Alergeni")).toBeUndefined();
  });

  it("still publishes the allergen statement the merchant wrote whole", () => {
    const facts = extractFromText("nu contine alergeni.", dictionary);
    expect(facts.find((f) => f.k === "Alergeni")?.v).toBe("nu contine alergeni");
  });
});
