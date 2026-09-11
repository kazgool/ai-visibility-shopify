// Every fixed phrase the engine writes into text a merchant or an assistant
// reads, in each language the app writes (CC-PROMPT-AI-READABILITY-2 item 5).
//
// Until 11 September 2026 these lived inline in summary.ts, meta.ts,
// collection.ts and the mirror renderer, in English only, and a Romanian
// storefront printed "Key details:" and "What is X made of?" on every product
// page. Nothing else in the engine writes a sentence of its own:
// phrases.test.ts reads the engine sources for the old English strings and
// fails if one comes back outside this file.
//
// Rules every entry keeps:
//  - Plain characters only: no em or en dash, no curly quote, no ellipsis
//    character. Romanian with its standard diacritics, comma-below ș and ț.
//  - No phrase states a fact of its own. Each one wraps a value the merchant
//    wrote or the dictionary extracted.
//  - No Romanian phrase has to agree with a title's gender, because a product
//    title can be any gender: "Ce material are X?", never
//    "Din ce este făcut X?".
//
// Pure, like the rest of the engine.

export type Language = "en" | "ro";

export const LANGUAGES: readonly Language[] = ["en", "ro"];

/**
 * A Romanian count: 1 takes the singular, 2 to 19 the plural, and from 20 on
 * a number whose last two digits are 00 or 20 to 99 takes "de" before the
 * noun ("14 zile", "30 de zile", "101 zile", "120 de zile").
 */
export function roCount(n: number, singular: string, plural: string): string {
  if (n === 1) return `1 ${singular}`;
  const lastTwo = n % 100;
  const de = n >= 20 && (lastTwo === 0 || lastTwo >= 20) ? "de " : "";
  return `${n} ${de}${plural}`;
}

export type Phrases = {
  // The product summary.
  isA(title: string, productType: string): string;
  isAProduct(title: string): string;
  keyDetails(clauses: string): string;

  // Product questions. The label-specific ones double as preset templates
  // and, with the ones below, as the questions of description sections.
  qMaterial(title: string): string;
  qDimensions(title: string): string;
  qSeats(title: string): string;
  qIncludes(title: string): string;
  qIncludesOrSeats(title: string): string;
  qRoom(title: string): string;

  // FAQ (faq.ts): one question per description intent, and Shopify data.
  qSafety(title: string): string;
  qUsage(title: string): string;
  qComposition(title: string): string;
  qStorage(title: string): string;
  qCare(title: string): string;
  qCompatibility(title: string): string;
  qSuitability(title: string): string;
  qBenefits(title: string): string;
  qFinish(title: string): string;
  qOptions(title: string): string;
  qVendor(title: string): string;

  // Business questions and their answers.
  qDelivery(title: string): string;
  aDelivery(time: string, cost: string | null, costIsFrom: boolean): string;
  qReturns(title: string): string;
  aReturns(days: number): string;
  qWarranty(title: string): string;
  months(n: number): string;
  qPayment(): string;

  // Collection pages.
  collectionCount(title: string, n: number): string;
  collectionDiffer(clauses: string): string;
  andMore(joined: string, rest: number): string;
  qCollectionCount(title: string): string;
  aCollectionCount(n: number): string;
  qCollectionOptions(label: string, title: string): string;

  // The plain text mirror.
  mirror: {
    attributeHeader: string;
    description: string;
    questions: string;
    whoItSuits: string;
    buyingIt: string;
    partOf: string;
    store: string;
    source(url: string): string;
    delivery: string;
    deliveryVaries: string;
    deliveryCost: string;
    from(cost: string): string;
    returns: string;
    days(n: number): string;
    warranty: string;
    payment: string;
  };
};

