import { describe, expect, it } from "vitest";
import {
  buildFaq,
  classifyHeading,
  descriptionOutline,
  joinAnswer,
  parseBlocks,
  validateFaqQuestion,
  DEFAULT_FAQ_CAP,
  LONG_ANSWER_CHARS,
  type FaqInput,
} from "../faq";

// CC-PROMPT-AI-READABILITY-3 item 2. Each test states a rule of the engine,
// not a store: the fixtures are written for the rule, in both languages.

const base = (over: Partial<FaqInput>): FaqInput => ({ title: "Masa Oslo", facts: [], ...over });
const qs = (input: FaqInput) => buildFaq(input).map((x) => x.q);

describe("merchant questions", () => {
  it("takes a question heading that names the product as written, and the text under it as the answer", () => {
    const faq = buildFaq(
      base({
        title: "BookArc - Insert I",
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

  it("names the product in a merchant's question that does not, so it reads away from the page", () => {
    const html = "<h3>How does our product stand out?</h3><p>Premium formula with milk thistle.</p>";
    expect(qs(base({ title: "m50 LiverRegen Formula", descriptionHtml: html, language: "en" }))).toEqual([
      "m50 LiverRegen Formula: How does our product stand out?",
    ]);
  });

  it("drops a question put to the reader: that is marketing", () => {
    expect(qs(base({ descriptionHtml: "<h4>What are you waiting for?</h4><p>Matching tee sold separately.</p>" }))).toEqual([]);
    expect(qs(base({ descriptionHtml: "<p><b>De ce te-ai opri acum?</b></p><p>Oferta e limitata.</p>", language: "ro" }))).toEqual([]);
  });

  it("drops a question longer than fifteen words", () => {
    const long = "At least I have iodine on my wounds and crutches left to use, but what about those that don't?";
    expect(qs(base({ descriptionHtml: `<p><b>${long}</b></p><p>Text.</p>` }))).toEqual([]);
  });

  it("drops a question that opens with 'But' or 'And': it follows another one", () => {
    expect(qs(base({ descriptionHtml: "<h3>Dar daca valoarea e mai mare?</h3><p>Nicio problema.</p>", language: "ro" }))).toEqual([]);
  });

  it("asks a merchant's two questions of one intent once", () => {
    const html = "<h3>De ce sa alegi produsul?</h3><p>Vegan.</p><h3>De ce sa alegi colagenul MOY?</h3><p>Peptan patentat.</p>";
    const faq = buildFaq(base({ title: "Colagen m34", descriptionHtml: html, language: "ro" }));
    expect(faq).toHaveLength(1);
    expect(faq[0].a).toBe("Vegan. Peptan patentat.");
  });
});

describe("description sections", () => {
  it("classifies headings from the corpus lists, in either language", () => {
    expect(classifyHeading("Warnings")).toBe("safety");
    expect(classifyHeading("Atentionari")).toBe("safety");
    expect(classifyHeading("Alergeni")).toBe("safety");
    expect(classifyHeading("Cum sa-l folosesti")).toBe("usage");
    expect(classifyHeading("Ingredients per serving")).toBe("composition");
    expect(classifyHeading("Conditii de pastrare")).toBe("storage");
    expect(classifyHeading("Dimensiuni exterioare")).toBe("dimensions");
    expect(classifyHeading("Kit Includes")).toBe("contents");
    expect(classifyHeading("Ideal pentru")).toBe("suitability");
    expect(classifyHeading("Why It's Special")).toBe("benefits");
    expect(classifyHeading("Product details")).toBeNull();
  });

  it("reads a heading whose letter was lost to a wrong encoding", () => {
    expect(classifyHeading("Aten?ionare")).toBe("safety");
  });

  it("does not read a negated heading as a warning", () => {
    expect(classifyHeading("Fara alergeni")).toBeNull();
    expect(classifyHeading("Allergen free")).toBeNull();
  });

  it("does not read what the judge found to be something else", () => {
    // A measured quantity, a nutrition table, a dose and a finish name
    // something their intent's question does not ask.
    expect(classifyHeading("Caffeine content")).toBeNull();
    expect(classifyHeading("Valori nutritionale")).toBeNull();
    expect(classifyHeading("Doza zilnica recomandata")).toBeNull();
    expect(classifyHeading("Finisaj")).toBeNull();
    // A long label describes; it does not name a section.
    expect(classifyHeading("Formula personalizata cu extra ingrediente")).toBeNull();
  });

  it("asks the intent's question in the content language", () => {
    const html = "<h2>Ingrediente</h2><p>Faina de ovaz, miere.</p>";
    expect(qs(base({ descriptionHtml: html, language: "ro" }))).toEqual(["Ce conține produsul Masa Oslo?"]);
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

  it("gives a label followed by a list only the list, and keeps what a dimensions heading measures", () => {
    const html =
      "<p><strong>Dimensiuni:</strong></p><ul><li>Lungime: 100 cm</li><li>Latime: 45 cm</li></ul>" +
      "<p>Termenul de livrare este de 4 saptamani.</p>";
    const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
    expect(faq[0].a).toBe("Dimensiuni: Lungime: 100 cm; Latime: 45 cm.");
  });

  it("keeps a heading that states the basis of the figures", () => {
    const html = "<p><strong>Ingrediente / capsula</strong></p><p>Pulbere de maca 650 mg.</p>";
    const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
    expect(faq[0].a).toBe("Ingrediente / capsula: Pulbere de maca 650 mg.");
  });

  it("keeps a sub-heading with the lines under it", () => {
    const html =
      "<h3>Dimensiuni</h3><p><strong>Pat</strong></p><p>Lungime: 200 cm</p><p><strong>Spatar</strong></p><p>Inaltime: 70 cm</p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0].a).toBe(
      "Dimensiuni: Pat: Lungime: 200 cm; Spatar: Inaltime: 70 cm.",
    );
  });

  it("merges sections of one intent under their headings, and says a repeated block once", () => {
    const html =
      "<p><strong>Lungime masa</strong>: 180 cm</p><p><strong>Latime masa</strong>: 90 cm</p>" +
      "<p><strong>Lungime masa</strong>: 180 cm</p>";
    const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
    expect(faq).toEqual([
      expect.objectContaining({ q: "Ce dimensiuni are produsul Masa Oslo?", a: "Lungime masa: 180 cm. Latime masa: 90 cm." }),
    ]);
  });

  it("ends a run of plain 'Label: value' lines where the pairs end", () => {
    const html =
      "<p><strong>Dimensiuni exterioare:</strong></p><p>Lungime: 100cm</p><p>Latime: 45cm</p>" +
      "<p><em>Termenul de livrare este aproximativ 4 saptamani.</em></p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0].a).toBe(
      "Dimensiuni exterioare: Lungime: 100cm; Latime: 45cm.",
    );
  });

  it("reads a list written as paragraphs to its end, a line with no colon included", () => {
    const html =
      "<p><strong>Set Includes:</strong></p><p>- Ultra Glossy Lip in Mademoiselle Belle: Rosy pink</p><p>- Enchanted Rose Lip Mask</p>";
    expect(buildFaq(base({ title: "Beautiful Belle", descriptionHtml: html, language: "en" }))[0].a).toBe(
      "Ultra Glossy Lip in Mademoiselle Belle: Rosy pink; Enchanted Rose Lip Mask.",
    );
  });

  it("keeps a list item longer than a short line", () => {
    const html =
      "<p><strong>Set Includes:</strong></p><p>Peach Jelly Eyeshadow Palette</p>" +
      "<p>Jelly Much Gel Eyeshadow Stick in Golden Coast: Golden bronze with gold and copper sparkle</p>";
    expect(buildFaq(base({ title: "Sparkling Peach", descriptionHtml: html, language: "en" }))[0].a).toBe(
      "Peach Jelly Eyeshadow Palette; Jelly Much Gel Eyeshadow Stick in Golden Coast: Golden bronze with gold and copper sparkle.",
    );
  });

  it("keeps every measure of a measurement line, and cuts only the prose after them", () => {
    const html = "<p><strong>Lungime</strong>: +15cm Latime: +15cm Toate paturile noastre sunt livrate cu un suport.</p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0].a).toBe("Lungime: +15cm Latime: +15cm.");
  });

  it("gives a measurement the heading it sits under, and nothing but the measurement", () => {
    const html =
      "<h3>Dimensiuni exterioare:</h3><p><strong>Lungimea saltelei</strong>: +15cm</p>" +
      "<h3>Spatar:</h3><p><strong>Inaltime</strong>: 70cm Toate paturile noastre sunt livrate cu un suport.</p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0].a).toBe(
      "Dimensiuni exterioare: Lungimea saltelei: +15cm. Spatar, Inaltime: 70cm.",
    );
  });

  it("keeps only measurements in a dimensions answer", () => {
    const html = "<p><strong>Dimensiuni:</strong></p><p>Lungime: 290 mm</p><p>Culoare: nuante de caramiziu</p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0].a).toBe("Dimensiuni: Lungime: 290 mm.");
  });

  it("ends a section at a bold line of its own, even one that is not a label", () => {
    const html =
      "<p><strong>Material:</strong></p><p>Lemn masiv de stejar.</p>" +
      "<p><strong>PRODUS FABRICAT IN ROMANIA!</strong></p><p>Produsele sunt handmade.</p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0].a).toBe("Lemn masiv de stejar.");
  });

  it("lets the merchant's own question take in the sections of its intent", () => {
    const html =
      "<p><b>Ce contine?</b></p><p>60 de capsule.</p><p><b>Ingrediente</b>: pulbere de maca.</p>";
    const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
    expect(faq).toHaveLength(1);
    expect(faq[0].q).toBe("Masa Oslo: Ce contine?");
    expect(faq[0].a).toBe("60 de capsule. Ingrediente: pulbere de maca.");
  });

  it("never reads style, script or svg content as text", () => {
    const html = "<style>.h2{color:red}</style><p><b>Ingredients:</b> oats, honey.</p><svg><text>Warnings</text></svg>";
    expect(descriptionOutline(html)).toBe("## Ingredients: oats, honey.");
  });

  it("drops a sentence whose link read only 'here': it points at nothing once the link is gone", () => {
    const html = "<h3>Key benefits</h3><p>Clinically proven (see the studies <a href='/s'>here</a>). Vegan formula.</p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "en" }))[0].a).toBe("Vegan formula.");
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

describe("warnings", () => {
  it("takes the sentences that open like a warning when there is no warnings heading", () => {
    const html =
      "<p>Paste din porumb, gata in 9 minute.</p><p>Nu contine gluten. Poate contine urme de soia. A nu se lasa la indemana copiilor.</p>";
    const faq = buildFaq(base({ title: "Paste", descriptionHtml: html, language: "ro" }));
    expect(faq[0]).toEqual(
      expect.objectContaining({ intent: "safety", a: "Poate contine urme de soia. A nu se lasa la indemana copiilor." }),
    );
  });

  it("reads a Romanian 'do not' as a warning", () => {
    const html = "<p>Se amesteca cu apa rece. Nu prepara cu sucuri de fructe, exista riscul de fermentare.</p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0]).toEqual(
      expect.objectContaining({ intent: "safety", a: "Nu prepara cu sucuri de fructe, exista riscul de fermentare." }),
    );
  });

  it("reads a negated allergen line as no warning, and an allergen line as one", () => {
    const free = buildFaq(base({ descriptionHtml: "<p><b>Fara alergeni</b>: fara gluten, fara lactoza.</p>", language: "ro" }));
    expect(free.some((x) => x.intent === "safety")).toBe(false);
    const warns = buildFaq(base({ descriptionHtml: "<p><b>Alergeni</b>: contine urme de alune.</p>", language: "ro" }));
    expect(warns[0]).toEqual(expect.objectContaining({ intent: "safety", a: "contine urme de alune." }));
  });
});

describe("bundles", () => {
  const two = (a: string, b: string) =>
    `<h2>Maca Forte ecologica, 60 capsule</h2>${a}<h2>Zinc Bisglycinate 25 mg, 90 tablete</h2>${b}`;

  it("says a repeated section once per product, each under the product's name", () => {
    const html = two("<p><b>Mod de utilizare</b>: 2 capsule zilnic.</p>", "<p><b>Mod de utilizare</b>: 1 tableta zilnic.</p>");
    const faq = buildFaq(base({ title: "Pachet", descriptionHtml: html, language: "ro" }));
    expect(faq.map((x) => x.a)).toEqual([
      "Maca Forte ecologica, 60 capsule: 2 capsule zilnic. Zinc Bisglycinate 25 mg, 90 tablete: 1 tableta zilnic.",
    ]);
  });

  it("asks a merchant's repeated question as the bundle's own question, answered per product", () => {
    const html = two("<p><b>Ce contine?</b></p><p>60 de capsule.</p>", "<p><b>Ce contine?</b></p><p>90 de tablete.</p>");
    const faq = buildFaq(base({ title: "Pachet", descriptionHtml: html, language: "ro" }));
    expect(faq.map((x) => [x.q, x.a])).toEqual([
      ["Ce conține produsul Pachet?", "Maca Forte ecologica, 60 capsule: 60 de capsule. Zinc Bisglycinate 25 mg, 90 tablete: 90 de tablete."],
    ]);
  });

  it("asks nothing that only one of its products answers, except warnings", () => {
    const html = two(
      "<p><b>Mod de utilizare</b>: 2 capsule zilnic.</p><p><b>Atentionari</b>: A nu se consuma de catre copii.</p>",
      "<p><b>Ideal pentru</b>: sportivi.</p><p><b>Mod de utilizare</b>: 1 tableta zilnic.</p>",
    );
    const faq = buildFaq(base({ title: "Pachet", descriptionHtml: html, language: "ro", vendor: "Molecules of Youth", shopName: "Republica BIO" }));
    expect(faq.map((x) => x.intent)).toEqual(["safety", "usage"]);
    expect(faq[0].a).toBe("Maca Forte ecologica, 60 capsule: A nu se consuma de catre copii.");
    // One vendor does not make every product of a bundle.
    expect(faq.some((x) => x.source === "vendor")).toBe(false);
  });

  it("lets its contents answer what it contains, not each product's ingredients", () => {
    const html =
      "<h2>Continut pachet:</h2><ul><li>1 x Maca Forte</li><li>1 x Zinc Bisglycinate</li></ul>" +
      two("<p><b>Ce contine?</b></p><p>Pulbere de maca.</p>", "<p><b>Ce contine?</b></p><p>Zinc bisglicinat.</p>");
    const faq = buildFaq(base({ title: "Pachet", descriptionHtml: html, language: "ro" }));
    expect(faq.map((x) => x.intent)).toEqual(["contents"]);
  });

  it("gives every product's warnings, from its sentences where it has no warnings heading", () => {
    const html = two(
      "<p><b>Atentionari</b>: A nu se consuma de catre copii.</p>",
      "<p>Tablete cu zinc. A nu se lasa la indemana copiilor mici.</p>",
    );
    const faq = buildFaq(base({ title: "Pachet", descriptionHtml: html, language: "ro" }));
    expect(faq[0].a).toBe(
      "Maca Forte ecologica, 60 capsule: A nu se consuma de catre copii. Zinc Bisglycinate 25 mg, 90 tablete: A nu se lasa la indemana copiilor mici.",
    );
  });

  it("cuts a long product name at a list comma, never at a decimal comma or inside a parenthesis", () => {
    const html =
      "<h2>Maca Ecologica din Peru (400 mg - extract 4:1) Republica BIO, 60 capsule (29,7 g)</h2><p><b>Mod de utilizare</b>: 2 capsule zilnic.</p>" +
      "<h2>Rhodiola Rosea Ecologica din Bulgaria, 60 capsule (29,7 g)</h2><p><b>Mod de utilizare</b>: 1 capsula zilnic.</p>";
    const [item] = buildFaq(base({ title: "Pachet", descriptionHtml: html, language: "ro" }));
    expect(item.a).toBe(
      "Maca Ecologica din Peru (400 mg - extract 4:1) Republica BIO: 2 capsule zilnic. Rhodiola Rosea Ecologica din Bulgaria, 60 capsule (29,7 g): 1 capsula zilnic.",
    );
  });

  it("asks nothing it cannot answer for every one of its products within the limit", () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => `Pasul ${i + 1} al preparării este descris aici pe larg.`).join(" ");
    const html = two(`<p><b>Mod de utilizare</b>: ${long(18)}</p>`, `<p><b>Mod de utilizare</b>: ${long(18)}</p>`);
    const faq = buildFaq(base({ title: "Pachet", descriptionHtml: html, language: "ro" }));
    expect(faq.some((x) => x.intent === "usage")).toBe(false);
  });

  it("does not take a short section heading for a product's name", () => {
    const html =
      "<h2>Bneficii cheie</h2><p><b>Mod de utilizare</b>: 2 linguri zilnic.</p>";
    expect(buildFaq(base({ descriptionHtml: html, language: "ro" }))[0].a).toBe("2 linguri zilnic.");
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
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence number ${i + 1} is long enough to matter.`).join(" ");
    expect(joinAnswer([sentences])).toMatch(/matter\.$/);
    expect(joinAnswer(["word ".repeat(200)])).toBe("");
  });

  it("says a repeated sentence once, and never ends on a heading", () => {
    expect(joinAnswer(["Keep away from children and pets.", "Keep away from children and pets."])).toBe(
      "Keep away from children and pets.",
    );
    expect(joinAnswer([{ text: "Soft and warm" }, { text: "Why people love it", heading: true }])).toBe("Soft and warm.");
  });

  it("never cuts package contents: a list too long to give whole is not given", () => {
    const items = Array.from({ length: 80 }, (_, i) => `<li>Shade number ${i + 1} in the palette</li>`).join("");
    const faq = buildFaq(base({ descriptionHtml: `<p><b>Kit includes:</b></p><ul>${items}</ul>`, language: "en" }));
    expect(faq).toEqual([]);
    expect(LONG_ANSWER_CHARS).toBeGreaterThan(600);
  });

  it("no answer, no question", () => {
    expect(buildFaq(base({ descriptionHtml: "<h3>Ingredients</h3><p>-</p>" }))).toEqual([]);
  });

  it("never the same answer under two questions", () => {
    const html = "<h3>Is Masa Oslo vegan?</h3><p>Yes, fully vegan.</p><h3>Is Masa Oslo cruelty free?</h3><p>Yes, fully vegan.</p>";
    expect(qs(base({ descriptionHtml: html }))).toEqual(["Is Masa Oslo vegan?"]);
  });

  it("never the same question twice: a repeated question is asked once", () => {
    const html = "<h3>Is Masa Oslo vegan?</h3><p>Yes, fully vegan.</p><h3>Is Masa Oslo vegan?</h3><p>Certified by the Vegan Society.</p>";
    const faq = buildFaq(base({ descriptionHtml: html }));
    expect(faq.map((x) => x.q)).toEqual(["Is Masa Oslo vegan?"]);
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

  it("asks who makes it only for a named brand that is not the shop, never a category, a placeholder or a gift card", () => {
    const ask = (vendor: string, title = "Masa Oslo") =>
      buildFaq(base({ title, vendor, shopName: "Death Wish Coffee", language: "en" })).map((x) => x.a);
    expect(ask("Klean Kanteen")).toEqual(["Klean Kanteen."]);
    expect(ask("Death Wish Coffee Company")).toEqual([]);
    expect(ask("BONE CONDUCTION OPEN-EAR SPORT HEADPHONES")).toEqual([]);
    expect(ask("Nedefinit")).toEqual([]);
    expect(ask("Onward", "Digital Gift Card")).toEqual([]);
    expect(buildFaq(base({ vendor: "Klean Kanteen" }))).toEqual([]);
  });
});

describe("presets and the shop's own mappings", () => {
  const facts = [
    { k: "Material", v: "organic cotton, jersey" },
    { k: "Care", v: "wash cold, tumble dry" },
    { k: "Forma", v: "ovala" },
  ];

  it("asks the preset's template only for the preset's own groups, and nothing generic", () => {
    expect(qs(base({ facts, presetId: "clothing", language: "en" }))).toEqual([
      "What is Masa Oslo made of?",
      "How do I care for Masa Oslo?",
    ]);
    expect(qs(base({ facts, language: "en" }))).toEqual([]);
  });

  it("asks nothing from the furniture preset: the judge found its values wrong", () => {
    expect(qs(base({ facts: [{ k: "Material", v: "metal" }, { k: "Dimensions", v: "10 CM" }], presetId: "furniture" }))).toEqual([]);
  });

  it("asks the shop's own question for a group, and for a heading", () => {
    const faq = buildFaq(
      base({
        facts,
        presetId: "clothing",
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
      ["Ce material are produsul Masa Oslo?", "preset"],
      ["Cum se întreține produsul Masa Oslo?", "preset"],
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
  it("does not ask a gift card's delivery time or return window", () => {
    const faq = buildFaq(
      base({ title: "Card Cadou", business: { deliveryTime: "2-4 zile lucratoare", returnDays: 14, paymentMethods: "card" }, language: "ro" }),
    );
    expect(faq.map((x) => x.q)).toEqual(["Cum pot plăti?"]);
  });

  it("does not ask from the business record what the shop already asks in its own words", () => {
    const faq = buildFaq(
      base({
        title: "Card Cadou",
        descriptionHtml: "<h3>Cum se plateste cardul cadou?</h3><p>Online, la finalizarea comenzii.</p>",
        business: { deliveryTime: "2-4 zile lucratoare", returnDays: 14, paymentMethods: "card" },
        language: "ro",
      }),
    );
    expect(faq.map((x) => [x.q, x.source])).toEqual([["Cum se plateste cardul cadou?", "merchant"]]);
  });

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

describe("classes from the first hold-out run (stores moved to dev)", () => {
  it("does not read a mixed 'Safety and features' list as precautions; a warnings heading stays one", () => {
    expect(classifyHeading("Safety and features")).toBeNull();
    expect(classifyHeading("Safety & Features")).toBeNull();
    expect(classifyHeading("Warnings and precautions")).toBe("safety");
    expect(classifyHeading("ATENTIE")).toBe("safety");
    expect(classifyHeading("Caution")).toBe("safety");
  });

  it("does not read the nutrient analysis as composition, nor 'Caracteristici' as benefits", () => {
    expect(classifyHeading("Ingrediente analitice")).toBeNull();
    expect(classifyHeading("Ingrediente")).toBe("composition");
    expect(classifyHeading("Caracteristici")).toBeNull();
  });

  it("drops a download link from a package list and keeps a repeated item", () => {
    const faq = buildFaq(
      base({
        descriptionHtml:
          "<h3>Package includes</h3><ul><li>Speaker</li><li>USB-C charging cable</li><li>Headphones</li><li>USB-C charging cable</li></ul>" +
          '<div><a href="/manual.pdf">Download User Manual</a></div>',
        language: "en",
      }),
    );
    const contents = faq.find((x) => x.intent === "contents");
    expect(contents?.a).not.toMatch(/Download/);
    expect(contents?.a.match(/USB-C charging cable/g)).toHaveLength(2);
  });

  it("asks no maker when the vendor field is an admin switch, and still asks a lowercase brand", () => {
    const hidden = buildFaq(base({ vendor: "applehide", shopName: "iStyle", language: "ro" }));
    expect(hidden.some((x) => x.source === "vendor")).toBe(false);
    const brand = buildFaq(base({ vendor: "tuft + paw", shopName: "Fable", language: "en" }));
    expect(brand.some((x) => x.source === "vendor")).toBe(true);
  });

  it("reads supervision and see-your-vet sentences as warnings", () => {
    for (const html of [
      "<p>Jucarie din nylon.</p><p>Supravegheati permanent jocul animalului.</p>",
      "<p>Hrana dietetica. Va recomandam ca inainte de utilizare sa consultati medicul veterinar.</p>",
      "<p>Rucsac pentru animale.</p><p>Nu este o jucarie sau un produs destinat copiilor.</p>",
    ]) {
      const faq = buildFaq(base({ descriptionHtml: html, language: "ro" }));
      expect(faq.some((x) => x.intent === "safety")).toBe(true);
    }
  });
});

describe("classes from the second hold-out run (stores moved to dev)", () => {
  it("keeps every bulleted step after a first 'Label: value' step", () => {
    const faq = buildFaq(
      base({
        title: "Roinita",
        descriptionHtml:
          "<p><b>Indicatii de utilizare</b></p><p>• Infuzie: adauga 1 lingurita in 250 ml apa.<br>• Se lasa la infuzat 5-10 minute.<br>• Se recomanda 1-3 cani pe zi.</p>",
        language: "ro",
      }),
    );
    const usage = faq.find((x) => x.intent === "usage");
    expect(usage?.a).toMatch(/5-10 minute/);
    expect(usage?.a).toMatch(/1-3 cani/);
  });

  it("ends a list at a plain-text label of another section and leaves no emoji mark behind", () => {
    const faq = buildFaq(
      base({
        descriptionHtml:
          "<p><b>Potrivit pentru</b></p><p>✔️ Persoane stresate<br>✔️ Somn agitat</p><p>Ingrediente active cheie</p><p>· Roinita, bogata in uleiuri volatile.</p>",
        language: "ro",
      }),
    );
    const who = faq.find((x) => x.intent === "suitability");
    expect(who?.a).toBe("Persoane stresate; Somn agitat.");
  });

  it("gives no answer when two parts carry the same label and no name tells them apart", () => {
    const faq = buildFaq(
      base({
        descriptionHtml:
          "<p><b>1. Demachiant crema (100 ml)</b><br><b>Ingrediente active:</b> ulei de migdale.</p><p><b>2. Ser cu acid hialuronic (30 ml)</b><br><b>Ingrediente active:</b> acid hialuronic.</p>",
        language: "ro",
      }),
    );
    expect(faq.some((x) => x.intent === "composition")).toBe(false);
  });

  it("reads a negated heading as no section at all, and 'Precautii' as warnings", () => {
    expect(classifyHeading("No special care required")).toBeNull();
    expect(classifyHeading("Fără ingrediente controversate")).toBeNull();
    expect(classifyHeading("Precauții")).toBe("safety");
  });

  it("reads external-use, toxic and only-attach sentences as warnings, but not 'non-toxic' or one that points back", () => {
    for (const [html, warns] of [
      ["<p>Ulei de masaj.</p><p>Exclusiv pentru uz extern.</p>", true],
      ["<p>Rubber tree.</p><p>The latex sap is toxic to pets.</p>", true],
      ["<p>Harness.</p><p>The leash should only be attached to the harness.</p>", true],
      ["<p>Paint for kids.</p><p>Our non-toxic paint washes off.</p>", false],
      ["<p>A palm with a fuzzy trunk.</p><p>Avoid scraping these fibers off.</p>", false],
    ] as const) {
      const faq = buildFaq(base({ descriptionHtml: html, language: /Ulei/.test(html) ? "ro" : "en" }));
      expect(faq.some((x) => x.intent === "safety")).toBe(warns);
    }
  });

  it("asks Romanian questions of 'produsul X', which agrees with a plural title", () => {
    const faq = buildFaq(base({ title: "Capsule cu pelin", descriptionHtml: "<h3>Ingrediente</h3><p>Pelin.</p>", language: "ro" }));
    expect(faq.find((x) => x.intent === "composition")?.q).toBe("Ce conține produsul Capsule cu pelin?");
  });
});

describe("output hygiene", () => {
  it("writes plain characters only", () => {
    const html = "<h3>Ingredients</h3><p>Oats &#8211; honey &amp; “salt”…</p>";
    const [item] = buildFaq(base({ descriptionHtml: html }));
    expect(item.a).not.toMatch(/[–—‘’“”…]|&#?\w+;/);
  });
});
