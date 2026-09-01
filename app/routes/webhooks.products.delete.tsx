import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// The product is gone from the store; its plain text mirror must go too,
// otherwise the proxy keeps serving a page for something nobody sells.
//
// The products/delete payload carries only the legacy numeric `id` - no
// handle, no admin_graphql_api_id. (A previous version of this handler read
// payload.handle, which is never present, so deleted products kept a live
// public mirror forever.) MirrorCache has no handle to match against here,
// so it is looked up by product GID, built from the numeric id the same way
// every other GraphQL call in this app addresses a product.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const shopRow = await db.shop.findUnique({ where: { domain: shop } });
  if (!shopRow) return new Response();

  const id = (payload as { id?: number | string })?.id;
  if (id != null) {
    const productGid = `gid://shopify/Product/${id}`;
    await db.mirrorCache.deleteMany({ where: { shopId: shopRow.id, productId: productGid } });
  }

  return new Response();
};
