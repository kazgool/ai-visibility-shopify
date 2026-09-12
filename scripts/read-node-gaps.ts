// Read-only. The product pages the last scan read that carried no Product
// node at all - neither the theme's nor ours - with everything the row
// records about why.
//
// Written 12 September 2026 for batch 5 item 2: Republica BIO's Structured
// data card counts 3 such pages out of 182 read, and the question is whether
// the cause is ours (our block not rendering) or the store's (a template
// without the embed, a redirect, or a page that is not a product page).
//
// Unlike scripts/read-seo-rows.ts this prints the handle, because a handle is
// what makes the page openable and the three of them are the whole answer. It
// still prints no product text: no title, no description, no finding prose.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-node-gaps.ts <shop-domain>
//
// It writes nothing and makes no Shopify request.

import db from "../app/db.server";
import { findingsOf } from "../app/services/seo-findings";
import { productNodesOf } from "../app/services/seo-aggregate";

async function main() {
  const domain = process.argv[2];
  const shops = await db.shop.findMany({ select: { id: true, domain: true } });
  const shop = domain ? shops.find((s) => s.domain === domain) : shops.length === 1 ? shops[0] : null;
  if (!shop) {
    console.error(domain ? `No shop ${domain}.` : "Name the shop domain.");
    process.exit(1);
  }

  const rows = await db.seoScan.findMany({
    where: { shopId: shop.id, scannedAt: { not: null }, status: "ok" },
    select: {
      productId: true,
      handle: true,
      scannedAt: true,
      status: true,
      canonical: true,
      noindex: true,
      appBlock: true,
      nodes: true,
      findings: true,
      pageTitle: true,
    },
  });

  const gaps = rows.filter((r) => productNodesOf(r.nodes, findingsOf(r.findings)).distinct === 0);
  console.log(`${shop.domain}: ${rows.length} pages read, ${gaps.length} with no Product node.\n`);

  for (const r of gaps) {
    const { ours, theirs, distinct } = productNodesOf(r.nodes, findingsOf(r.findings));
    const nodes = Array.isArray(r.nodes) ? (r.nodes as any[]) : [];
    console.log(`product ${r.productId}  handle ${r.handle ?? "(null)"}`);
    console.log(`  scannedAt   ${r.scannedAt?.toISOString()}`);
    console.log(`  status      ${r.status}`);
    console.log(`  canonical   ${r.canonical ?? "(null)"}`);
    console.log(`  noindex     ${r.noindex}`);
    console.log(`  appBlock    ${r.appBlock ?? "(null)"}`);
    console.log(`  titleTag    ${r.pageTitle == null ? "(null)" : `${r.pageTitle.length} chars`}`);
    console.log(`  productNodes ours=${ours} theirs=${theirs} distinct=${distinct}`);
    console.log(`  nodes       ${nodes.length} total`);
    for (const n of nodes) {
      console.log(`    ${(n?.types ?? []).join("+") || "(no @type)"}  id=${n?.id ?? "(no @id)"}`);
    }
    console.log(`  findings    ${findingsOf(r.findings).map((f) => f.code).join(", ") || "(none)"}`);
    console.log("");
  }
  await db.$disconnect();
}

main();
