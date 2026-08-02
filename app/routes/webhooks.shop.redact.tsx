import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR: shop/redact, fired ~48h after uninstall. Delete every row we hold for
// the shop (ARCHITECTURE §4). Metafields live in the merchant's store and are
// intentionally untouched — the honest-exit promise (PRD §6.1).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[gdpr] ${topic} for ${shop}: deleting all shop rows`);

  await db.session.deleteMany({ where: { shop } });
  // Cascades cover settings, job runs, mirror cache, theme scans, crawler checks.
  await db.shop.deleteMany({ where: { domain: shop } });

  return new Response();
};
