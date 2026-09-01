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
import {
  fetchAllProducts,
  fetchProduct,
  fetchShopInfo,
  saveShopInfo,
  type ShopInfo,
} from "./catalogue.server";
import {
  mayWrite,
  writeFacts,
  writeVariantFacts,
  isEligibleForMirror,
  parseState,
  type ProductInput,
} from "./facts.server";
import { renderMirror } from "./mirror.server";
import { businessFor, type BusinessRecord } from "./business.server";
import { formatPrice } from "./price.server";
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
    price: formatPrice(product.price),
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
  // BusinessRecord, not BusinessInfo: the mirror's Store section needs the
  // official profile URLs, which live on the record rather than on the
  // commercial answers the engine reads.
  business: BusinessRecord | null = null,
  shopInfo: ShopInfo | null = null,
) {
  const handle = product.handle;
  if (!handle) return;

  // One input, three readers: the summary, the questions and the audience line
  // are all derived from it, and the questions need the business answers or
  // they come back without the commercial ones. Formatted once, here, so the
  // mirror, the summary sentence and the "how much" answer all agree.
  const price = formatPrice(product.price);
  const capsuleInput = {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    facts,
    price,
    currency: product.currency ?? null,
    available: product.available,
    vendor: product.vendor ?? null,
    productType: product.productType ?? null,
    business,
  };

  // The mirror body must carry the store's public domain, not the
  // .myshopify.com one the session holds - the same rule the proxy's
  // canonical header and IndexNow already follow. shopInfo.url is the
  // primary domain when extraction has fetched it; the session domain is
  // only the fallback for a shop that has never completed a pass.
  const publicBase = shopInfo?.url ?? `https://${domain}`;

  const body = renderMirror({
    handle,
    title: product.title,
    url: product.onlineStoreUrl ?? `${publicBase}/products/${handle}`,
    description: product.descriptionHtml ?? "",
    summary: buildSummary(capsuleInput),
    questions: buildQuestions(capsuleInput),
    fitFor: buildFitFor(capsuleInput),
    business,
    facts,
    price,
    currency: product.currency ?? null,
    available: product.available,
    vendor: product.vendor ?? null,
    sku: product.sku ?? null,
    imageUrl: product.imageUrl ?? null,
    imageAlt: product.imageAlt ?? null,
    productType: product.productType ?? null,
    category: product.category ?? null,
    updatedAt: new Date().toISOString(),
    store: shopInfo
      ? { name: shopInfo.name, url: shopInfo.url, profiles: business?.socialProfiles ?? null }
      : null,
    collections: (product.collections ?? []).map((c) => ({
      title: c.title,
      url: `${publicBase}/collections/${c.handle}`,
    })),
  });

  await db.mirrorCache.upsert({
    where: { shopId_handle: { shopId, handle } },
    create: { shopId, handle, productId: product.id, body },
    update: { body, productId: product.id },
  });
}

/**
 * Remove a stale MirrorCache row before it can keep serving publicly: either
 * the product's handle changed since we last cached it (renamed product,
 * this shop's row is now keyed to a URL nobody links to any more) or the
 * product left the published state entirely (fix: draft/unpublished
 * products must not stay mirrored or listed in llms.txt). Looked up by
 * product id, which both the products/update and products/delete webhooks
 * carry reliably, rather than by handle, which can be stale on both.
 */
