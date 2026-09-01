import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueue } from "../services/queue.server";

// Freshness without full passes (PRD §5.5): re-extract only what changed.
// The handler returns immediately; the work happens on the worker.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const shopRow = await db.shop.findUnique({ where: { domain: shop } });
  const productId = (payload as { admin_graphql_api_id?: string })?.admin_graphql_api_id;

  if (shopRow && productId) {
    // Same jobKey shape poll_changes uses (worker/tasks.ts) - a burst of
    // update webhooks for one product collapses to one queued job instead
    // of duplicating.
    await enqueue(
      "extract_product",
      { shopId: shopRow.id, productGid: productId },
      { jobKey: `extract:${productId}` },
    );
  }

  return new Response();
};
