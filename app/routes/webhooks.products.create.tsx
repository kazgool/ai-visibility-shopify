import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueue } from "../services/queue.server";

// New products are the reason a merchant should never have to think about this
// app again after the first pass. A product created in the admin, imported by
// a CSV, or pushed by another app all fire this webhook.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const shopRow = await db.shop.findUnique({ where: { domain: shop } });
  const productId = (payload as { admin_graphql_api_id?: string })?.admin_graphql_api_id;

  if (shopRow && productId) {
    await enqueue("extract_product", { shopId: shopRow.id, productGid: productId });
  }

  return new Response();
};
