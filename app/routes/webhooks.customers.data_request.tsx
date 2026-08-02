import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// GDPR: customers/data_request. We store no customer data (ARCHITECTURE §4) —
// acknowledge and log. HMAC is verified by authenticate.webhook.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[gdpr] ${topic} for ${shop}: no customer data held, nothing to return`);
  return new Response();
};
