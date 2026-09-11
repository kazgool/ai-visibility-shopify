// What each trade preset extracts on the dev stores of its vertical
// (CC-PROMPT-AI-READABILITY-3 item 2d): the evidence for which preset groups
// get a question template. A template ships only for a group whose values
// read as clean answers here.
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/corpus-preset-values.ts [--out _shopify/corpus/preset-values.md]
//
// Dev stores only, with the preset corpus-stores.ts gives them. Read only.
import fs from "node:fs";
import { extractProduct, presetText } from "../app/engine";
import { loadStore } from "./corpus-headings";
import { CORPUS_STORES } from "./corpus-stores";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx === -1 ? null : args[outIdx + 1];

const lines = [
  "# Preset groups on the dev stores",
  "",
  "Counted by `npx tsx scripts/corpus-preset-values.ts`: every dev store that runs a preset,",
  "the values each group extracted (products carrying the value) and the top eight.",
  "",
];
for (const store of CORPUS_STORES.filter((s) => s.set === "dev" && s.preset)) {
  const dict = presetText(store.preset!);
  const products = loadStore(store.name);
  const by = new Map<string, Map<string, number>>();
  let withAny = 0;
  for (const p of products) {
    const facts = extractProduct({ title: p.title, descriptionHtml: p.body_html ?? "" }, dict);
    if (facts.length) withAny++;
    for (const x of facts) {
      const m = by.get(x.k) ?? new Map();
      by.set(x.k, m);
      m.set(x.v, (m.get(x.v) ?? 0) + 1);
    }
  }
  lines.push(`## ${store.name} (${store.preset}): ${withAny} of ${products.length} products with a fact`, "");
  for (const [k, m] of by) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, c]) => `${v} (${c})`).join(" | ");
    lines.push(`- ${k} [${total}]: ${top}`);
  }
  lines.push("");
}
const text = lines.join("\n");
if (out) fs.writeFileSync(out, text);
console.log(text);
