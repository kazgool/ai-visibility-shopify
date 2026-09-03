import { describe, it, expect } from "vitest";
import {
  diffProductFindings,
  diffThemeScans,
  formatProductWatchLine,
  formatSeoWatchLine,
  snapshotFindings,
} from "../seo-watch";
import type { ThemeScanResult } from "../theme-scan.server";

function scan(productTypes: string[], homeTypes: string[]): ThemeScanResult {
  return {
    hasProductLd: productTypes.includes("Product"),
    nodeCount: productTypes.filter((t) => t === "Product").length,
    emitters: [],
    hasOrganizationLd: productTypes.includes("Organization"),
    organizationEmitters: [],
    checkedUrl: "https://x/product",
    product: {
      url: "https://x/product",
      passwordProtected: false,
      nodes: productTypes.map((t) => ({ types: [t], id: "" })),
    },
    home: {
      url: "https://x/",
      passwordProtected: false,
      nodes: homeTypes.map((t) => ({ types: [t], id: "" })),
    },
  };
}

describe("diffThemeScans", () => {
  it("returns nothing on the first scan, when there is no previous one", () => {
    const current = scan(["Product"], ["WebSite"]);
    expect(diffThemeScans(null, current, "2026-09-14T00:00:00.000Z")).toEqual([]);
  });

  it("reports a node type present before and absent now", () => {
    const previous = scan(["Product", "BreadcrumbList"], ["WebSite"]);
    const current = scan(["Product"], ["WebSite"]);
    const changes = diffThemeScans(previous, current, "2026-09-14T00:00:00.000Z");
    expect(changes).toEqual([
      { page: "product", nodeType: "BreadcrumbList", detectedAt: "2026-09-14T00:00:00.000Z" },
    ]);
  });

  it("does not report a new node type as a change", () => {
    const previous = scan(["Product"], ["WebSite"]);
    const current = scan(["Product", "BreadcrumbList"], ["WebSite"]);
    expect(diffThemeScans(previous, current, "2026-09-14T00:00:00.000Z")).toEqual([]);
  });

  it("reports losses on the home page separately from the product page", () => {
    const previous = scan(["Product"], ["WebSite", "Organization"]);
    const current = scan(["Product"], ["WebSite"]);
    const changes = diffThemeScans(previous, current, "2026-09-14T00:00:00.000Z");
    expect(changes).toEqual([
      { page: "home", nodeType: "Organization", detectedAt: "2026-09-14T00:00:00.000Z" },
    ]);
  });

  it("skips comparison for a page the previous scan could not read", () => {
    const previous: ThemeScanResult = {
      hasProductLd: false,
      nodeCount: 0,
      emitters: [],
      hasOrganizationLd: false,
      organizationEmitters: [],
      checkedUrl: "https://x/product",
      passwordProtected: true,
      product: { url: "https://x/product", passwordProtected: true, nodes: [] },
    };
    const current = scan(["Product"], ["WebSite"]);
    expect(diffThemeScans(previous, current, "2026-09-14T00:00:00.000Z")).toEqual([]);
  });
});

describe("formatSeoWatchLine", () => {
  it("names the date, the type and the page in plain English", () => {
    const line = formatSeoWatchLine({
      page: "product",
      nodeType: "BreadcrumbList",
      detectedAt: "2026-09-14T00:00:00.000Z",
    });
    expect(line).toBe("On September 14, BreadcrumbList was no longer found on the product page.");
  });
});

// --- per-product mode (build step 6) ---------------------------------------

describe("the weekly watch, per product", () => {
  const MONDAY = "2026-09-07T04:00:00.000Z";

  function rows(entries: [string, string[]][]) {
    return entries.map(([productId, codes]) => ({
      productId,
      findings: codes.map((code) => ({ code, source: code.startsWith("A") ? "A" : "B", detail: {} })),
    }));
  }

  it("leaves clean products out of the snapshot entirely", () => {
    const snapshot = snapshotFindings(rows([["p1", ["A1", "B3"]], ["p2", []]]));
    expect(snapshot).toEqual({ p1: ["A1", "B3"] });
  });

  it("sorts and de-duplicates codes so an unchanged week compares equal", () => {
    const snapshot = snapshotFindings(rows([["p1", ["B3", "A1", "A1"]]]));
    expect(snapshot).toEqual({ p1: ["A1", "B3"] });
    expect(diffProductFindings(snapshot, snapshotFindings(rows([["p1", ["A1", "B3"]]])), MONDAY)).toEqual([]);
  });

  it("reports nothing at all on the first week, having nothing to compare against", () => {
    expect(diffProductFindings(null, { p1: ["A1"] }, MONDAY)).toEqual([]);
  });

  it("names the products whose findings changed, by code and in both directions", () => {
    const changes = diffProductFindings(
      { p1: ["A1", "A5"], p2: ["B2"] },
      { p1: ["A1", "B3"], p3: ["A4"] },
      MONDAY,
      new Map([
        ["p1", "a-chair"],
        ["p3", "a-table"],
      ]),
    );

    expect(changes).toEqual([
      { productId: "p1", handle: "a-chair", added: ["B3"], removed: ["A5"], detectedAt: MONDAY },
      // p2 lost its only finding: still a change, and still named.
      { productId: "p2", handle: null, added: [], removed: ["B2"], detectedAt: MONDAY },
      // p3 had no entry at all last week, so its first finding is a change.
      { productId: "p3", handle: "a-table", added: ["A4"], removed: [], detectedAt: MONDAY },
    ]);
  });

  it("says nothing about a product that was clean both weeks", () => {
    expect(diffProductFindings({ p1: ["A1"] }, { p1: ["A1"] }, MONDAY)).toEqual([]);
  });

  it("reads as one dated line", () => {
    expect(
      formatProductWatchLine({
        productId: "gid://shopify/Product/9",
        handle: "a-chair",
        added: ["B3"],
        removed: ["A5"],
        detectedAt: MONDAY,
      }),
    ).toBe("On September 7, a-chair gained B3 and lost A5.");

    // No handle recorded: the product id is still something a person can act
    // on, and is better than a line that names nothing.
    expect(
      formatProductWatchLine({
        productId: "gid://shopify/Product/9",
        handle: null,
        added: [],
        removed: ["A1"],
        detectedAt: MONDAY,
      }),
    ).toBe("On September 7, 9 lost A1.");
  });
});
