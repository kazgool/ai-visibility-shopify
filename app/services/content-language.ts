// The language this app writes a merchant's product text in
// (CC-PROMPT-AI-READABILITY-2 item 4).
//
// The summary and buyer questions used to be English template text on every
// store, which printed "Key details:" and "What is X made of?" on 189 pages of
// a Romanian storefront. The merchant chooses on the Business screen; until
// they do, the store's own default language is used when this app can read
// it, and English otherwise - which is what every store had before, so an
// unset field never changes anything that works today.
//
// Reading the default language. The app's scopes are read_products,
// write_products, read_themes, read_markets and
// read_online_store_navigation. `shopLocales` requires read_locales or
// read_markets_home (https://shopify.dev/docs/api/admin-graphql/2026-07/queries/shopLocales),
// neither of which the app has, and adding one forces every merchant to
// re-approve the app. The `webPresences` query requires read_markets
// (https://shopify.dev/docs/api/admin-graphql/2026-07/queries/webPresences),
// and each MarketWebPresence carries `defaultLocale: ShopLocale!`
// (https://shopify.dev/docs/api/admin-graphql/2026-07/objects/MarketWebPresence),
// whose `primary` field says whether that locale is the shop's default.
// `Market.webPresence` and `Market.primary` are deprecated in 2026-07, so
// neither is used.
//
// Pure: the Admin call is injected, so this module imports nothing server-side.

export type ContentLanguage = "en" | "ro";

export const CONTENT_LANGUAGES: readonly ContentLanguage[] = ["en", "ro"];

export const CONTENT_LANGUAGE_NAMES: Record<ContentLanguage, string> = {
  en: "English",
  ro: "Romanian",
};

export function isContentLanguage(value: unknown): value is ContentLanguage {
  return typeof value === "string" && (CONTENT_LANGUAGES as readonly string[]).includes(value);
}

/** "ro", "ro-RO" and "RO" are Romanian; "en" and "en-GB" English; anything
 * else is a language this app does not write, and returns null. */
export function languageFromLocale(locale?: string | null): ContentLanguage | null {
  const base = String(locale ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return isContentLanguage(base) ? base : null;
}

export type ResolvedLanguage = {
  language: ContentLanguage;
  /** "chosen" on the Business screen, read from the "store" default, or
   * "unset": neither, and English is written as before. */
  source: "chosen" | "store" | "unset";
};

export function resolveContentLanguage(
  chosen: unknown,
  storeLocale?: string | null,
): ResolvedLanguage {
  if (isContentLanguage(chosen)) return { language: chosen, source: "chosen" };
  const fromStore = languageFromLocale(storeLocale);
  if (fromStore) return { language: fromStore, source: "store" };
  return { language: "en", source: "unset" };
}

export const SHOP_LOCALE_QUERY = `#graphql
  query ShopDefaultLocale {
    webPresences(first: 25) {
      nodes { defaultLocale { locale primary } }
    }
  }
`;

/**
 * The shop's default locale code ("ro", "en"), or null when it cannot be
 * read. Never throws: a refused or failed read means "not known", and the
 * caller carries on exactly as before this existed.
 */
export async function fetchShopLocale(
  graphql: (query: string) => Promise<any>,
): Promise<string | null> {
  try {
    const data = await graphql(SHOP_LOCALE_QUERY);
    const nodes = data?.webPresences?.nodes;
    if (!Array.isArray(nodes)) return null;
    const locales = nodes
      .map((node: any) => node?.defaultLocale)
      .filter((locale: any) => locale && typeof locale.locale === "string");
    const chosen = locales.find((locale: any) => locale.primary === true) ?? locales[0];
    const code = String(chosen?.locale ?? "").trim();
    return code === "" ? null : code;
  } catch {
    return null;
  }
}
