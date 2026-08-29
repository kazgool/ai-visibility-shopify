// The pass itself: read catalogue → run engine → write facts (or report).
//
// A dry run writes nothing and produces the report the merchant sees before
// committing (PHASE-2-SPEC §7). It is what makes a bulk write safe to offer.

import db from "../db.server";
import {
  extractProduct,
  coverage,
  buildSummary,
  buildQuestions,
  buildFitFor,
  splitFactsByLevel,
  type Fact,
} from "../engine";
import type { FieldValue } from "./facts.server";

import { adminGraphql } from "./admin.server";
import { pingProducts } from "./indexnow.server";
import { fetchAllProducts, fetchProduct } from "./catalogue.server";
import { mayWrite, writeFacts, writeVariantFacts, type ProductInput } from "./facts.server";
import { renderMirror } from "./mirror.server";
import { businessFor } from "./business.server";
import type { BusinessInfo } from "../engine";

/**
 * The three companion fields, built from the same facts. Each is written only
 * if it has something honest to say — an empty capsule is worse than none.
 */
function capsuleFields(
  product: ProductInput,
  facts: Fact[],
  business: BusinessInfo | null = null,
): FieldValue[] {
  const input = {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    facts,
    price: product.price ?? null,
    currency: product.currency ?? null,
    available: product.available,
    vendor: product.vendor ?? null,
    productType: product.productType ?? null,
    business,
  };

  const summary = buildSummary(input);
  const questions = buildQuestions(input);
  const fitFor = buildFitFor(input);

  // Empties are included on purpose: writeFacts uses them to withdraw a
  // previously auto-written value that is no longer supported.
  return [
    { key: "summary", type: "multi_line_text_field", value: summary },
    { key: "questions", type: "json", value: questions.length > 0 ? JSON.stringify(questions) : "" },
    { key: "fit_for", type: "single_line_text_field", value: fitFor },
  ];
}


/**
 * Render and store the plain text mirror so the proxy route never has to call
 * the Admin API (ARCHITECTURE §3).
 */
async function cacheMirror(
  shopId: string,
  domain: string,
  product: ProductInput,
  facts: Fact[],
  business: BusinessInfo | null = null,
) {
  const handle = product.handle;
  if (!handle) return;

  // One input, three readers: the summary, the questions and the audience line
  // are all derived from it, and the questions need the business answers or
  // they come back without the commercial ones.
  const capsuleInput = {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    facts,
    price: product.price ?? null,
    currency: product.currency ?? null,
    available: product.available,
    vendor: product.vendor ?? null,
    productType: product.productType ?? null,
    business,
  };

  const body = renderMirror({
    handle,
    title: product.title,
    url: product.onlineStoreUrl ?? `https://${domain}/products/${handle}`,
    description: product.descriptionHtml ?? "",
    summary: buildSummary(capsuleInput),
    questions: buildQuestions(capsuleInput),
    fitFor: buildFitFor(capsuleInput),
    business,
    facts,
    price: product.price ?? null,
    currency: product.currency ?? null,
    available: product.available,
    vendor: product.vendor ?? null,
    updatedAt: new Date().toISOString(),
  });

  await db.mirrorCache.upsert({
    where: { shopId_handle: { shopId, handle } },
    create: { shopId, handle, body },
    update: { body },
  });
}

export async function dictionaryFor(shopId: string): Promise<string> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: "dictionary" } },
  });
  return row?.value ?? "";
}

export async function extraStopwordsFor(shopId: string): Promise<string[]> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: "stopwords" } },
  });
  if (!row?.value) return [];
  return row.value.split(/[\n,]/).map((w) => w.trim()).filter(Boolean);
}

export type DryRunReport = {
  sampled: number;
  none: number;
  byAttr: [string, number][];
  wouldSkip: number;
  examples: { title: string; facts: Fact[] }[];
};

