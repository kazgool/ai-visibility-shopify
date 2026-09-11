// The evidence behind every intent keyword of app/engine/faq.ts
// (CC-PROMPT-AI-READABILITY-3 items 2b and 8).
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/corpus-keywords.ts [--out _shopify/corpus/intent-keywords.md]
//
// Reads the dev stores only, parses each description exactly as the engine
// does (parseBlocks), and for every keyword counts the dev products and
// stores with a heading containing it, with the most frequent such heading.
// A keyword with a count of 0 has no business in the list. Read only.
import fs from "node:fs";
import { INTENT_KEYWORDS, INTENT_ORDER, keywordMatches, parseBlocks } from "../app/engine/faq";
import { normalize } from "../app/engine/normalize";
import { DEV_STORES, loadStore } from "./corpus-headings";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx === -1 ? null : args[outIdx + 1];

const headings: { store: string; labels: string[] }[] = [];
let products = 0;
for (const store of DEV_STORES) {
  for (const p of loadStore(store)) {
    products++;
    const labels = [...new Set(parseBlocks(p.body_html ?? "").filter((b) => b.label).map((b) => b.label!))];
    headings.push({ store, labels });
  }
}

const lines = [
  "# Intent keywords and their corpus counts",
  "",
  `Counted by \`npx tsx scripts/corpus-keywords.ts\` over the ${DEV_STORES.length} dev stores (${products} products),`,
  "reading each description exactly as `app/engine/faq.ts` does. Products: dev products with at",
  "least one heading containing the keyword. The hold-out stores are not read.",
  "",
  "| Intent | Language | Keyword | Dev products | Dev stores | Most frequent heading (products) |",
  "|---|---|---|---|---|---|",
];
for (const intent of INTENT_ORDER) {
  for (const language of ["en", "ro"] as const) {
    const list = INTENT_KEYWORDS[language][intent];
    if (!list || list.length === 0) {
      lines.push(`| ${intent} | ${language} | (none: no dev heading) | 0 | 0 | - |`);
      continue;
    }
    for (const keyword of list) {
      const stores = new Set<string>();
      const freq = new Map<string, number>();
      let n = 0;
      for (const h of headings) {
        const hit = h.labels.filter((l) => keywordMatches(l, keyword));
        if (hit.length === 0) continue;
        n++;
        stores.add(h.store);
        for (const l of hit) freq.set(normalize(l), (freq.get(normalize(l)) ?? 0) + 1);
      }
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
      lines.push(`| ${intent} | ${language} | ${keyword} | ${n} | ${stores.size} | ${top ? `${top[0]} (${top[1]})` : "-"} |`);
    }
  }
}
const text = lines.join("\n") + "\n";
if (out) fs.writeFileSync(out, text);
console.log(text);
