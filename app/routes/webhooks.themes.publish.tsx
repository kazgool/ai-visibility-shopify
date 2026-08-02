import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// TODO(phase-3): re-run theme Product JSON-LD detection (PRD §4.2), warn merchant.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[stub] ${topic} for ${shop}`);
  return new Response();
};
