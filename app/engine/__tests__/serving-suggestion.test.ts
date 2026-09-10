// Guards for SERVING_LEADS (extract.ts). An instruction to the buyer names
// things in the buyer's kitchen, not properties of the product: "Adauga in
// smoothie, iaurt sau suc de fructe" published yoghurt and fruit juice as
// ingredients of a cocoa powder. The suppression is scoped to the sentence
// the verb opens, so a statement in the next sentence still counts.

import { describe, expect, it } from "vitest";
import { extractFromText } from "../extract";
import { prepareText } from "../normalize";

function valuesOf(text: string, dictionary: string) {
  return Object.fromEntries(
    extractFromText(prepareText("", text), dictionary).map((f) => [f.k, f.v]),
  );
}

const DICT = [
  "Ingrediente: suc de *, pulbere de *, iaurt, migdale, caju, ovaz, spirulina",
  "Pastrare: la temperatura camerei, ferit de lumina",
  "Utilizare: mod de utilizare *, * pe zi",
].join("\n");

describe("serving suggestions are not product properties", () => {
  it("drops what the buyer is told to add the product to", () => {
    expect(
      valuesOf(
        "Adauga 1 lingura in smoothie, iaurt, bautura vegetala sau suc de fructe.",
        DICT,
      ),
    ).toEqual({});
  });

  it("reaches a verb that stands second, after a modal", () => {
    // "Poti adauga nuci (caju, migdale)" on a bag of oat flakes: the nuts are
    // the buyer's, and the catalogue writes the instruction this way.
    expect(valuesOf("Poti adauga caju, migdale sau ovaz.", DICT)).toEqual({});
  });

  it("keeps a statement made in the next sentence of the same text", () => {
    expect(
      valuesOf("Adauga in iaurt. Produsul contine spirulina si ovaz.", DICT),
    ).toEqual({ Ingrediente: "ovaz, spirulina" });
  });

  it("does not touch a storage instruction", () => {
    // "Pastreaza" is no serving verb: where to keep the product is a real
    // property of it.
    expect(
      valuesOf("Pastreaza produsul la temperatura camerei, ferit de lumina.", DICT),
    ).toEqual({ Pastrare: "la temperatura camerei, ferit de lumina" });
  });

  it("leaves the merchant's own usage label intact", () => {
    // A colon ends the unit, so the label captures on one side of it while
    // the instruction after it stays suppressed.
    expect(
      valuesOf("Mod de utilizare zilnica: adauga in iaurt sau suc de fructe.", DICT),
    ).toEqual({ Utilizare: "mod de utilizare zilnica" });
  });

  it("does not read a dose as a pack quantity, and keeps the dose itself", () => {
    // Both terms match "2 capsule zilnic". The pack size is stated once, in
    // the title; the dose belongs to the merchant's own usage term and is the
    // one thing that must still read inside an instruction.
    expect(
      valuesOf(
        "Maca Forte, 60 capsule. Mod de utilizare: se consuma 2 capsule zilnic.",
        "Cantitate pachet: * capsule\nUtilizare: * capsule zilnic",
      ),
    ).toEqual({ "Cantitate pachet": "60 capsule", Utilizare: "2 capsule zilnic" });
  });

  it("does not read the liquid the buyer adds as the product's own volume", () => {
    expect(
      valuesOf("Adauga pulberea peste 250 - 300 ml de apa plata.", "Volum: * ml"),
    ).toEqual({});
  });

  it("covers the instruction verbs of both languages, not only Romanian", () => {
    // "Aplicati 1 - 4 picaturi pe piele sau in crema de ingrijire" made a
    // hemp oil a cream on ten products: the cream is the buyer's own.
    expect(
      valuesOf("Aplicati 4 picaturi pe piele sau in crema de ingrijire.", "Forma: crema"),
    ).toEqual({});
    expect(valuesOf("Apply four drops into your own cream.", "Forma: crema")).toEqual({});
    expect(valuesOf("Steep one bag in 200 ml of water.", "Volum: * ml")).toEqual({});
  });

  it("leaves alone a sentence that names the product rather than a vehicle", () => {
    // "foloseste" is deliberately not an instruction verb here: it opens a
    // sentence about the product itself, and treating it as one cost two real
    // ingredients on a live catalogue.
    expect(
      valuesOf(
        "Foloseste pudra de cacao pentru o ciocolata calda.",
        "Ingrediente: pudra de *",
      ),
    ).toEqual({ Ingrediente: "pudra de cacao" });
  });

  it("ignores a serving verb buried deeper in its sentence", () => {
    // Prose, not an imperative: the window is the first three words.
    expect(
      valuesOf("Fiecare portie de pulbere pura poate adauga spirulina.", DICT),
    ).toEqual({ Ingrediente: "spirulina" });
  });
});
