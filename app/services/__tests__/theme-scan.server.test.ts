import { describe, it, expect } from "vitest";
import {
  extractLdNodes,
  detectConflicts,
  isOurNodeId,
  canonicalNodeId,
  deriveMissingReasons,
} from "../theme-scan.server";

function withScript(json: string): string {
  return `<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;
}

describe("extractLdNodes", () => {
  it("reads a single top-level node", () => {
    const html = withScript(JSON.stringify({ "@type": "Product", "@id": "https://x/#product" }));
    const nodes = extractLdNodes(html);
    expect(nodes).toEqual([{ types: ["Product"], id: "https://x/#product" }]);
  });

  it("flattens nodes nested in @graph", () => {
    const html = withScript(
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Product", "@id": "https://x/#product" },
          { "@type": "Organization", "@id": "https://x/#org" },
        ],
      }),
    );
    const nodes = extractLdNodes(html);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.types[0]).sort()).toEqual(["Organization", "Product"]);
  });

  it("reads multiple separate script blocks", () => {
    const html =
      withScript(JSON.stringify({ "@type": "Product" })) +
      withScript(JSON.stringify({ "@type": "BreadcrumbList" }));
    const nodes = extractLdNodes(html);
    expect(nodes).toHaveLength(2);
  });

  it("skips a malformed JSON-LD block instead of throwing", () => {
    const html = `<script type="application/ld+json">{ not valid json </script>` +
      withScript(JSON.stringify({ "@type": "Product" }));
    expect(() => extractLdNodes(html)).not.toThrow();
    const nodes = extractLdNodes(html);
    expect(nodes).toEqual([{ types: ["Product"], id: "" }]);
  });

  it("handles an @type array on one node", () => {
    const html = withScript(JSON.stringify({ "@type": ["Product", "Vehicle"] }));
    const nodes = extractLdNodes(html);
    expect(nodes[0].types).toEqual(["Product", "Vehicle"]);
  });

  it("flags a Product node's own nested aggregateRating", () => {
    const html = withScript(
      JSON.stringify({
        "@type": "Product",
        "@id": "https://x/#product",
        aggregateRating: { "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 10 },
      }),
    );
    const nodes = extractLdNodes(html);
    expect(nodes[0].hasAggregateRating).toBe(true);
  });

  it("does not set hasAggregateRating when the node carries none", () => {
    const html = withScript(JSON.stringify({ "@type": "Product", "@id": "https://x/#product" }));
    const nodes = extractLdNodes(html);
    expect(nodes[0].hasAggregateRating).toBeUndefined();
  });

  it("returns nothing when the page has no JSON-LD at all", () => {
    expect(extractLdNodes("<html><body>plain</body></html>")).toEqual([]);
  });
});

describe("isOurNodeId", () => {
  it("recognises our Product and CollectionPage suffixes", () => {
    expect(isOurNodeId("https://x/products/y#product")).toBe(true);
    expect(isOurNodeId("https://x/collections/y#collection")).toBe(true);
  });

  it("does not recognise a theme's own id or an empty one", () => {
    expect(isOurNodeId("https://x/products/y")).toBe(false);
    expect(isOurNodeId("")).toBe(false);
  });
});

describe("detectConflicts", () => {
  it("reports nothing when every type appears once", () => {
    const nodes = [
      { types: ["Product"], id: "https://x/#product" },
      { types: ["Organization"], id: "" },
    ];
    expect(detectConflicts(nodes)).toEqual([]);
  });

  it("reports a repeated type and names us as a source when our id is present", () => {
    const nodes = [
      { types: ["Organization"], id: "" },
      { types: ["Organization"], id: "https://x/#org" },
    ];
    // Neither id matches our #product/#collection suffix here, so weEmitOne
    // is false - we cannot claim credit we cannot verify.
    const conflicts = detectConflicts(nodes);
    expect(conflicts).toEqual([{ type: "Organization", count: 2, weEmitOne: false }]);
  });

  it("names us as one source when one of the repeated nodes carries our id", () => {
    const nodes = [
      { types: ["Product"], id: "https://x/products/y#product" },
      { types: ["Product"], id: "https://x/products/y" },
    ];
    const conflicts = detectConflicts(nodes);
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: true }]);
  });

  it("counts a node once per type it declares, and only flags types repeated across nodes", () => {
    const nodes = [
      { types: ["Product", "Vehicle"], id: "a" },
      { types: ["Product"], id: "b" },
    ];
    const conflicts = detectConflicts(nodes);
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: false }]);
  });

  // Extend mode deliberately emits a node carrying the theme's own @id so
  // the two merge into one node - that merge must never be reported as a
  // conflict, on any of the five id shapes that can arise.
  it("does not report a conflict when two nodes share the exact same @id (the merge case)", () => {
    const nodes = [
      { types: ["Product"], id: "https://x/products/y#product" },
      { types: ["Product"], id: "https://x/products/y#product" },
    ];
    expect(detectConflicts(nodes, "https://x/products/y")).toEqual([]);
  });

  it("merges a relative @id from the theme with the absolute form of the same address from us, given the page URL", () => {
    const nodes = [
      { types: ["Product"], id: "/products/x#product" }, // theme's own, relative
      { types: ["Product"], id: "https://shop.example/products/x#product" }, // ours, absolute
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([]);
  });

  it("without a known page URL, leaves a relative id unresolved and reports the possible conflict rather than guessing", () => {
    const nodes = [
      { types: ["Product"], id: "/products/x#product" },
      { types: ["Product"], id: "https://shop.example/products/x#product" },
    ];
    // No pageUrl passed: the two strings differ, so they are not merged.
    const conflicts = detectConflicts(nodes);
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: true }]);
  });

  it("still reports a conflict for two nodes of the same type that both carry no @id", () => {
    const nodes = [
      { types: ["Product"], id: "" },
      { types: ["Product"], id: "" },
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: false }]);
  });

  it("still reports a conflict when one node has an @id and the other has none - they cannot be proven the same node", () => {
    const nodes = [
      { types: ["Product"], id: "https://shop.example/products/x#product" },
      { types: ["Product"], id: "" },
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: true }]);
  });

  it("still reports a conflict for two different, unrelated @id values", () => {
    const nodes = [
      { types: ["Product"], id: "https://shop.example/products/x#product" },
      { types: ["Product"], id: "https://shop.example/products/other-app-node" },
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: true }]);
  });

  it("merges three nodes down to two distinct entities and still counts the survivors", () => {
    const nodes = [
      { types: ["Product"], id: "https://shop.example/products/x#product" },
      { types: ["Product"], id: "https://shop.example/products/x#product" }, // dup of the first
      { types: ["Product"], id: "https://shop.example/products/other-app-node" },
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: true }]);
  });
});

describe("canonicalNodeId", () => {
  it("returns null for an empty id", () => {
    expect(canonicalNodeId("", "https://shop.example/products/x")).toBeNull();
  });

  it("resolves a relative id against the page URL", () => {
    expect(canonicalNodeId("/products/x#product", "https://shop.example/products/x")).toBe(
      "https://shop.example/products/x#product",
    );
  });

  it("leaves an already-absolute id unchanged", () => {
    expect(
      canonicalNodeId("https://shop.example/products/x#product", "https://shop.example/products/x"),
    ).toBe("https://shop.example/products/x#product");
  });

  it("returns the id as-is when no page URL is known", () => {
    expect(canonicalNodeId("/products/x#product")).toBe("/products/x#product");
  });
});

describe("deriveMissingReasons", () => {
  const base = {
    embedActive: true,
    mode: "extend" as const,
    hasFacts: false,
    hasSummary: false,
    hasFitFor: false,
    hasReturnDays: false,
    hasDeliveryTime: false,
    hasRating: false,
    hasCollectionQuestions: false,
    hasSocialProfiles: false,
    seoUnlocked: false,
    isCollectionPage: false,
  };

  it("blames the embed when it is not active, for every node type", () => {
    const reasons = deriveMissingReasons({ ...base, embedActive: false });
    expect(reasons.every((r) => !r.emitted)).toBe(true);
    expect(reasons.every((r) => r.reason?.includes("app embed is not active"))).toBe(true);
  });

  it("says extend mode has nothing to add when there are no facts or summary", () => {
    const reasons = deriveMissingReasons(base);
    const product = reasons.find((r) => r.nodeType === "Product")!;
    expect(product.emitted).toBe(false);
    expect(product.reason).toMatch(/nothing to add/);
  });

  it("marks the Product node emitted once facts exist", () => {
    const reasons = deriveMissingReasons({ ...base, hasFacts: true });
    const product = reasons.find((r) => r.nodeType === "Product")!;
    expect(product.emitted).toBe(true);
    expect(product.reason).toBeNull();
  });

  it("points the return policy reason at the Business screen", () => {
    const reasons = deriveMissingReasons(base);
    const returns = reasons.find((r) => r.nodeType === "MerchantReturnPolicy")!;
    expect(returns.emitted).toBe(false);
    expect(returns.fixScreen).toBe("/app/business");
  });

  it("marks AggregateRating absent without inventing a fix screen we do not have", () => {
    const reasons = deriveMissingReasons(base);
    const rating = reasons.find((r) => r.nodeType === "AggregateRating")!;
    expect(rating.emitted).toBe(false);
    expect(rating.reason).toMatch(/review app/);
  });

  it("only reports CollectionPage and FAQPage on a collection page", () => {
    const onProduct = deriveMissingReasons(base);
    expect(onProduct.find((r) => r.nodeType === "FAQPage")).toBeUndefined();

    const onCollection = deriveMissingReasons({ ...base, isCollectionPage: true });
    expect(onCollection.find((r) => r.nodeType === "FAQPage")).toBeDefined();
  });

  it("marks AggregateRating emitted when the scan found a nested aggregateRating on the page - a product with real ratings is no longer reported as missing one", () => {
    const reasons = deriveMissingReasons({ ...base, hasRating: true });
    const rating = reasons.find((r) => r.nodeType === "AggregateRating")!;
    expect(rating.emitted).toBe(true);
    expect(rating.reason).toBeNull();
  });

  it("reports AggregateRating as could not be determined, not as absent, when the page could not be read", () => {
    const reasons = deriveMissingReasons({ ...base, hasRating: null });
    const rating = reasons.find((r) => r.nodeType === "AggregateRating")!;
    expect(rating.emitted).toBe(false);
    expect(rating.reason).toMatch(/could not be determined/i);
  });

  it("marks FAQPage emitted on a collection page when the scan found generated questions", () => {
    const reasons = deriveMissingReasons({ ...base, isCollectionPage: true, hasCollectionQuestions: true });
    const faq = reasons.find((r) => r.nodeType === "FAQPage")!;
    expect(faq.emitted).toBe(true);
  });

  it("reports FAQPage as could not be determined when the collection page could not be read", () => {
    const reasons = deriveMissingReasons({ ...base, isCollectionPage: true, hasCollectionQuestions: null });
    const faq = reasons.find((r) => r.nodeType === "FAQPage")!;
    expect(faq.emitted).toBe(false);
    expect(faq.reason).toMatch(/could not be determined/i);
  });
});
