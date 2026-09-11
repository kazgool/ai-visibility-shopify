// Read-only. The SEO dashboard's headline for one shop, twice: counted over
// every finding, as it was, and over the findings a merchant sees, as it is
// now (CC-PROMPT-AI-READABILITY-3 addendum, items 9 and 15).
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-dashboard-visibility.ts [shop-domain]
//
// It reads the stored SeoScan rows only. It makes no Shopify request and
// writes nothing, and it prints counts and check codes, never product text.
// Without a domain it picks the single installed shop and refuses to guess
// when there is more than one, like the other read-only scripts.
import db from "../app/db.server";
import { codeCanShow, MERCHANT_VISIBLE, type FindingCode } from "../app/services/seo-findings";
import { readinessOf, type Readiness } from "../app/services/seo-readiness";
import type { ScanRowLike } from "../app/services/seo-aggregate";

function line(label: string, r: Readiness): string {
  return (
    `${label.padEnd(8)} products ${r.products}, fully checked ${r.readSet}, nothing to fix ${r.clean}, ` +
    `you ${r.merchant}, theme ${r.theme}, us ${r.app}, not checked ${r.notChecked}; ` +
    `shop-wide: ${r.shopWideCodes.length ? r.shopWideCodes.join(", ") : "none"}`
  );
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

  const rows = (await db.seoScan.findMany({
    where: { shopId: shop.id },
    select: { productId: true, handle: true, bulkAt: true, scannedAt: true, status: true, findings: true },
  })) as ScanRowLike[];

  const before = readinessOf(rows, () => true);
  const after = readinessOf(rows);
  console.log(`Shop: ${shop.domain}, ${rows.length} scan rows`);
  console.log(line("Before", before));
  console.log(line("Now", after));

  // Per group, the rows that left it.
  for (const group of ["merchant", "theme", "app"] as const) {
    const was = before.groups.find((g) => g.group === group)?.rows ?? [];
    const now = new Set((after.groups.find((g) => g.group === group)?.rows ?? []).map((r) => r.code));
    const gone = was.filter((r) => !now.has(r.code)).map((r) => `${r.code} (${r.count})`);
    if (gone.length) console.log(`Left the "${group}" group: ${gone.join(", ")}`);
  }
  const hidden = (Object.keys(MERCHANT_VISIBLE) as FindingCode[]).filter((c) => !codeCanShow(c));
  console.log(`Checks on no merchant surface: ${hidden.length} (${hidden.join(", ")})`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
