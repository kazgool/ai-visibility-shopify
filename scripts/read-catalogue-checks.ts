// What checks A10 to A16 actually find on a real catalogue, without changing
// anything (PRD-SEO-FULL-ONPAGE section 5b, build step 4a).
//
// It writes nothing: no SeoScan row, no Setting, no metafield, no Shopify
// mutation. It runs exactly the reads the catalogue pass runs - one bulk
// export, one collections read, one URL redirects query and one menus query -
// and prints counts. It prints no product data beyond the handles a finding
// names, because a handle is what makes a count checkable and a description
// pasted into a terminal is a leak with a purpose.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-catalogue-checks.ts [shop-domain]
//
// Without an argument it picks the single installed shop and refuses to guess
// when there is more than one, like the other read-only scripts.

import db from "../app/db.server";
import { adminGraphql } from "../app/services/admin.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { fetchCollections } from "../app/services/collections.server";
import { catalogueQuery } from "../app/services/eligibility";
import { prefsFor } from "../app/services/eligibility.server";
import { readMenus, readUrlRedirects } from "../app/services/seo-scan.server";
import { buildCollectionSeoQueue } from "../app/services/seo-collections.server";
import {
  checkDuplicateDescription,
  checkHomeRedirect,
  checkImageFilenames,
  checkClickDepth,
  checkOrphan,
  duplicateDescriptions,
  homePageRedirects,
} from "../app/services/seo-catalogue";
import { CHECK_LABEL } from "../app/services/seo-findings";
import type { Finding } from "../app/services/seo-findings";

function row(code: string, count: number, denominator: number): string {
  const label = CHECK_LABEL[code as keyof typeof CHECK_LABEL] ?? code;
  return `  ${code.padEnd(4)} ${String(count).padStart(4)} of ${String(denominator).padEnd(5)} ${label}`;
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

  const graphql = await adminGraphql(shop.domain);
  const filter = catalogueQuery(await prefsFor(shop.id));
  console.log(`Shop: ${shop.domain}`);
  console.log(`Filter: ${filter}`);
  console.log("Reading the catalogue and the collections (no writes)...\n");

  const read = await fetchAllProducts(graphql, filter);
  const products = read.products;
  console.log(
    `Products read: ${products.length} of ${read.expected.root} announced` +
      (read.complete ? " (complete)" : " (INCOMPLETE)"),
  );

  const collections = await fetchCollections(graphql);
  const queue = buildCollectionSeoQueue(collections);
  console.log(`Collections read: ${queue.checked}`);
  console.log("");

  // The two per-pass Admin reads. Both can be refused, and a refusal is
  // printed as a refusal - never as a count of zero.
  const redirects = await readUrlRedirects(graphql);
  const menus = await readMenus(graphql);
  console.log(
    `URL redirects: ${redirects ? `${redirects.read} read${redirects.partial ? " (capped)" : ""}` : "COULD NOT BE READ - the Admin API refused the query"}`,
  );
  console.log(
    `Menus: ${menus ? `${menus.productIds.size} products linked by id, ${menus.handles.size} by address, ${menus.collectionDepth.size} collections in the tree` : "COULD NOT BE READ - the Admin API refused the query"}`,
  );
  console.log("");

  console.log("Collection checks, count of collections read:");
  console.log(row("A10", queue.thinDescription.length, queue.checked));
  console.log(row("A11", queue.thinMembership.length, queue.checked));
  if (queue.thinDescription.length > 0) {
    console.log(
      `       A10 example: ${queue.thinDescription[0].handle} has ${queue.thinDescription[0].words} words`,
    );
  }
  if (queue.thinMembership.length > 0) {
    console.log(
      `       A11 example: ${queue.thinMembership[0].handle} holds ${queue.thinMembership[0].products}`,
    );
  }
  console.log("");

  const sharedDescriptions = duplicateDescriptions(products);
  const homeRedirects = homePageRedirects(redirects);
  const counts = new Map<string, { count: number; example: Finding; handle: string }>();
  const bump = (finding: Finding | null, handle: string) => {
    if (!finding) return;
    const entry = counts.get(finding.code);
    if (entry) entry.count += 1;
    else counts.set(finding.code, { count: 1, example: finding, handle });
  };

  for (const product of products) {
    const handle = (product.handle ?? "").trim();
    bump(checkDuplicateDescription(sharedDescriptions.get(product.id)), handle);
    bump(checkHomeRedirect(homeRedirects?.byHandle.get(handle), redirects), handle);
    bump(checkImageFilenames(product), handle);
    bump(checkOrphan(product, menus), handle);
    // B28: numbered with the page checks, computed here because it needs no
    // page - the same menu tree A16 just used, plus collection membership.
    bump(checkClickDepth(product, menus), handle);
  }

  console.log("Product checks, count of products read:");
  for (const code of ["A12", "A13", "A15", "A16", "B28"]) {
    const entry = counts.get(code);
    // A check whose read was refused is said to be refused. A zero here would
    // claim it ran and found nothing.
    if ((code === "A13" && !redirects) || ((code === "A16" || code === "B28") && !menus)) {
      console.log(`  ${code.padEnd(4)}  could not be checked   ${CHECK_LABEL[code as "A13"]}`);
      continue;
    }
    console.log(row(code, entry?.count ?? 0, products.length));
    if (entry) console.log(`       example (${entry.handle}): ${JSON.stringify(entry.example.detail)}`);
  }

  if (homeRedirects && homeRedirects.unmatched.length > 0) {
    console.log("");
    console.log(
      `A13's other half: ${homeRedirects.unmatched.length} home-page redirects name no product row.`,
    );
  }

  console.log("");
  console.log("A14 does not exist: the Markets setting it asks about is not in the Admin API.");

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
