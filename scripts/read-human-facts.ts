// Read only. A census of the facts rows a PERSON wrote on a store, so a pass
// can be proved not to have changed one.
//
// Written 12 September 2026 for batch 5 item 11, which asks for a count
// confirming that no human-written value changed across the per-row facts
// migration. Run it before the pass and after it; the two must match, row for
// row, and the script prints a digest so they can be compared without any
// product text being printed anywhere.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-human-facts.ts <shop-domain>
//
// It writes nothing: no metafield, no row, no Setting. It reads the catalogue
// once, the same read the catalogue pass makes, and prints counts and a hash
// only - never a label, never a value.

import crypto from "node:crypto";
import db from "../app/db.server";
import { adminGraphql } from "../app/services/admin.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { catalogueQuery } from "../app/services/eligibility";
import { prefsFor } from "../app/services/eligibility.server";
import { parseState } from "../app/services/facts.server";
import { factsHumanOf, humanRowCount, isWholeTableHuman, readFacts } from "../app/services/facts-human";

async function main() {
  const wanted = process.argv[2];
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });
  const shop = wanted ? shops.find((s) => s.domain === wanted) : shops.length === 1 ? shops[0] : null;
  if (!shop) {
    console.error(wanted ? `No installed shop ${wanted}.` : "Name the shop domain.");
    process.exit(1);
  }

  const graphql = await adminGraphql(shop.domain);
  const prefs = await prefsFor(shop.id);
  console.log(`Shop: ${shop.domain}`);
  console.log("Reading the catalogue (no writes)...\n");
  const { products } = await fetchAllProducts(graphql, catalogueQuery(prefs));

  let productsWithHuman = 0;
  let humanRows = 0;
  let wholeTable = 0;
  let wholeTableRows = 0;
  // One line per human row: product id, key, and a hash of the value. The
  // whole-table form and the per-row form write the SAME line, deliberately -
  // the migration converts one into the other and must not change the digest.
  // A row added, removed, re-keyed or re-valued does change it, without any
  // label or value being printed.
  const lines: string[] = [];

  for (const product of products) {
    const state = parseState(product);
    const stored = readFacts(product.metafields?.find((m) => m.key === "facts")?.value);
    const human = factsHumanOf(state);
    const n = humanRowCount(human);
    const whole = isWholeTableHuman(state, stored as never);
    if (whole) {
      wholeTable += 1;
      wholeTableRows += stored.length;
      for (const f of stored) lines.push(`${product.id}|${f.k}|${sha(String((f as any).v ?? ""))}`);
      continue;
    }
    if (n === 0) continue;
    productsWithHuman += 1;
    humanRows += n;
    for (const key of Object.keys(human)) {
      const value = stored.find((f) => f.k === key) as any;
      lines.push(`${product.id}|${key}|${sha(String(value?.v ?? ""))}`);
    }
  }

  lines.sort();
  const digest = sha(lines.join("\n"));

  console.log(`Products read: ${products.length}`);
  console.log(`Products with per-row protection: ${productsWithHuman}, holding ${humanRows} rows a person wrote.`);
  console.log(`Products still in the old whole-table form: ${wholeTable}, holding ${wholeTableRows} rows.`);
  console.log(`Rows a person owns, either way: ${humanRows + wholeTableRows}`);
  console.log(`\nDigest of every human row (product, key and a hash of the value): ${digest}`);
  console.log("Run this before a pass and after it. The row count may move as the");
  console.log("whole-table form converts to per-row; the DIGEST must not change,");
  console.log("because it is computed over the same rows and the same values either way.");
  await db.$disconnect();
}

function sha(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

main();
