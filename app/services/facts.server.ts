// Engine output → Shopify metafields, with provenance.
//
// The rule that makes this app honest (PRD §4.1, DICTIONARY-PORT §10):
// a value a person wrote is never overwritten. Until the editor UI exists,
// an existing value with no state entry is treated as human — the safe
// default, because the alternative is destroying merchant work.

import type { Fact } from "../engine";
import type { GraphqlFn } from "./admin.server";

export const NAMESPACE = "$app";
export const ENGINE_VERSION = "1.0.0";

export type FieldState = { source: "auto" | "human"; at: string; engine?: string };
export type ProductState = Record<string, FieldState>;

export type VariantInput = {
  id: string;
  title?: string | null;
  sku?: string | null;
  /** Shopify's own answer to "can this be ordered right now". The product's
   * `available` is derived from these, not from totalInventory, so a
   * made-to-order product is not reported as sold out. */
  availableForSale?: boolean;
  selectedOptions: { name: string; value: string }[];
  metafields?: { key: string; value: string }[];
};

export type ProductInput = {
  id: string;
  title: string;
  handle?: string | null;
  // ACTIVE, DRAFT, ARCHIVED or UNLISTED, carried on both fetch paths, and
  // read by eligibility() to decide whether this product gets a public text
  // page. The bulk path used to leave it unset and rely on its query filter;
  // it now asks for the field, because a filter says what was requested and
  // the field says what the product is.
  status?: string;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  category?: string | null;
  onlineStoreUrl?: string | null;
  price?: string | null;
  currency?: string | null;
  available?: boolean;
  sku?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  metafields?: { key: string; value: string }[];
  variants?: VariantInput[];
  collections?: { handle: string; title: string }[];
  // Shopify's own SEO fields (Product.seo). Read-only, never written by this
  // app - the SEO screen's field audit reads these to find empty ones.
  seo?: { title: string | null; description: string | null } | null;
};

// The decision about which products get a public text page moved to
// eligibility.ts, which reads the merchant's two toggles as well as the
// product's own state. It is not re-exported from here: one decision, one
// place, and the screen renders its sentences from the same module.

export function parseState(product: ProductInput): ProductState {
  const raw = product.metafields?.find((m) => m.key === "state")?.value;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ProductState;
  } catch {
    return {};
  }
}

// A product whose description no longer yields anything must still flow
// through writeFacts, because writeFacts's withdrawal branch is what retracts
// stale auto-written facts/summary/questions/fit_for. This check is only about
// cost - deciding whether a zero-fact product is worth pushing into the batch
// write path at all - answered from `product.metafields`, already fetched, so
// it adds no new Admin API reads. It lives here rather than in
// extract.server.ts so a test can reach it without loading db.server and
// admin.server, which need environment variables CI does not have.
const WITHDRAWABLE_KEYS = ["facts", "summary", "questions", "fit_for"] as const;

export function hasWithdrawableAutoValues(product: ProductInput): boolean {
  const state = parseState(product);
  return WITHDRAWABLE_KEYS.some((key) => {
    const value = product.metafields?.find((m) => m.key === key)?.value;
    if (!value || value === "" || value === "[]" || value === "{}") return false;
    return state[key]?.source === "auto";
  });
}

/**
 * May we write this key? No, if a human wrote it. No, if a value exists but
 * we have no record of writing it — that value came from somewhere else.
 */
export function mayWrite(product: ProductInput, key: string): boolean {
  const state = parseState(product);
  const entry = state[key];
  if (entry?.source === "human") return false;

  const existing = product.metafields?.find((m) => m.key === key)?.value;
  if (existing && existing !== "" && !entry) return false;

  return true;
}

const METAFIELDS_SET = `#graphql
  mutation SetFacts($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message code }
    }
  }
`;

