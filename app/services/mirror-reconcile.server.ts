// One reconciliation of MirrorCache against the catalogue, three callers
// (PRD-PORT-1.7.8 section I.3): the weekly sweep, the end of a catalogue
// pass, and the job a toggle change enqueues.
//
// Why this exists. One table is the whole public set: the proxy serves any
// MirrorCache row by handle, and llms.txt and agents.md list every row the
// shop has. Nothing on the request path checks the product's state, by
// design - no Admin API on a public request - so a row that should not exist
// is two leaks at once, a text page and an index entry pointing at it. The
// row therefore has to be removed at the moment the state changes, or by a
// later check like this one.
//
// The four holes it closes, each of which left a page serving indefinitely:
// a lost products/update on a paid shop (the row has a productId, so the old
// orphan cleanup never matched it); any shop without paid access, where the
// entitlement gate returned before the withdrawal branch was ever reached; a
// renamed product, whose old-handle row kept answering 200; and a lost
// products/delete.
//
// The single delete statement below is the whole fix: a row is kept only
// because a product that is eligible right now has that handle. Unpublished,
// drafted, archived, deleted, renamed, excluded by a merchant toggle, and
// rows written before the productId column all fall out of that one rule.

import db from "../db.server";
import type { CatalogueRead } from "./catalogue.server";
import type { ProductInput } from "./facts.server";
import { eligibility, type PublishPrefs } from "./eligibility";

export type Reconciliation = {
  /**
   * True when nothing was deleted because the read could not be trusted:
   * either it was incomplete, or it parsed products but none was eligible.
   */
  skipped: boolean;
  /** Root counts, for the log and the JobRun report. */
  expected: number;
  read: number;
  /** Rows removed. */
  deleted: number;
  /** NULL-productId rows given their productId. */
  adopted: number;
  /** Eligible products with no row, sent to extract_product. */
  queued: number;
};

export async function reconcileMirrors(
  shop: { id: string; domain: string },
  read: CatalogueRead,
  prefs: PublishPrefs,
  /**
   * Queue extract_product for an eligible product with no row. A caller on a
   * shop without paid access passes one that returns `false` and queues
   * nothing, so `queued` in the summary counts jobs that exist, not calls.
   */
  addJob: (productGid: string) => Promise<void | boolean>,
  log: (message: string) => void = () => {},
): Promise<Reconciliation> {
  const summary: Reconciliation = {
    skipped: false,
    expected: read.expected.root,
    read: read.read.root,
    deleted: 0,
    adopted: 0,
    queued: 0,
  };

  // A truncated download would otherwise empty the mirror, which is the
  // unrecoverable direction. Skipping costs one week; deleting wrongly costs
  // every page the shop had. Said out loud in the log rather than passed over
  // in silence, because "nothing happened" and "nothing was safe to do" are
  // not the same report.
  if (!read.complete) {
    summary.skipped = true;
    log(
      `reconcile ${shop.domain}: bulk download short (${read.read.root} of ${read.expected.root} products, ` +
        `${read.read.objects} of ${read.expected.objects} objects), nothing deleted`,
    );
    return summary;
  }

  const eligibleByHandle = new Map<string, ProductInput>();
  for (const product of read.products) {
    if (!product.handle) continue;
    if (eligibility(product, prefs) !== "eligible") continue;
    eligibleByHandle.set(product.handle, product);
  }
  const handles = [...eligibleByHandle.keys()];

  // The floor on the eligible set (QA of 3 September 2026, blocking 1). A read
  // that parsed products but found none eligible is far more likely to be a
  // field that stopped arriving - status, handle, onlineStoreUrl - than a
  // catalogue that really has no public product left. `complete` cannot tell
  // the two apart, since it counts products, not fields. Acting on it would
  // delete every row for the shop and report success, and nothing could
  // re-queue afterwards because nothing is eligible. A root count of zero is
  // different: Shopify announced no products, and emptying the mirror is
  // exactly right (I.6 row 7).
  if (read.read.root > 0 && handles.length === 0) {
    summary.skipped = true;
    log(
      `reconcile ${shop.domain}: ${read.read.root} products read, none eligible, nothing deleted`,
    );
    return summary;
  }

  // Adopt first, so a row written before the productId column stops being
  // invisible to the per-product withdrawal path and stops being undercounted
  // by the "pages served" figure on the Report screen. This is the adoption
  // dropStaleMirror does one product at a time, done in bulk.
  const orphans = await db.mirrorCache.findMany({
    where: { shopId: shop.id, productId: null },
  });
  for (const row of orphans) {
    const product = eligibleByHandle.get(row.handle);
    if (!product) continue;
    await db.mirrorCache.update({
      where: { id: row.id },
      data: { productId: product.id },
    });
    summary.adopted += 1;
  }

  // No productId clause on purpose. Matching on the handle set alone is what
  // makes the statement cover a row whose product was deleted, renamed, or
  // never had a productId at all. The second arm is reached only when the root
  // count is zero (the floor above returns otherwise): every row goes, which
  // is what an empty catalogue means.
  const { count } = handles.length
    ? await db.mirrorCache.deleteMany({
        where: { shopId: shop.id, handle: { notIn: handles } },
      })
    : await db.mirrorCache.deleteMany({ where: { shopId: shop.id } });
  summary.deleted = count;

  // The handle set alone cannot see a swap: A renamed x to y and B renamed z
  // to x in the same window leaves a row {handle: x, productId: A} that the
  // delete above keeps, because x is eligible, and the queue below skips,
  // because a row for x exists. The page at /x then serves A's text under
  // B's URL until B is next edited, reported as a clean pass. So a row whose
  // productId is set and is not the product that owns that handle now is
  // withdrawn too, and its handle re-queued (QA of 3 September 2026, wave
  // fix 7). NULL-productId rows are not judged here: adoption above already
  // claimed the ones that match, and an unmatched one has no handle in the
  // eligible set and was deleted with the rest.
  const survivors = await db.mirrorCache.findMany({
    where: { shopId: shop.id, productId: { not: null } },
    select: { id: true, handle: true, productId: true },
  });
  for (const row of survivors) {
    const owner = eligibleByHandle.get(row.handle);
    if (!owner || owner.id === row.productId) continue;
    await db.mirrorCache.delete({ where: { id: row.id } });
    summary.deleted += 1;
  }

  const remaining = await db.mirrorCache.findMany({
    where: { shopId: shop.id },
    select: { handle: true },
  });
  const have = new Set(remaining.map((r: { handle: string }) => r.handle));

  // Queueing is processing, so it is gated where extract_product is gated:
  // on a shop without paid access these jobs return before writing anything,
  // and that is correct. Withdrawal above is not gated, because deleting our
  // own row writes nothing to Shopify and costs no pass.
  for (const [handle, product] of eligibleByHandle) {
    if (have.has(handle)) continue;
    if ((await addJob(product.id)) === false) continue;
    summary.queued += 1;
  }

  log(
    `reconcile ${shop.domain}: ${summary.deleted} page(s) withdrawn, ${summary.adopted} adopted, ` +
      `${summary.queued} queued, from ${summary.read} of ${summary.expected} products`,
  );
  return summary;
}
