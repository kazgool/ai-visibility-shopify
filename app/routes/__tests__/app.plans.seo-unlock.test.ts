import { describe, it, expect, vi, beforeEach } from "vitest";

// The other half of the structural fix: what the plans action does when a
// valid setup code is entered.
//
// It must store no key. Before build step 2 it called `grantSeoUnlock`
// directly, which runs a bulk operation over the whole catalogue - minutes on
// a large store, and the embedded iframe gives up long before the row exists.
// Now it queues, and this test is what stops that quietly regressing: an action
// that writes the key itself would pass every other test in the suite.

const mockSettingUpsert = vi.fn(async () => ({}));
const mockJobRunCreate = vi.fn(async () => ({ id: "job1" }));
const mockEnqueue = vi.fn(async () => {});

vi.mock("../../db.server", () => ({
  default: {
    shop: { findUnique: async () => ({ id: "shop1", domain: "mrdigital-dev.myshopify.com" }) },
    setting: {
      upsert: (...a: unknown[]) => mockSettingUpsert(...(a as [])),
      findUnique: async () => null,
      findMany: async () => [],
      deleteMany: vi.fn(),
    },
    jobRun: {
      create: (...a: unknown[]) => mockJobRunCreate(...(a as [])),
      findFirst: async () => null,
    },
  },
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: async () => ({
      session: { shop: "mrdigital-dev.myshopify.com" },
      admin: { graphql: async () => ({ json: async () => ({ data: {} }) }) },
    }),
  },
}));

vi.mock("../../services/queue.server", () => ({
  enqueue: (...a: unknown[]) => mockEnqueue(...(a as [])),
}));

// The snapshot module must not be reachable from this path at all. If the
// action ever calls it again, this mock records it and the assertion below
// fails rather than the test hanging on a real bulk operation.
const mockTakeSnapshot = vi.fn();
vi.mock("../../services/seo-snapshot.server", () => ({
  takeSeoSnapshot: (...a: unknown[]) => mockTakeSnapshot(...(a as [])),
  readSeoSnapshot: async () => null,
  readCurrentFacts: async () => null,
  serialiseFacts: (r: unknown) => r,
  recordCurrentFacts: async () => ({ written: false }),
}));

vi.mock("../../services/admin.server", () => ({
  adminGraphql: async () => (async () => ({})) as unknown,
  sleep: async () => {},
}));

import { action } from "../app.plans";

function submit(code: string): Request {
  const body = new URLSearchParams({ intent: "seo_unlock", seoCode: code });
  return new Request("https://example.test/app/plans?shop=mrdigital-dev.myshopify.com", {
    method: "POST",
    body,
  });
}

beforeEach(() => {
  mockSettingUpsert.mockClear();
  mockJobRunCreate.mockClear();
  mockEnqueue.mockClear();
  mockTakeSnapshot.mockClear();
  process.env.SEO_UNLOCK_KEY = "the-real-key";
});

describe("the plans action, seo_unlock", () => {
  it("queues the work and stores no key", async () => {
    // The action redirects, and Remix redirects by throwing a Response.
    const thrown = await action({ request: submit("the-real-key"), params: {}, context: {} } as never)
      .then(
        (value) => value,
        (error) => error,
      );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);

    // Nothing unlocked here. The key is written by the task, after the
    // snapshot, and only if the snapshot succeeded.
    expect(mockSettingUpsert).not.toHaveBeenCalled();
    expect(mockTakeSnapshot).not.toHaveBeenCalled();

    expect(mockJobRunCreate).toHaveBeenCalledTimes(1);
    expect((mockJobRunCreate.mock.calls as any[])[0][0].data.kind).toBe("seo_snapshot");

    const [task, payload, options] = (mockEnqueue.mock.calls as any[])[0];
    expect(task).toBe("seo_snapshot");
    expect(payload.shopId).toBe("shop1");
    expect(payload.jobRunId).toBe("job1");
    // The jobKey collapses a double submit into one job rather than starting a
    // second bulk operation.
    expect(options.jobKey).toBe("seo_snapshot:shop1");
  });

  it("queues nothing at all when the code is wrong", async () => {
    const result = await action({
      request: submit("not-the-key"),
      params: {},
      context: {},
    } as never);

    expect(result).toEqual({ seoCodeError: "That code is not valid." });
    expect(mockJobRunCreate).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });
});
