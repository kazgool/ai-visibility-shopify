// CC-PROMPT-AI-READABILITY-2 item 7: a save that changes the content language
// enqueues one rewrite, through the existing bulk_extract pass; a save that
// does not, enqueues none. Same one-at-a-time rule as the dashboard.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockShopFindUnique = vi.fn();
const mockJobRunFindFirst = vi.fn();
const mockJobRunCreate = vi.fn();

vi.mock("../../db.server", () => ({
  default: {
    shop: { findUnique: (...a: unknown[]) => mockShopFindUnique(...a) },
    jobRun: {
      findFirst: (...a: unknown[]) => mockJobRunFindFirst(...a),
      create: (...a: unknown[]) => mockJobRunCreate(...a),
    },
  },
}));

vi.mock("../../services/billing.server", () => ({
  hasPaidAccess: async () => true,
}));

const mockBusinessFor = vi.fn();
const mockSaveBusiness = vi.fn();
const mockShopLocaleFor = vi.fn();
vi.mock("../../services/business.server", () => ({
  businessFor: (...a: unknown[]) => mockBusinessFor(...a),
  saveBusiness: (...a: unknown[]) => mockSaveBusiness(...a),
  sanitizeSocialProfiles: () => ({}),
  shopLocaleFor: (...a: unknown[]) => mockShopLocaleFor(...a),
  saveShopLocale: vi.fn(),
}));

const mockEnqueue = vi.fn();
vi.mock("../../services/queue.server", () => ({
  enqueue: (...a: unknown[]) => mockEnqueue(...a),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: async () => ({ admin: { graphql: vi.fn() }, session: { shop: "nordwood.myshopify.com" } }),
  },
}));

import { action } from "../app.business";

const SHOP = { id: "shop1", domain: "nordwood.myshopify.com" };

function save(contentLanguage: string) {
  return action({
    request: new Request("https://example.com/app/business", {
      method: "POST",
      body: new URLSearchParams({ contentLanguage, deliveryTime: "1-2" }),
    }),
    params: {},
    context: {},
  } as any) as Promise<{ saved?: boolean; rewriting?: boolean; rewriteWaiting?: boolean }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockShopFindUnique.mockResolvedValue(SHOP);
  mockShopLocaleFor.mockResolvedValue(null);
  mockJobRunFindFirst.mockResolvedValue(null);
  mockJobRunCreate.mockResolvedValue({ id: "job1" });
});

describe("saving the Business screen", () => {
  it("enqueues one rewrite when the language changes", async () => {
    mockBusinessFor.mockResolvedValue({ contentLanguage: "en" });

    const result = await save("ro");

    expect(result).toEqual({ saved: true, rewriting: true });
    expect(mockSaveBusiness.mock.calls[0][2]).toMatchObject({ contentLanguage: "ro" });
    expect(mockJobRunCreate).toHaveBeenCalledTimes(1);
    expect(mockJobRunCreate.mock.calls[0][0]).toEqual({ data: { shopId: "shop1", kind: "bulk_extract" } });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith("bulk_extract", {
      shopId: "shop1",
      dryRun: false,
      jobRunId: "job1",
    });
  });

  it("enqueues nothing when the language stays the same", async () => {
    mockBusinessFor.mockResolvedValue({ contentLanguage: "ro" });

    const result = await save("ro");

    expect(result).toEqual({ saved: true });
    expect(mockJobRunCreate).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("enqueues nothing when the merchant confirms the store's own language", async () => {
    // Unset before, the store's default read as Romanian: Romanian was already
    // being written, so choosing it changes nothing on any page.
    mockBusinessFor.mockResolvedValue(null);
    mockShopLocaleFor.mockResolvedValue("ro-RO");

    expect(await save("ro")).toEqual({ saved: true });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("starts no second job while another one runs, and says so", async () => {
    mockBusinessFor.mockResolvedValue({ contentLanguage: "en" });
    mockJobRunFindFirst.mockResolvedValue({ kind: "collections" });

    const result = await save("ro");

    expect(result).toEqual({ saved: true, rewriteWaiting: true });
    expect(mockSaveBusiness).toHaveBeenCalledTimes(1);
    expect(mockJobRunCreate).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
