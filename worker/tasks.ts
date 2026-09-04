// graphile-worker task list (PHASE-2-SPEC §6).
//
// Jobs are resumable by construction: progress lives in JobRun, and writes are
// idempotent — same input, same output, and the state metafield guards human
// values, so re-running never destroys anything.

import type { Task } from "graphile-worker";
import db from "../app/db.server";
import {
  extractOneProduct,
  runBulkExtract,
  withdrawIfIneligible,
} from "../app/services/extract.server";
import { catalogueQuery } from "../app/services/eligibility";
import { prefsFor } from "../app/services/eligibility.server";
import { reconcileMirrors } from "../app/services/mirror-reconcile.server";
import { adminGraphql } from "../app/services/admin.server";
import {
  mayProcessAutomatically,
  mayProcessAutomaticallyCached,
} from "../app/services/billing.server";
import { fetchCollections, writeCollections } from "../app/services/collections.server";
import { pingCollections } from "../app/services/indexnow.server";
import { fetchAllProducts } from "../app/services/catalogue.server";
import { computeSourceA } from "../app/services/seo-scan.server";
import {
  cappedBudget,
  dailyBudget,
  scanShopPages,
  type SourceBReport,
} from "../app/services/seo-page.server";
import { writeAltText } from "../app/services/alt-text.server";
import { extractProduct } from "../app/engine";
import { AGENTS, runCrawlerCheck } from "../app/services/crawler-check.server";
import { dictionaryFor, extraStopwordsFor } from "../app/services/extract.server";
import { isSeoUnlocked } from "../app/services/billing.server";
import {
  scanStorefront,
  recordThemeScan,
  type ThemeScanResult,
} from "../app/services/theme-scan.server";
import {
  diffProductFindings,
  diffThemeScans,
  formatProductWatchLine,
  snapshotFindings,
  type ProductSnapshot,
  type SeoWatchChange,
} from "../app/services/seo-watch";
import { runSeoQueueBuild, runSeoApply, type SeoApplyItem } from "../app/services/seo-bulk.server";
import { crawlerHitCutoff } from "../app/services/retention";
import { describeGraphqlError } from "../app/services/graphql-errors";

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

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  await db.jobRun.update({
    where: { id: jobRunId },
    data: { status: "running", startedAt: new Date() },
  });

  try {
    // ENTITLEMENT: re-checked here, not only where the job was enqueued. A job
    // queued while the shop was paid can execute after access is gone, and a
    // full catalogue pass is exactly what the free tier does not include
    // (FREE-TIER-SPEC §3). Same shape as bulk_collections.
    //
    // Inside the try, and after the row is marked running, on purpose: the
    // check calls the Admin API, so an expired token, an uninstall or a 429
    // throws. Outside the try that throw left the row at "queued" for ever
    // once graphile-worker gave up retrying, and the dashboard refuses every
    // button while a queued row exists - the merchant is locked out with no
    // explanation. Here the catch marks the row failed and the screen recovers.
    if (!(await mayProcessAutomatically(shop, await adminGraphql(shop.domain)))) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: "refused",
          finishedAt: new Date(),
          report: {
            refused: true,
            reason:
              "This shop has no active subscription, so the catalogue pass is not available.",
          } as any,
        },
      });
      helpers.logger.info(`bulk_extract ${shop.domain}: refused, no active subscription or comp`);
      return;
    }

    const report = await runBulkExtract(shopId, {
      dryRun,
      onProgress: async (done, total) => {
        await db.jobRun.update({
          where: { id: jobRunId },
          data: { progress: done, total },
        });
      },
      addJob: async (productGid: string) => {
        await helpers.addJob(
          "extract_product",
          { shopId, productGid },
          { maxAttempts: 3, jobKey: `extract:${productGid}` },
        );
      },
      log: (message) => helpers.logger.info(message),
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
        report: { error: describeError(error) } as any,
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
    // Withdrawal is never gated (section I.2). This was the larger of the two
    // holes and it is not a lost webhook: the free tier writes mirror rows for
    // three merchant-chosen products, and every row a lapsed shop wrote while
    // it was paid is still serving. When one of those products is unpublished,
    // products/update arrives, this task is queued, and until now it returned
    // here - so the only thing that ever removed the row was products/delete.
    // Nothing is taken away that is a benefit; a public page for a product the
    // store no longer sells is not a benefit kept, it is a claim that has
    // become false.
    const withdrawn = await withdrawIfIneligible(shopId, productGid);
    helpers.logger.info(
      `extract_product ${shop.domain}: skipped, no active subscription or comp` +
        (withdrawn ? "; its text page was withdrawn, the product no longer qualifies" : ""),
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
 * Runs on the worker because that many agents with a retry each can take
 * half a minute, and no admin request should wait that long (PRD §5.2).
 */
export const crawler_check: Task = async (payload, helpers) => {
  const { shopId, jobRunId } = payload as { shopId: string; jobRunId?: string };

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  // Derived from the agent list itself, never hardcoded - a hardcoded 5
  // survived the list growing to 8 and made the progress bar lie.
  const agentCount = Object.keys(AGENTS).length;

  if (jobRunId) {
    await db.jobRun.update({
      where: { id: jobRunId },
      data: { status: "running", startedAt: new Date(), total: agentCount },
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
          progress: agentCount,
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
          report: { error: describeError(error) } as any,
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

/**
 * `String(new Response())` is "[object Response]" - name the status instead.
 * Everything else goes through the one formatter, so a job that failed on a
 * Shopify GraphQL error records every message and path in its JobRun report
 * rather than "An error occurred while fetching from the API" (4 September
 * 2026).
 */
function describeError(error: unknown): string {
  if (error instanceof Response) return `Response ${error.status} ${error.statusText}`;
  return describeGraphqlError(error);
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
 * failed endpoint or an app restart can still lose one. Once a week (Monday
 * 03:30 UTC, see worker/index.ts) we look for products that carry no
 * attributes yet and queue them, so a merchant never discovers months later
 * that half a season is missing.
 *
 * Cheap by design: it reads through one bulk operation and only writes what is
 * genuinely absent. The same catalogue read also feeds the mirror
 * reconciliation below, which is what takes a page down when the webhook that
 * should have done it never arrived.
 */
export const sweep_missing: Task = async (_payload, helpers) => {
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });

  for (const shop of shops) {
    try {
      const graphql = await adminGraphql(shop.domain);

      // ENTITLEMENT, in two halves (PRD-PORT-1.7.8 I.2: withdrawal is never
      // gated; QA of 3 September 2026, blocking 2). The catalogue is read and
      // the reconciliation runs for every installed shop, because taking a
      // page down writes nothing to Shopify and a shop without paid access is
      // exactly the shop whose lost-webhook pages would otherwise serve for
      // ever. What the gate decides is whether this shop gets new work queued:
      // the missing-attributes half below, and the extract_product jobs the
      // reconciliation would add for eligible products with no row. On a shop
      // without access those jobs are given a no-op, so the reconciliation
      // still deletes and adopts, and its log line reports 0 queued.
      // Cost accepted with the fix: one bulk export per lapsed shop per week.
      const paid = await mayProcessAutomatically(shop, graphql);

      const prefs = await prefsFor(shop.id);
      const catalogue = await fetchAllProducts(graphql, catalogueQuery(prefs));
      const products = catalogue.products;

      // Full reconciliation, piggybacking on the catalogue already read. This
      // replaces a cleanup that only matched rows with a NULL productId, and
      // so never touched the case it was most needed for: a lost
      // products/update on a paid shop leaves a row that has a productId, and
      // a product taken off sale is often never edited again, so the page and
      // its llms.txt entry served indefinitely. It also refuses to delete
      // anything when Shopify's download was short, which the old statement
      // did not check at all.
      await reconcileMirrors(
        { id: shop.id, domain: shop.domain },
        catalogue,
        prefs,
        paid
          ? async (productGid: string) => {
              await helpers.addJob(
                "extract_product",
                { shopId: shop.id, productGid },
                { maxAttempts: 3, jobKey: `extract:${productGid}` },
              );
            }
          : async () => false,
        (message) => helpers.logger.info(message),
      );

      // Source A of the per-product SEO scan, on the read already in hand
      // (PRD-SEO-PER-PRODUCT build step 2). Placed before the subscription
      // gate on purpose: source A is gated by the SEO key alone, which is a
      // separately billed engagement, and it writes nothing to Shopify.
      // computeSourceA returns null and writes nothing without that key.
      await computeSourceA(shop.id, graphql, catalogue, (message) =>
        helpers.logger.info(message),
      );

      if (!paid) {
        helpers.logger.info(
          `sweep_missing ${shop.domain}: pages reconciled; attribute sweep skipped, no active subscription or comp`,
        );
        continue;
      }

      // The missing-attributes half runs either way after a skipped
      // reconciliation: writing is safe on a short read, only deleting is not.
      const dictionary = await dictionaryFor(shop.id);
      const extraStopwords = await extraStopwordsFor(shop.id);

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
          // Same jobKey the poll uses: a product both polled and swept in
          // the same window gets one job, not two identical ones.
          { maxAttempts: 3, jobKey: `extract:${product.id}` },
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
 * Apply a change to the two publishing toggles (section J.6).
 *
 * Turning a toggle off has to remove pages that are already published, not
 * merely stop adding new ones - otherwise the setting describes the future
 * and lies about the present. Run as a job so the merchant's POST returns at
 * once and the screen can report the outcome from a JobRun row rather than
 * from local state.
 */
export const reconcile_mirrors: Task = async (payload, helpers) => {
  const { shopId, jobRunId } = payload as { shopId: string; jobRunId?: string };

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop ${shopId}`);

  try {
    const graphql = await adminGraphql(shop.domain);

    if (jobRunId) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: { status: "running", startedAt: new Date() },
      });
    }

    // ENTITLEMENT, same two halves as sweep_missing (PRD-PORT-1.7.8 I.2:
    // withdrawal is never gated; QA of 3 September 2026, blocking 2). The
    // POST that queued this already refused a shop without paid access, so
    // reaching here unpaid means access lapsed in between. The withdrawal
    // still runs: taking pages down is the half of a toggle change that must
    // never wait on a subscription. Only the queueing of new pages is withheld,
    // and the report says so, so the card can tell the merchant which half
    // happened.
    const paid = await mayProcessAutomatically(shop, graphql);

    const prefs = await prefsFor(shopId);
    const catalogue = await fetchAllProducts(graphql, catalogueQuery(prefs));
    const result = await reconcileMirrors(
      { id: shop.id, domain: shop.domain },
      catalogue,
      prefs,
      paid
        ? async (productGid: string) => {
            await helpers.addJob(
              "extract_product",
              { shopId: shop.id, productGid },
              { maxAttempts: 3, jobKey: `extract:${productGid}` },
            );
          }
        : async () => false,
      (message) => helpers.logger.info(message),
    );

    // Same read, same rule as sweep_missing above.
    await computeSourceA(shopId, graphql, catalogue, (message) =>
      helpers.logger.info(message),
    );

    if (!paid) {
      helpers.logger.info(
        `reconcile_mirrors ${shop.domain}: pages reconciled; nothing queued, no active subscription or comp`,
      );
    }

    if (jobRunId) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: "done",
          finishedAt: new Date(),
          report: {
            ...result,
            ...(paid
              ? {}
              : {
                  queueingRefused:
                    "This shop has no active subscription, so no new pages were queued; pages that no longer qualify were still withdrawn.",
                }),
          } as any,
        },
      });
    }
  } catch (error) {
    if (jobRunId) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          report: { error: describeError(error) } as any,
        },
      });
    }
    throw error;
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

    // ENTITLEMENT: same reason as bulk_extract - alt text for the whole
    // catalogue is a paid pass, and the check belongs at execution as well as
    // at enqueue (FREE-TIER-SPEC §3). Both this check and the Admin client it
    // needs stay inside the try: they can throw, and a throw before the row
    // leaves "queued" strands the row and locks the dashboard.
    if (!(await mayProcessAutomatically(shop, graphql))) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: {
          status: "refused",
          finishedAt: new Date(),
          report: {
            refused: true,
            reason:
              "This shop has no active subscription, so writing alt text is not available.",
          } as any,
        },
      });
      helpers.logger.info(`bulk_alt_text ${shop.domain}: refused, no active subscription or comp`);
      return;
    }

    const dictionary = await dictionaryFor(shopId);
    const extraStopwords = await extraStopwordsFor(shopId);
    // Same set the catalogue pass reads: alt text for an unlisted product is
    // written only when the merchant included unlisted products, which is
    // what "not read by the catalogue pass" promises on the Report screen.
    const catalogue = await fetchAllProducts(
      graphql,
      catalogueQuery(await prefsFor(shopId)),
    );
    const products = catalogue.products;

    // Source A of the per-product SEO scan, on the read already in hand.
    // Every pass that reads the whole catalogue refreshes it, so a row is
    // never older than the last full read whichever job did the reading.
    await computeSourceA(shopId, graphql, catalogue, (message) =>
      helpers.logger.info(message),
    );

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
        report: { error: describeError(error) } as any,
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
/**
 * Adapt the worker's GraphqlFn (returns parsed data) to the Remix-style
 * `(query, { variables }) => Response` shape recordThemeScan's metafield
 * mirror expects - the same shape admin.graphql has in routes. The body is
 * re-wrapped as `{ data }` because that is what the callers' res.json()
 * reads.
 */
function asResponseGraphql(
  graphql: (query: string, variables?: Record<string, unknown>) => Promise<any>,
): (query: string, options?: { variables?: object }) => Promise<Response> {
  return async (query, options) => {
    const data = await graphql(query, (options?.variables as Record<string, unknown>) ?? {});
    return new Response(JSON.stringify({ data }), {
      headers: { "Content-Type": "application/json" },
    });
  };
}

/** Where the last per-product watch snapshot is kept. */
export const PRODUCT_WATCH_SETTING_KEY = "seo_watch_products";

/** How many changed products one Monday line lists before it says "and more". */
const PRODUCT_WATCH_LOG_CAP = 50;

/**
 * Diff this week's per-product findings against last week's snapshot, log the
 * lines, and store this week as next week's baseline.
 *
 * Best effort in the same sense pingProducts is: the weekly watch existed and
 * did its job before this, and a failure here must not be the reason a shop
 * loses its theme scan. The failure is logged, never swallowed silently.
 */
async function recordProductWatch(
  shopId: string,
  domain: string,
  nowIso: string,
  logger: { info: (m: string) => void; error: (m: string) => void },
): Promise<void> {
  try {
    const rows = await db.seoScan.findMany({
      where: { shopId },
      select: { productId: true, handle: true, findings: true },
    });
    const current = snapshotFindings(rows);

    const stored = await db.setting.findUnique({
      where: { shopId_key: { shopId, key: PRODUCT_WATCH_SETTING_KEY } },
    });
    let previous: ProductSnapshot | null = null;
    try {
      const parsed = stored?.value ? JSON.parse(stored.value) : null;
      // A snapshot that is not an object is not a snapshot. Treated as no
      // baseline, which reports nothing rather than reporting the whole
      // catalogue as changed on Monday.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        previous = parsed as ProductSnapshot;
      }
    } catch {
      previous = null;
    }

    const handles = new Map(rows.map((row) => [row.productId, row.handle]));
    const changes = diffProductFindings(previous, current, nowIso, handles);

    const value = JSON.stringify(current);
    await db.setting.upsert({
      where: { shopId_key: { shopId, key: PRODUCT_WATCH_SETTING_KEY } },
      create: { shopId, key: PRODUCT_WATCH_SETTING_KEY, value },
      update: { value },
    });

    if (changes.length === 0) return;
    logger.info(`seo_watch ${domain}: ${changes.length} product(s) changed since the last watch`);
    for (const change of changes.slice(0, PRODUCT_WATCH_LOG_CAP)) {
      logger.info(`seo_watch ${domain}: ${formatProductWatchLine(change)}`);
    }
    if (changes.length > PRODUCT_WATCH_LOG_CAP) {
      logger.info(
        `seo_watch ${domain}: and ${changes.length - PRODUCT_WATCH_LOG_CAP} more products changed`,
      );
    }
  } catch (error) {
    logger.error(`seo_watch ${domain}: per-product watch failed - ${describeError(error)}`);
  }
}

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
      // storefront or to product data. The graphql adapter is passed so the
      // shop metafield mirror (theme_scan: hasOrganizationLd/organizationId,
      // which the storefront block reads at render time) is resynced weekly
      // too, the same as when the SEO screen's scan runs - without it the
      // block kept deciding extend-or-emit from a mirror the watch had
      // stopped refreshing.
      await recordThemeScan(
        shop.id,
        String(themeId),
        { ...current, watchChanges } as any,
        asResponseGraphql(graphql),
      );

      if (newChanges.length > 0) {
        helpers.logger.info(
          `seo_watch ${shop.domain}: ${newChanges.length} change(s) detected`,
        );
      }

      // Per-product mode (PRD-SEO-PER-PRODUCT section 4, build step 6). The
      // theme diff above reads one product page; this reads every SeoScan
      // row, so the Monday line can name the products whose findings changed.
      //
      // Last week's codes are kept in a Setting row rather than a column,
      // because the question is "what changed since the last watch" and the
      // rows themselves only ever hold now. Clean products are left out of
      // the snapshot (snapshotFindings), so a healthy 20,000-product store
      // stores almost nothing and a broken one stores what it has to.
      await recordProductWatch(shop.id, shop.domain, nowIso, helpers.logger);
    } catch (error) {
      if (await markGoneIfSessionless(shop, error, helpers.logger)) continue;
      helpers.logger.error(`seo_watch failed for ${shop.domain}: ${describeError(error)}`);
    }
  }
};

/**
 * Source B of the per-product SEO scan (PRD-SEO-PER-PRODUCT section 3): one
 * GET of each product's public page, nightly, under a per-shop daily budget.
 *
 * Nightly rather than weekly because the budget is what bounds it: a 20,000
 * product store finishes in 40 nights at the default 500, and the JobRun
 * report says so in the same numbers the SEO screen shows.
 *
 * ENTITLEMENT: the SEO key first, and a shop without it gets no JobRun at
 * all rather than a refused one - a refused row would put a job the merchant
 * never asked for on the dashboard of every shop in the database, every
 * night. The subscription check is second and behaves like seo_watch's:
 * logged and skipped. Both inside the try, because the second calls the Admin
 * API and an expired token throws.
 */
export const seo_scan_products: Task = async (_payload, helpers) => {
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });

  for (const shop of shops) {
    try {
      await scanProductPagesForShop(shop, helpers.logger);
    } catch (error) {
      if (await markGoneIfSessionless(shop, error, helpers.logger)) continue;
      helpers.logger.error(`seo_scan_products failed for ${shop.domain}: ${describeError(error)}`);
    }
  }
};

/** Why one shop's page scan did not run, when it did not. */
export type SeoScanSkip = "no_seo_key" | "no_subscription";

export type SeoScanShopOutcome =
  | { ran: true; budget: number; report: SourceBReport }
  | { ran: false; reason: SeoScanSkip };

/**
 * One shop's night of source B, exactly as the nightly task runs it.
 *
 * Extracted from the loop above on 4 September 2026 so that
 * `scripts/run-seo-scan.ts` can watch a scan without waiting for 03:45 and
 * without reimplementing any of it. A development runner that built its own
 * origin resolution, its own entitlement order or its own JobRun would drift
 * from the task within one wave, and then the thing being observed would not
 * be the thing that runs at night - which is the only reason to observe it.
 *
 * It throws rather than swallowing: the caller decides whether a failure means
 * `markGoneIfSessionless` and the next shop (the task) or a stack trace and a
 * non-zero exit (the script).
 *
 * `budgetCap` lowers this run's budget and can never raise it - see
 * `cappedBudget`.
 */
export async function scanProductPagesForShop(
  shop: { id: string; domain: string },
  logger: { info: (message: string) => void },
  options: { budgetCap?: number | null } = {},
): Promise<SeoScanShopOutcome> {
  if (!(await isSeoUnlocked(shop.id))) {
    // Not part of this shop's module - no log noise for the common case.
    return { ran: false, reason: "no_seo_key" };
  }

  const graphql = await adminGraphql(shop.domain);

  if (!(await mayProcessAutomatically(shop, graphql))) {
    logger.info(`seo_scan_products ${shop.domain}: skipped, no active subscription or comp`);
    return { ran: false, reason: "no_subscription" };
  }

  // The primary domain, not the myshopify one: a page fetched on the wrong
  // host answers with a redirect, and every product would report finding B5
  // about a redirect this app caused itself.
  const domainData = await graphql<any>(PRIMARY_DOMAIN_SEO);
  const shopUrl = domainData?.shop?.url ?? `https://${shop.domain}`;
  let origin = `https://${shop.domain}`;
  try {
    origin = new URL(shopUrl).origin;
  } catch {
    // Keep the myshopify origin rather than fail the night's scan.
  }

  const budget = cappedBudget(await dailyBudget(shop.id), options.budgetCap);
  const passwordSetting = await db.setting.findUnique({
    where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
  });

  const jobRun = await db.jobRun.create({
    data: {
      shopId: shop.id,
      kind: "seo_scan",
      status: "running",
      startedAt: new Date(),
      total: budget,
    },
  });

  try {
    const report = await scanShopPages({
      shopId: shop.id,
      origin,
      password: passwordSetting?.value,
      budget,
      deps: { log: (message) => logger.info(message) },
    });

    await db.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "done",
        finishedAt: new Date(),
        progress: report.scanned,
        // The denominator is the whole catalogue still waiting, not the
        // budget: "500 of 20,000" is the true sentence, and a bar that
        // reads 500 of 500 every night says the opposite of what happened.
        total: report.scanned + report.remaining,
        report: report as any,
      },
    });
    return { ran: true, budget, report };
  } catch (error) {
    await db.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        report: { error: describeError(error) } as any,
      },
    });
    throw error;
  }
}

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

    // ENTITLEMENT: gated here independently of the route that enqueued it -
    // collections are a paid feature (FREE-TIER-SPEC §3), and a job already
    // queued before the shop's access changed must not run anyway. Same
    // shape as seo_queue_build: checked once, before the (expensive)
    // catalogue read even starts.
    if (!(await mayProcessAutomatically(shop, graphql))) {
      if (jobRunId) {
        await db.jobRun.update({
          where: { id: jobRunId },
          data: {
            status: "refused",
            finishedAt: new Date(),
            report: {
              refused: true,
              reason: "This shop has no active subscription, so building collection pages is not available.",
            } as any,
          },
        });
      }
      helpers.logger.info(`bulk_collections ${shop.domain}: refused, no active subscription or comp`);
      return;
    }

    const collections = await fetchCollections(graphql);
    const prefs = await prefsFor(shopId);

    if (jobRunId) {
      await db.jobRun.update({
        where: { id: jobRunId },
        data: { status: "running", startedAt: new Date(), total: collections.length },
      });
    }

    const outcomes = [];
    for (let i = 0; i < collections.length; i += 5) {
      const batch = collections.slice(i, i + 5);
      outcomes.push(...(await writeCollections(graphql, batch, prefs)));
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
          report: { error: describeError(error) } as any,
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

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) {
    await db.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        report: { error: `Unknown shop ${shopId}` } as any,
      },
    });
    return;
  }

  // Marius's ruling, 31 Aug 2026: seo_unlocked being on is not enough for a
  // write path - a shop with no active subscription (and no comp) may not
  // run the bulk pass either, mirroring the per-product write gate below.
  // Checked once per build, before the (expensive) bulk export, the same
  // shape poll_changes and sweep_missing use for their own shop-level gate.
  const graphql = await adminGraphql(shop.domain);
  if (!(await mayProcessAutomatically(shop, graphql))) {
    await db.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: "refused",
        finishedAt: new Date(),
        report: {
          refused: true,
          reason: "This shop has no active subscription, so the SEO module cannot run.",
        } as any,
      },
    });
    helpers.logger.info(`seo_queue_build ${shop.domain}: refused, no active subscription or comp`);
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
      data: { status: "failed", finishedAt: new Date(), report: { error: describeError(error) } as any },
    });
    throw error;
  }
};

