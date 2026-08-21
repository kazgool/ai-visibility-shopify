// Unit tests per DICTIONARY-PORT §2, §5–§9.

import { describe, expect, it } from "vitest";
import { parseDictionary } from "../dictionary";
import { normalize, prepareText, diacriticPattern, cleanOutput } from "../normalize";
import { measurements } from "../measurements";
import { counted } from "../counts";
import { trimPhrase, isUsablePhrase, looksLikeIdentifier } from "../phrase";
import { stopwordSet } from "../stopwords";
import { extractFromText } from "../extract";
import { extractProduct } from "../index";

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

  it("keeps L and l distinct so length is never labelled as width", () => {
    const hits = measurements("Masa L 130, l 80, H 79 cm");
    expect(hits).toContain("L 130");
    expect(hits).toContain("l 80");
  });

  it("matches named and chained dimensions in uppercase text", () => {
    expect(measurements("130 X 80 CM")).toContain("130 X 80 CM");
  });

  it("lowercases a multi-letter label the same way prepareText used to", () => {
    expect(measurements("Lungime 130 cm")).toContain("lungime 130 cm");
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

describe("extractProduct measurements case preservation", () => {
  it("publishes L with its capital intact instead of collapsing it into width", () => {
    const facts = extractProduct(
      { title: "Masa L 130, l 80", descriptionHtml: "<p>L 130, l 80, H 79 cm</p>" },
      "Dimensiuni: #size",
    );
    const dimensions = facts.find((f) => f.k === "Dimensiuni");
    expect(dimensions?.v).toContain("L 130");
  });
});

describe("identifier detection", () => {
  it("catches UUIDs and hex blocks from migrations", () => {
    expect(looksLikeIdentifier("B6ADC692-C01B-4229-8956-100A9AFB8C46")).toBe(true);
    expect(looksLikeIdentifier("3ba7dee8f7bd4e14")).toBe(true);
    expect(looksLikeIdentifier("a1b2c3d4e5f60718aa")).toBe(true);
  });

  it("leaves real specifications alone", () => {
    for (const spec of ["160x80", "M8x40", "IP65", "DDR4", "USB-C", "18k", "5G", "OLED"]) {
      expect(looksLikeIdentifier(spec)).toBe(false);
    }
  });
});

describe("phrase hygiene", () => {
  it("trims filler from the end", () => {
    expect(trimPhrase("extensibila si", stops)).toBe("extensibila");
  });
  it("trims filler from the front", () => {
    expect(trimPhrase("cu blat sticla", stops)).toBe("blat sticla");
  });
  // Trimming only touches the ends. A stopword in the middle means the phrase
  // is a piece of a sentence, and the stricter test below throws it away.
  it("leaves a stopword in the middle for isUsablePhrase to reject", () => {
    expect(trimPhrase("blat si picioare", stops)).toBe("blat si picioare");
    expect(isUsablePhrase("blat si picioare", stops)).toBe(false);
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

describe("appearance qualifiers (aspect de / tip / imitatie / efect)", () => {
  const dict = "Material: marmura, lemn masiv, catifea\nStil: contemporan, modern";

  it("does not claim marble for 'aspect de marmura'", () => {
    const facts = extractFromText(
      "Blat spectaculos cu aspect de marmura bogat texturata.",
      dict,
    );
    expect(facts.find((f) => f.k === "Material")).toBeUndefined();
  });

  it("does not claim marble for 'finisaj lucios tip marmura'", () => {
    const facts = extractFromText("Blat compozit cu finisaj lucios tip marmura.", dict);
    expect(facts.find((f) => f.k === "Material")).toBeUndefined();
  });

  it("still claims marble when another occurrence is unqualified", () => {
    const facts = extractFromText(
      "Blat cu aspect de marmura. Baza este din marmura veritabila.",
      dict,
    );
    expect(facts.find((f) => f.k === "Material")?.v).toBe("marmura");
  });

  it("does not break the Stil group ('stil contemporan' still matches)", () => {
    const facts = extractFromText("Design in stil contemporan pentru living.", dict);
    expect(facts.find((f) => f.k === "Stil")?.v).toBe("contemporan");
  });

  it("keeps honest materials untouched", () => {
    const facts = extractFromText("Cadru din lemn masiv si tapiterie din catifea.", dict);
    expect(facts.find((f) => f.k === "Material")?.v).toContain("lemn masiv");
  });
});

describe("appearance qualifiers in English", () => {
  const dict = "Material: marble, leather, oak, velvet";

  it("does not claim leather for 'faux leather'", () => {
    const facts = extractFromText("Upholstered in soft faux leather.", dict);
    expect(facts.find((f) => f.k === "Material")).toBeUndefined();
  });

  it("does not claim marble for 'marble effect' wording ('effect marble')", () => {
    const facts = extractFromText("Tabletop with an imitation marble finish.", dict);
    expect(facts.find((f) => f.k === "Material")).toBeUndefined();
  });

  it("still claims oak when stated plainly", () => {
    const facts = extractFromText("Frame made of solid oak with velvet seats.", dict);
    expect(facts.find((f) => f.k === "Material")?.v).toContain("oak");
  });
});

describe("appearance qualifiers after the term (English word order)", () => {
  const dict = "Material: marble, oak, leather\nStil: contemporan";

  it("does not claim marble for 'marble effect'", () => {
    const facts = extractFromText("Worktop with a marble effect surface.", dict);
    expect(facts.find((f) => f.k === "Material")).toBeUndefined();
  });

  it("does not claim oak for 'oak-look flooring'", () => {
    const facts = extractFromText("Durable oak-look flooring.", dict);
    expect(facts.find((f) => f.k === "Material")).toBeUndefined();
  });

  it("keeps 'oiled oak finish' as real oak", () => {
    const facts = extractFromText("Table with an oiled oak finish.", dict);
    expect(facts.find((f) => f.k === "Material")?.v).toBe("oak");
  });

  it("romanian 'stil contemporan' still unaffected by the after-guard", () => {
    const facts = extractFromText("Canapea in stil contemporan.", dict);
    expect(facts.find((f) => f.k === "Stil")?.v).toBe("contemporan");
  });
});

describe("cleanOutput symbol policy", () => {
  it("turns the multiplication sign into a plain x", () => {
    expect(cleanOutput("280 × 280 cm")).toBe("280 x 280 cm");
  });
});
