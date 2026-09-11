// CC-PROMPT-AI-READABILITY-3 item 3: what the Dictionary screen saves for
// buyer questions and the product page's facts, and what it refuses.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockShopFindUnique = vi.fn();
const mockSettingUpsert = vi.fn();
vi.mock("../../db.server", () => ({
  default: {
    shop: { findUnique: (...a: unknown[]) => mockShopFindUnique(...a) },
    setting: {
      upsert: (...a: unknown[]) => mockSettingUpsert(...a),
      findUnique: vi.fn(),
    },
  },
}));

const mockPaid = vi.fn();
vi.mock("../../services/billing.server", () => ({
  hasPaidAccess: (...a: unknown[]) => mockPaid(...a),
}));

const mockSaveFaq = vi.fn();
const mockSaveHidden = vi.fn();
const mockSavePreset = vi.fn();
vi.mock("../../services/faq-settings.server", () => ({
  faqSettingsFor: vi.fn(),
  saveFaqSettings: (...a: unknown[]) => mockSaveFaq(...a),
  saveHiddenGroups: (...a: unknown[]) => mockSaveHidden(...a),
  savePresetId: (...a: unknown[]) => mockSavePreset(...a),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: {
    admin: async () => ({ admin: { graphql: vi.fn() }, session: { shop: "nordwood.myshopify.com" } }),
  },
}));

import { action } from "../app.dictionary";

function post(fields: Record<string, string>) {
  return action({
    request: new Request("https://example.com/app/dictionary", { method: "POST", body: new URLSearchParams(fields) }),
    params: {},
    context: {},
  } as any) as Promise<any>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockShopFindUnique.mockResolvedValue({ id: "shop1", domain: "nordwood.myshopify.com" });
  mockPaid.mockResolvedValue(true);
  mockSaveHidden.mockResolvedValue({ changed: true });
});

describe("buyer questions", () => {
  it("refuses a question that does not name the product, and a cap out of range, saving nothing", async () => {
    const result = await post({
      intent: "save_faq",
      faq: JSON.stringify({ sections: [{ heading: "Montaj", question: "Cum se monteaza?" }], groups: [] }),
      cap: "0",
    });
    expect(result.faqErrors).toEqual([expect.objectContaining({ list: "sections", row: 1, message: expect.stringMatching(/\{title\}/) })]);
    expect(result.capError).toMatch(/whole number/);
    expect(mockSaveFaq).not.toHaveBeenCalled();
  });

  it("saves the rows trimmed, a blank row dropped, and the cap", async () => {
    const result = await post({
      intent: "save_faq",
      faq: JSON.stringify({
        sections: [{ heading: " Montaj ", question: "Cum se monteaza {title}?" }, { heading: "", question: "" }],
        groups: [{ group: "Forma", question: "Ce forma are {title}?" }],
      }),
      cap: "5",
    });
    expect(result).toEqual({ faqSaved: true });
    expect(mockSaveFaq).toHaveBeenCalledWith(
      "shop1",
      {
        sections: [{ heading: "Montaj", question: "Cum se monteaza {title}?" }],
        groups: [{ group: "Forma", question: "Ce forma are {title}?" }],
      },
      5,
    );
  });
});

describe("the product page's facts", () => {
  it("saves the switched-off groups once each, in a stable order", async () => {
    expect(await post({ intent: "save_display", hidden: JSON.stringify(["Width", "Colour", "Width"]) })).toEqual({
      displaySaved: true,
    });
    expect(mockSaveHidden.mock.calls[0][0]).toBe("shop1");
    expect(mockSaveHidden.mock.calls[0][2]).toEqual(["Colour", "Width"]);
  });

  it("changes nothing when the list cannot be read", async () => {
    const result = await post({ intent: "save_display", hidden: "{not json" });
    expect(result.error).toMatch(/could not be read/);
    expect(mockSaveHidden).not.toHaveBeenCalled();
  });
});

describe("the dictionary itself", () => {
  it("records the preset the text started from, when one was picked", async () => {
    await post({ intent: "save", dictionary: "Material: cotton", preset: "clothing" });
    expect(mockSettingUpsert).toHaveBeenCalledTimes(1);
    expect(mockSavePreset).toHaveBeenCalledWith("shop1", "clothing");
  });

  it("keeps the recorded preset when none was picked this time, and ignores an unknown one", async () => {
    await post({ intent: "save", dictionary: "Material: cotton", preset: "" });
    await post({ intent: "save", dictionary: "Material: cotton", preset: "no-such-preset" });
    expect(mockSavePreset).not.toHaveBeenCalled();
  });
});

describe("entitlement", () => {
  it("refuses every save for a shop with no subscription", async () => {
    mockPaid.mockResolvedValue(false);
    for (const intent of ["save", "save_faq", "save_display"]) {
      const result = await post({ intent, dictionary: "x", faq: "{}", cap: "8", hidden: "[]" });
      expect(result.error).toMatch(/no active subscription/);
    }
    expect(mockSettingUpsert).not.toHaveBeenCalled();
    expect(mockSaveFaq).not.toHaveBeenCalled();
    expect(mockSaveHidden).not.toHaveBeenCalled();
  });
});
