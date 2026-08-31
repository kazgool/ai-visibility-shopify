// The term-gap card (SEO dashboard rebuild, 31 Aug 2026): terms that show up
// in a product's own description but never in any product title and never in
// any meta title or meta description across the catalogue.
//
// This is not a keyword tool. There is no search volume, no ranking data and
// no source for either, and inventing them is exactly what EXPERIENCE-PRD §9b
// refuses. Every row is an observation about the merchant's own text: "used
// in 41 descriptions, in no title and no meta field." Nothing here ranks,
// scores or recommends - it only counts.

import { normalize, stripTags } from "./normalize";

export type TermGapProduct = {
  id: string;
  title: string;
  descriptionHtml?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

export type TermGapRow = {
  term: string;
  /** How many products use this term in their description. */
  productCount: number;
};

const MIN_WORD_LENGTH = 2;

/**
 * Unigrams and bounded bigrams from one piece of text.
 *
 * Multi-word terms carry more meaning than single words here - "fara gluten"
 * (gluten free) says more than "gluten" alone - and the merchant's own retail
 * copy routinely pairs a preposition with the word that carries the meaning
 * ("cu spatar", "fara zahar"). Requiring both words in a pair to be
 * non-stopwords would silently drop exactly those phrases, so a bigram is
 * kept whenever at least one side is a real word; only a pair of two
 * stopwords ("cu si") is dropped. This is CLAUDE.md rule 2 applied to
 * tokenising: a filter that removes noise and value together is worse than
 * the noise.
 *
 * Cost is bounded because every position in the text produces at most one
 * unigram and one bigram candidate - a single linear scan per product, never
 * a combinatorial expansion of the vocabulary (no skip-grams, no windows
 * wider than two words).
 */
export function extractTerms(text: string, stopwords: Set<string>): Set<string> {
  const words = normalize(text)
    .split(" ")
    .filter((w) => w.length >= MIN_WORD_LENGTH);
  const terms = new Set<string>();

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!stopwords.has(word)) terms.add(word);

    if (i + 1 < words.length) {
      const next = words[i + 1];
      const bothStopwords = stopwords.has(word) && stopwords.has(next);
      if (!bothStopwords) terms.add(`${word} ${next}`);
    }
  }

  return terms;
}

function descriptionText(product: TermGapProduct): string {
  return stripTags(product.descriptionHtml ?? "");
}

/**
 * Terms present in product descriptions but absent from every product title
 * and every meta title/description in the catalogue.
 *
 * Sorted by how many products use the term, most first; ties broken
 * alphabetically so the output is stable across runs with the same input.
 * `limit` caps how many rows are returned - the card shows the top terms,
 * not the whole vocabulary.
 */
export function computeTermGap(
  products: TermGapProduct[],
  stopwords: Set<string>,
  options: { limit?: number } = {},
): TermGapRow[] {
  const limit = options.limit ?? 50;
  const productCounts = new Map<string, number>();

  for (const product of products) {
    const terms = extractTerms(descriptionText(product), stopwords);
    for (const term of terms) {
      productCounts.set(term, (productCounts.get(term) ?? 0) + 1);
    }
  }

  // Second pass, symmetric with the first: only terms already found in some
  // description are candidates, so title/meta terms are only checked against
  // that (much smaller) set rather than re-scanning every product against
  // every candidate term.
  const titleHits = new Set<string>();
  const metaHits = new Set<string>();
  for (const product of products) {
    for (const term of extractTerms(product.title ?? "", stopwords)) {
      if (productCounts.has(term)) titleHits.add(term);
    }
    const metaText = `${product.seoTitle ?? ""} ${product.seoDescription ?? ""}`;
    for (const term of extractTerms(metaText, stopwords)) {
      if (productCounts.has(term)) metaHits.add(term);
    }
  }

  const rows: TermGapRow[] = [];
  for (const [term, productCount] of productCounts) {
    if (titleHits.has(term) || metaHits.has(term)) continue;
    rows.push({ term, productCount });
  }

  rows.sort((a, b) => b.productCount - a.productCount || a.term.localeCompare(b.term));
  return rows.slice(0, limit);
}
