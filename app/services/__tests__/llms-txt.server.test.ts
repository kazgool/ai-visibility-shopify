import { describe, it, expect } from "vitest";
import { renderLlmsTxt } from "../llms-txt.server";

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
});
