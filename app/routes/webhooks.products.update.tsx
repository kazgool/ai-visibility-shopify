import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// TODO(phase-2): queue re-extraction for the changed product only (PRD §5.5).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[stub] ${topic} for ${shop}`);
  return new Response();
};
