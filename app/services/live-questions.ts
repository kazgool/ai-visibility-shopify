// The buyer questions the live site publishes (CC-PROMPT-AI-READABILITY-4
// item 4c): buildFaq with the sources that met the 1% bar - the shop's own
// mappings, the preset's templates, a product's options, a brand that is not
// the shop's, and the business record. The questions metafield (which the
// storefront's FAQPage reads), the plain-text page and llms.txt (built from
// the plain-text pages) all take this one list.
//
// Pure, and not a .server module, so it is tested without the environment a
// .server import needs.

import type { BusinessInfo, Fact, Language } from "../engine";
import { buildFaq, liveFaqSources, type FaqMappings, type FaqOption } from "../engine/faq";

export type QA = { q: string; a: string };

/** What a pass knows once for every product. */
export type LiveQuestionContext = {
  business: BusinessInfo | null;
  language: Language;
  presetId: string | null;
  mappings: FaqMappings | null;
  cap: number | null;
  shopName: string | null;
};

type ProductLike = {
  title: string;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  variants?: { selectedOptions: { name: string; value: string }[] }[];
};

/** A product's options with their values, in the order the variants give them. */
export function optionsOf(variants: ProductLike["variants"]): FaqOption[] {
  const byName = new Map<string, string[]>();
  for (const variant of variants ?? []) {
    for (const option of variant.selectedOptions ?? []) {
      const values = byName.get(option.name) ?? [];
      if (!values.includes(option.value)) values.push(option.value);
      byName.set(option.name, values);
    }
  }
  return [...byName.entries()].map(([name, values]) => ({ name, values }));
}

export function liveQuestions(product: ProductLike, facts: Fact[], ctx: LiveQuestionContext): QA[] {
  return buildFaq({
    title: product.title,
    descriptionHtml: product.descriptionHtml ?? null,
    facts,
    options: optionsOf(product.variants),
    vendor: product.vendor ?? null,
    productType: product.productType ?? null,
    business: ctx.business,
    language: ctx.language,
    presetId: ctx.presetId,
    mappings: ctx.mappings,
    cap: ctx.cap,
    shopName: ctx.shopName,
    sources: liveFaqSources(),
  }).map(({ q, a }) => ({ q, a }));
}

/**
 * Which fields a catalogue pass writes for one product. With facts, a
 * conversion to write or something of ours to withdraw: all of them, as
 * before. With none of those: the questions alone, when there are any - a
 * product's options, its brand and the business record answer questions
 * without a single fact, and until now such a product got nothing at all
 * from the pass. The summary and who it suits stay unwritten there, as they
 * were. Null: nothing to write.
 */
export function fieldsToWrite<T extends { key: string; value: string }>(
  fields: T[],
  product: { facts: number; migrated: boolean; withdrawable: boolean },
): T[] | null {
  if (product.facts > 0 || product.migrated || product.withdrawable) return fields;
  const questions = fields.filter((f) => f.key === "questions" && f.value !== "");
  return questions.length > 0 ? questions : null;
}
