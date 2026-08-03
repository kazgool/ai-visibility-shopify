// Billing (BILLING-SPEC).
//
// Two annual plans, no trial, no free tier. Shopify is the source of truth on
// every check: a locally cached plan is a bug waiting to happen when a
// merchant cancels from their admin.

import { createHash, timingSafeEqual } from "node:crypto";
import db from "../db.server";

export { PLANS, type PlanHandle } from "./plans";
import { PLANS, type PlanHandle } from "./plans";

/**
 * Comped access, for our own stores, agencies and anyone we choose to give the
 * app to. Two mechanisms, both outside Shopify's billing:
 *
 *  - MASTER_KEY: a secret typed once into the plans screen. Opens the gate for
 *    that shop permanently, no deploy needed.
 *  - FREE_SHOPS: a comma-separated allowlist of shop domains, for shops we
 *    want open without anyone typing anything.
 *
 * The key is never displayed anywhere in the interface and lives only in
 * `fly secrets`. Comparison is constant time, so the endpoint cannot be used
 * to guess it character by character.
 */
export function checkMasterKey(candidate: string): boolean {
  const expected = process.env.MASTER_KEY ?? "";
  if (expected === "" || candidate === "") return false;

  const a = createHash("sha256").update(candidate.trim()).digest();
  const b = createHash("sha256").update(expected.trim()).digest();
  return timingSafeEqual(a, b);
}

function allowlisted(shopDomain: string): boolean {
  return (process.env.FREE_SHOPS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(shopDomain.toLowerCase());
}

const COMP_KEY = "comped";

export async function grantComp(shopId: string, reason: string) {
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: COMP_KEY } },
    create: { shopId, key: COMP_KEY, value: reason },
    update: { value: reason },
  });
}

/** Does this shop have access without a Shopify subscription? */
export async function isComped(shopDomain: string, shopId?: string): Promise<boolean> {
  if (allowlisted(shopDomain)) return true;
  if (!shopId) return false;
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: COMP_KEY } },
  });
  return Boolean(row?.value);
}

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
  /**
   * Optional years of 100% discount (BILLING-SPEC). Unlike a comp, this goes
   * through Shopify: the subscription is real and shows as $0 on the
   * merchant's invoice, then bills normally when the discount runs out. Use it
   * for "first year free", not for permanent access.
   */
  freeYears = 0,
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
              ...(freeYears > 0
                ? {
                    discount: {
                      durationLimitInIntervals: freeYears,
                      value: { percentage: 1.0 },
                    },
                  }
                : {}),
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
