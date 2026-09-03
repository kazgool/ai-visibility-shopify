// Weekly SEO watch (SEO screen Part 5): a merchant who switches theme and
// silently loses the app embed, or whose theme update drops a node type,
// finds out from a dated line rather than never.
//
// No .server suffix on purpose: every function here is pure, no database, no
// fetch, so the SEO screen's client bundle can import formatSeoWatchLine
// directly without pulling a server-only module into the browser build.

import { findingsOf } from "./seo-findings";
import type { ThemeScanResult } from "./theme-scan.server";

export type SeoWatchChange = {
  page: "product" | "home";
  nodeType: string;
  detectedAt: string; // ISO date the change was recorded
};

/** Distinct top-level types present on a page scan; empty when unreadable. */
function typesOn(page: ThemeScanResult["product"] | ThemeScanResult["home"]): Set<string> {
  const set = new Set<string>();
  if (!page || page.passwordProtected) return set;
  for (const node of page.nodes) {
    for (const type of node.types) set.add(type);
  }
  return set;
}

/**
 * Compare last week's scan to this week's and report every node type that
 * was present before and is absent now. Additions are not reported here -
 * this job exists to catch loss, not to celebrate growth. Pure and total:
 * a previous scan that could not be read (password wall at the time) yields
 * no comparison rather than a false "everything disappeared".
 */
export function diffThemeScans(
  previous: ThemeScanResult | null,
  current: ThemeScanResult,
  detectedAt: string,
): SeoWatchChange[] {
  if (!previous) return [];

  const changes: SeoWatchChange[] = [];

  const pages: Array<["product" | "home", ThemeScanResult["product"], ThemeScanResult["product"]]> = [
    ["product", previous.product, current.product],
    ["home", previous.home, current.home],
  ];

  for (const [page, prevPage, currPage] of pages) {
    if (!prevPage || prevPage.passwordProtected) continue;
    if (!currPage) continue; // this run did not scan that page - nothing to compare

    const before = typesOn(prevPage);
    const after = typesOn(currPage);
    for (const type of before) {
      if (!after.has(type)) {
        changes.push({ page, nodeType: type, detectedAt });
      }
    }
  }

  return changes.sort((a, b) => a.page.localeCompare(b.page) || a.nodeType.localeCompare(b.nodeType));
}

/** "On 14 September, BreadcrumbList was no longer found on the product page." */
export function formatSeoWatchLine(change: SeoWatchChange): string {
  const date = new Date(change.detectedAt).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
  });
  const pageLabel = change.page === "product" ? "product page" : "home page";
  return `On ${date}, ${change.nodeType} was no longer found on the ${pageLabel}.`;
}

// --- per-product mode (PRD-SEO-PER-PRODUCT section 4, build step 6) ---------
//
// The theme diff above answers "did this store stop emitting a node type".
// It cannot answer "which products changed", because it reads one product
// page and one home page: a theme that emits a node on one template and not
// another, or a handle renamed on Tuesday, is invisible to it. The per-product
// diff reads the SeoScan rows instead, so the Monday line names products.
//
// Additions are reported here, unlike in the theme diff. That difference is
// deliberate and is a difference in what the two things are: a node type that
// disappeared is a loss, and there is nothing to celebrate in one appearing.
// A finding that appeared is itself the loss - a product that gained B3 on
// Tuesday is a product that stopped being indexable on Tuesday.

/** One product's findings, as the snapshot stores them. Codes only. */
export type ProductSnapshot = Record<string, string[]>;

export type ProductFindingChange = {
  productId: string;
  handle: string | null;
  /** Codes this product did not have last week and has now. */
  added: string[];
  /** Codes it had last week and no longer has. */
  removed: string[];
  detectedAt: string;
};

/**
 * The snapshot to compare next week against. Products with no findings are
 * left out: a clean catalogue of 20,000 products would otherwise store 20,000
 * empty entries every week, and their absence carries exactly the same
 * meaning as an empty list when the diff reads them back.
 */
export function snapshotFindings(
  rows: { productId: string; findings: unknown }[],
): ProductSnapshot {
  const out: ProductSnapshot = {};
  for (const row of rows) {
    const codes = [...new Set(findingsOf(row.findings).map((f) => f.code))].sort();
    if (codes.length > 0) out[row.productId] = codes;
  }
  return out;
}

/**
 * Which products changed since the snapshot, by code.
 *
 * A product absent from `previous` and present in `current` is a product that
 * gained its first finding, which is a change and is reported. A product
 * absent from both never appears, which is the whole point of leaving clean
 * products out of the snapshot.
 *
 * Returns nothing at all when there is no previous snapshot: the first week
 * has nothing to compare against, and reporting every finding on the
 * catalogue as "changed on Monday" would be false about all of them - the
 * same rule diffThemeScans keeps for a missing previous scan.
 */
export function diffProductFindings(
  previous: ProductSnapshot | null,
  current: ProductSnapshot,
  detectedAt: string,
  handles: Map<string, string | null> = new Map(),
): ProductFindingChange[] {
  if (!previous) return [];

  const changes: ProductFindingChange[] = [];
  const productIds = new Set([...Object.keys(previous), ...Object.keys(current)]);

  for (const productId of [...productIds].sort()) {
    const before = new Set(previous[productId] ?? []);
    const after = new Set(current[productId] ?? []);
    const added = [...after].filter((c) => !before.has(c)).sort();
    const removed = [...before].filter((c) => !after.has(c)).sort();
    if (added.length === 0 && removed.length === 0) continue;
    changes.push({
      productId,
      handle: handles.get(productId) ?? null,
      added,
      removed,
      detectedAt,
    });
  }
  return changes;
}

/**
 * "On 8 September, a-chair gained B3 and lost A5." The handle rather than the
 * title because the handle is what the row stores and what the page address
 * uses; a title would need a catalogue read the watch does not do.
 */
export function formatProductWatchLine(change: ProductFindingChange): string {
  const date = new Date(change.detectedAt).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
  });
  const who = change.handle ?? change.productId.split("/").pop();
  const parts: string[] = [];
  if (change.added.length > 0) parts.push(`gained ${change.added.join(", ")}`);
  if (change.removed.length > 0) parts.push(`lost ${change.removed.join(", ")}`);
  return `On ${date}, ${who} ${parts.join(" and ")}.`;
}
