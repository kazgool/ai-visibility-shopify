// Weekly SEO watch (SEO screen Part 5): a merchant who switches theme and
// silently loses the app embed, or whose theme update drops a node type,
// finds out from a dated line rather than never.
//
// No .server suffix on purpose: every function here is pure, no database, no
// fetch, so the SEO screen's client bundle can import formatSeoWatchLine
// directly without pulling a server-only module into the browser build.

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
