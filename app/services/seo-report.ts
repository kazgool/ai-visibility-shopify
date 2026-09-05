// The printable report and the spreadsheet exports for the merchant SEO
// dashboard (PRD-SEO-FULL-ONPAGE section 4.3, build step 6).
//
// Everything here is pure: no Prisma, no fetch, no Shopify. That is what lets
// the same functions feed the screen, the print page and the CSV writers, and
// it is the whole mechanism behind the rule this step was asked for - the
// print page and the screen cannot show different figures, because neither of
// them computes a figure. `dashboardDerived` is called once by each, and the
// two things it returns are the only derived values on either page.
//
// The vocabulary rule is the screen's rule, unchanged: OWNER_LABEL and
// OWNER_STEPS, never CHECK_LABEL, and no check code anywhere. A merchant is
// handed these files. The operator exports under /app/seo keep their own
// vocabulary and are untouched by this file.
//
// And the rule the whole app keeps: a check that could not run is a sentence,
// never a zero. Every count column below is a string for exactly that reason -
// a numeric column cannot hold "not checked yet", and a spreadsheet full of
// zeros for checks that never ran is the "0 of 50" failure in CLAUDE.md in a
// form the merchant can sort by.

import { csvRows } from "./report-metrics";
import {
  FINDING_OWNER,
  OWNER_LABEL,
  OWNER_STEPS,
  findingsOf,
  type FindingCode,
} from "./seo-findings";
import {
  GROUP_WORD,
  columnAccount,
  groupWordFor,
  listingMethod,
  listingReadiness,
  shopWideItems,
  shopWideMethod,
  type ListingReadiness,
  type Readiness,
  type ShopWideItem,
} from "./seo-readiness";
import type { CheckRow, CheckState, FindingsAggregate, ScanRowLike } from "./seo-aggregate";
import type { FactsRow } from "./seo-since";

// ---------------------------------------------------------------------------
// The one place the screen and the report agree
// ---------------------------------------------------------------------------

/**
 * What both pages are given. The unlocked branch of SeoDashboardData is
 * assignable to this; it is spelled structurally here so a service never has
 * to import a component.
 */
export type DashboardSource = {
  domain: string;
  findings: FindingsAggregate;
  readiness: Readiness;
  since: { before: FactsRow | null; today: FactsRow | null };
  business: { deliveryStated: boolean; returnsStated: boolean } | null;
  published: {
    at: string | null;
    reasons: { nodeType: string; emitted: boolean; reason: string | null }[];
  };
};

export type DashboardDerived = {
  listing: ListingReadiness;
  wide: ShopWideItem[];
};

/**
 * The two derived values on the dashboard, computed once.
 *
 * This used to be eighteen lines inline in the screen component. It moved here
 * the moment a second page had to show the same figures, because the only
 * honest way to promise that two pages agree is to give them nothing of their
 * own to compute.
 */
export function dashboardDerived(data: DashboardSource): DashboardDerived {
  const today = data.since.today;
  const listing = listingReadiness(
    today
      ? {
          products: today.products,
          withVendor: today.withVendor,
          withImage: today.withImage,
          withBarcode: today.withBarcode,
        }
      : null,
    data.business,
    // One source for "has the catalogue been read": the rows this screen
    // counts everything else from, not whether a snapshot row happens to
    // exist. The two are different questions.
    data.findings.bulkRead,
  );
  const wide = shopWideItems(data.readiness, {
    deliveryStated: data.business ? data.business.deliveryStated : null,
    returnsStated: data.business ? data.business.returnsStated : null,
    barcode: today ? { have: today.withBarcode, of: today.products } : null,
    catalogue: today ? today.products : data.findings.bulkRead > 0 ? data.findings.bulkRead : null,
    publishedReasons: data.published.reasons.length > 0 ? data.published.reasons : null,
  });
  return { listing, wide };
}

/**
 * What the Google card says instead of ten bars when nothing has been counted.
 * It lives here rather than in the screen because the report says it too, and
 * two copies of a sentence are two sentences that can drift.
 */
