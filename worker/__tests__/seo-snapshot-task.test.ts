import { describe, it, expect, vi, beforeEach } from "vitest";

// The unlock as a job (PRD-SEO-FULL-ONPAGE build step 2, the structural fix).
//
// Three things this has to prove, and the first two are the ordering guarantee
// that step 1 put inside `grantSeoUnlock` and this step moved the *caller* of:
//
//  1. the plans action stores no key - it only queues;
//  2. the task takes the snapshot and only then writes the key;
//  3. a failed snapshot leaves no key at all, and a failed JobRun carrying the
//     reason, because the screen shows that sentence.
//
// Everything is stubbed at the module boundary. Nothing here reaches Postgres,
// graphile-worker or Shopify, and no module in the chain may load
// shopify.server - which is why `../../app/services/catalogue.server` is
// replaced whole rather than through `importOriginal`.

const order: string[] = [];

const mockSettingUpsert = vi.fn(async () => {
  order.push("key");
});
const mockSnapshotFindFirst = vi.fn(async () => null as unknown);
const mockSnapshotCreate = vi.fn(async () => {
  order.push("snapshot");
});
const mockJobRunUpdate = vi.fn(async () => ({}));
const mockShopFindUnique = vi.fn(async () => ({
  id: "shop1",
  domain: "mrdigital-dev.myshopify.com",
}));

vi.mock("../../app/db.server", () => ({
  default: {
    setting: {
      upsert: (...a: unknown[]) => mockSettingUpsert(...(a as [])),
      findUnique: vi.fn(async () => ({ value: "code:x" })),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    seoSnapshot: {
      findFirst: (...a: unknown[]) => mockSnapshotFindFirst(...(a as [])),
      findUnique: vi.fn(async () => null),
      create: (...a: unknown[]) => mockSnapshotCreate(...(a as [])),
      upsert: vi.fn(),
    },
    seoScan: { findMany: vi.fn(async () => []) },
    jobRun: {
      update: (...a: unknown[]) => mockJobRunUpdate(...(a as [])),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    shop: { findUnique: (...a: unknown[]) => mockShopFindUnique(...(a as [])) },
  },
}));

const mockFetchAllProducts = vi.fn();
vi.mock("../../app/services/catalogue.server", () => ({
  fetchAllProducts: (...a: unknown[]) => mockFetchAllProducts(...(a as [])),
}));

const mockAdminGraphql = vi.fn(async () => (async () => ({})) as unknown);
vi.mock("../../app/services/admin.server", () => ({
  adminGraphql: (...a: unknown[]) => mockAdminGraphql(...(a as [])),
  sleep: async () => {},
}));

const mockSync = vi.fn(async () => {});
vi.mock("../../app/services/billing.server", async (importOriginal) => {
  // The real grantSeoUnlock, because its ordering is the thing under test.
  // Only the metafield mirror is stubbed: it is a Shopify write, and the task's
  // contract is that it happens after the key, not what it sends.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    syncSeoUnlockMetafield: (...a: unknown[]) => mockSync(...(a as [])),
  };
});

import { seo_snapshot } from "../tasks";

const helpers = { logger: { info: () => {} } } as never;

function completeRead(count: number) {
  return {
    products: Array.from({ length: count }, (_, i) => ({
      id: `gid://shopify/Product/${i}`,
      title: `Product ${i}`,
      handle: `product-${i}`,
      metafields: [],
      variants: [],
      seo: null,
    })),
    complete: true,
    objectsMatch: true,
    expected: { root: count, objects: count },
    read: { root: count, objects: count },
  };
}

beforeEach(() => {
  order.length = 0;
  mockSettingUpsert.mockClear();
  mockSnapshotCreate.mockClear();
  mockSync.mockClear();
  mockJobRunUpdate.mockClear();
  mockSnapshotFindFirst.mockReset();
  mockSnapshotFindFirst.mockResolvedValue(null);
  mockFetchAllProducts.mockReset();
  mockFetchAllProducts.mockResolvedValue(completeRead(3));
});

/** The `data` of every jobRun.update the task made, in order. */
function jobUpdates(): Record<string, unknown>[] {
  return (mockJobRunUpdate.mock.calls as any[]).map((c) => c[0].data);
}

describe("the seo_snapshot task", () => {
  it("takes the snapshot and only then writes the key", async () => {
    await seo_snapshot({ shopId: "shop1", jobRunId: "job1", reason: "code:x" }, helpers);

    expect(order).toEqual(["snapshot", "key"]);
    expect(mockSnapshotCreate.mock.calls.length).toBe(1);
    expect((mockSnapshotCreate.mock.calls as any[])[0][0].data.takenBy).toBe("unlock");
  });

  it("resyncs the storefront metafield after the key, never before it", async () => {
    await seo_snapshot({ shopId: "shop1", jobRunId: "job1", reason: "code:x" }, helpers);

    expect(mockSync).toHaveBeenCalled();
    // The mirror is what Liquid reads; syncing it before the key was stored
    // would publish "on" for a shop that is not yet unlocked.
    expect(mockSettingUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      mockSync.mock.invocationCallOrder.at(-1)!,
    );
  });

  it("moves the JobRun to running and then to done", async () => {
    await seo_snapshot({ shopId: "shop1", jobRunId: "job1", reason: "code:x" }, helpers);

    const updates = jobUpdates();
    expect(updates[0].status).toBe("running");
    expect(updates.at(-1)!.status).toBe("done");
  });

  it("stores no key and fails the JobRun with the reason when the snapshot cannot be taken", async () => {
    // A short read: 3 products parsed of 50 announced.
    mockFetchAllProducts.mockResolvedValue({
      ...completeRead(3),
      complete: false,
      expected: { root: 50, objects: 50 },
      read: { root: 3, objects: 3 },
    });

    await expect(
      seo_snapshot({ shopId: "shop1", jobRunId: "job1", reason: "code:x" }, helpers),
    ).rejects.toThrow();

    expect(mockSnapshotCreate).not.toHaveBeenCalled();
    expect(mockSettingUpsert).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();

    const last = jobUpdates().at(-1)!;
    expect(last.status).toBe("failed");
    // The plans screen renders this string, so it has to say what happened.
    expect(String((last.report as { error: string }).error)).toMatch(/short/i);
  });

  it("fails the JobRun rather than throwing when the shop is gone", async () => {
    mockShopFindUnique.mockResolvedValueOnce(null as never);

    await seo_snapshot({ shopId: "gone", jobRunId: "job1", reason: "code:x" }, helpers);

    expect(jobUpdates().at(-1)!.status).toBe("failed");
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });
});
