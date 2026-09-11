// Read-only. "Written by this app since the snapshot": the count the `current`
// row holds, next to the same count taken from the catalogue now
// (CC-PROMPT-AI-READABILITY-3 addendum, item 12).
//
// The stored count used to be taken only at the end of a complete catalogue
// pass, so a write made after that pass (a meta title applied on the SEO
// screen, alt text written by the button) was missing from it until the next
// pass. The jobs that write now recount when they finish. This script shows
// both numbers side by side, so the gap can be seen on a live shop before the
// deploy and its closing after it.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-written-since.ts [shop-domain]
//
// It writes nothing: no metafield, no row, no Setting. It reads the catalogue
// once, the same read the catalogue pass makes. It prints counts and dates
// only, never product text.
import db from "../app/db.server";
import { adminGraphql } from "../app/services/admin.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { catalogueQuery } from "../app/services/eligibility";
import { prefsFor } from "../app/services/eligibility.server";
import { readSeoSnapshot, writtenSince } from "../app/services/seo-snapshot.server";
import { WRITTEN_KEYS } from "../app/services/seo-since";

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

  const before = await readSeoSnapshot(shop.id);
  if (!before) {
    console.log(`${shop.domain}: no snapshot, so nothing is counted "since" anything.`);
    await db.$disconnect();
    return;
  }
  const current = await db.seoSnapshot.findUnique({
    where: { shopId_takenBy: { shopId: shop.id, takenBy: "current" } },
  });

  console.log(`Shop: ${shop.domain}`);
  console.log(`Snapshot (${before.takenBy}): ${before.takenAt.toISOString()}`);
  console.log(
    `Stored count: taken with the catalogue pass of ${current?.takenAt.toISOString() ?? "never"}, ` +
      `counted against ${current?.writtenSinceAt?.toISOString() ?? "nothing"}`,
  );
  console.log("Reading the catalogue (no writes)...\n");

  const graphql = await adminGraphql(shop.domain);
  const read = await fetchAllProducts(graphql, catalogueQuery(await prefsFor(shop.id)));
  if (!read.complete) {
    console.log(`The read was short (${read.read.root} of ${read.expected.root}); no live count is shown.`);
    await db.$disconnect();
    return;
  }
  const live = writtenSince(read.products, before.takenAt);
  const stored = (current?.writtenSince ?? {}) as Record<string, { count: number; latest: string | null }>;

  console.log("Key                 stored   live   latest stored              latest live");
  for (const key of WRITTEN_KEYS) {
    const s = stored[key];
    const l = live[key];
    console.log(
      `${key.padEnd(18)} ${String(s?.count ?? 0).padStart(7)} ${String(l?.count ?? 0).padStart(6)}   ` +
        `${(s?.latest ?? "-").padEnd(26)} ${l?.latest ?? "-"}`,
    );
  }
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
