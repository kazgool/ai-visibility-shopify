// CC-PROMPT-AI-READABILITY-3 item 3: the one shop metafield the Dictionary
// screen writes is written only when the list changed, metafield first.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpsert = vi.fn();
vi.mock("../../db.server", () => ({
  default: {
    setting: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
      upsert: (...a: unknown[]) => mockUpsert(...a),
    },
  },
}));
vi.mock("../facts.server", () => ({ NAMESPACE: "$app" }));

import { faqSettingsFor, saveHiddenGroups } from "../faq-settings.server";

const json = (body: unknown) => new Response(JSON.stringify(body));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveHiddenGroups", () => {
  it("writes nothing when the list is the one already saved", async () => {
    mockFindUnique.mockResolvedValue({ value: '["Colour","Width"]' });
    const graphql = vi.fn();
    expect(await saveHiddenGroups("shop1", graphql, ["Width", "Colour", "Width"])).toEqual({ changed: false });
    expect(graphql).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("writes nothing when no group was ever hidden and none is", async () => {
    mockFindUnique.mockResolvedValue(null);
    const graphql = vi.fn();
    expect(await saveHiddenGroups("shop1", graphql, [])).toEqual({ changed: false });
    expect(graphql).not.toHaveBeenCalled();
  });

  it("writes the shop metafield, then the row, when the list changed", async () => {
    mockFindUnique.mockResolvedValue(null);
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { shop: { id: "gid://shopify/Shop/1" } } }))
      .mockResolvedValueOnce(json({ data: { metafieldsSet: { userErrors: [] } } }));
    expect(await saveHiddenGroups("shop1", graphql, ["Width"])).toEqual({ changed: true });
    const metafield = graphql.mock.calls[1][1].variables.metafields[0];
    expect(metafield).toEqual({
      ownerId: "gid://shopify/Shop/1",
      namespace: "$app",
      key: "facts_display",
      type: "json",
      value: '{"hidden":["Width"]}',
    });
    expect(mockUpsert.mock.calls[0][0].create).toEqual({ shopId: "shop1", key: "facts_hidden", value: '["Width"]' });
  });

  it("saves no row when Shopify refuses the metafield", async () => {
    mockFindUnique.mockResolvedValue(null);
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { shop: { id: "gid://shopify/Shop/1" } } }))
      .mockResolvedValueOnce(json({ data: { metafieldsSet: { userErrors: [{ field: "value", message: "bad" }] } } }));
    await expect(saveHiddenGroups("shop1", graphql, ["Width"])).rejects.toThrow(/facts_display/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("faqSettingsFor", () => {
  it("reads the four rows, and defaults for the ones missing", async () => {
    mockFindMany.mockResolvedValue([
      { key: "faq_mappings", value: '{"sections":[{"heading":"Montaj","question":"Cum se monteaza {title}?"}]}' },
      { key: "dictionary_preset", value: "furniture" },
    ]);
    expect(await faqSettingsFor("shop1")).toEqual({
      mappings: { sections: [{ heading: "Montaj", question: "Cum se monteaza {title}?" }], groups: [] },
      cap: 8,
      presetId: "furniture",
      hiddenGroups: [],
    });
  });
});
