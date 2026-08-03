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
  buildFitFor,
  type CapsuleInput,
  type BusinessInfo,
  type QA,
} from "./summary";
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
export { normalize, prepareText, diacriticPattern, cleanOutput } from "./normalize";
export { DEFAULT_STOPWORDS, stopwordSet } from "./stopwords";

import { extractFromText, type ExtractOptions, type Fact } from "./extract";
import { DEFAULT_DICTIONARY } from "./dictionary";
import { prepareText } from "./normalize";

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
  const dictionary =
    dictionaryText && dictionaryText.trim() !== "" ? dictionaryText : DEFAULT_DICTIONARY;
  return extractFromText(text, dictionary, options);
}

/** Coverage report for the dry run (DICTIONARY-PORT §9). */
export function coverage(
  products: { title: string; descriptionHtml?: string | null }[],
  dictionaryText: string,
  options: ExtractOptions = {},
) {
  const counts: Record<string, number> = {};
  let none = 0;

  for (const product of products) {
    const facts = extractProduct(product, dictionaryText, options);
    if (facts.length === 0) {
      none += 1;
      continue;
    }
    for (const fact of facts) counts[fact.k] = (counts[fact.k] ?? 0) + 1;
  }

  const byAttr = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { sampled: products.length, none, byAttr };
}
