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
  | "A6"
  | "A7"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "B5"
  | "B6"
  | "B7"
  | "B8"
  | "B9"
  // B10 to B24: the on-page checks of PRD-SEO-FULL-ONPAGE sections 3 and 5a,
  // built 4 September 2026. All source B - each one is read off the product's
  // public page, or (B16, B19) off what fetching it and its links answered.
  | "B10"
  | "B11"
  | "B12"
  | "B13"
  | "B14"
  | "B15"
  | "B16"
  | "B17"
  | "B18"
  | "B19"
  | "B20"
  | "B21"
  | "B22"
  | "B23"
  | "B24";

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
  // Per collection, not per product. Its denominator is the collections read
  // by the last collections check, never the catalogue - the card keeps the
  // two apart the same way it keeps A denominators apart from B ones.
  A6: "Collection meta title or description absent",
  // Shopify owns sitemap.xml and offers no way to edit it, so this row can
  // only ever report. The fix is always a product setting.
  A7: "Not listed in the shop's sitemap",
  B1: "No Product node on the page, or two of them",
  B2: "Canonical points somewhere other than this page",
  B3: "The page tells search engines not to index it",
  B4: "The app block was not detected on the page",
  B5: "The page could not be read as a crawler would read it",
  // B6 says "should be here and is not". A node the merchant switched off is
  // not counted (seo-nodes.ts), so the label can promise that without lying.
  B6: "Structured data this app should be adding is missing",
  // Our own output, twice on one page. Deliberately phrased about us and not
  // about the theme: B1 is the theme question, and B1's @id merge is what made
  // this invisible (4 September 2026).
  B7: "This app's structured data appears more than once on the page",
  // Distinct from B2, which asks whether the canonical is this page's own
  // address. B8 asks what shape it has: a variant URL, a collection-prefixed
  // URL, or anything that is not /products/<handle>. Shopify's `within` filter
  // produces the collection-prefixed form for every product in every
  // collection, so that case is this check and not a second one.
  B8: "Canonical does not point at the plain product URL",
  B9: "hreflang links absent on a shop with more than one market",
  // B10 and B11 name the length and never a limit. Google states there is no
  // limit on either; what happens is truncation, by device width. The method
  // line below carries Google's own wording, and the label carries none of
  // ours - "too long" is a judgement this app is not entitled to make.
  B10: "Title tag absent, or a length that a phone result often cuts",
  B11: "Meta description absent, or a length that a phone result often cuts",
  // The logo case (B12a in PRD section 5b) rides on this row rather than on a
  // code of its own: the merchant fixes it in the same place, and a second row
  // saying "and also your H1" is two rows for one heading.
  B12: "No H1 on the page, more than one, or an H1 that is the shop logo",
  B13: "Open Graph tags absent",
  B14: "Twitter card tags absent",
  B15: "Images on the page with no alt text, or an alt that reads as a filename",
  B16: "Internal links on the page that answer 4xx or 5xx",
  B17: "Short description, or a page with little text",
  B18: "Handle carries characters that do not belong in a URL",
  B19: "The product URL answers after more than one redirect, or loops",
  B20: "http resources on an https page",
  B21: "The page's title tag is the same as another page's",
  B22: "Structured data on the page that Google no longer shows",
  B23: "robots.txt has been edited, or blocks products or collections",
  B24: "Meta keywords tag on the page",
};

/**
 * The method line under a row: where a threshold comes from, or what a check
 * can and cannot see. Only the rows that need one have one.
 *
 * It exists because of the rule PRD-SEO-FULL-ONPAGE section 3 states for B10
 * and B11: "the length thresholds are stated as what Google truncates at, with
 * the source in the row's method line, not as a rule of ours. If the
 * thresholds change, the method line changes and nothing else." The same
 * applies wherever this app repeats something Google has said - B22 and B24
 * are Google's positions, not ours, and a merchant is entitled to see whose
 * they are.
 */
export const CHECK_METHOD: Partial<Record<FindingCode, string>> = {
  B10:
    "Google: \"there's no limit on how long a title element can be, the title " +
    "link is truncated as needed, typically to fit the device width.\" " +
    "30 to 60 characters is the industry's estimate of what a phone shows in " +
    "full, not a rule of this app and not a limit of Google's.",
  B11:
    "Google describes the same truncation for the description snippet: it is " +
    "cut to fit the device, and there is no stated length. 70 to 160 " +
    "characters is the industry's estimate of what is shown in full.",
  B15:
    "The same test the alt text writer uses (looksLikeMachineAlt): a filename, " +
    "an HTML entity, a UUID, or a camera or upload prefix such as IMG_ or " +
    "DSC_. An alt written as an empty string is counted separately, because " +
    "that is the correct markup for a decorative image.",
  B16:
    "At most 20 links per page, each distinct address fetched once per pass " +
    "and charged once to the same daily budget as the pages. A page with more " +
    "says how many of its links were checked.",
  B17: "Word counts, from the page's own description and its visible text. Nothing here is a target.",
  B19:
    "The chain is followed manually, up to five hops. One redirect is reported " +
    "by the response row instead; this row is for two or more, and for a loop.",
  B21:
    "Compared against the title tags stored for this shop's other pages, so a " +
    "catalogue part-way through its first page pass reports fewer duplicates " +
    "than it has and never more.",
  B22:
    "Google removed HowTo results in 2023 and FAQ results for every site on 7 " +
    "May 2026. The nodes stay valid schema.org and assistants still read them, " +
    "so this app emits an FAQPage of its own on purpose. The row is here so " +
    "nobody expects a Google feature from it.",
  B23:
    "Shopify calls editing robots.txt.liquid an unsupported customisation that " +
    "can result in loss of all traffic. Read once per pass; the lines Shopify " +
    "ships by default are listed separately from the rest.",
  B24:
    "Google does not use the keywords meta tag; it has no effect on indexing. " +
    "The row says so once so that nobody keeps maintaining the list.",
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
