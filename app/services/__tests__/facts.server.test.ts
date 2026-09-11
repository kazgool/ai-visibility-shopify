import { describe, expect, it, vi } from "vitest";
import { parseState, writeFacts, writeVariantFacts, type ProductInput } from "../facts.server";
import { humanMerge } from "../facts-human";

function graphqlMock() {
  const calls: { query: string; variables?: any }[] = [];
  const fn = vi.fn(async (query: string, variables?: any) => {
    calls.push({ query, variables });
    if (query.includes("SetFacts")) return { metafieldsSet: { userErrors: [] } };
    if (query.includes("DeleteFacts")) return { metafieldsDelete: { userErrors: [] } };
    return {};
  });
  return { fn, calls };
}

const now = new Date().toISOString();

function productWithAutoFacts(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    id: "gid://shopify/Product/1",
    title: "Set masa",
    metafields: [
      { key: "facts", value: JSON.stringify([{ k: "material", v: "lemn" }]) },
      { key: "summary", value: "Set masa din lemn." },
      {
        key: "state",
        value: JSON.stringify({
          facts: { source: "auto", at: now, engine: "1.0.0" },
          summary: { source: "auto", at: now, engine: "1.0.0" },
        }),
      },
    ],
    ...overrides,
  };
}

describe("writeFacts withdrawal", () => {
  it("withdraws an auto value when recomputation comes back empty", async () => {
    const product = productWithAutoFacts();
    const { fn } = graphqlMock();

    const [outcome] = await writeFacts(fn as any, [
      {
        product,
        facts: [],
        fields: [{ key: "summary", type: "multi_line_text_field", value: "" }],
      },
    ]);

    // "facts" itself is always a candidate (JSON.stringify([]) === "[]"),
    // and the "summary" field was passed explicitly empty - both are
    // previously-auto values with real existing content, so both withdraw.
    expect(outcome.removed).toEqual(expect.arrayContaining(["facts", "summary"]));
    expect(outcome.written).toEqual([]);
  });

  it("never withdraws a human-written value", async () => {
    const product = productWithAutoFacts({
      metafields: [
        { key: "summary", value: "Scris de comerciant." },
        { key: "state", value: JSON.stringify({ summary: { source: "human", at: now } }) },
      ],
    });
    const { fn } = graphqlMock();

    const [outcome] = await writeFacts(fn as any, [
      { product, facts: [], fields: [{ key: "summary", type: "multi_line_text_field", value: "" }] },
    ]);

    expect(outcome.removed).not.toContain("summary");
    expect(outcome.skipped).toContain("summary");
  });

  it("never writes an identical value (self-feed guard)", async () => {
    const product = productWithAutoFacts();
    const { fn, calls } = graphqlMock();

    const [outcome] = await writeFacts(fn as any, [
      {
        product,
        facts: [{ k: "material", v: "lemn" }],
        fields: [{ key: "summary", type: "multi_line_text_field", value: "Set masa din lemn." }],
      },
    ]);

    expect(outcome.unchanged).toEqual(expect.arrayContaining(["facts", "summary"]));
    expect(outcome.written).toEqual([]);
    // No metafieldsSet call at all, since nothing touched.
    expect(calls.some((c) => c.query.includes("SetFacts"))).toBe(false);
  });
});

