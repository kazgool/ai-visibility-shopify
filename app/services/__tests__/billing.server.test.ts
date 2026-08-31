import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mayProcessAutomatically and mayProcessAutomaticallyCached are the gate for
// every automatic path (the poll, the sweep, the webhooks) - FREE-TIER-SPEC
// §3 excludes automatic freshness from the free tier. Both read the comped
// Setting row through isComped, so db.setting is stubbed the same way
// llms-txt.server.test.ts stubs it.
const mockSettingFindUnique = vi.fn();

vi.mock("../../db.server", () => ({
  default: {
    setting: { findUnique: (...args: unknown[]) => mockSettingFindUnique(...args) },
  },
}));

import {
  mayProcessAutomatically,
  mayProcessAutomaticallyCached,
  checkSeoUnlockKey,
} from "../billing.server";

describe("mayProcessAutomatically", () => {
  beforeEach(() => {
    mockSettingFindUnique.mockReset();
  });

  it("allows a comped shop without calling Shopify at all", async () => {
    mockSettingFindUnique.mockResolvedValue({ value: "friends and family" });
    const graphql = vi.fn();

    const allowed = await mayProcessAutomatically(
      { id: "shop1", domain: "nordwood.myshopify.com" },
      graphql,
    );

    expect(allowed).toBe(true);
    expect(graphql).not.toHaveBeenCalled();
  });

  it("allows a shop with an active Shopify subscription", async () => {
    mockSettingFindUnique.mockResolvedValue(null);
    const graphql = vi.fn().mockResolvedValue({
      currentAppInstallation: {
        activeSubscriptions: [{ id: "gid://1", name: "Standard", status: "ACTIVE", test: false }],
      },
    });

    const allowed = await mayProcessAutomatically(
      { id: "shop1", domain: "nordwood.myshopify.com" },
      graphql,
    );

    expect(allowed).toBe(true);
  });

  it("refuses a shop with no comp and no active subscription", async () => {
    mockSettingFindUnique.mockResolvedValue(null);
    const graphql = vi.fn().mockResolvedValue({
      currentAppInstallation: { activeSubscriptions: [] },
    });

    const allowed = await mayProcessAutomatically(
      { id: "shop1", domain: "nordwood.myshopify.com" },
      graphql,
    );

    expect(allowed).toBe(false);
  });

  it("refuses a shop whose only subscription is cancelled, not active", async () => {
    mockSettingFindUnique.mockResolvedValue(null);
    const graphql = vi.fn().mockResolvedValue({
      currentAppInstallation: {
        activeSubscriptions: [{ id: "gid://1", name: "Standard", status: "CANCELLED", test: false }],
      },
    });

    const allowed = await mayProcessAutomatically(
      { id: "shop1", domain: "nordwood.myshopify.com" },
      graphql,
    );

    expect(allowed).toBe(false);
  });
});

describe("mayProcessAutomaticallyCached", () => {
  beforeEach(() => {
    mockSettingFindUnique.mockReset();
  });

  it("allows a comped shop regardless of its cached plan", async () => {
    mockSettingFindUnique.mockResolvedValue({ value: "our own store" });

    const allowed = await mayProcessAutomaticallyCached({
      id: "shop1",
      domain: "nordwood.myshopify.com",
      plan: "none",
    });

    expect(allowed).toBe(true);
  });

  it("allows a shop whose cached plan is standard", async () => {
    mockSettingFindUnique.mockResolvedValue(null);

    const allowed = await mayProcessAutomaticallyCached({
      id: "shop1",
      domain: "nordwood.myshopify.com",
      plan: "standard",
    });

    expect(allowed).toBe(true);
  });

  it("allows a shop whose cached plan is high_volume", async () => {
    mockSettingFindUnique.mockResolvedValue(null);

    const allowed = await mayProcessAutomaticallyCached({
      id: "shop1",
      domain: "nordwood.myshopify.com",
      plan: "high_volume",
    });

    expect(allowed).toBe(true);
  });

  it("refuses an uncomped shop with no cached plan", async () => {
    mockSettingFindUnique.mockResolvedValue(null);

    const allowed = await mayProcessAutomaticallyCached({
      id: "shop1",
      domain: "nordwood.myshopify.com",
      plan: "none",
    });

    expect(allowed).toBe(false);
  });
});

// checkSeoUnlockKey is the same constant-time comparison as checkMasterKey,
// against a separate secret (SEO_UNLOCK_KEY) that gates an unrelated
// storefront capability, not billing.
describe("checkSeoUnlockKey", () => {
  const ORIGINAL_KEY = process.env.SEO_UNLOCK_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.SEO_UNLOCK_KEY;
    else process.env.SEO_UNLOCK_KEY = ORIGINAL_KEY;
  });

  it("accepts the correct key", () => {
    process.env.SEO_UNLOCK_KEY = "correct-horse-battery-staple";
    expect(checkSeoUnlockKey("correct-horse-battery-staple")).toBe(true);
  });

  it("rejects a wrong key", () => {
    process.env.SEO_UNLOCK_KEY = "correct-horse-battery-staple";
    expect(checkSeoUnlockKey("wrong-key")).toBe(false);
  });

  it("rejects an empty candidate", () => {
    process.env.SEO_UNLOCK_KEY = "correct-horse-battery-staple";
    expect(checkSeoUnlockKey("")).toBe(false);
  });

  it("rejects everything when the env var is unset", () => {
    delete process.env.SEO_UNLOCK_KEY;
    expect(checkSeoUnlockKey("anything")).toBe(false);
  });
});
