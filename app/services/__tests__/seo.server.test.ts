import { describe, it, expect, vi } from "vitest";
import {
  mayWriteSeo,
  writeSeo,
  revertSeo,
  metaColumnState,
  metaColumnLabel,
  metaColumnMissing,
  type ProductSeoInput,
} from "../seo.server";

function product(overrides: Partial<ProductSeoInput> = {}): ProductSeoInput {
  return {
    id: "gid://shopify/Product/1",
    metafields: [],
    seo: { title: null, description: null },
    ...overrides,
  };
}

function mockGraphql() {
  return vi.fn(async (query: string, _variables?: Record<string, unknown>): Promise<any> => {
    if (query.includes("productUpdate")) {
      return { productUpdate: { product: { id: "gid://shopify/Product/1" }, userErrors: [] } };
    }
    if (query.includes("metafieldsSet")) {
      return { metafieldsSet: { userErrors: [] } };
    }
    throw new Error(`unexpected query: ${query}`);
  });
}

describe("mayWriteSeo", () => {
  it("allows writing when the field has never been touched and is empty", () => {
    expect(mayWriteSeo(product(), "seo_title")).toBe(true);
  });

  it("treats a non-empty value with no state entry as human", () => {
    const p = product({ seo: { title: "Set outside this app", description: null } });
    expect(mayWriteSeo(p, "seo_title")).toBe(false);
  });

  it("refuses when the state entry says human", () => {
    const state = { seo_title: { source: "human", at: "2026-01-01", prev: "" } };
    const p = product({
      seo: { title: "Hand-written title", description: null },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });
    expect(mayWriteSeo(p, "seo_title")).toBe(false);
  });

  it("allows writing when the state entry says auto, even with a value present", () => {
    const state = { seo_title: { source: "auto", at: "2026-01-01", prev: "" } };
    const p = product({
      seo: { title: "Our previous generation", description: null },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });
    expect(mayWriteSeo(p, "seo_title")).toBe(true);
  });
});

describe("metaColumnState", () => {
  it("both auto: written by the app", () => {
    const state = {
      seo_title: { source: "auto", at: "2026-01-01", prev: "" },
      seo_description: { source: "auto", at: "2026-01-01", prev: "" },
    };
    const p = product({
      seo: { title: "App title", description: "App description" },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });
    const result = metaColumnState(p);
    expect(result).toEqual({ title: "auto", description: "auto" });
    expect(metaColumnLabel(result)).toBe("Auto");
    expect(metaColumnMissing(result)).toBe(false);
  });

  it("both empty: missing", () => {
    const p = product({ seo: { title: null, description: null } });
    const result = metaColumnState(p);
    expect(result).toEqual({ title: "missing", description: "missing" });
    expect(metaColumnLabel(result)).toBe("Missing");
    expect(metaColumnMissing(result)).toBe(true);
  });

  it("a human title with an empty description: disagreement is not collapsed", () => {
    const state = {
      seo_title: { source: "human", at: "2026-01-01", prev: "" },
    };
    const p = product({
      seo: { title: "Hand-written title", description: null },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });
    const result = metaColumnState(p);
    expect(result).toEqual({ title: "human", description: "missing" });
    expect(metaColumnLabel(result)).toBe("Title: Yours, description: Missing");
    expect(metaColumnMissing(result)).toBe(true);
  });

  it("a value set outside this app: outside", () => {
    const p = product({ seo: { title: "Imported title", description: "Imported description" } });
    const result = metaColumnState(p);
    expect(result).toEqual({ title: "outside", description: "outside" });
    expect(metaColumnLabel(result)).toBe("Outside app");
    expect(metaColumnMissing(result)).toBe(false);
  });
});

