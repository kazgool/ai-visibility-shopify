// Reading the catalogue at scale (PRD §5.5).
//
// One bulk operation exports every product as JSONL regardless of catalogue
// size. Never paginate a 10,000-product catalogue by hand: it burns the rate
// limit and takes minutes instead of seconds.

import type { GraphqlFn } from "./admin.server";
import { sleep } from "./admin.server";
import type { ProductInput } from "./facts.server";
import { NAMESPACE } from "./facts.server";

const RUN_BULK = `#graphql
  mutation RunBulk($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const POLL_BULK = `#graphql
  query PollBulk {
    currentBulkOperation(type: QUERY) {
      id status errorCode objectCount url
    }
  }
`;

const PRODUCTS_QUERY = `
  {
    products {
      edges {
        node {
          id
          title
          descriptionHtml
          metafields(namespace: "${NAMESPACE}", first: 10) {
            edges { node { key value } }
          }
        }
      }
    }
  }
`;

const SINGLE_PRODUCT = `#graphql
  query OneProduct($id: ID!) {
    product(id: $id) {
      id
      title
      descriptionHtml
      metafields(namespace: "${NAMESPACE}", first: 10) {
        nodes { key value }
      }
    }
  }
`;

export async function fetchProduct(
  graphql: GraphqlFn,
  id: string,
): Promise<ProductInput | null> {
  const data = await graphql<any>(SINGLE_PRODUCT, { id });
  const p = data?.product;
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    metafields: (p.metafields?.nodes ?? []).map((n: any) => ({ key: n.key, value: n.value })),
  };
}

/**
 * Run a bulk export and stream the result. JSONL from a bulk operation is
 * flat: product rows and their metafield children arrive as separate lines
 * linked by __parentId, so children are folded back into their parent here.
 */
export async function fetchAllProducts(graphql: GraphqlFn): Promise<ProductInput[]> {
  const start = await graphql<any>(RUN_BULK, { query: PRODUCTS_QUERY });
  const errors = start?.bulkOperationRunQuery?.userErrors ?? [];
  if (errors.length) throw new Error(`bulkOperationRunQuery: ${JSON.stringify(errors)}`);

  let url: string | null = null;
  for (let i = 0; i < 240; i += 1) {
    await sleep(2000);
    const poll = await graphql<any>(POLL_BULK);
    const op = poll?.currentBulkOperation;
    if (!op) continue;
    if (op.status === "COMPLETED") {
      url = op.url;
      break;
    }
    if (op.status === "FAILED" || op.status === "CANCELED") {
      throw new Error(`Bulk operation ${op.status}: ${op.errorCode ?? ""}`);
    }
  }
  if (!url) throw new Error("Bulk operation did not complete in time");

  const res = await fetch(url);
  const body = await res.text();

  const products = new Map<string, ProductInput>();
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);

    if (row.id?.includes("/Product/") && row.title !== undefined) {
      products.set(row.id, {
        id: row.id,
        title: row.title,
        descriptionHtml: row.descriptionHtml,
        metafields: [],
      });
      continue;
    }

    // Metafield child row.
    if (row.__parentId && row.key !== undefined) {
      const parent = products.get(row.__parentId);
      if (parent) parent.metafields!.push({ key: row.key, value: row.value });
    }
  }

  return Array.from(products.values());
}
