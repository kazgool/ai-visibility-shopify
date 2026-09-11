import { beforeEach, describe, expect, it, vi } from "vitest";

// CC-PROMPT-AI-READABILITY-4 item 4b on the product screen: a save marks only
// the rows it changed, a save that changed nothing writes nothing, a row can
// be reset on its own, and "Reset to automatic" hands the whole field back -
// and the next render reads what was stored, not what the action returned.

const authenticate = { admin: vi.fn() };
const db = {
  shop: { findUnique: vi.fn() },
  setting: { findUnique: vi.fn() },
  mirrorCache: { findUnique: vi.fn() },
  jobRun: { findFirst: vi.fn() },
  crawlerCheck: { findMany: vi.fn() },
};
const enqueue = vi.fn();

vi.mock("../../shopify.server", () => ({ authenticate }));
vi.mock("../../db.server", () => ({ default: db }));
vi.mock("../../services/billing.server", () => ({
  isSeoUnlocked: vi.fn().mockResolvedValue(false),
  hasPaidAccess: vi.fn().mockResolvedValue(true),
  isFreeProduct: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../services/seo-page.server", () => ({
  scanOneProductPage: vi.fn(),
  pageBudget: vi.fn().mockResolvedValue({ budget: 500, spent: 0, remaining: 500, day: "2026-09-11" }),
  robotsBlock: vi.fn(),
  DEFAULT_DAILY_BUDGET: 500,
  dailyBudget: vi.fn(),
}));
vi.mock("../../services/seo-aggregate.server", () => ({ scanRowFor: vi.fn().mockResolvedValue(null) }));
vi.mock("../../services/seo.server", () => ({
  writeSeo: vi.fn(),
  revertSeo: vi.fn(),
  mayWriteSeo: () => true,
  classifyMetaField: () => "app",
  clearSeoHumanFlag: vi.fn(),
}));
vi.mock("../../services/queue.server", () => ({ enqueue }));

const STORED = [
  { k: "Forma", v: "capsule" },
  { k: "Gramaj", v: "105 g" },
];

let calls: { query: string; variables?: any }[] = [];

function withState(state: unknown, facts = STORED) {
  calls = [];
  const product = {
    id: "gid://shopify/Product/1",
    title: "Capsule",
    handle: "capsule",
    descriptionHtml: "<p>Capsule.</p>",
    seo: { title: null, description: null },
    featuredMedia: null,
    media: { nodes: [] },
    metafields: {
      nodes: [
        { key: "facts", value: JSON.stringify(facts) },
        ...(state ? [{ key: "state", value: JSON.stringify(state) }] : []),
      ],
    },
  };
  authenticate.admin.mockResolvedValue({
    admin: {
      graphql: vi.fn(async (query: string, options?: { variables?: any }) => {
        calls.push({ query, variables: options?.variables });
        const data = query.includes("SetFacts")
          ? { metafieldsSet: { userErrors: [] } }
          : { product, shop: { name: "Shop", url: "https://shop.example" } };
        return { json: async () => ({ data }) };
      }),
    },
    session: { shop: "example.myshopify.com" },
  });
}

async function post(entries: [string, string][]) {
  const { action } = await import("../app.products.$id");
  return action({
    request: new Request("https://example.test/app/products/1", {
      method: "POST",
      body: new URLSearchParams(entries),
    }),
    params: { id: "1" },
    context: {},
  } as never) as Promise<Record<string, unknown>>;
}

const writes = () => calls.filter((c) => c.query.includes("SetFacts"));
const written = (key: string) => {
  const entry = writes()
    .flatMap((c) => c.variables.metafields)
    .find((m: any) => m.key === key);
  return entry ? JSON.parse(entry.value) : undefined;
};

const rowsOf = (facts: { k: string; v: string }[]): [string, string][] =>
  facts.flatMap((f) => [
    ["label", f.k],
    ["value", f.v],
  ]) as [string, string][];

const AUTO = { facts: { source: "auto", at: "2026-09-01T00:00:00.000Z" } };

