import { describe, expect, it } from "vitest";
import { planProductWebhooks, type ExistingSubscription } from "../product-webhooks.server";

const APP = "https://app.example.com";
const ours = (topic: string, path: string, id = topic): ExistingSubscription => ({
  id,
  topic,
  uri: `${APP}${path}`,
});
const ALL = [
  ours("PRODUCTS_CREATE", "/webhooks/products/create"),
  ours("PRODUCTS_UPDATE", "/webhooks/products/update"),
  ours("PRODUCTS_DELETE", "/webhooks/products/delete"),
];

describe("planProductWebhooks", () => {
  it("creates all three for an entitled shop that has none", () => {
    const plan = planProductWebhooks([], true, APP);
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([
      { topic: "PRODUCTS_CREATE", uri: `${APP}/webhooks/products/create` },
      { topic: "PRODUCTS_UPDATE", uri: `${APP}/webhooks/products/update` },
      { topic: "PRODUCTS_DELETE", uri: `${APP}/webhooks/products/delete` },
    ]);
  });

  it("changes nothing when the entitled shop already has exactly the three", () => {
    expect(planProductWebhooks(ALL, true, APP)).toEqual({ create: [], remove: [] });
  });

  it("removes all three from a shop that may not be processed automatically", () => {
    expect(planProductWebhooks(ALL, false, APP)).toEqual({
      create: [],
      remove: ["PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE"],
    });
  });

  it("removes a duplicate and keeps one", () => {
    const dup = ours("PRODUCTS_UPDATE", "/webhooks/products/update", "dup");
    expect(planProductWebhooks([...ALL, dup], true, APP)).toEqual({ create: [], remove: ["dup"] });
  });

  it("replaces a subscription that points at another address, such as an old tunnel", () => {
    const tunnel = { id: "old", topic: "PRODUCTS_UPDATE", uri: "https://x.trycloudflare.com/webhooks/products/update" };
    const plan = planProductWebhooks([ALL[0], tunnel, ALL[2]], true, APP);
    expect(plan.remove).toEqual(["old"]);
    expect(plan.create).toEqual([{ topic: "PRODUCTS_UPDATE", uri: `${APP}/webhooks/products/update` }]);
  });

  it("never touches a subscription for another topic", () => {
    const other = { id: "orders", topic: "ORDERS_CREATE", uri: `${APP}/webhooks/orders` };
    expect(planProductWebhooks([other], false, APP)).toEqual({ create: [], remove: [] });
  });

  it("tolerates a trailing slash on the app URL", () => {
    expect(planProductWebhooks(ALL, true, `${APP}/`)).toEqual({ create: [], remove: [] });
  });
});
