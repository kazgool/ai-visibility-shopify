// The aggregate every per-product SEO screen reads (PRD-SEO-PER-PRODUCT
// section 4, build steps 4 to 6).
//
// Pure on purpose, and with no ".server" suffix: no database, no fetch. Two
// reasons, both learned here. The screens render these judgements in the
// browser, and a value import from a .server module outside a loader breaks
// the client build (the reason meta-column.ts and conflicts.ts exist). And
// the acceptance criterion is that every screen reads correctly on four
// shapes of store - a 50-product fixture, a 20,000-product store, an empty
// one, and one where source B has never run - which is a test against this
// function, not against a component.
//
// The design rule of section 4, and the only thing that makes those four
// shapes work with no per-store tuning: nothing here decides which finding
// matters. Rows are ordered by the count the store actually has. Nothing is
// weighted, nothing is hard-coded as "usually wrong", and a store where A1 is
// the whole problem and a store where B3 is the whole problem get the same
// code and a different order.
//
// The other rule, which is this app's oldest: a count of zero and a check
// that could not run are different sentences. A check whose denominator is
// zero reads "not yet read" and never "0". If we did not fetch it, we do not
// say (EXPERIENCE-PRD section 2).

import { isOurNodeId } from "./conflicts";
import { CHECK_LABEL, findingsOf, type Finding, type FindingCode } from "./seo-findings";

/**
 * One SeoScan row, as much of it as any aggregate here reads. Declared
 * structurally rather than imported from Prisma so the tests can build a
 * store of any shape as a literal, and so a `Date` and the string a loader
 * serialises it to are both acceptable.
 */
export type ScanRowLike = {
  productId: string;
  handle: string | null;
  /** When source A last computed this row. Null means source A never ran. */
  bulkAt: Date | string | null;
  /** When source B last fetched the page. Null means the page was never read. */
  scannedAt: Date | string | null;
  /** "ok", "password", "error", or an HTTP status as a string. Null: never read. */
  status: string | null;
  findings: unknown;
  /** Every JSON-LD node on the page, as extractLdNodes returned it. */
  nodes?: unknown;
};

/** Which read a check needs before it can say anything at all. */
export type CheckSource = "A" | "B";

/**
 * Every check the screens show, with the read it depends on. B6 is not in
 * this list because it is not built (PRD section 2.3): a row for a check that
 * never runs would read "not yet read" for ever, which is a promise, not a
 * finding.
 */
export const CHECKS: { code: FindingCode; source: CheckSource }[] = [
  { code: "A1", source: "A" },
  { code: "A2", source: "B" }, // A + B: needs the page as well as the catalogue
  { code: "A3", source: "A" },
  { code: "A4", source: "A" },
  { code: "A5", source: "A" },
  { code: "B1", source: "B" },
  { code: "B2", source: "B" },
  { code: "B3", source: "B" },
  { code: "B4", source: "B" },
  { code: "B5", source: "B" },
];

export type CheckState = "found" | "clean" | "notYetRead";

export type CheckRow = {
  code: FindingCode;
  label: string;
  source: CheckSource;
  state: CheckState;
  /** Products this check found something on. Meaningless when notYetRead. */
  count: number;
  /** Products the check could actually be asked of. Zero means notYetRead. */
  denominator: number;
  /** Products the check could not be asked of: never read, or unreadable. */
  notRead: number;
};

export type FindingsAggregate = {
  /** Rows this shop has: one per product source A last saw. */
  products: number;
  /** Rows source A has computed. The denominator of every A check. */
  bulkRead: number;
  /** Pages source B has attempted, whatever the answer was. */
  pagesAttempted: number;
  /** Pages that answered as a crawler would see them. The denominator of every B check. */
  pagesRead: number;
  /** Pages attempted that answered with a password form, an error or a non-200. */
  couldNotBeRead: number;
  /** Products whose page has never been fetched. */
  neverScanned: number;
  /** Ordered for the card: found first by count descending, then not-yet-read. */
  rows: CheckRow[];
  /** Checks that ran and found nothing. Collapsed into one line by the card. */
  clean: CheckRow[];
};

function present(value: Date | string | null | undefined): boolean {
  return value !== null && value !== undefined && value !== "";
}

/** A page that answered the way a crawler would see it. */
export function wasRead(row: Pick<ScanRowLike, "scannedAt" | "status">): boolean {
  return present(row.scannedAt) && row.status === "ok";
}

/** Attempted and did not answer: a password form, an error, a non-200. */
export function couldNotBeReadRow(row: Pick<ScanRowLike, "scannedAt" | "status">): boolean {
  return present(row.scannedAt) && row.status !== "ok";
}

