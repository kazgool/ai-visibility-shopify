// graphile-worker task list (PHASE-2-SPEC §6).
//
// Jobs are resumable by construction: progress lives in JobRun, and writes are
// idempotent — same input, same output, and the state metafield guards human
// values, so re-running never destroys anything.

import type { Task } from "graphile-worker";
import db from "../app/db.server";
import { extractOneProduct, runBulkExtract } from "../app/services/extract.server";
import { adminGraphql } from "../app/services/admin.server";
import {
  mayProcessAutomatically,
  mayProcessAutomaticallyCached,
} from "../app/services/billing.server";
import { fetchCollections, writeCollections } from "../app/services/collections.server";
import { pingCollections } from "../app/services/indexnow.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { writeAltText } from "../app/services/alt-text.server";
import { extractProduct } from "../app/engine";
import { runCrawlerCheck } from "../app/services/crawler-check.server";
import { dictionaryFor, extraStopwordsFor } from "../app/services/extract.server";
import { isSeoUnlocked } from "../app/services/billing.server";
import {
  scanStorefront,
  recordThemeScan,
  type ThemeScanResult,
} from "../app/services/theme-scan.server";
import { diffThemeScans, type SeoWatchChange } from "../app/services/seo-watch";
import { runSeoQueueBuild, runSeoApply, type SeoApplyItem } from "../app/services/seo-bulk.server";

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

/**
 * Every automatic path - both webhooks and, before this shop-level check
 * runs, anything already queued by the poll or the sweep - funnels through
 * this one task, which makes it the backstop for FREE-TIER-SPEC §3: a shop
 * with no paid access must not get its catalogue kept fresh automatically.
 *
 * The check here is the cheap, cached form (`mayProcessAutomaticallyCached`)
 * on purpose: this task runs once per product, so an Admin API call here
 * would mean one extra call per product on a large catalogue. The
 * authoritative, API-backed check already ran once per shop in
 * `poll_changes` and `sweep_missing` before any job reached this queue; this
 * is only a net for the webhook path, which has no loop to gate, and for
 * jobs already queued when a shop's access changed underneath them.
 */
export const extract_product: Task = async (payload, helpers) => {
  const { shopId, productGid } = payload as { shopId: string; productGid: string };

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) return;

  if (!(await mayProcessAutomaticallyCached(shop))) {
    helpers.logger.info(
      `extract_product ${shop.domain}: skipped, no active subscription or comp`,
    );
    return;
  }

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
/**
 * A shop we cannot get a session for is a shop that uninstalled without the
 * webhook reaching us - Shopify retries deliveries, but a review store that
 * gets deleted outright, or an endpoint that was down, still loses one. The
 * review store from the August approval sat like that for weeks: polled every
 * 15 minutes, failing every time, and each attempt woke the database and
 * burned paid compute.
 *
 * Only the two definitive signals mark the shop uninstalled - the Shopify
 * library throwing a bare `Response` from `unauthenticated.admin()` (no
 * session it can use) and our own "No offline session" error. Network
 * failures, 429s and GraphQL errors are transient and must never unregister
 * a paying shop. Wrongly marking one is still recoverable: authentication
 * sets `uninstalledAt` back to null, so a reinstall or a merchant opening
 * the app revives it.
 */
async function markGoneIfSessionless(
  shop: { id: string; domain: string },
  error: unknown,
  logger: { info: (msg: string) => void },
): Promise<boolean> {
  const sessionless =
    error instanceof Response ||
    (error instanceof Error && error.message.includes("No offline session"));
  if (!sessionless) return false;
  await db.shop.update({
    where: { id: shop.id },
    data: { uninstalledAt: new Date() },
  });
  logger.info(
    `${shop.domain}: no session obtainable, marking uninstalled so it is no longer polled; reauth revives it`,
  );
  return true;
}