async function dropStaleMirror(
  shopId: string,
  productId: string,
  currentHandle: string | null,
  isPublished: boolean,
): Promise<void> {
  let existing = await db.mirrorCache.findFirst({
    where: { shopId, productId },
  });

  // Rows written before the productId column existed have NULL there, and a
  // NULL row never matches the lookup above - so a pre-migration mirror
  // would survive its product's unpublishing or deletion forever. The
  // products/update webhook (which calls this) carries both id and handle,
  // so when no row matched by id, any row with this product's current
  // handle and no productId is adopted here: its productId is set, and from
  // then on the row behaves like any post-migration row, including being
  // deletable by products/delete. Rows whose product died before the
  // migration are caught by the weekly cleanup in sweep_missing instead.
  if (!existing && currentHandle) {
    const orphan = await db.mirrorCache.findUnique({
      where: { shopId_handle: { shopId, handle: currentHandle } },
    });
    if (orphan && orphan.productId === null) {
      existing = await db.mirrorCache.update({
        where: { id: orphan.id },
        data: { productId },
      });
    }
  }

  if (!existing) return;
  if (!isPublished || existing.handle !== currentHandle) {
    await db.mirrorCache.delete({ where: { id: existing.id } });
  }
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

// Fixed the same way the webhook path (extractOneProduct) already was: a
// product whose description no longer yields anything must still flow
// through writeFacts, because writeFacts's withdrawal branch (not this
// function) is what retracts stale auto-written facts/summary/questions/
// fit_for. The check below is only about cost - deciding whether a
// zero-fact product is worth pushing into the batch write path at all -
// answered from `product.metafields`, already fetched by fetchAllProducts,
// so this adds no new Admin API reads.
const WITHDRAWABLE_KEYS = ["facts", "summary", "questions", "fit_for"] as const;

export function hasWithdrawableAutoValues(product: ProductInput): boolean {
  const state = parseState(product);
  return WITHDRAWABLE_KEYS.some((key) => {
    const value = product.metafields?.find((m) => m.key === key)?.value;
    if (!value || value === "" || value === "[]" || value === "{}") return false;
    return state[key]?.source === "auto";
  });
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
  // Site-wide, so fetched once for the whole pass rather than per product.
  // Persisted to Setting so llmsTxtBody can read the shop name without an
  // Admin API call on the request path (ARCHITECTURE §3).
  const shopInfo = options.dryRun ? null : await fetchShopInfo(graphql);
  if (shopInfo) await saveShopInfo(shopId, shopInfo);

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

    // Fix: previously guarded by `facts.length > 0` alone, so a full re-run
    // over a product whose description no longer yields anything skipped
    // writeFacts entirely and never withdrew stale auto values - the same
    // bug already fixed on the webhook path (extractOneProduct). Widened to
    // also enter when this product has something written to withdraw,
    // checked from metafields already in hand (hasWithdrawableAutoValues),
    // so a product with genuinely nothing ever written and nothing found
    // now still costs nothing extra.
    if (!options.dryRun && (facts.length > 0 || hasWithdrawableAutoValues(product))) {
      // Facts the variants contradict move to the variants (PRD §5.4): a
      // description's "culoare: gri" is false for the beige variant.
      const split = splitFactsByLevel(facts, product.variants ?? []);
      if (product.handle) handleById.set(product.id, product.handle);
      // Push into the product-level write when there is something to write
      // (productFacts) OR something already written to withdraw. The old
      // `facts.length === 0` form missed the all-variant-level case: a
      // product whose facts all moved to variants has empty productFacts
      // but nonempty facts, so writeFacts never ran, stale product-level
      // auto values were never withdrawn, and cacheMirror below (which did
      // run) diverged from the metafields. A product with empty
      // productFacts and nothing withdrawable is still never pushed - the
      // no-op stays free.
      if (split.productFacts.length > 0 || hasWithdrawableAutoValues(product)) {
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
      // The bulk fetch path (fetchAllProducts) filters eligibility at the
      // query level and never returns an ineligible product, so - unlike
      // extractOneProduct - there is no dropStaleMirror branch needed here;
      // every product reaching this point is mirror-eligible.
      await cacheMirror(shopId, shop.domain, product, split.productFacts, business, shopInfo);
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

/** One product, queued by the products/create and products/update webhooks. */
export async function extractOneProduct(shopId: string, productGid: string) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  const empty = { written: [], skipped: [], unchanged: [], removed: [] };

  const graphql = await adminGraphql(shop.domain);
  const product = await fetchProduct(graphql, productGid);
  if (!product) return empty;

  // Only ACTIVE products published to the Online Store are eligible for the
  // public mirror and llms.txt. A draft, an archived product, or one active
  // but not published to any channel is not (fix: these were leaking to the
  // proxy and the index). Extracted facts/summary/questions are still
  // written to metafields either way - they render nowhere on an
  // unpublished product and are harmless there.
  const isPublished = isEligibleForMirror(product);
  await dropStaleMirror(shopId, product.id, product.handle ?? null, isPublished);

  const dictionary = await dictionaryFor(shopId);
  const extraStopwords = await extraStopwordsFor(shopId);
  const business = await businessFor(shopId);
  const shopInfo = isPublished ? await fetchShopInfo(graphql) : null;
  if (shopInfo) await saveShopInfo(shopId, shopInfo);
  const facts = extractProduct(product, dictionary, { extraStopwords });

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

  // The write always happens, even when this pass found nothing to say.
  // That emptiness is exactly what writeFacts's withdrawal branch is for:
  // a merchant who rewrites a description to remove the extractable content
  // must have the stale facts, summary, questions and fit_for retracted,
  // not left publishing forever because this path returned early before
  // ever calling writeFacts (the bug). Human-written values are never
  // touched - writeFacts guards every field on its own provenance.
  const [outcome] = await writeFacts(graphql, [
    {
      product,
      facts: split.productFacts,
      fields: capsuleFields(product, split.productFacts, business),
    },
  ]);

  if (isPublished) {
    await cacheMirror(shopId, shop.domain, product, split.productFacts, business, shopInfo);
    if (outcome.written.length > 0 && product.handle) {
      await pingProducts(shopId, shop.domain, [product.handle]);
    }
  }

  return outcome;
}
