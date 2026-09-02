import fs from "node:fs";
import {
  extractProduct, coverage, buildSummary, buildQuestions, buildFitFor,
  buildMetaTitle, buildMetaDescription, computeTermGap,
  checkCitationReadiness, DEFAULT_STOPWORDS, stopwordSet,
} from "../app/engine";
import { buildAltText } from "../app/engine/alt-text";

const which = process.argv[2] ?? "rb";
let products: { id: string; title: string; descriptionHtml: string; handle: string; price?: string; vendor?: string; productType?: string }[] = [];
let dict = "";
if (which === "rb") {
  const raw = JSON.parse(fs.readFileSync("/tmp/rb/p1.json", "utf8")).products;
  products = raw.map((p: any) => ({
    id: String(p.id), title: p.title, descriptionHtml: p.body_html ?? "", handle: p.handle,
    price: p.variants?.[0]?.price, vendor: p.vendor, productType: p.product_type,
  }));
  dict = fs.readFileSync("/tmp/rb/dict.txt", "utf8");
} else {
  // furniture: parse Shopify CSV export (title, body html) - minimal parser
  const csv = fs.readFileSync("/sessions/inspiring-vibrant-newton/mnt/AI Visibility SHOPIFY/globalmobila-shopify-products.csv", "utf8");
  const { parse } = require("csv-parse/sync");
  const rows = parse(csv, { columns: true, relax_quotes: true, relax_column_count: true });
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
for (const [i, p] of products.entries()) {
  const facts = extractProduct(p, dict);
  perCount.push(facts.length);
  for (const f of facts) allFacts.push({ title: p.title, k: f.k, v: f.v });
  if (i % Math.ceil(products.length / 6) === 0 || facts.length === 0) {
    const input = { title: p.title, descriptionHtml: p.descriptionHtml, facts, price: p.price, currency: "RON", available: true, vendor: p.vendor, productType: p.productType };
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

fs.writeFileSync(`/tmp/rb/samples-${which}.json`, JSON.stringify(samples, null, 2));
console.log(`\nsamples written: ${samples.length}`);
