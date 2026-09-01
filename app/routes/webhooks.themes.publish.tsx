import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { scanThemeForProductLd, recordNarrowThemeScan } from "../services/theme-scan.server";

// A theme change can silently introduce or remove a Product node, which is
// exactly when duplicate structured data appears (PRD §8). Re-scan on publish.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);

  const shopRow = await db.shop.findUnique({ where: { domain: shop } });
  if (!shopRow || !admin) return new Response();

  const themeId = String((payload as { id?: number })?.id ?? "current");

  // One product page is enough to tell what the theme emits.
  const res = await admin.graphql(`#graphql
    query FirstOnlineProduct {
      products(first: 1, query: "published_status:published") {
        nodes { onlineStoreUrl }
      }
    }
  `);
  const json = await res.json();
  const url = json.data?.products?.nodes?.[0]?.onlineStoreUrl;
  if (!url) return new Response();

  const password = await db.setting.findUnique({
    where: { shopId_key: { shopId: shopRow.id, key: "storefront_password" } },
  });

  try {
    const result = await scanThemeForProductLd(url, password?.value);
    // Narrow scan (product page only). recordNarrowThemeScan normalises the
    // payload's numeric theme id to the same gid-keyed row the admin
    // screens use, and merges into the SEO screen's rich detail rather than
    // replacing it - a theme publish must not erase the home-page scan,
    // robots findings or the weekly watch history.
    await recordNarrowThemeScan(shopRow.id, themeId, result, admin.graphql);
  } catch (error) {
    console.warn(`theme scan failed for ${shop}: ${String(error)}`);
  }

  return new Response();
};
