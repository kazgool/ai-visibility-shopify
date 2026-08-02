// graphile-worker task list (PHASE-2-SPEC §6).
//
// Jobs are resumable by construction: progress lives in JobRun, and writes are
// idempotent — same input, same output, and the state metafield guards human
// values, so re-running never destroys anything.

import type { Task } from "graphile-worker";
import db from "../app/db.server";
import { extractOneProduct, runBulkExtract } from "../app/services/extract.server";
import { adminGraphql } from "../app/services/admin.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { writeAltText } from "../app/services/alt-text.server";
import { extractProduct } from "../app/engine";
import { dictionaryFor, extraStopwordsFor } from "../app/services/extract.server";

export const bulk_extract: Task = async (payload, helpers) => {
  const { shopId, dryRun = false, jobRunId } = payload as {
    shopId: string;
    dryRun?: boolean;
    jobRunId: string;
  };

  await db.jobRun.update({
    where: { id: jobRunId },
    data: { status: "running", startedAt: new Date() },
  });

  try {
    const report = await runBulkExtract(shopId, {
      dryRun,
      onProgress: async (done, total) => {
        await db.jobRun.update({
          where: { id: jobRunId },
          data: { progress: done, total },
        });
      },
    });

    await db.jobRun.update({
      where: { id: jobRunId },
      data: { status: "done", finishedAt: new Date(), report: report as any },
    });
    helpers.logger.info(
      `bulk_extract ${dryRun ? "(dry run) " : ""}finished for ${shopId}: ` +
        `${report.sampled} products, ${report.none} without facts, ${report.wouldSkip} protected`,
    );
  } catch (error) {
    await db.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        report: { error: String(error) } as any,
      },
    });
    throw error;
  }
};

export const extract_product: Task = async (payload, helpers) => {
  const { shopId, productGid } = payload as { shopId: string; productGid: string };
  const outcome = await extractOneProduct(shopId, productGid);
  helpers.logger.info(
    `extract_product ${productGid}: wrote ${outcome.written.join(",") || "nothing"}` +
      (outcome.skipped.length ? `, skipped ${outcome.skipped.join(",")}` : ""),
  );
};

/**
 * Safety net. Webhook delivery is not guaranteed — Shopify retries, but a
 * failed endpoint or an app restart can still lose one. Once a day we look for
 * products that carry no attributes yet and queue them, so a merchant never
 * discovers months later that half a season is missing.
 *
 * Cheap by design: it reads through one bulk operation and only writes what is
 * genuinely absent.
 */
export const sweep_missing: Task = async (_payload, helpers) => {
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });

  for (const shop of shops) {
    try {
      const graphql = await adminGraphql(shop.domain);
      const dictionary = await dictionaryFor(shop.id);
      const extraStopwords = await extraStopwordsFor(shop.id);
      const products = await fetchAllProducts(graphql);

      const missing = products.filter(
        (p) => !p.metafields?.some((m) => m.key === "facts" && m.value),
      );
      if (missing.length === 0) continue;

      let queued = 0;
      for (const product of missing) {
        // Only bother when the engine actually finds something to write.
        const facts = extractProduct(product, dictionary, { extraStopwords });
        if (facts.length === 0) continue;
        await helpers.addJob(
          "extract_product",
          { shopId: shop.id, productGid: product.id },
          { maxAttempts: 3 },
        );
        queued += 1;
      }

      helpers.logger.info(
        `sweep_missing ${shop.domain}: ${missing.length} without attributes, ${queued} queued`,
      );
    } catch (error) {
      helpers.logger.error(`sweep_missing failed for ${shop.domain}: ${String(error)}`);
    }
  }
};

/**
 * Alt text for the whole catalogue. Separate from extraction because it writes
 * to media, not metafields, and because a merchant may want one without the
 * other.
 */
export const bulk_alt_text: Task = async (payload, helpers) => {
  const { shopId, jobRunId } = payload as { shopId: string; jobRunId: string };

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  await db.jobRun.update({
    where: { id: jobRunId },
    data: { status: "running", startedAt: new Date() },
  });

  try {
    const graphql = await adminGraphql(shop.domain);
    const dictionary = await dictionaryFor(shopId);
    const extraStopwords = await extraStopwordsFor(shopId);
    const products = await fetchAllProducts(graphql);

    // Media shared between products is the trap: the same file inherits the
    // first description written for it. We track ownership across the pass.
    const seenMedia = new Map<string, string>();
    let written = 0;
    let keptHuman = 0;
    const shared: { mediaId: string; alt: string }[] = [];

    await db.jobRun.update({
      where: { id: jobRunId },
      data: { total: products.length },
    });

    for (const [index, product] of products.entries()) {
      const facts = extractProduct(product, dictionary, { extraStopwords });
      const outcome = await writeAltText(graphql, product.id, facts, seenMedia);
      written += outcome.written;
      keptHuman += outcome.keptHuman;
      shared.push(...outcome.sharedFlagged);

      if ((index + 1) % 10 === 0) {
        await db.jobRun.update({
          where: { id: jobRunId },
          data: { progress: index + 1 },
        });
      }
    }

    await db.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: "done",
        finishedAt: new Date(),
        progress: products.length,
        report: { written, keptHuman, shared: shared.slice(0, 50) } as any,
      },
    });
    helpers.logger.info(
      `bulk_alt_text for ${shop.domain}: wrote ${written}, kept ${keptHuman} human, ` +
        `${shared.length} shared-media warnings`,
    );
  } catch (error) {
    await db.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        report: { error: String(error) } as any,
      },
    });
    throw error;
  }
};
