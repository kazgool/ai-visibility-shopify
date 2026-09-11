import { describe, expect, it } from "vitest";
import { fieldsToWrite, liveQuestions, optionsOf, type LiveQuestionContext } from "../live-questions";

// CC-PROMPT-AI-READABILITY-4 item 4c: the live list is buildFaq with the
// sources that met the bar, and a product with no facts still gets its
// questions written.

const CTX: LiveQuestionContext = {
  business: { deliveryTime: "1-2 zile", returnDays: 14, paymentMethods: "card" },
  language: "ro",
  presetId: null,
  mappings: null,
  cap: null,
  shopName: "Republica BIO",
};

// A merchant question and a warnings section: the two sources left off.
const DESCRIPTION =
  "<p><strong>Ce contine?</strong></p><p>Pulbere de colagen.</p>" +
  "<p><strong>Atentionari</strong></p><p>A nu se lasa la indemana copiilor.</p>";

const PRODUCT = {
  title: "Colagen marin",
  descriptionHtml: DESCRIPTION,
  vendor: "Molecules of Youth",
  variants: [
    { selectedOptions: [{ name: "Gramaj", value: "105 g" }] },
    { selectedOptions: [{ name: "Gramaj", value: "210 g" }] },
  ],
};

describe("liveQuestions", () => {
  const qa = liveQuestions(PRODUCT, [], CTX);

  it("publishes no merchant question and no section question", () => {
    expect(qa.some((x) => /Ce contine/i.test(x.q))).toBe(false);
    expect(qa.some((x) => /precau/i.test(x.q))).toBe(false);
    expect(qa.some((x) => /indemana/.test(x.a))).toBe(false);
  });

  it("publishes the options, the brand that is not the shop's, and the business record", () => {
    expect(qa.some((x) => /105 g/.test(x.a) && /210 g/.test(x.a))).toBe(true);
    expect(qa.some((x) => x.a === "Molecules of Youth.")).toBe(true);
    expect(qa.some((x) => /14/.test(x.a))).toBe(true);
    expect(qa.some((x) => /card/.test(x.a))).toBe(true);
  });

  it("asks the business question the merchant's own left-off question would have suppressed", () => {
    const own = liveQuestions(
      { title: "Ceai", descriptionHtml: "<p><strong>Cum il platesti?</strong></p><p>Cu cardul.</p>" },
      [],
      CTX,
    );
    expect(own.some((x) => /card\./.test(x.a))).toBe(true);
  });

  it("carries q and a only", () => {
    for (const item of qa) expect(Object.keys(item).sort()).toEqual(["a", "q"]);
  });
});

describe("optionsOf", () => {
  it("groups the variants' options by name, each value once, in order", () => {
    expect(
      optionsOf([
        { selectedOptions: [{ name: "Culoare", value: "gri" }, { name: "Marime", value: "M" }] },
        { selectedOptions: [{ name: "Culoare", value: "bej" }, { name: "Marime", value: "M" }] },
      ]),
    ).toEqual([
      { name: "Culoare", values: ["gri", "bej"] },
      { name: "Marime", values: ["M"] },
    ]);
  });
});

describe("fieldsToWrite", () => {
  const fields = [
    { key: "summary", value: "Colagen." },
    { key: "questions", value: '[{"q":"?","a":"."}]' },
    { key: "fit_for", value: "" },
  ];

  it("writes every field for a product with facts, as before", () => {
    expect(fieldsToWrite(fields, { facts: 2, migrated: false, withdrawable: false })).toEqual(fields);
  });

  it("writes the questions alone for a product with no facts", () => {
    expect(fieldsToWrite(fields, { facts: 0, migrated: false, withdrawable: false })).toEqual([fields[1]]);
  });

  it("writes nothing for a product with no facts and no questions", () => {
    expect(fieldsToWrite([fields[0], { key: "questions", value: "" }], { facts: 0, migrated: false, withdrawable: false })).toBeNull();
  });

  it("writes every field when something of ours may need withdrawing", () => {
    expect(fieldsToWrite(fields, { facts: 0, migrated: false, withdrawable: true })).toEqual(fields);
  });
});
