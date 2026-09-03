// This file used to test isEligibleForMirror. That function is gone: it knew
// three product statuses where Shopify has four, it treated a missing status
// as eligible, and it could not express the merchant's two publishing
// toggles. Its subject moved to eligibility.ts and its rows moved to
// eligibility.test.ts.
//
// What is left here is a guard. One decision about which products get a
// public text page, in one place - a second one that drifts is exactly how a
// draft product ends up with a page again.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as facts from "../facts.server";

describe("the mirror-eligibility decision lives in one place", () => {
  it("is no longer exported from facts.server.ts", () => {
    expect("isEligibleForMirror" in facts).toBe(false);
  });

  it("has no second implementation left in the source", () => {
    const source = readFileSync(join(__dirname, "../facts.server.ts"), "utf8");
    expect(source).not.toMatch(/function isEligibleForMirror/);
  });
});
