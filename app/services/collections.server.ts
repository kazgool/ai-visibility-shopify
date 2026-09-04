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
import { DEFAULT_PREFS, eligibility, type PublishPrefs } from "./eligibility";

export type CollectionNode = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml?: string | null;
  productsCount?: { count: number } | null;
  metafields?: { key: string; value: string }[];
  /**
   * Shopify's own SEO pair, the same shape `Product.seo` has. Read for check
   * A6 and written by the collections meta writer (seo-collections.server.ts);
   * `writeCollections` in this file never touches it.
   */
  seo?: { title: string | null; description: string | null } | null;
  products?: {
    nodes: {
      id: string;
      title: string;
      handle: string;
      // Read so a member that has no public product page can be dropped
      // before it reaches the table. The Admin API returns a collection's
      // members whatever their status, so without these two a draft or
      // unpublished member was rendered with a link to a 404, and an
      // unlisted member appeared in the one place Shopify says it does not.
      status?: string | null;
      onlineStoreUrl?: string | null;
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
        seo { title description }
        metafields(namespace: "$app", first: 10) { nodes { key value } }
        products(first: $members) {
          nodes {
            id
            title
            handle
            status
            onlineStoreUrl
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
      status?: string | null;
      onlineStoreUrl?: string | null;
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
  /** Auto-written fields withdrawn because this pass produced nothing for them. */
  removed: string[];
  /** Nothing comparable in this collection - said plainly, not hidden. */
  empty: boolean;
};

const METAFIELDS_DELETE = `#graphql
  mutation DeleteCollectionFields($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/**
 * The members a comparison table may show. Every row links to
 * /products/{handle}, so a member with no public product page would put a
 * link to a 404 into a metafield that then persists until the next
 * collections pass.
 *
 * Out of stock is forced on here whatever the merchant's toggle says:
 * Shopify's own collection page lists sold-out members, and the table sits on
 * that page, so the table follows the page. The unlisted toggle is honoured,
 * because an unlisted product is one Shopify keeps out of collections.
 */
export function eligibleMembers(
  collection: CollectionNode,
  prefs: PublishPrefs = DEFAULT_PREFS,
) {
  const tablePrefs: PublishPrefs = { ...prefs, includeOutOfStock: true };
  return (collection.products?.nodes ?? []).filter(
    (p) =>
      eligibility(
        { status: p.status ?? undefined, onlineStoreUrl: p.onlineStoreUrl ?? null },
        tablePrefs,
      ) === "eligible",
  );
}

export function buildForCollection(
  collection: CollectionNode,
  prefs: PublishPrefs = DEFAULT_PREFS,
) {
  const products = eligibleMembers(collection, prefs).map((p) => ({
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
  prefs: PublishPrefs = DEFAULT_PREFS,
): Promise<CollectionOutcome[]> {
  const outcomes: CollectionOutcome[] = [];
  const metafields: Record<string, unknown>[] = [];
  const deletions: Record<string, unknown>[] = [];

  for (const collection of collections) {
    const capsule = buildForCollection(collection, prefs);
    // The members the table was built from, not every member the API
    // returned: reporting a count the table does not match is a number
    // without its denominator.
    const members = eligibleMembers(collection, prefs).length;
    const outcome: CollectionOutcome = {
      id: collection.id,
      title: cleanOutput(collection.title),
      handle: collection.handle,
      members,
      columns: capsule.table.columns,
      written: [],
      skipped: [],
      unchanged: [],
      removed: [],
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
      if (field.key === "table" && capsule.table.columns.length === 0) {
        // The pass produced no table. If a previous pass wrote one, it still
        // sits in the metafield with a row per member it had then, each row a
        // link to /products/{handle} - and the reason there is no table now is
        // usually that those members went draft, archived or unlisted. Left in
        // place it is a table of links to 404s, which is the leak PRD-PORT-1.7.8
        // I.5 says this change closes (QA of 3 September 2026, wave fix 1). So
        // an auto-written table is withdrawn, the way writeFacts withdraws an
        // auto value the engine no longer produces. mayWrite above already
        // refused a human-written one.
        const current = collection.metafields?.find((m) => m.key === field.key)?.value;
        if (current && current !== "" && current !== "{}") {
          deletions.push({ ownerId: collection.id, namespace: NAMESPACE, key: field.key });
          delete state[field.key];
          outcome.removed.push(field.key);
          touched = true;
        }
        continue;
      }

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

  for (let i = 0; i < deletions.length; i += 24) {
    const slice = deletions.slice(i, i + 24);
    const data = await graphql<any>(METAFIELDS_DELETE, { metafields: slice });
    const errors = data?.metafieldsDelete?.userErrors ?? [];
    if (errors.length) {
      throw new Error(`metafieldsDelete (collections): ${JSON.stringify(errors)}`);
    }
  }

  return outcomes;
}
