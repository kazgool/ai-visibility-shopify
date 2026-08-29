import { describe, expect, it } from "vitest";
import { checkCitationReadiness, isDescriptiveHandle } from "../citation";

describe("checkCitationReadiness", () => {
  it("scores good when the title shares wording with the questions and the handle is descriptive", () => {
    const result = checkCitationReadiness({
      title: "Solid Oak Dining Table",
      handle: "solid-oak-dining-table",
      summaryOpening: "A sturdy table for everyday use.",
      questions: [
        { q: "What is the Solid Oak Dining Table made of?", a: "Oak." },
        { q: "What are the dimensions of the Solid Oak Dining Table?", a: "140x80 cm." },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.titleScore).toBeGreaterThanOrEqual(0.4);
    expect(result!.handleIsDescriptive).toBe(true);
    expect(result!.verdict).toBe("good");
  });

  it("scores weak when the title shares nothing with the questions", () => {
    const result = checkCitationReadiness({
      title: "Modern Sofa",
      handle: "modern-sofa",
      summaryOpening: "A comfortable seat for the living room.",
      questions: [
        { q: "What are the dimensions of the Wooden Dining Table?", a: "140x80 cm." },
        { q: "What is the Wooden Dining Table made of?", a: "Oak." },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.titleScore).toBe(0);
    expect(result!.verdict).toBe("weak");
  });

  it("returns null when the product has no generated questions", () => {
    const result = checkCitationReadiness({
      title: "Solid Oak Dining Table",
      handle: "solid-oak-dining-table",
      summaryOpening: "A sturdy table.",
      questions: [],
    });

    expect(result).toBeNull();
  });

  it("downgrades an otherwise good result when the handle is opaque", () => {
    const good = checkCitationReadiness({
      title: "Solid Oak Dining Table",
      handle: "solid-oak-dining-table",
      summaryOpening: "A sturdy table.",
      questions: [
        { q: "What is the Solid Oak Dining Table made of?", a: "Oak." },
        { q: "What are the dimensions of the Solid Oak Dining Table?", a: "140x80 cm." },
      ],
    });
    const opaqueHandle = checkCitationReadiness({
      title: "Solid Oak Dining Table",
      handle: "142857",
      summaryOpening: "A sturdy table.",
      questions: [
        { q: "What is the Solid Oak Dining Table made of?", a: "Oak." },
        { q: "What are the dimensions of the Solid Oak Dining Table?", a: "140x80 cm." },
      ],
    });

    expect(good!.verdict).toBe("good");
    expect(opaqueHandle!.handleIsDescriptive).toBe(false);
    expect(opaqueHandle!.titleScore).toBe(good!.titleScore);
    expect(opaqueHandle!.verdict).toBe("partial");
  });

  it("matches words across diacritics", () => {
    const result = checkCitationReadiness({
      title: "Masa din stejar",
      handle: "masa-din-stejar",
      summaryOpening: "O masa eleganta pentru living.",
      questions: [{ q: "Din ce este facuta masa?", a: "Stejar." }],
    });

    expect(result).not.toBeNull();
    expect(result!.titleScore).toBeGreaterThan(0);
  });

  it("still matches when the title carries diacritics and the questions do not", () => {
    const result = checkCitationReadiness({
      title: "Masa din stejar masiv",
      handle: "masa-din-stejar-masiv",
      summaryOpening: "O piesa eleganta.",
      questions: [{ q: "Din ce este facuta masa din stejar?", a: "Stejar masiv." }],
    });

    expect(result).not.toBeNull();
    expect(result!.titleScore).toBeGreaterThanOrEqual(0.4);
  });
});

describe("isDescriptiveHandle", () => {
  it("accepts hyphen-separated words", () => {
    expect(isDescriptiveHandle("solid-oak-dining-table")).toBe(true);
  });

  it("accepts a single plain word", () => {
    expect(isDescriptiveHandle("table")).toBe(true);
  });

  it("rejects a bare number", () => {
    expect(isDescriptiveHandle("142857")).toBe(false);
  });

  it("rejects an opaque alphanumeric identifier", () => {
    expect(isDescriptiveHandle("a1b2c3d4e5f6g7")).toBe(false);
  });

  it("rejects an empty handle", () => {
    expect(isDescriptiveHandle("")).toBe(false);
  });
});
