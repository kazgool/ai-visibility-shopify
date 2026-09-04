// The finding vocabulary of the per-product SEO scan: the codes, the shape of
// a finding, and the label each check reads under (PRD-SEO-PER-PRODUCT
// section 2.1).
//
// Split out of seo-scan.ts on 3 September 2026, build step 4, and this is the
// reason. seo-scan.ts holds the checks, and the checks need classifyMetaField
// from seo.server for A5 - a legitimate dependency for a module that only
// ever runs in a catalogue pass. But build step 4 put these labels on three
// merchant-facing screens, so seo-aggregate.ts (and through it the Products
// list and the product editor) now reaches them from the browser bundle, and
// a client build that reaches a .server module fails outright. It failed
// exactly that way before this file existed:
//
//     './seo.server' imported by 'app/services/seo-scan.ts'
//
// Same reason meta-column.ts and conflicts.ts exist. Everything here is data
// and pure predicates - no database, no fetch, no Admin API, nothing that
// imports anything with a ".server" suffix. seo-scan.ts re-exports all of it,
// so every existing caller and every existing test keeps the import it had.

/** Stable across releases: the weekly diff says "A1 changed on Tuesday". */
export type FindingCode =
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "A5"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "B5"
  | "B6";

/** Which read the finding came from. Stated on the row, never mixed. */
export type FindingSource = "A" | "B" | "A+B";

export type Finding = {
  code: FindingCode | string;
  source: FindingSource;
  detail: Record<string, unknown>;
};

/**
 * Labels for the SEO card. One line per check, no store-specific wording, and
 * no sentence that promises a result Google decides (PRD section 5, the last
 * acceptance row). A1 read "Missing identifiers for rich results" until build
 * step 4 put the label on a merchant-facing screen: supplying a GTIN does not
 * earn a rich result, it removes one reason not to get one, and the row now
 * says what is absent rather than what would follow.
 */
export const CHECK_LABEL: Record<FindingCode, string> = {
  A1: "Missing product identifiers: GTIN, brand, SKU or image",
  A2: "Offer on the page disagrees with the product",
  A3: "Meta title or description shared with another product",
  A4: "Handle renamed with no redirect from the old one",
  A5: "Meta title or description absent",
  B1: "No Product node on the page, or two of them",
  B2: "Canonical points somewhere other than this page",
  B3: "The page tells search engines not to index it",
  B4: "The app block was not detected on the page",
  B5: "The page could not be read as a crawler would read it",
  // B6 says "should be here and is not". A node the merchant switched off is
  // not counted (seo-nodes.ts), so the label can promise that without lying.
  B6: "Structured data this app should be adding is missing",
};

/**
 * Which source owns a finding. Source A owns exactly the findings whose
 * `source` is "A"; source B owns "B" and "A+B" (A2 is computed from the page
 * against the offer facts source A stored). Both write into the same
 * `findings` column, so each must rewrite only its own half - without this
 * rule the next catalogue pass would erase every page finding, and the next
 * page scan would erase every catalogue finding.
 */
export function isSourceAFinding(finding: Finding): boolean {
  return finding.source === "A";
}

/** The findings on a stored row, defensively: the column is json. */
export function findingsOf(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is Finding => !!f && typeof f === "object" && typeof (f as any).code === "string",
  );
}
