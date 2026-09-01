// Writing alt text to Shopify media (PRD §4.3).
//
// The lesson that shaped this: alt text belongs to the *file*, not the
// product. On Shopify the same media can be attached to several products, so
// a description generated for product A would silently describe product B.
// We record which product each description came from and refuse to overwrite
// a description generated for a different product — the merchant is told
// instead of being surprised.

import type { GraphqlFn } from "./admin.server";
import { buildAltText, looksLikeMachineAlt } from "../engine/alt-text";
import type { Fact } from "../engine";

const PRODUCT_MEDIA = `#graphql
  query ProductMedia($id: ID!) {
    product(id: $id) {
      id
      title
      productType
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
      // different product, that is the reuse trap — flag it, do not "fix" it.
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
  }

  return outcome;
}
