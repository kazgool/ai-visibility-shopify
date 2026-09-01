// The SEO writer - Product.seo.title and Product.seo.description
// (SEO-WORKSPACE-PRD §3). Unlike every other field this app writes, these are
// Shopify's own fields, not `$app` metafields, so they need their own writer
// even though provenance still lives in the same `state` metafield.
//
// Two things make this different from writeFacts in facts.server.ts:
//  - the "current value" to compare against comes from `Product.seo`, not
//    from our metafields, so the unchanged check is reimplemented here
//    (CLAUDE.md rule 3: never write an identical value - it marks the
//    product updated, which re-fires products/update, which queues
//    extraction, which would write again);
//  - revert needs a value to go back to. Before this app's first write to a
//    product's seo fields, the prior value is captured in the state entry
//    itself (`prev`), captured once and never touched by later regenerations
//    (SEO-WORKSPACE-PRD §3.1).

import type { GraphqlFn } from "./admin.server";
import { NAMESPACE, ENGINE_VERSION, parseState, type ProductState } from "./facts.server";
import type { Fact } from "../engine";
import { buildMetaTitle, buildMetaDescription, type MetaInput } from "../engine/meta";
import { computeTermGap, type TermGapRow } from "../engine/term-gap";
import type { MetaFieldStatus, MetaColumnState } from "./meta-column";

export type SeoKey = "seo_title" | "seo_description";

/** Same FieldState shape as facts.server.ts, with the one field seo adds. */
export type SeoFieldState = {
  source: "auto" | "human";
  at: string;
  engine?: string;
  /** The value in place before this app ever wrote this field. Set once. */
  prev: string;
};

export type ProductSeoInput = {
  id: string;
  metafields?: { key: string; value: string }[];
  seo?: { title: string | null; description: string | null } | null;
};

/**
 * Does this app own this field right now? Same rule as mayWrite in
 * facts.server.ts, reimplemented against `Product.seo` because the current
 * value does not live in our metafields: a human-written value is never
 * touched, and a non-empty value with no state entry is treated as human -
 * it came from somewhere else (the merchant, a previous SEO app, an import).
 */
export function mayWriteSeo(product: ProductSeoInput, key: SeoKey): boolean {
  const state = parseState({ id: product.id, title: "", metafields: product.metafields });
  const entry = state[key] as SeoFieldState | undefined;
  if (entry?.source === "human") return false;

  const current = key === "seo_title" ? product.seo?.title : product.seo?.description;
  if (current && current !== "" && !entry) return false;

  return true;
}

// --- Products list "Meta" column (SEO-WORKSPACE-PRD §4) ------------------
//
// Four states, derived from the same facts mayWriteSeo already reads - never
// a separate source of truth:
//  - "auto"    written by this app (a state entry, source auto)
//  - "human"   written by a person through this app, then protected
//  - "outside" a non-empty value with no state entry: set by the merchant
//              directly, an import, or a different app - never touched
//  - "missing" empty and available for the SEO queue to propose

export function classifyMetaField(product: ProductSeoInput, key: SeoKey): MetaFieldStatus {
  const state = parseState({ id: product.id, title: "", metafields: product.metafields });
  const entry = state[key] as SeoFieldState | undefined;
  const current = key === "seo_title" ? product.seo?.title : product.seo?.description;
  const hasValue = Boolean(current && current !== "");

  // Live value wins over a stale state entry: an empty field is "missing"
  // even when the state metafield still carries a human or auto marker from
  // before something outside this app's writer cleared it (the merchant's
  // own edit inside this app, Shopify's native search-listing editor, an
  // import - the state entry cannot tell these apart, and only the field's
  // current presence is something this app can actually verify). Checked
  // before "human" on purpose: a badge or count that keeps claiming
  // "Edited by you" over a box with nothing in it is the exact
  // EXPERIENCE-PRD §2 failure ("if we did not fetch it, we do not say").
  if (!hasValue) return "missing";
  if (entry?.source === "human") return "human";
  if (!entry) return "outside";
  return "auto";
}

