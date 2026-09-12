// Read only. The engine's phrase table, English and Romanian side by side,
// rendered with a sample title so each row reads as the sentence a shopper
// actually sees rather than as a template.
//
// Written 12 September 2026 for batch 5 item 13, which asks for the table to
// be printed for Marius to approve in one read. It changes nothing.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-phrase-table.ts [--title "Some product"]

import { PHRASES, type Phrases } from "../app/engine/phrases";

const i = process.argv.indexOf("--title");
const T = i === -1 ? "Ulei de cocos 500 ml" : process.argv[i + 1];

/** Each row: the key, and how to render it in one language. */
const ROWS: [string, (p: Phrases) => string][] = [
  ["isA", (p) => p.isA(T, "supliment")],
  ["isAProduct", (p) => p.isAProduct(T)],
  ["keyDetails", (p) => p.keyDetails("bio, 500 ml")],
  ["qMaterial", (p) => p.qMaterial(T)],
  ["qDimensions", (p) => p.qDimensions(T)],
  ["qSeats", (p) => p.qSeats(T)],
  ["qIncludes", (p) => p.qIncludes(T)],
  ["qIncludesOrSeats", (p) => p.qIncludesOrSeats(T)],
  ["qRoom", (p) => p.qRoom(T)],
  ["qSafety", (p) => p.qSafety(T)],
  ["qUsage", (p) => p.qUsage(T)],
  ["qComposition", (p) => p.qComposition(T)],
  ["qStorage", (p) => p.qStorage(T)],
  ["qCare", (p) => p.qCare(T)],
  ["qCompatibility", (p) => p.qCompatibility(T)],
  ["qSuitability", (p) => p.qSuitability(T)],
  ["qBenefits", (p) => p.qBenefits(T)],
  ["qFinish", (p) => p.qFinish(T)],
  ["qOptions", (p) => p.qOptions(T)],
  ["qVendor", (p) => p.qVendor(T)],
  ["aboutProduct", (p) => p.aboutProduct(T, "Ce contine?")],
  ["qDelivery", (p) => p.qDelivery(T)],
  ["aDelivery", (p) => p.aDelivery("1-2 zile", "15 RON", false)],
  ["aDelivery (starting price)", (p) => p.aDelivery("1-2 zile", "15 RON", true)],
  ["qReturns", (p) => p.qReturns(T)],
  ["aReturns", (p) => p.aReturns(14)],
  ["qWarranty", (p) => p.qWarranty(T)],
  ["months", (p) => p.months(24)],
  ["qPayment", (p) => p.qPayment()],
  ["collectionCount", (p) => p.collectionCount("Uleiuri", 12)],
  ["collectionDiffer", (p) => p.collectionDiffer("volum si origine")],
  ["andMore", (p) => p.andMore("A, B, C", 4)],
  ["qCollectionCount", (p) => p.qCollectionCount("Uleiuri")],
  ["aCollectionCount", (p) => p.aCollectionCount(12)],
  ["qCollectionOptions", (p) => p.qCollectionOptions("Volum", "Uleiuri")],
  ["mirror.attributeHeader", (p) => p.mirror.attributeHeader],
  ["mirror.description", (p) => p.mirror.description],
  ["mirror.questions", (p) => p.mirror.questions],
  ["mirror.whoItSuits", (p) => p.mirror.whoItSuits],
  ["mirror.buyingIt", (p) => p.mirror.buyingIt],
  ["mirror.partOf", (p) => p.mirror.partOf],
  ["mirror.store", (p) => p.mirror.store],
  ["mirror.source", (p) => p.mirror.source("https://shop.example/products/x")],
  ["mirror.delivery", (p) => p.mirror.delivery],
  ["mirror.deliveryVaries", (p) => p.mirror.deliveryVaries],
  ["mirror.deliveryCost", (p) => p.mirror.deliveryCost],
  ["mirror.from", (p) => p.mirror.from("15 RON")],
  ["mirror.returns", (p) => p.mirror.returns],
  ["mirror.days", (p) => p.mirror.days(14)],
  ["mirror.warranty", (p) => p.mirror.warranty],
  ["mirror.payment", (p) => p.mirror.payment],
];

console.log(`Sample title: "${T}"\n`);
console.log("| Key | English | Romanian |");
console.log("|---|---|---|");
for (const [key, render] of ROWS) {
  const en = safe(() => render(PHRASES.en));
  const ro = safe(() => render(PHRASES.ro));
  console.log(`| \`${key}\` | ${en} | ${ro} |`);
}

function safe(f: () => string): string {
  try {
    return f().replace(/\|/g, "\|").replace(/\n/g, " ");
  } catch (e) {
    return `(threw: ${(e as Error).message})`;
  }
}
