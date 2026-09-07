// Run the engine over a Shopify product CSV export and print every fact it
// extracts, product by product, grouped by the CSV's Tags column, with one
// preset per tag. Read-only; touches no store and no database.
//
//   npx tsx scripts/test-catalog-gap.ts <path-to-products.csv>
//
// Written 5 September 2026 to see what the shipped presets catch on
// descriptions written by a shop owner who never heard of this app. Kept
// because the question comes back with every new preset.

import fs from "node:fs";
import { extractProduct } from "../app/engine/index";
import { PRESETS, DEFAULT_DICTIONARY } from "../app/engine/dictionary";

// Tag (lowercased) to preset key. A tag with no entry falls back to the
// default (furniture) dictionary, which is what a shop that never chose a
// trade would get.
const PRESET_FOR_TAG: Record<string, string> = {
  electronics: "electronics",
  phones: "phones",
  "mobile phones": "phones",
  laptops: "laptops",
  jewelry: "jewelry",
  jewellery: "jewelry",
  medical: "medical",
  "medical devices": "medical",
  supplements: "supplements",
  clothing: "clothing",
};

// Dependency-free CSV reader for a double-quote-escaped file with no
// embedded newlines outside quotes. Enough for a Shopify export; not a
// general parser.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0] ?? [];
  return rows
    .slice(1)
    .filter((r) => r.length > 1)
    .map((r) => {
      const o: Record<string, string> = {};
      header.forEach((h, idx) => (o[h] = r[idx] ?? ""));
      return o;
    });
}

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx scripts/test-catalog-gap.ts <path-to-products.csv>");
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(path, "utf8"));
const byTag = new Map<string, Record<string, string>[]>();
for (const r of rows) {
  if (!r.Handle) continue;
  const tag = (r.Tags || "").trim().toLowerCase();
  if (!byTag.has(tag)) byTag.set(tag, []);
  byTag.get(tag)!.push(r);
}

let products = 0;
let empty = 0;
for (const [tag, list] of byTag) {
  const presetKey = PRESET_FOR_TAG[tag];
  const dict = presetKey ? PRESETS[presetKey].lines.join("\n") : DEFAULT_DICTIONARY;
  console.log(`\n========== ${tag || "(no tag)"}  (preset: ${presetKey ?? "default"}) ==========`);
  for (const p of list) {
    products += 1;
    const facts = extractProduct({ title: p.Title, descriptionHtml: p["Body (HTML)"] }, dict);
    console.log(`\n-- ${p.Title} --`);
    if (facts.length === 0) {
      empty += 1;
      console.log("  (no facts extracted)");
    } else {
      for (const f of facts) console.log(`  ${f.k}: ${f.v}`);
    }
  }
}
console.log(`\n${products} products, ${empty} with no facts`);
