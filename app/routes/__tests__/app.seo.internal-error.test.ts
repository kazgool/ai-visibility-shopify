import { describe, it, expect, vi, beforeEach } from "vitest";

// A Shopify-side INTERNAL_SERVER_ERROR on the SEO screen's scan.
//
// Observed on the live app on 4 September 2026, twice (04:30:20 and 04:58:26,
// so reproducible rather than transient): HTTP 200, one top-level GraphQL error
// with `extensions.code: "INTERNAL_SERVER_ERROR"` and a Request ID in its
// message. The action had no try/catch, so it became an Application Error
// banner - the app telling the merchant it had broken, about a failure on
// Shopify's side, with nothing wrong with the merchant's data.
//
// What this file asserts is the contract of that catch: the action returns a
// sentence, does not throw, names the Request ID, and writes nothing further.
// The last one is the part a test is actually needed for - a catch that
// "handles" an error by carrying on and writing anyway is worse than no catch.

const authenticate = { admin: vi.fn() };
const db = {
  shop: { findUnique: vi.fn() },
  setting: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  themeScan: { findUnique: vi.fn(), upsert: vi.fn() },
  jobRun: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  crawlerCheck: { findMany: vi.fn() },
  seoScan: { findMany: vi.fn() },
};
const isSeoUnlocked = vi.fn();
const hasPaidAccess = vi.fn();
const scanStorefront = vi.fn();
const recordThemeScan = vi.fn();
const themeScanRowWasWritten = vi.fn();
const checkAppEmbed = vi.fn();
const businessFor = vi.fn();
const enqueue = vi.fn();

vi.mock("../../shopify.server", () => ({ authenticate }));
vi.mock("../../db.server", () => ({ default: db }));
vi.mock("../../services/billing.server", () => ({ isSeoUnlocked, hasPaidAccess }));
vi.mock("../../services/queue.server", () => ({ enqueue }));
vi.mock("../../services/embed-check.server", () => ({ checkAppEmbed }));
vi.mock("../../services/business.server", () => ({ businessFor }));
vi.mock("../../services/seo-aggregate.server", () => ({
  readSeoAggregates: vi.fn(),
  productsWithFinding: vi.fn(),
}));
vi.mock("../../services/seo-page.server", () => ({
  dailyBudget: vi.fn(),
  robotsBlock: vi.fn(),
  DEFAULT_DAILY_BUDGET: 500,
}));
// theme-scan.server is partially mocked: the real module is a .server file with
// its own imports, and the two functions this test drives are the two the
// action calls.
vi.mock("../../services/theme-scan.server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "../../services/theme-scan.server",
  );
  return { ...actual, scanStorefront, recordThemeScan, themeScanRowWasWritten };
});

/**
 * A GraphqlQueryError shaped exactly as @shopify/shopify-api's
 * throwFailedRequest builds it for a 200 carrying top-level errors, with the
 * message Shopify actually sent.
 */
function internalError() {
  const message =
    "Internal error. Looks like something went wrong on our end. " +
    "Request ID: 5887dbbc-4249-45e6-8fb8-a2c7cd4b324f-1788497903";
  const error = new Error(message) as Error & Record<string, unknown>;
  error.name = "GraphqlQueryError";
  error.response = new Response("{}", { status: 200 });
  error.headers = {};
  error.body = {
    errors: {
      networkStatusCode: 200,
      message: "GraphQL Client: An error occurred while fetching from the API.",
      graphQLErrors: [{ message, extensions: { code: "INTERNAL_SERVER_ERROR" } }],
      response: new Response("{}", { status: 200 }),
    },
  };
  return error;
}

const SCAN_RESULT = {
  hasProductLd: true,
  hasOrganizationLd: false,
  organizationEmitters: [],
  passwordProtected: false,
  hasAggregateRating: false,
  hasFAQPage: false,
  product: { nodes: [], passwordProtected: false },
  home: { nodes: [], passwordProtected: false },
  conflicts: [],
  homeConflicts: [],
  nodes: [],
};

async function scan() {
  const { action } = await import("../app.seo");
  return action({
    request: new Request("https://example.test/app/seo", {
      method: "POST",
      body: new URLSearchParams({ intent: "scan" }),
    }),
    params: {},
    context: {},
  } as never) as Promise<Record<string, unknown>>;
}