/** `String(new Response())` is "[object Response]" - name the status instead. */
function describeError(error: unknown): string {
  if (error instanceof Response) return `Response ${error.status} ${error.statusText}`;
  return String(error);
}

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

      // FREE-TIER-SPEC §3: automatic freshness is not free. Checked here,
      // once per shop per run, before any job is queued - not inside
      // extract_product, where it would cost one Admin API call per
      // product. The cursor is deliberately left unadvanced: the next run,
      // once the shop is paid again, picks the window back up from here
      // rather than losing whatever changed while it was skipped.
      if (!(await mayProcessAutomatically(shop, graphql))) {
        helpers.logger.info(
          `poll_changes ${shop.domain}: skipped, no active subscription or comp`,
        );
        continue;
      }

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
      if (await markGoneIfSessionless(shop, error, helpers.logger)) continue;
      helpers.logger.error(`poll_changes failed for ${shop.domain}: ${describeError(error)}`);
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

      // Same rule as poll_changes: FREE-TIER-SPEC §3 excludes the sweep
      // from the free tier, checked once per shop before the (expensive)
      // catalogue read even starts.
      if (!(await mayProcessAutomatically(shop, graphql))) {
        helpers.logger.info(
          `sweep_missing ${shop.domain}: skipped, no active subscription or comp`,
        );
        continue;
      }

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
      if (await markGoneIfSessionless(shop, error, helpers.logger)) continue;
      helpers.logger.error(`sweep_missing failed for ${shop.domain}: ${describeError(error)}`);
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

const FIRST_ONLINE_PRODUCT_SEO = `#graphql
  query FirstOnlineProductSeoWatch {
    products(first: 1, query: "published_status:published") {
      nodes { onlineStoreUrl }
    }
  }
`;

const PRIMARY_DOMAIN_SEO = `#graphql
  query PrimaryDomainSeoWatch {
    shop { url }
  }
`;

const MAIN_THEME_ID_SEO = `#graphql
  query MainThemeIdSeoWatch {
    themes(first: 1, roles: [MAIN]) {
      nodes { id }
    }
  }
`;

/**
 * Weekly SEO watch (SEO screen Part 5). Rescans the product page and the
 * home page and records what changed since last time, so a merchant who
 * switches theme and silently loses the app embed finds out. Nothing is
 * auto-fixed and nothing is written to the store here - it only reads and
 * records.
 *
 * Gated the same way poll_changes and sweep_missing are gated for
 * FREE-TIER-SPEC §3, plus the seo_unlocked switch: an unpaid shop, or a
 * paid shop without the SEO module, is not scanned.
 */
