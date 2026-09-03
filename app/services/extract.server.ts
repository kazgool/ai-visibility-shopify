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
  hasWithdrawableAutoValues,
  type ProductInput,
} from "./facts.server";
import { catalogueQuery, eligibility } from "./eligibility";
import { prefsFor } from "./eligibility.server";
import { reconcileMirrors, type Reconciliation } from "./mirror-reconcile.server";
import { enqueue } from "./queue.server";
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
 * product stopped qualifying for a page entirely (a draft, an archived
 * product, one taken off the Online Store, or one excluded by the merchant's
 * own toggles). Looked up by product id, which both the products/update and
 * products/delete webhooks carry reliably, rather than by handle, which can
 * be stale on both.
 */
async function dropStaleMirror(
  shopId: string,
  productId: string,
  currentHandle: string | null,
  isEligible: boolean,
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
  // migration are caught by the weekly reconciliation in sweep_missing
  // instead - which since section I covers every row, not only the NULL ones.
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
  if (!isEligible || existing.handle !== currentHandle) {
    await db.mirrorCache.delete({ where: { id: existing.id } });
  }
}

/**
 * Withdrawal on a shop the entitlement gate turned away (section I.2).
 *
 * The gate exists so a shop without paid access does not get its catalogue
 * processed for free. Deleting this app's own MirrorCache row for a product
 * the merchant hid is not processing: it writes nothing to Shopify, costs no
 * pass, and is the minimum "nothing is invented" requires. So the gate stays
 * exactly where it is for every write, and moves off this one branch.
 *
 * Cost is bounded by design. No row for this product - the common case on a
 * free shop, which has at most three - means zero Admin API calls. A row
 * present costs one product read, and never a metafield write, a mirror
 * render or an IndexNow ping.
 *
 * Returns true when a page was withdrawn, so the caller can say so.
 */
export async function withdrawIfIneligible(
  shopId: string,
  productGid: string,
): Promise<boolean> {
  const existing = await db.mirrorCache.findFirst({
    where: { shopId, productId: productGid },
  });
  if (!existing) return false;

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) return false;

  const graphql = await adminGraphql(shop.domain);
  const product = await fetchProduct(graphql, productGid);

  // A product the Admin API no longer returns has been deleted, and its page
  // is a claim about something that does not exist.
  if (!product) {
    await db.mirrorCache.delete({ where: { id: existing.id } });
    return true;
  }

  const prefs = await prefsFor(shopId);
  const stillGood =
    eligibility(product, prefs) === "eligible" &&
    existing.handle === (product.handle ?? null);
  if (stillGood) return false;

  await db.mirrorCache.delete({ where: { id: existing.id } });
  return true;
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

// `hasWithdrawableAutoValues` lives in facts.server.ts, next to the state
// semantics it reads, and is re-exported here because this module is where
// the two call sites below are. It moved out because a test that imports it
// from here also loads db.server and admin.server, and admin.server calls
// shopifyApp() at module load, which throws without SHOPIFY_APP_URL - green
// locally where .env exists, red in CI where it does not.
export { hasWithdrawableAutoValues } from "./facts.server";

/** One product on the "worth ten minutes of writing" list: its title and the
 * attribute families its own description produced. The families are kept as
 * names, not a count, so the screen can say which ones are missing by
 * comparing against the families the rest of the catalogue does state - no
 * second pass, and no list of families invented for the purpose.
 *
 * The product id travels with the title so the row can be opened. A title on
 * its own names a product the merchant then has to go and find, and after a
 * rename or a deletion it names something that no longer exists; the id is
 * what still resolves. It is absent on reports written before this field, and
 * the screen renders those rows as plain text rather than as a dead link. */
export type WeakProduct = { title: string; families: string[]; id?: string };

export type DryRunReport = {
  sampled: number;
  none: number;
  byAttr: [string, number][];
  /** One entry per PRODUCT per family - see coverage(). This is the tally that
   * has `sampled` as its denominator; `byAttr` counts values and does not. */
  byAttrProducts: [string, number][];
  /** One entry per product, distinct families each produced - see coverage(). */
  depth: number[];
  wouldSkip: number;
  examples: { title: string; facts: Fact[] }[];
  /** The ten products that produced the fewest distinct families, fewest
   * first. Absent on reports written before this field existed, which the
   * Report screen states rather than rendering as an empty list. */
  weakest: WeakProduct[];
  /** Whether Shopify's download matched the counts it reported for itself,
   * and both count pairs, so a short pass can say so instead of looking like
   * a catalogue that shrank. Absent on reports written before these fields. */
  complete?: boolean;
  expected?: { root: number; objects: number };
  read?: { root: number; objects: number };
  /** What the reconciliation at the end of the pass withdrew, adopted and
   * queued. Absent on dry runs, which write nothing and withdraw nothing. */
  reconciled?: Reconciliation;
};

