// Variant-level attributes (PRD §5.4).
//
// The rule: a value found in the shared description belongs to the product;
// a value that maps to a variant option belongs to the variant. The second
// half matters because of a lie the product level cannot avoid: a
// description that says "culoare: gri" on a product sold in grey and beige
// makes the grey variant right and the beige one mislabelled. The option
// values are the merchant's own structured truth - we lift them to facts on
// each variant and withdraw the contradicted label from the product.
//
// Pure: no Shopify, no Prisma, no I/O.

import type { Fact } from "./extract";
import { cleanOutput } from "./normalize";

export type VariantLike = {
  id: string;
  title?: string | null;
  selectedOptions: { name: string; value: string }[];
};

/** Shopify's placeholder for "no real options". */
function isPlaceholder(name: string, value: string): boolean {
  return name === "Title" && value === "Default Title";
}

/** The option pairs of one variant, as facts. */
export function variantFacts(variant: VariantLike): Fact[] {
  return (variant.selectedOptions ?? [])
    .filter((o) => o.name && o.value && !isPlaceholder(o.name, o.value))
    .map((o) => ({ k: cleanOutput(o.name), v: cleanOutput(o.value) }));
}

/**
 * Option names that genuinely vary across the variants (lowercased).
 * An option with a single value across every variant does not distinguish
 * anything and stays a product-level matter.
 */
export function varyingOptionNames(variants: VariantLike[]): Set<string> {
  const values = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const o of variant.selectedOptions ?? []) {
      if (isPlaceholder(o.name, o.value)) continue;
      const key = o.name.trim().toLowerCase();
      if (!values.has(key)) values.set(key, new Set());
      values.get(key)!.add(o.value.trim().toLowerCase());
    }
  }
  return new Set(
    [...values.entries()].filter(([, v]) => v.size > 1).map(([k]) => k),
  );
}

export type SplitResult = {
  /** Product-level facts, minus labels the variants contradict. */
  productFacts: Fact[];
  /** Facts to write on each variant, keyed by variant id. */
  perVariant: Map<string, Fact[]>;
  /** Labels withdrawn from the product, for reporting. */
  movedLabels: string[];
};

/**
 * Decide the level of every fact. Extraction still reads only the shared
 * description; this step reconciles its findings with the variant options.
 */
export function splitFactsByLevel(
  extracted: Fact[],
  variants: VariantLike[],
): SplitResult {
  const varying = varyingOptionNames(variants);

  // Nothing varies: single-variant product, or options that are all one
  // value. Everything stays on the product; no variant writes.
  if (varying.size === 0) {
    return { productFacts: extracted, perVariant: new Map(), movedLabels: [] };
  }

  const productFacts: Fact[] = [];
  const movedLabels: string[] = [];
  for (const fact of extracted) {
    if (varying.has(fact.k.trim().toLowerCase())) {
      // The description states one value; the variants hold several. The
      // product-level claim is wrong for every variant but one, so it moves
      // down rather than staying up and lying.
      if (!movedLabels.includes(fact.k)) movedLabels.push(fact.k);
      continue;
    }
    productFacts.push(fact);
  }

  const perVariant = new Map<string, Fact[]>();
  for (const variant of variants) {
    const facts = variantFacts(variant);
    if (facts.length > 0) perVariant.set(variant.id, facts);
  }

  return { productFacts, perVariant, movedLabels };
}
