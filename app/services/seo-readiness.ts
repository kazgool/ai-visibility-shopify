// How ready the shop is, in the four groups the merchant dashboard shows
// (PRD-SEO-FULL-ONPAGE section 4.1 as amended 4 September 2026, and the
// approved mockup _shopify/mockup-seo-dashboard.html, which is the
// specification for build step 5).
//
// Pure, and with no ".server" suffix, for the same two reasons every other
// aggregate in this app is: the screen renders these judgements in the
// browser, and a value import from a .server module outside a loader breaks
// the client build; and the acceptance criterion is that the screen reads
// correctly on five shapes of store, which is a test against this function and
// not against a component.
//
// The two rules this file exists to keep, both of them amendments Marius
// approved on 4 September 2026 and that PRD section 4.1 now records:
//
// 1. A finding that flags exactly 100 percent of the read set is not counted
//    against individual products. It is removed from the grouping entirely and
//    appears once, as a fix that covers the whole shop. The threshold is
//    exactly 100 percent, so it is a fact and not a judgement. Without it the
//    readiness figure is zero on almost every real shop, because one
//    theme-level problem flags every product at once.
//
// 2. Group assignment is a total function. Every finding code declares one
//    owner in FINDING_OWNER, a product goes in the group of its most immediate
//    owner - merchant, then app, then theme - and the four groups therefore
//    partition the read set exactly. `groupsPartitionReadSet` is asserted in
//    the tests on all five fixture stores.
//
// What "the read set" is, stated here because everything on the screen is
// counted over it. A product is in the read set when source A has computed its
// row *and* source B has read its page the way a crawler would see it. Both,
// not either. A product whose page has never been fetched cannot be called
// "nothing to fix" - fifteen of the checks have not been asked of it - and
// counting it clean is the "0 of 50" failure in CLAUDE.md wearing a different
// hat. Products with a catalogue row and no page read are counted separately,
// as `awaitingPage`, and the screen says so in a sentence rather than folding
// them into a group.

import {
  CHECKS,
  wasRead,
  type CheckBasis,
  type CheckRow,
  type CheckSource,
  type ScanRowLike,
} from "./seo-aggregate";
import {
  FINDING_OWNER,
  FIX_SHAPE,
  OWNER_LABEL,
  OWNER_STEPS,
  SHOP_WIDE_LABEL,
  findingsOf,
  type FindingCode,
  type FindingOwner,
  type FixShape,
} from "./seo-findings";
import { formatCount } from "./report-metrics";

// --- the surface a sentence is written for ----------------------------------

/**
 * Where a sentence is going to be read.
 *
 * Every sentence in this file that points at another element - "above", "at
 * the foot of this screen", "the dial", "the N of M above" - used to be written
 * once, in the screen's own layout, and then printed verbatim on paper and
 * copied into a spreadsheet, where the thing it pointed at was elsewhere or
 * nowhere (QA rounds 1 and 2, 5 September 2026). A referent is now emitted
 * only when the caller says it is rendered on that surface in that state; on
 * a spreadsheet no sentence points anywhere at all.
 */
export type Surface = "screen" | "paper" | "csv";

/**
 * What the surface actually renders in this state, so a sentence can point at
 * a thing only when the thing is there. Every field is "not rendered" unless
 * the caller says otherwise, which is the safe default: a sentence that omits
 * a pointer is merely less convenient, a sentence that points at nothing is
 * wrong.
 */
export type SurfaceContext = {
  surface: Surface;
  /** Where the four readiness groups sit relative to the sentence, or null when they are not rendered. */
  groups?: "above" | "below" | null;
  /** Where the shop-wide card sits relative to the sentence, or null when it is not rendered. */
  shopWide?: "above" | "below" | null;
  /** True when the card of counts with no verdict is rendered on this surface. */
  counted?: boolean;
  /** True when the collection checks are rendered above the line with their own total. */
  collectionsTotal?: boolean;
  /** True when the blog post check is rendered above the line with its own total. */
  blogTotal?: boolean;
  /** True when the "N of M in place" headline tile for the Google card is rendered above it. */
  listingKpi?: boolean;
  /** True when the dial and the segment bar are rendered. */
  dial?: boolean;
  /** True when the pages-read line is printed directly above the sentence. */
  readLine?: boolean;
};

/** The spreadsheet context: nothing is pointed at, ever. */
export const CSV_CONTEXT: SurfaceContext = { surface: "csv" };

/** Whether a referent may be named at all on this surface. */
function mayPoint(ctx: SurfaceContext): boolean {
  return ctx.surface !== "csv";
}

// --- counts in words ---------------------------------------------------------

