import { describe, it, expect, vi, beforeEach } from "vitest";

// llmsTxtBody reads Setting (business + the persisted shop name) and
// MirrorCache directly, so those two Prisma calls are stubbed here rather
// than hitting a real database. Both business.server.ts and
// catalogue.server.ts import the same "../db.server" module, so mocking it
// once here covers every call llmsTxtBody makes through them.
const mockSettingFindUnique = vi.fn();
const mockMirrorFindMany = vi.fn();

vi.mock("../../db.server", () => ({
  default: {
    setting: { findUnique: (...args: unknown[]) => mockSettingFindUnique(...args) },
    mirrorCache: { findMany: (...args: unknown[]) => mockMirrorFindMany(...args) },
  },
}));

import { renderLlmsTxt, llmsTxtBody } from "../llms-txt.server";

const base = {
  shopName: "Nordwood",
  storeUrl: "https://nordwood.myshopify.com",
  products: [{ title: "Gothenburg Dining Table", url: "https://nordwood.myshopify.com/products/gothenburg-dining-table" }],
};

describe("renderLlmsTxt", () => {
  it("publishes the shop name, url and product index", () => {
    const out = renderLlmsTxt(base);

    expect(out).toContain("# Nordwood");
    expect(out).toContain("https://nordwood.myshopify.com");
    expect(out).toContain("## Products");
    expect(out).toContain(
      "- [Gothenburg Dining Table](https://nordwood.myshopify.com/products/gothenburg-dining-table)",
    );
  });

  it("says plainly when nothing has been processed yet, rather than an empty section", () => {
    const out = renderLlmsTxt({ ...base, products: [] });
    expect(out).toContain("Nothing processed yet.");
  });

  it("publishes only the commercial facts that are filled in", () => {
    const out = renderLlmsTxt({
      ...base,
      business: { returnDays: 30, warranty: null, paymentMethods: "Card, PayPal" } as any,
    });

    expect(out).toContain("## Buying it");
    expect(out).toContain("- Returns: 30 days");
    expect(out).toContain("- Payment: Card, PayPal");
    expect(out).not.toContain("Warranty:");
  });

  it("omits the Buying it section entirely when nothing is filled in", () => {
    const out = renderLlmsTxt({ ...base, business: {} as any });
    expect(out).not.toContain("## Buying it");
  });

  it("marks delivery cost as 'from' only when the flag says so", () => {
    const out = renderLlmsTxt({
      ...base,
      business: { deliveryCost: "9.99", deliveryCostIsFrom: true } as any,
    });
    expect(out).toContain("- Delivery cost: from 9.99");
  });

  it("publishes the official profile URLs when filled in", () => {
    const out = renderLlmsTxt({
      ...base,
      business: {
        socialProfiles: {
          instagram: "https://instagram.com/nordwood",
          youtube: "https://youtube.com/@nordwood",
        },
      } as any,
    });
    expect(out).toContain("https://instagram.com/nordwood");
    expect(out).toContain("https://youtube.com/@nordwood");
  });

  it("publishes no profile line when none are filled in", () => {
    const out = renderLlmsTxt({ ...base, business: {} as any });
    expect(out).not.toContain("instagram.com");
    expect(out).not.toContain("youtube.com");
  });

  it("publishes no profile line when business is absent entirely", () => {
    const out = renderLlmsTxt(base);
    // Only the shop heading and store URL sit above Products - no stray
    // profile line should appear between them.
    const afterUrl = out.split(base.storeUrl)[1].split("## Products")[0].trim();
    expect(afterUrl).toBe("");
  });
});

describe("llmsTxtBody", () => {
  beforeEach(() => {
    mockSettingFindUnique.mockReset();
    mockMirrorFindMany.mockReset();
    mockMirrorFindMany.mockResolvedValue([]);
  });

  it("publishes the shop name persisted the last time extraction ran, not the domain slug", async () => {
    mockSettingFindUnique.mockImplementation(({ where }: any) => {
      if (where.shopId_key.key === "shopInfo") {
        return Promise.resolve({
          value: JSON.stringify({ name: "Nordwood Furniture", url: "https://nordwood.com" }),
        });
      }
      return Promise.resolve(null);
    });

    const out = await llmsTxtBody("shop1", "nordwood.myshopify.com");

    expect(out).toContain("# Nordwood Furniture");
    expect(out).not.toContain("# nordwood");
  });

  it("falls back to the domain slug when extraction has never run for the shop", async () => {
    mockSettingFindUnique.mockResolvedValue(null);

    const out = await llmsTxtBody("shop1", "nordwood.myshopify.com");

    expect(out).toContain("# nordwood");
  });
});
