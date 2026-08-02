// Unit tests per DICTIONARY-PORT §2, §5–§9.

import { describe, expect, it } from "vitest";
import { parseDictionary } from "../dictionary";
import { normalize, prepareText, diacriticPattern } from "../normalize";
import { measurements } from "../measurements";
import { counted } from "../counts";
import { trimPhrase, isUsablePhrase } from "../phrase";
import { stopwordSet } from "../stopwords";
import { extractFromText } from "../extract";

const stops = stopwordSet();

describe("normalize", () => {
  it("strips diacritics", () => {
    expect(normalize("Croială")).toBe("croiala");
  });
  it("collapses punctuation and whitespace", () => {
    expect(normalize("  Piele,   ecologică! ")).toBe("piele ecologica");
  });
});

describe("prepareText", () => {
  it("joins title and body, lowercases, keeps diacritics", () => {
    expect(prepareText("Masă", "<p>Cu sticlă</p>")).toBe("masă. cu sticlă");
  });
});

describe("diacriticPattern", () => {
  it("matches both spellings", () => {
    const re = new RegExp(diacriticPattern("croiala"), "u");
    expect(re.test("croială")).toBe(true);
    expect(re.test("croiala")).toBe(true);
  });
});

describe("parseDictionary", () => {
  it("parses label and terms", () => {
    const [group] = parseDictionary("Material: lace, tulle");
    expect(group.label).toBe("Material");
    expect(group.terms).toEqual(["lace", "tulle"]);
    expect(group.fallback).toBe("");
  });

  it("reads the | default: fallback", () => {
    const [group] = parseDictionary("Colour: white, black | default: natural");
    expect(group.fallback).toBe("natural");
    expect(group.terms).toEqual(["white", "black"]);
  });

  it("skips lines without a colon and empty term lists", () => {
    expect(parseDictionary("nonsense\nMaterial:   \n")).toEqual([]);
  });

  it("later duplicate labels overwrite earlier ones", () => {
    const groups = parseDictionary("Material: lace\nMaterial: satin");
    expect(groups).toHaveLength(1);
    expect(groups[0].terms).toEqual(["satin"]);
  });
});

describe("measurements", () => {
  it("reads dimension chains", () => {
    expect(measurements("masa 80x200 cm")).toContain("80x200 cm");
  });
  it("reads named dimensions with and without unit", () => {
    const hits = measurements("l 80, L 130, h 79 cm, adancime 50");
    expect(hits.join(" ")).toContain("130");
    expect(hits.join(" ")).toContain("adancime 50");
  });
  it("falls back to a bare value with a unit only when nothing else matched", () => {
    expect(measurements("sticla de 4 mm")).toEqual(["4 mm"]);
    expect(measurements("80x200 cm si 4 mm")).not.toContain("4 mm");
  });
});

describe("counted", () => {
  it("reads a number written before the noun", () => {
    expect(counted("set cu 6 scaune", "scaune")).toEqual(["6 scaune"]);
  });
  it("ignores a number inside a longer word", () => {
    expect(counted("6 scaunelor", "scaune")).toEqual([]);
  });
});

describe("phrase hygiene", () => {
  it("trims filler from both ends", () => {
    expect(trimPhrase("drept si bretele", stops)).toBe("drept");
  });
  it("rejects a phrase carrying a stopword in the middle", () => {
    expect(isUsablePhrase("masa are blatul", stops)).toBe(false);
  });
  it("rejects a bare number", () => {
    expect(isUsablePhrase("4", stops)).toBe(false);
  });
  it("accepts a clean phrase", () => {
    expect(isUsablePhrase("blat sticla", stops)).toBe(true);
  });
});

describe("assembly", () => {
  it("uses the fallback only when a group has no hits", () => {
    const facts = extractFromText("rochie simpla", "Colour: white | default: natural");
    expect(facts).toEqual([{ k: "Colour", v: "natural" }]);
  });

  it("caps values at four per label", () => {
    const dict = "Material: a1, a2, a3, a4, a5";
    const facts = extractFromText("a1 a2 a3 a4 a5", dict);
    expect(facts[0].v.split(", ")).toHaveLength(4);
  });

  it("drops a term subsumed by a longer one", () => {
    const facts = extractFromText("chantilly lace dress", "Material: lace, chantilly lace");
    expect(facts[0].v).toBe("chantilly lace");
  });

  it("does not match a term inside a longer word", () => {
    expect(extractFromText("tulpina florii", "Material: tul")).toEqual([]);
  });

  it("returns nothing for empty text", () => {
    expect(extractFromText("", "Material: lace")).toEqual([]);
  });
});