/**
 * One row per check, counted over a whole shop.
 *
 * The two denominators are different on purpose and are never mixed. An A
 * check is asked of every product source A has computed; a B check can only
 * be asked of a page that actually answered. A store whose storefront is
 * behind a password has a full A denominator and a B denominator of zero, and
 * every B row then reads "not yet read" - which is the whole point of keeping
 * them apart. Mixing them is how a number ends up without a denominator
 * (PRD section 2).
 */
export function aggregateFindings(rows: ScanRowLike[]): FindingsAggregate {
  let bulkRead = 0;
  let pagesAttempted = 0;
  let pagesRead = 0;
  let couldNot = 0;
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (present(row.bulkAt)) bulkRead += 1;
    if (present(row.scannedAt)) {
      pagesAttempted += 1;
      if (row.status === "ok") pagesRead += 1;
      else couldNot += 1;
    }
    // A product is counted once per code however many findings carry it.
    const seen = new Set<string>();
    for (const finding of findingsOf(row.findings)) {
      if (seen.has(finding.code)) continue;
      seen.add(finding.code);
      counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
    }
  }

  const products = rows.length;
  const built: CheckRow[] = CHECKS.map(({ code, source }) => {
    const denominator = source === "A" ? bulkRead : pagesRead;
    const notRead = source === "A" ? products - bulkRead : products - pagesRead;
    const count = counts.get(code) ?? 0;
    // A count with no denominator is not zero, it is unknown. This is the
    // rule the card's "not yet read" line exists for.
    const state: CheckState = denominator === 0 ? "notYetRead" : count > 0 ? "found" : "clean";
    return { code, label: CHECK_LABEL[code], source, state, count, denominator, notRead };
  });

  // Order: what this store is actually wrong about, most first. Ties break on
  // the code so two loads of the same data never disagree. Checks that could
  // not run sit after the ones that did - they are not a finding of zero and
  // must not read as the least of the problems.
  const found = built
    .filter((r) => r.state === "found")
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const notYetRead = built
    .filter((r) => r.state === "notYetRead")
    .sort((a, b) => b.notRead - a.notRead || a.code.localeCompare(b.code));
  const clean = built
    .filter((r) => r.state === "clean")
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    products,
    bulkRead,
    pagesAttempted,
    pagesRead,
    couldNotBeRead: couldNot,
    neverScanned: products - pagesAttempted,
    rows: [...found, ...notYetRead],
    clean,
  };
}

/**
 * "4 checks found nothing on 50 products." Null when nothing is clean, so the
 * card renders no line at all rather than an empty one.
 *
 * Clean checks are grouped by their denominator because the two denominators
 * are genuinely different numbers: on a store part-way through its first
 * source B pass, four A checks are clean over the whole catalogue and three B
 * checks are clean over the pages read so far. One sentence quoting one of
 * those two numbers for all seven would be false about the other four.
 */
