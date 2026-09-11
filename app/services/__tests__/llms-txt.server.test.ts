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

  it("links each product to its mirror and names the store page after it", () => {
    // The llms.txt proposal links to the clean, markdown-shaped version of a
    // page; that is the mirror. Before this every line linked the store page
    // and the mirror was never reachable from the index.
    const out = renderLlmsTxt({
      ...base,
      products: [
        {
          title: "Gothenburg Dining Table",
          url: "https://nordwood.myshopify.com/products/gothenburg-dining-table",
          mirrorUrl: "https://nordwood.myshopify.com/apps/ai-visibility/gothenburg-dining-table",
        },
      ],
    });
    expect(out).toContain(
      "- [Gothenburg Dining Table](https://nordwood.myshopify.com/apps/ai-visibility/gothenburg-dining-table): store page https://nordwood.myshopify.com/products/gothenburg-dining-table",
    );
  });

  it("lists collections after the products, under Optional, and nothing when there is no index", () => {
    // The llms.txt proposal reserves "Optional" for links an agent can skip.
    // Collections sat above Products until 11 September 2026: on Republica
    // BIO the first product mirror began at character 111,719 of 172,464,
    // so a reader with a fetch budget saw only collection pages.
    const out = renderLlmsTxt({
      ...base,
      collections: [
        { title: "Dining Tables", url: "https://nordwood.myshopify.com/collections/dining-tables", products: 12 },
        { title: "Single", url: "https://nordwood.myshopify.com/collections/single", products: 1 },
      ],
    });
    expect(out).toContain("## Optional");
    expect(out).not.toContain("## Collections");
    expect(out).toContain(
      "- [Dining Tables](https://nordwood.myshopify.com/collections/dining-tables): collection, 12 products",
    );
    expect(out).toContain("- [Single](https://nordwood.myshopify.com/collections/single): collection, 1 product");
    expect(out.indexOf("## Products")).toBeLessThan(out.indexOf("## Optional"));

    expect(renderLlmsTxt(base)).not.toContain("## Optional");
    expect(renderLlmsTxt({ ...base, collections: [] })).not.toContain("## Optional");
  });

  it("opens with the H1 and then a blockquote summary, as the llms.txt proposal orders them", () => {
    const out = renderLlmsTxt(base);
    const lines = out.split("\n").filter((l) => l !== "");
    expect(lines[0]).toBe("# Nordwood");
    expect(lines[1]).toBe(
      "> Plain-text versions of every published product page of Nordwood, linked below. Each line names the store page it stands in for.",
    );
  });

  it("makes no claim about product pages when none has been processed", () => {
    const out = renderLlmsTxt({ ...base, products: [] });
    expect(out).not.toContain("> ");
    expect(out).toContain("Nothing processed yet.");
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

  it("builds the mirror url on the store page's own domain and reads the collections index", async () => {
    mockMirrorFindMany.mockResolvedValue([
      {
        handle: "oak-table",
        body: 'title: "Oak Table"\nurl: "https://nordwood.com/products/oak-table"\n',
      },
    ]);
    mockSettingFindUnique.mockImplementation(({ where }: any) => {
      if (where.shopId_key.key === "collectionsIndex") {
        return Promise.resolve({
          value: JSON.stringify([
            { title: "Tables", handle: "tables", members: 4 },
            { title: "Empty", handle: "empty", members: 0 },
          ]),
        });
      }
      return Promise.resolve(null);
    });

    const out = await llmsTxtBody("shop1", "nordwood.com");

    // The store runs on its own domain; the mirror follows the store page,
    // not the myshopify domain the session is keyed by.
    expect(out).toContain(
      "- [Oak Table](https://nordwood.com/apps/ai-visibility/oak-table): store page https://nordwood.com/products/oak-table",
    );
    expect(out).toContain("- [Tables](https://nordwood.com/collections/tables): collection, 4 products");
    // The pass writes only collections with members; a zero would be a
    // page that says nothing. Guarded here too, so a stale index cannot
    // publish one.
    expect(out).not.toContain("Empty");
  });

  it("falls back to the domain slug when extraction has never run for the shop", async () => {
    mockSettingFindUnique.mockResolvedValue(null);

    const out = await llmsTxtBody("shop1", "nordwood.myshopify.com");

    expect(out).toContain("# nordwood");
  });
});
