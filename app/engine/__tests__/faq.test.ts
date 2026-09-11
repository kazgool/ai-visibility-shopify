import { describe, expect, it } from "vitest";
import {
  buildFaq,
  classifyHeading,
  descriptionOutline,
  joinAnswer,
  parseBlocks,
  validateFaqQuestion,
  DEFAULT_FAQ_CAP,
  type FaqInput,
} from "../faq";

// CC-PROMPT-AI-READABILITY-3 item 2. Each test states a rule of the engine,
// not a store: the fixtures are written for the rule, in both languages.

const base = (over: Partial<FaqInput>): FaqInput => ({ title: "Masa Oslo", facts: [], ...over });
const qs = (input: FaqInput) => buildFaq(input).map((x) => x.q);

describe("merchant questions", () => {
  it("takes a question heading as written and the text under it as the answer", () => {
    const faq = buildFaq(
      base({
        descriptionHtml: "<h3>Is BookArc compatible with the 15-inch MacBook Air?</h3><p>Yes, with Insert I, which ships free.</p>",
        language: "en",
      }),
    );
    expect(faq).toEqual([
      expect.objectContaining({
        q: "Is BookArc compatible with the 15-inch MacBook Air?",
        a: "Yes, with Insert I, which ships free.",
        source: "merchant",
        intent: "compatibility",
      }),
    ]);
  });

  it("drops a question put to the reader: that is marketing", () => {
    expect(qs(base({ descriptionHtml: "<h4>What are you waiting for?</h4><p>Matching tee sold separately.</p>" }))).toEqual([]);
    expect(qs(base({ descriptionHtml: "<p><b>De ce te-ai opri acum?</b></p><p>Oferta e limitata.</p>", language: "ro" }))).toEqual([]);
  });

  it("drops a question longer than twenty words", () => {
    const long = "At least I have iodine on my wounds and crutches left to use but what about all of those that do not have any?";
    expect(qs(base({ descriptionHtml: `<p><b>${long}</b></p><p>Text.</p>` }))).toEqual([]);
  });
});