describe("writeSeo", () => {
  it("writes an auto value and captures prev on first write", async () => {
    const graphql = mockGraphql();
    const p = product();

    const outcome = await writeSeo(graphql, p, {
      seo_title: { value: "Oak Dining Table - Acme", source: "auto" },
    });

    expect(outcome.written).toEqual(["seo_title"]);
    const setCall = graphql.mock.calls.find(([q]) => q.includes("metafieldsSet"));
    const state = JSON.parse((setCall![1] as any).metafields[0].value);
    expect(state.seo_title.source).toBe("auto");
    expect(state.seo_title.prev).toBe("");
  });

  it("never overwrites a human-protected value", async () => {
    const graphql = mockGraphql();
    const state = { seo_title: { source: "human", at: "2026-01-01", prev: "" } };
    const p = product({
      seo: { title: "Merchant's own title", description: null },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });

    const outcome = await writeSeo(graphql, p, {
      seo_title: { value: "Generated title", source: "auto" },
    });

    expect(outcome.skipped).toEqual(["seo_title"]);
    expect(outcome.written).toEqual([]);
    const productUpdateCall = graphql.mock.calls.find(([q]) => q.includes("productUpdate"));
    expect(productUpdateCall).toBeUndefined();
  });

  it("never writes an identical value", async () => {
    const graphql = mockGraphql();
    const state = { seo_title: { source: "auto", at: "2026-01-01", prev: "" } };
    const p = product({
      seo: { title: "Already this value", description: null },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });

    const outcome = await writeSeo(graphql, p, {
      seo_title: { value: "Already this value", source: "auto" },
    });

    expect(outcome.unchanged).toEqual(["seo_title"]);
    expect(graphql).not.toHaveBeenCalled();
  });

  it("always sends both seo subfields, filling the untouched one with its current value", async () => {
    const graphql = mockGraphql();
    const p = product({ seo: { title: "Existing title", description: null } });

    // Existing title has no state entry, so it is treated as human and
    // skipped; only description is written, but the mutation must still
    // carry the untouched title rather than clearing it (SEO-WORKSPACE-PRD
    // §3.1: the single-subfield behaviour is unresolved, so never rely on it).
    await writeSeo(graphql, p, {
      seo_description: { value: "A short honest description.", source: "auto" },
    });

    const productUpdateCall = graphql.mock.calls.find(([q]) => q.includes("productUpdate"));
    const input = (productUpdateCall![1] as any).input;
    expect(input.seo.title).toBe("Existing title");
    expect(input.seo.description).toBe("A short honest description.");
  });

  it("captures prev only on the first write, never on later regenerations", async () => {
    const graphql = mockGraphql();
    const state = {
      seo_title: { source: "auto", at: "2026-01-01", prev: "The original value" },
    };
    const p = product({
      seo: { title: "First generated value", description: null },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });

    await writeSeo(graphql, p, {
      seo_title: { value: "Second generated value", source: "auto" },
    });

    const setCall = graphql.mock.calls.find(([q]) => q.includes("metafieldsSet"));
    const nextState = JSON.parse((setCall![1] as any).metafields[0].value);
    expect(nextState.seo_title.prev).toBe("The original value");
  });
});

describe("revertSeo", () => {
  it("restores the pre-app value exactly and deletes the state entry", async () => {
    const graphql = mockGraphql();
    const state = {
      seo_title: { source: "auto", at: "2026-01-01", prev: "The merchant's original title" },
    };
    const p = product({
      seo: { title: "What the app generated", description: "Some description" },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });

    const reverted = await revertSeo(graphql, p, ["seo_title"]);

    expect(reverted).toEqual(["seo_title"]);
    const productUpdateCall = graphql.mock.calls.find(([q]) => q.includes("productUpdate"));
    const input = (productUpdateCall![1] as any).input;
    expect(input.seo.title).toBe("The merchant's original title");
    expect(input.seo.description).toBe("Some description");

    const setCall = graphql.mock.calls.find(([q]) => q.includes("metafieldsSet"));
    const nextState = JSON.parse((setCall![1] as any).metafields[0].value);
    expect(nextState.seo_title).toBeUndefined();
  });

  it("does nothing when there is no prior write to revert", async () => {
    const graphql = mockGraphql();
    const p = product();

    const reverted = await revertSeo(graphql, p, ["seo_title"]);

    expect(reverted).toEqual([]);
    expect(graphql).not.toHaveBeenCalled();
  });
});