export const LISTING_UNMEASURED_SENTENCE =
  "Your products have not been read yet, so none of these has been counted. The first read " +
  "fills this card in.";

export type KeyFigure = {
  key: string;
  value: string;
  label: string;
  /** The denominator sentence. Null only where there is honestly none. */
  of: string | null;
  method: string;
};

/**
 * Every headline figure on the dashboard, as the strings both pages print.
 *
 * The acceptance test walks this list and asserts each `value` and each `of`
 * appears in the rendered screen and in the rendered report. The list is not
 * documentation of the figures - it is the figures: the print page renders
 * from it, so a figure that left this list would vanish from the report rather
 * than quietly disagree with the screen.
 */
export function keyFigures(data: DashboardSource, derived: DashboardDerived): KeyFigure[] {
  const r = data.readiness;
  const figures: KeyFigure[] = [];

  if (r.readSet > 0) {
    figures.push({
      key: "clean",
      value: String(r.clean),
      label: "products with nothing of their own to fix",
      of: `of ${r.products} in your catalogue`,
      method:
        "Counted over every product in the catalogue, so a product whose page has not been " +
        "read yet is not counted as clean.",
    });
    figures.push({
      key: "needSomething",
      value: String(r.needSomething),
      label: "products needing something specific",
      of: `of ${r.products} in your catalogue`,
      method: "One product is counted once, under the owner of its most immediate problem.",
    });
    figures.push({
      key: "shopWide",
      value: String(derived.wide.length),
      label: "fixes that cover the whole shop",
      of: null,
      method: shopWideMethod(r, derived.wide),
    });
  }

  // The Google card only contributes a figure once something has been counted.
  // The screen replaces it with a sentence when the catalogue has never been
  // read, and the report has to do the same: "0 of 10" on a shop nothing has
  // read is a fabricated zero, and on paper it is a fabricated zero that gets
  // handed to somebody. The render test across the five stores is what caught
  // this - the figure list emitted it unconditionally and the screen did not.
  if (!derived.listing.unmeasured) {
    figures.push({
      key: "listing",
      value: `${derived.listing.inPlace} of ${derived.listing.total}`,
      label: "details Google asks for, in place",
      of: null,
      method: listingMethod(derived.listing),
    });
  }

  for (const group of r.groups) {
    figures.push({
      key: `group-${group.group}`,
      value: String(group.count),
      label: group.title,
      of: `of ${group.denominator}`,
      method: group.summary,
    });
  }

  return figures;
}

/**
 * The sentence at the top of the report: which shop, read how far, on what
 * date. It is the first line of every CSV too, so a file on a desktop is
 * self-describing even after it has been renamed.
 */
