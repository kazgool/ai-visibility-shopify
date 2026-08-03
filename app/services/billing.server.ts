// Billing (BILLING-SPEC).
//
// Two annual plans, no trial, no free tier. Shopify is the source of truth on
// every check: a locally cached plan is a bug waiting to happen when a
// merchant cancels from their admin.

import db from "../db.server";
import type { GraphqlFn } from "./admin.server";

export type PlanHandle = "standard" | "high_volume";

export const PLANS: Record<
  PlanHandle,
  { name: string; amount: number; limit: number | null; blurb: string }
> = {
  standard: {
    name: "Standard",
    amount: 99,
    limit: 20000,
    blurb: "Everything the app does, for catalogues up to 20,000 products.",
  },
  high_volume: {
    name: "High volume",
    amount: 149,
    limit: null,
    blurb: "The same features for larger catalogues, with priority support.",
  },
};

const ACTIVE_SUBSCRIPTIONS = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        currentPeriodEnd
      }
    }
  }
`;

const CREATE_SUBSCRIPTION = `#graphql
  mutation CreateSubscription(
    $name: String!
    $returnUrl: URL!
    $test: Boolean!
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      lineItems: $lineItems
    ) {
      confirmationUrl
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

export type Subscription = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  currentPeriodEnd?: string | null;
};

/** What Shopify says right now. Never cached for access decisions. */
export async function activeSubscription(
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
): Promise<Subscription | null> {
  const res = await graphql(ACTIVE_SUBSCRIPTIONS);
  const json = await res.json();
  const subs: Subscription[] =
    json.data?.currentAppInstallation?.activeSubscriptions ?? [];
  return subs.find((s) => s.status === "ACTIVE") ?? null;
}

export function planFromName(name: string): PlanHandle | null {
  const entry = Object.entries(PLANS).find(([, p]) => p.name === name);
  return (entry?.[0] as PlanHandle) ?? null;
}

/**
 * Start a subscription. Annual interval, no trial days (BILLING-SPEC §2).
 * Development stores must charge in test mode or Shopify refuses.
 */
export async function startSubscription(
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
  plan: PlanHandle,
  returnUrl: string,
  isTestStore: boolean,
): Promise<{ confirmationUrl?: string; error?: string }> {
  const details = PLANS[plan];

  const res = await graphql(CREATE_SUBSCRIPTION, {
    variables: {
      name: details.name,
      returnUrl,
      test: isTestStore,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              interval: "ANNUAL",
              price: { amount: details.amount, currencyCode: "USD" },
            },
          },
        },
      ],
    },
  });

  const json = await res.json();
  const errors = json.data?.appSubscriptionCreate?.userErrors ?? [];
  if (errors.length) {
    return { error: errors.map((e: { message: string }) => e.message).join("; ") };
  }
  return { confirmationUrl: json.data?.appSubscriptionCreate?.confirmationUrl };
}

/** Keep our copy in step for display and reporting only. */
export async function recordPlan(shopDomain: string, plan: PlanHandle | "none") {
  await db.shop.updateMany({ where: { domain: shopDomain }, data: { plan } });
}

export type LimitState = {
  count: number;
  limit: number | null;
  over: boolean;
  graceEndsAt: Date | null;
  graceExpired: boolean;
};

const GRACE_DAYS = 14;

/**
 * Enforcement is deliberately gentle (BILLING-SPEC §3): crossing the limit
 * starts a grace period and shows a banner. Only after grace do we withhold
 * full passes, and even then webhook-driven extraction keeps running.
 */
export async function limitState(
  shopId: string,
  plan: PlanHandle | "none",
  productCount: number,
): Promise<LimitState> {
  const limit = plan === "none" ? null : PLANS[plan].limit;
  const over = limit !== null && productCount > limit;

  const key = "grace_started_at";
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key } },
  });

  if (!over) {
    if (row) await db.setting.delete({ where: { shopId_key: { shopId, key } } });
    return { count: productCount, limit, over: false, graceEndsAt: null, graceExpired: false };
  }

  const startedAt = row?.value ? new Date(row.value) : new Date();
  if (!row) {
    await db.setting.upsert({
      where: { shopId_key: { shopId, key } },
      create: { shopId, key, value: startedAt.toISOString() },
      update: {},
    });
  }

  const graceEndsAt = new Date(startedAt.getTime() + GRACE_DAYS * 86_400_000);
  return {
    count: productCount,
    limit,
    over: true,
    graceEndsAt,
    graceExpired: Date.now() > graceEndsAt.getTime(),
  };
}