describe("description sections", () => {
  it("classifies headings from the corpus lists, in either language", () => {
    expect(classifyHeading("Warnings")).toBe("safety");
    expect(classifyHeading("Atentionari")).toBe("safety");
    expect(classifyHeading("Cum sa-l folosesti")).toBe("usage");
    expect(classifyHeading("Ingredients per serving")).toBe("composition");
    expect(classifyHeading("Conditii de pastrare")).toBe("storage");
    expect(classifyHeading("Dimensiuni exterioare")).toBe("dimensions");
    expect(classifyHeading("Kit Includes")).toBe("contents");
    expect(classifyHeading("Ideal pentru")).toBe("suitability");
    expect(classifyHeading("Why It's Special")).toBe("benefits");
    expect(classifyHeading("Product details")).toBeNull();
    // A long label describes; it does not name a section.
    expect(classifyHeading("Forma convenabila si usoara de utilizare pentru toti")).toBeNull();
  });

  it("asks the intent's question in the content language", () => {
    const html = "<h2>Ingrediente</h2><p>Faina de ovaz, miere.</p>";
    expect(qs(base({ descriptionHtml: html, language: "ro" }))).toEqual(["Ce conține Masa Oslo?"]);
    expect(qs(base({ descriptionHtml: html, language: "en" }))).toEqual(["What does Masa Oslo contain?"]);
  });

  it("produces nothing for a heading that names no intent", () => {
    expect(buildFaq(base({ descriptionHtml: "<h3>Product details</h3><p>Handmade in Cluj.</p>" }))).toEqual([]);
  });

  it("reads a heading that is a sentence as a boundary, not a label", () => {
    const html = "<h4>Warning: may cause dangerously productive behavior.</h4><p>A soft cotton tee.</p>";
    expect(buildFaq(base({ descriptionHtml: html }))).toEqual([]);
    expect(parseBlocks(html)[0].label).toBeUndefined();
  });

  it("splits a warning out of the usage section it sits in, and puts it first", () => {
    const html =
      "<p><strong>Cum sa-l folosesti:</strong></p><ul>" +
      "<li><strong>Mod de utilizare</strong>: se consuma 2 capsule zilnic.</li>" +
      "<li><strong>Atentionari</strong>: A nu se consuma de catre copii.</li>" +
      "<li><strong>Conditii de pastrare</strong>: A se pastra la loc uscat.</li></ul>";
    const faq = buildFaq(base({ title: "Maca", descriptionHtml: html, language: "ro" }));
    expect(faq.map((x) => [x.intent, x.a])).toEqual([
      ["safety", "A nu se consuma de catre copii."],
      ["usage", "Mod de utilizare: se consuma 2 capsule zilnic."],
      ["storage", "A se pastra la loc uscat."],
    ]);
  });

  it("keeps a long bold lead inside its parent list", () => {
    const html =
      "<p><strong>Beneficii cheie:</strong></p><ul>" +
      "<li><strong>Forma convenabila si usoara de utilizare</strong>: capsule usor de inghitit.</li>" +
      "<li><strong>Energie</strong>: sustine vitalitatea.</li></ul>";
    const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
    expect(faq).toHaveLength(1);
    expect(faq[0].intent).toBe("benefits");
    expect(faq[0].a).toContain("Forma convenabila si usoara de utilizare: capsule usor de inghitit.");
  });

  it("gives a label followed by <br> only the rest of its paragraph", () => {
    const html =
      "<p><strong>Kit Includes:</strong><br>Lippie Pencil<br>Lippie Stix</p><p>Part of the Mermaid collection.</p>";
    const faq = buildFaq(base({ title: "Ocean Kit", descriptionHtml: html, language: "en" }));
    expect(faq[0].a).toBe("Lippie Pencil; Lippie Stix.");
  });

  it("gives a label followed by a list only the list, not the prose after it", () => {
    const html =
      "<p><strong>Dimensiuni:</strong></p><ul><li>Lungime: 100 cm</li><li>Latime: 45 cm</li></ul>" +
      "<p>Termenul de livrare este de 4 saptamani.</p>";
    const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
    expect(faq[0].a).toBe("Lungime: 100 cm; Latime: 45 cm.");
  });

  it("keeps a heading that states the basis of the figures", () => {
    const html = "<p><strong>Declaratie nutritionala / per 100 g</strong></p><p>Energie 360 kcal; proteine 90 g.</p>";
    const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
    expect(faq[0].a).toBe("Declaratie nutritionala / per 100 g: Energie 360 kcal; proteine 90 g.");
  });

  it("merges sections of one intent under their headings, and says a repeated block once", () => {
    const html =
      "<p><strong>Lungime masa</strong>: 180 cm</p><p><strong>Latime masa</strong>: 90 cm</p>" +
      "<p><strong>Lungime masa</strong>: 180 cm</p>";
    const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
    expect(faq).toEqual([
      expect.objectContaining({ q: "Ce dimensiuni are Masa Oslo?", a: "Lungime masa: 180 cm. Latime masa: 90 cm." }),
    ]);
  });

  it("ends a run of plain 'Label: value' lines where the pairs end", () => {
    const html =
      "<p><strong>Dimensiuni exterioare:</strong></p><p>Lungime: 100cm</p><p>Latime: 45cm</p>" +
      "<p><em>Termenul de livrare este aproximativ 4 saptamani.</em></p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0].a).toBe("Lungime: 100cm; Latime: 45cm.");
  });

  it("ends a section at a bold line of its own, even one that is not a label", () => {
    const html =
      "<p><strong>Material:</strong></p><p>Lemn masiv de stejar.</p>" +
      "<p><strong>PRODUS FABRICAT IN ROMANIA!</strong></p><p>Produsele sunt handmade.</p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0].a).toBe("Lemn masiv de stejar.");
  });

  it("says a bundle's repeated section once per product, each under the product's name", () => {
    const html =
      "<h2>Maca Forte, 60 capsule</h2><p><b>Mod de utilizare</b>: 2 capsule zilnic.</p>" +
      "<h2>Zinc Bisglycinate, 90 tablete</h2><p><b>Mod de utilizare</b>: 1 tableta zilnic.</p>";
    const faq = buildFaq(base({ title: "Pachet", descriptionHtml: html, language: "ro" }));
    expect(faq.map((x) => x.a)).toEqual(["Maca Forte: 2 capsule zilnic. Zinc Bisglycinate: 1 tableta zilnic."]);
  });

  it("merges a repeated merchant question the same way", () => {
    const html =
      "<h2>Maca Forte, 60 capsule</h2><p><b>Ce contine?</b></p><p>60 de capsule.</p>" +
      "<h2>Zinc, 90 tablete</h2><p><b>Ce contine?</b></p><p>90 de tablete.</p>";
    const faq = buildFaq(base({ title: "Pachet", descriptionHtml: html, language: "ro" }));
    expect(faq.map((x) => [x.q, x.a])).toEqual([["Ce contine?", "Maca Forte: 60 de capsule. Zinc: 90 de tablete."]]);
  });

  it("lets the merchant's own question take in the sections of its intent", () => {
    const html =
      "<p><b>Ce contine?</b></p><p>60 de capsule.</p><p><b>Ingrediente</b>: pulbere de maca.</p>";
    const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
    expect(faq).toHaveLength(1);
    expect(faq[0].q).toBe("Ce contine?");
    expect(faq[0].a).toBe("60 de capsule. Ingrediente: pulbere de maca.");
  });

  it("never reads style, script or svg content as text", () => {
    const html = "<style>.h2{color:red}</style><p><b>Ingredients:</b> oats, honey.</p><svg><text>Warnings</text></svg>";
    expect(descriptionOutline(html)).toBe("## Ingredients: oats, honey.");
  });

  it("points sourceSpan at the heading and the text it answered from", () => {
    const html = "<p>Intro.</p><h3>Storage</h3><p>Keep cool and dry.</p>";
    const [item] = buildFaq(base({ descriptionHtml: html, language: "en" }));
    const span = html.slice(item.sourceSpan!.start, item.sourceSpan!.end);
    expect(span).toContain("Storage");
    expect(span).toContain("Keep cool and dry.");
    expect(span).not.toContain("Intro");
  });
});

