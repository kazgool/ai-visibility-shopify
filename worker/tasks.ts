// graphile-worker task list (PHASE-2-SPEC §6).
//
// Jobs are resumable by construction: progress lives in JobRun, and writes are
// idempotent — same input, same output, and the state metafield guards human
// values, so re-running never destroys anything.

import type { Task } from "graphile-worker";
import db from "../app/db.server";
import { extractOneProduct, runBulkExtract } from "../app/services/extract.server";
import { adminGraphql } from "../app/services/admin.server";
import { fetchCollections, writeCollections } from "../app/services/collections.server";
import { pingCollections } from "../app/services/indexnow.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { writeAltText } from "../app/services/alt-text.server";
import { extractProduct } from "../app/engine";
import { runCrawlerCheck } from "../app/services/crawler-check.server";
import { dictionaryFor, extraStopwordsFor } from "../app/services/extract.server";

/**
 * A bulk pass updates most of the catalogue, which makes every product look
 * "recently changed" to the incremental poll — which would then queue a no-op
 * job per product. Advancing the poll cursor after our own mass writes keeps
 * layer two focused on what merchants change, not on what we just did.
 */
async function advancePollCursor(shopId: string) {
  const key = "last_polled_at";
  const value = new Date().toISOString();
  await db.setting.upsert({
    where: { shopId_key: { shopId, key } },
    create: { shopId, key, value },
    update: { value },
  });
}

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

    if (!dryRun) await advancePollCursor(shopId);

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

const FIRST_ONLINE_PRODUCT = `#graphql
  query FirstOnlineProduct {
    products(first: 1, query: "published_status:published") {
      nodes { onlineStoreUrl }
    }
  }
`;

/**
 * Ask the storefront, from outside, whether each AI crawler can read it.
 * Runs on the worker because five agents with a retry each can take half a
 * minute, and no admin request should wait that long (PRD §5.2).
 */
export const crawler_check: Task = async (payload, helpers) => {
  const { shopId, jobRunId } = payload as { shopId: string; jobRunId?: string };

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  if (jobRunId) {
    await db.jobRun.update({
      where: { id: jobRunId },
      data: { status: "running", startedAt: new Date(), total: 5 },
    });
  }

  try {
    const graphql = await adminGraphql(shop.domain);
    const data = await graphql<any>(FIRST_ONLINE_PRODUCT);
    const url =
      data?.products?.nodes?.[0]?.onlineStoreUrl ?? `https://${shop.domain}`;

    const result = await runCrawlerCheck(shopId, url);

    if (jobRunId) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: "done",
          finishedAt: new Date(),
          progress: 5,
          report: result as any,
        },
      });
    }
    helpers.logger.info(
      `crawler_check ${shop.domain}: ` +
        result.results.map((r) => `${r.agent}=${r.cause}`).join(" "),
    );
  } catch (error) {
    if (jobRunId) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          report: { error: String(error) } as any,
        },
      });
    }
    throw error;
  }
};

const PRODUCTS_SINCE = `#graphql
  query ProductsSince($query: String!, $cursor: String) {
    products(first: 100, after: $cursor, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { id updatedAt }
    }
  }
`;

/**
 * Layer two of freshness (layer one is webhooks, layer three is the weekly
 * reconciliation below).
 *
 * Every fifteen minutes we ask Shopify which products changed since we last
 * looked. This is cheap — one paginated query, no bulk operation — and it
 * closes the window when a webhook is dropped, delayed, or lost during a
 * deploy. Processing something twice is harmless: extraction is idempotent and
 * the state metafield protects human values.
 */
export const poll_changes: Task = async (_payload, helpers) => {
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });

  for (const shop of shops) {
    const key = "last_polled_at";
    const setting = await db.setting.findUnique({
      where: { shopId_key: { shopId: shop.id, key } },
    });

    // First run: look back an hour rather than replaying the whole catalogue.
    const since = setting?.value ?? new Date(Date.now() - 3600_000).toISOString();
    const startedAt = new Date().toISOString();

    try {
      const graphql = await adminGraphql(shop.domain);
      let cursor: string | null = null;
      let queued = 0;

      do {
        const data: any = await graphql(PRODUCTS_SINCE, {
          query: `updated_at:>'${since}'`,
          cursor,
        });
        const page = data?.products;
        if (!page) break;

        for (const node of page.nodes ?? []) {
          await helpers.addJob(
            "extract_product",
            { shopId: shop.id, productGid: node.id },
            { maxAttempts: 3, jobKey: `extract:${node.id}` },
          );
          queued += 1;
        }

        cursor = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);

      await db.setting.upsert({
        where: { shopId_key: { shopId: shop.id, key } },
        create: { shopId: shop.id, key, value: startedAt },
        update: { value: startedAt },
      });

      if (queued > 0) {
        helpers.logger.info(`poll_changes ${shop.domain}: queued ${queued} changed products`);
      }
    } catch (error) {
      // Do not advance the cursor on failure: the next run retries the window.
      helpers.logger.error(`poll_changes failed for ${shop.domain}: ${String(error)}`);
    }
  }
};

/**
 * Layer three. Webhook delivery is not guaranteed — Shopify retries, but a
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

    // Media updates also mark products as changed; same storm, same cursor fix.
    if (written > 0) await advancePollCursor(shopId);

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

/**
 * Collection capsules (PRD §4.8). Reads each collection with its members'
 * already-extracted attributes and publishes the listing-page answer: what
 * kinds exist, how to choose, and a comparison table.
 *
 * Deliberately a separate pass from product extraction: it depends on the
 * products' `facts` being written first, and re-running it is cheap.
 */
export const bulk_collections: Task = async (payload, helpers) => {
  const { shopId, jobRunId } = payload as { shopId: string; jobRunId?: string };

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  try {
    const graphql = await adminGraphql(shop.domain);
    const collections = await fetchCollections(graphql);

    if (jobRunId) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: { status: "running", startedAt: new Date(), total: collections.length },
      });
    }

    const outcomes = [];
    for (let i = 0; i < collections.length; i += 5) {
      const batch = collections.slice(i, i + 5);
      outcomes.push(...(await writeCollections(graphql, batch)));
      if (jobRunId) {
        await db.jobRun.update({
          where: { id: jobRunId },
          data: { progress: Math.min(i + batch.length, collections.length) },
        });
      }
    }

    // Ping IndexNow for collections whose pages actually changed.
    await pingCollections(
      shopId,
      shop.domain,
      outcomes.filter((o) => o.written.length > 0).map((o) => o.handle),
    );

    const withTable = outcomes.filter((o) => !o.empty).length;
    if (jobRunId) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: "done",
          finishedAt: new Date(),
          progress: collections.length,
          report: {
            collections: outcomes.length,
            withTable,
            // Named plainly so the dashboard can say why, not just how many.
            withoutTable: outcomes.length - withTable,
            items: outcomes.slice(0, 50),
          } as any,
        },
      });
    }
    helpers.logger.info(
      `bulk_collections ${shop.domain}: ${outcomes.length} collections, ${withTable} with a table`,
    );
  } catch (error) {
    if (jobRunId) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          report: { error: String(error) } as any,
        },
      });
    }
    throw error;
  }
};
