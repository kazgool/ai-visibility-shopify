import { beforeEach, describe, expect, it, vi } from "vitest";

// CC-PROMPT-AI-READABILITY-4 item 2a: the delivery cost is read into numbers
// on save, server side, and stored next to the text in both the settings row
// and the shop metafield. The text is never changed.

const mockUpsert = vi.fn();
vi.mock("../../db.server", () => ({
  default: { setting: { upsert: (...a: unknown[]) => mockUpsert(...a), findUnique: vi.fn() } },
}));

import { saveBusiness, withParsedDelivery } from "../business.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withParsedDelivery", () => {
  it("stores the numbers next to the text, which stays exactly as typed", () => {
    const record = withParsedDelivery({ deliveryCost: "19,99 lei, gratuit peste 200 lei" }, "RON");
    expect(record.deliveryCost).toBe("19,99 lei, gratuit peste 200 lei");
    expect(record.deliveryCostParsed).toEqual({ rate: 19.99, currency: "RON", freeOverAmount: 200 });
  });

  it("uses the shop's currency when the text writes none", () => {
    expect(withParsedDelivery({ deliveryCost: "Free over 500, or: 25" }, "EUR").deliveryCostParsed).toEqual({
      rate: 25,
      currency: "EUR",
      freeOverAmount: 500,
    });
  });

  it("drops a stale reading when the text is emptied", () => {
    const record = withParsedDelivery(
      { deliveryCost: "", deliveryCostParsed: { rate: 9, currency: "RON", freeOverAmount: null } },
      "RON",
    );
    expect(record.deliveryCostParsed).toBeUndefined();
  });

  // CC-PROMPT-AI-READABILITY-4 item 4.
  it("stores the delivery time in days next to its text, and nothing when no days can be read", () => {
    const record = withParsedDelivery({ deliveryTime: "24-48 ore" }, "RON");
    expect(record.deliveryTime).toBe("24-48 ore");
    expect(record.deliveryTimeParsed).toEqual({ minDays: 1, maxDays: 2 });

    const unreadable = withParsedDelivery(
      { deliveryTime: "call us", deliveryTimeParsed: { minDays: 1, maxDays: 2 } },
      "RON",
    );
    expect(unreadable.deliveryTimeParsed).toBeUndefined();
    expect(unreadable.deliveryTime).toBe("call us");
  });

  it("keeps the words and publishes nothing when the shop's currency is unknown", () => {
    const record = withParsedDelivery(
      {
        deliveryCost: "25 RON",
        deliveryTime: "1-2 zile",
        deliveryCostParsed: { rate: 9, currency: "RON", freeOverAmount: null },
        deliveryTimeParsed: { minDays: 3, maxDays: 4 },
      },
      null,
    );
    expect(record.deliveryCost).toBe("25 RON");
    expect(record.deliveryTime).toBe("1-2 zile");
    expect(record.deliveryCostParsed).toBeUndefined();
    expect(record.deliveryTimeParsed).toBeUndefined();
  });

  it("recomputes a reading the text no longer says", () => {
    const record = withParsedDelivery(
      { deliveryCost: "call us", deliveryCostParsed: { rate: 9, currency: "RON", freeOverAmount: null } },
      "RON",
    );
    expect(record.deliveryCostParsed).toEqual({ rate: null, currency: "RON", freeOverAmount: null });
  });
});

describe("saveBusiness", () => {
  function graphqlWith(shop: Record<string, unknown>) {
    const calls: { query: string; variables?: any }[] = [];
    const fn = vi.fn(async (query: string, options?: { variables?: object }) => {
      calls.push({ query, variables: options?.variables });
      const data = query.includes("ShopForBusiness")
        ? { shop }
        : { metafieldsSet: { userErrors: [] } };
      return new Response(JSON.stringify({ data }));
    });
    return { fn, calls };
  }

  it("writes the same record, numbers included, to the settings row and the shop metafield", async () => {
    const { fn, calls } = graphqlWith({ id: "gid://shopify/Shop/1", currencyCode: "RON" });
    await saveBusiness("shop1", fn as any, { deliveryCost: "25 RON", deliveryCountries: ["RO", "MD"] });

    const stored = JSON.parse(mockUpsert.mock.calls[0][0].create.value);
    expect(stored).toEqual({
      deliveryCost: "25 RON",
      deliveryCountries: ["RO", "MD"],
      deliveryCostParsed: { rate: 25, currency: "RON", freeOverAmount: null },
    });
    const write = calls.find((c) => c.query.includes("metafieldsSet"))!;
    expect(JSON.parse(write.variables.metafields[0].value)).toEqual(stored);
    expect(write.variables.metafields[0].key).toBe("business");
  });

  // A currency we cannot read costs the merchant the published figures, never
  // the words they typed.
  it("saves the text and publishes no delivery figures when the currency cannot be read", async () => {
    const { fn, calls } = graphqlWith({ id: "gid://shopify/Shop/1" });
    await saveBusiness("shop1", fn as any, {
      deliveryCost: "25 RON",
      deliveryTime: "1-2 zile",
      deliveryCountries: ["RO"],
    });

    const stored = JSON.parse(mockUpsert.mock.calls[0][0].create.value);
    expect(stored).toEqual({
      deliveryCost: "25 RON",
      deliveryTime: "1-2 zile",
      deliveryCountries: ["RO"],
    });
    expect(stored.deliveryCostParsed).toBeUndefined();
    expect(stored.deliveryTimeParsed).toBeUndefined();
    const write = calls.find((c) => c.query.includes("metafieldsSet"))!;
    expect(JSON.parse(write.variables.metafields[0].value)).toEqual(stored);
  });

  it("still refuses when the shop id cannot be read", async () => {
    const { fn } = graphqlWith({ currencyCode: "RON" });
    await expect(saveBusiness("shop1", fn as any, { deliveryCost: "25" })).rejects.toThrow(/shop id/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
