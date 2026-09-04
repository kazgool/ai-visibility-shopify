import { describe, it, expect } from "vitest";
import {
  extractLdNodes,
  detectConflicts,
  isOurNode,
  OUR_NODE_MARKER,
  canonicalNodeId,
  deriveMissingReasons,
  organizationPairIsInformational,
  mergeNarrowScanIntoDetail,
  themeRowKey,
  type ThemeScanResult,
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

describe("telling our nodes from the theme's", () => {
  // The defect this replaced. isOurNodeId was `id.endsWith("#product")`, and its
  // own comment carried the assumption that broke it: "a theme's node ends in
  // whatever the theme chose". Horizon chooses "#product". So on the dev store
  // every Horizon Product node was counted as ours, themeNodeAggregate saw
  // theirs: 0, and the Structured data card recommended switching to Full mode -
  // which would have produced the second complete Product node CLAUDE.md
  // forbids. Read off the store on 4 September 2026.
  const HORIZON_PRODUCT_ID = "/products/a-chair#product";

  function nodeFrom(json: string) {
    return extractLdNodes(`<script type="application/ld+json">${json}</script>`)[0];
  }

  it("classifies a theme node as the theme's even when its id ends in our suffix", () => {
    const node = nodeFrom(
      `{"@context":"https://schema.org","@type":"Product","@id":"${HORIZON_PRODUCT_ID}","name":"A chair"}`,
    );
    expect(node.id).toBe(HORIZON_PRODUCT_ID);
    expect(node.ours).toBeUndefined();
    expect(isOurNode(node)).toBe(false);
  });

  it("classifies our node as ours by the marker, at the very same id", () => {
    // The same address on purpose: extend mode shares the theme's @id so the
    // two merge into one node. The marker is what tells them apart.
    const node = nodeFrom(
      `{"@context":"https://schema.org","@type":"Product","@id":"${HORIZON_PRODUCT_ID}",` +
        `"${OUR_NODE_MARKER}":"1","description":"added by us"}`,
    );
    expect(node.id).toBe(HORIZON_PRODUCT_ID);
    expect(isOurNode(node)).toBe(true);
  });

  it("never reads ownership off a suffix, in either direction", () => {
    // Ours without our old suffix.
    expect(
      isOurNode(
        nodeFrom(
          `{"@type":"Organization","@id":"https://x/","${OUR_NODE_MARKER}":"1"}`,
        ),
      ),
    ).toBe(true);
    // The theme's, with every suffix we used to claim.
    for (const id of ["https://x/products/y#product", "https://x/c#collection", "https://x#organization"]) {
      expect(isOurNode(nodeFrom(`{"@type":"Product","@id":"${id}"}`))).toBe(false);
    }
  });

  it("reads a node with no id and no marker as the theme's", () => {
    expect(isOurNode(nodeFrom('{"@type":"BreadcrumbList"}'))).toBe(false);
  });

  // Every row written before the marker shipped has no marker, so it reads as
  // the theme's. That inflates the theme count, which can only ever recommend
  // Extend - and Extend never creates a duplicate node.
  it("reads a stored node from before the marker as the theme's", () => {
    expect(isOurNode({ types: ["Product"], id: "https://x/products/y#product" } as any)).toBe(false);
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
    // Neither node carries our marker here, so weEmitOne
    // is false - we cannot claim credit we cannot verify.
    const conflicts = detectConflicts(nodes);
    expect(conflicts).toEqual([{ type: "Organization", count: 2, weEmitOne: false }]);
  });

  it("names us as one source when one of the repeated nodes is ours", () => {
    const nodes = [
      { types: ["Product"], id: "https://x/products/y#product", ours: true },
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
      { types: ["Product"], id: "https://x/products/y#product", ours: true },
      { types: ["Product"], id: "https://x/products/y#product", ours: true },
    ];
    expect(detectConflicts(nodes, "https://x/products/y")).toEqual([]);
  });

  it("merges a relative @id from the theme with the absolute form of the same address from us, given the page URL", () => {
    const nodes = [
      { types: ["Product"], id: "/products/x#product" }, // theme's own, relative
      // Ours: the same address on purpose, told apart by the marker.
      { types: ["Product"], id: "https://shop.example/products/x#product", ours: true },
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([]);
  });

  it("without a known page URL, leaves a relative id unresolved and reports the possible conflict rather than guessing", () => {
    const nodes = [
      { types: ["Product"], id: "/products/x#product" },
      { types: ["Product"], id: "https://shop.example/products/x#product", ours: true },
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
      { types: ["Product"], id: "https://shop.example/products/x#product", ours: true },
      { types: ["Product"], id: "" },
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: true }]);
  });

  it("still reports a conflict for two different, unrelated @id values", () => {
    const nodes = [
      { types: ["Product"], id: "https://shop.example/products/x#product", ours: true },
      { types: ["Product"], id: "https://shop.example/products/other-app-node" },
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: true }]);
  });

  it("merges three nodes down to two distinct entities and still counts the survivors", () => {
    const nodes = [
      { types: ["Product"], id: "https://shop.example/products/x#product", ours: true },
      { types: ["Product"], id: "https://shop.example/products/x#product", ours: true }, // dup
      { types: ["Product"], id: "https://shop.example/products/other-app-node" },
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([{ type: "Product", count: 2, weEmitOne: true }]);
  });
});

