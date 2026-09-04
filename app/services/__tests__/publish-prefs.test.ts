// PRD-PORT-1.7.8 J.7, the rows the QA of 3 September 2026 found without a
// test: the Report screen's publish_prefs action, savePrefs, and the
// products/delete handler. Each assertion is one acceptance row.

import { describe, expect, it, vi, beforeEach } from "vitest";

const settings: { shopId: string; key: string; value: string }[] = [];
const jobRuns: { id: string; shopId: string; kind: string; status: string }[] = [];
const mirrorRows: { id: string; shopId: string; productId: string | null }[] = [];
const seoScanRows: { id: string; shopId: string; productId: string }[] = [];
const upsertCalls: unknown[] = [];

vi.mock("../../db.server", () => ({
  default: {
    shop: {
      findUnique: async ({ where }: any) =>
        where.domain === "nordwood.myshopify.com" ? { id: "shop1", domain: where.domain } : null,
    },
    setting: {
      findMany: async ({ where }: any) =>
        settings.filter((s) => s.shopId === where.shopId && where.key.in.includes(s.key)),
      upsert: async (args: any) => {
        upsertCalls.push(args);
        const { shopId, key } = args.where.shopId_key;
        const existing = settings.find((s) => s.shopId === shopId && s.key === key);
        if (existing) existing.value = args.update.value;
        else settings.push({ shopId, key, value: args.create.value });
      },
    },
    jobRun: {
      findFirst: async ({ where }: any) =>
        jobRuns.find(
          (j) => j.shopId === where.shopId && where.status?.in?.includes(j.status),
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `job${jobRuns.length + 1}`, status: "queued", ...data };
        jobRuns.push(row);
        return row;
      },
    },
    mirrorCache: {
      deleteMany: async ({ where }: any) => {
        const before = mirrorRows.length;
        for (let i = mirrorRows.length - 1; i >= 0; i -= 1) {
          const r = mirrorRows[i];
          if (r.shopId === where.shopId && r.productId === where.productId) mirrorRows.splice(i, 1);
        }
        return { count: before - mirrorRows.length };
      },
    },
    // The per-product SEO row goes the same way as the mirror row, and by the
    // same GID (QA of 3 September 2026): left behind it kept counting in
    // every denominator on the SEO card.
    seoScan: {
      deleteMany: async ({ where }: any) => {
        const before = seoScanRows.length;
        for (let i = seoScanRows.length - 1; i >= 0; i -= 1) {
          const r = seoScanRows[i];
          if (r.shopId === where.shopId && r.productId === where.productId) {
            seoScanRows.splice(i, 1);
          }
        }
        return { count: before - seoScanRows.length };
      },
    },
  },
}));

const mockHasPaidAccess = vi.fn();
vi.mock("../billing.server", () => ({
  hasPaidAccess: (...a: unknown[]) => mockHasPaidAccess(...a),
}));

const enqueued: { task: string; payload: unknown; options: unknown }[] = [];
vi.mock("../queue.server", () => ({
  enqueue: async (task: string, payload: unknown, options: unknown) => {
    enqueued.push({ task, payload, options });
  },
}));

let webhookPayload: unknown = {};
vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: async () => ({
      admin: { graphql: vi.fn() },
      session: { shop: "nordwood.myshopify.com" },
    }),
    webhook: async () => ({ shop: "nordwood.myshopify.com", payload: webhookPayload }),
  },
}));

// The Report route imports Polaris and the metrics module; only its action is
// under test, and the loader is never called here.
import { action as reportAction } from "../../routes/app.report";
import { action as deleteAction } from "../../routes/webhooks.products.delete";
import { prefsFor, savePrefs } from "../eligibility.server";

