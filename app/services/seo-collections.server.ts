// The collections meta writer and check A6 (PRD-SEO-FULL-ONPAGE section 2).
//
// The same condensation the product writer does, applied to a collection's own
// title and description, with the same three guarantees the product side has
// had since SEO-WORKSPACE-PRD:
//
//  - nothing a human wrote is overwritten (`mayWriteSeo`, shared, not copied);
//  - an identical value is never written, because writing marks the collection
//    updated and an update we caused is an update we would react to;
//  - `prev` is captured on the first write this app ever makes to a field, so
//    revert always means "as it was before this app touched it".
//
// It shares more with the product writer than it duplicates, on purpose. The
// classifier (`classifyMetaField`), the protection rule (`mayWriteSeo`) and the
// condensation (`buildMetaTitle` / `buildMetaDescription`) are the same
// functions, because the rule "a non-empty value with no state entry is human"
// is the product's core promise and a second copy of it is a second thing to
// get wrong the next time it is refined. What is genuinely different lives
// here: the mutation is `collectionUpdate`, and a collection has no facts, so
// its meta description condenses its own description text and nothing else.

import type { GraphqlFn } from "./admin.server";
import { buildMetaDescription, buildMetaTitle, type MetaInput } from "../engine/meta";
import { stripTags } from "../engine/normalize";
import { ENGINE_VERSION, NAMESPACE, parseState, type ProductState } from "./facts.server";
import type { CollectionNode } from "./collections.server";
import {
  checkCollectionDescription,
  checkCollectionSize,
  type CollectionCheck,
} from "./seo-catalogue";
import {
  classifyMetaField,
  mayWriteSeo,
  type MetaFieldOwner,
  type MetaFieldStatus,
  type SeoFieldState,
  type SeoKey,
} from "./seo.server";

/**
 * The length budgets for a collection's meta fields.
 *
 * They are the same numbers as the product targets today, and that is a
 * deliberate statement rather than an oversight: Google truncates a title link
 * by the pixel width of the device, not by the type of page behind it (PRD
 * section 5a quotes the wording), so there is no evidence for a different
 * figure and inventing one would be a rule of ours dressed as a rule of
 * Google's. They exist as their own constants because the PRD asked for a
 * collection budget, and because if a reason to differ ever appears it is one
 * line here rather than a second call site to find.
 */
export const COLLECTION_TITLE_TARGET = 60;
export const COLLECTION_DESCRIPTION_TARGET = 160;

const COLLECTION_UPDATE_SEO = `#graphql
  mutation UpdateCollectionSeo($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id }
      userErrors { field message }
    }
  }
`;