describe("organizationPairIsInformational", () => {
  it("marks an Organization pair with our node as informational", () => {
    const nodes = [
      { types: ["Organization"], id: "" }, // theme's id-less node
      { types: ["Organization"], id: "https://shop.example#organization", ours: true }, // ours
    ];
    const conflicts = detectConflicts(nodes, "https://shop.example/products/x");
    expect(conflicts).toEqual([{ type: "Organization", count: 2, weEmitOne: true }]);
    expect(organizationPairIsInformational(conflicts[0])).toBe(true);
  });

  it("keeps an Organization pair without our node a real conflict", () => {
    expect(
      organizationPairIsInformational({ type: "Organization", count: 2, weEmitOne: false }),
    ).toBe(false);
  });

  it("never downgrades a Product conflict", () => {
    expect(
      organizationPairIsInformational({ type: "Product", count: 2, weEmitOne: true }),
    ).toBe(false);
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
    hasWebSiteNode: false,
    hasBreadcrumbNode: false,
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

  it("marks WebSite/SearchAction and BreadcrumbList emitted only when the scan actually found them", () => {
    const unlocked = { ...base, seoUnlocked: true };

    const notFound = deriveMissingReasons(unlocked);
    expect(notFound.find((r) => r.nodeType === "WebSite/SearchAction")!.emitted).toBe(false);
    expect(notFound.find((r) => r.nodeType === "BreadcrumbList")!.emitted).toBe(false);
    expect(notFound.find((r) => r.nodeType === "WebSite/SearchAction")!.reason).toMatch(
      /did not find this node/,
    );

    const found = deriveMissingReasons({
      ...unlocked,
      hasWebSiteNode: true,
      hasBreadcrumbNode: true,
    });
    expect(found.find((r) => r.nodeType === "WebSite/SearchAction")!.emitted).toBe(true);
    expect(found.find((r) => r.nodeType === "BreadcrumbList")!.emitted).toBe(true);
  });

  it("reports WebSite/SearchAction and BreadcrumbList as could not be determined when the page was unreadable", () => {
    const reasons = deriveMissingReasons({
      ...base,
      seoUnlocked: true,
      hasWebSiteNode: null,
      hasBreadcrumbNode: null,
    });
    expect(reasons.find((r) => r.nodeType === "WebSite/SearchAction")!.reason).toMatch(
      /could not be determined/i,
    );
    expect(reasons.find((r) => r.nodeType === "BreadcrumbList")!.reason).toMatch(
      /could not be determined/i,
    );
  });

  it("still blames the locked module, not the scan, when seo is not unlocked", () => {
    const reasons = deriveMissingReasons({ ...base, hasWebSiteNode: true });
    const site = reasons.find((r) => r.nodeType === "WebSite/SearchAction")!;
    expect(site.emitted).toBe(false);
    expect(site.reason).toMatch(/operator-configured SEO module/);
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

describe("themeRowKey", () => {
  it("normalises a bare numeric id to the gid form", () => {
    expect(themeRowKey(123456789)).toBe("gid://shopify/OnlineStoreTheme/123456789");
    expect(themeRowKey("123456789")).toBe("gid://shopify/OnlineStoreTheme/123456789");
  });

  it("leaves a gid unchanged", () => {
    const gid = "gid://shopify/OnlineStoreTheme/123456789";
    expect(themeRowKey(gid)).toBe(gid);
  });

  it("leaves a non-numeric fallback value as-is", () => {
    expect(themeRowKey("current")).toBe("current");
  });
});

describe("mergeNarrowScanIntoDetail", () => {
  const richPrevious: ThemeScanResult = {
    hasProductLd: true,
    nodeCount: 1,
    emitters: ["https://x/products/a#product"],
    hasOrganizationLd: true,
    organizationEmitters: ["https://x/#org"],
    checkedUrl: "https://x/products/a",
    product: {
      url: "https://x/products/a",
      nodes: [{ types: ["Product"], id: "https://x/products/a#product" }],
      passwordProtected: false,
      canonical: "https://x/products/a",
      noindex: false,
    },
    home: {
      url: "https://x/",
      nodes: [
        { types: ["WebSite"], id: "https://x/#website" },
        { types: ["FAQPage"], id: "" },
      ],
      passwordProtected: false,
      canonical: "https://x/",
      noindex: false,
    },
    homeConflicts: [],
    robots: { fetched: true, content: "User-agent: *\n", disallowsRelevant: [] },
    watchChanges: [{ page: "home", nodeType: "WebSite", detectedAt: "2026-08-24T00:00:00.000Z" }],
    missingReasons: [{ nodeType: "Product", emitted: true, reason: null, fixScreen: null }],
    richResultsUrl: "https://search.google.com/test/rich-results?url=x",
    hasFAQPage: true,
  };

  const narrow: ThemeScanResult = {
    hasProductLd: false,
    nodeCount: 0,
    emitters: [],
    hasOrganizationLd: false,
    organizationEmitters: [],
    checkedUrl: "https://x/products/a",
    product: {
      url: "https://x/products/a",
      nodes: [],
      passwordProtected: false,
      canonical: null,
      noindex: false,
    },
    productConflicts: [],
    hasAggregateRating: false,
    hasFAQPage: false,
  };

  it("stands alone when there is no previous detail", () => {
    expect(mergeNarrowScanIntoDetail(null, narrow)).toBe(narrow);
  });

  it("updates only what the narrow scan measured, preserving the rich fields", () => {
    const merged = mergeNarrowScanIntoDetail(richPrevious, narrow);
    // Product-page fields come from the narrow scan.
    expect(merged.hasProductLd).toBe(false);
    expect(merged.nodeCount).toBe(0);
    expect(merged.product).toBe(narrow.product);
    // The rich fields the narrow scan never looked at are preserved.
    expect(merged.home).toBe(richPrevious.home);
    expect(merged.robots).toBe(richPrevious.robots);
    expect(merged.watchChanges).toEqual(richPrevious.watchChanges);
    expect(merged.missingReasons).toEqual(richPrevious.missingReasons);
    expect(merged.richResultsUrl).toBe(richPrevious.richResultsUrl);
  });

  it("recomputes hasFAQPage across the fresh product page and the preserved home page", () => {
    // Narrow scan finds no FAQ on the product page, but the preserved home
    // page still carries one - the merged flag must stay true.
    const merged = mergeNarrowScanIntoDetail(richPrevious, narrow);
    expect(merged.hasFAQPage).toBe(true);

    const previousNoHomeFaq = {
      ...richPrevious,
      home: { ...richPrevious.home!, nodes: [{ types: ["WebSite"], id: "" }] },
    };
    expect(mergeNarrowScanIntoDetail(previousNoHomeFaq, narrow).hasFAQPage).toBe(false);
  });

  it("returns the previous detail unchanged when the narrow scan hit the password wall", () => {
    const walled: ThemeScanResult = {
      ...narrow,
      passwordProtected: true,
      product: { ...narrow.product!, nodes: [], passwordProtected: true },
    };
    expect(mergeNarrowScanIntoDetail(richPrevious, walled)).toBe(richPrevious);
  });
});
