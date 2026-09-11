import { describe, expect, it, vi } from "vitest";
import {
  SHOP_LOCALE_QUERY,
  fetchShopLocale,
  languageFromLocale,
  resolveContentLanguage,
} from "../content-language";

// CC-PROMPT-AI-READABILITY-2 item 4.

describe("languageFromLocale", () => {
  it("reads Romanian and English in every form a locale code takes", () => {
    expect(languageFromLocale("ro")).toBe("ro");
    expect(languageFromLocale("ro-RO")).toBe("ro");
    expect(languageFromLocale("RO")).toBe("ro");
    expect(languageFromLocale("en")).toBe("en");
    expect(languageFromLocale("en-GB")).toBe("en");
  });

  it("returns null for a language this app does not write, and for nothing", () => {
    expect(languageFromLocale("de")).toBeNull();
    expect(languageFromLocale("")).toBeNull();
    expect(languageFromLocale(null)).toBeNull();
    expect(languageFromLocale(undefined)).toBeNull();
  });
});

describe("resolveContentLanguage", () => {
  it("the merchant's choice wins over the store's default", () => {
    expect(resolveContentLanguage("en", "ro")).toEqual({ language: "en", source: "chosen" });
  });

  it("the store's default fills in when nothing was chosen", () => {
    expect(resolveContentLanguage(undefined, "ro-RO")).toEqual({ language: "ro", source: "store" });
  });

  it("unset is English, exactly as before the field existed", () => {
    expect(resolveContentLanguage(undefined, null)).toEqual({ language: "en", source: "unset" });
    expect(resolveContentLanguage(undefined, "de")).toEqual({ language: "en", source: "unset" });
    expect(resolveContentLanguage("fr", null)).toEqual({ language: "en", source: "unset" });
  });
});

describe("fetchShopLocale", () => {
  it("asks webPresences, never shopLocales, which needs a scope the app does not have", () => {
    expect(SHOP_LOCALE_QUERY).toContain("webPresences");
    expect(SHOP_LOCALE_QUERY).toContain("defaultLocale");
    expect(SHOP_LOCALE_QUERY).not.toContain("shopLocales");
  });

  it("takes the locale marked primary", async () => {
    const graphql = vi.fn(async () => ({
      webPresences: {
        nodes: [
          { defaultLocale: { locale: "en", primary: false } },
          { defaultLocale: { locale: "ro", primary: true } },
        ],
      },
    }));
    await expect(fetchShopLocale(graphql)).resolves.toBe("ro");
  });

  it("takes the first when none is marked primary", async () => {
    const graphql = vi.fn(async () => ({
      webPresences: { nodes: [{ defaultLocale: { locale: "ro", primary: false } }] },
    }));
    await expect(fetchShopLocale(graphql)).resolves.toBe("ro");
  });

  it("returns null, never throws, on a refused or empty read", async () => {
    await expect(fetchShopLocale(async () => { throw new Error("Access denied"); })).resolves.toBeNull();
    await expect(fetchShopLocale(async () => ({}))).resolves.toBeNull();
    await expect(fetchShopLocale(async () => ({ webPresences: { nodes: [] } }))).resolves.toBeNull();
  });
});
