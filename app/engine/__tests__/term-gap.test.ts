import { describe, expect, it } from "vitest";
import { computeTermGap, extractTerms, type TermGapProduct } from "../term-gap";
import { stopwordSet } from "../stopwords";

const stopwords = stopwordSet();

describe("computeTermGap", () => {
  it("surfaces a term that appears in a description only", () => {
    const products: TermGapProduct[] = [
      {
        id: "1",
        title: "Dining Chair",
        descriptionHtml: "<p>Upholstered in soft bumbac fabric for everyday comfort.</p>",
        seoTitle: null,
        seoDescription: null,
      },
    ];
    const rows = computeTermGap(products, stopwords);
    expect(rows.find((r) => r.term === "bumbac")).toEqual({ term: "bumbac", productCount: 1 });
  });

  it("excludes a term that already appears in a title", () => {
    const products: TermGapProduct[] = [
      {
        id: "1",
        title: "Stejar Dining Table",
        descriptionHtml: "<p>Solid stejar construction throughout.</p>",
        seoTitle: null,
        seoDescription: null,
      },
    ];
    const rows = computeTermGap(products, stopwords);
    expect(rows.find((r) => r.term === "stejar")).toBeUndefined();
  });

  it("excludes a term that only appears in a meta field", () => {
    const products: TermGapProduct[] = [
      {
        id: "1",
        title: "Bedroom Set",
        descriptionHtml: "<p>Finished in warm lemn tones for a natural look.</p>",
        seoTitle: null,
        seoDescription: "A bedroom set finished in lemn tones.",
      },
    ];
    const rows = computeTermGap(products, stopwords);
    expect(rows.find((r) => r.term === "lemn")).toBeUndefined();
  });

  it("never returns a stopword as its own term", () => {
    const products: TermGapProduct[] = [
      {
        id: "1",
        title: "Sofa",
        descriptionHtml:
          "<p>Pentru pentru pentru living si dining si living, cu foarte mult confort.</p>",
        seoTitle: null,
        seoDescription: null,
      },
    ];
    const rows = computeTermGap(products, stopwords);
    expect(rows.find((r) => r.term === "pentru")).toBeUndefined();
    expect(rows.find((r) => r.term === "si")).toBeUndefined();
    expect(rows.find((r) => r.term === "cu")).toBeUndefined();
  });

  it("returns nothing for an empty catalogue", () => {
    expect(computeTermGap([], stopwords)).toEqual([]);
  });

  it("keeps a two-word phrase even when the first word is a stopword", () => {
    const products: TermGapProduct[] = [
      {
        id: "1",
        title: "Chocolate Cake",
        descriptionHtml: "<p>Baked fara gluten, using almond flour only.</p>",
        seoTitle: null,
        seoDescription: null,
      },
    ];
    const terms = extractTerms("Baked fara gluten, using almond flour only.", stopwords);
    expect(terms.has("fara gluten")).toBe(true);

    const rows = computeTermGap(products, stopwords);
    expect(rows.some((r) => r.term === "fara gluten")).toBe(true);
  });

  it("ranks terms by how many products use them, most first", () => {
    const products: TermGapProduct[] = [
      { id: "1", title: "A", descriptionHtml: "<p>Rare material zebrano here.</p>" },
      { id: "2", title: "B", descriptionHtml: "<p>Common material walnut here.</p>" },
      { id: "3", title: "C", descriptionHtml: "<p>Common material walnut too.</p>" },
    ];
    const rows = computeTermGap(products, stopwords, { limit: 20 });
    const walnutIndex = rows.findIndex((r) => r.term === "walnut");
    const zebranoIndex = rows.findIndex((r) => r.term === "zebrano");
    expect(walnutIndex).toBeGreaterThanOrEqual(0);
    expect(zebranoIndex).toBeGreaterThan(walnutIndex);
  });
});
