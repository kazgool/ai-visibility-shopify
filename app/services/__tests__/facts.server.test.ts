import { describe, expect, it, vi } from "vitest";
import { writeFacts, type ProductInput } from "../facts.server";

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
