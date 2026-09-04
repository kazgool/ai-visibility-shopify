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

import { isOurNode } from "./conflicts";
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
 * What a check can be asked of, which is not the same as which read it needs.
 *
 * `catalogue` - every product source A has computed.
 * `pagesRead` - only pages that answered as a crawler would see them.
 * `pagesTried` - every page whose own address answered something, which is
 *   every attempted page except the ones that hit the storefront password.
 *
 * B5 is the one check whose basis is `pagesTried`, and the reason is that B5
 * *is* the check about pages that did not answer properly. Counting it over
 * `pagesRead` subtracts from its denominator exactly the pages it fires on: a
 * store where 200 of 500 products answered 404 read "200 of 300", a number
 * whose numerator is not inside its denominator, and a store where every page
 * failed read "not yet read" while carrying a finding on every product.
 *
 * The password wall is excluded rather than counted, because a password page
 * deliberately produces no finding at all (PRD section 3): counted in, B5
 * would report "0 of 12" on a store where nothing could be read, which claims
 * twelve clean pages. Excluded, its denominator is zero and the row reads
 * "not yet read", which is the true sentence. QA of 3 September 2026.
 */
export type CheckBasis = "catalogue" | "pagesRead" | "pagesTried";

/**
 * Every check the screens show, with the read it depends on. B6 is not in
 * this list because it is not built (PRD section 2.3): a row for a check that
 * never runs would read "not yet read" for ever, which is a promise, not a
 * finding.
 */
/**
 * `reports: true` marks a check that counts and never judges.
 *
 * Two checks are like that so far, B29 and B32, and both for the same stated
 * reason: no named source gives a target number for the internal links on a
 * product page or for the scripts it loads, so this app gives none either.
 * They are rendered at the bottom of the card with their numbers and no
 * found-or-clean framing, which is Break The Web's own rule for an audit -
 * do not report what the merchant cannot act on - applied to the screen.
 *
 * It is not a fourth `CheckBasis` and not a `source`: those say where a number
 * came from, this says what the number means.
 */
