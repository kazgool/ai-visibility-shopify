import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// The product is gone from the store; its plain text mirror must go too,
// otherwise the proxy keeps serving a page for something nobody sells.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const shopRow = await db.shop.findUnique({ where: { domain: shop } });
  if (!shopRow) return new Response();

  const handle = (payload as { handle?: string })?.handle;
  if (handle) {
    await db.mirrorCache.deleteMany({ where: { shopId: shopRow.id, handle } });
  }

  return new Response();
};
