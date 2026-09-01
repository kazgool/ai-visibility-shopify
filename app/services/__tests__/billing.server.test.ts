import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mayProcessAutomatically and mayProcessAutomaticallyCached are the gate for
// every automatic path (the poll, the sweep, the webhooks) - FREE-TIER-SPEC
// §3 excludes automatic freshness from the free tier. Both read the comped
// Setting row through isComped, so db.setting is stubbed the same way
// llms-txt.server.test.ts stubs it.
const mockSettingFindUnique = vi.fn();
const mockSettingDeleteMany = vi.fn();

vi.mock("../../db.server", () => ({
  default: {
    setting: {
      findUnique: (...args: unknown[]) => mockSettingFindUnique(...args),
      deleteMany: (...args: unknown[]) => mockSettingDeleteMany(...args),
    },
  },
}));

import {
  mayProcessAutomatically,
  mayProcessAutomaticallyCached,
  checkSeoUnlockKey,
  isSeoUnlocked,
  revokeSeoUnlock,
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

// revokeSeoUnlock is the other half of grantSeoUnlock (finding: the flag
// could be granted but never revoked). It must delete the same Setting row
// grantSeoUnlock writes, keyed by the same shopId and key, so isSeoUnlocked
// reads false again afterwards - and it must not require any other database
// shape than what grant already uses.
describe("revokeSeoUnlock", () => {
  beforeEach(() => {
    mockSettingFindUnique.mockReset();
    mockSettingDeleteMany.mockReset();
  });

  it("deletes the seo_unlocked Setting row for this shop", async () => {
    mockSettingDeleteMany.mockResolvedValue({ count: 1 });

    await revokeSeoUnlock("shop1");

    expect(mockSettingDeleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop1", key: "seo_unlocked" },
    });
  });

  it("leaves the shop reading as not unlocked afterwards", async () => {
    // isSeoUnlocked reads the row back; after a delete there is none.
    mockSettingFindUnique.mockResolvedValue(null);
    const unlocked = await isSeoUnlocked("shop1");
    expect(unlocked).toBe(false);
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
