// The manual path of PRD-SEO-FULL-ONPAGE §1.1: take the before-snapshot for a
// shop whose SEO key predates the SeoSnapshot table.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/seo-snapshot-take.ts <shop-domain>
//
// The honest thing about this path, and the reason it is a separate script
// with a separate `takenBy`: a snapshot taken after the key was already in use
// is not a before. The row is stamped `manual`, so every screen that renders
// it must say "since <date>" and can never say "since the start". Republica
// BIO is the case this exists for.
//
// It writes exactly one row and nothing else: no metafield, no Setting, no
// Shopify write of any kind. It reads the catalogue through the same bulk
// operation the nightly pass runs, and the SeoScan rows as they stand; it
// fetches no storefront page and spends none of the shop's page budget.
//
// It refuses twice over: when the shop cannot be identified beyond doubt, and
// when the shop already has a snapshot. Overwriting a real before with today's
// numbers under today's date is the one outcome worth writing a script to
// prevent.

import db from "../app/db.server";
import { describeGraphqlError } from "../app/services/graphql-errors";
import { adminGraphql } from "../app/services/admin.server";
import { snapshotLines, takeSeoSnapshot } from "../app/services/seo-snapshot.server";

async function main() {
  const wanted = process.argv[2];
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });

  // Exact domain first; a bare store name ("mrdigital-dev") is accepted as a
  // convenience, but only when it identifies exactly one shop. Anything
  // ambiguous is refused with the candidates listed, never guessed - this
  // script writes a row that cannot be taken again.
  let candidates = shops;
  if (wanted) {
    const exact = shops.filter((s: { domain: string }) => s.domain === wanted);
    candidates = exact.length > 0
      ? exact
      : shops.filter((s: { domain: string }) => s.domain.includes(wanted));
  }

  if (candidates.length !== 1) {
    console.log(
      wanted
        ? `Expected exactly one installed shop matching "${wanted}", found ${candidates.length}.`
        : `Expected one installed shop, found ${candidates.length}. Pass the domain as an argument.`,
    );
    for (const s of candidates) console.log(`  ${s.domain}`);
    await db.$disconnect();
    process.exitCode = 1;
    return;
  }

  const shop = candidates[0];
  console.log(`Shop: ${shop.domain}`);
  console.log("Reading the catalogue (one bulk operation, no writes to Shopify)...\n");

  const graphql = await adminGraphql(shop.domain);
  const result = await takeSeoSnapshot(shop.id, graphql, "manual");

  if (!result.written) {
    console.log(
      `Refused: this shop already has a snapshot, taken ${result.takenAt.toISOString()} ` +
        `by "${result.takenBy}". A snapshot is written once and never updated.`,
    );
    console.log("Read it with: npx tsx scripts/seo-snapshot-show.ts " + shop.domain);
    await db.$disconnect();
    process.exitCode = 1;
    return;
  }

  console.log('Snapshot written, takenBy "manual".\n');
  for (const line of snapshotLines(result.facts)) console.log(line);

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(describeGraphqlError(error, "seo-snapshot-take"));
  await db.$disconnect();
  process.exit(1);
});