export function cleanSentence(aggregate: FindingsAggregate): string | null {
  if (aggregate.clean.length === 0) return null;
  const byDenominator = new Map<number, number>();
  for (const row of aggregate.clean) {
    byDenominator.set(row.denominator, (byDenominator.get(row.denominator) ?? 0) + 1);
  }
  const parts = [...byDenominator.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .map(
      ([denominator, checks]) =>
        `${checks} check${checks === 1 ? "" : "s"} found nothing on ` +
        `${denominator} product${denominator === 1 ? "" : "s"}`,
    );
  return parts.join("; ") + ".";
}

/**
 * The pages-read sentence from PRD section 3, at the top of the card.
 * "212 of 355 pages read; the rest by tomorrow night." On a 20,000-product
 * store it reads "500 of 20,000 pages read; the rest over the next 39
 * nights", which is the true sentence and is why the budget is a per-shop
 * setting an operator can raise.
 *
 * `budget` is this shop's own, so the arithmetic on the screen is the shop's
 * and not a constant repeated in the copy.
 */
export function pagesReadSentence(aggregate: FindingsAggregate, budget: number): string {
  const { products, pagesAttempted } = aggregate;
  if (products === 0) {
    return "No products have been read yet, so there are no pages to fetch.";
  }
  const remaining = products - pagesAttempted;
  const nights = budget > 0 ? Math.ceil(remaining / budget) : 0;
  if (pagesAttempted === 0) {
    return (
      `No product pages have been read yet, out of ${products}. ` +
      `The nightly pass reads up to ${budget} a night` +
      (nights > 1 ? `, so this catalogue takes ${nights} nights.` : ", starting tonight.")
    );
  }
  const rest =
    remaining === 0
      ? ""
      : nights <= 1
        ? "; the rest by tomorrow night"
        : `; the rest over the next ${nights} nights`;
  return `${pagesAttempted} of ${products} pages read${rest}.`;
}

// --- B1 across the catalogue, for the Structured data card ------------------

export type ThemeNodeAggregate = {
  /** Pages the verdict rests on. Zero means there is no verdict yet. */
  pagesRead: number;
  /** Pages carrying a Product node this app did not emit. */
  theme: number;
  /** Pages carrying no Product node at all. */
  none: number;
  /** Pages carrying two or more distinct Product nodes. */
  two: number;
  /** Pages where the only Product node is ours. */
  appOnly: number;
  /**
   * "extend" when any scanned page has a theme node, "full" only when none
   * does, "unknown" while no page has been read.
   */
  verdict: "extend" | "full" | "unknown";
};

type NodeLike = { types?: unknown; id?: unknown };

function productNodesOf(value: unknown): { ours: number; theirs: number; distinct: number } {
  const list = Array.isArray(value) ? (value as NodeLike[]) : [];
  let ours = 0;
  let theirs = 0;
  const ids = new Set<string>();
  let idless = 0;
  for (const node of list) {
    const types = Array.isArray(node?.types) ? node.types.map(String) : [];
    if (!types.includes("Product")) continue;
    const id = typeof node?.id === "string" ? node.id : "";
    if (isOurNodeId(id)) ours += 1;
    else theirs += 1;
    // Extend mode deliberately reuses the theme's @id, so two nodes at one
    // address are one node - the whole reason extend mode exists.
    if (id === "") idless += 1;
    else ids.add(id);
  }
  return { ours, theirs, distinct: ids.size + idless };
}

/**
 * B1 over every scanned product: "Product node from the theme on 340 of 355
 * pages read; none on 12; two or more on 3."
 *
 * The verdict rule of PRD section 4, and the failure it replaces: one page
 * cannot answer this question. A theme can emit a node on some templates and
 * not others, and an app can inject one on some pages and not others. The old
 * card read one product page and recommended Full mode from it; on 3
 * September 2026 both pages it read were the storefront password form and it
 * reported "No Product node found" as a finding about the theme. So Full is
 * recommended only when no scanned page has a theme node, and the card says
 * how many pages that verdict rests on.
 */
export function themeNodeAggregate(rows: ScanRowLike[]): ThemeNodeAggregate {
  let pagesRead = 0;
  let theme = 0;
  let none = 0;
  let two = 0;
  let appOnly = 0;

  for (const row of rows) {
    if (!wasRead(row)) continue;
    pagesRead += 1;
    const { ours, theirs, distinct } = productNodesOf(row.nodes);
    if (theirs > 0) theme += 1;
    if (distinct === 0) none += 1;
    else if (distinct > 1) two += 1;
    if (theirs === 0 && ours > 0) appOnly += 1;
  }

  return {
    pagesRead,
    theme,
    none,
    two,
    appOnly,
    verdict: pagesRead === 0 ? "unknown" : theme === 0 ? "full" : "extend",
  };
}

/** The Structured data card's sentence, with its denominator on every count. */
export function themeNodeSentence(aggregate: ThemeNodeAggregate): string {
  if (aggregate.pagesRead === 0) {
    return "No product page has been read yet, so there is nothing to judge the theme's structured data on.";
  }
  const parts = [
    `Product node from the theme on ${aggregate.theme} of ${aggregate.pagesRead} pages read`,
  ];
  if (aggregate.none > 0) parts.push(`none on ${aggregate.none}`);
  if (aggregate.two > 0) parts.push(`two or more on ${aggregate.two}`);
  if (aggregate.appOnly > 0) parts.push(`only ours on ${aggregate.appOnly}`);
  return parts.join("; ") + ".";
}

/** What to do about it, in the same two sentences the old one-page card used. */
export function themeNodeAdvice(aggregate: ThemeNodeAggregate): string {
  if (aggregate.verdict === "unknown") {
    return "Leave the app embed as it is until pages have been read. Recommending a mode from nothing is how this card used to report the storefront password page as a missing Product node.";
  }
  if (aggregate.verdict === "full") {
    return `No Product node from the theme on any of the ${aggregate.pagesRead} pages read, so switch the app embed to Full mode and this store publishes complete product data.`;
  }
  return `Keep the app embed in Extend mode. We add only what the theme omits, referenced to its node, so assistants read one product rather than two. ${aggregate.none > 0 ? `The ${aggregate.none} pages with no node of their own still get a complete one from us.` : ""}`.trim();
}

// --- the Products list column ----------------------------------------------

export type PageState = "clean" | "findings" | "unread" | "unreadable";

export const PAGE_STATE_LABEL: Record<PageState, string> = {
  clean: "No findings",
  findings: "Findings",
  unread: "Not read yet",
  unreadable: "Could not be read",
};

/**
 * Polaris tones. "unread" is deliberately the default (grey): a page nobody
 * has fetched is not a problem and not a pass, and colouring it either way
 * would be the app answering a question it has not asked yet.
 */
export const PAGE_STATE_TONE: Record<PageState, "success" | "attention" | "critical" | undefined> = {
  clean: "success",
  findings: "attention",
  unread: undefined,
  unreadable: "critical",
};

/** Findings that came from reading the page, which is what the column is about. */
export function pageFindings(row: Pick<ScanRowLike, "findings">): Finding[] {
  return findingsOf(row.findings).filter((f) => f.source !== "A");
}

/**
 * The dot in the Products list's "Page" column. Four states, because the
 * fourth one is the honest answer for a page that answered with the password
 * form: green would claim a clean page and amber would blame the theme for
 * something nobody looked at.
 */
export function pageStateOf(row: ScanRowLike | null | undefined): PageState {
  if (!row || !present(row.scannedAt)) return "unread";
  if (row.status !== "ok") return "unreadable";
  return pageFindings(row).length === 0 ? "clean" : "findings";
}

/** Every finding on one product, page half first, for the editor's section. */
export function findingsForProduct(row: ScanRowLike | null | undefined): Finding[] {
  if (!row) return [];
  const all = findingsOf(row.findings);
  return [...all.filter((f) => f.source !== "A"), ...all.filter((f) => f.source === "A")];
}

/**
 * One finding in the merchant's words. The detail object carries what the
 * check actually saw; this turns it into a sentence without ever inventing a
 * cause the row does not record. Anything unrecognised falls back to the
 * check's own label rather than to a rendered JSON blob.
 */
export function describeFinding(finding: Finding): string {
  const d = (finding.detail ?? {}) as Record<string, any>;
  const label = CHECK_LABEL[finding.code as FindingCode] ?? finding.code;
  switch (finding.code) {
    case "A1": {
      const missing = Array.isArray(d.missing) ? d.missing.join(", ") : "";
      const notRead = Array.isArray(d.notRead) && d.notRead.length > 0
        ? ` Not checked on this pass: ${d.notRead.join(", ")}.`
        : "";
      return missing ? `Absent on this product: ${missing}.${notRead}` : label;
    }
    case "A2":
      return d.mismatch === "price"
        ? `The page states a price of ${d.pageSays} while the product sells at ${d.live}${d.currency ? ` ${d.currency}` : ""}.`
        : d.everyVariantSoldOut
          ? `The page says ${d.pageSays} while every variant is sold out.`
          : `The page says ${d.pageSays} while a variant is for sale.`;
    case "A3": {
      const fields = Array.isArray(d.fields) ? d.fields : [];
      const parts = fields.map(
        (f: any) =>
          `its meta ${f.field} with ${f.sharedWith} other product${f.sharedWith === 1 ? "" : "s"}`,
      );
      return parts.length > 0 ? `Shares ${parts.join(" and ")}.` : label;
    }
    case "A4":
      return `The handle changed from "${d.previousHandle}" to "${d.handle}" and no redirect from the old address exists.`;
    case "A5": {
      const missing = Array.isArray(d.missing) ? d.missing.join(" and ") : "";
      return missing
        ? `No meta ${missing}, so Shopify falls back to a truncation of the description.`
        : label;
    }
    case "B1": {
      const n = Number(d.productNodes ?? 0);
      const who = Array.isArray(d.emitters) && d.emitters.length > 0 ? ` (${d.emitters.join(" and ")})` : "";
      return n === 0
        ? "No Product node on this page at all."
        : `${n} Product nodes on this page${who}, where there should be one.`;
    }
    case "B2":
      return d.canonical
        ? `The canonical points at ${d.canonical}, not at this page.`
        : "This page declares no canonical URL.";
    case "B3":
      return `The page tells search engines not to index it (from the ${d.from === "both" ? "meta tag and the header" : d.from === "header" ? "X-Robots-Tag header" : "robots meta tag"}).`;
    case "B4":
      return "Our block was not detected on this page: no product node of ours and no link to the plain text mirror.";
    case "B5":
      switch (d.reason) {
        case "robots":
          return `robots.txt disallows ${d.disallow}, so this page was never fetched.`;
        case "redirect":
          return `The address ${d.from} answered from ${d.to}.`;
        case "status":
          return `The page answered ${d.status}.`;
        case "unreachable":
          return `The page could not be reached: ${d.error ?? "no reason recorded"}.`;
        default:
          return label;
      }
    default:
      return label;
  }
}
