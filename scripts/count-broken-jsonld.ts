// Read-only. How many products were published with an invalid extend-mode
// Product node, and therefore with no structured data from this app at all.
//
// The extend node gave every optional field a trailing comma and the last one
// none, so the node was invalid JSON whenever `additionalProperty` was absent -
// that is, whenever the product had no extracted facts. It renders at all only
// when the product has facts or a summary, so the broken set is exactly:
//
//   a summary, and no facts.
//
// Every parser drops an invalid JSON-LD block silently, so for those products
// the app published nothing, and no screen said so: the page scan reads a
// dropped node exactly as it reads a theme that never emitted one.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/count-broken-jsonld.ts <shop-domain>
//
// One bulk read, no writes, and counts only - no title, no handle, no metafield
// value. Same rule as scripts/seo-fields-census.ts.

import db from "../app/db.server";
import { adminGraphql } from "../app/services/admin.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { catalogueQuery } from "../app/services/eligibility";
import { prefsFor } from "../app/services/eligibility.server";
import { describeGraphqlError } from "../app/services/graphql-errors";

function has(product: { metafields?: { key: string; value: string }[] }, key: string): boolean {
  const value = (product.metafields ?? []).find((m) => m.key === key)?.value;
  if (!value) return false;
  // An empty JSON array is not a value. `facts` is json and an empty list is
  // what an unprocessed product carries after a pass that found nothing.
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "[]" || trimmed === "{}" || trimmed === "null") return false;
  return true;
}

async function main() {
  const wanted = process.argv[2];
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });
  const shop = wanted
    ? shops.find((s: { domain: string }) => s.domain === wanted)
    : shops.length === 1
      ? shops[0]
      : null;
  if (!shop) {
    console.log(
      wanted
        ? `No installed shop with domain ${wanted}.`
        : `Expected one installed shop, found ${shops.length}. Pass the domain as an argument.`,
    );
    await db.$disconnect();
    return;
  }

  console.log(`READ ONLY: one bulk read, no writes, counts only. Shop: ${shop.domain}`);

  const graphql = await adminGraphql(shop.domain);
  const read = await fetchAllProducts(graphql, catalogueQuery(await prefsFor(shop.id)));
  const products = read.products;

  let facts = 0;
  let summary = 0;
  let both = 0;
  let neither = 0;
  let broken = 0;

  for (const product of products) {
    const f = has(product, "facts");
    const s = has(product, "summary");
    if (f) facts += 1;
    if (s) summary += 1;
    if (f && s) both += 1;
    if (!f && !s) neither += 1;
    // The node renders when facts or summary, and is invalid when facts are
    // absent. So: summary, no facts.
    if (s && !f) broken += 1;
  }

  const total = products.length;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  console.log(`Products read: ${total}${read.complete ? " (complete)" : " (SHORT READ)"}`);
  console.log(`  has extracted facts                 ${facts} of ${total} (${pct(facts)}%)`);
  console.log(`  has a generated summary             ${summary} of ${total} (${pct(summary)}%)`);
  console.log(`  has both                            ${both} of ${total} (${pct(both)}%)`);
  console.log(`  has neither, so no node was emitted ${neither} of ${total} (${pct(neither)}%)`);
  console.log("");
  console.log(
    `  PUBLISHED BROKEN (summary, no facts) ${broken} of ${total} (${pct(broken)}%)`,
  );
  console.log("");
  if (broken === 0) {
    console.log(
      "Nothing real was published broken: every product that emitted the extend node had facts,",
    );
    console.log("so `additionalProperty` was always the last field and the JSON always closed.");
  } else {
    console.log(
      `${broken} product page(s) carried an invalid node and published no structured data from`,
    );
    console.log("this app. They are fixed by the next deploy; no data was lost or overwritten.");
  }
  if (!read.complete) {
    console.log("The catalogue read was short, so these counts are a floor, not a total.");
  }

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(describeGraphqlError(error, "count-broken-jsonld"));
  await db.$disconnect();
  process.exit(1);
});
