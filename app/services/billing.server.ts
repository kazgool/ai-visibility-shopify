// Billing (BILLING-SPEC).
//
// Two annual plans, no trial, no free tier. Shopify is the source of truth on
// every check: a locally cached plan is a bug waiting to happen when a
// merchant cancels from their admin.

import { createHash, timingSafeEqual } from "node:crypto";
import db from "../db.server";
import type { GraphqlFn } from "./admin.server";
import { NAMESPACE } from "./facts.server";

export { PLANS, type PlanHandle } from "./plans";
import { PLANS, type PlanHandle } from "./plans";

/**
 * Comped access, for our own stores, agencies and anyone we choose to give the
 * app to. One mechanism: MASTER_KEY, a secret typed once into the plans
 * screen, which opens the gate for that shop permanently, no deploy needed.
 *
 * There was also a FREE_SHOPS allowlist; it was removed deliberately. Two
 * ways to bypass billing means two things to remember when testing the
 * funnel, and the one nobody remembers is the one that silently makes a
 * paid-flow QA meaningless.
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

const COMP_KEY = "comped";

export async function grantComp(shopId: string, reason: string) {
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: COMP_KEY } },
    create: { shopId, key: COMP_KEY, value: reason },
    update: { value: reason },
  });
}

/** Does this shop have access without a Shopify subscription? */
export async function isComped(_shopDomain: string, shopId?: string): Promise<boolean> {
  if (!shopId) return false;
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: COMP_KEY } },
  });
  return Boolean(row?.value);
}

/**
 * A second, unrelated switch: a capability inside the published app, turned
 * on per shop by a key that only the operator has, entered during a paid
 * setup engagement. The merchant never types it, and unlike `checkMasterKey`
 * this grants no billing bypass and no plan - it only lets the storefront
 * block emit a few additional schema.org properties (see the theme block).
 *
 * Same mechanism as `checkMasterKey` on purpose: a single secret, compared in
 * constant time so the field cannot be used to guess it, never logged, never
 * hardcoded, never displayed anywhere in the interface. The key lives only in
 * `fly secrets` / `.env`.
 */
export function checkSeoUnlockKey(candidate: string): boolean {
  const expected = process.env.SEO_UNLOCK_KEY ?? "";
  if (expected === "" || candidate === "") return false;

  const a = createHash("sha256").update(candidate.trim()).digest();
  const b = createHash("sha256").update(expected.trim()).digest();
  return timingSafeEqual(a, b);
}

const SEO_UNLOCK_KEY_SETTING = "seo_unlocked";

/** Same write pattern as `grantComp`: a per-shop Setting row, no expiry. */
export async function grantSeoUnlock(shopId: string, reason: string) {
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: SEO_UNLOCK_KEY_SETTING } },
    create: { shopId, key: SEO_UNLOCK_KEY_SETTING, value: reason },
    update: { value: reason },
  });
}

/** Does this shop have the seo_unlocked switch on? */
export async function isSeoUnlocked(shopId?: string): Promise<boolean> {
  if (!shopId) return false;
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SEO_UNLOCK_KEY_SETTING } },
  });
  return Boolean(row?.value);
}

/**
 * Turn the switch back off. Until this existed, `grantSeoUnlock` was the
 * only mechanism that ever touched the `seo_unlocked` Setting row, so the
 * sole way back was editing the database by hand - not a path anyone
 * exposed on purpose. Same shape as `grantSeoUnlock`: delete the row rather
 * than writing a falsy value, so `isSeoUnlocked`'s existing `Boolean(row?.value)`
 * check needs no change and a deleted row cannot be mistaken for "never
 * granted" versus "granted, then revoked" in a way that matters - neither
 * state should unlock anything.
 *
 * Callers must also call `syncSeoUnlockMetafield` right after this succeeds,
 * the same way `grantSeoUnlock` callers already do - the Liquid block reads
 * the mirrored shop metafield, not this database row, and a revoke that
 * never resyncs it leaves the storefront believing the module is still on.
 */
export async function revokeSeoUnlock(shopId: string) {
  await db.setting.deleteMany({
    where: { shopId, key: SEO_UNLOCK_KEY_SETTING },
  });
}

const SEO_UNLOCK_SHOP_ID = `#graphql
  query SeoUnlockShopId { shop { id } }
`;

