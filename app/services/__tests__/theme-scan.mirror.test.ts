import { describe, expect, it } from "vitest";
import { themeScanMirror, type LdNode, type ThemeScanResult } from "../theme-scan.server";

// The theme_scan shop metafield is what the storefront block decides on at
// render time (ai-visibility.liquid). These pin the two flags added for
// PRD-AI-READABILITY P0.4 and P0.5, both values of each, and that our own
// nodes never count as the theme's.

const page = (nodes: LdNode[], url = "https://shop.example/products/x") => ({
  url,
  nodes,
  passwordProtected: false,
});

function scan(product: LdNode[], home?: LdNode[]): ThemeScanResult {
  const theirs = product.filter((n) => n.types.includes("Product") && !n.ours);
  return {
    hasProductLd: theirs.length > 0,
    nodeCount: theirs.length,
    emitters: theirs.map((n) => n.id).filter(Boolean),
    hasOrganizationLd: false,
    organizationEmitters: [],
    checkedUrl: "https://shop.example/products/x",
    product: page(product),
    home: home ? page(home, "https://shop.example/") : undefined,
  };
}

describe("themeScanMirror: hasProductLd", () => {
  it("is true with the theme's @id when the theme's Product node carries one", () => {
    const mirror = themeScanMirror(scan([{ types: ["Product"], id: "https://shop.example/products/x#product" }]));
    expect(mirror.hasProductLd).toBe(true);
    expect(mirror.productId).toBe("https://shop.example/products/x#product");
  });

  it("is true with a blank productId when the theme's node has no @id (the B33 case)", () => {
    const mirror = themeScanMirror(scan([{ types: ["Product"], id: "" }]));
    expect(mirror.hasProductLd).toBe(true);
    expect(mirror.productId).toBe("");
  });

  it("is false when the only Product node on the page is ours", () => {
    const mirror = themeScanMirror(scan([{ types: ["Product"], id: "https://shop.example/products/x#product", ours: true }]));
    expect(mirror.hasProductLd).toBe(false);
    expect(mirror.productId).toBe("");
  });
});

describe("themeScanMirror: hasWebSiteLd", () => {
  it("is true when the theme's home page carries a WebSite node", () => {
    const mirror = themeScanMirror(scan([], [{ types: ["WebSite"], id: "" }]));
    expect(mirror.hasWebSiteLd).toBe(true);
  });

  it("is true when the theme puts its WebSite node on the product page", () => {
    const mirror = themeScanMirror(scan([{ types: ["WebSite"], id: "" }], []));
    expect(mirror.hasWebSiteLd).toBe(true);
  });

  it("is false when neither page carries one", () => {
    const mirror = themeScanMirror(scan([{ types: ["Product"], id: "" }], [{ types: ["Organization"], id: "" }]));
    expect(mirror.hasWebSiteLd).toBe(false);
  });

  it("is false when the only WebSite node is ours, so our node is not switched off by itself", () => {
    const mirror = themeScanMirror(scan([], [{ types: ["WebSite"], id: "", ours: true }]));
    expect(mirror.hasWebSiteLd).toBe(false);
  });

  it("ignores a page that answered with the password wall", () => {
    const result = scan([]);
    result.home = { url: "https://shop.example/", nodes: [{ types: ["WebSite"], id: "" }], passwordProtected: true };
    expect(themeScanMirror(result).hasWebSiteLd).toBe(false);
  });
});

describe("themeScanMirror: shape", () => {
  it("carries exactly the five keys the block reads, and nothing from the scan's detail", () => {
    const mirror = themeScanMirror(scan([{ types: ["Product"], id: "" }], [{ types: ["WebSite"], id: "" }]));
    expect(Object.keys(mirror).sort()).toEqual(
      ["hasOrganizationLd", "hasProductLd", "hasWebSiteLd", "organizationId", "productId"],
    );
  });
});
