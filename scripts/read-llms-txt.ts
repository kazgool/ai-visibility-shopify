// Read only. Renders the exact llms.txt body the proxy route would serve
// for one shop, without an HTTP round trip, and reports whether the
// Products section is present and how many entries it carries.
//
// Written 11 September 2026 because WebFetch reported zero product mirror
// links in the live https://republicabio.ro/apps/ai-visibility/llms.txt,
// and a fetch tool truncating a 150+ KB page before its own summariser
// reads it is not evidence of what the page contains (working rule: curl
// and WebFetch prove nothing about a page they did not fully read).
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-llms-txt.ts <shop-domain>

import db from "../app/db.server";
import { llmsTxtBody } from "../app/services/llms-txt.server";

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

  const mirrorCount = await db.mirrorCache.count({ where: { shopId: shop.id } });
  const body = await llmsTxtBody(shop.id, shop.domain);

  console.log(`READ ONLY: rendered llms.txt in-process for ${shop.domain}\n`);
  console.log(`  MirrorCache rows           ${mirrorCount}`);
  console.log(`  rendered body length       ${body.length} chars`);
  console.log(`  has "## Products" heading  ${body.includes("## Products")}`);
  console.log(`  has "## Optional"          ${body.includes("## Optional")}`);

  const productsIdx = body.indexOf("## Products");
  const collectionsIdx = body.indexOf("## Optional");
  console.log(`  Products heading at char   ${productsIdx}`);
  console.log(`  Optional heading at char   ${collectionsIdx}`);

  const productLines = body
    .split("\n")
    .filter((l) => l.startsWith("- [") && l.includes("): store page "));
  console.log(`  product mirror lines       ${productLines.length}`);
  console.log("\n  first 3 product lines:");
  for (const l of productLines.slice(0, 3)) console.log(`    ${l}`);
  console.log("\n  last 3 product lines:");
  for (const l of productLines.slice(-3)) console.log(`    ${l}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