/**
 * Every "done" queue for this shop must not survive a write - its rows and
 * counts describe a catalogue state this apply has just made false (bug
 * caught 1 Sep 2026: a store with all 100 fields written still showed "0 of
 * 50" and a table offering to write them again, both read straight off the
 * seo_queue JobRun's build-time report).
 *
 * Originally this touched only the single queue named by `queueJobId` - the
 * one the operator actually reviewed. That under-invalidates: the loader
 * always reads the shop's most-recently-created seo_queue JobRun, and a
 * second, newer queue can exist that was also built before this write (a
 * second "Preview" pressed in another tab, or a re-preview whose apply was
 * never submitted) and shares no relationship to `queueJobId` at all. Left
 * "done", that newer queue is exactly as wrong as the one just applied
 * against, and the loader would present it as current. So every "done"
 * seo_queue for the shop is marked stale here, not only the reviewed one -
 * deliberately over-invalidating (a merchant re-reads "Press Preview again"
 * one extra time) rather than under-invalidating (a screen states a number
 * known to be wrong), per EXPERIENCE-PRD §2.
 *
 * Marks "stale" rather than deleting or rebuilding: rebuilding means
 * re-reading the whole catalogue, not free enough to fire on every apply,
 * and the JobRun itself is small evidence worth keeping. "stale" simply
 * removes it from the set of statuses seo-queue-metrics.ts treats as current
 * (only "done" qualifies), so the dashboard falls back to "press Preview
 * again" instead of presenting numbers or rows known to be wrong. The
 * operator chooses when to pay for a fresh read; nothing rebuilds itself.
 */
