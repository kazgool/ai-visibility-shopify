// Business info (WP 1.6.7 port): the commercial answers a shop gives once -
// delivery, returns, warranty, payment. Stored twice, deliberately:
//
//  - in our Settings table, for the editing screen;
//  - in a SHOP metafield with public read, so the theme block renders
//    shipping and return schema with our app nowhere in the request path,
//    and the data survives uninstall like everything else we write.

import db from "../db.server";
import type { BusinessInfo } from "../engine";
import type { GraphqlFn } from "./admin.server";
import { readDeliveryCost, type DeliveryCostParsed } from "./delivery-parse";
import { NAMESPACE } from "./facts.server";
import { SOCIAL_PLATFORMS } from "./social-profiles";
import type { SocialPlatform, SocialProfiles } from "./social-profiles";
import {
  resolveContentLanguage,
  type ContentLanguage,
  type ResolvedLanguage,
} from "./content-language";

const SETTING_KEY = "business";

/**
 * Official store profile URLs, published as schema.org sameAs. Not part of
 * the engine's BusinessInfo (the engine never reads or generates these); it
 * is a separate, purely publishing concern kept in the same metafield so it
 * survives uninstall like the rest of the business answers.
 *
 * The platform list itself lives in social-profiles.ts, because the settings
 * screen renders a field per platform and a component may not import from a
 * .server module.
 */
export { SOCIAL_PLATFORMS } from "./social-profiles";
export type { SocialPlatform, SocialProfiles } from "./social-profiles";

/**
 * Business info plus the optional social profile URLs and the language the
 * app writes product text in, stored together. `contentLanguage` absent means
 * the merchant has not chosen; content-language.ts says what is written then.
 */
export type BusinessRecord = BusinessInfo & {
  socialProfiles?: SocialProfiles;
  contentLanguage?: ContentLanguage;
  /**
   * The delivery cost text read into numbers, stored next to `deliveryCost`
   * and never instead of it (CC-PROMPT-AI-READABILITY-4 item 2): the text
   * stays exactly as typed everywhere text is published, and the storefront
   * block reads these for structured data. Written on every save by
   * withParsedDelivery; absent on a record saved before it existed, and then
   * no delivery price is published until the next save.
   */
  deliveryCostParsed?: DeliveryCostParsed;
  /**
   * "Countries you deliver to", ISO 3166-1 alpha-2, as the merchant typed them.
   * Absent means none were typed, and the storefront block publishes the
   * shop's own country (shop.address.country_code) at render time.
   */
  deliveryCountries?: string[];
};

/**
 * The record as it is saved: the delivery cost text read into numbers
 * (delivery-parse.ts), beside the text. `shopCurrency` is the shop's ISO
 * currency, the one a cost typed with no currency is in. Pure. A stale
 * reading never survives a changed or emptied text: it is always recomputed.
 */
export function withParsedDelivery(info: BusinessRecord, shopCurrency: string): BusinessRecord {
  const { deliveryCostParsed: _previous, ...rest } = info;
  const text = (info.deliveryCost ?? "").trim();
  if (text === "") return rest;
  return { ...rest, deliveryCostParsed: readDeliveryCost(text, shopCurrency).parsed };
}

/** The shop's default locale as last read from the Admin API
 * (content-language.ts), kept apart from the business record because nobody
 * typed it. */
export const SHOP_LOCALE_SETTING_KEY = "shop_locale";

export async function shopLocaleFor(shopId: string): Promise<string | null> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SHOP_LOCALE_SETTING_KEY } },
  });
  return row?.value?.trim() || null;
}

/** Written only when it differs: our own table, but the same rule as every
 * other writer in this app. */
export async function saveShopLocale(shopId: string, locale: string): Promise<void> {
  if ((await shopLocaleFor(shopId)) === locale) return;
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: SHOP_LOCALE_SETTING_KEY } },
    create: { shopId, key: SHOP_LOCALE_SETTING_KEY, value: locale },
    update: { value: locale },
  });
}

/** The language summaries and questions are written in, and where it came from. */
export async function contentLanguageFor(shopId: string): Promise<ResolvedLanguage> {
  const [business, locale] = await Promise.all([businessFor(shopId), shopLocaleFor(shopId)]);
  return resolveContentLanguage(business?.contentLanguage, locale);
}

/**
 * Accept only absolute https URLs. We never verify the profile exists - that
 * would be a network call and a claim the app cannot back - so a malformed
 * or non-https value is dropped rather than published.
 */
export function isValidProfileUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.length > 0;
}

/**
 * Drop anything that is not a valid https URL, silently. Publishing junk is
 * worse than publishing nothing; there is no error to show the merchant for
 * a field that simply gets left out.
 */
export function sanitizeSocialProfiles(
  input: Partial<Record<SocialPlatform, string>>,
): SocialProfiles {
  const out: SocialProfiles = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const raw = input[platform]?.trim();
    if (raw && isValidProfileUrl(raw)) out[platform] = raw;
  }
  return out;
}

export async function businessFor(shopId: string): Promise<BusinessRecord | null> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SETTING_KEY } },
  });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as BusinessRecord;
  } catch {
    return null;
  }
}

const SHOP_ID = `#graphql
  query ShopId { shop { id } }
`;

/** The shop's id and currency: a delivery cost typed with no currency is in the shop's. */
const SHOP_FOR_BUSINESS = `#graphql
  query ShopForBusiness { shop { id currencyCode } }
`;

const SET_METAFIELD = `#graphql
  mutation SetShopBusiness($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/**
 * Save the settings row and mirror it to the shop metafield. The metafield
 * write goes through the caller's admin client (a Remix request), not the
 * worker: saving business info is an interactive act.
 *
 * The delivery cost is read into numbers here, server side, on every save
 * (CC-PROMPT-AI-READABILITY-4 item 2a), so the record the storefront reads is
 * always the one the text says. Same metafield, same write: no new write path.
 */
export async function saveBusiness(
  shopId: string,
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
  input: BusinessRecord,
): Promise<void> {
  const idRes = await graphql(SHOP_FOR_BUSINESS);
  const idJson = await idRes.json();
  const shopGid = idJson.data?.shop?.id;
  if (!shopGid) throw new Error("Could not resolve shop id");
  const currency = idJson.data?.shop?.currencyCode;
  if (!currency) throw new Error("Could not resolve the shop's currency");
  const info = withParsedDelivery(input, String(currency));

  await db.setting.upsert({
    where: { shopId_key: { shopId, key: SETTING_KEY } },
    create: { shopId, key: SETTING_KEY, value: JSON.stringify(info) },
    update: { value: JSON.stringify(info) },
  });

  const res = await graphql(SET_METAFIELD, {
    variables: {
      metafields: [
        {
          ownerId: shopGid,
          namespace: NAMESPACE,
          key: "business",
          type: "json",
          value: JSON.stringify(info),
        },
      ],
    },
  });
  const json = await res.json();
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`metafieldsSet (shop business): ${JSON.stringify(errors)}`);
  }
}

/** Worker-side variant of the metafield mirror, for future use. */
export async function syncBusinessMetafield(
  shopId: string,
  graphql: GraphqlFn,
): Promise<void> {
  const info = await businessFor(shopId);
  if (!info) return;
  const idData = await graphql<any>(SHOP_ID);
  const shopGid = idData?.shop?.id;
  if (!shopGid) return;
  await graphql<any>(SET_METAFIELD, {
    metafields: [
      {
        ownerId: shopGid,
        namespace: NAMESPACE,
        key: "business",
        type: "json",
        value: JSON.stringify(info),
      },
    ],
  });
}
