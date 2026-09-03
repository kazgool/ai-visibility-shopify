// Read-only. Section 0 of PRD-SEO-PER-PRODUCT: the cheap read that decides
// which of the per-product SEO checks is worth a card and which is worth a
// line.
//
// It runs one bulk export - the same `productsBulkQuery` the catalogue pass
// already runs, with the three variant fields added - and counts. It writes
// nothing: no metafield, no database row, no Setting. It prints no product
// data either: no title, no handle, no SKU, no barcode, no meta text. Only
// counts and percentages, because the question it answers is "how many", and
// a census that pastes a catalogue into a terminal is a leak with a purpose.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/seo-fields-census.ts [shop-domain]
//
// Without an argument it picks the single installed shop, and refuses to
// guess when there is more than one.

import db from "../app/db.server";
import { adminGraphql } from "../app/services/admin.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { catalogueQuery } from "../app/services/eligibility";
import { prefsFor } from "../app/services/eligibility.server";
import { classifyMetaField } from "../app/services/seo.server";

/** "132 of 355 (37%)" - the denominator on every line, per PRD section 2. */
function line(label: string, n: number, total: number): string {
  const pct = total === 0 ? 0 : Math.round((n / total) * 100);
  return `  ${label.padEnd(38)} ${String(n).padStart(5)} of ${total} (${pct}%)`;
}

/**
 * How many products share a value with at least one other product, and how
 * big the largest such group is. Blank values are not a collision: they are
 * counted separately as absent.
 */
function collisions(values: (string | null | undefined)[]): {
  products: number;
  groups: number;
  largest: number;
} {
  const byValue = new Map<string, number>();
  for (const v of values) {
    const key = (v ?? "").trim();
    if (!key) continue;
    byValue.set(key, (byValue.get(key) ?? 0) + 1);
  }
  let products = 0;
  let groups = 0;
  let largest = 0;
  for (const count of byValue.values()) {
    if (count < 2) continue;
    groups += 1;
    products += count;
    if (count > largest) largest = count;
  }
  return { products, groups, largest };
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

  const prefs = await prefsFor(shop.id);
  const filter = catalogueQuery(prefs);
  console.log(`Shop: ${shop.domain}`);
  console.log(`Filter: ${filter}`);
  console.log("Reading the catalogue (one bulk operation, no writes)...\n");

  const graphql = await adminGraphql(shop.domain);

  // The whole catalogue, not only the eligible slice, so every count below
  // has a second denominator. A census that reports "50 of 50" without
  // saying that the store holds more products states a percentage that is
  // true of the filter and false of the shop.
  const all = await graphql<any>(`{ productsCount { count } }`);
  const inShop = Number(all?.productsCount?.count ?? 0);

  const read = await fetchAllProducts(graphql, filter);
  const products = read.products;
  const total = products.length;

  console.log(
    `Products read: ${total} of ${read.expected.root} announced` +
      (read.complete ? " (complete)" : " (INCOMPLETE - the counts below are of a short read)"),
  );
  console.log(`Products in the shop, unfiltered: ${inShop}`);
  console.log("");

  let barcode = 0;
  let barcodeEvery = 0;
  let vendor = 0;
  let sku = 0;
  let skuEvery = 0;
  let image = 0;
  let imageAlt = 0;
  let variantPrice = 0;
  let compareAt = 0;
  let metaTitle = 0;
  let metaDescription = 0;
  let both = 0;
  let neither = 0;
  let titleHuman = 0;
  let titleOutside = 0;
  let titleAuto = 0;
  let variantsTotal = 0;
  let multiVariant = 0;

  for (const p of products) {
    const variants = p.variants ?? [];
    variantsTotal += variants.length;
    if (variants.length > 1) multiVariant += 1;

    const withBarcode = variants.filter((v) => (v.barcode ?? "").trim() !== "").length;
    if (withBarcode > 0) barcode += 1;
    if (variants.length > 0 && withBarcode === variants.length) barcodeEvery += 1;

    const withSku = variants.filter((v) => (v.sku ?? "").trim() !== "").length;
    if (withSku > 0) sku += 1;
    if (variants.length > 0 && withSku === variants.length) skuEvery += 1;

    if (variants.some((v) => (v.price ?? "").trim() !== "")) variantPrice += 1;
    if (variants.some((v) => (v.compareAtPrice ?? "").trim() !== "")) compareAt += 1;

    if ((p.vendor ?? "").trim() !== "") vendor += 1;
    if ((p.imageUrl ?? "").trim() !== "") image += 1;
    if ((p.imageAlt ?? "").trim() !== "") imageAlt += 1;

    const hasTitle = (p.seo?.title ?? "").trim() !== "";
    const hasDescription = (p.seo?.description ?? "").trim() !== "";
    if (hasTitle) metaTitle += 1;
    if (hasDescription) metaDescription += 1;
    if (hasTitle && hasDescription) both += 1;
    if (!hasTitle && !hasDescription) neither += 1;

    // Same classifier the SEO screen uses, so these counts and the screen's
    // cannot disagree: "outside" is a value with no state entry of ours.
    const state = classifyMetaField(
      { id: p.id, metafields: p.metafields ?? [], seo: p.seo ?? null },
      "seo_title",
    );
    if (state === "human") titleHuman += 1;
    if (state === "outside") titleOutside += 1;
    if (state === "auto") titleAuto += 1;
  }

  const titleCollisions = collisions(products.map((p) => p.seo?.title));
  const descriptionCollisions = collisions(products.map((p) => p.seo?.description));
  const productTitleCollisions = collisions(products.map((p) => p.title));

  console.log("Rich-result identifiers (check A1)");
  console.log(line("has a barcode on some variant", barcode, total));
  console.log(line("has a barcode on every variant", barcodeEvery, total));
  console.log(line("has a vendor", vendor, total));
  console.log(line("has a SKU on some variant", sku, total));
  console.log(line("has a SKU on every variant", skuEvery, total));
  console.log(line("has a featured image", image, total));
  console.log(line("featured image has alt text", imageAlt, total));
  console.log("");

  console.log("Offer fields (check A2)");
  console.log(line("has a variant price", variantPrice, total));
  console.log(line("has a compare-at price", compareAt, total));
  console.log(line("has more than one variant", multiVariant, total));
  console.log(`  variants read in total               ${variantsTotal}`);
  console.log("");

  console.log("Meta fields (checks A3 and A5)");
  console.log(line("has a meta title", metaTitle, total));
  console.log(line("has a meta description", metaDescription, total));
  console.log(line("has both", both, total));
  console.log(line("has neither", neither, total));
  console.log(line("meta title written by a human here", titleHuman, total));
  console.log(line("meta title from outside this app", titleOutside, total));
  console.log(line("meta title written by this app", titleAuto, total));
  console.log("");

  console.log("Duplication (check A3)");
  console.log(
    line("meta titles shared with another product", titleCollisions.products, total),
  );
  console.log(
    `  distinct colliding meta titles        ${titleCollisions.groups}, largest group ${titleCollisions.largest}`,
  );
  console.log(
    line(
      "meta descriptions shared with another",
      descriptionCollisions.products,
      total,
    ),
  );
  console.log(
    `  distinct colliding descriptions       ${descriptionCollisions.groups}, largest group ${descriptionCollisions.largest}`,
  );
  console.log(
    line("product titles shared with another", productTitleCollisions.products, total),
  );
  console.log(
    `  distinct colliding product titles     ${productTitleCollisions.groups}, largest group ${productTitleCollisions.largest}`,
  );

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