const METAFIELDS_DELETE = `#graphql
  mutation DeleteFacts($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/** The metafieldsSet / metafieldsDelete limit per call. */
const METAFIELDS_PER_CALL = 24;

/**
 * Group writes into calls without ever splitting one product across two.
 *
 * A product's values and its `state` entry have to land in the same call. Cut
 * blindly every 24 entries, the values can be written and the state lost to a
 * failure on the next call - and a value with no state entry is read as human
 * for ever after, so the app can never correct or withdraw it.
 *
 * A product with more than `size` fields cannot have a call of its own: the
 * API refuses more than 25 entries, so emitting a slice of 30 would fail the
 * whole batch. No dictionary produces that today; if one ever does, that
 * product is chunked and its `state` entry rides in the first chunk. The
 * asymmetry is the point. State written for a value that never landed is
 * self-correcting - the next pass recomputes and writes it. A value written
 * with no state is not: it is read as human and never touched again.
 */
export function sliceByOwner<T extends { ownerId: string }>(
  items: T[],
  size = METAFIELDS_PER_CALL,
): T[][] {
  const byOwner = new Map<string, T[]>();
  for (const item of items) {
    const list = byOwner.get(item.ownerId);
    if (list) list.push(item);
    else byOwner.set(item.ownerId, [item]);
  }

  const slices: T[][] = [];
  let current: T[] = [];
  for (const group of byOwner.values()) {
    if (group.length > size) {
      if (current.length > 0) {
        slices.push(current);
        current = [];
      }
      for (const chunk of chunkStateFirst(group, size)) slices.push(chunk);
      continue;
    }
    if (current.length > 0 && current.length + group.length > size) {
      slices.push(current);
      current = [];
    }
    current = current.concat(group);
  }
  if (current.length > 0) slices.push(current);

  return slices;
}

/**
 * Cut one owner's entries into calls of at most `size`, with the `state`
 * entry moved to the front so it is written first.
 */
function chunkStateFirst<T extends { ownerId: string }>(group: T[], size: number): T[][] {
  const isState = (item: T) =>
    (item as { key?: unknown }).key === "state";
  const ordered = [...group.filter(isState), ...group.filter((i) => !isState(i))];

  const chunks: T[][] = [];
  for (let i = 0; i < ordered.length; i += size) {
    chunks.push(ordered.slice(i, i + size));
  }
  return chunks;
}

export type WriteOutcome = {
  productId: string;
  written: string[];
  skipped: string[];
  /** Already identical — not written, which is what stops the feedback loop. */
  unchanged: string[];
  /** Auto-written values whose recomputation came back empty — withdrawn. */
  removed: string[];
};

export type FieldValue = { key: string; type: string; value: string };

/**
 * Write facts (and refresh state) for a batch of products. metafieldsSet
 * accepts 25 entries per call; each product contributes 2 (facts + state),
 * so batches are capped at 12 products.
 */
export async function writeFacts(
  graphql: GraphqlFn,
  entries: { product: ProductInput; facts: Fact[]; fields?: FieldValue[] }[],
): Promise<WriteOutcome[]> {
  const outcomes: WriteOutcome[] = [];
  // ownerId is stated in the type because the slicing below groups on it.
  const metafields: { ownerId: string; [key: string]: unknown }[] = [];
  const deletions: { ownerId: string; [key: string]: unknown }[] = [];

  for (const { product, facts, fields = [] } of entries) {
    const outcome: WriteOutcome = {
      productId: product.id,
      written: [],
      skipped: [],
      unchanged: [],
      removed: [],
    };
    const state = parseState(product);
    const now = new Date().toISOString();

    const candidates: FieldValue[] = [
      { key: "facts", type: "json", value: JSON.stringify(facts) },
      ...fields,
    ];

    let touched = false;
    for (const field of candidates) {
      // Each field is guarded on its own: a merchant may have written the
      // summary by hand while leaving the attributes automatic.
      if (!mayWrite(product, field.key)) {
        outcome.skipped.push(field.key);
        continue;
      }

      const empty = field.value === "" || field.value === "[]" || field.value === "{}";
      if (empty) {
        // A fact that stopped being supported must be withdrawn, not merely
        // left un-renewed. "Suits: 6 scaune" survived a semantics fix for
        // weeks this way: the new computation was empty, so nothing was
        // written, and the stale claim kept publishing. Only auto values are
        // withdrawn; human text is never deleted.
        const existing = product.metafields?.find((m) => m.key === field.key)?.value;
        if (existing && existing !== "" && state[field.key]?.source === "auto") {
          deletions.push({ ownerId: product.id, namespace: NAMESPACE, key: field.key });
          delete state[field.key];
          outcome.removed.push(field.key);
          touched = true;
        }
        continue;
      }

      // Writing a metafield marks the product as updated, which fires
      // products/update, which queues another extraction, which writes again.
      // Without this check the app feeds itself for ever. Identical output
      // means there is nothing to say, so we say nothing.
      const current = product.metafields?.find((m) => m.key === field.key)?.value;
      if (current === field.value) {
        outcome.unchanged.push(field.key);
        continue;
      }

      metafields.push({
        ownerId: product.id,
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
        ownerId: product.id,
        namespace: NAMESPACE,
        key: "state",
        type: "json",
        value: JSON.stringify(state),
      });
    }

    outcomes.push(outcome);
  }

  for (const slice of sliceByOwner(metafields)) {
    const data = await graphql<any>(METAFIELDS_SET, { metafields: slice });
    const errors = data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      throw new Error(`metafieldsSet: ${JSON.stringify(errors)}`);
    }
  }

  for (const slice of sliceByOwner(deletions)) {
    const data = await graphql<any>(METAFIELDS_DELETE, { metafields: slice });
    const errors = data?.metafieldsDelete?.userErrors ?? [];
    if (errors.length) {
      throw new Error(`metafieldsDelete: ${JSON.stringify(errors)}`);
    }
  }

  return outcomes;
}

/**
 * Write option-derived facts on variants (PRD §5.4). Same three guards as
 * products, per variant: a human-written value is never touched, a value we
 * cannot account for is treated as human, and an identical value is never
 * rewritten - a variant write marks the product updated, so without that
 * last check every pass would feed the products/update webhook.
 */
export async function writeVariantFacts(
  graphql: GraphqlFn,
  variants: { variant: VariantInput; facts: Fact[] }[],
): Promise<void> {
  const metafields: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  for (const { variant, facts } of variants) {
    if (facts.length === 0) continue;

    const rawState = variant.metafields?.find((m) => m.key === "state")?.value;
    let state: ProductState = {};
    if (rawState) {
      try {
        state = JSON.parse(rawState) as ProductState;
      } catch {
        state = {};
      }
    }

    if (state["facts"]?.source === "human") continue;
    const existing = variant.metafields?.find((m) => m.key === "facts")?.value;
    if (existing && existing !== "" && !state["facts"]) continue;

    const value = JSON.stringify(facts);
    if (existing === value) continue;

    state["facts"] = { source: "auto", at: now, engine: ENGINE_VERSION };
    metafields.push(
      { ownerId: variant.id, namespace: NAMESPACE, key: "facts", type: "json", value },
      { ownerId: variant.id, namespace: NAMESPACE, key: "state", type: "json", value: JSON.stringify(state) },
    );
  }

  for (let i = 0; i < metafields.length; i += 24) {
    const slice = metafields.slice(i, i + 24);
    const data = await graphql<any>(METAFIELDS_SET, { metafields: slice });
    const errors = data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      throw new Error(`metafieldsSet (variants): ${JSON.stringify(errors)}`);
    }
  }
}
