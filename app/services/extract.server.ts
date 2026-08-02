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
  type Fact,
} from "../engine";
import type { FieldValue } from "./facts.server";

/**
 * The three companion fields, built from the same facts. Each is written only
 * if it has something honest to say — an empty capsule is worse than none.
 */
function capsuleFields(product: ProductInput, facts: Fact[]): FieldValue[] {
  const input = {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    facts,
    price: product.price ?? null,
    currency: product.currency ?? null,
    available: product.available,
    vendor: product.vendor ?? null,
    productType: product.productType ?? null,
  };

  const summary = buildSummary(input);
  const questions = buildQuestions(input);
  const fitFor = buildFitFor(input);

  const fields: FieldValue[] = [];
  if (summary) fields.push({ key: "summary", type: "multi_line_text_field", value: summary });
  if (questions.length > 0) {
    fields.push({ key: "questions", type: "json", value: JSON.stringify(questions) });
  }
  if (fitFor) {
    fields.push({ key: "fit_for", type: "single_line_text_field", value: fitFor });
  }
  return fields;
}
import { adminGraphql } from "./admin.server";
import { fetchAllProducts, fetchProduct } from "./catalogue.server";
import { mayWrite, writeFacts, type ProductInput } from "./facts.server";
import { renderMirror } from "./mirror.server";

/**
 * Render and store the plain text mirror so the proxy route never has to call
 * the Admin API (ARCHITECTURE §3).
 */
async function cacheMirror(
  shopId: string,
  domain: string,
  product: ProductInput,
  facts: Fact[],
) {
  const handle = product.handle;
  if (!handle) return;

  const body = renderMirror({
    handle,
    title: product.title,
    url: product.onlineStoreUrl ?? `https://${domain}/products/${handle}`,
    description: product.descriptionHtml ?? "",
    facts,
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

  const batch: { product: ProductInput; facts: Fact[] }[] = [];
  let done = 0;

  for (const product of products) {
    const facts = extractProduct(product, dictionary, engineOptions);

    if (!mayWrite(product, "facts")) report.wouldSkip += 1;
    if (report.examples.length < 20 && facts.length > 0) {
      report.examples.push({ title: product.title, facts });
    }

    if (!options.dryRun && facts.length > 0) {
      batch.push({ product, facts, fields: capsuleFields(product, facts) });
      if (batch.length >= 8) {
        await writeFacts(graphql, batch.splice(0));
      }
      await cacheMirror(shopId, shop.domain, product, facts);
    }

    done += 1;
    if (options.onProgress && done % 10 === 0) {
      await options.onProgress(done, products.length);
    }
  }

  if (!options.dryRun && batch.length > 0) {
    await writeFacts(graphql, batch);
  }
  if (options.onProgress) await options.onProgress(products.length, products.length);

  return report;
}

/** One product, queued by the products/update webhook. */
export async function extractOneProduct(shopId: string, productGid: string) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  const graphql = await adminGraphql(shop.domain);
  const product = await fetchProduct(graphql, productGid);
  if (!product) return { written: [], skipped: [] };

  const dictionary = await dictionaryFor(shopId);
  const extraStopwords = await extraStopwordsFor(shopId);
  const facts = extractProduct(product, dictionary, { extraStopwords });
  if (facts.length === 0) return { written: [], skipped: [] };

  const [outcome] = await writeFacts(graphql, [{ product, facts }]);
  return outcome;
}
