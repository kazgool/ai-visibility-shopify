import { describe, expect, it } from "vitest";

// Check B6 (PRD-SEO-PER-PRODUCT section 2.1), and specifically the distinction
// it exists to make: a node the merchant switched off is not a finding, a node
// that should be there and is not, is.
//
// `deriveMissingReasons` returns "is it emitted", with "you turned this off",
// "this needs data you have not entered" and "we could not tell" all in the
// same shape. Reporting the first as a defect is how a findings screen teaches
// people to ignore it, so every reason it can produce is classified here and
// each class is asserted separately.

import {
  b6Detail,
  breakdownNodes,
  classifyNode,
  type NodeContext,
  type NodeReason,
} from "../seo-nodes";
import { deriveMissingReasons, type MissingReasonInput } from "../theme-scan.server";

const ON: NodeContext = {
  outputDisabled: false,
  presentButDisabled: false,
  seoUnlocked: true,
  unreadable: false,
};

function reason(over: Partial<NodeReason> = {}): NodeReason {
  return { nodeType: "Product", emitted: false, reason: "x", fixScreen: "/app/products", ...over };
}

/** Every input present and satisfied, so nothing is missing for the wrong reason. */
function input(over: Partial<MissingReasonInput> = {}): MissingReasonInput {
  return {
    embedActive: true,
    mode: "extend",
    hasFacts: true,
    hasSummary: true,
    hasFitFor: true,
    hasReturnDays: true,
    hasDeliveryTime: true,
    hasRating: true,
    hasWebSiteNode: true,
    hasBreadcrumbNode: true,
    hasCollectionQuestions: true,
    hasSocialProfiles: true,
    seoUnlocked: true,
    isCollectionPage: false,
    ...over,
  };
}

describe("classifying one node", () => {
  it("calls an emitted node emitted, whatever the context", () => {
    expect(classifyNode(reason({ emitted: true }), ON)).toBe("emitted");
    expect(classifyNode(reason({ emitted: true }), { ...ON, outputDisabled: true })).toBe("emitted");
  });

  it("calls a fixable absence missing", () => {
    expect(classifyNode(reason({ fixScreen: "/app/business" }), ON)).toBe("missing");
  });

  // The case the whole module is for.
  it("calls it off when the merchant switched the output off", () => {
    expect(classifyNode(reason(), { ...ON, outputDisabled: true })).toBe("off");
  });

  it("calls it off when the embed block itself is switched off", () => {
    expect(classifyNode(reason(), { ...ON, presentButDisabled: true })).toBe("off");
  });

  it("calls it off when the operator has not enabled the SEO module", () => {
    const r = reason({
      reason: "This property is part of the operator-configured SEO module, not yet enabled for this shop.",
      fixScreen: null,
    });
    expect(classifyNode(r, { ...ON, seoUnlocked: false })).toBe("off");
  });

  it("calls an absence with no screen behind it unknown, not missing", () => {
    expect(classifyNode(reason({ fixScreen: null }), ON)).toBe("unknown");
  });

  // One failed Admin call must not become six missing nodes.
  it("calls everything unknown when the settings file could not be read", () => {
    expect(classifyNode(reason(), { ...ON, unreadable: true })).toBe("unknown");
  });
});