export const CHECKS: {
  code: FindingCode;
  source: CheckSource;
  basis: CheckBasis;
  reports?: boolean;
}[] = [
  { code: "A1", source: "A", basis: "catalogue" },
  // A + B: needs the page as well as the catalogue, so it is asked only of
  // pages that answered.
  { code: "A2", source: "B", basis: "pagesRead" },
  { code: "A3", source: "A", basis: "catalogue" },
  { code: "A4", source: "A", basis: "catalogue" },
  { code: "A5", source: "A", basis: "catalogue" },
  // A7 is computed in source B's pass, from a fetch of the shop's sitemap that
  // source A never makes, so its denominator is the pages read and not the
  // catalogue. A6 is deliberately NOT in this list: it counts collections, and
  // this aggregate counts product rows. Mixing the two would give a row a
  // denominator that is not its own - see CheckBasis. The SEO screen reads A6
  // from the collections check's own report.
  { code: "A7", source: "B", basis: "pagesRead" },
  // A12, A13, A15 and A16 (PRD-SEO-FULL-ONPAGE section 5b), built 4 September
  // 2026. All four are computed in source A's pass from the Admin API, so all
  // four are counted over the catalogue. A10 and A11 are deliberately NOT here
  // and never will be: they count collections, and the SEO screen reads them
  // from the collections report the same way it reads A6 - a denominator that
  // is not this aggregate's is never borrowed into it.
  //
  // A14 does not exist. The Markets setting it asks about is not exposed by the
  // Admin API (seo-catalogue.ts says where that was established).
  { code: "A12", source: "A", basis: "catalogue" },
  // A13 and A16 each need one Admin query the shop's token can refuse. When it
  // does, the pass records the code in `couldNotRun` and the row says so - a
  // check that was never asked must not render as a check that passed.
  { code: "A13", source: "A", basis: "catalogue" },
  { code: "A15", source: "A", basis: "catalogue" },
  { code: "A16", source: "A", basis: "catalogue" },
  { code: "B1", source: "B", basis: "pagesRead" },
  { code: "B2", source: "B", basis: "pagesRead" },
  { code: "B3", source: "B", basis: "pagesRead" },
  { code: "B4", source: "B", basis: "pagesRead" },
  { code: "B5", source: "B", basis: "pagesTried" },
  // B6 is computed in source A's pass, from the catalogue read plus one embed
  // read per pass, so its denominator is the catalogue and not the pages read
  // (built 4 September 2026; PRD section 2.1 had assigned it to source B).
  { code: "B6", source: "A", basis: "catalogue" },
  // B7 is a page fact: the same node twice in the page's own markup.
  { code: "B7", source: "B", basis: "pagesRead" },
  { code: "B8", source: "B", basis: "pagesRead" },
  { code: "B9", source: "B", basis: "pagesRead" },
  // B10 to B24 (PRD-SEO-FULL-ONPAGE sections 3 and 5a), built 4 September
  // 2026. Every one is read off the page, so every one is counted over the
  // pages that answered - never over the catalogue. A store whose storefront
  // is behind a password therefore reads "not yet read" on all fifteen, which
  // is the true sentence and not fifteen zeros.
  { code: "B10", source: "B", basis: "pagesRead" },
  { code: "B11", source: "B", basis: "pagesRead" },
  { code: "B12", source: "B", basis: "pagesRead" },
  { code: "B13", source: "B", basis: "pagesRead" },
  { code: "B14", source: "B", basis: "pagesRead" },
  { code: "B15", source: "B", basis: "pagesRead" },
  { code: "B16", source: "B", basis: "pagesRead" },
  { code: "B17", source: "B", basis: "pagesRead" },
  { code: "B18", source: "B", basis: "pagesRead" },
  { code: "B19", source: "B", basis: "pagesRead" },
  { code: "B20", source: "B", basis: "pagesRead" },
  { code: "B21", source: "B", basis: "pagesRead" },
  { code: "B22", source: "B", basis: "pagesRead" },
  // B23 is a fact about the shop, not about this product, and it is written
  // onto every page row of the pass that read robots.txt. Its denominator is
  // the pages read for exactly that reason: the file applies to all of them,
  // so "500 of 500" is the honest reading of one edited line and not an
  // inflation of it.
  { code: "B23", source: "B", basis: "pagesRead" },
  { code: "B24", source: "B", basis: "pagesRead" },
  // B25 to B32 (PRD-SEO-FULL-ONPAGE section 5b, page half), built 4 September
  // 2026. Read off the page like B10 to B24, so counted over the pages that
  // answered - with two deliberate exceptions stated here rather than left to
  // be inferred.
  //
  // B25 needs the collection pages this pass fetched as well as the product
  // page, and a product that appeared on none of them produces no finding at
  // all rather than a clean one. Its denominator is still the pages read,
  // because the row is about the product whose canonical nothing links to.
  { code: "B25", source: "B", basis: "pagesRead" },
  { code: "B26", source: "B", basis: "pagesRead" },
  // B27 is not here and is not a code: it is B1 with the sources named, and
  // B1's detail carries them (seo-findings.ts says why at the union).
  //
  // B28 is the first exception: it is computed in source A's pass from the
  // menu tree and collection membership, fetches no page at all, and is
  // therefore counted over the catalogue. A7 is the same trade in the other
  // direction - an A-numbered check that runs in source B's pass - and the
  // rule both obey is that a count carries the denominator it was measured
  // over, whatever the code's letter.
  { code: "B28", source: "A", basis: "catalogue" },
  // B29 and B32 are the second exception: counts, never verdicts.
  { code: "B29", source: "B", basis: "pagesRead", reports: true },
  // B30 is deliberately NOT here. Its denominator is the blog posts this pass
  // read, which is not the catalogue and not the pages read, and a row must
  // never borrow a denominator that is not its own (see CheckBasis). The SEO
  // screen renders it from the per-shop record the pass writes, the same way
  // it renders A10 and A11 from the collections report.
  { code: "B31", source: "B", basis: "pagesRead" },
  { code: "B32", source: "B", basis: "pagesRead", reports: true },
];

/**
 * `notApplicable` exists for exactly one check so far, and for a reason worth
 * stating: B9 asks about hreflang, and a shop with one market has no hreflang
 * to declare. It produces no finding, which without this state reads as
 * "clean" - a claim that a check ran and passed. The applicability is a fact
 * about the shop that the rows cannot carry, so the pass records it and the
 * screen passes it in (`applicability` on buildFindingsAggregate).
 */
/**
 * `couldNotRun` is the fourth state and the newest, added 4 September 2026 with
 * A13 and A16.
 *
 * It is not `notYetRead`, which means the read those checks depend on has not
 * happened yet and will. It is not `notApplicable`, which means the question
 * does not arise on this shop. It means the read was attempted this pass and
 * refused - an Admin scope the shop's token does not carry, or a query the
 * plan does not expose - so the check has an answer nobody has been allowed to
 * see. Rendered as "clean" it would claim a check ran and passed, which is the
 * failure every other state on this list exists to prevent.
 */
