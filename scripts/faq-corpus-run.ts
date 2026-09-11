// Runs app/engine/faq.ts over the FAQ corpus (CC-PROMPT-AI-READABILITY-3).
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/faq-corpus-run.ts <run-name> [--set dev|holdout|all] [--store <name>]
//
// Writes _shopify/corpus/runs/<run-name>/<store>.json with every product's
// outline (the description as the engine reads it), facts, options and FAQ,
// which the judge batches and scripts/faq-corpus-report.ts read. Prints counts
// only, never product text, so running the hold-out does not open it.
// Default set: dev. Read only.
import fs from "node:fs";
import path from "node:path";
import {
  buildFaq, descriptionOutline, extractProduct, presetText, DEFAULT_DICTIONARY,
  type FaqItem,
} from "../app/engine";
import { csvProducts } from "./csv";
import { CORPUS_STORES } from "./corpus-stores";

type Raw = {
  id: string | number; title: string; handle: string; body_html?: string | null;
  vendor?: string; product_type?: string; options?: { name: string; values: string[] }[];
};

export function loadCorpusStore(name: string): Raw[] {
  const file = path.join("_shopify/corpus/stores", name.endsWith(".csv") ? name : `${name}.json`);
  const text = fs.readFileSync(file, "utf8");
  return name.endsWith(".csv") ? csvProducts(text) : JSON.parse(text).products;
}

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const run = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!run) throw new Error("usage: faq-corpus-run.ts <run-name> [--set dev|holdout|all] [--store name]");
const set = flag("--set") ?? "dev";
const only = flag("--store");
const outDir = path.join("_shopify/corpus/runs", run);
fs.mkdirSync(outDir, { recursive: true });

const stores = CORPUS_STORES.filter((s) => (set === "all" || s.set === set) && (!only || s.name === only));
console.log("| Store | Set | Products | Q&A | per product | with none | section | merchant | mapping | preset | variants | vendor | business |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const store of stores) {
  const dictionary = store.dictionary
    ? fs.readFileSync(store.dictionary, "utf8")
    : store.preset ? presetText(store.preset) : DEFAULT_DICTIONARY;
  const products = loadCorpusStore(store.name);
  const bySource: Record<string, number> = {};
  let total = 0;
  let none = 0;
  const out = products.map((p) => {
    const html = p.body_html ?? "";
    const facts = extractProduct({ title: p.title, descriptionHtml: html }, dictionary);
    const faq: FaqItem[] = buildFaq({
      title: p.title,
      descriptionHtml: html,
      options: p.options ?? [],
      vendor: p.vendor,
      productType: p.product_type,
      facts,
      business: store.business ?? null,
      language: store.language,
      presetId: store.preset,
      shopName: store.shopName,
    });
    total += faq.length;
    if (faq.length === 0) none++;
    for (const f of faq) bySource[f.source] = (bySource[f.source] ?? 0) + 1;
    return {
      id: String(p.id), handle: p.handle, title: p.title,
      vendor: p.vendor ?? "", productType: p.product_type ?? "",
      options: (p.options ?? []).map((o) => ({ name: o.name, values: o.values })),
      facts, outline: descriptionOutline(html), faq,
    };
  });
  fs.writeFileSync(
    path.join(outDir, `${store.name}.json`),
    JSON.stringify({ store: store.name, set: store.set, language: store.language, preset: store.preset, business: store.business ?? null, products: out }, null, 1),
  );
  const s = (k: string) => bySource[k] ?? 0;
  console.log(`| ${store.name} | ${store.set} | ${products.length} | ${total} | ${(total / Math.max(1, products.length)).toFixed(2)} | ${none} | ${s("section")} | ${s("merchant")} | ${s("mapping")} | ${s("preset")} | ${s("variants")} | ${s("vendor")} | ${s("business")} |`);
}