async function invalidateQueue(shopId: string) {
  await db.jobRun.updateMany({
    where: { shopId, kind: "seo_queue", status: "done" },
    data: { status: "stale" },
  });
}

/**
 * Write the operator-approved rows (SEO-WORKSPACE-PRD §3.5, §7). No
 * scheduled job ever calls this - it only runs from an explicit "Apply"
 * submission on `/app/seo`, carrying the exact product ids and field values
 * the operator saw and approved, plus the id of the queue JobRun those rows
 * came from.
 *
 * ENTITLEMENT: re-checked inside `runSeoApply` at execution time, not only
 * when the route enqueued it - the queue may sit for a while before an
 * operator presses Apply, and `seo_unlocked` can be switched off in between.
 * A refused run touches nothing and the report says why - and does not
 * invalidate the queue, because nothing about it became false.
 */
export const seo_apply: Task = async (payload, helpers) => {
  // queueJobId is accepted for backward compatibility with older enqueued
  // payloads and for the JobRun report, but no longer drives invalidation -
  // see invalidateQueue above for why that was the under-invalidating half
  // of the 1 Sep bug.
  const { shopId, jobRunId, items, queueJobId } = payload as {
    shopId: string;
    jobRunId: string;
    items: SeoApplyItem[];
    queueJobId?: string | null;
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
            reason: report.reason ?? "SEO module was disabled for this shop before this job ran",
          } as any,
        },
      });
      helpers.logger.info(
        `seo_apply ${shopId}: refused, ${report.reason ?? "seo_unlocked is off"} (reviewed queue ${queueJobId ?? "none"})`,
      );
      return;
    }

    // Invalidate before declaring this job done, and regardless of whether
    // `written` is nonzero: "already matched" (the exact case that shipped
    // broken) means an earlier apply already wrote these fields, so this
    // queue's proposals were already false the moment it printed them.
    await invalidateQueue(shopId);

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
    // A thrown error can still follow partial writes (writeSeo runs one
    // product at a time), so the queue is invalidated here too rather than
    // left looking trustworthy after a run that may have changed some of it.
    await invalidateQueue(shopId);
    await db.jobRun.update({
      where: { id: jobRunId },
      data: { status: "failed", finishedAt: new Date(), report: { error: describeError(error) } as any },
    });
    throw error;
  }
};

/**
 * PRIVACY.md promises raw CrawlerHit records are kept 30 days; nothing
 * pruned them (fix). Cron-registered daily in worker/index.ts. The cutoff
 * arithmetic lives in retention.ts, pure and unit tested; this task is the
 * one line of I/O around it.
 */
export const prune_crawler_hits: Task = async (_payload, helpers) => {
  const cutoff = crawlerHitCutoff(new Date());
  const { count } = await db.crawlerHit.deleteMany({ where: { at: { lt: cutoff } } });
  if (count > 0) {
    helpers.logger.info(`prune_crawler_hits: deleted ${count} rows older than ${cutoff.toISOString()}`);
  }
};