/**
 * `counted` is the fifth state, added 4 September 2026 with B29 and B32.
 *
 * Every other state on this list answers "did the check pass". This one says
 * the question was never a pass-or-fail: the row is a count with no target
 * behind it, so "found" would invent a verdict this app has no source for and
 * "clean" would invent the opposite. A `reports` check whose read has not
 * happened yet is still `notYetRead` - a count of nothing measured is not a
 * count of zero, which is the rule the whole list exists for.
 */
export type CheckState =
  | "found"
  | "clean"
  | "notYetRead"
  | "notApplicable"
  | "couldNotRun"
  | "counted";

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
  /** Why the check could not run at all. Only set when the state says so. */
  reason?: string;
  /**
   * The numeric detail of a `reports` check, summed over every row that
   * carries it. Only set on a `counted` row - B29's four link kinds, B32's
   * script and origin counts - because those are the whole content of a row
   * that states no verdict.
   */
  totals?: Record<string, number>;
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
  const counters = createFindingsCounters();
  for (const row of rows) foldFindingsRow(counters, row);
  return buildFindingsAggregate(counters);
}

/**
 * The counters an aggregate is folded into, one row at a time.
 *
 * Split out of `aggregateFindings` on 3 September 2026 (QA) so the reader in
 * `seo-aggregate.server.ts` can fold each batch of 1,000 rows and drop it.
 * The comment there claimed that was already happening; it was not - every
 * row, `nodes` JSON and all, was accumulated into one array first, so a
 * 20,000-product store held the whole table in memory to produce a handful of
 * integers. `aggregateFindings` is now that fold over an array, so every
 * existing caller and every test keeps the function it had.
 */
export type FindingsCounters = {
  products: number;
  bulkRead: number;
  pagesAttempted: number;
  pagesRead: number;
  /** Attempted pages that answered with the storefront password form. */
  passwordPages: number;
  couldNot: number;
  counts: Map<string, number>;
  /**
   * Per code, the sum of every numeric field in its detail across the rows
   * that carry it. Only filled for `reports` codes: they are the only rows
   * whose content is the numbers rather than the count of products, and
   * summing every code's detail would put arithmetic on fields that are ids,
   * lengths and statuses.
   */
  sums: Map<string, Record<string, number>>;
};

export function createFindingsCounters(): FindingsCounters {
  return {
    products: 0,
    bulkRead: 0,
    pagesAttempted: 0,
    pagesRead: 0,
    passwordPages: 0,
    couldNot: 0,
    counts: new Map<string, number>(),
    sums: new Map<string, Record<string, number>>(),
  };
}

/** The codes whose detail is summed. See FindingsCounters.sums. */
const REPORTS_CODES = new Set(CHECKS.filter((c) => c.reports).map((c) => c.code as string));

export function foldFindingsRow(counters: FindingsCounters, row: ScanRowLike): void {
  counters.products += 1;
  if (present(row.bulkAt)) counters.bulkRead += 1;
  if (present(row.scannedAt)) {
    counters.pagesAttempted += 1;
    if (row.status === "ok") counters.pagesRead += 1;
    else counters.couldNot += 1;
    if (row.status === "password") counters.passwordPages += 1;
  }
  // A product is counted once per code however many findings carry it.
  const seen = new Set<string>();
  for (const finding of findingsOf(row.findings)) {
    if (seen.has(finding.code)) continue;
    seen.add(finding.code);
    counters.counts.set(finding.code, (counters.counts.get(finding.code) ?? 0) + 1);
    if (!REPORTS_CODES.has(finding.code)) continue;
    const into = counters.sums.get(finding.code) ?? {};
    for (const [key, value] of Object.entries(finding.detail ?? {})) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      into[key] = (into[key] ?? 0) + value;
    }
    counters.sums.set(finding.code, into);
  }
}

/**
 * Facts about the shop that no row can carry, and that decide whether a check
 * applies at all. Absent means "not established", which is not the same as
 * "does not apply": B9 on a shop whose markets could not be read stays a
 * normal check rather than being quietly excused.
 */