export const seo_watch: Task = async (_payload, helpers) => {
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });

  for (const shop of shops) {
    try {
      if (!(await isSeoUnlocked(shop.id))) {
        continue; // not part of this shop's module - no log noise for the common case
      }

      const graphql = await adminGraphql(shop.domain);

      if (!(await mayProcessAutomatically(shop, graphql))) {
        helpers.logger.info(`seo_watch ${shop.domain}: skipped, no active subscription or comp`);
        continue;
      }

      const productData = await graphql<any>(FIRST_ONLINE_PRODUCT_SEO);
      const productUrl = productData?.products?.nodes?.[0]?.onlineStoreUrl ?? `https://${shop.domain}`;

      const domainData = await graphql<any>(PRIMARY_DOMAIN_SEO);
      const homeUrl = domainData?.shop?.url ?? `https://${shop.domain}`;

      const passwordSetting = await db.setting.findUnique({
        where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
      });

      const current = await scanStorefront(productUrl, homeUrl, passwordSetting?.value);

      const themeData = await graphql<any>(MAIN_THEME_ID_SEO);
      const themeId = themeData?.themes?.nodes?.[0]?.id;
      if (!themeId) continue;

      const previousRow = await db.themeScan.findUnique({
        where: { shopId_themeId: { shopId: shop.id, themeId: String(themeId) } },
      });
      const previous = (previousRow?.detail as any as ThemeScanResult) ?? null;

      const nowIso = new Date().toISOString();
      const newChanges = diffThemeScans(previous, current, nowIso);
      const priorHistory: SeoWatchChange[] = (previous as any)?.watchChanges ?? [];
      const watchChanges = [...priorHistory, ...newChanges].slice(-20);

      // recordThemeScan writes only to our own database and the shop
      // metafield we already mirror the theme scan through - never to the
      // storefront or to product data.
      await recordThemeScan(shop.id, String(themeId), { ...current, watchChanges } as any);

      if (newChanges.length > 0) {
        helpers.logger.info(
          `seo_watch ${shop.domain}: ${newChanges.length} change(s) detected`,
        );
      }
    } catch (error) {
      if (await markGoneIfSessionless(shop, error, helpers.logger)) continue;
      helpers.logger.error(`seo_watch failed for ${shop.domain}: ${describeError(error)}`);
    }
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

/**
 * Build the meta title / meta description review queue (SEO-WORKSPACE-PRD
 * §3.5). Read-only: it reads the whole catalogue through the same bulk
 * export `bulk_extract` uses and computes suggestions, writing nothing. The
 * operator reviews the result on `/app/seo` and approves rows into a
 * separate `seo_apply` job.
 *
 * ENTITLEMENT: gated here independently of the route that enqueued it - a
 * queue build for a shop without `seo_unlocked` is refused before the
 * (expensive) bulk export even starts.
 */
export const seo_queue_build: Task = async (payload, helpers) => {
  const { shopId, jobRunId } = payload as { shopId: string; jobRunId: string };

  if (!(await isSeoUnlocked(shopId))) {
    await db.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: "refused",
        finishedAt: new Date(),
        report: { refused: true, reason: "SEO module not enabled for this shop" } as any,
      },
    });
    helpers.logger.info(`seo_queue_build ${shopId}: refused, seo_unlocked is off`);
    return;
  }

  await db.jobRun.update({
    where: { id: jobRunId },
    data: { status: "running", startedAt: new Date() },
  });

  try {
    const queue = await runSeoQueueBuild(shopId, {
      onProgress: async (done, total) => {
        await db.jobRun.update({ where: { id: jobRunId }, data: { progress: done, total } });
      },
    });

    await db.jobRun.update({
      where: { id: jobRunId },
      data: { status: "done", finishedAt: new Date(), report: queue as any },
    });
    helpers.logger.info(
      `seo_queue_build ${shopId}: ${queue.checked} checked, ${queue.rows.length} proposed, ` +
        `${queue.protectedRows.length} protected, ${queue.outsideApp} field(s) set outside this app`,
    );
  } catch (error) {
    await db.jobRun.update({
      where: { id: jobRunId },
      data: { status: "failed", finishedAt: new Date(), report: { error: String(error) } as any },
    });
    throw error;
  }
};

/**
 * Write the operator-approved rows (SEO-WORKSPACE-PRD §3.5, §7). No
 * scheduled job ever calls this - it only runs from an explicit "Apply"
 * submission on `/app/seo`, carrying the exact product ids and field values
 * the operator saw and approved.
 *
 * ENTITLEMENT: re-checked inside `runSeoApply` at execution time, not only
 * when the route enqueued it - the queue may sit for a while before an
 * operator presses Apply, and `seo_unlocked` can be switched off in between.
 * A refused run touches nothing and the report says why.
 */
export const seo_apply: Task = async (payload, helpers) => {
  const { shopId, jobRunId, items } = payload as {
    shopId: string;
    jobRunId: string;
    items: SeoApplyItem[];
  };

  await db.jobRun.update({
    where: { id: jobRunId },
    data: { status: "running", startedAt: new Date() },
  });

  try {
    const report = await runSeoApply(shopId, items, {
      onProgress: async (done, total) => {
        await db.jobRun.update({ where: { id: jobRunId }, data: { progress: done, total } });
      },
    });

    if (report.refused) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: "refused",
          finishedAt: new Date(),
          report: {
            ...report,
            reason: "SEO module was disabled for this shop before this job ran",
          } as any,
        },
      });
      helpers.logger.info(`seo_apply ${shopId}: refused, seo_unlocked is off`);
      return;
    }

    // Same self-feed guard bulk_extract and bulk_alt_text use: a mass write
    // makes every touched product look "recently changed" to poll_changes,
    // which would otherwise queue a no-op extract_product per product.
    if (report.written > 0) await advancePollCursor(shopId);

    await db.jobRun.update({
      where: { id: jobRunId },
      data: { status: "done", finishedAt: new Date(), report: report as any },
    });
    helpers.logger.info(
      `seo_apply ${shopId}: ${report.written} written, ${report.skipped} skipped, ${report.unchanged} unchanged`,
    );
  } catch (error) {
    await db.jobRun.update({
      where: { id: jobRunId },
      data: { status: "failed", finishedAt: new Date(), report: { error: String(error) } as any },
    });
    throw error;
  }
};
