// PRD-FIX-WAVE-1 E2. A dotted abbreviation is one word to a reader and seven
// one-letter tokens to a regex, which is how 39 products published
// "notificat de s". Inputs are verbatim from the Republica BIO catalogue.

import { describe, expect, it } from "vitest";
import { extractFromText } from "../extract";
import { collapseDottedAbbreviations, prepareText } from "../normalize";
import { isUsablePhrase } from "../phrase";
import { stopwordSet } from "../stopwords";

const DICTIONARY = ["Notificare: notificat de *", "Gramaj: * l, * g"].join("\n");

function valuesOf(text: string) {
  return Object.fromEntries(
    extractFromText(prepareText("", text), DICTIONARY).map((f) => [f.k, f.v]),
  );
}

describe("collapseDottedAbbreviations", () => {
  it("collapses a run of single letters", () => {
    expect(collapseDottedAbbreviations("S.N.P.M.A.P.S. 1378/2023")).toBe("SNPMAPS 1378/2023");
    expect(collapseDottedAbbreviations("notificat de M.S.")).toBe("notificat de MS");
  });

  it("leaves decimals and domains alone", () => {
    expect(collapseDottedAbbreviations("1.5 l")).toBe("1.5 l");
    expect(collapseDottedAbbreviations("www.example.com")).toBe("www.example.com");
  });
});

describe("dotted abbreviations in extraction", () => {
  it("reads the notification body as one word (MACA FORTE COMPLETE PROTOCOL)", () => {
    const values = valuesOf("notificat de S.N.P.M.A.P.S. 1378/2023");
    expect(values.Notificare).toBe("notificat de snpmaps 1378");
    expect(values.Notificare.length).toBeGreaterThan(2);
  });

  it("does not regress an undotted notification body", () => {
    expect(valuesOf("notificat de CRSP Iasi 4543/2023").Notificare).toBe(
      "notificat de crsp iasi 4543",
    );
  });

  it("leaves a decimal quantity untouched", () => {
    expect(valuesOf("Flacon de 1,5 l").Gramaj).toBe("1,5 l");
    expect(valuesOf("Flacon de 1.5 l").Gramaj).toBe("1.5 l");
  });
});

describe("single-letter captures", () => {
  it("a phrase that is nothing but one character is not an attribute", () => {
    const stops = stopwordSet();
    expect(isUsablePhrase("s", stops)).toBe(false);
    expect(isUsablePhrase("ms 1378", stops)).toBe(true);
  });

  // The first rule read "first word one character, reject", and it was written
  // for the "notificat de s" remnant - which the dot collapse above already
  // removes at source. What it actually deleted was every value a letter
  // carries: vitamin letters, clothing sizes, grades.
  it("keeps a value whose first word is a letter", () => {
    const stops = stopwordSet();
    expect(isUsablePhrase("c 1000", stops)).toBe(true);
    expect(isUsablePhrase("s 1378", stops)).toBe(true);
  });

  it("publishes the vitamin letter and the strength after it", () => {
    const facts = extractFromText(
      prepareText("", "contine vitamina C 1000 mg"),
      "Ingrediente: vitamina *",
    );
    expect(facts[0].v).toContain("vitamina c 1000");
  });

  it("publishes a single-letter size", () => {
    const facts = extractFromText(
      prepareText("", "marime M disponibila"),
      "Marime: marime *",
    );
    expect(facts[0].v).toContain("marime m");
  });
});
