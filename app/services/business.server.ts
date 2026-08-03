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

const SETTING_KEY = "business";

export async function businessFor(shopId: string): Promise<BusinessInfo | null> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SETTING_KEY } },
  });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as BusinessInfo;
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
  info: BusinessInfo,
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
