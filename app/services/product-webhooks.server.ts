// Product webhooks per shop, not per app (CHANGELOG, 20 Oct 2026).
//
// Declared in shopify.app.toml, products/create, update and delete went to
// every shop that installed the app, paid or not. In maintenance mode every
// delivery wakes the one Fly machine, and one test install with busy apps of
// its own sent about 50 a minute, so the machine never slept. FREE-TIER-SPEC
// §3 already says automatic freshness is not free; this makes Shopify stop
// sending what the gate would only have skipped.
//
// The subscriptions are shop-scoped, created through the Admin API, and
// reconciled on every poll_changes run: a shop that may be processed
// automatically gets exactly the three below, every other shop gets none.
// Reconciling every run is the fail-safe: a lost or deleted subscription is
// back on the next wake.
//
// The webhooks query returns only shop-scoped subscriptions made by this app,
// never the TOML ones (shopify.dev, webhookSubscriptions, read 20 Oct 2026),
// so everything it lists for these topics is ours to keep or remove.

import type { GraphqlFn } from "./admin.server";

export const PRODUCT_WEBHOOKS = [
  { topic: "PRODUCTS_CREATE", path: "/webhooks/products/create" },
  { topic: "PRODUCTS_UPDATE", path: "/webhooks/products/update" },
  { topic: "PRODUCTS_DELETE", path: "/webhooks/products/delete" },
] as const;

export interface ExistingSubscription {
  id: string;
  topic: string;
  uri: string;
}

export interface WebhookPlan {
  create: { topic: string; uri: string }[];
  remove: string[];
}

/**
 * Pure: what to create and what to delete so the shop ends with exactly the
 * wanted set. Nothing is touched that is already right (a write for nothing
 * is still a write), a duplicate is removed, and a subscription pointing at
 * another address - an old dev tunnel - is replaced.
 */
export function planProductWebhooks(
  existing: ExistingSubscription[],
  wanted: boolean,
  appUrl: string,
): WebhookPlan {
  const base = appUrl.replace(/\/+$/, "");
  const desired = wanted ? PRODUCT_WEBHOOKS.map((w) => ({ topic: w.topic, uri: `${base}${w.path}` })) : [];
  const topics = new Set<string>(PRODUCT_WEBHOOKS.map((w) => w.topic));

  const kept = new Set<string>();
  const remove: string[] = [];
  for (const sub of existing) {
    if (!topics.has(sub.topic)) continue;
    const key = `${sub.topic} ${sub.uri}`;
    const isDesired = desired.some((d) => d.topic === sub.topic && d.uri === sub.uri);
    if (isDesired && !kept.has(key)) kept.add(key);
    else remove.push(sub.id);
  }

  const create = desired.filter((d) => !kept.has(`${d.topic} ${d.uri}`));
  return { create, remove };
}

const LIST = `#graphql
  query ProductWebhookSubscriptions($topics: [WebhookSubscriptionTopic!]) {
    webhookSubscriptions(first: 50, topics: $topics) {
      nodes { id topic uri }
    }
  }
`;

const CREATE = `#graphql
  mutation CreateProductWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

const DELETE = `#graphql
  mutation DeleteProductWebhook($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors { field message }
    }
  }
`;

/**
 * Brings one shop's product subscriptions to the wanted state. Returns what it
 * changed, for the log; throws on a userError so the caller logs it and the
 * next run tries again.
 */
export async function reconcileProductWebhooks(
  graphql: GraphqlFn,
  wanted: boolean,
  appUrl: string,
): Promise<{ created: number; removed: number }> {
  const data = await graphql<{ webhookSubscriptions?: { nodes?: ExistingSubscription[] } }>(LIST, {
    topics: PRODUCT_WEBHOOKS.map((w) => w.topic),
  });
  const plan = planProductWebhooks(data?.webhookSubscriptions?.nodes ?? [], wanted, appUrl);

  for (const id of plan.remove) {
    const res = await graphql<any>(DELETE, { id });
    const errors = res?.webhookSubscriptionDelete?.userErrors ?? [];
    if (errors.length) throw new Error(`webhookSubscriptionDelete ${id}: ${JSON.stringify(errors)}`);
  }
  for (const sub of plan.create) {
    const res = await graphql<any>(CREATE, { topic: sub.topic, webhookSubscription: { uri: sub.uri } });
    const errors = res?.webhookSubscriptionCreate?.userErrors ?? [];
    if (errors.length) throw new Error(`webhookSubscriptionCreate ${sub.topic}: ${JSON.stringify(errors)}`);
  }
  return { created: plan.create.length, removed: plan.remove.length };
}

/**
 * Only the production process reconciles. A local worker or `shopify app dev`
 * has SHOPIFY_APP_URL pointing at the laptop tunnel, and reconciling from there
 * would move a paying shop's webhooks to an address that dies with the laptop.
 */
export function productWebhookAppUrl(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  return process.env.SHOPIFY_APP_URL || null;
}
