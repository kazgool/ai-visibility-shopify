// 6 September 2026. Guards for the English function words added to
// CAPTURE_STOPS (extract.ts). They are consulted from the second captured
// word on, so the guard asserts exactly that and nothing more: a capture is
// cut short at one of them, and a capture that STARTS with one is not
// touched by this list. Reverting the extract.ts addition makes the first
// test fail; widening it to the first word would make the second one fail.

import { describe, expect, it } from "vitest";
import { extractFromText } from "../extract";
import { prepareText } from "../normalize";

function valuesOf(text: string, dictionary: string) {
  return Object.fromEntries(
    extractFromText(prepareText("", text), dictionary).map((f) => [f.k, f.v]),
  );
}

describe("CAPTURE_STOPS, English function words", () => {
  it("cuts a capture short at a determiner or pronoun in position two or three", () => {
    expect(
      valuesOf("contains magnesium your body needs", "Active ingredient: contains *"),
    ).toEqual({ "Active ingredient": "contains magnesium" });
    expect(valuesOf("lobster clasp so you know", "Closure: clasp *")).toEqual({
      Closure: "clasp so",
    });
  });

  it("does not drop a capture that starts with one of them", () => {
    // The first captured word is checked against the stopword set, not
    // against CAPTURE_STOPS. That is what an open "with *" wildcard on prose
    // does, and it is a property of the wildcard, not of this list.
    expect(
      valuesOf("check with your own doctor", "Active ingredient: with *"),
    ).toEqual({ "Active ingredient": "with your own doctor" });
  });

  // No Romanian case here on purpose: "an" (year) is trimmed by the
  // stopword list in every trailing position already, so a unit test cannot
  // tell the two lists apart. The evidence that Romanian is untouched is the
  // 355-product furniture catalogue extracting identically with and without
  // the addition (scripts/test-catalog-gap.ts, 6 September 2026).
});

describe("one measurement, one spelling", () => {
  it("does not list a glued and a spaced form of the same value twice", () => {
    // jewelry's Size line carries both #size and "* cm"; with glued
    // integers now read by "* cm", both matched "45cm" and the group listed
    // "45cm, 45 cm". Same digits, same unit, one fact.
    expect(valuesOf("Chain 45cm long, 8mm pearl.", "Size: #size, * cm, * mm")).toEqual({
      Size: "45cm, 8mm",
    });
    expect(valuesOf("Tube 50 ml, 30 g.", "Volume: #size, * ml, * g")).toEqual({
      Volume: "50 ml, 30 g",
    });
  });
});
