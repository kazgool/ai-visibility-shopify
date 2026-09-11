import { describe, expect, it } from "vitest";
import {
  ALL_FAQ_SOURCES,
  FAQ_MERCHANT_QUESTIONS_LIVE,
  FAQ_SECTION_INTENTS_LIVE,
  buildFaq,
  liveFaqSources,
  type FaqInput,
} from "../faq";

// CC-PROMPT-AI-READABILITY-4 item 4c: buildFaq publishes only the sources it
// is asked for, and a source left out changes nothing about the others.

const base = (over: Partial<FaqInput>): FaqInput => ({ title: "Colagen marin", facts: [], language: "ro", ...over });

const DESCRIPTION =
  "<p><strong>Cum il platesti?</strong></p><p>Cu cardul sau ramburs.</p>" +
  "<h3>Atentionari</h3><p>A nu se lasa la indemana copiilor.</p>";

describe("buildFaq sources", () => {
  it("publishes every source when none is named, as the corpus runs ask", () => {
    const sources = new Set(
      buildFaq(base({ descriptionHtml: DESCRIPTION, business: { paymentMethods: "card" } })).map((x) => x.source),
    );
    expect(sources.has("merchant")).toBe(true);
    expect(sources.has("section")).toBe(true);
  });

  it("publishes only the named sources", () => {
    const faq = buildFaq(base({ descriptionHtml: DESCRIPTION, business: { paymentMethods: "card" }, sources: ["business"] }));
    expect(faq.map((x) => x.source)).toEqual(["business"]);
  });

  it("does not let a left-out merchant question suppress the business question it matches", () => {
    const all = buildFaq(base({ descriptionHtml: DESCRIPTION, business: { paymentMethods: "card" } }));
    expect(all.some((x) => x.source === "business")).toBe(false);
    const live = buildFaq(base({ descriptionHtml: DESCRIPTION, business: { paymentMethods: "card" }, sources: ["business"] }));
    expect(live).toEqual([expect.objectContaining({ source: "business", a: "card." })]);
  });

  it("does not let a left-out source take an answer a kept one gives", () => {
    // The option answer and a merchant answer could read the same; with the
    // merchant left out, the option's question stays.
    const faq = buildFaq(
      base({
        descriptionHtml: "<p><strong>In ce marimi?</strong></p><p>Gramaj: 105 g, 210 g.</p>",
        options: [{ name: "Gramaj", values: ["105 g", "210 g"] }],
        sources: ["variants"],
      }),
    );
    expect(faq.map((x) => x.source)).toEqual(["variants"]);
  });

  it("counts toward the cap only what it publishes", () => {
    const many = Array.from({ length: 12 }, (_, i) => `<h3>Intrebarea ${i}?</h3><p>Raspuns ${i}.</p>`).join("");
    const faq = buildFaq(base({ descriptionHtml: many, business: { paymentMethods: "card", returnDays: 14 }, sources: ["business"] }));
    expect(faq.map((x) => x.source)).toEqual(["business", "business"]);
  });
});

describe("the live list", () => {
  it("leaves section intents and merchant questions off, each behind its own switch", () => {
    expect(FAQ_SECTION_INTENTS_LIVE).toBe(false);
    expect(FAQ_MERCHANT_QUESTIONS_LIVE).toBe(false);
    expect(liveFaqSources()).toEqual(["mapping", "preset", "variants", "vendor", "business"]);
  });

  it("names only sources buildFaq knows", () => {
    for (const source of liveFaqSources()) expect(ALL_FAQ_SOURCES).toContain(source);
  });
});
