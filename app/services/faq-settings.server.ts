// Storage for the settings faq-settings.ts parses (CC-PROMPT-AI-READABILITY-3
// item 3): rows of the Settings table, next to the dictionary row, and one
// shop metafield for the only part the storefront reads.
//
// The hidden groups are the one setting the theme block needs, so they are
// mirrored to the shop metafield $app.facts_display, the same way saveBusiness
// mirrors the business record. Written from the Dictionary screen's save
// only, and only when the list changed: a shop metafield fires no product
// webhook, and an identical value is never written at all.
import db from "../db.server";
import { NAMESPACE } from "./facts.server";
import {
  DICTIONARY_PRESET_KEY,
  FACTS_DISPLAY_METAFIELD,
  FACTS_HIDDEN_KEY,
  FAQ_CAP_KEY,
  FAQ_MAPPINGS_KEY,
  normaliseHidden,
  parseCap,
  parseHidden,
  parseMappings,
  type FaqSettings,
  type Mappings,
} from "./faq-settings";

type AdminGraphql = (query: string, options?: { variables?: object }) => Promise<Response>;

const KEYS = [FAQ_MAPPINGS_KEY, FAQ_CAP_KEY, DICTIONARY_PRESET_KEY, FACTS_HIDDEN_KEY];

export async function faqSettingsFor(shopId: string): Promise<FaqSettings> {
  const rows = await db.setting.findMany({ where: { shopId, key: { in: KEYS } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  return {
    mappings: parseMappings(value(FAQ_MAPPINGS_KEY)),
    cap: parseCap(value(FAQ_CAP_KEY)),
    presetId: value(DICTIONARY_PRESET_KEY) || null,
    hiddenGroups: parseHidden(value(FACTS_HIDDEN_KEY)),
  };
}

async function put(shopId: string, key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { shopId_key: { shopId, key } },
    create: { shopId, key, value },
    update: { value },
  });
}

export async function saveFaqSettings(shopId: string, mappings: Mappings, cap: number): Promise<void> {
  await put(shopId, FAQ_MAPPINGS_KEY, JSON.stringify(mappings));
  await put(shopId, FAQ_CAP_KEY, String(cap));
}

export async function savePresetId(shopId: string, presetId: string): Promise<void> {
  await put(shopId, DICTIONARY_PRESET_KEY, presetId);
}

const SHOP_ID = `#graphql
  query ShopId { shop { id } }
`;

const SET_METAFIELD = `#graphql
  mutation SetShopFactsDisplay($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/**
 * Save which groups the product page's facts list leaves out. The metafield
 * is written first and the row second, so a refused write never leaves the
 * screen saying the change was saved when the storefront still shows the
 * old list. Returns whether anything was written.
 */
export async function saveHiddenGroups(
  shopId: string,
  graphql: AdminGraphql,
  hidden: string[],
): Promise<{ changed: boolean }> {
  const row = await db.setting.findUnique({ where: { shopId_key: { shopId, key: FACTS_HIDDEN_KEY } } });
  const current = parseHidden(row?.value);
  const next = normaliseHidden(hidden);
  if (JSON.stringify(current) === JSON.stringify(next)) return { changed: false };

  const idRes = await graphql(SHOP_ID);
  const idJson = await idRes.json();
  const shopGid = idJson.data?.shop?.id;
  if (!shopGid) throw new Error(`Could not resolve shop id${idJson.errors ? `: ${JSON.stringify(idJson.errors)}` : ""}`);

  const res = await graphql(SET_METAFIELD, {
    variables: {
      metafields: [
        {
          ownerId: shopGid,
          namespace: NAMESPACE,
          key: FACTS_DISPLAY_METAFIELD,
          type: "json",
          value: JSON.stringify({ hidden: next }),
        },
      ],
    },
  });
  const json = await res.json();
  if (json.errors) throw new Error(`metafieldsSet (shop facts_display): ${JSON.stringify(json.errors)}`);
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) throw new Error(`metafieldsSet (shop facts_display): ${JSON.stringify(errors)}`);

  await put(shopId, FACTS_HIDDEN_KEY, JSON.stringify(next));
  return { changed: true };
}
