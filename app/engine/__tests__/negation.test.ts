// PRD-FIX-WAVE-1 E1. A denial published as a claim is the one failure worse
// than publishing nothing: the merchant's own text says the opposite. Inputs
// are verbatim from the Republica BIO catalogue.

import { describe, expect, it } from "vitest";
import { extractFromText } from "../extract";
import { parseDictionary, parseDictionaryOptions, DEFAULT_NEGATORS } from "../dictionary";
import { prepareText } from "../normalize";

const DICTIONARY = ["Alergeni: contine gluten", "Fara: fara gluten"].join("\n");

function valuesOf(text: string, dictionary = DICTIONARY) {
  return Object.fromEntries(
    extractFromText(prepareText("", text), dictionary).map((f) => [f.k, f.v]),
  );
}

describe("negation window", () => {
  it("does not publish an allergen the text denies (SKIN GLOW)", () => {
    const values = valuesOf(
      "nu contine gluten sau organisme modificate genetic, fiind ideala pentru femei",
    );
    expect(values.Alergeni).toBeUndefined();
  });

  it("keeps the fara term when the same text states it", () => {
    const values = valuesOf(
      "fara gluten. nu contine gluten sau organisme modificate genetic, fiind ideala pentru femei",
    );
    expect(values.Alergeni).toBeUndefined();
    expect(values.Fara).toBe("fara gluten");
  });

  it("does not publish an allergen after a negator two tokens back (Discovery Pack Latte)", () => {
    const values = valuesOf("produsul nu contine gluten, lactoza, soia");
    expect(values.Alergeni).toBeUndefined();
  });

  it("still publishes the claim when no negator precedes it", () => {
    const values = valuesOf("produsul contine gluten si lactoza");
    expect(values.Alergeni).toBe("contine gluten");
  });

  it("the term's own negator does not suppress the term (the trap)", () => {
    const values = valuesOf("produs fara gluten, potrivit oricui");
    expect(values.Fara).toBe("fara gluten");
  });

  it("a denial in one sentence does not silence a claim in another", () => {
    const values = valuesOf("nu contine lactoza. produsul contine gluten.");
    expect(values.Alergeni).toBe("contine gluten");
  });

  it("looks no further back than three tokens", () => {
    const values = valuesOf("nu este potrivit oricui produsul contine gluten");
    expect(values.Alergeni).toBe("contine gluten");
  });

  // English writes a free-from claim backwards, so the negator of one term
  // sits immediately in front of the next one. Reading it as a denial threw
  // away every claim after the first.
  it("a negator that is the tail of another term does not deny what follows", () => {
    const values = valuesOf(
      "dairy free and gluten free",
      "Diet: gluten free, dairy free",
    );
    expect(values.Diet).toContain("gluten free");
    expect(values.Diet).toContain("dairy free");
  });

  // A negator that opens the three-token window has nothing in front of it
  // inside that window, so the tail test could not see the word that would
  // identify it. "Free shipping and email support" lost the support entirely -
  // a large class, since English offers are routinely written that way.
  describe("a negator that opens the window", () => {
    const OFFERS = "Support: email support\nUpdates: free updates\nWarranty: * year";

    it("names an offer rather than denying the next attribute", () => {
      expect(valuesOf("Free shipping and email support.", OFFERS).Support)
        .toBe("email support");
    });

    it("still lets the term it belongs to through", () => {
      expect(valuesOf("Free updates and email support.", OFFERS).Updates)
        .toBe("free updates");
    });

    it("leaves an unnegated sentence alone", () => {
      expect(valuesOf("Lifetime updates and email support.", OFFERS).Support)
        .toBe("email support");
    });

    it("does not reach a count, which is exempt", () => {
      expect(valuesOf("Free shipping and 2 year warranty.", OFFERS).Warranty)
        .toBe("2 year");
    });
  });

  it("a leading negator still denies what follows", () => {
    expect(valuesOf("free of gluten", "Alergeni: gluten").Alergeni).toBeUndefined();
    expect(valuesOf("nu contine gluten", "Alergeni: gluten").Alergeni).toBeUndefined();
  });

  it("applies to prefix captures too", () => {
    const dictionary = "Ingrediente: contine *";
    expect(valuesOf("produsul nu contine seminte crude", dictionary).Ingrediente)
      .toBeUndefined();
    expect(valuesOf("produsul contine seminte crude", dictionary).Ingrediente)
      .toBe("contine seminte crude");
  });
});

describe("negators directive", () => {
  it("defaults when the dictionary says nothing", () => {
    expect(parseDictionaryOptions(DICTIONARY).negators).toEqual(DEFAULT_NEGATORS);
  });

  it("a negators line replaces the default list", () => {
    const raw = `${DICTIONARY}\nnegators: zonder`;
    expect(parseDictionaryOptions(raw).negators).toEqual(["zonder"]);
    // "nu" is no longer a negator for this shop, so the claim comes through.
    expect(valuesOf("produsul nu contine gluten", raw).Alergeni).toBe("contine gluten");
  });

  it("a negators+ line adds to the default list", () => {
    const raw = `${DICTIONARY}\nnegators+: exclus`;
    expect(parseDictionaryOptions(raw).negators).toEqual([...DEFAULT_NEGATORS, "exclus"]);
    expect(valuesOf("produsul exclus contine gluten", raw).Alergeni).toBeUndefined();
    expect(valuesOf("produsul nu contine gluten", raw).Alergeni).toBeUndefined();
  });

  it("a keyword line is never read as an attribute family", () => {
    const facts = extractFromText(
      prepareText("", "produsul contine gluten"),
      `${DICTIONARY}\nnegators: zonder`,
    );
    expect(facts.map((f) => f.k)).not.toContain("negators");
  });

  it("an unknown keyword is ignored rather than becoming a directive", () => {
    const facts = extractFromText(
      prepareText("", "produsul contine gluten"),
      `${DICTIONARY}\nsomethingnew+: whatever`,
    );
    expect(facts.map((f) => f.k)).toEqual(["Alergeni"]);
  });

  // The "+" was treated as proof of a directive on its own, so any family
  // whose label happened to end in one was deleted without a word. Only a
  // keyword we know is a directive; everything else is a family.
  it("a family whose label ends in + stays a family", () => {
    const groups = parseDictionary("Extras+: gift box, engraving\nMaterial: oak");
    expect(groups.map((g) => g.label)).toEqual(["Extras+", "Material"]);
  });

  it("and negators+ is still a directive", () => {
    expect(parseDictionary("negators+: x").map((g) => g.label)).toEqual([]);
    expect(parseDictionaryOptions("negators+: x").negators).toEqual([
      ...DEFAULT_NEGATORS,
      "x",
    ]);
  });
});