export async function runBulkExtract(
  shopId: string,
  options: { dryRun: boolean; onProgress?: (done: number, total: number) => Promise<void> },
): Promise<DryRunReport> {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  const graphql = await adminGraphql(shop.domain);
  const dictionary = await dictionaryFor(shopId);
  const extraStopwords = await extraStopwordsFor(shopId);
  const business = await businessFor(shopId);

  const products = await fetchAllProducts(graphql);
  const engineOptions = { extraStopwords };

  // Publish the total straight away, so the progress bar has a scale before
  // the first batch finishes.
  if (options.onProgress) await options.onProgress(0, products.length);

  const report: DryRunReport = {
    ...coverage(products, dictionary, engineOptions),
    wouldSkip: 0,
    examples: [],
  };

  const batch: { product: ProductInput; facts: Fact[]; fields?: FieldValue[] }[] = [];
  let done = 0;

  // Handle per product id, so IndexNow pings only pages that changed.
  const handleById = new Map<string, string>();
  const changed: string[] = [];

  const flush = async () => {
    const outcomes = await writeFacts(graphql, batch.splice(0));
    for (const o of outcomes) {
      if (o.written.length > 0) {
        const handle = handleById.get(o.productId);
        if (handle) changed.push(handle);
      }
    }
  };

  for (const product of products) {
    const facts = extractProduct(product, dictionary, engineOptions);

    if (!mayWrite(product, "facts")) report.wouldSkip += 1;
    if (report.examples.length < 20 && facts.length > 0) {
      report.examples.push({ title: product.title, facts });
    }

    if (!options.dryRun && facts.length > 0) {
      // Facts the variants contradict move to the variants (PRD §5.4): a
      // description's "culoare: gri" is false for the beige variant.
      const split = splitFactsByLevel(facts, product.variants ?? []);
      if (product.handle) handleById.set(product.id, product.handle);
      if (split.productFacts.length > 0) {
        batch.push({
          product,
          facts: split.productFacts,
          fields: capsuleFields(product, split.productFacts, business),
        });
        if (batch.length >= 8) await flush();
      }
      if (split.perVariant.size > 0) {
        const variantById = new Map((product.variants ?? []).map((v) => [v.id, v]));
        await writeVariantFacts(
          graphql,
          [...split.perVariant.entries()].map(([id, vFacts]) => ({
            variant: variantById.get(id)!,
            facts: vFacts,
          })),
        );
      }
      await cacheMirror(shopId, shop.domain, product, split.productFacts, business);
    }

    done += 1;
    if (options.onProgress && done % 10 === 0) {
      await options.onProgress(done, products.length);
    }
  }

  if (!options.dryRun && batch.length > 0) await flush();
  if (options.onProgress) await options.onProgress(products.length, products.length);

  // Best effort, after the writes: indexing is a bonus, never a failure.
  if (!options.dryRun) await pingProducts(shopId, shop.domain, changed);

  return report;
}

/** One product, queued by the products/update webhook. */
export async function extractOneProduct(shopId: string, productGid: string) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  const graphql = await adminGraphql(shop.domain);
  const product = await fetchProduct(graphql, productGid);
  if (!product) return { written: [], skipped: [], unchanged: [] };

  const dictionary = await dictionaryFor(shopId);
  const extraStopwords = await extraStopwordsFor(shopId);
  const business = await businessFor(shopId);
  const facts = extractProduct(product, dictionary, { extraStopwords });
  if (facts.length === 0) return { written: [], skipped: [], unchanged: [] };

  const split = splitFactsByLevel(facts, product.variants ?? []);
  if (split.perVariant.size > 0) {
    const variantById = new Map((product.variants ?? []).map((v) => [v.id, v]));
    await writeVariantFacts(
      graphql,
      [...split.perVariant.entries()].map(([id, vFacts]) => ({
        variant: variantById.get(id)!,
        facts: vFacts,
      })),
    );
  }
  if (split.productFacts.length === 0) return { written: [], skipped: [], unchanged: [] };

  const [outcome] = await writeFacts(graphql, [
    { product, facts: split.productFacts, fields: capsuleFields(product, split.productFacts, business) },
  ]);
  await cacheMirror(shopId, shop.domain, product, split.productFacts, business);
  if (outcome.written.length > 0 && product.handle) {
    await pingProducts(shopId, shop.domain, [product.handle]);
  }
  return outcome;
}