/** "1 product", "12 products", "20,000 products". */
export function nProducts(n: number, noun = "product"): string {
  return `${formatCount(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * "all 46 products whose page we read", or "the one product whose page we
 * read": "all 1 of the products" is not English, and a one-product store is a
 * real shape (QA round 2, R2-24).
 */
export function allOf(n: number, tail: string, noun = "product"): string {
  return n === 1 ? `the one ${noun} ${tail}` : `all ${formatCount(n)} ${noun}s ${tail}`;
}

/** "all 120 of your products", or "your one product". */
export function yourProducts(n: number): string {
  return n === 1 ? "your one product" : `all ${formatCount(n)} of your products`;
}

/** The fourth group is "nothing to fix"; the other three are the owners. */
export type ReadinessGroup = "clean" | FindingOwner;

/**
 * Most immediate first. This is an order of immediacy and not of severity:
 * a product with a gap its owner can close today and a gap that needs a
 * developer is counted under the thing that can happen today. Nothing is
 * weighted and nothing is a grade.
 */
const OWNER_RANK: Record<FindingOwner, number> = { merchant: 0, app: 1, theme: 2 };

/** The order the four groups are rendered in, top to bottom. */
export const GROUP_ORDER: ReadinessGroup[] = ["clean", "merchant", "theme", "app"];

/**
 * Codes that state a count and never a verdict (B29 and B32 today). They put
 * no product in any group: a page with more links than another is not a page
 * with a problem, and treating it as one invents the verdict those checks were
 * written to withhold.
 */
const REPORTS_ONLY: ReadonlySet<string> = new Set(
  CHECKS.filter((c) => c.reports).map((c) => String(c.code)),
);

/** A code this grouping knows how to place. Anything else is ignored, never guessed at. */
export function groupsOn(code: string): code is FindingCode {
  return code in FINDING_OWNER && !REPORTS_ONLY.has(code);
}

function present(value: Date | string | null | undefined): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Folded a row at a time, so a 20,000-product store never holds its scan table
 * in memory - the same shape (and the same reason) as FindingsCounters in
 * seo-aggregate.ts.
 *
 * `codeSets` is what makes one pass enough. Which group a product lands in
 * depends on which codes turn out to flag the whole read set, and that is not
 * known until every row has been seen. Rather than keeping the rows, or
 * reading the table twice, this keeps one entry per *distinct set of codes* -
 * a few dozen on a real store, however many products it has - and the grouping
 * is computed from that once the totals are in.
 */
export type ReadinessCounters = {
  products: number;
  /** Rows source A has computed. */
  catalogueRead: number;
  /** Pages that answered as a crawler would see them. */
  pagesRead: number;
  /** Rows with both: the read set, and the denominator of everything below. */
  readSet: number;
  /** Source A has them, source B has not read their page yet. */
  awaitingPage: number;
  /** Products in the read set carrying each code. */
  codeCounts: Map<string, number>;
  /**
   * Products with a catalogue row carrying each code, whether or not their
   * page has been read. This is the count a catalogue-basis check is measured
   * over, and the shop-wide threshold for such a check is taken against it: a
   * check asked of every catalogue row and found on every catalogue row is
   * shop-wide because of those 50, not because 46 of them also had a page
   * read (M1, 5 September 2026).
   */
  catalogueCodeCounts: Map<string, number>;
  /** Sorted code list, comma-joined, to the number of products carrying exactly it. */
  codeSets: Map<string, number>;
  /** The most recent page read and catalogue read, as ISO strings. Null when never. */
  lastPageReadAt: string | null;
  lastCatalogueReadAt: string | null;
};

export function createReadinessCounters(): ReadinessCounters {
  return {
    products: 0,
    catalogueRead: 0,
    pagesRead: 0,
    readSet: 0,
    awaitingPage: 0,
    codeCounts: new Map<string, number>(),
    catalogueCodeCounts: new Map<string, number>(),
    codeSets: new Map<string, number>(),
    lastPageReadAt: null,
    lastCatalogueReadAt: null,
  };
}

/** What a check is measured over, from the CHECKS table. Off-table codes are never grouped. */
const CHECK_BASIS = new Map<string, CheckBasis>(CHECKS.map((c) => [String(c.code), c.basis]));

/**
 * The total a shop-wide check was found on all of.
 *
 * A catalogue-basis check (A1, A5, B6, B28 and the rest of the admin side) is
 * asked of every product source A has computed, so "on every product" means
 * every one of those. A page-basis check is asked only of pages that answered,
 * so "on every product" means every product whose page we read. The screen
 * used to say "found on all 46 products whose page we have read" of a check
 * whose own row said 50 of 50 (M1, 5 September 2026).
 */
export function shopWideScope(
  code: string,
  readiness: Pick<Readiness, "catalogueRead" | "readSet">,
): { over: "catalogue" | "readSet"; of: number } {
  const basis = CHECK_BASIS.get(code);
  return basis === "catalogue"
    ? { over: "catalogue", of: readiness.catalogueRead }
    : { over: "readSet", of: readiness.readSet };
}

/** "all 50 products in your catalogue" or "all 46 products whose page we read". */
export function shopWideScopePhrase(
  code: string,
  readiness: Pick<Readiness, "catalogueRead" | "readSet">,
): string {
  const scope = shopWideScope(code, readiness);
  return scope.over === "catalogue"
    ? allOf(scope.of, "in your catalogue")
    : allOf(scope.of, "whose page we read");
}

function iso(value: Date | string | null | undefined): string | null {
  if (!present(value)) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

export function foldReadinessRow(counters: ReadinessCounters, row: ScanRowLike): void {
  counters.products += 1;
  const bulk = present(row.bulkAt);
  if (bulk) {
    counters.catalogueRead += 1;
    counters.lastCatalogueReadAt = later(counters.lastCatalogueReadAt, iso(row.bulkAt));
  }
  const read = wasRead(row);
  if (read) {
    counters.pagesRead += 1;
    counters.lastPageReadAt = later(counters.lastPageReadAt, iso(row.scannedAt));
  }
  if (bulk) {
    // Every catalogue row, read or not, for the catalogue-basis checks. Only
    // codes with a catalogue basis are counted here; a page-basis code on a
    // row whose page was never read is not a measurement of anything.
    const catalogueCodes = new Set(
      findingsOf(row.findings)
        .map((f) => String(f.code))
        .filter((code) => groupsOn(code) && CHECK_BASIS.get(code) === "catalogue"),
    );
    for (const code of catalogueCodes) {
      counters.catalogueCodeCounts.set(code, (counters.catalogueCodeCounts.get(code) ?? 0) + 1);
    }
  }
  if (!bulk || !read) {
    if (bulk) counters.awaitingPage += 1;
    return;
  }
  counters.readSet += 1;
  const codes = [
    ...new Set(findingsOf(row.findings).map((f) => String(f.code)).filter(groupsOn)),
  ].sort();
  for (const code of codes) {
    counters.codeCounts.set(code, (counters.codeCounts.get(code) ?? 0) + 1);
  }
  const key = codes.join(",");
  counters.codeSets.set(key, (counters.codeSets.get(key) ?? 0) + 1);
}

/** The whole fold over an array, for tests and for callers holding the rows. */
export function readinessOf(rows: ScanRowLike[]): Readiness {
  const counters = createReadinessCounters();
  for (const row of rows) foldReadinessRow(counters, row);
  return buildReadiness(counters);
}

// --- what the screen renders -----------------------------------------------

/** One line inside an expanded group: a code, in the owner's words, with its count. */
export type GroupRow = {
  code: FindingCode;
  label: string;
  what: string;
  where: string;
  count: number;
  denominator: number;
};

export type GroupView = {
  group: ReadinessGroup;
  count: number;
  /** Rounded, and never shown without `count` of `denominator` beside it. */
  percent: number;
  denominator: number;
  title: string;
  /** The closed state's own line, so a merchant who never opens it still knows what it is. */
  summary: string;
  /**
   * Why the group's own figure and the figures in its rows are counted against
   * different totals. Empty on a group with no rows, because there is then no
   * second figure to reconcile.
   */
  scope: string;
  rows: GroupRow[];
  /** The paragraph under the rows. Empty for the group with no rows. */
  foot: string;
};

export type Readiness = {
  products: number;
  catalogueRead: number;
  pagesRead: number;
  readSet: number;
  awaitingPage: number;
  clean: number;
  merchant: number;
  theme: number;
  app: number;
  /**
   * Products in the catalogue that are not in the read set, so they are in
   * none of the four groups. This is the fifth segment of the headline, and it
   * exists because the headline must not be able to read as complete while
   * products remain unexamined: on a shop with 12 pages read out of 50, "12 of
   * 12" is arithmetically true and says the shop is finished.
   */
  notChecked: number;
  /** merchant + theme + app: products with something of their own to fix. */
  needSomething: number;
  groups: GroupView[];
  /** Codes taken out of the grouping because they flag the whole read set. */
  shopWideCodes: FindingCode[];
  lastPageReadAt: string | null;
  lastCatalogueReadAt: string | null;
};

const GROUP_TITLE: Record<ReadinessGroup, string> = {
  clean: "Nothing to fix",
  merchant: "You can fix these yourself, no developer",
  theme: "These need a change to your theme",
  app: "We can fix these, once you have read them",
};

const GROUP_FOOT: Record<ReadinessGroup, string> = {
  clean: "",
  merchant:
    "A product with several of these is counted once above, under whichever gap you can close " +
    "first, and it appears on every line here that applies to it.",
  theme:
    "If you work with a developer, each line above names the change and where it is made, so " +
    "no further briefing is needed. If you do not, ask whoever built or installed your theme - " +
    "it is under an hour of work for someone who knows it. We do not edit your theme ourselves " +
    "and we never add code to your storefront.",
  app:
    "Two rules that never change: nothing is invented, and anything you wrote by hand is never " +
    "overwritten. A field you have edited yourself is marked as yours and our passes skip it " +
    "from then on.",
};

/** "6 kinds of gap" - the closed state has to carry this, not only the count. */
function kinds(n: number): string {
  return `${n} kind${n === 1 ? "" : "s"} of gap`;
}

/**
 * The sentence that reconciles the two figures on a group.
 *
 * A group counts products, once each, under the owner of whatever they most
 * immediately need. A row counts every product the check fired on, whoever
 * else has a claim on it. So a group of 4 can hold a row of 45, and both
 * numbers are right. Printed inside every group, because the reader who needs
 * it is the one who started reading at that group.
 */
function scopeNote(count: number, products: number, readSet: number): string {
  return (
    `The ${formatCount(count)} above is products, counted once each out of your ` +
    `${formatCount(products)}, under whoever has to move first. The figures in the rows are ` +
    `different: each one counts every product that check found something on, out of the ` +
    `${formatCount(readSet)} we have fully checked, whether or not this group is the one that ` +
    `product is counted in. That is why a group of ${formatCount(count)} can hold a row with a ` +
    `larger figure.`
  );
}

function summaryFor(group: ReadinessGroup, count: number, rowCount: number): string {
  if (count === 0) {
    switch (group) {
      case "clean":
        return "No product is clear of everything yet.";
      case "merchant":
        return "Nothing here is waiting on you.";
      case "theme":
        return "Nothing here needs a theme change.";
      default:
        return "Nothing here is waiting on us.";
    }
  }
  switch (group) {
    case "clean":
      return "These products are done. New ones are checked automatically the night they appear.";
    case "merchant":
      return `${kinds(rowCount)}, every one of them yours to close without a developer.`;
    case "theme":
      return `${kinds(rowCount)}. Not something you can type into a field. Someone edits the theme once.`;
    default:
      return `${kinds(rowCount)}. We write nothing until you have seen it, and never over your own words.`;
  }
}

export function buildReadiness(counters: ReadinessCounters): Readiness {
  const readSet = counters.readSet;

  // Amendment 1. Exactly 100 percent, so it is a fact: a code on 188 of 189
  // products stays a per-product finding, and one on 189 of 189 becomes a
  // single decision. The 100 percent is of the total the check is measured
  // over: the catalogue for a catalogue-basis check, the read set for a
  // page-basis one (M1, 5 September 2026). A code on all 46 read pages but on
  // only 46 of the 50 catalogue rows is not on every product and stays
  // per-product. The read set still has to exist: shop-wide is defined as
  // "taken out of the grouping", and there is no grouping until a product has
  // been fully checked, so a store whose pages were never read names no
  // shop-wide code whatever its catalogue rows carry.
  const shopWideCodes = [...counters.codeCounts.entries()]
    .filter(([code, count]) => {
      if (readSet === 0 || count !== readSet) return false;
      if (CHECK_BASIS.get(code) !== "catalogue") return true;
      return (counters.catalogueCodeCounts.get(code) ?? 0) === counters.catalogueRead;
    })
    .map(([code]) => code as FindingCode)
    .sort();
  const shopWide = new Set<string>(shopWideCodes);

  const tally: Record<ReadinessGroup, number> = { clean: 0, merchant: 0, app: 0, theme: 0 };
  for (const [key, products] of counters.codeSets) {
    const codes = key === "" ? [] : key.split(",");
    let group: ReadinessGroup = "clean";
    let best = Number.POSITIVE_INFINITY;
    for (const code of codes) {
      if (shopWide.has(code)) continue;
      const rank = OWNER_RANK[FINDING_OWNER[code as FindingCode]];
      if (rank < best) {
        best = rank;
        group = FINDING_OWNER[code as FindingCode];
      }
    }
    tally[group] += products;
  }

  const rowsFor = (group: ReadinessGroup): GroupRow[] => {
    if (group === "clean") return [];
    return [...counters.codeCounts.entries()]
      .filter(([code, count]) => count > 0 && !shopWide.has(code) && FINDING_OWNER[code as FindingCode] === group)
      .map(([code, count]) => ({
        code: code as FindingCode,
        label: OWNER_LABEL[code as FindingCode],
        what: OWNER_STEPS[code as FindingCode].what,
        where: OWNER_STEPS[code as FindingCode].where,
        count,
        denominator: readSet,
      }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  };

  const groups: GroupView[] = GROUP_ORDER.map((group) => {
    const count = tally[group];
    const rows = rowsFor(group);
    return {
      group,
      count,
      // The catalogue, not the read set, and the same denominator the headline
      // KPI prints beside the same number. The two used to differ - the card
      // said "0 of 50" and the group beneath it said "Nothing to fix - 0 of
      // 46" - which is one number under two denominators on one page. The four
      // group counts still partition the read set; what they are stated
      // against is the catalogue, with the unchecked products as the fifth
      // band, exactly as the dial above them is drawn.
      percent: counters.products > 0 ? Math.round((count / counters.products) * 100) : 0,
      denominator: counters.products,
      title: GROUP_TITLE[group],
      summary: summaryFor(group, count, rows.length),
      rows,
      // The two scopes on one card, stated in every group rather than under
      // the first one only. A reader who starts at the theme group used to see
      // a group of 4 containing a row that had hit 45, with the sentence that
      // explains it two cards up.
      scope: rows.length > 0 ? scopeNote(count, counters.products, readSet) : "",
      foot: count > 0 ? GROUP_FOOT[group] : "",
    };
  });

  return {
    products: counters.products,
    catalogueRead: counters.catalogueRead,
    pagesRead: counters.pagesRead,
    readSet,
    awaitingPage: counters.awaitingPage,
    clean: tally.clean,
    merchant: tally.merchant,
    theme: tally.theme,
    app: tally.app,
    notChecked: counters.products - readSet,
    needSomething: tally.merchant + tally.theme + tally.app,
    groups,
    shopWideCodes,
    lastPageReadAt: counters.lastPageReadAt,
    lastCatalogueReadAt: counters.lastCatalogueReadAt,
  };
}

/**
 * What stands where the four groups would be when no product has been fully
 * checked. The screen and the report say the same thing, from one place; the
 * report used to print four tiles of "0 of 0" and four empty groups instead
 * (R2-09, R2-10).
 */
export function nothingGroupedSentence(surface: Surface): string {
  const fills =
    surface === "paper"
      ? "This section fills in as the nightly read works through the catalogue."
      : "This card fills in as the nightly read works through your catalogue.";
  return `No product has been fully checked yet, so there is nothing to group. ${fills}`;
}

/**
 * The method line under the readiness card, written for the surface it is on.
 *
 * The dial is named only where it is drawn; the shop-wide card only where it
 * is rendered, and in the direction it actually sits (R2-08).
 */
export function readinessMethod(
  readiness: Readiness,
  wide: ShopWideItem[],
  ctx: SurfaceContext,
): string {
  const head =
    "A product with several gaps is counted once, in the group of whoever has to move first: " +
    "you, then us, then your theme. This is not a grade and nothing is weighted.";
  const shopWide =
    readiness.shopWideCodes.length > 0
      ? ` Problems that affect every product equally are not counted here at all, because those ` +
        `are one decision each and not ${formatCount(readiness.readSet)}.` +
        (mayPoint(ctx) ? ` ${shopWideCrossReference(readiness, wide, ctx.shopWide ?? null)}` : "")
      : mayPoint(ctx) && ctx.shopWide
        ? ` A problem that affected every product equally would be moved out of this card and into the shop-wide one ${ctx.shopWide}; today there is none.`
        : " A problem that affected every product equally would be listed once, among the fixes that cover the whole shop; today there is none.";
  const dial =
    mayPoint(ctx) && ctx.dial
      ? " The dial is drawn against your whole catalogue, and a product joins one of the four groups only once its catalogue row and its live page have both been read."
      : " Every figure here is stated against your whole catalogue, and a product joins one of the four groups only once its catalogue row and its live page have both been read.";
  return `${head}${shopWide}${dial}`;
}

/**
 * The products with a catalogue row that are in none of the four groups, told
 * apart by why: their page was never opened, or it was opened and could not
 * be read the way a search engine reads it.
 *
 * One sentence about both, and it says they are the same pages the read line
 * counts as "could not be read", because the screen used to say "4 more could
 * not be read" in one line and "4 have not been opened yet" in the next, about
 * the same four (R2-16). `couldNotBeRead` comes from the findings aggregate,
 * which counts every attempted page that did not answer as a crawler sees it.
 */
export function unreadSentence(
  readiness: Readiness,
  couldNotBeRead: number,
  ctx: SurfaceContext,
): string | null {
  if (readiness.awaitingPage === 0 || readiness.products === 0) return null;
  const failed = Math.min(couldNotBeRead, readiness.awaitingPage);
  const unopened = readiness.awaitingPage - failed;
  const groups =
    mayPoint(ctx) && ctx.groups ? `none of the four groups ${ctx.groups}` : "none of the four groups";
  // The read line names the same pages as "could not be read"; say so only
  // where that line is actually printed above this one.
  const same =
    mayPoint(ctx) && ctx.readLine
      ? ` (the same ${formatCount(failed)} the line above counts as could not be read)`
      : "";
  const parts: string[] = [];
  if (unopened > 0) {
    parts.push(
      `${formatCount(unopened)} ${unopened === 1 ? "has" : "have"} not had ${unopened === 1 ? "its" : "their"} page opened yet`,
    );
  }
  if (failed > 0) {
    parts.push(
      `${formatCount(failed)} ${failed === 1 ? "was" : "were"} opened but could not be read the way a search engine reads a page${same}`,
    );
  }
  const total = readiness.awaitingPage;
  const lead =
    parts.length === 2
      ? `${formatCount(total)} of ${nProducts(readiness.products)} have a catalogue row but are not fully checked yet: ${parts.join(", and ")}.`
      : unopened > 0
        ? `${formatCount(total)} of ${nProducts(readiness.products)} ${total === 1 ? "has" : "have"} been read from your catalogue but ${total === 1 ? "its" : "their"} live page has not been opened yet.`
        : `${formatCount(total)} of ${nProducts(readiness.products)} ${total === 1 ? "has" : "have"} been read from your catalogue, and ${total === 1 ? "its" : "their"} page was opened but could not be read the way a search engine reads a page${same}.`;
  return `${lead} ${total === 1 ? "It is" : "They are"} counted in ${groups}, and ${failed > 0 ? "not counted as clean" : "nothing is claimed about a page nobody has read"}.`;
}

/**
 * The acceptance criterion of PRD section 4.1 as amended, as a predicate the
 * test asserts on all five fixture stores: the four groups partition the read
 * set exactly, so the four numbers on the screen add up to the denominator
 * printed under the dial.
 */
export function groupsPartitionReadSet(readiness: Readiness): boolean {
  return readiness.clean + readiness.merchant + readiness.theme + readiness.app === readiness.readSet;
}

/**
 * The same partition one level out, and the one the headline is drawn against:
 * the four groups plus the products nobody has fully checked yet add up to the
 * catalogue. Asserted beside the other on all five fixture stores.
 */
export function groupsPartitionCatalogue(readiness: Readiness): boolean {
  return (
    readiness.clean +
      readiness.merchant +
      readiness.theme +
      readiness.app +
      readiness.notChecked ===
    readiness.products
  );
}

/**
 * The group in words, for the rows and segments that are also drawn in colour.
 *
 * Colour reinforces; it never carries. Up to 8 percent of men have some form
 * of colour blindness, and a bar whose only statement of ownership is its hue
 * says nothing at all to them - so every row that has a colour also prints
 * this. (NN/g, dashboard design.)
 */
export const GROUP_WORD: Record<ReadinessGroup, string> = {
  clean: "Nothing to fix",
  merchant: "You",
  theme: "Your theme",
  app: "Us",
};

/** The group word for a code, for a bar rendered outside the four panels. */
export function groupWordFor(code: string): string {
  const owner = FINDING_OWNER[code as FindingCode] as FindingOwner | undefined;
  return owner ? GROUP_WORD[owner] : GROUP_WORD.theme;
}

// --- fixes that cover the whole shop ---------------------------------------

/**
 * The facts that make a shop-wide fix without being a finding on any product.
 *
 * Delivery and returns are two fields on this app's own Business screen, so no
 * product row carries them and no check fires; a shop that has not filled them
 * in is missing two of the details Google asks for, on every product at once.
 * The barcode line is the same shape read from the catalogue snapshot: `have`
 * of `of` products carry one, and the item appears only when `have` is zero,
 * because "some of your products have a barcode" is a per-product finding and
 * A1 already carries it.
 *
 * All three are `null` when the figure has not been measured, and a null
 * produces no item at all rather than an item claiming zero.
 */
export type ShopWideFacts = {
  deliveryStated: boolean | null;
  returnsStated: boolean | null;
  barcode: { have: number; of: number } | null;
  /**
   * The other three details A1 asks about, from the same catalogue read as the
   * barcode. They are here so the A1 row can name which of its four is
   * actually absent; without them the row reads as a claim about all four, and
   * the Google card two cards later contradicts it.
   */
  brand: { have: number; of: number } | null;
  productCode: { have: number; of: number } | null;
  photo: { have: number; of: number } | null;
  /**
   * Products in the catalogue, from the same source the rest of the screen
   * counts from. The card used to state one blanket denominator - the read set
   * - under every row, which is wrong for two of the three: a blank return
   * window and a missing barcode are facts about every product in the
   * catalogue, not only about the ones whose page a crawler has opened.
   * Null when nothing has read the catalogue, and then no row claims a figure.
   */
  catalogue: number | null;
  /**
   * What the last page read found about the details this app publishes, and
   * why each one is missing. This is what turns the app-owned shop-wide row
   * from an alarm into an explanation: a screen the merchant pays for does not
   * say "something we should be doing is not happening, go and look elsewhere
   * to find out why".
   */
  publishedReasons: { nodeType: string; emitted: boolean; reason: string | null }[] | null;
};

export type ShopWideItem = {
  key: string;
  /**
   * A sentence. Never a bar label with a count glued to the end: this card
   * exists because the fix is one decision rather than N of them, so a title
   * ending ", on all 12" is a count that has lost its subject.
   */
  title: string;
  what: string;
  /** Named on this card when the app can name it, rather than sent elsewhere. */
  why?: string;
  where: string;
  /** What this one row covers, with its own denominator. Never the card's. */
  appliesTo: string;
  owner: FindingOwner;
  /** The short tag on the right of the card: who, and how often it is done. */
  ownerNote: string;
};

const OWNER_NOTE: Record<FindingOwner, string> = {
  merchant: "You",
  app: "Us",
  theme: "Your theme",
};

/**
 * The card, ordered the way the mockup orders it: what the owner can do today
 * first, then what we do, then what the theme needs. Every item is done once
 * and applies to every product, which is the whole reason they are not counted
 * against individual products.
 */
/**
 * The cause behind the app-owned shop-wide row, in the merchant's words.
 *
 * Null when the app genuinely cannot name it, and then the row says what it
 * does not know and what would settle it - which is the honest version of the
 * same sentence, and still better than a link to another screen.
 */
function whyNothingIsArriving(
  reasons: { nodeType: string; emitted: boolean; reason: string | null }[] | null,
): string | null {
  if (!reasons || reasons.length === 0) return null;
  const missing = reasons.filter((r) => !r.emitted && (r.reason ?? "").trim() !== "");
  if (missing.length === 0) return null;
  const distinct = [...new Set(missing.map((r) => merchantReason(r.reason!.trim())))];
  const named = missing
    .map((r) => PUBLISHED_LABEL[r.nodeType])
    .filter((label): label is string => Boolean(label));
  const which =
    named.length > 0
      ? `What is missing: ${named.join(", ")}. `
      : "";
  return `${which}${distinct.length === 1 ? "The reason we recorded" : "The reasons we recorded"}: ${distinct.join(" ")}`;
}

/**
 * The reasons the page read records, in the merchant's words.
 *
 * `deriveMissingReasons` in theme-scan.server.ts writes its reasons for the
 * operator, and they say "node", "metafields" and "SEO module". Those strings
 * reached the merchant dashboard, the printed report and the shop-wide
 * spreadsheet unchanged (QA round 1, 2.3). This record is keyed by the exact
 * operator sentence, so a reworded reason there stops matching here and falls
 * to `UNEXPLAINED_REASON` rather than leaking; theme-scan.server.test.ts
 * asserts that every reason that function can produce has an entry.
 */
export const MERCHANT_REASON: Record<string, string> = {
  "The app embed is not active in the theme.":
    "This app's block is not switched on in your theme, so nothing it publishes reaches the page.",
  "Extend mode has nothing to add yet - this product has no extracted attributes or generated summary.":
    "Nothing has been prepared for this product yet, so there is nothing to add to what your theme already publishes.",
  "No store social profile URLs are filled in on the Business screen.":
    "No social profile addresses are filled in on the Business screen in this app.",
  "This property is part of the operator-configured SEO module, not yet enabled for this shop.":
    "This detail is part of the SEO work, which is not switched on for this shop yet.",
  "Could not be determined - the last scan could not read this page.":
    "The last read could not open this page, so we do not know.",
  "The SEO module is enabled but the last scan did not find this node on the page - check that the app embed is active in the current theme.":
    "The SEO work is switched on, but the last read did not find this detail on the page; the usual cause is that this app's block is not active in the theme you currently publish.",
  "The last scan found no rating on this product's page - no review app has written rating metafields for it yet.":
    "The last read found no star rating on this product's page; no review app has recorded one for it yet.",
  "The return window is empty on the Business screen.":
    "The return window is empty on the Business screen in this app.",
  "Delivery time is empty, or marked as varying, on the Business screen.":
    "The delivery time is empty, or marked as varying, on the Business screen in this app.",
  "This collection has no generated summary yet - it is written when collections are processed.":
    "This collection has no summary yet; one is written when collections are processed.",
  "This collection has no generated questions yet.":
    "This collection has no questions block yet.",
};

/** What the merchant reads for a reason this release cannot yet put in plain words. */
export const UNEXPLAINED_REASON =
  "We recorded a reason we cannot yet explain in plain words; the Diagnostics screen in this app " +
  "shows it as recorded.";

/** The merchant sentence for one recorded reason, never the raw string. */
export function merchantReason(reason: string): string {
  return MERCHANT_REASON[reason] ?? UNEXPLAINED_REASON;
}

/** "Found on all 46 products whose page we read." or "...all 50 products in your catalogue." */
function everyRead(code: string, readiness: Readiness): string {
  return `Found on ${shopWideScopePhrase(code, readiness)}.`;
}

/**
 * What it takes to put right, in the merchant's terms. See FIX_SHAPE in
 * seo-findings.ts for why the shape is a property of the check and not of the
 * owner: two merchant-owned findings can need one switch and four hundred
 * fields respectively.
 */
function fixSentence(owner: FindingOwner, shape: FixShape, of: number): string {
  if (owner === "theme") {
    return "One change to the theme, and it applies to every product page.";
  }
  if (owner === "app") {
    return of === 1
      ? "One thing for us to put right."
      : `One thing for us to put right, not ${formatCount(of)}.`;
  }
  return shape === "perProduct"
    ? of === 1
      ? "The fix itself is one field on that product."
      : `The fix itself is one field per product, so it is ${formatCount(of)} of them, not one.`
    : "One setting, and it applies to every product page.";
}

/**
 * Which of the four details A1 asks about are actually absent, as counts.
 *
 * Null when the catalogue read that produces them has not happened, and then
 * the row says nothing rather than guessing - the same rule as everywhere
 * else: a figure that was never measured is a sentence, never a zero.
 */
function identifierCounts(facts: ShopWideFacts): string | null {
  const four: [string, { have: number; of: number } | null][] = [
    ["a barcode", facts.barcode],
    ["a brand", facts.brand],
    ["a product code", facts.productCode],
    ["a photo", facts.photo],
  ];
  const known = four.filter(([, value]) => value !== null && value.of > 0) as [
    string,
    { have: number; of: number },
  ][];
  if (known.length === 0) return null;
  const missing = known.filter(([, v]) => v.have < v.of);
  const complete = known.filter(([, v]) => v.have === v.of);
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      "Missing on some products: " +
        missing
          .map(([name, v]) => `${name}, on ${formatCount(v.of - v.have)} of ${formatCount(v.of)}`)
          .join("; ") + ".",
    );
  }
  if (complete.length > 0) {
    parts.push(
      "Already on every product: " + complete.map(([name]) => name).join(", ") + ".",
    );
  }
  if (known.length < 4) {
    parts.push("The rest we have not counted yet.");
  }
  return parts.join(" ");
}

export function shopWideItems(readiness: Readiness, facts: ShopWideFacts): ShopWideItem[] {
  const items: ShopWideItem[] = [];
  const catalogue = facts.catalogue;
  const everyProduct =
    catalogue !== null && catalogue > 0
      ? allOf(catalogue, "in your catalogue")
      : "every product in your catalogue";

  if (facts.deliveryStated === false || facts.returnsStated === false) {
    const both = facts.deliveryStated === false && facts.returnsStated === false;
    const which = both
      ? "Your delivery time and return window are blank"
      : facts.deliveryStated === false
        ? "Your delivery time is blank"
        : "Your return window is blank";
    items.push({
      key: "business",
      title: which,
      what:
        "Fill " +
        (both ? "both" : "it") +
        " in once and every product gains delivery and returns information, which Google asks " +
        "for on product listings. " +
        (both ? "Two fields, one screen." : "One field, one screen."),
      where: "Open the Business screen in this app and save.",
      appliesTo: `Filled in once, on one screen, and it applies to ${everyProduct}.`,
      owner: "merchant",
      ownerNote: "You, Business screen",
    });
  }

  if (facts.barcode && facts.barcode.of > 0 && facts.barcode.have === 0) {
    items.push({
      key: "barcode",
      title: "No product in your catalogue carries a barcode",
      what:
        "Google strongly asks for the manufacturer's barcode where one exists, because it is " +
        "how it matches your product to the same product elsewhere. It is a field in Shopify, " +
        "under each product's variant. We will not make one up: a wrong barcode points Google " +
        "at somebody else's product.",
      where: "Shopify, Products, open one, the variant row.",
      appliesTo:
        (facts.barcode.of === 1
          ? "Your one product does not carry one, which is why it is here "
          : `Not one of your ${formatCount(facts.barcode.of)} products carries one, which is why it is here `) +
        "rather than against individual products. The fix itself is one field per product.",
      owner: "merchant",
      ownerNote: "You, Shopify, per product",
    });
  }

  for (const code of readiness.shopWideCodes) {
    const owner = FINDING_OWNER[code];
    const why = code === "B6" ? whyNothingIsArriving(facts.publishedReasons) : null;
    // A1 fires when any one of four details is absent, and its sentence reads
    // like a claim about all four. The counts are on hand from the same
    // catalogue read the Google card uses, so the row says which of the four
    // are actually missing instead of leaving a merchant to disprove it from
    // another page: on the store this was read from, the Google table two
    // pages later said Brand was 50 of 50.
    const identifiers = code === "A1" ? identifierCounts(facts) : null;
    items.push({
      key: code,
      title: SHOP_WIDE_LABEL[code],
      what: OWNER_STEPS[code].what,
      ...(identifiers ? { why: identifiers } : {}),
      ...(code === "B6"
        ? {
            why:
              why ??
              "We cannot say which of them or why from here: the reasons are recorded when a " +
                "page of yours is read, and the last read of your published theme carries none. " +
                "The next nightly page read settles it, and the Diagnostics screen re-reads a " +
                "page now if you would rather not wait.",
          }
        : {}),
      where:
        code === "B6"
          ? "Diagnostics in this app re-reads one of your pages and shows the same reasons again."
          : OWNER_STEPS[code].where,
      // The second sentence states the shape of the fix, not the shape of the
      // finding. Everything on this card is true of every product; that is why
      // it is here. It does not follow that the fix is made once - a barcode is
      // one field per product - and the card used to say "One setting, and it
      // applies to every product page" on rows whose own instruction column
      // told the merchant to open each product.
      appliesTo: `${everyRead(code, readiness)} ${fixSentence(owner, FIX_SHAPE[code], shopWideScope(code, readiness).of)}`,
      owner,
      ownerNote:
        owner === "theme"
          ? "Your theme, one change, all pages"
          : owner === "app"
            ? "Us, once you have read it"
            : FIX_SHAPE[code] === "perProduct"
              ? `${OWNER_NOTE[owner]}, one field per product`
              : `${OWNER_NOTE[owner]}, one change, all products`,
    });
  }

  return items.sort((a, b) => OWNER_RANK[a.owner] - OWNER_RANK[b.owner]);
}

/**
 * "flagged all 46 products whose page we read", or, when the shop-wide checks
 * were measured over two different totals, both of them named.
 */
function shopWideTotalsPhrase(readiness: Readiness): string {
  const scopes = new Map<string, string>();
  for (const code of readiness.shopWideCodes) {
    const scope = shopWideScope(code, readiness);
    scopes.set(scope.over, shopWideScopePhrase(code, readiness));
  }
  const phrases = [...scopes.values()];
  return phrases.length <= 1 ? phrases[0] ?? "" : phrases.join(", or ");
}

/**
 * The method line under the shop-wide card, with this shop's own arithmetic.
 *
 * `ctx.groups` says where the four readiness groups are relative to this
 * sentence, or that they are not rendered: on the screen they are above the
 * card, on paper the figure strip comes before them, and on a store with no
 * read set they are nowhere.
 */
export function shopWideMethod(
  readiness: Readiness,
  items: ShopWideItem[],
  ctx: SurfaceContext,
): string {
  if (items.length === 0) {
    const where =
      mayPoint(ctx) && ctx.groups
        ? ` Anything found is against the products it was found on, in the groups ${ctx.groups}.`
        : " Anything found is counted against the products it was found on.";
    return (
      "Nothing affects every product the same way, so there is nothing to do once here." + where
    );
  }
  const fromChecks = readiness.shopWideCodes.length;
  const rest = items.length - fromChecks;
  const threshold =
    fromChecks > 0
      ? ` ${fromChecks} of the ${items.length} came from a check that flagged ${shopWideTotalsPhrase(readiness)}, which is exactly 100 percent and therefore a fact rather than a judgement.`
      : "";
  const others =
    rest > 0
      ? ` The other ${rest === 1 ? "one is a fact" : `${rest} are facts`} about the shop that no product row carries: a field on the Business screen, or a field that not one product in your catalogue fills in.`
      : "";
  return (
    "Something is listed here rather than against individual products when it affects every " +
    `product the same way.${threshold}${others} Each row states what it applies to and the ` +
    "number it was counted over, because those numbers are not all the same one."
  );
}

/**
 * The sentence that names the shop-wide card from another card.
 *
 * It counts the rows the card actually renders, which is the bug this replaced:
 * the method line printed `shopWideCodes.length` (2) while the card below
 * listed 3, because one of the rows comes from the Business screen and is not
 * a check at all. Two numbers, both true, contradicting each other on one
 * screen.
 *
 * `where` is where that card is on the surface this sentence is printed on;
 * null means it is not rendered there, and then the card is named without a
 * direction. Never printed on a spreadsheet.
 */
export function shopWideCrossReference(
  readiness: Readiness,
  items: ShopWideItem[],
  where: "above" | "below" | null,
): string {
  if (items.length === 0) return "";
  const fromChecks = readiness.shopWideCodes.length;
  const fixes = `${items.length} ${items.length === 1 ? "fix" : "fixes"}`;
  const card = where
    ? `The shop-wide card ${where} carries ${fixes}`
    : `There ${items.length === 1 ? "is" : "are"} ${fixes} that cover the whole shop`;
  if (fromChecks === 0) {
    return `${card}, and no check flagged every product, so nothing was moved out of the counts here.`;
  }
  return (
    `${card}, ${fromChecks} of ${fromChecks === 1 ? "them from a check that flagged" : "them from checks that each flagged"} ` +
    `${shopWideTotalsPhrase(readiness)}. ${fromChecks === 1 ? "That one is" : "Those are"} not counted again here.`
  );
}

// --- Google's free product listings ----------------------------------------

/**
 * The details Google asks a shop to publish about each product, as its own
 * card (PRD section 4.1 item 6). Required and recommended exactly as Google
 * states them; nothing here is this app's own opinion about what matters.
 *
 * Three shapes of row, and the difference between them is the point:
 *
 * - measured, `have` of `of` - brand, photo and barcode are counted from the
 *   catalogue read;
 * - complete by construction, where `have` equals `of` because Shopify
 *   supplies the field on every product it has - the product's name, its
 *   price, the shop's currency and whether it is in stock. The figure is the
 *   catalogue size and the method line says so, so it is a real number with a
 *   real denominator rather than a hardcoded 100 percent;
 * - not published, `have` null and a sentence instead of a gauge. Condition
 *   is the only one today. The block deliberately stopped emitting it (see the
 *   comment in ai-visibility.liquid): Shopify has no field saying whether a
 *   product is new, refurbished or second hand, so publishing "new" on every
 *   product was a factual claim the merchant never made. A gauge at 100
 *   percent here would be exactly that claim drawn as a circle.
 *
 * `have` is null wherever nothing measured it, and a null renders as a
 * sentence and never as a zero.
 */
export type ListingRequirement = "required" | "recommended" | "strongly asked";

/**
 * Where a row's figure comes from. `byConstruction` is the one that had to be
 * named: those four are in place on every product Shopify holds, and a card
 * whose method line said so while its own count said "0 of 10" was stating two
 * different answers to one question. `listingMethod` is computed from these,
 * so the sentence and the count cannot drift apart again.
 */
export type ListingBasis = "measured" | "byConstruction" | "fromBusiness" | "notPublished";

export type ListingProperty = {
  key: string;
  label: string;
  requirement: ListingRequirement;
  basis: ListingBasis;
  /** Null when nothing has measured this, or when it is not published at all. */
  have: number | null;
  of: number | null;
  /** The sentence that replaces a bar. Set only when `have` is null. */
  note?: string;
};

export type ListingReadiness = {
  properties: ListingProperty[];
  /** Properties fully in place: `have` equals `of`, with `of` above zero. */
  inPlace: number;
  /** Every property on the card, in place or not. */
  total: number;
  /**
   * True when the catalogue has never been read, so the card is a sentence.
   *
   * Read from `catalogueRead`, which is the SeoScan row count the header, the
   * findings columns and the readiness dial all count from - not from whether
   * a snapshot row happens to exist. The two are different questions and the
   * card was answering the second one, so a shop with 50 rows read and no
   * snapshot yet was told in one card that its catalogue had been read and in
   * the next that it had not.
   */
  unmeasured: boolean;
};

export function listingReadiness(
  facts: {
    products: number;
    withVendor: number;
    withImage: number;
    withBarcode: number;
  } | null,
  business: { deliveryStated: boolean; returnsStated: boolean } | null,
  /** Products source A has read, from the same source as the rest of the screen. */
  catalogueRead: number,
): ListingReadiness {
  // The counted fields live in the rolling snapshot row; the catalogue size is
  // known from either. When the rows are read but the snapshot has not been
  // written yet, the card still renders - the four that Shopify supplies are
  // in place, and the three that are counted say they have not been counted
  // yet rather than showing a zero.
  const of = facts ? facts.products : catalogueRead > 0 ? catalogueRead : null;
  const NOT_COUNTED_YET =
    "Not counted yet. Your products have been read, and this figure is written by the next " +
    "catalogue pass; until then it is not a zero.";
  const all = (have: number | null): number | null => (of === null ? null : have);
  const fromBusiness = (stated: boolean | null): number | null => {
    if (of === null || stated === null) return null;
    return stated ? of : 0;
  };

  const properties: ListingProperty[] = [
    {
      key: "name",
      label: "Product name",
      requirement: "required",
      basis: "byConstruction",
      have: all(of),
      of,
      ...(of === null ? { note: "Your products have not been read yet." } : {}),
    },
    {
      key: "price",
      label: "Price",
      requirement: "required",
      basis: "byConstruction",
      have: all(of),
      of,
      ...(of === null ? { note: "Your products have not been read yet." } : {}),
    },
    {
      key: "currency",
      label: "Currency",
      requirement: "required",
      basis: "byConstruction",
      have: all(of),
      of,
      ...(of === null ? { note: "Your products have not been read yet." } : {}),
    },
    {
      key: "brand",
      label: "Brand",
      requirement: "required",
      basis: "measured",
      have: facts ? facts.withVendor : null,
      of,
      ...(facts ? {} : { note: of === null ? "Your products have not been read yet." : NOT_COUNTED_YET }),
    },
    {
      key: "photo",
      label: "Photo",
      requirement: "required",
      basis: "measured",
      have: facts ? facts.withImage : null,
      of,
      ...(facts ? {} : { note: of === null ? "Your products have not been read yet." : NOT_COUNTED_YET }),
    },
    {
      key: "availability",
      label: "In stock or not",
      requirement: "recommended",
      basis: "byConstruction",
      have: all(of),
      of,
      ...(of === null ? { note: "Your products have not been read yet." } : {}),
    },
    {
      key: "condition",
      label: "New or used",
      requirement: "recommended",
      basis: "notPublished",
      have: null,
      of,
      note:
        "Not published, on purpose. Shopify has no field saying whether a product is new, " +
        "refurbished or second hand, so stating \"new\" on every product would be a claim you " +
        "never made. Nothing here is invented.",
    },
    {
      key: "delivery",
      label: "Delivery cost and time",
      requirement: "recommended",
      basis: "fromBusiness",
      have: fromBusiness(business ? business.deliveryStated : null),
      of,
      ...(business && of !== null
        ? {}
        : { note: "Not filled in yet on the Business screen in this app." }),
    },
    {
      key: "returns",
      label: "Return window",
      requirement: "recommended",
      basis: "fromBusiness",
      have: fromBusiness(business ? business.returnsStated : null),
      of,
      ...(business && of !== null
        ? {}
        : { note: "Not filled in yet on the Business screen in this app." }),
    },
    {
      key: "barcode",
      label: "Barcode",
      requirement: "strongly asked",
      basis: "measured",
      have: facts ? facts.withBarcode : null,
      of,
      ...(facts ? {} : { note: of === null ? "Your products have not been read yet." : NOT_COUNTED_YET }),
    },
  ];

  return {
    properties,
    inPlace: properties.filter((p) => p.have !== null && p.of !== null && p.of > 0 && p.have === p.of)
      .length,
    total: properties.length,
    unmeasured: catalogueRead === 0,
  };
}

/**
 * The method line, computed from the same object the headline count is, so the
 * two cannot say different things.
 *
 * The card used to carry a constant sentence saying four of these were
 * "complete by construction" above a count that read "0 of 10". Both were
 * printed on one screen. Whatever the true number is, it is now arithmetic
 * from the rows.
 */
export function listingMethod(listing: ListingReadiness, ctx: SurfaceContext): string {
  const byConstruction = listing.properties.filter((p) => p.basis === "byConstruction");
  const inPlaceByConstruction = byConstruction.filter(
    (p) => p.have !== null && p.of !== null && p.of > 0 && p.have === p.of,
  );
  const head =
    "Required and recommended exactly as Google states them for free product listings. ";
  // Read as a phrase rather than as a label, so the sentence is a sentence.
  const PHRASE: Record<string, string> = {
    name: "the product name",
    price: "its price",
    currency: "your currency",
    availability: "whether it is in stock",
  };
  const phrases = inPlaceByConstruction.map((p) => PHRASE[p.key] ?? p.label.toLowerCase());
  const listed =
    phrases.length <= 1
      ? phrases.join("")
      : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  // The headline tile is named only where it is rendered: the screen shows
  // it only once a page has been read, and the report only in the same state.
  // Elsewhere the same figure is stated in the sentence itself, so it is on
  // every surface without pointing at anything (R1 1.3, R2-07).
  const counted =
    mayPoint(ctx) && ctx.listingKpi
      ? `counted in the ${listing.inPlace} of ${listing.total} above`
      : `count toward the ${listing.inPlace} of ${listing.total} in place`;
  const construction =
    inPlaceByConstruction.length > 0
      ? `Shopify supplies ${listed} on every product it holds, so those ` +
        `${inPlaceByConstruction.length} are in place on ` +
        `${yourProducts(inPlaceByConstruction[0].of ?? 0)} and ${counted}. `
      : listing.unmeasured
        ? "Your products have not been read yet, so nothing here has been counted and none of the " +
          "ten is claimed either way. "
        : "";
  const measured =
    "Brand, photo and barcode are counted from the last catalogue read. A barcode is your data " +
    "and this app will never invent one: a made-up barcode would point Google at somebody " +
    "else's product.";
  return head + construction + measured;
}

// --- what a page publishes about the product -------------------------------

/**
 * The plain name for each kind of detail the page can publish. Only the kinds
 * named here are rendered on the merchant screen; anything else is counted in
 * one sentence rather than shown under the name the standard gives it, which
 * is a name no shop owner has to learn.
 */
export const PUBLISHED_LABEL: Record<string, string> = {
  Product: "The product itself",
  Organization: "Your business",
  "WebSite/SearchAction": "Your shop and its search box",
  BreadcrumbList: "Where the page sits",
  AggregateRating: "Star rating",
  MerchantReturnPolicy: "Your return window",
  OfferShippingDetails: "Your delivery cost and time",
  CollectionPage: "The category page",
  FAQPage: "The questions block",
};

// --- every check on the screen accounted for --------------------------------

/**
 * The four codes that are not in the CHECKS table, and where each is counted
 * instead.
 *
 * CHECKS holds the checks whose denominator is products or product pages. A6,
 * A10 and A11 count collections and B30 counts blog posts, so none of them may
 * borrow this aggregate's denominator (CheckBasis says why), and each is
 * rendered from its own pass's report with its own total. They are listed here
 * because a column that says "8 found, 28 found nothing" on a vocabulary of 44
 * has silently dropped six codes, and a merchant reading it has no way to know
 * whether the missing ones were fine or never asked.
 */
const OFF_TABLE_SOURCE: Partial<Record<FindingCode, CheckSource>> = {
  A6: "A",
  A10: "A",
  A11: "A",
  B30: "B",
};

const CHECK_SOURCE = new Map<string, CheckSource>(CHECKS.map((c) => [String(c.code), c.source]));

/** Which column a code belongs to, whether or not it is in the CHECKS table. */
export function codeSource(code: FindingCode): CheckSource {
  return CHECK_SOURCE.get(code) ?? OFF_TABLE_SOURCE[code] ?? "A";
}

export type ColumnAccount = {
  source: CheckSource;
  /** Every code in the vocabulary that belongs to this column. */
  total: number;
  /** Codes rendered as a bar in this column. */
  bars: number;
  shopWide: number;
  clean: number;
  notYetRead: number;
  couldNotRun: number;
  notApplicable: number;
  counted: number;
  /** Codes counted against collections or blog posts, with their own totals. */
  offTable: number;
  /** The sentences under the bars, in reading order. */
  lines: string[];
  /** bars + everything in a sentence adds to total. False is a bug, not a state. */
  balanced: boolean;
};

/**
 * What became of every check on one side of the findings card.
 *
 * The rule this enforces is the card's own: a check that could not run is a
 * sentence and never a zero. The corollary, which the card was missing, is
 * that a check nobody can see at all is worse than a zero - so each column now
 * ends with its own arithmetic, and `balanced` is asserted in the tests.
 */
export function columnAccount(input: {
  source: CheckSource;
  rows: CheckRow[];
  clean: CheckRow[];
  shopWideCodes: FindingCode[];
  /** The surface these lines go on, and what it renders. See SurfaceContext. */
  ctx: SurfaceContext;
}): ColumnAccount {
  const { source, shopWideCodes, ctx } = input;
  const wide = new Set<string>(shopWideCodes);
  const mine = input.rows.filter((r) => r.source === source);
  const mineClean = input.clean.filter((r) => r.source === source);
  const found = mine.filter((r) => r.state === "found");
  const shopWide = found.filter((r) => wide.has(r.code)).length;
  const bars = found.length - shopWide;
  const notYetRead = mine.filter((r) => r.state === "notYetRead").length;
  const couldNotRun = mine.filter((r) => r.state === "couldNotRun").length;
  const notApplicable = mine.filter((r) => r.state === "notApplicable").length;
  const counted = mine.filter((r) => r.state === "counted").length;
  const offTable = (Object.keys(OFF_TABLE_SOURCE) as FindingCode[]).filter(
    (code) => OFF_TABLE_SOURCE[code] === source,
  ).length;
  const total = (Object.keys(FINDING_OWNER) as FindingCode[]).filter(
    (code) => codeSource(code) === source,
  ).length;

  const thing = source === "A" ? "product" : "page";
  // "more" only makes sense when something was shown above it, and on a
  // spreadsheet the found rows are in the same table, so it holds there too.
  const more = bars > 0 ? "more " : "";
  const point = mayPoint(ctx);
  const lines: string[] = [];

  if (mineClean.length > 0) {
    // Grouped by denominator, the way cleanSentence in seo-aggregate.ts
    // already does: the page column has two denominators by design (B5 is
    // counted over every page that answered anything, the rest over the pages
    // that answered as a crawler sees them), and one sentence quoting the
    // first row's total for all of them was false about the other (R1 1.1).
    const byDenominator = new Map<number, number>();
    for (const row of mineClean) {
      byDenominator.set(row.denominator, (byDenominator.get(row.denominator) ?? 0) + 1);
    }
    const parts = [...byDenominator.entries()]
      .sort((a, b) => b[1] - a[1] || b[0] - a[0])
      .map(
        ([of, checks]) =>
          `${checks} ${more}${checks === 1 ? "check" : "checks"} found nothing at all on ${nProducts(of, thing)}`,
      );
    lines.push(`${parts.join("; ")}, so there is nothing to show.`);
  }
  if (shopWide > 0) {
    const where =
      point && ctx.shopWide
        ? `in the shop-wide card ${ctx.shopWide}`
        : "listed among the fixes that cover the whole shop";
    lines.push(
      `${shopWide} ${shopWide === 1 ? "check flagged" : "checks flagged"} every product ${shopWide === 1 ? "it" : "they"} could be asked of, so ${shopWide === 1 ? "it is" : "they are"} ${where} rather than counted here.`,
    );
  }
  if (notYetRead > 0) {
    lines.push(
      `${notYetRead} ${more}${notYetRead === 1 ? "check has" : "checks have"} nothing to read yet, so ${notYetRead === 1 ? "it says" : "they say"} nothing rather than zero.`,
    );
  }
  if (couldNotRun > 0) {
    lines.push(
      `${couldNotRun} ${couldNotRun === 1 ? "check needs" : "checks need"} a permission your shop has not approved yet.`,
    );
  }
  if (notApplicable > 0) {
    lines.push(
      `${notApplicable} ${notApplicable === 1 ? "check does" : "checks do"} not apply to a shop set up like yours.`,
    );
  }
  if (counted > 0) {
    const where =
      point && ctx.counted
        ? `${counted === 1 ? "it is" : "they are"} at the foot of this ${ctx.surface === "paper" ? "report" : "screen"} instead`
        : `${counted === 1 ? "it is" : "they are"} not drawn as a bar`;
    lines.push(
      `${counted} ${counted === 1 ? "check counts" : "checks count"} something and state no verdict, so ${where}.`,
    );
  }
  if (offTable > 0) {
    const one = offTable === 1;
    if (source === "A") {
      const where =
        point && ctx.collectionsTotal
          ? `${one ? "it carries its" : "they carry their"} own total above`
          : `${one ? "it is" : "they are"} counted against your collections, with a total of ${one ? "its" : "their"} own, and not here`;
      lines.push(
        `${offTable} ${one ? "check counts your collections" : "checks count your collections"} rather than your products, so ${where}.`,
      );
    } else {
      const where =
        point && ctx.blogTotal
          ? `${one ? "it carries its" : "they carry their"} own total above`
          : `${one ? "it is" : "they are"} counted against your blog posts, with a total of ${one ? "its" : "their"} own, and not here`;
      lines.push(
        `${offTable} ${one ? "check counts your blog posts" : "checks count your blog posts"} rather than your product pages, so ${where}.`,
      );
    }
  }

  const accounted =
    bars + shopWide + mineClean.length + notYetRead + couldNotRun + notApplicable + counted + offTable;
  // The found rows are above these lines on the screen and on paper, and are
  // the rows of the same table in the spreadsheet; when there are none there
  // is nothing to point at, so nothing is.
  const shown =
    bars === 0
      ? "none with something found"
      : point
        ? `${bars} shown above`
        : `${bars} with something found`;
  lines.push(
    `That is all ${total} checks on this side: ${shown}, ${total - bars} in the ${lines.length === 1 ? "line" : "lines"} here.`,
  );

  return {
    source,
    total,
    bars,
    shopWide,
    clean: mineClean.length,
    notYetRead,
    couldNotRun,
    notApplicable,
    counted,
    offTable,
    lines,
    balanced: accounted === total,
  };
}
