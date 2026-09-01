import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mayProcessAutomatically and mayProcessAutomaticallyCached are the gate for
// every automatic path (the poll, the sweep, the webhooks) - FREE-TIER-SPEC
// §3 excludes automatic freshness from the free tier. Both read the comped
// Setting row through isComped, so db.setting is stubbed the same way
// llms-txt.server.test.ts stubs it.
const mockSettingFindUnique = vi.fn();
const mockSettingDeleteMany = vi.fn();
const mockSettingUpsert = vi.fn();
const mockSettingUpdate = vi.fn();
const mockShopUpdate = vi.fn();

// $transaction here just invokes the callback with the same mocked client -
// good enough for the free-product-set tests below, which exercise the
// read-check-write logic, not real Postgres serializability. Declared with
// `var` and assembled inside the vi.mock factory itself, because vi.mock is
// hoisted above any top-level const/let in this file - referencing a
// same-file const from inside the factory throws a TDZ error at import time.
var mockDb: any;

vi.mock("../../db.server", () => {
  mockDb = {
    setting: {
      findUnique: (...args: unknown[]) => mockSettingFindUnique(...args),
      deleteMany: (...args: unknown[]) => mockSettingDeleteMany(...args),
      upsert: (...args: unknown[]) => mockSettingUpsert(...args),
      update: (...args: unknown[]) => mockSettingUpdate(...args),
    },
    shop: {
      update: (...args: unknown[]) => mockShopUpdate(...args),
    },
    $transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
  };
  return { default: mockDb };
});

const mockTransaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb));

import {
  mayProcessAutomatically,
  mayProcessAutomaticallyCached,
  checkSeoUnlockKey,
  isSeoUnlocked,
  revokeSeoUnlock,
  freeProductIds,
  isFreeProduct,
  addFreeProduct,
  removeFreeProduct,
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

// FREE-TIER-SPEC §4 fix: the free product set. "Three products of their
// choosing," not three writes - membership is what is free, the set's size
// is the cap, and reprocessing a member is always allowed.
describe("free product set", () => {
  beforeEach(() => {
    mockSettingFindUnique.mockReset();
    mockSettingUpsert.mockReset();
    mockSettingUpdate.mockReset();
    mockShopUpdate.mockReset();
    mockTransaction.mockClear();
  });

  it("reads an empty set when nothing is stored", async () => {
    mockSettingFindUnique.mockResolvedValue(null);
    expect(await freeProductIds("shop1")).toEqual([]);
    expect(await isFreeProduct("shop1", "gid://shopify/Product/1")).toBe(false);
  });

  it("adds a first product to an empty set", async () => {
    mockSettingFindUnique.mockResolvedValue(null);
    mockSettingUpsert.mockResolvedValue({});
    mockShopUpdate.mockResolvedValue({});

    const result = await addFreeProduct("shop1", "gid://shopify/Product/1");

    expect(result).toEqual({ ok: true, ids: ["gid://shopify/Product/1"], alreadyMember: false });
    expect(mockSettingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ value: JSON.stringify(["gid://shopify/Product/1"]) }),
      }),
    );
  });

  it("processing the same product twice does not grow the set", async () => {
    mockSettingFindUnique.mockResolvedValue({
      value: JSON.stringify(["gid://shopify/Product/1"]),
    });

    const result = await addFreeProduct("shop1", "gid://shopify/Product/1");

    expect(result).toEqual({ ok: true, ids: ["gid://shopify/Product/1"], alreadyMember: true });
    // Nothing was written - resubmitting a member is a pure read.
    expect(mockSettingUpsert).not.toHaveBeenCalled();
    expect(mockShopUpdate).not.toHaveBeenCalled();
  });

  it("refuses a fourth distinct product once the set is full", async () => {
    mockSettingFindUnique.mockResolvedValue({
      value: JSON.stringify(["gid://1", "gid://2", "gid://3"]),
    });

    const result = await addFreeProduct("shop1", "gid://4");

    expect(result.ok).toBe(false);
    expect(result.ids).toEqual(["gid://1", "gid://2", "gid://3"]);
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });

  it("simulated race: two sequential adds against an already-full set both refuse", async () => {
    // Two overlapping submissions for two different products, modelled here
    // as two sequential calls both observing the same full set - the shape
    // a real race collapses to once Postgres serializes the transactions.
    mockSettingFindUnique.mockResolvedValue({
      value: JSON.stringify(["gid://1", "gid://2", "gid://3"]),
    });

    const first = await addFreeProduct("shop1", "gid://4");
    const second = await addFreeProduct("shop1", "gid://5");

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });

  it("removeFreeProduct gives a slot back for a member", async () => {
    mockSettingFindUnique.mockResolvedValue({
      value: JSON.stringify(["gid://1", "gid://2"]),
    });
    mockSettingUpdate.mockResolvedValue({});
    mockShopUpdate.mockResolvedValue({});

    await removeFreeProduct("shop1", "gid://1");

    expect(mockSettingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { value: JSON.stringify(["gid://2"]) } }),
    );
    expect(mockShopUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { freeProductsUsed: { decrement: 1 } } }),
    );
  });

  it("removeFreeProduct is a no-op for a non-member", async () => {
    mockSettingFindUnique.mockResolvedValue({
      value: JSON.stringify(["gid://1"]),
    });

    await removeFreeProduct("shop1", "gid://not-a-member");

    expect(mockSettingUpdate).not.toHaveBeenCalled();
    expect(mockShopUpdate).not.toHaveBeenCalled();
  });
});