function post(fields: Record<string, string>) {
  return {
    request: new Request("https://example.com/app/report", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.length = 0;
  jobRuns.length = 0;
  mirrorRows.length = 0;
  seoScanRows.length = 0;
  upsertCalls.length = 0;
  enqueued.length = 0;
  mockHasPaidAccess.mockResolvedValue(true);
});

describe("savePrefs", () => {
  it("writes only what changed and reports whether anything did", async () => {
    // From the defaults (out of stock on, unlisted off), turning out of stock
    // off is one row; saying the same again is none.
    expect(await savePrefs("shop1", { includeOutOfStock: false, includeUnlisted: false })).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    expect(await prefsFor("shop1")).toEqual({ includeOutOfStock: false, includeUnlisted: false });

    expect(await savePrefs("shop1", { includeOutOfStock: false, includeUnlisted: false })).toBe(false);
    expect(upsertCalls).toHaveLength(1);
  });
});

describe("the publish_prefs action", () => {
  it("refuses a shop without paid access: no Setting row, no job, and says so", async () => {
    mockHasPaidAccess.mockResolvedValue(false);

    const result = (await reportAction(post({ intent: "publish_prefs" }))) as { error?: string };

    expect(result.error).toContain("no active subscription");
    expect(settings).toHaveLength(0);
    expect(jobRuns).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("with unchanged values writes nothing and queues nothing", async () => {
    // The defaults, posted back: out of stock checked, unlisted absent.
    const result = (await reportAction(
      post({ intent: "publish_prefs", includeOutOfStock: "on" }),
    )) as { queued?: boolean };

    expect(result.queued).toBe(false);
    expect(upsertCalls).toHaveLength(0);
    expect(jobRuns).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("turning out of stock off writes the row and queues one keyed reconcile job", async () => {
    const result = (await reportAction(post({ intent: "publish_prefs" }))) as { queued?: boolean };

    expect(result.queued).toBe(true);
    expect(settings).toEqual([{ shopId: "shop1", key: "publish_out_of_stock", value: "false" }]);
    expect(jobRuns).toEqual([
      expect.objectContaining({ shopId: "shop1", kind: "reconcile", status: "queued" }),
    ]);
    expect(enqueued).toEqual([
      {
        task: "reconcile_mirrors",
        payload: { shopId: "shop1", jobRunId: "job1" },
        options: { jobKey: "reconcile:shop1" },
      },
    ]);
  });

  it("refuses a second save while a job is queued or running, and names it", async () => {
    // QA wave fix 4: two POSTs ten seconds apart used to make two JobRuns,
    // two jobs and a bulk-operation collision.
    await reportAction(post({ intent: "publish_prefs" }));
    const second = (await reportAction(
      post({ intent: "publish_prefs", includeOutOfStock: "on" }),
    )) as { error?: string };

    expect(second.error).toContain("setting change is still being applied");
    expect(jobRuns).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
    // And the second setting was not saved either: the checkbox shows what
    // the running job will apply.
    expect(await prefsFor("shop1")).toEqual({ includeOutOfStock: false, includeUnlisted: false });
  });

  it("names a catalogue job when that is what is running", async () => {
    jobRuns.push({ id: "j0", shopId: "shop1", kind: "bulk_extract", status: "running" });
    const result = (await reportAction(post({ intent: "publish_prefs" }))) as { error?: string };
    expect(result.error).toContain("catalogue job is running");
  });
});

describe("the products/delete handler", () => {
  it("deletes the mirror row by the GID built from the numeric id", async () => {
    // I.6 "Deleted outright": the payload carries only the legacy numeric id.
    mirrorRows.push(
      { id: "1", shopId: "shop1", productId: "gid://shopify/Product/1" },
      { id: "2", shopId: "shop1", productId: "gid://shopify/Product/2" },
      { id: "3", shopId: "other", productId: "gid://shopify/Product/1" },
    );
    webhookPayload = { id: 1 };

    await deleteAction({ request: new Request("https://example.com/webhooks") } as any);

    expect(mirrorRows.map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("deletes the per-product SEO row for the same product, and only that one", async () => {
    // Left behind, the row kept counting in every denominator on the SEO card
    // and in the "N products carry finding B3" heading of the Products list,
    // while the list under that heading dropped it (QA, 3 September 2026).
    seoScanRows.push(
      { id: "s1", shopId: "shop1", productId: "gid://shopify/Product/1" },
      { id: "s2", shopId: "shop1", productId: "gid://shopify/Product/2" },
      { id: "s3", shopId: "other", productId: "gid://shopify/Product/1" },
    );
    webhookPayload = { id: 1 };

    await deleteAction({ request: new Request("https://example.com/webhooks") } as any);

    expect(seoScanRows.map((r) => r.id)).toEqual(["s2", "s3"]);
  });

  it("does nothing when the payload has no id", async () => {
    mirrorRows.push({ id: "1", shopId: "shop1", productId: "gid://shopify/Product/1" });
    webhookPayload = {};

    await deleteAction({ request: new Request("https://example.com/webhooks") } as any);

    expect(mirrorRows).toHaveLength(1);
  });
});
