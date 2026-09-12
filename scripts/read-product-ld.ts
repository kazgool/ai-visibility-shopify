// Read only. Fetch one or more named product pages exactly as the nightly page
// read does, and print every JSON-LD node the page carries: its @type, its
// @id, whether it is ours, and the properties a question is usually asked
// about (name, additionalProperty, hasShippingService, shippingDetails).
//
// scripts/read-ld-visible.ts answers "is our markup visible text", over the
// sitemap's first N products. This answers "what is on THIS page", which is
// what a page-level question needs: batch 5 item 2 (three pages on Republica
// BIO carried no Product node at all) and item 12 (did the Product fragment
// merge into our complete node, or is the page carrying two).
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-product-ld.ts <shop-domain> <handle> [handle...]
//
// It writes nothing: no row, no Setting, no metafield, no Admin call, and it
// does not spend the shop's daily page budget.

import db from "../app/db.server";
import { readProductPage } from "../app/services/seo-page.server";
import { extractLdObjects, OUR_NODE_MARKER, storefrontCookie } from "../app/services/theme-scan.server";

const typeOf = (node: any) =>
  Array.isArray(node?.["@type"]) ? node["@type"].join("/") : String(node?.["@type"] ?? "(no @type)");

async function main() {
  const [domain, ...handles] = process.argv.slice(2);
  if (!domain || handles.length === 0) {
    console.error("read-product-ld: npx tsx scripts/read-product-ld.ts <shop-domain> <handle> [handle...]");
    process.exit(1);
  }

  const shop = await db.shop.findFirst({ where: { domain, uninstalledAt: null } });
  if (!shop) {
    console.log(`No installed shop with domain ${domain}.`);
    return;
  }
  const passwordRow = await db.setting.findUnique({
    where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
  });
  const origin = `https://${shop.domain}`;
  const cookie = passwordRow?.value ? await storefrontCookie(origin, passwordRow.value) : null;

  console.log(`READ ONLY: JSON-LD on named product pages, ${shop.domain}`);
  console.log(`Storefront password: ${passwordRow?.value ? (cookie ? "unlocked" : "refused") : "none saved"}\n`);

  for (const handle of handles) {
    const page = await readProductPage(`${origin}/products/${handle}`, cookie);
    console.log(`/products/${handle}`);
    console.log(`  status        ${page.status}${page.error ? ` (${page.error})` : ""}`);
    console.log(`  password page ${page.passwordProtected}`);
    if (page.chain?.length) {
      console.log(`  redirects     ${page.chain.map((h: any) => `${h.status} -> ${h.to}`).join(" | ")}`);
    }
    if (page.error || page.status !== 200 || !page.html) {
      console.log("");
      continue;
    }
    const nodes = extractLdObjects(page.html);
    const products = nodes.filter((n) => typeOf(n).split("/").includes("Product"));
    console.log(`  JSON-LD nodes ${nodes.length}, of them Product ${products.length}`);
    for (const node of nodes) {
      const ours = node[OUR_NODE_MARKER] !== undefined;
      console.log(`  - ${typeOf(node)}${ours ? " (ours)" : ""}  @id=${node["@id"] ?? "(none)"}`);
      const keys = Object.keys(node).filter((k) => k !== OUR_NODE_MARKER);
      console.log(`      keys: ${keys.join(", ") || "(none)"}`);
      if ("name" in node) console.log(`      name: ${String(node.name).slice(0, 80)}`);
      if ("additionalProperty" in node) {
        const props = Array.isArray(node.additionalProperty) ? node.additionalProperty : [node.additionalProperty];
        console.log(`      additionalProperty: ${props.length} entries`);
        for (const p of props) console.log(`        - ${p?.name}: ${p?.value}`);
      }
      if ("hasShippingService" in node) {
        console.log(`      hasShippingService: ${JSON.stringify(node.hasShippingService)}`);
      }
      if ("offers" in node) {
        const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
        for (const o of offers) {
          if (o && "shippingDetails" in o) {
            console.log(`      offers.shippingDetails: ${JSON.stringify(o.shippingDetails)}`);
          }
        }
      }
    }
    const html = page.html;
    console.log(`  transitTimeLabel in the page HTML: ${html.includes("transitTimeLabel") ? "PRESENT" : "absent"}`);
    console.log("");
  }
  await db.$disconnect();
}

main();
