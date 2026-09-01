import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { planFromName, recordPlan } from "../services/billing.server";
import { adminGraphql } from "../services/admin.server";

// Closes the hole in `mayProcessAutomaticallyCached` (billing.server.ts): it
// reads `Shop.plan`, which was refreshed only when a merchant opened the app
// (app.tsx's loader). A shop that cancels from the Shopify admin and never
// returns kept `Shop.plan` pointing at its last-known paid plan forever, so
// every products/update webhook for that shop kept running a full paid
// extraction through extract_product - poll_changes and sweep_missing were
// already correctly stopping (they check live via mayProcessAutomatically),
// but the webhook path has no loop of its own to gate and relies entirely
// on this cached column.
//
// Payload shape verified against shopify.dev's webhook payload reference
// (2026-07 API version, fetched during this change): a top-level
// `app_subscription` object with `status` ("ACTIVE" | "CANCELLED" |
// "EXPIRED" | "FROZEN" | "PENDING" | "DECLINED", matching the
// AppSubscriptionStatus GraphQL enum) and `admin_graphql_api_shop_id`. The
// read below is defensive about the exact shape regardless, since a webhook
// payload is not something this app controls.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const subscription = (payload as { app_subscription?: Record<string, unknown> } | null)
    ?.app_subscription;
  const status =
    typeof subscription?.status === "string" ? subscription.status.toUpperCase() : null;

  if (!status) {
    // Malformed or unrecognised payload: do nothing rather than guess a
    // plan change from data we cannot read. The live checks
    // (mayProcessAutomatically) remain the authority either way; this
    // webhook only keeps the cached column from going stale sooner.
    return new Response();
  }

  const shopRow = await db.shop.findUnique({ where: { domain: shop } });
  if (!shopRow) return new Response();

  if (status === "ACTIVE") {
    // The webhook does not carry which of our plan handles this is in a
    // form planFromName can use reliably (it matches on the display name,
    // e.g. "AI Visibility Standard"), so an ACTIVE update prompts a fresh,
    // authoritative read from Shopify rather than trusting the payload's
    // own `name` field - the same source recordPlan callers already treat
    // as truth elsewhere (app.tsx's loader).
    try {
      const graphql = await adminGraphql(shop);
      const data = await graphql<{
        currentAppInstallation?: {
          activeSubscriptions?: { name: string; status: string }[];
        };
      }>(`#graphql
        query ActiveSubscriptionForWebhook {
          currentAppInstallation {
            activeSubscriptions { name status }
          }
        }
      `);
      const active = data?.currentAppInstallation?.activeSubscriptions?.find(
        (s) => s.status === "ACTIVE",
      );
      const plan = active ? planFromName(active.name) : null;
      await recordPlan(shop, plan ?? "none");
    } catch (error) {
      // A failed re-read must not silently mark the shop paid; leave the
      // cached column as it was and let the next poll_changes/sweep_missing
      // pass (which check live, not cached) or the merchant's next visit to
      // app.tsx correct it.
      console.error(`app_subscriptions/update: failed to re-read plan for ${shop}: ${error}`);
    }
  } else {
    // CANCELLED, EXPIRED, FROZEN, DECLINED, or anything else not ACTIVE:
    // this shop no longer has paid access through this subscription. This
    // is exactly the case FREE-TIER-SPEC and mayProcessAutomaticallyCached's
    // own comment describe as the hole - "cancel and never return" - so it
    // is recorded immediately rather than waiting for the merchant to open
    // the app again.
    await recordPlan(shop, "none");
  }

  return new Response();
};
