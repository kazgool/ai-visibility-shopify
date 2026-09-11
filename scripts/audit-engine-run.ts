// Runs the engine over a catalogue on disk and prints what it produces.
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/audit-engine-run.ts rb <products.json> <dictionary.txt> [--dump out.json] [--business rb] [--lang ro]
//   npx tsx scripts/audit-engine-run.ts furniture <products.csv> [--dump out.json] [--lang en]
//
// rb        a storefront /products.json read (Republica BIO: 189 products,
//           `https://republicabio.ro/products.json?limit=250`) and the
//           merchant's dictionary (`F:\AI Visibility SHOPIFY\dictionar-republicabio-curatat.txt`).
// furniture a Shopify CSV export, empty dictionary = DEFAULT_DICTIONARY
//           (`F:\AI Visibility SHOPIFY\globalmobila-shopify-products.csv`, 355 products).
//
// --dump      writes every product's facts, summary, questions and fit_for to a
//             JSON file, which scripts/audit-engine-report.ts turns into metrics.
// --business  rb: the commercial answers Republica BIO's live FAQ carried on
//             11 September 2026 (delivery "1-2", 15 RON, 14 days, payment
//             methods). Without it no business answers are passed.
// --lang      the content language passed to the engine, "en" or "ro".
//
// Read only: nothing is written anywhere but the dump file.
import fs from "node:fs";
import path from "node:path";
import {
  extractProduct, coverage, buildSummary, buildQuestions, buildFitFor,
  buildMetaTitle, buildMetaDescription, computeTermGap,
  checkCitationReadiness, stopwordSet, type BusinessInfo,
} from "../app/engine";
import { buildAltText } from "../app/engine/alt-text";
import { buildFaq } from "../app/engine/faq";
import { parseCsv } from "./csv";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));

const which = positional[0] ?? "rb";
const lang = flag("--lang") === "ro" ? "ro" : "en";
const RB_BUSINESS: BusinessInfo = {
  deliveryTime: "1-2",
  deliveryCost: "15 RON",
  returnDays: 14,
  paymentMethods:
    "Card bancar (Visa, Mastercard); Apple Pay; Ramburs (plata la livrare); Transfer bancar/ordin de plată în contul Republica BIO",
};
const business = flag("--business") === "rb" ? RB_BUSINESS : null;

let products: { id: string; title: string; descriptionHtml: string; handle: string; price?: string; vendor?: string; productType?: string }[] = [];
let dict = "";
if (which === "rb") {
  if (!positional[1] || !positional[2]) throw new Error("rb needs <products.json> <dictionary.txt>");
  const raw = JSON.parse(fs.readFileSync(positional[1], "utf8")).products;
  products = raw.map((p: any) => ({
    id: String(p.id), title: p.title, descriptionHtml: p.body_html ?? "", handle: p.handle,
    price: p.variants?.[0]?.price, vendor: p.vendor, productType: p.product_type,
  }));
  dict = fs.readFileSync(positional[2], "utf8");
} else {
  // furniture: parse Shopify CSV export (title, body html) - minimal parser
  if (!positional[1]) throw new Error("furniture needs <products.csv>");
  const rows = parseCsv(fs.readFileSync(positional[1], "utf8"));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r["Title"] || seen.has(r["Handle"])) continue;
    seen.add(r["Handle"]);
    products.push({ id: r["Handle"], title: r["Title"], descriptionHtml: r["Body (HTML)"] ?? "", handle: r["Handle"], price: r["Variant Price"], vendor: r["Vendor"], productType: r["Type"] });
  }
  dict = ""; // DEFAULT_DICTIONARY
}

const stop = stopwordSet([]);
const cov = coverage(products, dict);
console.log(`== ${which}: ${products.length} products ==`);
console.log(`none: ${cov.none}  byAttr:`, cov.byAttr.slice(0, 30));

const perCount: number[] = [];
const allFacts: { title: string; k: string; v: string }[] = [];
const samples: any[] = [];
const dump: any[] = [];
for (const [i, p] of products.entries()) {
  const facts = extractProduct(p, dict);
  perCount.push(facts.length);
  for (const f of facts) allFacts.push({ title: p.title, k: f.k, v: f.v });
  const input = { title: p.title, descriptionHtml: p.descriptionHtml, facts, price: p.price, currency: "RON", available: true, vendor: p.vendor, productType: p.productType, business, language: lang } as const;
  dump.push({
    id: p.id, title: p.title, facts,
    summary: buildSummary(input),
    questions: buildQuestions(input),
    // What the live path passes buildFaq: the shop's name, and the preset
    // effectivePresetId gives a shop with no stored one (an empty dictionary
    // reads as furniture). No mappings, the default cap, no options (a
    // products.json read carries them, a CSV row does not; left out on both).
    faq: buildFaq({
      title: p.title, descriptionHtml: p.descriptionHtml, facts, vendor: p.vendor,
      shopName: which === "rb" ? "Republica BIO" : "Global Mobila",
      presetId: dict.trim() === "" ? "furniture" : null,
      business, language: lang,
    }),
    fit_for: buildFitFor(input),
  });
  if (i % Math.ceil(products.length / 6) === 0 || facts.length === 0) {
    samples.push({
      title: p.title, facts,
      summary: buildSummary(input),
      questions: buildQuestions(input),
      fit_for: buildFitFor(input),
      alt: buildAltText({ title: p.title, productType: p.productType }, facts),
      metaTitle: buildMetaTitle({ title: p.title, descriptionHtml: p.descriptionHtml, facts, vendor: p.vendor } as any),
      metaDesc: buildMetaDescription({ title: p.title, descriptionHtml: p.descriptionHtml, facts, vendor: p.vendor } as any),
      citation: checkCitationReadiness({ title: p.title, handle: p.handle, questions: buildQuestions(input) } as any),
    });
  }
}
perCount.sort((a, b) => a - b);
console.log(`facts/product: min ${perCount[0]} median ${perCount[Math.floor(perCount.length / 2)]} max ${perCount[perCount.length - 1]} total ${allFacts.length}`);

// value inventory per label (to spot false positives)
const byLabel = new Map<string, Map<string, number>>();
for (const f of allFacts) {
  if (!byLabel.has(f.k)) byLabel.set(f.k, new Map());
  const m = byLabel.get(f.k)!;
  // ", " is the joiner extract.ts uses; a bare comma is part of a value.
  for (const v of f.v.split(/,\s/).map((s) => s.trim())) m.set(v, (m.get(v) ?? 0) + 1);
}
console.log("\n== value inventory (top 12 per label) ==");
for (const [k, m] of byLabel) {
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, n]) => `${v} (${n})`).join(" | ");
  console.log(`${k}: ${top}`);
}

console.log("\n== term gap top 25 ==");
const gap = computeTermGap(products.map((p) => ({ id: p.id, title: p.title, descriptionHtml: p.descriptionHtml })), stop, { limit: 25 });
console.log(gap.map((r: any) => `${r.term} (${r.products ?? r.count ?? JSON.stringify(r)})`).join(" | "));

const dumpPath = flag("--dump");
if (dumpPath) {
  fs.writeFileSync(dumpPath, JSON.stringify({ which, lang, business: business !== null, products: dump }, null, 2));
  fs.writeFileSync(path.join(path.dirname(dumpPath), `samples-${which}.json`), JSON.stringify(samples, null, 2));
  console.log(`\ndump written: ${dump.length} products to ${dumpPath}`);
}
