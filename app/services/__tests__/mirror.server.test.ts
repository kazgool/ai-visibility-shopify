import { describe, it, expect } from "vitest";
import { renderMirror } from "../mirror.server";
import { formatPrice } from "../price.server";

const base = {
  handle: "gothenburg-dining-table",
  title: "Gothenburg Dining Table",
  url: "https://example.myshopify.com/products/gothenburg-dining-table",
  facts: [{ k: "Material", v: "walnut" }],
};

describe("formatPrice", () => {
  it("drops the trailing zero Shopify sends on whole amounts", () => {
    // The bug this exists for: "1190.0" published as a price reads as a
    // broken import, not as a price.
    expect(formatPrice("1190.0")).toBe("1190");
    expect(formatPrice("1050.00")).toBe("1050");
  });

  it("keeps two decimals when the amount is not whole", () => {
    expect(formatPrice("19.9")).toBe("19.90");
    expect(formatPrice("19.99")).toBe("19.99");
  });

  it("returns null for missing or unparseable values", () => {
    expect(formatPrice(null)).toBeNull();
    expect(formatPrice(undefined)).toBeNull();
    expect(formatPrice("")).toBeNull();
    expect(formatPrice("on request")).toBeNull();
  });
});

describe("renderMirror front matter", () => {
  it("states availability from the variants, and says nothing when it is unknown", () => {
    // PRD-PORT-1.7.8 J.7: "the mirror carries availability: out of stock".
    // An assistant reading the page is told the product is sold out; it is
    // not hidden, unless the merchant's toggle withdraws the page. Unknown
    // (no variant row read) prints nothing rather than a guess.
    expect(renderMirror({ ...base, available: false })).toContain("availability: out of stock");
    expect(renderMirror({ ...base, available: true })).toContain("availability: in stock");
    expect(renderMirror({ ...base })).not.toContain("availability:");
  });

  it("publishes sku, image and category when present", () => {
    const out = renderMirror({
      ...base,
      sku: "NW-GOT-220",
      imageUrl: "https://cdn.shopify.com/gothenburg.jpg",
      imageAlt: "Walnut dining table seen from the side",
      productType: "Dining tables",
      category: "Furniture > Tables",
    });

    expect(out).toContain('sku: "NW-GOT-220"');
    expect(out).toContain('image: "https://cdn.shopify.com/gothenburg.jpg"');
    expect(out).toContain('image_alt: "Walnut dining table seen from the side"');
    expect(out).toContain('category: "Dining tables"');
    expect(out).toContain('product_category: "Furniture > Tables"');
  });

  it("omits every field that is empty rather than publishing a blank one", () => {
    const out = renderMirror(base);

    expect(out).not.toContain("sku:");
    expect(out).not.toContain("image:");
    expect(out).not.toContain("image_alt:");
    expect(out).not.toContain("category:");
  });

  it("never publishes a raw trailing-zero price", () => {
    const out = renderMirror({
      ...base,
      price: formatPrice("1190.0"),
      currency: "USD",
    });

    expect(out).toContain('price: "1190 USD"');
    expect(out).not.toContain("1190.0");
  });
});

describe("renderMirror store section", () => {
  it("publishes the shop and its official profiles", () => {
    const out = renderMirror({
      ...base,
      store: {
        name: "Nordwood",
        url: "https://example.com",
        profiles: {
          instagram: "https://instagram.com/nordwood",
          youtube: "https://youtube.com/@nordwood",
        },
      },
    });

    expect(out).toContain("## Store");
    expect(out).toContain("Nordwood");
    expect(out).toContain("https://instagram.com/nordwood");
    expect(out).toContain("https://youtube.com/@nordwood");
    // The section sits above the source line, not after it.
    expect(out.indexOf("## Store")).toBeLessThan(out.indexOf("Source:"));
  });

  it("publishes no heading when there is nothing to put under it", () => {
    const out = renderMirror({ ...base, store: null });
    expect(out).not.toContain("## Store");
  });

  it("publishes the shop even when no profiles are filled in", () => {
    const out = renderMirror({
      ...base,
      store: { name: "Nordwood", url: "https://example.com", profiles: null },
    });

    expect(out).toContain("## Store");
    expect(out).toContain("Nordwood");
  });
});

describe("renderMirror Part of section", () => {
  it("lists each collection the product belongs to, linked to its storefront page", () => {
    const out = renderMirror({
      ...base,
      collections: [
        { title: "Dining Tables", url: "https://example.myshopify.com/collections/dining-tables" },
        { title: "Walnut Furniture", url: "https://example.myshopify.com/collections/walnut-furniture" },
      ],
    });

    expect(out).toContain("## Part of");
    expect(out).toContain("- [Dining Tables](https://example.myshopify.com/collections/dining-tables)");
    expect(out).toContain("- [Walnut Furniture](https://example.myshopify.com/collections/walnut-furniture)");
    // Not a mirror URL - collections have no mirror of their own.
    expect(out).not.toContain("/collections/dining-tables/mirror");
  });

  it("publishes no Part of section when the product is in no collection", () => {
    const out = renderMirror({ ...base, collections: [] });
    expect(out).not.toContain("## Part of");
  });

  it("publishes no Part of section when collections is absent entirely", () => {
    const out = renderMirror(base);
    expect(out).not.toContain("## Part of");
  });
});
