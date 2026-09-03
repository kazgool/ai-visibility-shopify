// PRD-FIX-WAVE-1 G1 and G2. FREE-TIER-SPEC §3 is enforced on the screen, but
// a hidden button is not a gate: a form can be posted directly, and a job
// queued while a shop was paid can execute after access is gone. These tests
// assert the refusal path only - the happy path is covered elsewhere, and it
// is the refusal that keeps being the one nobody wrote.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockShopFindUnique = vi.fn();
const mockSettingUpsert = vi.fn();
const mockJobRunUpdate = vi.fn();
const mockJobRunFindFirst = vi.fn();

vi.mock("../../db.server", () => ({
  default: {
    shop: { findUnique: (...a: unknown[]) => mockShopFindUnique(...a) },
    setting: {
      upsert: (...a: unknown[]) => mockSettingUpsert(...a),
      findUnique: vi.fn(),
    },
    jobRun: {
      update: (...a: unknown[]) => mockJobRunUpdate(...a),
      findFirst: (...a: unknown[]) => mockJobRunFindFirst(...a),
    },
  },
}));

const mockHasPaidAccess = vi.fn();
const mockMayProcessAutomatically = vi.fn();

vi.mock("../billing.server", () => ({
  hasPaidAccess: (...a: unknown[]) => mockHasPaidAccess(...a),
  mayProcessAutomatically: (...a: unknown[]) => mockMayProcessAutomatically(...a),
  mayProcessAutomaticallyCached: vi.fn(),
  isSeoUnlocked: vi.fn(),
}));

const mockSaveBusiness = vi.fn();
vi.mock("../business.server", () => ({
  businessFor: vi.fn(),
  saveBusiness: (...a: unknown[]) => mockSaveBusiness(...a),
  sanitizeSocialProfiles: (input: Record<string, string>) => input,
}));

const mockAdminGraphql = vi.fn();
vi.mock("../admin.server", () => ({
  adminGraphql: (...a: unknown[]) => mockAdminGraphql(...a),
}));

const mockRunBulkExtract = vi.fn();
vi.mock("../extract.server", () => ({
  runBulkExtract: (...a: unknown[]) => mockRunBulkExtract(...a),
  extractOneProduct: vi.fn(),
  dictionaryFor: vi.fn(),
  extraStopwordsFor: vi.fn(),
}));

const mockFetchAllProducts = vi.fn();
vi.mock("../catalogue.server", () => ({
  fetchAllProducts: (...a: unknown[]) => mockFetchAllProducts(...a),
}));

const mockWriteAltText = vi.fn();
vi.mock("../alt-text.server", () => ({
  writeAltText: (...a: unknown[]) => mockWriteAltText(...a),
}));

const mockReconcileMirrors = vi.fn();
vi.mock("../mirror-reconcile.server", () => ({
  reconcileMirrors: (...a: unknown[]) => mockReconcileMirrors(...a),
}));
vi.mock("../eligibility.server", () => ({
  prefsFor: async () => ({ includeOutOfStock: true, includeUnlisted: false }),
}));

const graphql = vi.fn();
vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: async () => ({
      admin: { graphql },
      session: { shop: "nordwood.myshopify.com" },
    }),
  },
}));

import { action as businessAction } from "../../routes/app.business";
import { action as dictionaryAction } from "../../routes/app.dictionary";
import { bulk_extract, bulk_alt_text, reconcile_mirrors } from "../../../worker/tasks";

const SHOP = { id: "shop1", domain: "nordwood.myshopify.com", plan: "none" };

function post(body: Record<string, string>) {
  return new Request("https://example.com/app/business", {
    method: "POST",
    body: new URLSearchParams(body),
  });
}

const helpers = { logger: { info: vi.fn(), error: vi.fn() } } as any;

/** Every status the task wrote to its JobRun row, in order. */
function statuses(): string[] {
  return mockJobRunUpdate.mock.calls
    .map((c) => c[0]?.data?.status)
    .filter((s): s is string => typeof s === "string");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockShopFindUnique.mockResolvedValue(SHOP);
  mockAdminGraphql.mockResolvedValue(graphql);
});

