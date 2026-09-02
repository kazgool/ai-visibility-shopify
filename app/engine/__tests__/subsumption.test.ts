// A longer hit normally wins: "Chantilly lace" beats "lace". Truncating a
// prefix capture at a connector (E4) revived the connector-led prose form of a
// value - "with retinol" - which is longer than the plain term it duplicates
// and so subsumed it. The value the merchant would recognise is the short one,
// and on a term like "iOS" the long one also loses the capitals.

import { describe, expect, it } from "vitest";
import { extractFromText } from "../extract";
import { prepareText } from "../normalize";

function valuesOf(text: string, dictionary: string) {
  return Object.fromEntries(
    extractFromText(prepareText("", text), dictionary).map((f) => [f.k, f.v]),
  );
}

describe("connector-led captures lose to the plain term", () => {
  it("keeps retinol over with retinol", () => {
    const values = valuesOf(
      "Ulei de fata with retinol and ceramides",
      "Key ingredients: with *, retinol, ceramides",
    );
    expect(values["Key ingredients"]).toBe("retinol, ceramides");
  });

  it("keeps salmon over contains salmon", () => {
    const values = valuesOf("Dry food, contains salmon.", "Contents: contains *, salmon");
    expect(values.Contents).toBe("salmon");
  });

  it("keeps the plain term's capitals", () => {
    const values = valuesOf(
      "Fitness tracker, compatible with iOS.",
      "Compatibility: compatible with *, iOS",
    );
    expect(values.Compatibility).toBe("iOS");
  });

  it("a longer hit that is not merely connector-led still wins", () => {
    const values = valuesOf("Chantilly lace trim", "Material: lace, chantilly lace");
    expect(values.Material).toBe("chantilly lace");
  });
});
