import { describe, expect, it } from "vitest";
import { buildSummary, buildQuestions, buildFitFor } from "../summary";

const base = {
  title: "Set Masa extensibila & 6 Scaune",
  descriptionHtml:
    "<p>Masa are blatul din PAL Laminat peste care s-a fixat sticla securizata de 4 mm.</p>",
  facts: [
    { k: "Material", v: "PAL, sticla securizata, inox" },
    { k: "Dimensiuni", v: "l 80, L 130, h 79 cm" },
    { k: "Capacitate", v: "6 scaune" },
    { k: "Camera", v: "living, bucatarie" },
  ],
  price: "1050.00",
  currency: "USD",
  available: true,
  vendor: "GlobalMobila",
};

describe("buildSummary", () => {
  const summary = buildSummary(base);

  it("opens with the merchant's own sentence, not an invented one", () => {
    expect(summary).toContain("Masa are blatul din PAL Laminat");
  });

  // Changed deliberately, 11 September 2026 (CC-PROMPT-AI-READABILITY-2 5c):
  // this test used to require the price in the sentence. The page and the
  // Product node's offers carry the live price; a price frozen into
  // generated text is wrong at the first sale.
  it("carries no price: the page and the offer state the live one", () => {
    expect(summary).not.toContain("1050.00");
    expect(summary).not.toMatch(/Priced at|USD/);
  });

  it("carries the comparable attributes", () => {
    expect(summary.toLowerCase()).toContain("material");
  });

  it("respects the word cap", () => {
    const long = buildSummary({ ...base, maxWords: 20 });
    expect(long.split(" ").length).toBeLessThanOrEqual(20);
  });

  it("still produces something when there is no description", () => {
    const bare = buildSummary({ ...base, descriptionHtml: "", facts: [] });
    expect(bare).toContain("Set Masa extensibila & 6 Scaune");
  });
});

describe("buildQuestions", () => {
  const qa = buildQuestions(base);

  it("answers what it is made of", () => {
    expect(qa.some((q) => /made of/i.test(q.q))).toBe(true);
  });

  // Changed deliberately with the summary test above: no price question.
  it("asks no price question", () => {
    expect(qa.some((q) => /cost|1050/i.test(`${q.q} ${q.a}`))).toBe(false);
  });

  it("never emits a question without an answer", () => {
    for (const item of qa) {
      expect(item.a.trim().length).toBeGreaterThan(1);
    }
  });

  it("emits nothing it cannot support", () => {
    const empty = buildQuestions({ ...base, facts: [], price: null });
    expect(empty).toEqual([]);
  });
});

describe("buildFitFor", () => {
  it("uses only suitability facts", () => {
    expect(buildFitFor(base)).toContain("living");
  });

  it("is empty when there is nothing honest to say", () => {
    expect(buildFitFor({ ...base, facts: [{ k: "Material", v: "PAL" }] })).toBe("");
  });
});
