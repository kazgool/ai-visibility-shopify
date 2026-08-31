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
  selectedOptions: { name: string; value: string }[];
  metafields?: { key: string; value: string }[];
};

export type ProductInput = {
  id: string;
  title: string;
  handle?: string | null;
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

export function parseState(product: ProductInput): ProductState {
  const raw = product.metafields?.find((m) => m.key === "state")?.value;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ProductState;
  } catch {
    return {};
  }
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
  const metafields: Record<string, unknown>[] = [];
  const deletions: Record<string, unknown>[] = [];

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

  for (let i = 0; i < metafields.length; i += 24) {
    const slice = metafields.slice(i, i + 24);
    const data = await graphql<any>(METAFIELDS_SET, { metafields: slice });
    const errors = data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      throw new Error(`metafieldsSet: ${JSON.stringify(errors)}`);
    }
  }

  for (let i = 0; i < deletions.length; i += 24) {
    const slice = deletions.slice(i, i + 24);
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
