import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isEligibleForMirror, type ProductInput } from "../facts.server";

const base: ProductInput = { id: "gid://shopify/Product/1", title: "Set masa" };

describe("isEligibleForMirror (status-filter decision, fix 1)", () => {
  it("is eligible when ACTIVE and published to Online Store", () => {
    expect(isEligibleForMirror({ ...base, status: "ACTIVE", onlineStoreUrl: "https://x/products/set-masa" })).toBe(true);
  });

  it("is not eligible when DRAFT, even with an onlineStoreUrl", () => {
    expect(isEligibleForMirror({ ...base, status: "DRAFT", onlineStoreUrl: "https://x/products/set-masa" })).toBe(false);
  });

  it("is not eligible when ARCHIVED", () => {
    expect(isEligibleForMirror({ ...base, status: "ARCHIVED", onlineStoreUrl: "https://x/products/set-masa" })).toBe(false);
  });

  it("is not eligible when ACTIVE but not published to any channel (no onlineStoreUrl)", () => {
    expect(isEligibleForMirror({ ...base, status: "ACTIVE", onlineStoreUrl: null })).toBe(false);
  });

  it("treats a missing status as eligible - the bulk fetch path already filtered at the query level", () => {
    expect(isEligibleForMirror({ ...base })).toBe(true);
  });
});

describe("catalogue.server.ts bulk query (fix 1, source-level check)", () => {
  // Importing catalogue.server.ts pulls in admin.server.ts -> shopify.server.ts
  // at module load time (constructs the real Shopify app config), which is
  // too heavy and too environment-dependent for a unit test - the same
  // reason llms-txt.server.ts keeps its own private copy of the Setting key
  // rather than importing catalogue.server.ts (see the comment at the top of
  // that file). The source text is checked directly instead.
  it("filters the bulk products query to status:active and published_status:published", () => {
    const source = readFileSync(join(__dirname, "../catalogue.server.ts"), "utf8");
    expect(source).toMatch(/products\(query:\s*"status:active AND published_status:published"\)/);
  });
});