describe("answers", () => {
  it("cut at a list boundary, every item whole", () => {
    const units = Array.from({ length: 40 }, (_, i) => `Item number ${i + 1} of the set`);
    const answer = joinAnswer(units);
    expect(answer.length).toBeLessThanOrEqual(600);
    expect(answer).toMatch(/Item number \d+ of the set\.$/);
  });

  it("cut at a sentence end inside the limit, or not at all", () => {
    const sentence = "This sentence is long enough to matter. ";
    expect(joinAnswer([sentence.repeat(30)])).toMatch(/matter\.$/);
    expect(joinAnswer(["word ".repeat(200)])).toBe("");
  });

  it("no answer, no question", () => {
    expect(buildFaq(base({ descriptionHtml: "<h3>Ingredients</h3><p>-</p>" }))).toEqual([]);
  });

  it("never the same answer under two questions", () => {
    const html = "<h3>Is it vegan?</h3><p>Yes, fully vegan.</p><h3>Is it cruelty free?</h3><p>Yes, fully vegan.</p>";
    expect(qs(base({ descriptionHtml: html }))).toEqual(["Is it vegan?"]);
  });

  it("never the same question twice: a repeated question is asked once", () => {
    const html = "<h3>Is it vegan?</h3><p>Yes, fully vegan.</p><h3>Is it vegan?</h3><p>Certified by the Vegan Society.</p>";
    const faq = buildFaq(base({ descriptionHtml: html }));
    expect(faq.map((x) => x.q)).toEqual(["Is it vegan?"]);
    expect(faq[0].a).toBe("Yes, fully vegan. Certified by the Vegan Society.");
  });
});

describe("the cap", () => {
  const many = Array.from({ length: 12 }, (_, i) => `<h3>Question number ${i + 1}?</h3><p>Answer number ${i + 1}.</p>`).join("");

  it("defaults to eight", () => {
    expect(buildFaq(base({ descriptionHtml: many }))).toHaveLength(DEFAULT_FAQ_CAP);
    expect(buildFaq(base({ descriptionHtml: many, cap: 3 }))).toHaveLength(3);
  });

  it("never cuts the safety question, which comes first", () => {
    const faq = buildFaq(base({ descriptionHtml: `${many}<h3>Warnings</h3><p>Keep away from children.</p>`, cap: 3 }));
    expect(faq).toHaveLength(3);
    expect(faq[0].intent).toBe("safety");
  });
});