describe("G1: routes that write refuse without access", () => {
  it("business info is not saved for a shop with no subscription and no comp", async () => {
    mockHasPaidAccess.mockResolvedValue(false);

    const result = (await businessAction({
      request: post({ deliveryTime: "2-4 days" }),
      params: {},
      context: {},
    } as any)) as { error?: string; saved?: boolean };

    expect(result.error).toBeTruthy();
    expect(result.saved).toBeUndefined();
    expect(mockSaveBusiness).not.toHaveBeenCalled();
  });

  it("the dictionary is neither saved nor tested for such a shop", async () => {
    mockHasPaidAccess.mockResolvedValue(false);

    const result = (await dictionaryAction({
      request: post({ intent: "save", dictionary: "Material: oak" }),
      params: {},
      context: {},
    } as any)) as { error?: string; saved?: boolean };

    expect(result.error).toBeTruthy();
    expect(result.saved).toBeUndefined();
    expect(mockSettingUpsert).not.toHaveBeenCalled();
    expect(graphql).not.toHaveBeenCalled();
  });
});

describe("G2: worker tasks refuse at execution", () => {
  it("bulk_extract records a refusal and writes nothing", async () => {
    mockMayProcessAutomatically.mockResolvedValue(false);

    await bulk_extract({ shopId: "shop1", jobRunId: "job1" }, helpers);

    expect(mockRunBulkExtract).not.toHaveBeenCalled();
    const update = mockJobRunUpdate.mock.calls.at(-1)?.[0];
    expect(update.where).toEqual({ id: "job1" });
    expect(update.data.status).toBe("refused");
    expect(update.data.report.refused).toBe(true);
    // The row is marked running before the check, and the check runs inside
    // the try. The check calls the Admin API; when that throws - expired
    // token, uninstall, 429 - a row still sitting at "queued" is never
    // resolved, and the dashboard refuses every button while one exists.
    // "refused" is still terminal, and it is still the last word.
    expect(statuses()).toEqual(["running", "refused"]);
  });

  it("bulk_alt_text records a refusal and reads no catalogue", async () => {
    mockMayProcessAutomatically.mockResolvedValue(false);

    await bulk_alt_text({ shopId: "shop1", jobRunId: "job2" }, helpers);

    expect(mockFetchAllProducts).not.toHaveBeenCalled();
    expect(mockWriteAltText).not.toHaveBeenCalled();
    const update = mockJobRunUpdate.mock.calls.at(-1)?.[0];
    expect(update.data.status).toBe("refused");
    expect(statuses()).toEqual(["running", "refused"]);
  });

  it("reconcile_mirrors still withdraws on a shop without access, and queues nothing", async () => {
    // PRD-PORT-1.7.8 I.2: withdrawal is never gated. QA of 3 September 2026,
    // blocking 2: the gate used to sit above the whole task, so a shop that
    // lapsed between the POST and the run kept every page that no longer
    // qualified. Now the catalogue is read and the reconciliation runs; only
    // the queueing of new pages is withheld, and the report says which half
    // happened.
    mockMayProcessAutomatically.mockResolvedValue(false);
    const read = {
      products: [],
      complete: true,
      objectsMatch: true,
      expected: { root: 0, objects: 0 },
      read: { root: 0, objects: 0 },
    };
    mockFetchAllProducts.mockResolvedValue(read);
    mockReconcileMirrors.mockImplementation(async (_shop, _read, _prefs, addJob) => {
      // The job the reconciliation would queue must be refused, not counted.
      const queued = (await addJob("gid://shopify/Product/1")) === false ? 0 : 1;
      return { skipped: false, expected: 0, read: 0, deleted: 2, adopted: 0, queued };
    });

    await reconcile_mirrors({ shopId: "shop1", jobRunId: "job4" }, helpers);

    expect(mockFetchAllProducts).toHaveBeenCalledTimes(1);
    expect(mockReconcileMirrors).toHaveBeenCalledTimes(1);
    const update = mockJobRunUpdate.mock.calls.at(-1)?.[0];
    expect(update.data.status).toBe("done");
    expect(update.data.report.deleted).toBe(2);
    expect(update.data.report.queued).toBe(0);
    expect(update.data.report.queueingRefused).toContain("no active subscription");
    expect(statuses()).toEqual(["running", "done"]);
  });

  it("a failing entitlement check leaves no job stuck at queued", async () => {
    // The failure the ordering exists for: the Admin call throws before the
    // entitlement answer is known. The row must end at "failed", never at
    // "queued", or the dashboard locks the merchant out with no explanation.
    mockAdminGraphql.mockRejectedValueOnce(new Error("401 expired token"));

    await expect(
      bulk_extract({ shopId: "shop1", jobRunId: "job3" }, helpers),
    ).rejects.toThrow();
    expect(statuses()).toEqual(["running", "failed"]);
  });
});
