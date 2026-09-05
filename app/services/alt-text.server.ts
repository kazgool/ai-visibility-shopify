// Writing alt text to Shopify media (PRD §4.3).
//
// The lesson that shaped this: alt text belongs to the *file*, not the
// product. On Shopify the same media can be attached to several products, so
// a description generated for product A would silently describe product B.
// We record which product each description came from and refuse to overwrite
// a description generated for a different product - the merchant is told
// instead of being surprised.

import type { GraphqlFn } from "./admin.server";
import { buildAltText, looksLikeMachineAlt } from "../engine/alt-text";
import type { Fact } from "../engine";
import { ENGINE_VERSION, NAMESPACE, type ProductState } from "./facts.server";
import { ALT_TEXT_KEY } from "./seo-since";

const PRODUCT_MEDIA = `#graphql
  query ProductMedia($id: ID!) {
    product(id: $id) {
      id
      title
      productType
      state: metafield(namespace: "$app", key: "state") { value }
      media(first: 20) {
        nodes {
          ... on MediaImage {
            id
            alt
            image { url }
          }
        }
      }
    }
  }
`;

const UPDATE_MEDIA = `#graphql
  mutation UpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      mediaUserErrors { field message }
    }
  }
`;

const SET_STATE = `#graphql
  mutation SetAltTextState($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message code }
    }
  }
`;

/**
 * The dated record of what was written, on the product's `state` metafield
 * under `alt_text`: one timestamp per media id, and `at` the latest. Written
 * only after a media update actually happened, so it can never be an
 * identical write (the timestamps are new by construction) and never a write
 * on a pass that changed nothing. Entries for media no longer on the product
 * are dropped, so the map stays the size of the product's own gallery.
 *
 * Before 5 September 2026 nothing was stamped here, and the since card said
 * so; descriptions from before that date have no entry and are counted in
 * totals only.
 */
function stampedState(
  raw: string | null | undefined,
  currentMediaIds: string[],
  written: string[],
  now: string,
): ProductState {
  let state: ProductState = {};
  if (raw) {
    try {
      state = JSON.parse(raw) as ProductState;
    } catch {
      state = {};
    }
  }
  const media: Record<string, string> = {};
  const keep = new Set(currentMediaIds);
  for (const [id, at] of Object.entries(state[ALT_TEXT_KEY]?.media ?? {})) {
    if (keep.has(id) && typeof at === "string") media[id] = at;
  }
  for (const id of written) media[id] = now;
  state[ALT_TEXT_KEY] = { source: "auto", at: now, engine: ENGINE_VERSION, media };
  return state;
}

export type AltOutcome = {
  written: number;
  keptHuman: number;
  sharedFlagged: { mediaId: string; alt: string }[];
};

export async function writeAltText(
  graphql: GraphqlFn,
  productGid: string,
  facts: Fact[],
  seenMedia: Map<string, string>,
): Promise<AltOutcome> {
  const data = await graphql<any>(PRODUCT_MEDIA, { id: productGid });
  const product = data?.product;
  if (!product) return { written: 0, keptHuman: 0, sharedFlagged: [] };

  const outcome: AltOutcome = { written: 0, keptHuman: 0, sharedFlagged: [] };
  const updates: { id: string; alt: string }[] = [];

  const media = (product.media?.nodes ?? []).filter((m: any) => m?.id);

  media.forEach((item: any, index: number) => {
    const existing = (item.alt ?? "").trim();

    // Someone wrote this. Never touch it.
    if (existing !== "" && !looksLikeMachineAlt(existing)) {
      // But if the same file already carries a description we generated for a
      // different product, that is the reuse trap - flag it, do not "fix" it.
      const owner = seenMedia.get(item.id);
      if (owner && owner !== productGid) {
        outcome.sharedFlagged.push({ mediaId: item.id, alt: existing });
      }
      outcome.keptHuman += 1;
      return;
    }

    const alt = buildAltText(
      { title: product.title, productType: product.productType },
      facts,
      index,
    );
    seenMedia.set(item.id, productGid);

    // Never write an identical value (CLAUDE.md rule 3): a second pass over
    // an unchanged catalogue was rewriting every machine-or-empty alt text
    // regardless, which marks every product updated, fires products/update
    // per product, and queues a re-extraction job for each - a self-feed
    // storm of the same shape the metafield `unchanged` check in
    // facts.server.ts exists to prevent.
    if (alt === existing) return;

    updates.push({ id: item.id, alt });
  });

  if (updates.length > 0) {
    const res = await graphql<any>(UPDATE_MEDIA, {
      productId: productGid,
      media: updates.map((u) => ({ id: u.id, alt: u.alt })),
    });
    const errors = res?.productUpdateMedia?.mediaUserErrors ?? [];
    if (errors.length) {
      throw new Error(`productUpdateMedia: ${JSON.stringify(errors)}`);
    }
    outcome.written = updates.length;

    // The dated record, after the media write and only then: the media update
    // has already marked the product as changed, so this write adds no
    // trigger the pass did not already cause, and it never runs on a pass
    // that wrote nothing.
    const state = stampedState(
      product.state?.value,
      media.map((m: any) => String(m.id)),
      updates.map((u) => u.id),
      new Date().toISOString(),
    );
    const stamped = await graphql<any>(SET_STATE, {
      metafields: [
        {
          ownerId: productGid,
          namespace: NAMESPACE,
          key: "state",
          type: "json",
          value: JSON.stringify(state),
        },
      ],
    });
    const stateErrors = stamped?.metafieldsSet?.userErrors ?? [];
    if (stateErrors.length) {
      throw new Error(`metafieldsSet (alt_text state): ${JSON.stringify(stateErrors)}`);
    }
  }

  return outcome;
}