beforeEach(() => {
  vi.clearAllMocks();
  db.shop.findUnique.mockResolvedValue({ id: "shop_1", domain: "example.myshopify.com" });
  db.setting.findUnique.mockResolvedValue(null);
  db.mirrorCache.findUnique.mockResolvedValue(null);
  db.jobRun.findFirst.mockResolvedValue(null);
  db.crawlerCheck.findMany.mockResolvedValue([]);
});

describe("saving the attributes", () => {
  it("writes nothing and marks nothing when nothing changed", async () => {
    withState(AUTO);
    const result = await post([["intent", "save"], ["origFacts", JSON.stringify(STORED)], ...rowsOf(STORED)]);
    expect(result).toMatchObject({ saved: true, unchanged: true });
    expect(writes()).toHaveLength(0);
  });

  it("marks only the row that changed, and leaves the field automatic for the others", async () => {
    withState(AUTO);
    const edited = [{ k: "Forma", v: "pulbere" }, STORED[1]];
    await post([["intent", "save"], ["origFacts", JSON.stringify(STORED)], ...rowsOf(edited)]);
    expect(written("facts")).toEqual(edited);
    const state = written("state");
    expect(Object.keys(state.factsHuman)).toEqual(["forma"]);
    expect(state.factsHuman.forma.v).toBe("pulbere");
    expect(state.facts.source).toBe("auto");
  });

  it("records a removed row as deleted", async () => {
    withState(AUTO);
    await post([["intent", "save"], ["origFacts", JSON.stringify(STORED)], ...rowsOf([STORED[0]])]);
    expect(written("state").factsHuman).toEqual({
      gramaj: expect.objectContaining({ k: "Gramaj", v: null }),
    });
  });

  it("keeps every row a person's when the table was edited by hand before rows were protected one by one", async () => {
    withState({ facts: { source: "human", at: "2026-09-01T00:00:00.000Z" } });
    const edited = [{ k: "Forma", v: "pulbere" }, STORED[1]];
    await post([["intent", "save"], ["origFacts", JSON.stringify(STORED)], ...rowsOf(edited)]);
    const rows = written("state").factsHuman;
    expect(rows.forma.v).toBe("pulbere");
    expect(rows.gramaj.v).toBe("105 g");
  });
});

describe("resetting", () => {
  const TWO = {
    facts: { source: "auto", at: "2026-09-01T00:00:00.000Z" },
    factsHuman: {
      forma: { k: "Forma", v: "capsule", at: "x", engine: "1.0.0" },
      culoare: { k: "Culoare", v: null, at: "x", engine: "1.0.0" },
    },
  };

  it("resets one row: only that entry goes, and the product is queued so the row refreshes", async () => {
    withState(TWO);
    const result = await post([["intent", "reset_row"], ["rowKey", "forma"]]);
    expect(result).toMatchObject({ rowReset: true });
    expect(Object.keys(written("state").factsHuman)).toEqual(["culoare"]);
    expect(written("facts")).toBeUndefined();
    expect(enqueue).toHaveBeenCalledWith(
      "extract_product",
      { shopId: "shop_1", productGid: "gid://shopify/Product/1" },
      { jobKey: "extract:gid://shopify/Product/1" },
    );
  });

  it("Reset to automatic clears every row and leaves the field the app's to refill", async () => {
    withState(TWO);
    await post([["intent", "reset"]]);
    const state = written("state");
    expect(state.factsHuman).toBeUndefined();
    // Not deleted: a facts value with no state entry is read as a person's,
    // which is how the old reset left a table that no pass would ever refill.
    expect(state.facts.source).toBe("auto");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("the screen after a save", () => {
  it("marks the rows a person wrote and lists the ones they removed", async () => {
    withState({
      facts: { source: "auto", at: "2026-09-01T00:00:00.000Z" },
      factsHuman: {
        forma: { k: "Forma", v: "capsule", at: "x", engine: "1.0.0" },
        culoare: { k: "Culoare", v: null, at: "x", engine: "1.0.0" },
      },
    });
    const { loader } = await import("../app.products.$id");
    const data = (await loader({
      request: new Request("https://example.test/app/products/1"),
      params: { id: "1" },
      context: {},
    } as never)) as Record<string, any>;
    expect(data.humanKeys).toEqual(["forma"]);
    expect(data.removedRows).toEqual([{ key: "culoare", k: "Culoare" }]);
    expect(data.source).toBe("human");
  });
});
