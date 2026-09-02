// Public API of the extraction engine.
//
// Pure functions only: no Shopify, no Prisma, no I/O. That is what makes the
// port testable against the WordPress original (DICTIONARY-PORT §9 exit test).

export {
  extractFromText,
  collidingTerms,
  type Fact,
  type ExtractOptions,
} from "./extract";
export {
  parseDictionary,
  presetText,
  DEFAULT_DICTIONARY,
  PRESETS,
  type DictionaryGroup,
} from "./dictionary";
export type { ProductLike } from "./types";
export {
  buildSummary,
  buildQuestions,
  warrantyWithUnit,
  buildFitFor,
  orderFacts,
  type CapsuleInput,
  type BusinessInfo,
  type QA,
} from "./summary";
export { buildMetaTitle, buildMetaDescription, type MetaInput } from "./meta";
export {
  computeTermGap,
  extractTerms,
  type TermGapProduct,
  type TermGapRow,
} from "./term-gap";
export {
  buildCollectionCapsule,
  buildCollectionSummary,
  buildCollectionCriteria,
  buildCollectionQuestions,
  buildComparisonTable,
  comparableLabels,
  type CollectionInput,
  type CollectionMember,
  type CollectionCapsule,
  type ComparisonTable,
} from "./collection";
export {
  splitFactsByLevel,
  variantFacts,
  varyingOptionNames,
  type VariantLike,
  type SplitResult,
} from "./variants";
export { buildAnswerPreview, type AnswerInput, type AnswerPreview } from "./answer";
export { normalize, prepareText, prepareTextCased, diacriticPattern, cleanOutput } from "./normalize";
export { DEFAULT_STOPWORDS, stopwordSet } from "./stopwords";
export {
  checkCitationReadiness,
  isDescriptiveHandle,
  type CitationCheck,
  type CitationVerdict,
} from "./citation";

import { extractFromText, type ExtractOptions, type Fact } from "./extract";
import { DEFAULT_DICTIONARY } from "./dictionary";
import { prepareText, prepareTextCased } from "./normalize";

/**
 * Extract comparable attributes from a Shopify product.
 * Input is title + description; an empty dictionary falls back to the
 * built-in list (DICTIONARY-PORT §2).
 */
export function extractProduct(
  product: { title: string; descriptionHtml?: string | null },
  dictionaryText: string,
  options: ExtractOptions = {},
): Fact[] {
  const text = prepareText(product.title ?? "", product.descriptionHtml ?? "");
  const casedText = prepareTextCased(product.title ?? "", product.descriptionHtml ?? "");
  const dictionary =
    dictionaryText && dictionaryText.trim() !== "" ? dictionaryText : DEFAULT_DICTIONARY;
  return extractFromText(text, dictionary, { ...options, casedText });
}

/** Coverage report for the dry run (DICTIONARY-PORT §9).
 *
 * `depth` carries one entry per product, in the order the products were
 * given: how many *distinct* attribute families that product produced. Two
 * dimensions on one product are one family, not two, because the question the
 * Report screen asks of this array is "how many different kinds of detail does
 * this product state", and a product stating its width twice has not become
 * twice as readable. The array's length always equals `sampled`, including the
 * products that produced nothing - they are the zeros, and dropping them would
 * silently change the denominator of everything computed from it.
 *
 * Two family tallies come back, and they are different numbers:
 *
 * - `byAttr` counts VALUES, one per extracted fact. A product stating three
 *   dimensions adds three. It has no denominator: it can exceed the number of
 *   products and must never be rendered as a fraction of them.
 * - `byAttrProducts` counts PRODUCTS, one per product per family, using the
 *   same `families` set the depth figure is built from. This is the one that
 *   reads as "Dimensions on 306 of 355" (EXPERIENCE-PRD section 5), because it
 *   is bounded by `sampled`.
 *
 * Both are sorted by their own count, descending, so each is ordered by the
 * quantity it actually states.
 */
export function coverage(
  products: { title: string; descriptionHtml?: string | null }[],
  dictionaryText: string,
  options: ExtractOptions = {},
) {
  const counts: Record<string, number> = {};
  const productCounts: Record<string, number> = {};
  const depth: number[] = [];
  let none = 0;

  for (const product of products) {
    const facts = extractProduct(product, dictionaryText, options);
    if (facts.length === 0) {
      none += 1;
      depth.push(0);
      continue;
    }
    const families = new Set<string>();
    for (const fact of facts) {
      counts[fact.k] = (counts[fact.k] ?? 0) + 1;
      families.add(fact.k);
    }
    for (const family of families) {
      productCounts[family] = (productCounts[family] ?? 0) + 1;
    }
    depth.push(families.size);
  }

  const byAttr = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const byAttrProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]);
  return { sampled: products.length, none, byAttr, byAttrProducts, depth };
}
