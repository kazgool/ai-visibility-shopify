// Section I.2 and the I.6 row "unpublished, webhook delivered, shop without
// paid access". This is the larger of the two holes and it is not a lost
// webhook: the free tier writes mirror rows for three merchant-chosen
// products, and every row a lapsed shop wrote while it was paid is still
// serving. The entitlement gate returned before the withdrawal branch, so on
// such a shop the only thing that ever removed a row was products/delete.
//
// Withdrawal writes nothing to Shopify and costs no pass, so it is never
// gated. Everything that does write still is, and that is asserted here too.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockShopFindUnique = vi.fn();
const mockMirrorFindFirst = vi.fn();
const mockMirrorDelete = vi.fn();

vi.mock("../../db.server", () => ({
  default: {
    shop: { findUnique: (...a: unknown[]) => mockShopFindUnique(...a) },
    setting: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    jobRun: { update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    mirrorCache: {
      findFirst: (...a: unknown[]) => mockMirrorFindFirst(...a),
      delete: (...a: unknown[]) => mockMirrorDelete(...a),
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
  },
}));

const mockMayProcessAutomaticallyCached = vi.fn();
vi.mock("../billing.server", () => ({
  mayProcessAutomatically: vi.fn(),
  mayProcessAutomaticallyCached: (...a: unknown[]) => mockMayProcessAutomaticallyCached(...a),
  isSeoUnlocked: vi.fn(),
  hasPaidAccess: vi.fn(),
}));

const graphql = vi.fn();
const mockAdminGraphql = vi.fn();
vi.mock("../admin.server", () => ({
  adminGraphql: (...a: unknown[]) => mockAdminGraphql(...a),
  sleep: async () => {},
}));

const mockFetchProduct = vi.fn();
vi.mock("../catalogue.server", () => ({
  fetchProduct: (...a: unknown[]) => mockFetchProduct(...a),
  fetchAllProducts: vi.fn(),
  fetchShopInfo: vi.fn(),
  saveShopInfo: vi.fn(),
}));

const mockPrefsFor = vi.fn();
vi.mock("../eligibility.server", () => ({
  prefsFor: (...a: unknown[]) => mockPrefsFor(...a),
  savePrefs: vi.fn(),
}));

const mockWriteFacts = vi.fn();
vi.mock("../facts.server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeFacts: (...a: unknown[]) => mockWriteFacts(...a),
    writeVariantFacts: vi.fn(),
  };
});

vi.mock("../queue.server", () => ({ enqueue: vi.fn() }));

import { withdrawIfIneligible } from "../extract.server";
import { extract_product } from "../../../worker/tasks";
import { DEFAULT_PREFS } from "../eligibility";

const SHOP = { id: "shop1", domain: "nordwood.myshopify.com", plan: "none" };
const GID = "gid://shopify/Product/1";
const ROW = { id: "row1", shopId: "shop1", handle: "set-masa", productId: GID };

const helpers = { logger: { info: vi.fn(), error: vi.fn() }, addJob: vi.fn() } as any;

function live(overrides: Record<string, unknown> = {}) {
  return {
    id: GID,
    handle: "set-masa",
    title: "Set masa",
    status: "ACTIVE",
    onlineStoreUrl: "https://nordwood.ro/products/set-masa",
    available: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockShopFindUnique.mockResolvedValue(SHOP);
  mockAdminGraphql.mockResolvedValue(graphql);
  mockPrefsFor.mockResolvedValue(DEFAULT_PREFS);
});

describe("withdrawIfIneligible", () => {
  it("costs zero Admin API calls when this product has no page - the common free-tier case", async () => {
    mockMirrorFindFirst.mockResolvedValue(null);

    expect(await withdrawIfIneligible("shop1", GID)).toBe(false);
    expect(mockFetchProduct).not.toHaveBeenCalled();
    expect(mockAdminGraphql).not.toHaveBeenCalled();
    expect(mockMirrorDelete).not.toHaveBeenCalled();
  });

  it("deletes the row of an unpublished product, with exactly one product read", async () => {
    mockMirrorFindFirst.mockResolvedValue(ROW);
    mockFetchProduct.mockResolvedValue(live({ onlineStoreUrl: null }));

    expect(await withdrawIfIneligible("shop1", GID)).toBe(true);
    expect(mockFetchProduct).toHaveBeenCalledTimes(1);
    expect(mockMirrorDelete).toHaveBeenCalledWith({ where: { id: "row1" } });
  });

  it("deletes the row of a drafted product", async () => {
    mockMirrorFindFirst.mockResolvedValue(ROW);
    mockFetchProduct.mockResolvedValue(live({ status: "DRAFT" }));

    expect(await withdrawIfIneligible("shop1", GID)).toBe(true);
    expect(mockMirrorDelete).toHaveBeenCalled();
  });

  it("deletes the old-handle row of a renamed product", async () => {
    mockMirrorFindFirst.mockResolvedValue(ROW);
    mockFetchProduct.mockResolvedValue(live({ handle: "set-masa-nou" }));

    expect(await withdrawIfIneligible("shop1", GID)).toBe(true);
    expect(mockMirrorDelete).toHaveBeenCalled();
  });

  it("deletes the row of a product the Admin API no longer returns", async () => {
    mockMirrorFindFirst.mockResolvedValue(ROW);
    mockFetchProduct.mockResolvedValue(null);

    expect(await withdrawIfIneligible("shop1", GID)).toBe(true);
    expect(mockMirrorDelete).toHaveBeenCalled();
  });

  it("keeps the page of a product that still qualifies", async () => {
    mockMirrorFindFirst.mockResolvedValue(ROW);
    mockFetchProduct.mockResolvedValue(live());

    expect(await withdrawIfIneligible("shop1", GID)).toBe(false);
    expect(mockMirrorDelete).not.toHaveBeenCalled();
  });

  it("honours the merchant's toggles: a sold-out product goes when they exclude sold-out ones", async () => {
    mockMirrorFindFirst.mockResolvedValue(ROW);
    mockFetchProduct.mockResolvedValue(live({ available: false }));
    mockPrefsFor.mockResolvedValue({ includeOutOfStock: false, includeUnlisted: false });

    expect(await withdrawIfIneligible("shop1", GID)).toBe(true);
    expect(mockMirrorDelete).toHaveBeenCalled();
  });
});

describe("extract_product on a shop without paid access", () => {
  beforeEach(() => {
    mockMayProcessAutomaticallyCached.mockResolvedValue(false);
  });

  it("withdraws the page and still writes nothing to Shopify", async () => {
    mockMirrorFindFirst.mockResolvedValue(ROW);
    mockFetchProduct.mockResolvedValue(live({ onlineStoreUrl: null }));

    await extract_product({ shopId: "shop1", productGid: GID }, helpers);

    expect(mockMirrorDelete).toHaveBeenCalledWith({ where: { id: "row1" } });
    expect(mockWriteFacts).not.toHaveBeenCalled();
    // One product read, and nothing else.
    expect(mockFetchProduct).toHaveBeenCalledTimes(1);
  });

  it("makes no Admin API call at all when the product has no page", async () => {
    mockMirrorFindFirst.mockResolvedValue(null);

    await extract_product({ shopId: "shop1", productGid: GID }, helpers);

    expect(mockAdminGraphql).not.toHaveBeenCalled();
    expect(mockMirrorDelete).not.toHaveBeenCalled();
    expect(mockWriteFacts).not.toHaveBeenCalled();
  });
});