export const PHRASES: Record<Language, Phrases> = {
  en: {
    isA: (title, productType) => `${title} is a ${productType}.`,
    isAProduct: (title) => `${title} is a product.`,
    keyDetails: (clauses) => `Key details: ${clauses}.`,

    qMaterial: (title) => `What is ${title} made of?`,
    qDimensions: (title) => `What are the dimensions of ${title}?`,
    qSeats: (title) => `How many people does ${title} seat?`,
    qIncludes: (title) => `What does ${title} include?`,
    qIncludesOrSeats: (title) => `What does ${title} include or seat?`,
    qRoom: (title) => `Where is ${title} used?`,

    qSafety: (title) => `What precautions apply to ${title}?`,
    qUsage: (title) => `How do I use ${title}?`,
    qComposition: (title) => `What does ${title} contain?`,
    qStorage: (title) => `How should ${title} be stored?`,
    qCare: (title) => `How do I care for ${title}?`,
    qCompatibility: (title) => `What is ${title} compatible with?`,
    qSuitability: (title) => `Who is ${title} for?`,
    qBenefits: (title) => `What are the benefits of ${title}?`,
    qFinish: (title) => `What finish does ${title} have?`,
    qOptions: (title) => `Which options is ${title} available in?`,
    qVendor: (title) => `Who makes ${title}?`,

    qDelivery: (title) => `How long does delivery take for ${title}?`,
    aDelivery: (time, cost, costIsFrom) =>
      cost ? `${time}. Delivery costs ${costIsFrom ? "from " : ""}${cost}.` : `${time}.`,
    qReturns: (title) => `Can I return ${title}?`,
    aReturns: (days) => `Yes, within ${days} days.`,
    qWarranty: (title) => `What warranty does ${title} have?`,
    months: (n) => (n === 1 ? "1 month" : `${n} months`),
    qPayment: () => "How can I pay?",

    collectionCount: (title, n) =>
      n === 1 ? `${title} has 1 product.` : `${title} has ${n} products.`,
    collectionDiffer: (clauses) => `They differ by ${clauses}.`,
    andMore: (joined, rest) => `${joined} and ${rest} more`,
    qCollectionCount: (title) => `How many products are in ${title}?`,
    aCollectionCount: (n) => (n === 1 ? "1 product." : `${n} products.`),
    qCollectionOptions: (label, title) => `What ${label} options are there in ${title}?`,

    mirror: {
      attributeHeader: "| Attribute | Value |",
      description: "## Description",
      questions: "## Questions",
      whoItSuits: "## Who it suits",
      buyingIt: "## Buying it",
      partOf: "## Part of",
      store: "## Store",
      source: (url) => `Source: ${url}`,
      delivery: "Delivery",
      deliveryVaries: "Varies by product, stated on each product page",
      deliveryCost: "Delivery cost",
      from: (cost) => `From ${cost}`,
      returns: "Returns",
      days: (n) => (n === 1 ? "1 day" : `${n} days`),
      warranty: "Warranty",
      payment: "Payment",
    },
  },

  ro: {
    isA: (title, productType) => `${title} face parte din categoria ${productType}.`,
    isAProduct: (title) => `${title} este un produs.`,
    keyDetails: (clauses) => `Detalii principale: ${clauses}.`,

    qMaterial: (title) => `Ce material are ${title}?`,
    qDimensions: (title) => `Ce dimensiuni are ${title}?`,
    qSeats: (title) => `Câte locuri are ${title}?`,
    qIncludes: (title) => `Ce include ${title}?`,
    qIncludesOrSeats: (title) => `Ce include sau câte locuri are ${title}?`,
    qRoom: (title) => `Unde se folosește ${title}?`,

    qSafety: (title) => `Ce precauții trebuie respectate pentru ${title}?`,
    qUsage: (title) => `Cum se folosește ${title}?`,
    qComposition: (title) => `Ce conține ${title}?`,
    qStorage: (title) => `Cum se păstrează ${title}?`,
    qCare: (title) => `Cum se întreține ${title}?`,
    qCompatibility: (title) => `Cu ce se poate folosi ${title}?`,
    qSuitability: (title) => `Pentru cine este ${title}?`,
    qBenefits: (title) => `Ce avantaje are ${title}?`,
    qFinish: (title) => `Ce finisaj are ${title}?`,
    qOptions: (title) => `Ce opțiuni sunt disponibile pentru ${title}?`,
    qVendor: (title) => `Cine produce ${title}?`,

    qDelivery: (title) => `În cât timp se livrează ${title}?`,
    aDelivery: (time, cost, costIsFrom) =>
      cost ? `${time}. Livrarea costă ${costIsFrom ? "de la " : ""}${cost}.` : `${time}.`,
    qReturns: (title) => `Pot returna ${title}?`,
    aReturns: (days) => `Da, în termen de ${roCount(days, "zi", "zile")}.`,
    qWarranty: (title) => `Ce garanție are ${title}?`,
    months: (n) => roCount(n, "lună", "luni"),
    qPayment: () => "Cum pot plăti?",

    collectionCount: (title, n) => `${title} are ${roCount(n, "produs", "produse")}.`,
    collectionDiffer: (clauses) => `Diferă prin ${clauses}.`,
    andMore: (joined, rest) => `${joined} și încă ${rest}`,
    qCollectionCount: (title) => `Câte produse sunt în ${title}?`,
    aCollectionCount: (n) => `${roCount(n, "produs", "produse")}.`,
    qCollectionOptions: (label, title) => `Ce variante de ${label} există în ${title}?`,

    mirror: {
      attributeHeader: "| Atribut | Valoare |",
      description: "## Descriere",
      questions: "## Întrebări",
      whoItSuits: "## Pentru cine este",
      buyingIt: "## Cumpărare",
      partOf: "## Face parte din",
      store: "## Magazin",
      source: (url) => `Sursă: ${url}`,
      delivery: "Livrare",
      deliveryVaries: "Diferă de la un produs la altul, este indicată pe pagina fiecărui produs",
      deliveryCost: "Cost livrare",
      from: (cost) => `De la ${cost}`,
      returns: "Retur",
      days: (n) => roCount(n, "zi", "zile"),
      warranty: "Garanție",
      payment: "Plată",
    },
  },
};

/** The phrases for a language; absent or unknown is English, as before item 5. */
export function phrases(language?: Language | null): Phrases {
  return PHRASES[language === "ro" ? "ro" : "en"];
}

/** True when `q` is the material question in any language, whatever the title. */
export function isMaterialQuestion(q: string): boolean {
  return LANGUAGES.some((language) => {
    const [before, after] = PHRASES[language].qMaterial(" ").split(" ");
    return q.startsWith(before) && q.endsWith(after);
  });
}

/**
 * The product editor's answer preview (answer.ts). English only: it is part
 * of the app's own screens, and product UI is English (CLAUDE.md). Kept here
 * so no sentence lives anywhere else in the engine.
 */
export const ADMIN_PREVIEW = {
  qMaterialAndSize: (title: string) => `What is ${title} made of, and what size is it?`,
  qTellMe: (title: string) => `Tell me about ${title}.`,
  madeOf: (value: string) => `made of ${value}`,
  inColour: (value: string) => `in ${value}`,
  is: (title: string, details: string) => `${title} is ${details}.`,
  withoutApp: (bare: string) =>
    `${bare} No stated material, size or colour an assistant could compare.`,
};
