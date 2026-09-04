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

import { CHECKS, wasRead, type ScanRowLike } from "./seo-aggregate";
import {
  FINDING_OWNER,
  OWNER_LABEL,
  OWNER_STEPS,
  findingsOf,
  type FindingCode,
  type FindingOwner,
} from "./seo-findings";

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
    codeSets: new Map<string, number>(),
    lastPageReadAt: null,
    lastCatalogueReadAt: null,
  };
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

  // Amendment 1. Exactly 100 percent of the read set, so it is a fact: a code
  // on 188 of 189 products stays a per-product finding, and one on 189 of 189
  // becomes a single decision.
  const shopWideCodes = [...counters.codeCounts.entries()]
    .filter(([, count]) => readSet > 0 && count === readSet)
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
      percent: readSet > 0 ? Math.round((count / readSet) * 100) : 0,
      denominator: readSet,
      title: GROUP_TITLE[group],
      summary: summaryFor(group, count, rows.length),
      rows,
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
    needSomething: tally.merchant + tally.theme + tally.app,
    groups,
    shopWideCodes,
    lastPageReadAt: counters.lastPageReadAt,
    lastCatalogueReadAt: counters.lastCatalogueReadAt,
  };
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
};

export type ShopWideItem = {
  key: string;
  title: string;
  what: string;
  where: string;
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
export function shopWideItems(readiness: Readiness, facts: ShopWideFacts): ShopWideItem[] {
  const items: ShopWideItem[] = [];

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
      owner: "merchant",
      ownerNote: "You, Business screen",
    });
  }

  if (facts.barcode && facts.barcode.of > 0 && facts.barcode.have === 0) {
    items.push({
      key: "barcode",
      title: `No product has a barcode, on all ${facts.barcode.of}`,
      what:
        "Google strongly asks for the manufacturer's barcode where one exists, because it is " +
        "how it matches your product to the same product elsewhere. It is a field in Shopify, " +
        "under each product's variant. We will not make one up: a wrong barcode points Google " +
        "at somebody else's product.",
      where: "Shopify, Products, open one, the variant row.",
      owner: "merchant",
      ownerNote: "You, Shopify, per product",
    });
  }

  for (const code of readiness.shopWideCodes) {
    const owner = FINDING_OWNER[code];
    items.push({
      key: code,
      title: `${OWNER_LABEL[code]}, on all ${readiness.readSet}`,
      what: OWNER_STEPS[code].what,
      where: OWNER_STEPS[code].where,
      owner,
      ownerNote:
        owner === "theme"
          ? "Your theme, one change, all pages"
          : owner === "app"
            ? "Us, once you have read it"
            : `${OWNER_NOTE[owner]}, one change, all products`,
    });
  }

  return items.sort((a, b) => OWNER_RANK[a.owner] - OWNER_RANK[b.owner]);
}

/** The method line under the shop-wide card, with this shop's own arithmetic. */
export function shopWideMethod(readiness: Readiness, items: ShopWideItem[]): string {
  if (items.length === 0) {
    return (
      "Nothing affects every product the same way, so there is nothing to do once here. " +
      "Anything found is against the products it was found on, above."
    );
  }
  const fromChecks = readiness.shopWideCodes.length;
  const threshold =
    fromChecks > 0
      ? ` ${fromChecks} of ${items.length} came from a check that flagged all ${readiness.readSet} of the products read, which is exactly 100 percent and therefore a fact rather than a judgement.`
      : "";
  return (
    "Something is listed here rather than against individual products when it affects every " +
    `product the same way.${threshold} Fixing all ${items.length} would move ${readiness.readSet} ` +
    "products at once, which is why they sit above the per-product list."
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

export type ListingProperty = {
  key: string;
  label: string;
  requirement: ListingRequirement;
  /** Null when nothing has measured this, or when it is not published at all. */
  have: number | null;
  of: number | null;
  /** The sentence that replaces a gauge. Set only when `have` is null. */
  note?: string;
};

export type ListingReadiness = {
  properties: ListingProperty[];
  /** Properties fully in place: `have` equals `of`, with `of` above zero. */
  inPlace: number;
  /** Every property on the card, in place or not. */
  total: number;
  /** True when the catalogue has never been read, so the card is a sentence. */
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
): ListingReadiness {
  const of = facts ? facts.products : null;
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
      have: all(of),
      of,
      ...(of === null ? { note: "The catalogue has not been read yet." } : {}),
    },
    {
      key: "price",
      label: "Price",
      requirement: "required",
      have: all(of),
      of,
      ...(of === null ? { note: "The catalogue has not been read yet." } : {}),
    },
    {
      key: "currency",
      label: "Currency",
      requirement: "required",
      have: all(of),
      of,
      ...(of === null ? { note: "The catalogue has not been read yet." } : {}),
    },
    {
      key: "brand",
      label: "Brand",
      requirement: "required",
      have: facts ? facts.withVendor : null,
      of,
      ...(facts ? {} : { note: "The catalogue has not been read yet." }),
    },
    {
      key: "photo",
      label: "Photo",
      requirement: "required",
      have: facts ? facts.withImage : null,
      of,
      ...(facts ? {} : { note: "The catalogue has not been read yet." }),
    },
    {
      key: "availability",
      label: "In stock or not",
      requirement: "recommended",
      have: all(of),
      of,
      ...(of === null ? { note: "The catalogue has not been read yet." } : {}),
    },
    {
      key: "condition",
      label: "New or used",
      requirement: "recommended",
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
      have: facts ? facts.withBarcode : null,
      of,
      ...(facts ? {} : { note: "The catalogue has not been read yet." }),
    },
  ];

  return {
    properties,
    inPlace: properties.filter((p) => p.have !== null && p.of !== null && p.of > 0 && p.have === p.of)
      .length,
    total: properties.length,
    unmeasured: facts === null,
  };
}

export const LISTING_METHOD =
  "Required and recommended exactly as Google states them for free product listings. " +
  "Product name, price, currency and stock status come from Shopify on every product it holds, " +
  "so those four are complete by construction and the figure beside them is your catalogue " +
  "size rather than a separate measurement. Brand, photo and barcode are counted from the last " +
  "catalogue read. A barcode is your data and this app will never invent one: a made-up barcode " +
  "would point Google at somebody else's product.";

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
