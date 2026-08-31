import { describe, it, expect } from "vitest";
import { diffThemeScans, formatSeoWatchLine } from "../seo-watch";
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