const SET_SEO_UNLOCK_METAFIELD = `#graphql
  mutation SetShopSeoUnlock($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/**
 * Mirror the `seo_unlocked` Setting row to a shop metafield with public
 * storefront read access - the same pattern `business.server.ts` and
 * `theme-scan.server.ts` use to hand a database value to Liquid, which has no
 * way to read our database directly. Called right after `grantSeoUnlock` or
 * `revokeSeoUnlock` succeeds - both change the flag, so both must resync the
 * mirror; it reads the current value from the database itself (via
 * `isSeoUnlocked`) rather than trusting the caller to say which direction it
 * moved, so grant and revoke can share this one function.
 */
export async function syncSeoUnlockMetafield(
  shopId: string,
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
): Promise<void> {
  const unlocked = await isSeoUnlocked(shopId);

  const idRes = await graphql(SEO_UNLOCK_SHOP_ID);
  const idJson = await idRes.json();
  const shopGid = idJson.data?.shop?.id;
  if (!shopGid) throw new Error("Could not resolve shop id");

  const res = await graphql(SET_SEO_UNLOCK_METAFIELD, {
    variables: {
      metafields: [
        {
          ownerId: shopGid,
          namespace: NAMESPACE,
          key: "seo_unlocked",
          type: "boolean",
          value: unlocked ? "true" : "false",
        },
      ],
    },
  });
  const json = await res.json();
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`metafieldsSet (shop seo_unlocked): ${JSON.stringify(errors)}`);
  }
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

/**
 * Does this shop have paid access right now - comped, or an active Shopify
 * subscription? Used by the FREE-TIER-SPEC routes to decide whether to show
 * free-tier wording and enforce the three-product cap.
 */
export async function hasPaidAccess(
  shopDomain: string,
  shopId: string | undefined,
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
): Promise<boolean> {
  if (await isComped(shopDomain, shopId)) return true;
  const subscription = await activeSubscription(graphql);
  return Boolean(subscription);
}

/**
 * Same query as `activeSubscription`, for callers whose graphql function
 * already returns parsed data rather than a `Response`. The worker's
 * `adminGraphql` (admin.server.ts) is the case: it parses the response and
 * throttles internally, so `await graphql(...)` is the data, not something
 * with a `.json()` method.
 */
async function activeSubscriptionDirect(graphql: GraphqlFn): Promise<Subscription | null> {
  const data = await graphql<{
    currentAppInstallation?: { activeSubscriptions?: Subscription[] };
  }>(ACTIVE_SUBSCRIPTIONS);
  const subs = data?.currentAppInstallation?.activeSubscriptions ?? [];
  return subs.find((s) => s.status === "ACTIVE") ?? null;
}

/**
 * The single authority for whether a shop may be processed automatically -
 * by the poll, the sweep, or a webhook - as opposed to a merchant explicitly
 * asking for it. FREE-TIER-SPEC §3 lists "automatic freshness (webhooks, the
 * poll, the weekly sweep)" as explicitly not free: a shop with no paid
 * access must not have its catalogue kept fresh for nothing.
 *
 * This is the authoritative form: it asks Shopify directly, the same call
 * `hasPaidAccess` makes for a live request. It costs one Admin API call, so
 * it belongs where it runs once per shop per pass - `poll_changes` and
 * `sweep_missing` - never once per product. A comped shop never reaches the
 * API call at all.
 *
 * See `mayProcessAutomaticallyCached` for the cheap counterpart used as a
 * per-product backstop.
 */
export async function mayProcessAutomatically(
  shop: { id: string; domain: string },
  graphql: GraphqlFn,
): Promise<boolean> {
  if (await isComped(shop.domain, shop.id)) return true;
  const subscription = await activeSubscriptionDirect(graphql);
  return Boolean(subscription);
}

/**
 * The cheap counterpart to `mayProcessAutomatically`: no Admin API call, just
 * the comped `Setting` row and the cached `Shop.plan` column. Used in
 * `extract_product`, the single choke point every automatic path funnels
 * through - the webhooks have no loop of their own to gate, and this also
 * catches anything already queued before a shop's access changed.
 *
 * The trap: `Shop.plan` is refreshed only when a merchant opens the app
 * (`app.tsx`'s loader), so it goes stale on a shop that cancels and never
 * returns - it would keep reading the last plan it saw forever. That is
 * exactly why this is a backstop and not the authority: `poll_changes` and
 * `sweep_missing` gate with the live check first, so an abandoned shop stops
 * being queued at all, and this function only needs to catch what slips
 * through - the webhook path, and jobs queued before this shop's access
 * changed.
 */
export async function mayProcessAutomaticallyCached(shop: {
  id: string;
  domain: string;
  plan: string;
}): Promise<boolean> {
  if (await isComped(shop.domain, shop.id)) return true;
  return shop.plan !== "none";
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

const FREE_PRODUCTS_KEY = "free_product_ids";
const FREE_PRODUCT_CAP = 3;

function parseFreeProductIds(value: string | undefined | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * FREE-TIER-SPEC §2, §4: "three products of their choosing", not three
 * writes. The chosen product GIDs live in a Setting row (JSON array, no
 * migration needed) rather than a bare counter, so reprocessing one of the
 * three free products is free - membership in the set is what is free, and
 * the set's size is the cap, not a count of attempts.
 *
 * `Shop.freeProductsUsed` is still incremented in `addFreeProduct` and
 * decremented in `removeFreeProduct`, but nothing reads it any more: the
 * dashboard and the products list both count from this set (the dashboard
 * tile moved off the counter on 1 Sep 2026). This set is the sole
 * authority for membership, remaining-count display and cap checks; a shop
 * whose counter drifted under the old counting rule is judged by the set
 * alone (FREE-TIER-SPEC §4, note dated 1 Sep 2026). The column can be
 * dropped in a future migration once nothing has written it for a while.
 */
export async function freeProductIds(shopId: string): Promise<string[]> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: FREE_PRODUCTS_KEY } },
  });
  return parseFreeProductIds(row?.value);
}

export async function isFreeProduct(shopId: string, productId: string): Promise<boolean> {
  return (await freeProductIds(shopId)).includes(productId);
}

/**
 * Reserve a slot in the free-tier set before the write happens (see
 * app.products._index.tsx action) - reserving first, not after the write
 * succeeds, is what closes the race: two overlapping submissions for two
 * different products both call this, and only one can observe room and
 * commit within the same serializable transaction; the other either sees
 * the first one's product already reserved (if it is a re-submission of the
 * same product) or sees the set already at the cap and is refused outright.
 *
 * If the extraction that follows a successful reservation turns out to
 * write nothing, the caller must call `removeFreeProduct` to give the slot
 * back - `addFreeProduct` itself has no way to know whether the write will
 * succeed, so it cannot enforce "a failed write must not consume one of the
 * three" on its own.
 *
 * Uses a Serializable transaction rather than a raw conditional SQL update:
 * at the scale of a handful of writes per shop (never a hot table), a
 * read-check-write inside one transaction is simpler to reason about than
 * hand-written JSONB array SQL, and Postgres itself detects the conflict a
 * true race produces and fails the loser's transaction, which is retried
 * once here so the retry observes the winner's committed set.
 */
export async function addFreeProduct(
  shopId: string,
  productId: string,
): Promise<{ ok: boolean; ids: string[]; alreadyMember: boolean }> {
  const attempt = () =>
    db.$transaction(
      async (tx) => {
        const row = await tx.setting.findUnique({
          where: { shopId_key: { shopId, key: FREE_PRODUCTS_KEY } },
        });
        const ids = parseFreeProductIds(row?.value);
        if (ids.includes(productId)) {
          return { ok: true, ids, alreadyMember: true };
        }
        if (ids.length >= FREE_PRODUCT_CAP) {
          return { ok: false, ids, alreadyMember: false };
        }
        const next = [...ids, productId];
        await tx.setting.upsert({
          where: { shopId_key: { shopId, key: FREE_PRODUCTS_KEY } },
          create: { shopId, key: FREE_PRODUCTS_KEY, value: JSON.stringify(next) },
          update: { value: JSON.stringify(next) },
        });
        await tx.shop.update({
          where: { id: shopId },
          data: { freeProductsUsed: { increment: 1 } },
        });
        return { ok: true, ids: next, alreadyMember: false };
      },
      { isolationLevel: "Serializable" },
    );

  try {
    return await attempt();
  } catch {
    // A genuine race triggers Postgres's serialization_failure on the loser;
    // one retry re-reads the now-committed set from the winning transaction.
    return attempt();
  }
}

/**
 * Gives a slot back after a reservation whose write produced nothing - the
 * counterpart that lets `addFreeProduct` reserve optimistically before the
 * write runs. Removing an id that was never a member is a no-op, so this is
 * safe to call defensively.
 */
export async function removeFreeProduct(shopId: string, productId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.setting.findUnique({
      where: { shopId_key: { shopId, key: FREE_PRODUCTS_KEY } },
    });
    const ids = parseFreeProductIds(row?.value);
    if (!ids.includes(productId)) return;
    const next = ids.filter((id) => id !== productId);
    await tx.setting.update({
      where: { shopId_key: { shopId, key: FREE_PRODUCTS_KEY } },
      data: { value: JSON.stringify(next) },
    });
    await tx.shop.update({
      where: { id: shopId },
      data: { freeProductsUsed: { decrement: 1 } },
    });
  });
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
