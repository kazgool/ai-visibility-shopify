// Read-only. Prints one shop's before-snapshot as counts
// (PRD-SEO-FULL-ONPAGE build step 1).
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/seo-snapshot-show.ts <shop-domain>
//
// It writes nothing anywhere, reads no catalogue and fetches no page: one
// database row, printed. Use it to check what a snapshot recorded before
// deciding whether the manual path in seo-snapshot-take.ts is needed at all -
// a shop that already has a row must never be re-snapshotted, and this is how
// you find out without trying.

import db from "../app/db.server";
import { describeGraphqlError } from "../app/services/graphql-errors";
import {
  factsOfRow,
  readSeoSnapshot,
  snapshotLines,
} from "../app/services/seo-snapshot.server";

async function main() {
  const wanted = process.argv[2];
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });

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
  const row = await readSeoSnapshot(shop.id);

  console.log(`Shop: ${shop.domain}`);
  if (!row) {
    console.log(
      "No snapshot. This shop has never been unlocked since the table existed. " +
        "If its SEO key predates the table, take one by hand: " +
        `npx tsx scripts/seo-snapshot-take.ts ${shop.domain}`,
    );
    await db.$disconnect();
    return;
  }

  console.log(`Taken: ${row.takenAt.toISOString()} by "${row.takenBy}"`);
  if (row.takenBy === "manual") {
    console.log(
      'Taken by hand after the key was already in use, so it is a "since this date" ' +
        'and never a "since the start".',
    );
  }
  console.log("");
  for (const line of snapshotLines(factsOfRow(row))) console.log(line);

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(describeGraphqlError(error, "seo-snapshot-show"));
  await db.$disconnect();
  process.exit(1);
});
