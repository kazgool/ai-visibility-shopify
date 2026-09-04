// The bulk pass for meta title and meta description (SEO-WORKSPACE-PRD §3.5).
//
// Two halves, matching runBulkExtract's dry-run/write split in shape:
//  - runSeoQueueBuild reads the whole catalogue and computes what could be
//    written, writing nothing (build order step 4's "review" half).
//  - runSeoApply writes only the operator-approved rows, through the same
//    seo.server.ts writer the product editor card uses, re-reading each
//    product immediately before its write - the queue snapshot can be
//    minutes old, and the write-time check must win (§3.5, §7).

import db from "../db.server";
import { adminGraphql } from "./admin.server";
import { fetchAllProducts, fetchProduct, fetchShopInfo } from "./catalogue.server";
import { catalogueQuery } from "./eligibility";
import { prefsFor } from "./eligibility.server";
import { dictionaryFor, extraStopwordsFor } from "./extract.server";
import { extractProduct, stopwordSet, type Fact } from "../engine";
import { isSeoUnlocked, mayProcessAutomatically } from "./billing.server";
import { computeSourceA } from "./seo-scan.server";
import { fetchCollections } from "./collections.server";
import {
  buildCollectionSeoQueue,
  writeCollectionSeo,
  type CollectionSeoQueue,
} from "./seo-collections.server";
import {
  buildSeoQueue,
  writeSeo,
  type SeoKey,
  type SeoQueue,
  type SeoQueueProduct,
} from "./seo.server";

export async function runSeoQueueBuild(
  shopId: string,
  options: { onProgress?: (done: number, total: number) => Promise<void> } = {},
): Promise<SeoQueue> {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  const graphql = await adminGraphql(shop.domain);
  const dictionary = await dictionaryFor(shopId);
  const extraStopwords = await extraStopwordsFor(shopId);
  const shopInfo = await fetchShopInfo(graphql);

  // The same set the catalogue pass reads, so an unlisted product gets SEO
  // fields only when the merchant included unlisted products.
  const catalogue = await fetchAllProducts(graphql, catalogueQuery(await prefsFor(shopId)));
  const products = catalogue.products;

  // Source A of the per-product SEO scan, on the read already in hand
  // (PRD-SEO-PER-PRODUCT build step 2). This pass only ever runs behind the
  // SEO key, so it always computes; every other catalogue pass does the same
  // where the key is present.
  await computeSourceA(shopId, graphql, catalogue);

  if (options.onProgress) await options.onProgress(0, products.length);

  const queueProducts: SeoQueueProduct[] = [];
  let done = 0;

  for (const product of products) {
    // Same "stored, else auto" fallback the product editor uses: an
    // already-extracted set of facts is preferred over recomputing it, and
    // recomputation only happens when nothing is stored yet.
    const stored = product.metafields?.find((m) => m.key === "facts")?.value;
    let facts: Fact[] = [];
    if (stored) {
      try {
        facts = JSON.parse(stored) as Fact[];
      } catch {
        facts = [];
      }
    }
    if (facts.length === 0) {
      facts = extractProduct(product, dictionary, { extraStopwords });
    }

    queueProducts.push({
      id: product.id,
      handle: product.handle ?? "",
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      vendor: product.vendor ?? null,
      metafields: product.metafields,
      seo: product.seo ?? null,
      facts,
    });

    done += 1;
    if (options.onProgress && done % 200 === 0) {
      await options.onProgress(done, products.length);
    }
  }

  if (options.onProgress) await options.onProgress(products.length, products.length);

  return buildSeoQueue(queueProducts, shopInfo?.name ?? null, stopwordSet(extraStopwords));
}

export type SeoApplyItem = { productId: string; field: SeoKey; value: string };

export type SeoApplyReport = {
  requested: number;
  written: number;
  skipped: number;
  unchanged: number;
  /** True when seo_unlocked was off, or no paid access, at execution time - nothing was touched. */
  refused: boolean;
  /** Set when refused, naming the actual cause - read by the SEO screen instead of a generic message. */
  reason?: string;
};

/**
 * Apply the operator-approved rows. Sequential, one product at a time:
 * `productUpdate` has no bulk form for distinct per-product values (unlike
 * `metafieldsSet`, which `writeFacts` batches up to 24 entries per call), so
 * each product costs its own `productUpdate` plus a `metafieldsSet` for
 * state. Pacing comes from the shared throttled admin client
 * (`admin.server.ts`), which already backs off from the cost extensions
 * Shopify returns on every response - the same protection every other bulk
 * writer in this app relies on, not a new mechanism invented here.
 */
