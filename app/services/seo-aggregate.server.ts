// Reading the SeoScan table for the screens (PRD-SEO-PER-PRODUCT build steps
// 4 to 6). The judgements themselves are in seo-aggregate.ts, which is pure;
// this file only fetches rows and hands them over.
//
// Why it reads in batches rather than one findMany. An aggregate is a
// question about the whole catalogue, so every row has to be looked at - a
// 20,000-product store means 20,000 rows on the SEO screen. Folding each
// batch into the counters and dropping it keeps peak memory at one batch
// instead of the whole table, which is the difference between a screen that
// works on the largest supported store and one that only works on the store
// we happen to test against. The projection is deliberately narrow for the
// same reason: `offer`, `canonical` and `cacheControl` are never read by any
// aggregate and are not fetched.

import db from "../db.server";
import {
  buildFindingsAggregate,
  buildThemeNodeAggregate,
  createFindingsCounters,
  createThemeNodeCounters,
  foldFindingsRow,
  foldThemeNodeRow,
  type FindingsAggregate,
  type ScanRowLike,
  type ThemeNodeAggregate,
} from "./seo-aggregate";
import { findingsOf } from "./seo-findings";
import { unavailableChecks } from "./seo-scan.server";
import { marketsInfo } from "./seo-page.server";

/** Rows per round trip. Large enough to be few queries, small enough to hold. */
export const READ_BATCH = 1000;

/**
 * How many products a "list of products with this finding" screen will show.
 * A cap rather than full pagination over a filter the database cannot index:
 * the screen says which cap it hit, so a merchant is never left thinking 250
 * is the whole answer.
 */
export const FINDING_LIST_CAP = 250;

type Batch = ScanRowLike & { id: string };

/**
 * Every row for a shop, a batch at a time, ordered by id so the cursor is
 * stable even while the nightly pass is writing scannedAt underneath us.
 */
async function forEachRow(
  shopId: string,
  withNodes: boolean,
  visit: (row: Batch) => void,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const batch = (await db.seoScan.findMany({
      where: { shopId },
      orderBy: { id: "asc" },
      take: READ_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        productId: true,
        handle: true,
        bulkAt: true,
        scannedAt: true,
        status: true,
        findings: true,
        ...(withNodes ? { nodes: true } : {}),
      },
    })) as unknown as Batch[];
    if (batch.length === 0) return;
    for (const row of batch) visit(row);
    if (batch.length < READ_BATCH) return;
    cursor = batch[batch.length - 1].id;
  }
}

export type SeoScanAggregates = {
  findings: FindingsAggregate;
  themeNodes: ThemeNodeAggregate;
};

/**
 * The two aggregates both the SEO screen and Diagnostics read. Computed
 * together so the two screens can never disagree about the same catalogue -
 * before this, one screen recommended a mode from a single product page while
 * the other counted every page.
 */
export async function readSeoAggregates(shopId: string): Promise<SeoScanAggregates> {
  // Folded row by row, so what survives a batch is five integers and a map of
  // counts per code. Until 3 September 2026 this pushed every row - `nodes`
  // JSON included - into one array and aggregated at the end, so the batching
  // above bought nothing and a 20,000-product store held its whole scan table
  // in memory to produce a handful of numbers. The comment above and PRD
  // build step 4 both described the behaviour this now has (QA).
  const findings = createFindingsCounters();
  const themeNodes = createThemeNodeCounters();
  await forEachRow(shopId, true, (row) => {
    const view: ScanRowLike = {
      productId: row.productId,
      handle: row.handle,
      bulkAt: row.bulkAt,
      scannedAt: row.scannedAt,
      status: row.status,
      findings: row.findings,
      nodes: row.nodes,
    };
    foldFindingsRow(findings, view);
    foldThemeNodeRow(themeNodes, view);
  });
  return {
    // The markets count decides whether B9 applies at all, and no row carries
    // it - the nightly pass records it per shop (PRD section 2).
    findings: buildFindingsAggregate(findings, {
      markets: (await marketsInfo(shopId))?.count ?? null,
      // Which checks were asked for and refused on the last catalogue pass
      // (A13 and A16 need an Admin scope this app may not carry). A refused
      // read rendered as "clean" would claim a check ran and passed, which is
      // the failure every state on that list exists to prevent.
      couldNotRun: await unavailableChecks(shopId),
    }),
    themeNodes: buildThemeNodeAggregate(themeNodes),
  };
}

/**
 * The products one check found something on, for the link on each row of the
 * Findings per product card. Capped, and the caller is told whether the cap
 * was reached so the screen can say so rather than imply the list is whole.
 */
export async function productsWithFinding(
  shopId: string,
  code: string,
  cap = FINDING_LIST_CAP,
): Promise<{ productIds: string[]; capped: boolean; total: number }> {
  const productIds: string[] = [];
  let total = 0;
  await forEachRow(shopId, false, (row) => {
    if (!findingsOf(row.findings).some((f) => f.code === code)) return;
    total += 1;
    if (productIds.length < cap) productIds.push(row.productId);
  });
  return { productIds, capped: total > productIds.length, total };
}

/** The rows for the products on one page of the Products list. */
export async function scanRowsFor(
  shopId: string,
  productIds: string[],
): Promise<Map<string, ScanRowLike>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.seoScan.findMany({
    where: { shopId, productId: { in: productIds } },
    select: {
      productId: true,
      handle: true,
      bulkAt: true,
      scannedAt: true,
      status: true,
      findings: true,
    },
  });
  return new Map(rows.map((row) => [row.productId, row as ScanRowLike]));
}

/** One product's row, for the editor's "What a crawler sees on this page". */
export async function scanRowFor(
  shopId: string,
  productId: string,
): Promise<ScanRowLike | null> {
  const row = await db.seoScan.findUnique({
    where: { shopId_productId: { shopId, productId } },
    select: {
      productId: true,
      handle: true,
      bulkAt: true,
      scannedAt: true,
      status: true,
      findings: true,
      nodes: true,
      canonical: true,
      noindex: true,
      appBlock: true,
      cacheControl: true,
    },
  });
  return (row as ScanRowLike | null) ?? null;
}