describe("B6 over the real reasons deriveMissingReasons produces", () => {
  it("raises nothing when every node is emitted", () => {
    expect(b6Detail(deriveMissingReasons(input()), ON)).toBeNull();
  });

  it("names a Product node that extend mode has nothing to add to", () => {
    const detail = b6Detail(
      deriveMissingReasons(input({ hasFacts: false, hasSummary: false })),
      ON,
    );
    expect(detail).not.toBeNull();
    const missing = (detail as any).missing.map((m: any) => m.nodeType);
    expect(missing).toContain("Product");
  });

  // The mode is read from the block now rather than hardcoded, and this is why:
  // Full mode emits the Product node regardless of facts.
  it("does not name the Product node in full mode, facts or no facts", () => {
    const detail = b6Detail(
      deriveMissingReasons(input({ mode: "full", hasFacts: false, hasSummary: false })),
      ON,
    );
    expect(detail).toBeNull();
  });

  it("names Organization when no social profiles are filled in", () => {
    const detail = b6Detail(deriveMissingReasons(input({ hasSocialProfiles: false })), ON);
    expect((detail as any).missing.map((m: any) => m.nodeType)).toContain("Organization");
    expect((detail as any).missing.find((m: any) => m.nodeType === "Organization").fixScreen).toBe(
      "/app/business",
    );
  });

  it("names MerchantReturnPolicy when the return window is empty", () => {
    const detail = b6Detail(deriveMissingReasons(input({ hasReturnDays: false })), ON);
    expect((detail as any).missing.map((m: any) => m.nodeType)).toContain("MerchantReturnPolicy");
  });

  it("names OfferShippingDetails when the delivery time is empty", () => {
    const detail = b6Detail(deriveMissingReasons(input({ hasDeliveryTime: false })), ON);
    expect((detail as any).missing.map((m: any) => m.nodeType)).toContain("OfferShippingDetails");
  });

  it("names a WebSite node the scan looked for and did not find", () => {
    const detail = b6Detail(deriveMissingReasons(input({ hasWebSiteNode: false })), ON);
    expect((detail as any).missing.map((m: any) => m.nodeType)).toContain("WebSite/SearchAction");
  });

  it("names a BreadcrumbList the scan looked for and did not find", () => {
    const detail = b6Detail(deriveMissingReasons(input({ hasBreadcrumbNode: false })), ON);
    expect((detail as any).missing.map((m: any) => m.nodeType)).toContain("BreadcrumbList");
  });

  // "If we did not fetch it, we do not say."
  it("raises nothing for a page that has never been read", () => {
    const detail = b6Detail(
      deriveMissingReasons(
        input({ hasRating: null, hasWebSiteNode: null, hasBreadcrumbNode: null }),
      ),
      ON,
    );
    expect(detail).toBeNull();
  });

  it("raises nothing for a rating no review app has written", () => {
    // Absent, but nothing in this app can fix it: unknown, not missing.
    const detail = b6Detail(deriveMissingReasons(input({ hasRating: false })), ON);
    expect(detail).toBeNull();
  });

  // The switched-off case, end to end through the real reasons.
  it("raises nothing at all when the merchant switched the output off", () => {
    const reasons = deriveMissingReasons(
      input({ embedActive: false, hasFacts: false, hasSummary: false, hasSocialProfiles: false }),
    );
    // Every node comes back absent...
    expect(reasons.every((r) => !r.emitted)).toBe(true);
    // ...and not one of them is a finding, because it was a choice.
    expect(b6Detail(reasons, { ...ON, outputDisabled: true })).toBeNull();
    const breakdown = breakdownNodes(reasons, { ...ON, outputDisabled: true });
    expect(breakdown.off.length).toBe(reasons.length);
    expect(breakdown.missing).toEqual([]);
  });

  // An embed nobody ever set up is a defect, and the same reasons prove it -
  // only the context differs.
  it("does raise when the embed was never set up at all", () => {
    const reasons = deriveMissingReasons(input({ embedActive: false }));
    const detail = b6Detail(reasons, ON);
    expect(detail).not.toBeNull();
    expect((detail as any).missing.length).toBeGreaterThan(0);
  });

  it("counts the switched-off nodes alongside the missing ones without mixing them", () => {
    // Module off for this shop, so WebSite and BreadcrumbList are off by the
    // operator's choice, while the return window is genuinely unfilled.
    const reasons = deriveMissingReasons(
      input({ seoUnlocked: false, hasReturnDays: false }),
    );
    const detail = b6Detail(reasons, { ...ON, seoUnlocked: false });
    expect(detail).not.toBeNull();
    expect((detail as any).missing.map((m: any) => m.nodeType)).toEqual([
      "MerchantReturnPolicy",
    ]);
    expect((detail as any).offCount).toBe(2);
    expect((detail as any).off).toEqual(["WebSite/SearchAction", "BreadcrumbList"]);
  });

  // If the sentence is reworded and the fragment list is not, the node reads as
  // missing rather than off: noisy and visible, which is the safe direction.
  // This asserts the pairing so it fails instead of drifting.
  it("still recognises the operator-module sentence deriveMissingReasons writes", () => {
    const reasons = deriveMissingReasons(input({ seoUnlocked: false }));
    const website = reasons.find((r) => r.nodeType === "WebSite/SearchAction");
    expect(website?.reason).toContain("operator-configured SEO module");
    expect(classifyNode(website as NodeReason, { ...ON, seoUnlocked: false })).toBe("off");
  });
});