describe("Shopify data", () => {
  it("asks about options with a real choice, never the default Title", () => {
    const faq = buildFaq(
      base({
        language: "en",
        options: [
          { name: "Title", values: ["Default Title", "Other"] },
          { name: "Color", values: ["Black", "White"] },
          { name: "Size", values: ["One size"] },
        ],
      }),
    );
    expect(faq).toEqual([
      { q: "Which options is Masa Oslo available in?", a: "Color: Black, White.", source: "variants" },
    ]);
  });

  it("does not end an answer with two full stops", () => {
    const [item] = buildFaq(base({ options: [{ name: "Size", values: ["1.7 fl oz.", "4 fl oz."] }] }));
    expect(item.a).toBe("Size: 1.7 fl oz., 4 fl oz.");
  });

  it("asks who makes it only for a brand that is not the shop, a name not a category, never on a gift card", () => {
    const ask = (vendor: string, title = "Masa Oslo") =>
      buildFaq(base({ title, vendor, shopName: "Death Wish Coffee", language: "en" })).map((x) => x.a);
    expect(ask("Klean Kanteen")).toEqual(["Klean Kanteen."]);
    expect(ask("Death Wish Coffee Company")).toEqual([]);
    expect(ask("BONE CONDUCTION OPEN-EAR SPORT HEADPHONES")).toEqual([]);
    expect(ask("Onward", "Digital Gift Card")).toEqual([]);
    expect(buildFaq(base({ vendor: "Klean Kanteen" }))).toEqual([]);
  });
});

describe("presets and the shop's own mappings", () => {
  const facts = [
    { k: "Material", v: "MDF, metal" },
    { k: "Dimensions", v: "160 x 90 cm" },
    { k: "Forma", v: "ovala" },
  ];

  it("asks the preset's template only for the preset's own groups, and nothing generic", () => {
    expect(qs(base({ facts, presetId: "furniture", language: "en" }))).toEqual([
      "What is Masa Oslo made of?",
      "What are the dimensions of Masa Oslo?",
    ]);
    expect(qs(base({ facts, language: "en" }))).toEqual([]);
  });

  it("does not call a capacity dimensions", () => {
    expect(qs(base({ facts: [{ k: "Dimensions", v: "100ml" }], presetId: "furniture" }))).toEqual([]);
  });

  it("asks the shop's own question for a group, and for a heading", () => {
    const faq = buildFaq(
      base({
        facts,
        presetId: "furniture",
        descriptionHtml: "<h3>Montaj</h3><p>Se livreaza demontata, cu instructiuni.</p>",
        mappings: {
          groups: [{ group: "forma", question: "Ce forma are {title}?" }],
          sections: [{ heading: "montaj", question: "Cum se monteaza {title}?" }],
        },
        language: "ro",
      }),
    );
    expect(faq.map((x) => [x.q, x.source])).toEqual([
      ["Cum se monteaza Masa Oslo?", "mapping"],
      ["Ce material are Masa Oslo?", "preset"],
      ["Ce dimensiuni are Masa Oslo?", "preset"],
      ["Ce forma are Masa Oslo?", "mapping"],
    ]);
  });

  it("validates a merchant's question: the title placeholder, a question mark, plain characters", () => {
    expect(validateFaqQuestion("Ce forma are {title}?")).toBeNull();
    expect(validateFaqQuestion("Ce forma are?")).toMatch(/\{title\}/);
    expect(validateFaqQuestion("Ce forma are {title}")).toMatch(/question mark/);
    expect(validateFaqQuestion("Ce formă – are {title}?")).toMatch(/plain characters/);
    expect(validateFaqQuestion("What’s {title}?")).toMatch(/plain characters/);
  });
});

describe("business", () => {
  it("keeps the business questions and puts them last", () => {
    const faq = buildFaq(
      base({
        descriptionHtml: "<h3>Storage</h3><p>Keep dry.</p>",
        business: { deliveryTime: "2-4 working days", returnDays: 14, paymentMethods: "card" },
        language: "en",
      }),
    );
    expect(faq.map((x) => x.source)).toEqual(["section", "business", "business", "business"]);
  });
});

describe("output hygiene", () => {
  it("writes plain characters only", () => {
    const html = "<h3>Ingredients</h3><p>Oats &#8211; honey &amp; “salt”…</p>";
    const [item] = buildFaq(base({ descriptionHtml: html }));
    expect(item.a).not.toMatch(/[–—‘’“”…]|&#?\w+;/);
  });
});