let graphql: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  graphql = vi.fn().mockResolvedValue({
    json: async () => ({
      data: {
        products: {
          nodes: [
            {
              id: "gid://shopify/Product/1",
              handle: "a-chair",
              onlineStoreUrl: "https://shop.example/products/a-chair",
              metafields: { nodes: [] },
            },
          ],
        },
        shop: { url: "https://shop.example", primaryDomain: { host: "shop.example" } },
        themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/1" }] },
      },
    }),
  });
  authenticate.admin.mockResolvedValue({ admin: { graphql }, session: { shop: "s.myshopify.com" } });
  db.shop.findUnique.mockResolvedValue({ id: "shop_1", domain: "s.myshopify.com" });
  db.setting.findUnique.mockResolvedValue(null);
  db.themeScan.findUnique.mockResolvedValue(null);
  db.jobRun.findFirst.mockResolvedValue(null);
  isSeoUnlocked.mockResolvedValue(true);
  scanStorefront.mockResolvedValue(SCAN_RESULT);
  checkAppEmbed.mockResolvedValue({ active: true });
  businessFor.mockResolvedValue({});
  themeScanRowWasWritten.mockReturnValue(false);
  recordThemeScan.mockResolvedValue(undefined);
});

describe("a Shopify INTERNAL_SERVER_ERROR during the scan", () => {
  it("returns an error string instead of throwing, and names the Request ID", async () => {
    recordThemeScan.mockRejectedValue(internalError());

    const result = await scan();

    expect(typeof result.error).toBe("string");
    expect(String(result.error)).toContain("internal error");
    expect(String(result.error)).toContain("5887dbbc-4249-45e6-8fb8-a2c7cd4b324f-1788497903");
    // Not an Application Error: the action resolved.
    expect(result).not.toBeInstanceOf(Response);
  });

  it("says nothing was lost, because nothing was", async () => {
    recordThemeScan.mockRejectedValue(internalError());
    const result = await scan();
    expect(String(result.error)).toContain("Nothing was written and nothing was lost");
  });

  // The reason a test is needed rather than a read of the catch: a catch that
  // carries on and writes anyway is worse than no catch at all.
  it("writes nothing further after the failure", async () => {
    recordThemeScan.mockRejectedValue(internalError());

    await scan();

    expect(db.setting.upsert).not.toHaveBeenCalled();
    expect(db.themeScan.upsert).not.toHaveBeenCalled();
    expect(db.jobRun.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    // recordThemeScan is the throw itself; it is not retried.
    expect(recordThemeScan).toHaveBeenCalledTimes(1);
  });

  // The scan row is written before the storefront mirror, so a mirror failure
  // leaves the scan saved. Telling the merchant it was lost would be false.
  it("says the scan was saved when only the storefront mirror failed", async () => {
    recordThemeScan.mockRejectedValue(internalError());
    themeScanRowWasWritten.mockReturnValue(true);

    const result = await scan();

    expect(String(result.error)).toContain("The scan itself was saved");
    expect(String(result.error)).toContain("storefront mirror");
    expect(String(result.error)).toContain("5887dbbc-4249-45e6-8fb8-a2c7cd4b324f-1788497903");
  });

  it("catches the same error from any Admin call on the path, not only the last", async () => {
    // The very first call, so nothing on the path has run.
    graphql.mockRejectedValueOnce(internalError());

    const result = await scan();

    expect(typeof result.error).toBe("string");
    expect(recordThemeScan).not.toHaveBeenCalled();
    expect(db.themeScan.upsert).not.toHaveBeenCalled();
  });

  // Everything that is not Shopify's own failure is still ours, and still loud.
  it("still throws anything that is not an INTERNAL_SERVER_ERROR", async () => {
    recordThemeScan.mockRejectedValue(new Error("our own bug"));
    await expect(scan()).rejects.toThrow("our own bug");
  });

  it("still throws a GraphQL error carrying a different code", async () => {
    const throttled = new Error("Throttled") as Error & Record<string, unknown>;
    throttled.body = {
      errors: { graphQLErrors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] },
    };
    recordThemeScan.mockRejectedValue(throttled);
    await expect(scan()).rejects.toThrow("Throttled");
  });
});
