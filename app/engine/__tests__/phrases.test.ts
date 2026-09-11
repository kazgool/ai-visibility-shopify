import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_QUESTIONS, buildQuestions, buildSummary, warrantyWithUnit } from "../summary";
import { buildCollectionCapsule } from "../collection";
import { buildMetaDescription } from "../meta";
import { cleanOutput } from "../normalize";
import { LANGUAGES, PHRASES, isMaterialQuestion, roCount } from "../phrases";
import { renderMirror } from "../../services/mirror.server";

// CC-PROMPT-AI-READABILITY-2 item 5: every fixed phrase in phrases.ts, in
// English and Romanian; the price out of the generated text; questions from
// the merchant's own labels.

const ENGINE = path.resolve(__dirname, "..");
const MIRROR = path.resolve(__dirname, "../../services/mirror.server.ts");

/** Source without its comments: a comment may quote an old phrase, code may not. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// The English sentences the engine and the mirror used to write inline.
const OLD_PHRASES = [
  "Key details", "Priced at", " is a ", "made of", "What are the dimensions",
  "How many people", "include or seat", "How much does", "Where is ",
  "How long does delivery", "Delivery costs", "Can I return", "Yes, within",
  // The warranty unit as the old code wrote it; a bare " months" also matches
  // dictionary terms ("* months"), which are data, not sentences.
  "What warranty", "How can I pay", ' months`', '"1 month"', "They differ by",
  "How many products", "options are there", "Tell me about", "No stated material",
  "## Description", "## Questions", "## Who it suits", "## Buying it", "## Part of",
  "## Store", "| Attribute | Value |", "Source: ",
];

describe("one phrase table", () => {
  it("no engine source, and not the mirror renderer, writes a sentence outside phrases.ts", () => {
    const files = [
      ...fs
        .readdirSync(ENGINE)
        .filter((f) => f.endsWith(".ts") && f !== "phrases.ts")
        .map((f) => path.join(ENGINE, f)),
      MIRROR,
    ];
    const found: string[] = [];
    for (const file of files) {
      const src = code(file);
      for (const phrase of OLD_PHRASES) {
        if (src.includes(phrase)) found.push(`${path.basename(file)}: ${phrase}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("has the same entries in every language", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(PHRASES.ro)).toEqual(keys(PHRASES.en));
    expect(keys(PHRASES.ro.mirror)).toEqual(keys(PHRASES.en.mirror));
  });

  it("writes plain characters only, in both languages", () => {
    for (const language of LANGUAGES) {
      const p = PHRASES[language];
      const samples = [
        p.isA("T", "type"), p.isAProduct("T"), p.keyDetails("a: b"),
        p.qMaterial("T"), p.qDimensions("T"), p.qSeats("T"), p.qIncludes("T"),
        p.qIncludesOrSeats("T"), p.qRoom("T"),
        p.qSafety("T"), p.qUsage("T"), p.qComposition("T"), p.qStorage("T"), p.qCare("T"),
        p.qCompatibility("T"), p.qSuitability("T"), p.qBenefits("T"), p.qFinish("T"),
        p.qOptions("T"), p.qVendor("T"),
        p.qDelivery("T"), p.aDelivery("1-2", "15 RON", true), p.aDelivery("1-2", null, false),
        p.qReturns("T"), p.aReturns(14), p.qWarranty("T"), p.months(24), p.qPayment(),
        p.collectionCount("T", 25), p.collectionDiffer("a: b"), p.andMore("a, b", 3),
        p.qCollectionCount("T"), p.aCollectionCount(1), p.qCollectionOptions("label", "T"),
        ...Object.values(p.mirror).map((v) => (typeof v === "function" ? v("x" as never) : v)),
      ];
      for (const text of samples) {
        expect(text, `${language}: ${text}`).not.toMatch(/[–—‘’“”…]|&#?\w+;/);
        expect(cleanOutput(text)).toBe(text);
      }
    }
  });
});

describe("Romanian", () => {
  it("cleanOutput keeps the standard diacritics", () => {
    expect(cleanOutput("ă â î ș ț Ă Â Î Ș Ț")).toBe("ă â î ș ț Ă Â Î Ș Ț");
    expect(cleanOutput("În cât timp se livrează?")).toBe("În cât timp se livrează?");
  });

  it("counts the Romanian way: 1 zi, 14 zile, 20 de zile, 101 zile, 120 de zile", () => {
    expect(roCount(1, "zi", "zile")).toBe("1 zi");
    expect(roCount(14, "zi", "zile")).toBe("14 zile");
    expect(roCount(19, "zi", "zile")).toBe("19 zile");
    expect(roCount(20, "zi", "zile")).toBe("20 de zile");
    expect(roCount(30, "zi", "zile")).toBe("30 de zile");
    expect(roCount(101, "zi", "zile")).toBe("101 zile");
    expect(roCount(120, "zi", "zile")).toBe("120 de zile");
  });

  it("states a bare warranty number in months, in the content language", () => {
    expect(warrantyWithUnit("24")).toBe("24 months");
    expect(warrantyWithUnit("1")).toBe("1 month");
    expect(warrantyWithUnit("24", "ro")).toBe("24 de luni");
    expect(warrantyWithUnit("12", "ro")).toBe("12 luni");
    expect(warrantyWithUnit("1", "ro")).toBe("1 lună");
    expect(warrantyWithUnit("2 ani", "ro")).toBe("2 ani");
  });
});

// A Republica BIO product, as the engine reads it.
const ASHWAGANDHA = {
  title: "Ashwagandha Ecologica din India (400 mg), 60 capsule",
  descriptionHtml: "<p>Supliment alimentar ecologic, pe baza de extract din radacina de Ashwagandha.</p>",
  facts: [
    { k: "Forma", v: "capsule" },
    { k: "Gramaj", v: "29,7 g" },
    { k: "Utilizare", v: "3 capsule zilnic" },
    { k: "Ingrediente", v: "radacina de ashwagandha" },
  ],
  price: "81.01",
  currency: "RON",
  vendor: "Republica BIO",
  business: {
    deliveryTime: "1-2",
    deliveryCost: "15 RON",
    returnDays: 14,
    paymentMethods: "Card bancar; Ramburs",
  },
};

describe("the product text in the content language", () => {
  it("writes the summary in Romanian, with no English connective and no price", () => {
    const summary = buildSummary({ ...ASHWAGANDHA, language: "ro" });
    expect(summary).toContain("Detalii principale: forma: capsule");
    expect(summary).not.toMatch(/Key details|Priced|81\.01|RON/);
  });

  it("falls back to a Romanian sentence when there is no description", () => {
    expect(buildSummary({ ...ASHWAGANDHA, descriptionHtml: "", facts: [], language: "ro" })).toBe(
      "Ashwagandha Ecologica din India (400 mg), 60 capsule este un produs.",
    );
    expect(
      buildSummary({ ...ASHWAGANDHA, descriptionHtml: "", facts: [], productType: "Supliment", language: "ro" }),
    ).toBe("Ashwagandha Ecologica din India (400 mg), 60 capsule face parte din categoria Supliment.");
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 item 2: the generic
  // "Ce {label} are X?" template is gone, so a label with no template of its
  // own asks nothing and the business questions follow the specific ones.
  it("asks nothing from a merchant's label that has no template of its own", () => {
    const qa = buildQuestions({ ...ASHWAGANDHA, language: "ro" });
    const t = ASHWAGANDHA.title;
    expect(qa).toEqual([
      { q: `În cât timp se livrează ${t}?`, a: "1-2. Livrarea costă 15 RON." },
      { q: `Pot returna ${t}?`, a: "Da, în termen de 14 zile." },
      { q: "Cum pot plăti?", a: "Card bancar; Ramburs." },
    ]);
    expect(qa.length).toBeLessThanOrEqual(MAX_QUESTIONS);
  });

  it("asks nothing of an instruction value either", () => {
    const qa = buildQuestions({
      title: "Cacao",
      facts: [{ k: "Sugestie", v: "adauga in smoothie" }, { k: "Forma", v: "pudra" }],
      language: "ro",
    });
    expect(qa).toEqual([]);
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 item 2: the label-specific
  // templates were outside the judge's 1% bar (dimensions about 26% wrong on
  // the furniture stores, material about 10%), so only business is asked.
  it("asks no label question, only business", () => {
    const qa = buildQuestions({
      title: "Masa",
      facts: [
        { k: "Stil", v: "modern" },
        { k: "Culoare", v: "negru" },
        { k: "Material", v: "MDF" },
        { k: "Dimensiuni", v: "160 cm" },
        { k: "Finisaj", v: "lucios" },
        { k: "Forma", v: "ovala" },
        { k: "Picioare", v: "metal" },
      ],
      business: { returnDays: 14 },
      language: "en",
    });
    expect(qa.map((x) => x.q)).toEqual(["Can I return Masa?"]);
  });

  it("asks no price question in either language", () => {
    for (const language of LANGUAGES) {
      const text = buildQuestions({ ...ASHWAGANDHA, language })
        .map((x) => `${x.q} ${x.a}`)
        .join(" ");
      expect(text).not.toMatch(/81\.01|cost\?|Cât costă/);
    }
  });

  it("keeps English exactly as it was when no language is given", () => {
    const qa = buildQuestions({ title: "Coltar", facts: [], business: { returnDays: 14 } });
    expect(qa).toEqual([{ q: "Can I return Coltar?", a: "Yes, within 14 days." }]);
  });

  it("recognises the material question in either language", () => {
    expect(isMaterialQuestion("What is Masa made of?")).toBe(true);
    expect(isMaterialQuestion("Ce material are Masa?")).toBe(true);
    expect(isMaterialQuestion("Ce gramaj are Masa?")).toBe(false);
  });
});

describe("the other writers in the content language", () => {
  it("the meta description's connective", () => {
    expect(buildMetaDescription({ ...ASHWAGANDHA, language: "ro" })).toContain("Detalii principale:");
  });

  it("the collection capsule, with Romanian counts", () => {
    const products = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      title: `Produs ${i}`,
      facts: [{ k: "Forma", v: i % 2 ? "capsule" : "pudra" }],
    }));
    const capsule = buildCollectionCapsule({ title: "Suplimente", products, language: "ro" });
    expect(capsule.summary).toContain("Suplimente are 25 de produse.");
    expect(capsule.summary).toContain("Diferă prin forma: pudra, capsule.");
    expect(capsule.questions[0]).toEqual({ q: "Câte produse sunt în Suplimente?", a: "25 de produse." });
    expect(capsule.questions[1].q).toBe("Ce variante de forma există în Suplimente?");
  });

  it("the plain text mirror's headings and rows", () => {
    const out = renderMirror({
      handle: "a",
      title: "Ashwagandha",
      url: "https://republicabio.ro/products/a",
      facts: [{ k: "Forma", v: "capsule" }],
      questions: [{ q: "Ce forma are Ashwagandha?", a: "capsule." }],
      business: { returnDays: 14, warranty: "24" },
      language: "ro",
    });
    for (const text of ["| Atribut | Valoare |", "## Întrebări", "## Cumpărare", "| Retur | 14 zile |", "| Garanție | 24 de luni |", "Sursă: https://republicabio.ro/products/a"]) {
      expect(out).toContain(text);
    }
    expect(out).not.toMatch(/## Questions|## Buying it|Source:/);
  });
});