export async function runBulkExtract(
  shopId: string,
  options: {
    dryRun: boolean;
    onProgress?: (done: number, total: number) => Promise<void>;
    /** How the reconciliation queues a page for a product that has none.
     * The worker passes its own helper so the job lands on the same queue
     * with the same job key; the default is the ordinary enqueue path. */
    addJob?: (productGid: string) => Promise<void>;
    log?: (message: string) => void;
  },
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

  // The merchant's toggles widen or narrow the read itself: with unlisted
  // products excluded they are not read by the pass at all, which is what the
  // help text on the Report screen promises.
  const prefs = await prefsFor(shopId);
  const catalogue = await fetchAllProducts(graphql, catalogueQuery(prefs));
  const products = catalogue.products;
  const engineOptions = { extraStopwords };

  // Publish the total straight away, so the progress bar has a scale before
  // the first batch finishes.
  if (options.onProgress) await options.onProgress(0, products.length);

  const report: DryRunReport = {
    ...coverage(products, dictionary, engineOptions),
    wouldSkip: 0,
    examples: [],
    weakest: [],
    complete: catalogue.complete,
    expected: catalogue.expected,
    read: catalogue.read,
  };

  // Collected across the whole pass and cut to ten at the end, so the list is
  // the catalogue's ten weakest and not the ten weakest of whatever happened
  // to come first. Held as names, written as ten rows.
  const perProductFamilies: WeakProduct[] = [];

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
    perProductFamilies.push({
      title: product.title,
      id: product.id,
      families: Array.from(new Set(facts.map((f) => f.k))),
    });

    // Fix: previously guarded by `facts.length > 0` alone, so a full re-run
    // over a product whose description no longer yields anything skipped
    // writeFacts entirely and never withdrew stale auto values - the same
    // bug already fixed on the webhook path (extractOneProduct). Widened to
    // also enter when this product has something written to withdraw,
    // checked from metafields already in hand (hasWithdrawableAutoValues),
    // so a product with genuinely nothing ever written and nothing found
    // now still costs nothing extra.
    // Facts the variants contradict move to the variants (PRD §5.4): a
    // description's "culoare: gri" is false for the beige variant. Split
    // before the write guard, because the mirror row below needs the
    // product-level facts whether or not there is anything to write.
    const split = splitFactsByLevel(facts, product.variants ?? []);
    if (product.handle) handleById.set(product.id, product.handle);

    if (!options.dryRun && (facts.length > 0 || hasWithdrawableAutoValues(product))) {
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
    }

    // The query filter is no longer the whole answer: it cannot express
    // "sold out and the merchant excludes sold-out products", and it is a
    // statement about what was asked for rather than about what the
    // product is. So the verdict is taken here, per product, from the same
    // function every other path uses. A product that does not qualify gets
    // no row, and the reconciliation at the end removes an old one; its
    // metafields are still written, because its own product page renders
    // them wherever Shopify renders the product.
    //
    // Outside the write guard on purpose (QA of 3 September 2026, wave fix 3):
    // the row is about the product being public, not about it having facts.
    // Inside the guard, a product with nothing to extract got no row from
    // the pass, the reconciliation below then queued one extract_product per
    // such product after every Fill catalogue, and each of those wrote the
    // row one Admin round trip at a time - hundreds of jobs on a large store
    // to produce what the pass had in memory.
    if (!options.dryRun && eligibility(product, prefs) === "eligible") {
      await cacheMirror(shopId, shop.domain, product, split.productFacts, business, shopInfo);
    }

    done += 1;
    if (options.onProgress && done % 10 === 0) {
      await options.onProgress(done, products.length);
    }
  }

  if (!options.dryRun && batch.length > 0) await flush();
  if (options.onProgress) await options.onProgress(products.length, products.length);

  // Fewest families first, then by title so two products with the same count
  // do not swap places between two passes of the same catalogue.
  report.weakest = [...perProductFamilies]
    .sort((a, b) => a.families.length - b.families.length || a.title.localeCompare(b.title))
    .slice(0, 10);

  // The pass has the read in hand, so a merchant who presses Fill catalogue
  // gets the withdrawal immediately rather than next Monday. Never on a dry
  // run: a dry run writes nothing, so it must take nothing away either.
  if (!options.dryRun) {
    report.reconciled = await reconcileMirrors(
      { id: shopId, domain: shop.domain },
      catalogue,
      prefs,
      options.addJob ??
        (async (productGid: string) => {
          await enqueue(
            "extract_product",
            { shopId, productGid },
            { jobKey: `extract:${productGid}` },
          );
        }),
      options.log,
    );
  }

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
  if (!product) {
    // The product is gone. The normal route is the products/delete webhook,
    // which removes the row itself; this is the case where that webhook was
    // lost and a queued products/update job ran after the deletion. Until
    // 3 September 2026 this returned before the withdrawal, so a paying shop
    // kept the page of a deleted product until the weekly sweep while a shop
    // without access lost it in a minute (withdrawIfIneligible handles the
    // same null). Same rule on both paths now (QA wave fix 2).
    await db.mirrorCache.deleteMany({ where: { shopId, productId: productGid } });
    return empty;
  }

  // One decision function, reading the product's own state and the
  // merchant's two toggles. A draft, an archived product, one active but not
  // published to the Online Store, an unlisted one while unlisted products
  // are excluded, and a sold-out one while sold-out products are excluded all
  // lose their public page here. Extracted facts, summary and questions are
  // still written to metafields on every verdict - they render on the
  // product's own page wherever Shopify renders it.
  const prefs = await prefsFor(shopId);
  const isPublished = eligibility(product, prefs) === "eligible";
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
