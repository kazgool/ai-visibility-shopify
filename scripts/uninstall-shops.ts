// Uninstalls this app from the named shops with the Admin API appUninstall
// mutation (2025-07+). Irreversible for that installation; the merchant can
// install again. Shopify then sends app/uninstalled, which marks the Shop row.
//
// Decided by Marius on 20 Oct 2026 for the non-customer test installs whose
// webhooks kept the maintenance-mode machine awake (CHANGELOG).
//
//   npx tsx --env-file-if-exists=.env scripts/uninstall-shops.ts <domain>...         dry run
//   npx tsx --env-file-if-exists=.env scripts/uninstall-shops.ts <domain>... --yes   uninstall

import { adminGraphql } from "../app/services/admin.server";
import { describeGraphqlError } from "../app/services/graphql-errors";

// Never uninstalled by this script, whatever is passed.
const KEEP = new Set(["republicabio.myshopify.com", "mrdigital-dev.myshopify.com"]);

const args = process.argv.slice(2);
const execute = args.includes("--yes");
const shops = args.filter((a) => a !== "--yes");

if (shops.length === 0) {
  console.error("usage: uninstall-shops.ts <shop.myshopify.com>... [--yes]");
  process.exit(1);
}
for (const shop of shops) {
  if (!shop.endsWith(".myshopify.com")) throw new Error(`not a shop domain: ${shop}`);
  if (KEEP.has(shop)) throw new Error(`refusing to uninstall a kept shop: ${shop}`);
}

for (const shop of shops) {
  if (!execute) {
    console.log(`dry run: would uninstall from ${shop}`);
    continue;
  }
  try {
    const graphql = await adminGraphql(shop);
    const data: any = await graphql(`mutation { appUninstall { app { id } userErrors { field message } } }`, {});
    const errors = data?.appUninstall?.userErrors ?? [];
    console.log(errors.length ? `${shop}: FAILED ${JSON.stringify(errors)}` : `${shop}: uninstalled`);
  } catch (error) {
    // A revoked token surfaces as a thrown Response; the formatter reads it.
    console.log(`${shop}: FAILED ${describeGraphqlError(error, "appUninstall")}`);
  }
}
if (!execute) console.log("nothing changed; add --yes to uninstall");
process.exit(0);
