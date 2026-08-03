import { describe, expect, it } from "vitest";
import { buildAltText, looksLikeFilename, ALT_MAX_CHARS } from "../alt-text";

const facts = [
  { k: "Material", v: "lemn masiv, catifea" },
  { k: "Culoare", v: "negru" },
  { k: "Dimensiuni", v: "280 x 280 cm" },
  { k: "Camera", v: "living" },
];

describe("looksLikeFilename", () => {
  it("recognises camera filenames", () => {
    expect(looksLikeFilename("DSC_4471")).toBe(true);
    expect(looksLikeFilename("IMG-2043.jpg")).toBe(true);
    expect(looksLikeFilename("image_123650291")).toBe(true);
    expect(looksLikeFilename("")).toBe(true);
  });

  it("recognises UUIDs and migration identifiers", () => {
    expect(looksLikeFilename("B6ADC692-C01B-4229-8956-100A9AFB8C46")).toBe(true);
    expect(looksLikeFilename("3ba7dee8f7bd4e1496cf6e31548bbe11")).toBe(true);
  });

  it("leaves real descriptions alone", () => {
    expect(looksLikeFilename("Coltar Chesterfield negru din catifea")).toBe(false);
    expect(looksLikeFilename("Masa extensibila 160 cm")).toBe(false);
  });
});

describe("imported catalogues", () => {
  it("decodes HTML entities in the title", () => {
    const alt = buildAltText(
      { title: "Set Masa &#038; 6 Scaune &#8211; Beige", productType: null },
      [],
      0,
    );
    expect(alt).toBe("Set Masa & 6 Scaune - Beige");
    expect(alt).not.toContain("&#");
  });

  it("never puts an identifier in the description", () => {
    const polluted = [{ k: "Material", v: "B6ADC692-C01B-4229-8956-100A9AFB8C46" }];
    const alt = buildAltText({ title: "Set Masa", productType: null }, polluted, 0);
    expect(alt).not.toContain("B6ADC692");
  });
});

describe("buildAltText", () => {
  const product = { title: "Coltar Chesterfield Negru", productType: "Coltar" };

  it("describes what the picture shows, not the whole catalogue entry", () => {
    const alt = buildAltText(product, facts, 0);
    expect(alt).toContain("Coltar Chesterfield Negru");
    expect(alt.toLowerCase()).toContain("lemn masiv");
  });

  it("never exceeds the character cap", () => {
    const long = [{ k: "Material", v: "x".repeat(300) }];
    expect(buildAltText(product, long, 0).length).toBeLessThanOrEqual(ALT_MAX_CHARS);
  });

  it("gives gallery images distinct text", () => {
    const first = buildAltText(product, facts, 0);
    const third = buildAltText(product, facts, 2);
    expect(first).not.toBe(third);
  });

  it("ignores attributes that say nothing about the image", () => {
    const alt = buildAltText(product, [{ k: "Warranty", v: "2 years" }], 0);
    expect(alt).not.toContain("2 years");
  });

  it("falls back to the title when nothing is visual", () => {
    expect(buildAltText(product, [], 0)).toBe("Coltar Chesterfield Negru");
  });
});
