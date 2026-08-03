import { describe, expect, it } from "vitest";
import { buildAnswerPreview } from "../answer";

const facts = [
  { k: "Material", v: "lemn masiv, catifea" },
  { k: "Dimensiuni", v: "280 x 280 cm" },
  { k: "Culoare", v: "negru" },
];

describe("buildAnswerPreview", () => {
  it("builds the answer only from published values, and names them", () => {
    const p = buildAnswerPreview({
      title: "Coltar Chesterfield Negru",
      facts,
      summary: "Coltar extensibil cu lada de depozitare.",
      questions: [{ q: "Can I return it?", a: "Yes, within 14 days." }],
      price: "4700.0",
      currency: "USD",
    })!;
    expect(p.withApp).toContain("Coltar extensibil");
    expect(p.withApp).toContain("Yes, within 14 days.");
    expect(p.sources).toContain("summary");
    expect(p.sources).toContain("questions");
  });

  it("states plainly what an assistant has without the app", () => {
    const p = buildAnswerPreview({ title: "Masa", facts, price: "2990", currency: "USD" })!;
    expect(p.withoutApp).toContain("2990 USD");
    expect(p.withoutApp).toContain("No stated material");
  });

  it("returns nothing when nothing is published - no fake demo", () => {
    expect(buildAnswerPreview({ title: "Masa", facts: [] })).toBeNull();
  });

  it("cleans entities so the preview never shows &amp;", () => {
    const p = buildAnswerPreview({
      title: "Set Masa &amp; 6 Scaune",
      facts,
      summary: "Set complet.",
    })!;
    expect(p.question).toContain("Set Masa & 6 Scaune");
    expect(p.withoutApp).not.toContain("&amp;");
  });

  it("asks the comparison question when a material is known", () => {
    const p = buildAnswerPreview({ title: "Masa", facts })!;
    expect(p.question).toContain("made of");
  });
});

describe("answer preview does not repeat itself", () => {
  it("skips a question whose answer the summary already states", () => {
    const p = buildAnswerPreview({
      title: "Masa",
      facts: [{ k: "Dimensiuni", v: "160 cm, 85 cm, 74 cm" }],
      summary: "Masa fixa ovala. Key details: dimensiuni: 160 cm, 85 cm, 74 cm.",
      questions: [{ q: "What are the dimensions?", a: "160 cm, 85 cm, 74 cm." }],
    })!;
    const occurrences = p.withApp.split("160 cm, 85 cm, 74 cm").length - 1;
    expect(occurrences).toBe(1);
    expect(p.sources).not.toContain("questions");
  });

  it("still adds a question that says something new", () => {
    const p = buildAnswerPreview({
      title: "Masa",
      facts: [{ k: "Material", v: "stejar" }],
      summary: "Masa din stejar masiv.",
      questions: [{ q: "Can I return it?", a: "Yes, within 14 days." }],
    })!;
    expect(p.withApp).toContain("Yes, within 14 days.");
    expect(p.sources).toContain("questions");
  });
});
