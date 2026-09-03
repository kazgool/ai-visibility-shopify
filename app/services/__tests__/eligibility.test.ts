// Section J.7. The whole decision about which products get a public text
// page, asserted without a database and without a browser.
//
// This file replaces facts.server.eligibility.test.ts, whose subject
// (isEligibleForMirror) is deleted: it knew three product statuses where
// Shopify has four, and it treated a missing status as eligible.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  catalogueQuery,
  eligibility,
  DEFAULT_PREFS,
  NEVER_GIVEN_A_PAGE,
  OUT_OF_STOCK_HELP,
  UNLISTED_HELP,
  type PublishPrefs,
} from "../eligibility";

const URL_ = "https://x/products/set-masa";
const BOTH_ON: PublishPrefs = { includeOutOfStock: true, includeUnlisted: true };
const BOTH_OFF: PublishPrefs = { includeOutOfStock: false, includeUnlisted: false };
const ALL_PREFS: PublishPrefs[] = [
  BOTH_ON,
  BOTH_OFF,
  { includeOutOfStock: true, includeUnlisted: false },
  { includeOutOfStock: false, includeUnlisted: true },
];

describe("eligibility()", () => {
  it("is eligible when active, on the Online Store and in stock", () => {
    expect(
      eligibility({ status: "ACTIVE", onlineStoreUrl: URL_, available: true }, DEFAULT_PREFS),
    ).toBe("eligible");
  });

  it("refuses a draft whatever the toggles say", () => {
    for (const prefs of ALL_PREFS) {
      expect(eligibility({ status: "DRAFT", onlineStoreUrl: URL_ }, prefs)).toBe("not-active");
    }
  });

  it("refuses an archived product whatever the toggles say", () => {
    for (const prefs of ALL_PREFS) {
      expect(eligibility({ status: "ARCHIVED", onlineStoreUrl: URL_ }, prefs)).toBe("not-active");
    }
  });

  it("refuses a product with no Online Store address, in all four toggle combinations", () => {
    for (const prefs of ALL_PREFS) {
      expect(eligibility({ status: "ACTIVE", onlineStoreUrl: null }, prefs)).toBe(
        "not-on-online-store",
      );
    }
  });

  it("excludes an unlisted product by default and includes it when asked", () => {
    expect(eligibility({ status: "UNLISTED", onlineStoreUrl: URL_ }, DEFAULT_PREFS)).toBe(
      "unlisted-excluded",
    );
    expect(eligibility({ status: "UNLISTED", onlineStoreUrl: URL_ }, BOTH_ON)).toBe("eligible");
  });

  it("never lets unlisted override publication", () => {
    expect(eligibility({ status: "UNLISTED", onlineStoreUrl: null }, BOTH_ON)).toBe(
      "not-on-online-store",
    );
  });

  it("keeps sold-out products by default and withdraws them when asked", () => {
    expect(
      eligibility({ status: "ACTIVE", onlineStoreUrl: URL_, available: false }, DEFAULT_PREFS),
    ).toBe("eligible");
    expect(
      eligibility({ status: "ACTIVE", onlineStoreUrl: URL_, available: false }, BOTH_OFF),
    ).toBe("out-of-stock-excluded");
  });

  it("treats an unknown availability as not out of stock", () => {
    expect(
      eligibility({ status: "ACTIVE", onlineStoreUrl: URL_, available: undefined }, BOTH_OFF),
    ).toBe("eligible");
  });

  it("treats a missing status as not active - the safe direction", () => {
    expect(eligibility({ onlineStoreUrl: URL_ }, DEFAULT_PREFS)).toBe("not-active");
  });
});

describe("catalogueQuery()", () => {
  it("asks for active, published products by default", () => {
    expect(catalogueQuery(DEFAULT_PREFS)).toBe("status:active AND published_status:published");
  });

  it("widens to unlisted when the merchant includes them", () => {
    expect(catalogueQuery(BOTH_ON)).toBe("status:active,unlisted AND published_status:published");
  });

  it("is the filter the bulk export is actually built with", () => {
    // Importing catalogue.server.ts pulls in admin.server.ts, which calls
    // shopifyApp() at module load and throws without SHOPIFY_APP_URL - green
    // locally where .env exists, red in CI where it does not. The source text
    // is checked instead, the same way the test this one replaces did.
    const source = readFileSync(join(__dirname, "../catalogue.server.ts"), "utf8");
    expect(source).toMatch(/products\(query:\s*"\$\{filter\}"\)/);
    expect(source).toMatch(/catalogueQuery\(DEFAULT_PREFS\)/);
  });
});

describe("the sentences the card renders", () => {
  // The screen must not be able to state a rule the writers do not apply, so
  // both read these from the same module. Plain characters only, everywhere.
  it("names what is refused outright, with its reason", () => {
    expect(NEVER_GIVEN_A_PAGE).toContain("Never given a page");
    expect(NEVER_GIVEN_A_PAGE).toContain("drafts");
    expect(NEVER_GIVEN_A_PAGE).toContain("not published to the Online Store");
  });

  it("states the effect of each toggle, including what turning it off removes", () => {
    expect(OUT_OF_STOCK_HELP).toContain("withdraw those pages");
    expect(UNLISTED_HELP).toContain("not read by the catalogue pass");
  });

  it("uses plain characters only", () => {
    for (const text of [NEVER_GIVEN_A_PAGE, OUT_OF_STOCK_HELP, UNLISTED_HELP]) {
      expect(text).not.toMatch(/[–—‘’“”…]/);
    }
  });
});