export type CheckApplicability = {
  /** Enabled markets. One means B9 has nothing to ask. */
  markets?: number | null;
  /**
   * Codes whose read was attempted and refused on the last pass, with the
   * reason the pass recorded. A code here renders as "could not run" whatever
   * its count, because a count of zero from a read that never happened is not
   * a measurement (see CheckState).
   */
  couldNotRun?: Record<string, string> | null;
};

export function buildFindingsAggregate(
  counters: FindingsCounters,
  applicability: CheckApplicability = {},
): FindingsAggregate {
  const { bulkRead, pagesAttempted, pagesRead, passwordPages, couldNot, counts } = counters;
  const products = counters.products;
  const pagesTried = pagesAttempted - passwordPages;

  const basisOf = (basis: CheckBasis): number =>
    basis === "catalogue" ? bulkRead : basis === "pagesRead" ? pagesRead : pagesTried;

  // B9 asks about hreflang. A shop with one market has none to declare, so the
  // check does not apply - and "does not apply" must not be rendered as
  // "clean", which claims a check ran and passed (PRD section 2).
  const singleMarket =
    typeof applicability.markets === "number" && applicability.markets <= 1;

  const built: CheckRow[] = CHECKS.map(({ code, source, basis, reports }) => {
    const denominator = basisOf(basis);
    const notRead = products - denominator;
    const count = counts.get(code) ?? 0;
    // A count with no denominator is not zero, it is unknown. This is the
    // rule the card's "not yet read" line exists for.
    const refused = applicability.couldNotRun?.[code];
    const state: CheckState =
      code === "B9" && singleMarket
        ? "notApplicable"
        : refused
          ? "couldNotRun"
          : denominator === 0
            ? "notYetRead"
            : // A reports check states no verdict, so it is never found and
              // never clean - but it is still "not yet read" above when the
              // read has not happened, because a count of nothing measured is
              // not a count of zero.
              reports
              ? "counted"
              : count > 0
                ? "found"
                : "clean";
    return {
      code,
      label: CHECK_LABEL[code],
      source,
      state,
      count,
      denominator,
      notRead,
      ...(refused ? { reason: refused } : {}),
      ...(state === "counted" ? { totals: counters.sums.get(code) ?? {} } : {}),
    };
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
  // Rendered as its own row with its own sentence, never collapsed into the
  // clean line and never counted in it.
  const notApplicable = built
    .filter((r) => r.state === "notApplicable")
    .sort((a, b) => a.code.localeCompare(b.code));
  // Its own group, before the not-applicable one: a refused read is a thing
  // somebody can fix, and a question that does not arise is not.
  const couldNotRun = built
    .filter((r) => r.state === "couldNotRun")
    .sort((a, b) => a.code.localeCompare(b.code));
  // Last of all, and that position is the point: these state no verdict, so
  // putting them anywhere among the rows that do would invite a reader to
  // treat them as one.
  const counted = built
    .filter((r) => r.state === "counted")
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    products,
    bulkRead,
    pagesAttempted,
    pagesRead,
    couldNotBeRead: couldNot,
    neverScanned: products - pagesAttempted,
    rows: [...found, ...notYetRead, ...couldNotRun, ...notApplicable, ...counted],
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
export function pagesReadSentence(
  aggregate: FindingsAggregate,
  budget: number,
  blockedBy: string | null = null,
): string {
  const { products, pagesAttempted, pagesRead, couldNotBeRead } = aggregate;
  // State one of three: the catalogue has never been read, so there is nothing
  // to scan and the thing to do is the catalogue pass. Said as "not started",
  // never as a count, because a screen full of zeros reads as finished
  // (4 September 2026, the same class as the "0 of 50" bug in CLAUDE.md).
  if (products === 0) {
    return (
      "No products have been read into this table yet, so there are no pages to " +
      "fetch and none of the checks below can run. Run Fill catalogue on the " +
      "dashboard first; the nightly page read starts the night after that."
    );
  }
  // The scan is not waiting for a night that will do anything: the shop's own
  // robots.txt turns it away. Promising "starting tonight" here is the one
  // sentence on this card that the app already knows it will never keep
  // (QA of 3 September 2026).
  if (blockedBy) {
    return (
      `Your robots.txt disallows ${blockedBy}, so no product page is fetched ` +
      `and none of the page checks below can run. robots.txt lives in your ` +
      `theme as robots.txt.liquid.`
    );
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
  // State two of three: every page that was waiting has been read. State three
  // is the budget, which the `rest` clause names. Neither is ever printed for a
  // store that has no rows at all - that took the branch above.
  const rest =
    remaining === 0
      ? "; every page is up to date"
      : nights <= 1
        ? "; the rest by tomorrow night"
        : `; the rest over the next ${nights} nights`;
  // The numerator is pages that answered, not pages attempted. With attempted
  // here, a store whose whole storefront is behind the password read
  // "355 of 355 pages read." directly above "355 of the 355 pages fetched
  // could not be read" - the card contradicting itself in four lines.
  const failed =
    couldNotBeRead > 0
      ? `; ${couldNotBeRead} more could not be read`
      : "";
  return `${pagesRead} of ${products} pages read${failed}${rest}.`;
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

/**
 * Who emitted a Product node on this page, and how many distinct nodes there
 * were.
 *
 * `ours` and `theirs` are read from the stored nodes, with the same
 * `isOurNode` predicate the page reader uses, so the two cannot drift. It reads
 * our emitter marker off the stored node and never the `@id`: a theme is free to
 * choose the same suffix we do, and Horizon does.
 *
 * `distinct` is **not** recomputed from the stored ids, and this is the
 * reason. The page reader merges two nodes when their `@id`s resolve to the
 * same address (`canonicalNodeId` against the page's final URL,
 * seo-page.server.ts), which is what makes extend mode one node rather than a
 * conflict. The row stores the nodes as they were found and does not store
 * the final URL, so a relative `@id` beside an absolute one cannot be merged
 * here. Re-deriving it from the raw strings made the Structured data card say
 * "two or more Product nodes" on pages where the Findings card showed B1
 * clean - the two screens disagreeing about one catalogue, which is the exact
 * promise build step 4 was written to keep. So the count comes from the B1
 * finding the page reader already stored; B1 fires whenever `distinct !== 1`,
 * so no B1 finding means exactly one node. QA of 3 September 2026.
 */
function productNodesOf(
  value: unknown,
  findings: Finding[],
): { ours: number; theirs: number; distinct: number } {
  const list = Array.isArray(value) ? (value as NodeLike[]) : [];
  let ours = 0;
  let theirs = 0;
  for (const node of list) {
    const types = Array.isArray(node?.types) ? node.types.map(String) : [];
    if (!types.includes("Product")) continue;
    const id = typeof node?.id === "string" ? node.id : "";
    if (isOurNode(node as { ours?: boolean })) ours += 1;
    else theirs += 1;
  }
  const b1 = findings.find((f) => f.code === "B1");
  const reported = b1 ? Number((b1.detail as Record<string, unknown>)?.productNodes) : NaN;
  const distinct = b1 ? (Number.isFinite(reported) ? reported : 0) : 1;
  return { ours, theirs, distinct };
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
  const counters = createThemeNodeCounters();
  for (const row of rows) foldThemeNodeRow(counters, row);
  return buildThemeNodeAggregate(counters);
}

/** The same fold, a row at a time, for the batched reader. See FindingsCounters. */
export type ThemeNodeCounters = {
  pagesRead: number;
  theme: number;
  none: number;
  two: number;
  appOnly: number;
};

export function createThemeNodeCounters(): ThemeNodeCounters {
  return { pagesRead: 0, theme: 0, none: 0, two: 0, appOnly: 0 };
}

export function foldThemeNodeRow(counters: ThemeNodeCounters, row: ScanRowLike): void {
  if (!wasRead(row)) return;
  counters.pagesRead += 1;
  const { ours, theirs, distinct } = productNodesOf(row.nodes, findingsOf(row.findings));
  if (theirs > 0) counters.theme += 1;
  if (distinct === 0) counters.none += 1;
  else if (distinct > 1) counters.two += 1;
  if (theirs === 0 && ours > 0) counters.appOnly += 1;
}

export function buildThemeNodeAggregate(counters: ThemeNodeCounters): ThemeNodeAggregate {
  const { pagesRead, theme, none, two, appOnly } = counters;
  return {
    pagesRead,
    theme,
    none,
    two,
    appOnly,
    verdict: pagesRead === 0 ? "unknown" : theme === 0 ? "full" : "extend",
  };
}

/** "page" or "pages". A store that has read exactly one says "1 page read". */
function pageWord(n: number): string {
  return n === 1 ? "page" : "pages";
}

/** The Structured data card's sentence, with its denominator on every count. */
export function themeNodeSentence(aggregate: ThemeNodeAggregate): string {
  if (aggregate.pagesRead === 0) {
    return "No product page has been read yet, so there is nothing to judge the theme's structured data on.";
  }
  const parts = [
    `Product node from the theme on ${aggregate.theme} of ${aggregate.pagesRead} ` +
      `${pageWord(aggregate.pagesRead)} read`,
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
    return `No Product node from the theme on any of the ${aggregate.pagesRead} ${pageWord(aggregate.pagesRead)} read, so switch the app embed to Full mode and this store publishes complete product data.`;
  }
  return `Keep the app embed in Extend mode. We add only what the theme omits, referenced to its node, so assistants read one product rather than two. ${aggregate.none > 0 ? `The ${aggregate.none} ${pageWord(aggregate.none)} with no node of their own still get a complete one from us.` : ""}`.trim();
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
    case "B7": {
      const dupes = Array.isArray(d.duplicates) ? d.duplicates : [];
      const parts = dupes.map(
        (x: any) => `${String(x?.count ?? 2)} ${String(x?.nodeType ?? x?.type ?? "node")} nodes`,
      );
      const whose = d.ours
        ? "This app's own output is on the page more than once"
        : "The page repeats the same structured-data node";
      return parts.length > 0
        ? `${whose}: ${parts.join(", ")} sharing one address. Assistants read one node, so the duplicate is wasted at best and contradictory at worst.`
        : label;
    }
    case "B6": {
      const missing = Array.isArray(d.missing) ? d.missing : [];
      const names = missing.map((m: any) => String(m?.nodeType ?? "")).filter(Boolean);
      const off = Number(d.offCount ?? 0);
      // The switched-off count rides along, said plainly, so a merchant who
      // turned something off is not told it is broken.
      const aside =
        off > 0
          ? ` ${off} more ${off === 1 ? "is" : "are"} switched off on purpose and not counted here.`
          : "";
      if (names.length === 0) return label;
      return `Not being added to this page: ${names.join(", ")}.${aside}`;
    }
    case "A12": {
      const others = Array.isArray(d.others) ? d.others : [];
      const n = Number(d.sharedWith ?? others.length);
      const named = others.join(", ");
      const more = n > others.length ? `, and ${n - others.length} more` : "";
      // Names the group and stops. What to do about two products that share a
      // description is a question about the catalogue, and sometimes the answer
      // is that they are genuinely two sizes of one thing.
      return `This description is word for word the same as ${n} other product${n === 1 ? "" : "s"}: ${named}${more}.`;
    }
    case "A13": {
      const list = Array.isArray(d.redirects) ? d.redirects : [];
      const shown = list.map((r: any) => `${r.path} to ${r.target}`).join("; ");
      const n = Number(d.count ?? list.length);
      return (
        `${n} redirect${n === 1 ? "" : "s"} from this product's address land on the home page: ${shown}. ` +
        "Google treats a redirect to the home page as a soft 404, so the old address earns nothing and the visitor lands somewhere that does not answer their question."
      );
    }
    case "A15": {
      const names = Array.isArray(d.names) ? d.names : [];
      return `${d.count} of ${d.images} image file${Number(d.images) === 1 ? "" : "s"} on this product carry a camera or upload default name: ${names.join(", ")}.`;
    }
    case "A16":
      return "This product is in no collection and no menu links to it, so the only route to it is the sitemap.";
    case "B25": {
      const n = Number(d.long ?? 0);
      return (
        `${n} link${n === 1 ? "" : "s"} on the collection pages read point at this product, and ` +
        "every one of them uses the /collections/.../products/ form. Nothing links to the plain " +
        "product address, which is the one the page asks Google to index."
      );
    }
    case "B26":
      return (
        `This page says noindex, and the only thing it says is wrong with the product is that it ` +
        `is out of stock (${d.availability}). A noindexed page behaves like a soft 404: the ` +
        "address loses the standing it had, and it does not get it back when the product returns."
      );
    case "B28":
      return (
        `The shortest route from the home page to this product through your menus and collections ` +
        `is ${d.depth} clicks, more than the ${d.limit} Break The Web state. No page was fetched to ` +
        "work that out, so a link from inside a page's text is not counted."
      );
    case "B29":
      return (
        `Internal links on this page: ${d.breadcrumb} in a breadcrumb, ${d.related} in a related ` +
        `or recommended block, ${d.collection} pointing at a collection, ${d.inDescription} inside ` +
        `the description, ${d.total} distinct internal addresses in all. The kinds overlap. No ` +
        "target number is stated, because no source states one."
      );
    case "B30":
      return "This blog post links to no product and no collection.";
    case "B31":
      return (
        "The first image inside the page body carries loading=\"lazy\", so the browser defers it " +
        "until layout says it is near the viewport."
      );
    case "B32": {
      const top = Array.isArray(d.top) ? d.top : [];
      const named = top.map((o: any) => `${o.origin} (${o.count})`).join(", ");
      return (
        `${d.scripts} script tags from ${d.origins} origin${Number(d.origins) === 1 ? "" : "s"}` +
        (named ? `: ${named}` : "") +
        ". Counted, not judged - which of these you want is your call."
      );
    }
    case "B8": {
      const where = d.canonical ? `"${d.canonical}"` : "the canonical";
      const why =
        d.reason === "variant"
          ? "It carries a ?variant= parameter, so each variant is a separate address to a crawler."
          : d.reason === "collection"
            ? "It is the collection-prefixed form. Shopify's `within` filter gives every product in a collection a second URL of this shape."
            : d.reason === "unparseable"
              ? "It could not be parsed as a URL."
              : "";
      return `The canonical is ${where} rather than ${d.shouldBe}. ${why}`.trim();
    }
    case "B9": {
      const missing = Array.isArray(d.missing) ? d.missing : [];
      const count = Number(d.markets ?? 0);
      const which =
        missing.length > 0 ? ` No alternate link for: ${missing.join(", ")}.` : "";
      return (
        `This shop has ${count} markets and the page declares ${Array.isArray(d.present) ? d.present.length : 0} hreflang links.${which} ` +
        "Shopify Markets adds these automatically unless the setting is switched off, so this is a setting in Markets and not a fault in the theme."
      );
    }
    // B10 and B11 report the length and quote Google. Never "over the limit":
    // Google states there is no limit, only truncation by device width, and
    // repeating a limit nobody set is how a screen becomes advice.
    case "B10": {
      if (d.present === false) return "This page has no title tag at all.";
      const length = Number(d.length ?? 0);
      return d.side === "short"
        ? `The title tag is ${length} characters: "${d.title}". Shorter than the ${d.shorterThan} characters a result listing usually shows in full, so some of the space is unused.`
        : `The title tag is ${length} characters: "${d.title}". Google states there is no length limit and that the title link is truncated to fit the device width; past about ${d.longerThan} characters a phone result usually shows less than the whole of it.`;
    }
    case "B11": {
      if (d.present === false) return "This page has no meta description.";
      const length = Number(d.length ?? 0);
      return d.side === "short"
        ? `The meta description is ${length} characters. Shorter than the ${d.shorterThan} characters a result snippet usually shows in full.`
        : `The meta description is ${length} characters. Google truncates the snippet to fit the device width; past about ${d.longerThan} characters a phone result usually shows less than the whole of it.`;
    }
    case "B12": {
      const count = Number(d.count ?? 0);
      const texts = Array.isArray(d.texts) ? d.texts.filter(Boolean) : [];
      const quoted = texts.length > 0 ? ` The heading${count === 1 ? " reads" : "s read"}: ${texts.map((t: string) => `"${t}"`).join("; ")}.` : "";
      if (count === 0) return "This page has no H1 heading.";
      if (d.logoInH1) {
        const signals = (d.logoSignals ?? {}) as Record<string, boolean>;
        const seen = [
          signals.image ? "an image" : null,
          signals.logoClass ? "an element classed as a logo" : null,
          signals.linksHome ? "a link to the home page" : null,
        ].filter(Boolean);
        return (
          `The H1 on this page contains ${seen.join(" and ")}, which is the shop logo rather than this page's own heading.` +
          `${quoted} A theme built this way gives every page the same H1.`
        );
      }
      return `This page has ${count} H1 headings, where a page has one.${quoted}`;
    }
    case "B13": {
      const missing = Array.isArray(d.missing) ? d.missing : [];
      return `Absent on this page: ${missing.join(", ")}. These are what a link to this product shows when it is shared.`;
    }
    case "B14": {
      const missing = Array.isArray(d.missing) ? d.missing : [];
      return `Absent on this page: ${missing.join(", ")}.`;
    }
    case "B15": {
      const parts = [
        Number(d.noAlt ?? 0) > 0 ? `${d.noAlt} with no alt attribute` : null,
        Number(d.emptyAlt ?? 0) > 0 ? `${d.emptyAlt} with an empty alt` : null,
        Number(d.machineAlt ?? 0) > 0 ? `${d.machineAlt} whose alt reads as a filename` : null,
      ].filter(Boolean);
      const examples =
        Array.isArray(d.examples) && d.examples.length > 0
          ? ` For example: ${d.examples.map((e: string) => `"${e}"`).join(", ")}.`
          : "";
      return `${d.count} of ${d.images} images on this page: ${parts.join(", ")}.${examples}`;
    }
    case "B16": {
      const broken = Array.isArray(d.broken) ? d.broken : [];
      const list = broken
        .slice(0, 5)
        .map((b: any) => `${b.url} (${b.status === 0 ? "no answer" : b.status})`)
        .join("; ");
      // `checked < total`, not `capped`: the per-page cap is one reason fewer
      // links were checked and the daily budget running out mid-page is the
      // other, and both have to read as "some of them" rather than as "all".
      const scope =
        Number(d.checked) < Number(d.total)
          ? ` ${d.checked} of ${d.total} links on the page were checked.`
          : ` All ${d.total} internal links on the page were checked.`;
      return `${d.count} internal link${Number(d.count) === 1 ? "" : "s"} did not answer: ${list}.${scope}`;
    }
    case "B17": {
      const parts: string[] = [];
      if (d.thinDescription) {
        parts.push(
          `The description on this page is ${d.descriptionWords} words, read from the ${d.descriptionSource}`,
        );
      }
      if (d.thinPage) parts.push(`the page's visible text is ${d.pageWords} words`);
      if (parts.length === 0) return label;
      return `${parts.join(", and ")}.`;
    }
    case "B18": {
      const issues = Array.isArray(d.issues) ? d.issues : [];
      const chars =
        Array.isArray(d.nonAscii) && d.nonAscii.length > 0
          ? ` The characters outside ASCII are: ${d.nonAscii.join(" ")}.`
          : "";
      return `The handle "${d.handle}" contains ${issues.join(", ")}.${chars} Changing a handle changes the address, so Shopify's redirect from the old one has to be kept.`;
    }
    case "B19": {
      const chain = Array.isArray(d.chain) ? d.chain : [];
      const drawn = chain.map((h: any) => `${h.url} (${h.status})`).join(" then ");
      return d.loop
        ? `The product URL redirects in a circle and never answers: ${drawn}.`
        : `The product URL answers after ${d.hops} redirects: ${drawn}.`;
    }
    case "B20": {
      const list = Array.isArray(d.resources) ? d.resources : [];
      const shown = list
        .slice(0, 5)
        .map((r: any) => `${r.url} (in a ${r.tag} tag)`)
        .join("; ");
      return `${d.count} resource${Number(d.count) === 1 ? "" : "s"} on this https page are loaded over http: ${shown}.`;
    }
    case "B21": {
      const others = Array.isArray(d.others) ? d.others : [];
      return `The title tag "${d.title}" is also the title of ${d.sharedWith} other page${Number(d.sharedWith) === 1 ? "" : "s"}: ${others.join(", ")}.`;
    }
    case "B22": {
      const types = Array.isArray(d.types) ? d.types : [];
      const named = types.map((t: any) => `${t.type}${t.count > 1 ? ` (${t.count})` : ""}`).join(", ");
      const whose = d.ours
        ? " One of them is this app's own, emitted on purpose: assistants still read it."
        : "";
      return `This page carries ${named}. Google no longer shows results built from these, so the node costs nothing and earns nothing in Google.${whose}`;
    }
    case "B23": {
      const custom = Array.isArray(d.custom) ? d.custom : [];
      const blocking = Array.isArray(d.blocking) ? d.blocking : [];
      const parts: string[] = [];
      if (blocking.length > 0) {
        parts.push(
          `robots.txt blocks ${blocking.map((b: any) => `${b.path} (the rule is ${b.rule})`).join(" and ")}`,
        );
      }
      if (custom.length > 0) {
        parts.push(
          `${custom.length} line${custom.length === 1 ? "" : "s"} in robots.txt are not part of the file Shopify ships: ${custom.slice(0, 5).join("; ")}`,
        );
      }
      if (parts.length === 0) return label;
      return `${parts.join(". ")}. robots.txt lives in the theme as robots.txt.liquid.`;
    }
    case "B24":
      return `This page carries a meta keywords tag with ${d.terms} term${Number(d.terms) === 1 ? "" : "s"} in it. Google does not use that tag and it has no effect on indexing, so there is nothing here to keep up to date.`;
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
