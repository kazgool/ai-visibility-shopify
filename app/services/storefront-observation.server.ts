// A per-product fact about what a public page actually rendered.
//
// This deliberately lives in its own metafield rather than `$app.state`:
// state is the provenance record for content writers, and a page-read must
// never race with it or make a product look merchant-edited.  The value is a
// tiny, replaceable observation, not merchant content.  It is written only
// after a successful page read and the storefront treats a missing value as
// unknown (no JSON-LD fragment).

import type { GraphqlFn } from "./admin.server";

const OBSERVATION = `#graphql
  query ProductSchemaObservation($id: ID!) {
    product(id: $id) {
      metafield(namespace: "$app", key: "schema_observation") { value }
    }
  }
`;

const SET_OBSERVATION = `#graphql
  mutation SetProductSchemaObservation($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message code }
    }
  }
`;

export type ProductSchemaObservation = {
  /** `complete` means this exact product URL rendered our non-fragment Product node. */
  productNode: "complete" | "absent";
  version: 1;
};

export function productSchemaObservation(complete: boolean): ProductSchemaObservation {
  return { productNode: complete ? "complete" : "absent", version: 1 };
}

function sameObservation(raw: unknown, next: ProductSchemaObservation): boolean {
  if (typeof raw !== "string") return false;
  try {
    const previous = JSON.parse(raw);
    return previous?.productNode === next.productNode && previous?.version === next.version;
  } catch {
    return false;
  }
}

/**
 * Store a page observation only when it changed.  A nightly page read must
 * not manufacture a products/update webhook every night: the database row's
 * scannedAt is the audit timestamp, while this metafield is only the current
 * storefront gate.
 */
export async function recordProductSchemaObservation(
  graphql: GraphqlFn,
  productId: string,
  complete: boolean,
): Promise<boolean> {
  const current = await graphql<any>(OBSERVATION, { id: productId });
  const next = productSchemaObservation(complete);
  if (sameObservation(current?.product?.metafield?.value, next)) return false;

  const result = await graphql<any>(SET_OBSERVATION, {
    metafields: [
      {
        ownerId: productId,
        namespace: "$app",
        key: "schema_observation",
        type: "json",
        value: JSON.stringify(next),
      },
    ],
  });
  const errors = result?.metafieldsSet?.userErrors ?? [];
  if (errors.length) throw new Error(`metafieldsSet (schema_observation): ${JSON.stringify(errors)}`);
  return true;
}