const METAFIELDS_SET = `#graphql
  mutation SetCollectionSeoState($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/** The collection's own body text, tags stripped. Empty when it has none. */
export function describedBy(collection: CollectionNode): string {
  return stripTags(collection.descriptionHtml ?? "").replace(/\s+/g, " ").trim();
}

/** A collection reduced to what this module needs. Same shape a product has. */
export function ownerOf(collection: CollectionNode): MetaFieldOwner {
  return {
    id: collection.id,
    metafields: collection.metafields,
    seo: collection.seo ?? null,
  };
}

// --- A6 --------------------------------------------------------------------

/** The three states, per field, for one collection. */
export type CollectionMetaState = { title: MetaFieldStatus; description: MetaFieldStatus };

export function classifyCollection(collection: CollectionNode): CollectionMetaState {
  const owner = ownerOf(collection);
  return {
    title: classifyMetaField(owner, "seo_title"),
    description: classifyMetaField(owner, "seo_description"),
  };
}

/**
 * A6: this collection's meta title or description is absent, so Shopify falls
 * back to a truncation of something else.
 *
 * Exactly what A5 says about a product, over collections, using the same
 * classifier - "missing" there means the field is empty right now, whatever a
 * stale state entry claims.
 */
export type CollectionFinding = {
  id: string;
  handle: string;
  title: string;
  missing: ("title" | "description")[];
};

export function checkCollectionMetaFields(collection: CollectionNode): CollectionFinding | null {
  const state = classifyCollection(collection);
  const missing: ("title" | "description")[] = [];
  if (state.title === "missing") missing.push("title");
  if (state.description === "missing") missing.push("description");
  if (missing.length === 0) return null;
  return {
    id: collection.id,
    handle: collection.handle,
    title: collection.title,
    missing,
  };
}

// --- the review queue ------------------------------------------------------

export type CollectionQueueRow = {
  id: string;
  handle: string;
  title: string;
  currentTitle: string;
  currentDescription: string;
  /** null when this field is not proposed for this collection. */
  titleSuggestion: string | null;
  descriptionSuggestion: string | null;
};

export type CollectionProtectedRow = {
  id: string;
  handle: string;
  title: string;
  field: SeoKey;
  reason: string;
};

export type CollectionSeoQueue = {
  checked: number;
  /** A6: collections with at least one of the two fields absent. */
  withFinding: number;
  missingTitle: number;
  missingDescription: number;
  /** Non-empty fields with no state entry - set by someone else, never touched. */
  outsideApp: number;
  /** Non-empty fields a person edited by hand inside this app. */
  editedByYou: number;
  /** Written by this app on an earlier pass. */
  writtenByApp: number;
  rows: CollectionQueueRow[];
  protectedRows: CollectionProtectedRow[];
  /** Every collection A6 fires on, for the row's link. */
  findings: CollectionFinding[];
  /**
   * A10 and A11 (PRD-SEO-FULL-ONPAGE section 5b), built 4 September 2026.
   *
   * They live on this report and not in the product aggregate because their
   * denominator is `checked` - the collections this pass read - and never the
   * catalogue. A6 has been here for the same reason since it was written: one
   * number quoted under the other's heading is how a count stops meaning
   * anything.
   */
  thinDescription: CollectionCheck[];
  thinMembership: CollectionCheck[];
};

/**
 * What could be written, writing nothing. The same reading of the queue the
 * product side takes: a field that already carries an automatic value from an
 * earlier pass is left alone here, because regenerating an existing auto value
 * is an explicit action and never a silent bulk rewrite.
 */
export function buildCollectionSeoQueue(collections: CollectionNode[]): CollectionSeoQueue {
  const rows: CollectionQueueRow[] = [];
  const protectedRows: CollectionProtectedRow[] = [];
  const findings: CollectionFinding[] = [];
  const thinDescription: CollectionCheck[] = [];
  const thinMembership: CollectionCheck[] = [];
  let missingTitle = 0;
  let missingDescription = 0;
  let outsideApp = 0;
  let editedByYou = 0;
  let writtenByApp = 0;

  for (const collection of collections) {
    const owner = ownerOf(collection);
    const currentTitle = collection.seo?.title ?? "";
    const currentDescription = collection.seo?.description ?? "";
    const titleEmpty = currentTitle === "";
    const descriptionEmpty = currentDescription === "";

    if (titleEmpty) missingTitle += 1;
    if (descriptionEmpty) missingDescription += 1;

    for (const key of ["seo_title", "seo_description"] as SeoKey[]) {
      const status = classifyMetaField(owner, key);
      if (status === "outside") outsideApp += 1;
      else if (status === "human") editedByYou += 1;
      else if (status === "auto") writtenByApp += 1;
    }

    const finding = checkCollectionMetaFields(collection);
    if (finding) findings.push(finding);

    // A10 and A11. Neither is a reason to skip the writer below: a collection
    // with one product and no description still gets a meta title proposed, and
    // whether it should exist at all is the merchant's question, not ours.
    const a10 = checkCollectionDescription(collection);
    if (a10) thinDescription.push(a10);
    const a11 = checkCollectionSize(collection);
    if (a11) thinMembership.push(a11);

    const titleWritable = mayWriteSeo(owner, "seo_title");
    const descriptionWritable = mayWriteSeo(owner, "seo_description");

    if (titleEmpty && !titleWritable) {
      protectedRows.push({
        id: collection.id,
        handle: collection.handle,
        title: collection.title,
        field: "seo_title",
        reason: "Left empty on purpose - edited by you, so bulk passes leave it alone.",
      });
    }
    if (descriptionEmpty && !descriptionWritable) {
      protectedRows.push({
        id: collection.id,
        handle: collection.handle,
        title: collection.title,
        field: "seo_description",
        reason: "Left empty on purpose - edited by you, so bulk passes leave it alone.",
      });
    }

    const canProposeTitle = titleEmpty && titleWritable;
    const canProposeDescription = descriptionEmpty && descriptionWritable;
    if (!canProposeTitle && !canProposeDescription) continue;

    // No facts: a collection has none, so the description is condensed from
    // its own opening sentence alone. `buildMetaDescription` degrades to
    // exactly that when the fact list is empty, so this is the same function
    // and not a variant of it.
    const input: MetaInput = {
      title: collection.title,
      descriptionHtml: collection.descriptionHtml,
      facts: [],
    };

    const titleSuggestion = canProposeTitle
      ? buildMetaTitle(input, COLLECTION_TITLE_TARGET) || null
      : null;

    // A collection with no description of its own gets no description
    // proposal, and this is the line the product draws for itself: the writer
    // condenses the merchant's own words and nothing else. `buildMetaDescription`
    // falls back to the title when there is no body text, which on a product
    // sits beside three attribute clauses and reads as a summary - on a
    // collection with no facts it is the title with a full stop after it, and
    // "Sofas." as the meta description of a collection called Sofas is a
    // duplicate of the meta title, not a description. Found by running this on
    // the dev store, 5 September 2026, where both collections produced exactly
    // that.
    const hasOwnText = describedBy(collection) !== "";
    const descriptionSuggestion =
      canProposeDescription && hasOwnText
        ? buildMetaDescription(input, COLLECTION_DESCRIPTION_TARGET) || null
        : null;
    if (!titleSuggestion && !descriptionSuggestion) continue;

    rows.push({
      id: collection.id,
      handle: collection.handle,
      title: collection.title,
      currentTitle,
      currentDescription,
      titleSuggestion,
      descriptionSuggestion,
    });
  }

  return {
    checked: collections.length,
    withFinding: findings.length,
    missingTitle,
    missingDescription,
    outsideApp,
    editedByYou,
    writtenByApp,
    rows,
    protectedRows,
    findings,
    thinDescription,
    thinMembership,
  };
}

// --- the write -------------------------------------------------------------

export type WriteCollectionSeoOutcome = {
  written: SeoKey[];
  skipped: SeoKey[];
  unchanged: SeoKey[];
};

/**
 * Write one or both seo fields for a collection.
 *
 * Both subfields are always sent together, filled from the collection's own
 * current values where they are not being changed - the same defence
 * `writeSeo` takes on products, for the same unresolved reason: the Admin
 * API's behaviour when only one of `seo.title` / `seo.description` is sent is
 * not documented, and depending on it is depending on something nobody has
 * settled.
 */
export async function writeCollectionSeo(
  graphql: GraphqlFn,
  collection: CollectionNode,
  fields: Partial<Record<SeoKey, { value: string; source: "auto" | "human" }>>,
): Promise<WriteCollectionSeoOutcome> {
  const outcome: WriteCollectionSeoOutcome = { written: [], skipped: [], unchanged: [] };
  const owner = ownerOf(collection);
  const state = parseState({
    id: collection.id,
    title: "",
    metafields: collection.metafields,
  });
  const now = new Date().toISOString();

  const currentTitle = collection.seo?.title ?? "";
  const currentDescription = collection.seo?.description ?? "";
  let nextTitle = currentTitle;
  let nextDescription = currentDescription;
  let touched = false;

  for (const key of ["seo_title", "seo_description"] as SeoKey[]) {
    const field = fields[key];
    if (!field) continue;

    // Guard one: nothing a human wrote is overwritten.
    if (!mayWriteSeo(owner, key)) {
      outcome.skipped.push(key);
      continue;
    }

    // Guard two: never an identical value.
    const current = key === "seo_title" ? currentTitle : currentDescription;
    if (field.value === current) {
      outcome.unchanged.push(key);
      continue;
    }

    const prevEntry = state[key] as SeoFieldState | undefined;
    state[key] = {
      source: field.source,
      at: now,
      engine: ENGINE_VERSION,
      // Captured only on the first write this app ever makes to this field, so
      // revert stays "as it was before this app touched it" however many times
      // the value is regenerated afterwards.
      prev: prevEntry ? prevEntry.prev : current,
    } as unknown as ProductState[string];

    if (key === "seo_title") nextTitle = field.value;
    else nextDescription = field.value;
    outcome.written.push(key);
    touched = true;
  }

  if (!touched) return outcome;

  const data = await graphql<any>(COLLECTION_UPDATE_SEO, {
    input: { id: collection.id, seo: { title: nextTitle, description: nextDescription } },
  });
  const errors = data?.collectionUpdate?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`collectionUpdate (seo): ${JSON.stringify(errors)}`);
  }

  await graphql<any>(METAFIELDS_SET, {
    metafields: [
      {
        ownerId: collection.id,
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
 * Revert to the value in place before this app ever wrote the field, and drop
 * the state entry. The same operation `revertSeo` performs on a product, and
 * distinct from "reset to automatic", which only clears the human flag.
 */
export async function revertCollectionSeo(
  graphql: GraphqlFn,
  collection: CollectionNode,
  keys: SeoKey[],
): Promise<SeoKey[]> {
  const state = parseState({
    id: collection.id,
    title: "",
    metafields: collection.metafields,
  });
  let nextTitle = collection.seo?.title ?? "";
  let nextDescription = collection.seo?.description ?? "";
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

  const data = await graphql<any>(COLLECTION_UPDATE_SEO, {
    input: { id: collection.id, seo: { title: nextTitle, description: nextDescription } },
  });
  const errors = data?.collectionUpdate?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`collectionUpdate (seo revert): ${JSON.stringify(errors)}`);
  }

  await graphql<any>(METAFIELDS_SET, {
    metafields: [
      {
        ownerId: collection.id,
        namespace: NAMESPACE,
        key: "state",
        type: "json",
        value: JSON.stringify(state),
      },
    ],
  });

  return reverted;
}
