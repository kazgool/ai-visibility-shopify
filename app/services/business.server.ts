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
import { NAMESPACE } from "./facts.server";
import { SOCIAL_PLATFORMS } from "./social-profiles";
import type { SocialPlatform, SocialProfiles } from "./social-profiles";

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

/** Business info plus the optional social profile URLs, stored together. */
export type BusinessRecord = BusinessInfo & { socialProfiles?: SocialProfiles };

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
 */
export async function saveBusiness(
  shopId: string,
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
  info: BusinessRecord,
): Promise<void> {
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: SETTING_KEY } },
    create: { shopId, key: SETTING_KEY, value: JSON.stringify(info) },
    update: { value: JSON.stringify(info) },
  });

  const idRes = await graphql(SHOP_ID);
  const idJson = await idRes.json();
  const shopGid = idJson.data?.shop?.id;
  if (!shopGid) throw new Error("Could not resolve shop id");

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
