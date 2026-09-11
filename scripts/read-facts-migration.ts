// Read-only. The dry run of the facts protection migration
// (CC-PROMPT-AI-READABILITY-4 item 4b e): how many products and variants hold
// their facts in the old whole-table form, and how many rows the conversion
// turns into rows a person wrote or deleted.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-facts-migration.ts [shop-domain]
//
// It writes nothing: no metafield, no row, no Setting. The conversion itself
// is not done by this script - there is no new write path to Shopify. It is
// done by the facts writers the catalogue pass and the product webhook
// already run (writeFacts, writeVariantFacts), once per product, the first
// time either writes it after the deploy; so "apply" is Fill catalogue, and a
// second run of this script afterwards reads 0. The conversion is idempotent:
// a converted state is not the old form, so it is never converted twice.
//
// It reads the catalogue once, the same read the catalogue pass makes, and
// prints counts only, never product text.
import db from "../app/db.server";
import { adminGraphql } from "../app/services/admin.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { catalogueQuery } from "../app/services/eligibility";
import { prefsFor } from "../app/services/eligibility.server";
import { dictionaryFor, extraStopwordsFor } from "../app/services/extract.server";
import { parseState, type ProductState } from "../app/services/facts.server";
import { factKey, isWholeTableHuman, readFacts } from "../app/services/facts-human";
import { extractProduct, splitFactsByLevel } from "../app/engine";

type Tally = { owners: number; markedHuman: number; noState: number; rows: number; deletes: number };
const empty = (): Tally => ({ owners: 0, markedHuman: 0, noState: 0, rows: 0, deletes: 0 });

function tally(t: Tally, state: ProductState, stored: { k: string }[], fresh: { k: string }[]) {
  if (!isWholeTableHuman(state, stored as never)) return;
  t.owners += 1;
  if (state.facts?.source === "human") t.markedHuman += 1;
  else t.noState += 1;
  t.rows += stored.length;
  const keys = new Set(stored.map((f) => factKey(f.k)));
  t.deletes += new Set(fresh.map((f) => factKey(f.k)).filter((k) => !keys.has(k))).size;
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

  console.log(`Shop: ${shop.domain}`);
  console.log("Reading the catalogue (no writes)...\n");
  const graphql = await adminGraphql(shop.domain);
  const dictionary = await dictionaryFor(shop.id);
  const extraStopwords = await extraStopwordsFor(shop.id);
  const prefs = await prefsFor(shop.id);
  const catalogue = await fetchAllProducts(graphql, catalogueQuery(prefs));

  const products = empty();
  const variants = empty();
  for (const product of catalogue.products) {
    const fresh = extractProduct(product, dictionary, { extraStopwords });
    const split = splitFactsByLevel(fresh, product.variants ?? []);
    tally(
      products,
      parseState(product),
      readFacts(product.metafields?.find((m) => m.key === "facts")?.value),
      split.productFacts,
    );
    for (const variant of product.variants ?? []) {
      const raw = variant.metafields?.find((m) => m.key === "state")?.value;
      let state: ProductState = {};
      try {
        state = raw ? (JSON.parse(raw) as ProductState) : {};
      } catch {
        state = {};
      }
      tally(
        variants,
        state,
        readFacts(variant.metafields?.find((m) => m.key === "facts")?.value),
        split.perVariant.get(variant.id) ?? [],
      );
    }
  }

  const line = (label: string, t: Tally) =>
    console.log(
      `${label}: ${t.owners} to convert (${t.markedHuman} marked edited by hand, ${t.noState} with facts and no record of who wrote them); ` +
        `${t.rows} rows become rows a person wrote, ${t.deletes} rows the engine finds that their table leaves out become rows a person deleted.`,
    );
  console.log(`Products read: ${catalogue.products.length}${catalogue.complete === false ? " (the download was incomplete)" : ""}`);
  line("Products", products);
  line("Variants", variants);
  console.log(
    "\nNothing was written. The conversion happens through the existing facts writers on the next Fill catalogue, " +
      "or on each product's next update. Run this again afterwards: it should read 0 to convert.",
  );
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
