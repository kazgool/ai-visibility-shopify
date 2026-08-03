// Collections: read each collection with its members' extracted attributes,
// build the listing-page answer, write it to collection metafields (PRD §4.8).
//
// Same guarantees as products: nothing a person wrote is overwritten, an
// identical value is never rewritten (that is what stops the app feeding its
// own webhooks), and every published string goes through cleanOutput.
//
// Reads the members' `facts` metafield rather than re-extracting: the
// comparison table must show exactly what the product pages show, including
// any value the merchant corrected by hand.

import { buildCollectionCapsule, cleanOutput, type Fact } from "../engine";
import type { GraphqlFn } from "./admin.server";
import { NAMESPACE, ENGINE_VERSION } from "./facts.server";

export type CollectionNode = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml?: string | null;
  productsCount?: { count: number } | null;
  metafields?: { key: string; value: string }[];
  products?: {
    nodes: {
      id: string;
      title: string;
      handle: string;
      metafields?: { key: string; value: string }[];
    }[];
  };
};

// 60 members is enough to describe a range honestly; beyond that a comparison
// table stops being a comparison. The capsule still reports the real count.
export const MEMBER_SAMPLE = 60;

const COLLECTIONS = `#graphql
  query CollectionsForCapsule($cursor: String, $members: Int!) {
    collections(first: 10, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        descriptionHtml
        productsCount { count }
        metafields(namespace: "$app", first: 6) { nodes { key value } }
        products(first: $members) {
          nodes {
            id
            title
            handle
            metafields(namespace: "$app", first: 2) { nodes { key value } }
          }
        }
      }
    }
  }
`;

const METAFIELDS_SET = `#graphql
  mutation SetCollectionFields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message code }
    }
  }
`;

type RawNode = Omit<CollectionNode, "metafields" | "products"> & {
  metafields?: { nodes: { key: string; value: string }[] };
  products?: {
    nodes: {
      id: string;
      title: string;
      handle: string;
      metafields?: { nodes: { key: string; value: string }[] };
    }[];
  };
};

function flatten(node: RawNode): CollectionNode {
  return {
    ...node,
    metafields: node.metafields?.nodes ?? [],
    products: {
      nodes: (node.products?.nodes ?? []).map((p) => ({
        ...p,
        metafields: p.metafields?.nodes ?? [],
      })),
    },
  };
}

/** Every collection in the shop, with its members' attributes. */
export async function fetchCollections(
  graphql: GraphqlFn,
  members = MEMBER_SAMPLE,
): Promise<CollectionNode[]> {
  const out: CollectionNode[] = [];
  let cursor: string | null = null;

  for (;;) {
    const data: any = await graphql<any>(COLLECTIONS, { cursor, members });
    const page: any = data?.collections;
    if (!page) break;
    for (const node of page.nodes as RawNode[]) out.push(flatten(node));
    if (!page.pageInfo?.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }

  return out;
}

function factsOf(product: { metafields?: { key: string; value: string }[] }): Fact[] {
  const raw = product.metafields?.find((m) => m.key === "facts")?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Fact[]) : [];
  } catch {
    return [];
  }
}

type FieldState = { source: "auto" | "human"; at: string; engine?: string };

function stateOf(collection: CollectionNode): Record<string, FieldState> {
  const raw = collection.metafields?.find((m) => m.key === "state")?.value;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, FieldState>;
  } catch {
    return {};
  }
}

/** Same rule as products: human wins, and an unexplained value is human. */
function mayWrite(collection: CollectionNode, key: string): boolean {
  const entry = stateOf(collection)[key];
  if (entry?.source === "human") return false;
  const existing = collection.metafields?.find((m) => m.key === key)?.value;
  if (existing && existing !== "" && !entry) return false;
  return true;
}

export type CollectionOutcome = {
  id: string;
  title: string;
  handle: string;
  members: number;
  columns: string[];
  written: string[];
  skipped: string[];
  unchanged: string[];
  /** Nothing comparable in this collection - said plainly, not hidden. */
  empty: boolean;
};

export function buildForCollection(collection: CollectionNode) {
  const products = (collection.products?.nodes ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    facts: factsOf(p),
  }));

  return buildCollectionCapsule({
    title: cleanOutput(collection.title),
    descriptionHtml: collection.descriptionHtml,
    products,
  });
}

/**
 * Write capsules for a batch of collections. metafieldsSet takes 25 entries
 * per call and each collection contributes up to 5, so batches stay small.
 */
export async function writeCollections(
  graphql: GraphqlFn,
  collections: CollectionNode[],
): Promise<CollectionOutcome[]> {
  const outcomes: CollectionOutcome[] = [];
  const metafields: Record<string, unknown>[] = [];

  for (const collection of collections) {
    const capsule = buildForCollection(collection);
    const members = collection.products?.nodes?.length ?? 0;
    const outcome: CollectionOutcome = {
      id: collection.id,
      title: cleanOutput(collection.title),
      handle: collection.handle,
      members,
      columns: capsule.table.columns,
      written: [],
      skipped: [],
      unchanged: [],
      empty: capsule.table.columns.length === 0,
    };

    const candidates = [
      { key: "summary", type: "multi_line_text_field", value: capsule.summary },
      { key: "criteria", type: "json", value: JSON.stringify(capsule.criteria) },
      { key: "questions", type: "json", value: JSON.stringify(capsule.questions) },
      { key: "table", type: "json", value: JSON.stringify(capsule.table) },
    ];

    const state = stateOf(collection);
    const now = new Date().toISOString();
    let touched = false;

    for (const field of candidates) {
      if (!mayWrite(collection, field.key)) {
        outcome.skipped.push(field.key);
        continue;
      }
      if (field.value === "" || field.value === "[]" || field.value === "{}") continue;
      if (field.key === "table" && capsule.table.columns.length === 0) continue;

      // Never write an identical value: writing marks the collection as
      // updated, and an update we caused is an update we would react to.
      const current = collection.metafields?.find((m) => m.key === field.key)?.value;
      if (current === field.value) {
        outcome.unchanged.push(field.key);
        continue;
      }

      metafields.push({
        ownerId: collection.id,
        namespace: NAMESPACE,
        key: field.key,
        type: field.type,
        value: field.value,
      });
      state[field.key] = { source: "auto", at: now, engine: ENGINE_VERSION };
      outcome.written.push(field.key);
      touched = true;
    }

    if (touched) {
      metafields.push({
        ownerId: collection.id,
        namespace: NAMESPACE,
        key: "state",
        type: "json",
        value: JSON.stringify(state),
      });
    }

    outcomes.push(outcome);
  }

  for (let i = 0; i < metafields.length; i += 24) {
    const slice = metafields.slice(i, i + 24);
    const data = await graphql<any>(METAFIELDS_SET, { metafields: slice });
    const errors = data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      throw new Error(`metafieldsSet (collections): ${JSON.stringify(errors)}`);
    }
  }

  return outcomes;
}