export function reportHeading(data: DashboardSource, today: Date): string {
  const r = data.readiness;
  const scope =
    r.readSet > 0
      ? `${r.readSet} of ${r.products} products fully checked`
      : `${r.products} products in the catalogue`;
  return `${data.domain} - ${scope} - report produced ${isoDay(today)}`;
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/** The date as YYYY-MM-DD in UTC, the only form that sorts in a file listing. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * A filename a merchant with three of these on their desktop can tell apart:
 * the shop, the table, the date. The domain is reduced to the characters a
 * Content-Disposition header and every filesystem accept, which also means the
 * value can never carry a quote out of the header it sits in.
 */
export function exportFilename(domain: string, table: string, date: Date): string {
  const shop = domain
    .toLowerCase()
    .replace(/\.myshopify\.com$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `ai-visibility-seo-${shop || "shop"}-${table}-${isoDay(date)}.csv`;
}

// ---------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------

export const EXPORT_TABLES = ["findings", "shopwide", "listing", "products"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

export function isExportTable(value: string | undefined): value is ExportTable {
  return value !== undefined && (EXPORT_TABLES as readonly string[]).includes(value);
}

/** What a merchant reads instead of a state name from the check vocabulary. */
const STATE_WORD: Record<CheckState, string> = {
  found: "Found on some products",
  clean: "Checked, nothing found",
  notYetRead: "Not checked yet",
  notApplicable: "Does not apply to this shop",
  couldNotRun: "Could not be checked",
  counted: "Counted, no verdict given",
};

/** Which read a row came from, in the words the screen's two columns use. */
function sideWord(row: CheckRow): string {
  return row.source === "A" ? "Found in your Shopify admin" : "Found by reading your pages";
}

function totalsSentence(row: CheckRow): string | null {
  if (!row.totals) return null;
  const parts = Object.entries(row.totals).map(([name, value]) => `${name}: ${value}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

/**
 * The count column.
 *
 * It is a string and never a number, because three of the six states have no
 * count to give and must not be able to export as a zero. A merchant who sorts
 * this column descending sees the real findings at the top and the sentences at
 * the bottom, which is the correct order for both.
 */
function countCell(row: CheckRow): string {
  switch (row.state) {
    case "found":
      return String(row.count);
    case "clean":
      return "0";
    case "counted":
      return totalsSentence(row) ?? "Counted, no verdict given";
    case "notYetRead":
      return "Not checked yet";
    case "notApplicable":
      return "Does not apply here";
    case "couldNotRun":
      return row.reason ? `Could not be checked: ${row.reason}` : "Could not be checked";
  }
}

function denominatorCell(row: CheckRow): string {
  if (row.state === "notYetRead" || row.denominator === 0) {
    return row.source === "A"
      ? "No product has been read from your catalogue yet"
      : "No product page has been read yet";
  }
  return String(row.denominator);
}

const FINDINGS_HEADER = [
  "What we looked for",
  "Whose it is",
  "Where we looked",
  "Products affected",
  "Products this could be asked of",
  "State",
  "Why it matters",
  "Where it is done",
];

/**
 * Every check the screen accounts for, one row each, in the order the screen
 * shows them: the ones with something found first, then the ones that found
 * nothing. A shop-wide check carries the fact in its State column rather than
 * being dropped, so this file and the screen account for the same checks.
 */
export function findingsCsv(data: DashboardSource, now: Date): string {
  const shopWide = new Set<string>(data.readiness.shopWideCodes);
  const rows = [...data.findings.rows, ...data.findings.clean];
  const body = rows.map((row) => {
    const steps = OWNER_STEPS[row.code];
    return [
      OWNER_LABEL[row.code] ?? row.label,
      groupWordFor(row.code),
      sideWord(row),
      countCell(row),
      denominatorCell(row),
      shopWide.has(row.code)
        ? `${STATE_WORD[row.state]} - on every product we read, so it is one fix for the whole shop`
        : STATE_WORD[row.state],
      steps ? steps.what : "",
      steps ? steps.where : "",
    ] as (string | number)[];
  });
  // The four codes that count collections and blog posts are not in CHECKS, so
  // they are not rows here either - they have their own denominators. The
  // screen's own column accounting is appended so the file says where they
  // went rather than leaving a reader to notice that 40 is not 44.
  const accounting = (["A", "B"] as const).flatMap((source) =>
    columnAccount({
      source,
      rows: data.findings.rows,
      clean: data.findings.clean,
      shopWideCodes: data.readiness.shopWideCodes,
    }).lines.map((line) => [line] as (string | number)[]),
  );

  return csvRows([
    [reportHeading(data, now)],
    [],
    FINDINGS_HEADER,
    ...body,
    [],
    ["Where every check went"],
    ...accounting,
  ]);
}

const SHOP_WIDE_HEADER = [
  "The fix",
  "Whose it is",
  "Why it matters",
  "Why it is happening",
  "What it covers",
  "Where it is done",
];

/**
 * The shop-wide card. A file with only its headings is the correct answer on a
 * shop where nothing affects every product the same way, and the two lines
 * above the table say which shop, which date and what an empty table means -
 * so nobody has to guess whether the file failed or the shop is fine. The
 * method sentence is the screen's own.
 */
export function shopWideCsv(data: DashboardSource, derived: DashboardDerived, now: Date): string {
  return csvRows([
    [reportHeading(data, now)],
    [shopWideMethod(data.readiness, derived.wide)],
    [],
    SHOP_WIDE_HEADER,
    ...derived.wide.map(
      (item) =>
        [
          item.title,
          GROUP_WORD[item.owner],
          item.what,
          item.why ?? "",
          item.appliesTo,
          item.where,
        ] as (string | number)[],
    ),
  ]);
}

const LISTING_HEADER = [
  "What Google asks for",
  "How much Google asks for it",
  "Products that have it",
  "Out of",
  "Where the figure comes from",
];

const BASIS_WORD: Record<string, string> = {
  measured: "Counted from your catalogue",
  byConstruction: "Shopify holds this on every product",
  fromBusiness: "Taken from your Business screen",
  notPublished: "This app does not publish it",
};

export function listingCsv(data: DashboardSource, derived: DashboardDerived, now: Date): string {
  const listing = derived.listing;
  const body = listing.properties.map((p) => {
    // A property with no figure exports its sentence, never a zero: "not
    // counted yet" and "no product has it" are different answers, and a
    // spreadsheet that renders both as 0 has lost the difference for good.
    const have = p.have === null ? (p.note ?? "Not counted yet") : String(p.have);
    const of = p.of === null ? "" : String(p.of);
    return [p.label, p.requirement, have, of, BASIS_WORD[p.basis] ?? p.basis] as (string | number)[];
  });
  return csvRows([
    [reportHeading(data, now)],
    [listingMethod(listing)],
    [],
    LISTING_HEADER,
    ...body,
  ]);
}

// ---------------------------------------------------------------------------
// The per-product table
// ---------------------------------------------------------------------------

/**
 * How many rows the per-product file will hold before it stops.
 *
 * A product contributes one row per finding, so a 20,000-product shop with a
 * theme-level problem produces 20,000 rows from one check alone. The cap is
 * high enough that no real catalogue reaches it and low enough that the file
 * is a file rather than an incident, and when it is reached the last line of
 * the file says so in words - a file that stops without saying it stopped is
 * the same silent loss as a filter that eats a value.
 */
export const PRODUCT_ROW_CAP = 50000;

const PRODUCTS_HEADER = [
  "Product",
  "Product page",
  "What we found",
  "Whose it is",
  "Where it is done",
];

export type ProductRowSource = Pick<ScanRowLike, "handle" | "findings">;

/**
 * One row per product per finding.
 *
 * The product is named by its handle rather than its title: the handle is what
 * this app stores when it reads a page, and fetching 20,000 titles from the
 * Admin API to decorate a spreadsheet is a cost the merchant would pay in
 * waiting for the file. The handle is what the merchant sees in their own URL
 * bar, and the second column is the path itself, so a row can be opened rather
 * than searched for.
 */
export function productFindingsCsv(
  data: DashboardSource,
  rows: ProductRowSource[],
  now: Date,
  cap = PRODUCT_ROW_CAP,
): string {
  const body: (string | number)[][] = [];
  let truncated = false;
  for (const row of rows) {
    for (const finding of findingsOf(row.findings)) {
      if (body.length >= cap) {
        truncated = true;
        break;
      }
      const code = finding.code as FindingCode;
      const label = OWNER_LABEL[code];
      // A code this build does not know is skipped rather than exported under
      // its own name: a merchant file is not the place a check code first
      // appears, and a row this app cannot describe is a row it cannot ask
      // anyone to act on.
      if (!label) continue;
      const steps = OWNER_STEPS[code];
      body.push([
        row.handle ?? "",
        row.handle ? `/products/${row.handle}` : "",
        label,
        GROUP_WORD[FINDING_OWNER[code]],
        steps ? steps.where : "",
      ]);
    }
    if (truncated) break;
  }

  const table: (string | number)[][] = [
    [reportHeading(data, now)],
    [
      body.length === 0
        ? "No product carries a finding, so this file has no rows. That is the answer, not a failure."
        : `${body.length} rows: one product, one finding.`,
    ],
    [],
    PRODUCTS_HEADER,
    ...body,
  ];
  if (truncated) {
    table.push([
      `This file stopped at ${cap} rows. There are more, and the counts on the screen are whole.`,
    ]);
  }
  return csvRows(table);
}
