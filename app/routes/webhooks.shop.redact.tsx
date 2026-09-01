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

  // CrawlerHit is keyed by the shop *domain string*, with no foreign key to
  // Shop, so the onDelete: Cascade below never reaches it - it has to be
  // deleted explicitly, by domain, before the Shop row goes.
  await db.crawlerHit.deleteMany({ where: { shopId: shop } });

  // Cascades cover settings, job runs, mirror cache, theme scans.
  // This also deletes the Shop row's freeProductsUsed counter. FREE-TIER-SPEC
  // §4 wants that count to survive a reinstall, but the law wins over that
  // preference on a redact request: keeping any shop data past a redact,
  // including a usage counter, to preserve a demo experience is not a
  // defensible reason to retain data (decided by Marius, 1 September 2026;
  // see FREE-TIER-SPEC.md §4 for the dated note). The three products already
  // written keep their metafields in the merchant's store regardless, so the
  // demo value is already spent by the time this fires.
  await db.shop.deleteMany({ where: { domain: shop } });

  return new Response();
};
