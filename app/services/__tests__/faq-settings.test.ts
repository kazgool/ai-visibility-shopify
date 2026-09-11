import { describe, expect, it } from "vitest";
import {
  cleanMappings,
  dictionaryGroups,
  effectivePresetId,
  normaliseHidden,
  parseCap,
  parseHidden,
  parseMappings,
  validateCap,
  validateMappings,
  MAX_FAQ_CAP,
} from "../faq-settings";
import { DEFAULT_FAQ_CAP } from "../../engine/faq";

// CC-PROMPT-AI-READABILITY-3 item 3: what a merchant may save on the
// Dictionary screen for buyer questions and for the product page's facts.

describe("mappings", () => {
  it("reads a stored row, and reads anything broken as no mappings", () => {
    expect(parseMappings('{"sections":[{"heading":"Montaj","question":"Cum se monteaza {title}?"}]}')).toEqual({
      sections: [{ heading: "Montaj", question: "Cum se monteaza {title}?" }],
      groups: [],
    });
    expect(parseMappings("not json")).toEqual({ sections: [], groups: [] });
    expect(parseMappings(null)).toEqual({ sections: [], groups: [] });
    expect(parseMappings('{"sections":"x","groups":[{"group":3}]}')).toEqual({
      sections: [],
      groups: [{ group: "", question: "" }],
    });
  });

  it("drops a row left blank, and trims the rest", () => {
    expect(
      cleanMappings({
        sections: [{ heading: " Montaj ", question: " Cum se monteaza {title}? " }, { heading: "", question: "  " }],
        groups: [{ group: "", question: "" }],
      }),
    ).toEqual({ sections: [{ heading: "Montaj", question: "Cum se monteaza {title}?" }], groups: [] });
  });

  it("accepts a heading and a question naming the product", () => {
    expect(
      validateMappings({
        sections: [{ heading: "Montaj", question: "Cum se monteaza {title}?" }],
        groups: [{ group: "Forma", question: "Ce forma are {title}?" }],
      }),
    ).toEqual([]);
  });

  it("names the row and the reason for every refusal", () => {
    const errors = validateMappings({
      sections: [
        { heading: "", question: "Cum se monteaza?" },
        { heading: "Montaj – rapid", question: "Cum se monteaza {title}?" },
        { heading: "Garantie", question: "Ce garantie are {title}?" },
        { heading: "garantie", question: "Cat dureaza garantia pentru {title}?" },
      ],
      groups: [{ group: "", question: "Ce forma are {title}" }],
    });
    expect(errors.map((e) => [e.list, e.row])).toEqual([
      ["sections", 1],
      ["sections", 1],
      ["sections", 2],
      ["sections", 4],
      ["groups", 1],
      ["groups", 1],
    ]);
    expect(errors[1].message).toMatch(/\{title\}/);
    expect(errors[2].message).toMatch(/plain characters/);
    expect(errors[3].message).toMatch(/already listed/);
    expect(errors[5].message).toMatch(/question mark/);
  });
});

describe("the cap", () => {
  it("reads a stored cap, and anything else as the default", () => {
    expect(parseCap("5")).toBe(5);
    expect(parseCap(null)).toBe(DEFAULT_FAQ_CAP);
    expect(parseCap("0")).toBe(DEFAULT_FAQ_CAP);
    expect(parseCap(String(MAX_FAQ_CAP + 1))).toBe(DEFAULT_FAQ_CAP);
  });

  it("refuses what is not a whole number in range", () => {
    expect(validateCap("8")).toBeNull();
    for (const bad of ["", "0", "2.5", "x", String(MAX_FAQ_CAP + 1)]) expect(validateCap(bad)).toMatch(/whole number/);
  });
});

describe("groups shown on the product page", () => {
  it("stores hidden labels once, in a stable order, and reads anything broken as none hidden", () => {
    expect(normaliseHidden(["Material", " Colour ", "Material", ""])).toEqual(["Colour", "Material"]);
    expect(parseHidden('["Style","Colour"]')).toEqual(["Colour", "Style"]);
    expect(parseHidden("{}")).toEqual([]);
    expect(parseHidden(null)).toEqual([]);
  });

  it("offers the groups of the dictionary the shop runs, the built-in one when it has none", () => {
    expect(dictionaryGroups("Forma: capsule, pulbere\nGramaj: #size")).toEqual(["Forma", "Gramaj"]);
    expect(dictionaryGroups("")).toContain("Material");
  });
});

describe("the preset whose templates apply", () => {
  it("is the one picked, furniture for the built-in list, and none for a hand-written dictionary", () => {
    expect(effectivePresetId("clothing", "Material: cotton")).toBe("clothing");
    expect(effectivePresetId(null, "")).toBe("furniture");
    expect(effectivePresetId(null, "Forma: capsule")).toBeNull();
    expect(effectivePresetId("no-such-preset", "Forma: capsule")).toBeNull();
  });
});