export async function runSeoApply(
  shopId: string,
  items: SeoApplyItem[],
  options: { onProgress?: (done: number, total: number) => Promise<void> } = {},
): Promise<SeoApplyReport> {
  const report: SeoApplyReport = {
    requested: items.length,
    written: 0,
    skipped: 0,
    unchanged: 0,
    refused: false,
  };

  // ENTITLEMENT: re-checked here, not only where the job was enqueued. A job
  // queued while unlocked but executed after the key is removed must refuse
  // and touch nothing (SEO-WORKSPACE-PRD §7) - this is the check that closes
  // the exact hole `poll_changes` and `sweep_missing` had before today.
  if (!(await isSeoUnlocked(shopId))) {
    report.refused = true;
    report.reason = "The SEO module was switched off for this shop before this write ran. Nothing was written.";
    return report;
  }

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);
  const graphql = await adminGraphql(shop.domain);

  // Marius's ruling, 31 Aug 2026: seo_unlocked being on is not enough for a
  // write path - a shop with no active subscription (and no comp) may not
  // write here either, the same rule poll_changes and sweep_missing already
  // enforce for automatic freshness. mayProcessAutomatically is the
  // authoritative, live-checked form; this job already has an admin client,
  // so the cost is one extra Admin API call per apply, not per product.
  if (!(await mayProcessAutomatically(shop, graphql))) {
    report.refused = true;
    report.reason = "This shop has no active subscription, so writes are not available. Nothing was written.";
    return report;
  }

  const byProduct = new Map<string, SeoApplyItem[]>();
  for (const item of items) {
    const list = byProduct.get(item.productId) ?? [];
    list.push(item);
    byProduct.set(item.productId, list);
  }

  let done = 0;
  const total = byProduct.size;
  if (options.onProgress) await options.onProgress(0, total);

  for (const [productId, productItems] of byProduct) {
    // Fresh read, immediately before the write: the queue may have been
    // built minutes or hours ago, so mayWriteSeo and the unchanged guard
    // inside writeSeo run against what the product looks like right now.
    const fresh = await fetchProduct(graphql, productId);
    if (fresh) {
      const fields: Partial<Record<SeoKey, { value: string; source: "auto" }>> = {};
      for (const item of productItems) {
        fields[item.field] = { value: item.value, source: "auto" };
      }
      const outcome = await writeSeo(graphql, fresh, fields);
      report.written += outcome.written.length;
      report.skipped += outcome.skipped.length;
      report.unchanged += outcome.unchanged.length;
    } else {
      // Product gone (deleted between build and apply) - nothing to write.
      report.skipped += productItems.length;
    }

    done += 1;
    if (options.onProgress && done % 10 === 0) {
      await options.onProgress(done, total);
    }
  }

  if (options.onProgress) await options.onProgress(total, total);
  return report;
}

// --- collections (PRD-SEO-FULL-ONPAGE section 2) ---------------------------
//
// The same two halves as the product pass above, against collections. A
// separate JobRun kind rather than a second half of `seo_queue`, so pressing
// Preview on the products tab does not pay for a collections read and vice
// versa, and so each tab's report says what it is about.

/**
 * Read every collection and compute what could be written, writing nothing.
 * The report also carries check A6, because it is the same read: a collection
 * whose meta title or description is absent is exactly a collection this queue
 * has a suggestion for, and computing the two separately would mean two reads
 * that could disagree.
 */
export async function runCollectionSeoQueueBuild(
  shopId: string,
  options: { onProgress?: (done: number, total: number) => Promise<void> } = {},
): Promise<CollectionSeoQueue> {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  const graphql = await adminGraphql(shop.domain);
  // Members are not needed to read a collection's own meta fields, and asking
  // for 60 of them per collection would be a much larger read for nothing.
  const collections = await fetchCollections(graphql, 1);
  if (options.onProgress) await options.onProgress(collections.length, collections.length);

  return buildCollectionSeoQueue(collections);
}

export type CollectionSeoApplyItem = { collectionId: string; field: SeoKey; value: string };

export type CollectionSeoApplyReport = {
  requested: number;
  written: number;
  skipped: number;
  unchanged: number;
  refused: boolean;
  reason?: string;
};

/**
 * Apply the operator-approved collection rows.
 *
 * Re-reads the collections immediately before writing, for the reason the
 * product apply re-reads each product: the queue may be hours old, and both
 * guards - human protection and the identical-value check - have to run
 * against what the collection looks like now, not what it looked like when the
 * operator pressed Preview.
 */
export async function runCollectionSeoApply(
  shopId: string,
  items: CollectionSeoApplyItem[],
  options: { onProgress?: (done: number, total: number) => Promise<void> } = {},
): Promise<CollectionSeoApplyReport> {
  const report: CollectionSeoApplyReport = {
    requested: items.length,
    written: 0,
    skipped: 0,
    unchanged: 0,
    refused: false,
  };

  // ENTITLEMENT, both halves, re-checked at execution time and not only where
  // the job was enqueued - the same rule runSeoApply follows.
  if (!(await isSeoUnlocked(shopId))) {
    report.refused = true;
    report.reason =
      "The SEO module was switched off for this shop before this write ran. Nothing was written.";
    return report;
  }

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);
  const graphql = await adminGraphql(shop.domain);

  if (!(await mayProcessAutomatically(shop, graphql))) {
    report.refused = true;
    report.reason =
      "This shop has no active subscription, so writes are not available. Nothing was written.";
    return report;
  }

  const byId = new Map<string, CollectionSeoApplyItem[]>();
  for (const item of items) {
    const list = byId.get(item.collectionId) ?? [];
    list.push(item);
    byId.set(item.collectionId, list);
  }

  const fresh = await fetchCollections(graphql, 1);
  const freshById = new Map(fresh.map((c) => [c.id, c]));

  let done = 0;
  const total = byId.size;
  if (options.onProgress) await options.onProgress(0, total);

  for (const [collectionId, collectionItems] of byId) {
    const collection = freshById.get(collectionId);
    if (!collection) {
      // Deleted between build and apply. Nothing to write, and nothing to say
      // about a collection that no longer exists.
      report.skipped += collectionItems.length;
    } else {
      const fields: Partial<Record<SeoKey, { value: string; source: "auto" }>> = {};
      for (const item of collectionItems) {
        fields[item.field] = { value: item.value, source: "auto" };
      }
      const outcome = await writeCollectionSeo(graphql, collection, fields);
      report.written += outcome.written.length;
      report.skipped += outcome.skipped.length;
      report.unchanged += outcome.unchanged.length;
    }

    done += 1;
    if (options.onProgress && done % 10 === 0) await options.onProgress(done, total);
  }

  if (options.onProgress) await options.onProgress(total, total);
  return report;
}