// CC-PROMPT-AI-READABILITY-4 item 4b: the writers apply the person's rows.
describe("writeFacts: protection per row", () => {
  const stateOf = (calls: { query: string; variables?: any }[], ownerId = "gid://shopify/Product/1") => {
    const set = calls.find((c) => c.query.includes("SetFacts"));
    const entry = set?.variables.metafields.find((m: any) => m.ownerId === ownerId && m.key === "state");
    return entry ? JSON.parse(entry.value) : null;
  };
  const factsOf = (calls: { query: string; variables?: any }[], ownerId = "gid://shopify/Product/1") => {
    const set = calls.find((c) => c.query.includes("SetFacts"));
    const entry = set?.variables.metafields.find((m: any) => m.ownerId === ownerId && m.key === "facts");
    return entry ? JSON.parse(entry.value) : null;
  };

  it("writes the other rows of a product with one row edited, and keeps the edited one", async () => {
    const stored = [
      { k: "Forma", v: "capsule" },
      { k: "Gramaj", v: "105 g" },
    ];
    const product = productWithAutoFacts({
      metafields: [
        { key: "facts", value: JSON.stringify(stored) },
        {
          key: "state",
          value: JSON.stringify({
            facts: { source: "auto", at: now },
            factsHuman: { forma: { k: "Forma", v: "capsule", at: now, engine: "1.0.0" } },
          }),
        },
      ],
    });
    const fresh = [
      { k: "Forma", v: "pulbere" },
      { k: "Gramaj", v: "120 g" },
    ];
    const merge = humanMerge(parseState(product), stored, fresh, now, "1.0.0");
    const { fn, calls } = graphqlMock();
    const [outcome] = await writeFacts(fn as any, [{ product, facts: merge.facts, human: merge }]);

    expect(outcome.written).toContain("facts");
    expect(factsOf(calls)).toEqual([
      { k: "Forma", v: "capsule" },
      { k: "Gramaj", v: "120 g" },
    ]);
    expect(stateOf(calls).factsHuman.forma.v).toBe("capsule");
  });

  it("converts a whole-table state once, writing the rows even when the facts are identical", async () => {
    const stored = [{ k: "Forma", v: "capsule" }];
    const product = productWithAutoFacts({
      metafields: [
        { key: "facts", value: JSON.stringify(stored) },
        { key: "state", value: JSON.stringify({ facts: { source: "human", at: now } }) },
      ],
    });
    const merge = humanMerge(parseState(product), stored, [{ k: "Forma", v: "pulbere" }, { k: "Culoare", v: "alb" }], now, "1.0.0");
    const { fn, calls } = graphqlMock();
    const [outcome] = await writeFacts(fn as any, [{ product, facts: merge.facts, human: merge }]);

    expect(outcome.unchanged).toContain("facts");
    const state = stateOf(calls);
    expect(state.facts.source).toBe("auto");
    expect(state.factsHuman).toEqual({
      forma: { k: "Forma", v: "capsule", at: now, engine: "1.0.0" },
      culoare: { k: "Culoare", v: null, at: now, engine: "1.0.0" },
    });
  });

  it("still skips facts with no record and no rows when the caller does not merge", async () => {
    const product = productWithAutoFacts({
      metafields: [{ key: "facts", value: JSON.stringify([{ k: "Forma", v: "capsule" }]) }],
    });
    const { fn } = graphqlMock();
    const [outcome] = await writeFacts(fn as any, [{ product, facts: [{ k: "Forma", v: "pulbere" }] }]);
    expect(outcome.skipped).toContain("facts");
  });
});

describe("writeVariantFacts: protection per row, the same as products", () => {
  const VARIANT = "gid://shopify/ProductVariant/1";
  const variant = (facts: unknown, state?: unknown) => ({
    id: VARIANT,
    selectedOptions: [],
    metafields: [
      ...(facts ? [{ key: "facts", value: JSON.stringify(facts) }] : []),
      ...(state ? [{ key: "state", value: JSON.stringify(state) }] : []),
    ],
  });
  const written = (calls: { query: string; variables?: any }[], key: string) => {
    const entry = calls
      .flatMap((c) => c.variables?.metafields ?? [])
      .find((m: any) => m.ownerId === VARIANT && m.key === key);
    return entry ? JSON.parse(entry.value) : undefined;
  };

  it("keeps a row a person edited and updates the other", async () => {
    const { fn, calls } = graphqlMock();
    await writeVariantFacts(fn as any, [
      {
        variant: variant([{ k: "Culoare", v: "gri deschis" }, { k: "Marime", v: "M" }], {
          facts: { source: "auto", at: now },
          factsHuman: { culoare: { k: "Culoare", v: "gri deschis", at: now, engine: "1.0.0" } },
        }),
        facts: [
          { k: "Culoare", v: "gri" },
          { k: "Marime", v: "L" },
        ],
      },
    ]);
    expect(written(calls, "facts")).toEqual([
      { k: "Culoare", v: "gri deschis" },
      { k: "Marime", v: "L" },
    ]);
  });

  it("keeps a deleted row deleted", async () => {
    const { fn, calls } = graphqlMock();
    await writeVariantFacts(fn as any, [
      {
        variant: variant([{ k: "Marime", v: "M" }], {
          facts: { source: "auto", at: now },
          factsHuman: { culoare: { k: "Culoare", v: null, at: now, engine: "1.0.0" } },
        }),
        facts: [
          { k: "Culoare", v: "gri" },
          { k: "Marime", v: "L" },
        ],
      },
    ]);
    expect(written(calls, "facts")).toEqual([{ k: "Marime", v: "L" }]);
  });

  it("converts a variant marked edited by hand, publishing exactly its table", async () => {
    const { fn, calls } = graphqlMock();
    await writeVariantFacts(fn as any, [
      {
        variant: variant([{ k: "Culoare", v: "gri deschis" }], { facts: { source: "human", at: now } }),
        facts: [{ k: "Culoare", v: "gri" }],
      },
    ]);
    expect(written(calls, "facts")).toBeUndefined();
    expect(written(calls, "state").factsHuman.culoare.v).toBe("gri deschis");
    expect(written(calls, "state").facts.source).toBe("auto");
  });

  it("writes nothing when the merged rows are identical", async () => {
    const { fn } = graphqlMock();
    await writeVariantFacts(fn as any, [
      { variant: variant([{ k: "Marime", v: "M" }], { facts: { source: "auto", at: now } }), facts: [{ k: "Marime", v: "M" }] },
    ]);
    expect(fn).not.toHaveBeenCalled();
  });
});