/** Both fields classified together, so a caller never has to reimplement the pairing. */
export function metaColumnState(product: ProductSeoInput): MetaColumnState {
  return {
    title: classifyMetaField(product, "seo_title"),
    description: classifyMetaField(product, "seo_description"),
  };
}

// Labels, the disagreement rule and the "still needs doing" filter live in
// ./meta-column (no ".server" suffix) - the products list component reads
// them directly, and a value import from a .server file used outside a
// loader/action fails the client build. Re-exported here so existing
// imports of these three names from seo.server keep working.
export {
  META_FIELD_LABEL,
  metaColumnLabel,
  metaColumnMissing,
  type MetaFieldStatus,
  type MetaColumnState,
} from "./meta-column";

// productUpdate's `input: ProductInput` argument was deprecated when Shopify
// split ProductInput in 2024-10; the current documented form (verified on
// shopify.dev, 1 September 2026) is `productUpdate(product: ProductUpdateInput!)`.
const PRODUCT_UPDATE_SEO = `#graphql
  mutation UpdateProductSeo($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`;

const METAFIELDS_SET = `#graphql
  mutation SetSeoState($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

export type SeoField = { value: string; source: "auto" | "human" };

export type WriteSeoOutcome = {
  written: SeoKey[];
  skipped: SeoKey[];
  unchanged: SeoKey[];
};

/**
 * Write one or both seo fields for a product. The Admin API's documented
 * behaviour when only one of `seo.title` / `seo.description` is sent is not
 * settled (SEO-WORKSPACE-PRD §3.1, §9), so this always sends both subfields
 * together, filling the one not being changed with its current live value
 * read from the same product - never depending on the unresolved answer.
 */
export async function writeSeo(
  graphql: GraphqlFn,
  product: ProductSeoInput,
  fields: Partial<Record<SeoKey, SeoField>>,
): Promise<WriteSeoOutcome> {
  const outcome: WriteSeoOutcome = { written: [], skipped: [], unchanged: [] };
  const state = parseState({ id: product.id, title: "", metafields: product.metafields });
  const now = new Date().toISOString();

  const currentTitle = product.seo?.title ?? "";
  const currentDescription = product.seo?.description ?? "";
  let nextTitle = currentTitle;
  let nextDescription = currentDescription;
  let touched = false;

  const keys: SeoKey[] = ["seo_title", "seo_description"];
  for (const key of keys) {
    const field = fields[key];
    if (!field) continue;

    if (!mayWriteSeo(product, key)) {
      outcome.skipped.push(key);
      continue;
    }

    const current = key === "seo_title" ? currentTitle : currentDescription;
    // Never write an identical value - see the file header.
    if (field.value === current) {
      outcome.unchanged.push(key);
      continue;
    }

    const prevEntry = state[key] as SeoFieldState | undefined;
    const nextEntry: SeoFieldState = {
      source: field.source,
      at: now,
      engine: ENGINE_VERSION,
      // Captured only on the first write this app ever makes to this field;
      // later regenerations never overwrite it, so revert always means "as
      // it was before this app touched it" (SEO-WORKSPACE-PRD §3.1).
      prev: prevEntry ? prevEntry.prev : current,
    };
    state[key] = nextEntry as unknown as ProductState[string];

    if (key === "seo_title") nextTitle = field.value;
    else nextDescription = field.value;
    outcome.written.push(key);
    touched = true;
  }

  if (!touched) return outcome;

  const productRes = await graphql<any>(PRODUCT_UPDATE_SEO, {
    product: {
      id: product.id,
      seo: { title: nextTitle, description: nextDescription },
    },
  });
  const errors = productRes?.productUpdate?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`productUpdate (seo): ${JSON.stringify(errors)}`);
  }

  await graphql<any>(METAFIELDS_SET, {
    metafields: [
      {
        ownerId: product.id,
        namespace: NAMESPACE,
        key: "state",
        type: "json",
        value: JSON.stringify(state),
      },
    ],
  });

  return outcome;
}

/**
 * Revert to the value in place before this app ever wrote the field: writes
 * `prev` back through the same mutation and deletes the state entry.
 * Distinct from "reset to automatic", which only clears the human flag so
 * the next pass may regenerate.
 */
export async function revertSeo(
  graphql: GraphqlFn,
  product: ProductSeoInput,
  keys: SeoKey[],
): Promise<SeoKey[]> {
  const state = parseState({ id: product.id, title: "", metafields: product.metafields });
  const currentTitle = product.seo?.title ?? "";
  const currentDescription = product.seo?.description ?? "";
  let nextTitle = currentTitle;
  let nextDescription = currentDescription;
  const reverted: SeoKey[] = [];

  for (const key of keys) {
    const entry = state[key] as SeoFieldState | undefined;
    if (!entry) continue;
    if (key === "seo_title") nextTitle = entry.prev;
    else nextDescription = entry.prev;
    delete state[key];
    reverted.push(key);
  }

  if (reverted.length === 0) return reverted;

  const productRes = await graphql<any>(PRODUCT_UPDATE_SEO, {
    product: {
      id: product.id,
      seo: { title: nextTitle, description: nextDescription },
    },
  });
  const errors = productRes?.productUpdate?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`productUpdate (seo revert): ${JSON.stringify(errors)}`);
  }

  await graphql<any>(METAFIELDS_SET, {
    metafields: [
      {
        ownerId: product.id,
        namespace: NAMESPACE,
        key: "state",
        type: "json",
        value: JSON.stringify(state),
      },
    ],
  });

  return reverted;
}

/** Reset to automatic: drop the human flag, keep `prev`, let the next pass regenerate. */
export function clearSeoHumanFlag(state: ProductState, key: SeoKey): void {
  const entry = state[key] as SeoFieldState | undefined;
  if (entry) state[key] = { ...entry, source: "auto" };
}

// The review-and-apply queue (SEO-WORKSPACE-PRD §3.5). Pure: takes an
// already-fetched catalogue and computes what could be written, writing
// nothing. This is the smallest useful reading of §3.5's build step -
// "for every product whose meta title or meta description is empty and not
// protected, compute the suggestion" - so a product that already carries an
// automatic value from an earlier pass is left alone here; regenerating an
// existing auto value is the product editor's job (its own Generate button),
// not a silent bulk rewrite.

export type SeoQueueProduct = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string | null;
  vendor?: string | null;
  metafields?: { key: string; value: string }[];
  seo?: { title: string | null; description: string | null } | null;
  facts?: Fact[];
};

export type SeoQueueRow = {
  id: string;
  handle: string;
  title: string;
  currentTitle: string;
  currentDescription: string;
  /** null when this field is not proposed for this product. */
  titleSuggestion: string | null;
  descriptionSuggestion: string | null;
};

export type SeoProtectedRow = {
  id: string;
  handle: string;
  title: string;
  field: SeoKey;
  reason: string;
};

export type SeoQueue = {
  checked: number;
  missingTitle: number;
  missingDescription: number;
  /** Non-empty fields with no state entry - set by someone else, never touched. */
  outsideApp: number;
  /**
   * Non-empty fields a person edited by hand inside this app's own editor -
   * distinct from outsideApp (SEO-WORKSPACE-PRD §3.5's "41 have one written
   * outside this app" line must not fold in the merchant's own edits, which
   * the product editor already labels "Edited by you"; the two are protected
   * for different reasons and read differently on screen).
   */
  editedByYou: number;
  rows: SeoQueueRow[];
  protectedRows: SeoProtectedRow[];
  /**
   * The term-gap card's data (dashboard rebuild, 31 Aug 2026): terms found in
   * product descriptions that appear in no title and no meta field, computed
   * over the same catalogue read in the same pass so this never costs a
   * second bulk fetch. Not a keyword tool - see engine/term-gap.ts.
   */
  termGap: TermGapRow[];
};

export function buildSeoQueue(
  products: SeoQueueProduct[],
  shopName: string | null,
  stopwords: Set<string>,
): SeoQueue {
  const rows: SeoQueueRow[] = [];
  const protectedRows: SeoProtectedRow[] = [];
  let missingTitle = 0;
  let missingDescription = 0;
  let outsideApp = 0;
  let editedByYou = 0;

  for (const product of products) {
    const seoLike: ProductSeoInput = {
      id: product.id,
      metafields: product.metafields,
      seo: product.seo ?? null,
    };
    const currentTitle = product.seo?.title ?? "";
    const currentDescription = product.seo?.description ?? "";
    const titleEmpty = currentTitle === "";
    const descriptionEmpty = currentDescription === "";
    const titleWritable = mayWriteSeo(seoLike, "seo_title");
    const descriptionWritable = mayWriteSeo(seoLike, "seo_description");

    if (titleEmpty) missingTitle += 1;
    if (descriptionEmpty) missingDescription += 1;
    // A non-empty, protected field is protected for one of two different
    // reasons, and the count (and the sentence built from it) must not fold
    // them together: classifyMetaField's "outside" is a value with no state
    // entry - set by the merchant directly, an import, or a different app,
    // never touched by this app at all; "human" is a value a person edited
    // by hand inside this app's own editor, which the editor itself labels
    // "Edited by you". Reusing classifyMetaField here rather than a second
    // classification keeps the two counts and the badge in agreement.
    if (!titleEmpty) {
      const titleStatus = classifyMetaField(seoLike, "seo_title");
      if (titleStatus === "outside") outsideApp += 1;
      else if (titleStatus === "human") editedByYou += 1;
    }
    if (!descriptionEmpty) {
      const descriptionStatus = classifyMetaField(seoLike, "seo_description");
      if (descriptionStatus === "outside") outsideApp += 1;
      else if (descriptionStatus === "human") editedByYou += 1;
    }

    if (titleEmpty && !titleWritable) {
      protectedRows.push({
        id: product.id,
        handle: product.handle,
        title: product.title,
        field: "seo_title",
        reason: "Left empty on purpose - edited by you, so bulk passes leave it alone.",
      });
    }
    if (descriptionEmpty && !descriptionWritable) {
      protectedRows.push({
        id: product.id,
        handle: product.handle,
        title: product.title,
        field: "seo_description",
        reason: "Left empty on purpose - edited by you, so bulk passes leave it alone.",
      });
    }

    const canProposeTitle = titleEmpty && titleWritable;
    const canProposeDescription = descriptionEmpty && descriptionWritable;
    if (!canProposeTitle && !canProposeDescription) continue;

    const metaInput: MetaInput = {
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      facts: product.facts ?? [],
      vendor: product.vendor ?? null,
      shopName,
    };

    const titleSuggestion = canProposeTitle ? buildMetaTitle(metaInput) || null : null;
    const descriptionSuggestion = canProposeDescription
      ? buildMetaDescription(metaInput) || null
      : null;
    if (!titleSuggestion && !descriptionSuggestion) continue;

    rows.push({
      id: product.id,
      handle: product.handle,
      title: product.title,
      currentTitle,
      currentDescription,
      titleSuggestion,
      descriptionSuggestion,
    });
  }

  const termGap = computeTermGap(
    products.map((p) => ({
      id: p.id,
      title: p.title,
      descriptionHtml: p.descriptionHtml,
      seoTitle: p.seo?.title ?? null,
      seoDescription: p.seo?.description ?? null,
    })),
    stopwords,
    { limit: 25 },
  );

  return {
    checked: products.length,
    missingTitle,
    missingDescription,
    outsideApp,
    editedByYou,
    rows,
    protectedRows,
    termGap,
  };
}
