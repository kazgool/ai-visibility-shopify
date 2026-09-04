// "Since this engagement began" (PRD-SEO-FULL-ONPAGE section 1.2 and 1.3).
//
// The card that turns the SEO screen from a state into a difference. Every
// figure the snapshot recorded, the same figure today, and what moved.
//
// No ".server" suffix and no import that has one: `app.seo.tsx` renders these
// rows in the browser, and a client build that reaches a .server module fails
// outright (the reason `seo-findings.ts` and `meta-column.ts` exist). Nothing
// here reads a database or a network - it takes two rows and returns strings
// and numbers.
//
// The rules it exists to keep, all of them from the same place: a count that
// was not measured is never rendered as 0, a difference between two figures
// with different denominators is never rendered as a bare number, and a
// snapshot taken by hand after the key was already in use never says "since
// the start".

import { CHECK_LABEL, type FindingCode } from "./seo-findings";
import { CHECKS } from "./seo-aggregate";

/** A stored SeoSnapshot row, as a loader hands it to the browser. */
export type FactsRow = {
  takenAt: string;
  takenBy: string;
  products: number;
  metaTitleSet: number;
  metaTitleOurs: number;
  metaDescriptionSet: number;
  metaDescriptionOurs: number;
  withBarcode: number;
  withVendor: number;
  withSku: number;
  withImage: number;
  productNodeTheme: number | null;
  productNodeNone: number | null;
  themeNodeTypes: string[] | null;
  findingsByCode: Record<string, number> | null;
  pagesRead: number;
  writtenSince?: Record<string, WrittenSinceEntry> | null;
  writtenSinceAt?: string | null;
};

export type WrittenSinceEntry = {
  count: number;
  earliest: string | null;
  latest: string | null;
};

/**
 * The figures with a fixed place on the card, in the order they are defined
 * when nothing distinguishes them. `denominator` names the field the count is
 * out of - `null` for a total, which is its own denominator.
 *
 * `productNodeTheme` and `productNodeNone` are out of `pagesRead`, not out of
 * the catalogue, and the two are never mixed: a store with 500 products and 5
 * pages read has a theme node on "5 of 5", not on "5 of 500". This is the same
 * separation `seo-aggregate.ts` keeps between an A denominator and a B one,
 * and for the same reason.
 */
export const FIGURES: {
  key: keyof FactsRow;
  label: string;
  denominator: "products" | "pagesRead" | null;
}[] = [
  { key: "products", label: "Products in the catalogue", denominator: null },
  { key: "metaTitleSet", label: "Products with a meta title", denominator: "products" },
  { key: "metaTitleOurs", label: "Meta titles written by this app", denominator: "products" },
  {
    key: "metaDescriptionSet",
    label: "Products with a meta description",
    denominator: "products",
  },
  {
    key: "metaDescriptionOurs",
    label: "Meta descriptions written by this app",
    denominator: "products",
  },
  { key: "withBarcode", label: "Products with a barcode (GTIN)", denominator: "products" },
  { key: "withVendor", label: "Products with a vendor (brand)", denominator: "products" },
  { key: "withSku", label: "Products with a SKU", denominator: "products" },
  { key: "withImage", label: "Products with a featured image", denominator: "products" },
  { key: "pagesRead", label: "Product pages read as a crawler sees them", denominator: "products" },
  {
    key: "productNodeTheme",
    label: "Pages where the theme emits a Product node",
    denominator: "pagesRead",
  },
  {
    key: "productNodeNone",
    label: "Pages with no Product node at all",
    denominator: "pagesRead",
  },
];

/**
 * What a row can be, and what each state forbids the screen from saying.
 *
 * `counted` - both sides are numbers and the difference means something.
 * `notReadAtTheTime` - the snapshot's side is null because no page had been
 *   read when it was taken. The row says so and shows no difference; showing 0
 *   would claim the theme emitted nothing, which nobody measured.
 * `notReadNow` - the reverse: nothing has been read since, so today is unknown.
 * `notMeasuredEither` - null on both sides. Still a row, so the reader can see
 *   the check exists and has never had an answer.
 */
export type SinceRowState = "counted" | "notReadAtTheTime" | "notReadNow" | "notMeasuredEither";

export type SinceRow = {
  key: string;
  label: string;
  before: number | null;
  today: number | null;
  /** Null unless both sides are numbers. */
  difference: number | null;
  beforeDenominator: number | null;
  todayDenominator: number | null;
  /** True when the two denominators differ, so the screen must show both. */
  denominatorsDiffer: boolean;
  state: SinceRowState;
};

function denominatorOf(row: FactsRow | null, which: "products" | "pagesRead" | null): number | null {
  if (!row || which === null) return null;
  return row[which];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** One row per figure, plus one per finding code the snapshot recorded. */
function buildRows(before: FactsRow, today: FactsRow | null): SinceRow[] {
  const rows: SinceRow[] = FIGURES.map((figure) => {
    const b = numberOrNull(before[figure.key]);
    const t = today ? numberOrNull(today[figure.key]) : null;
    const bd = denominatorOf(before, figure.denominator);
    const td = denominatorOf(today, figure.denominator);
    return {
      key: String(figure.key),
      label: figure.label,
      before: b,
      today: t,
      difference: b !== null && t !== null ? t - b : null,
      beforeDenominator: bd,
      todayDenominator: td,
      denominatorsDiffer: bd !== null && td !== null && bd !== td,
      state:
        b === null && t === null
          ? "notMeasuredEither"
          : b === null
            ? "notReadAtTheTime"
            : t === null
              ? "notReadNow"
              : "counted",
    };
  });

  // One row per finding code, over the union of both sides: a code that has
  // appeared since the snapshot has no "before" entry and must not be dropped,
  // and one that has been cleared entirely has no "today" entry and must not
  // vanish as though it had never been found.
  //
  // A code absent from a side whose `findingsByCode` is an object means zero
  // products carried it - the object was measured. A side whose
  // `findingsByCode` is null was not measured at all, and stays null.
  const codes = new Set<string>([
    ...Object.keys(before.findingsByCode ?? {}),
    ...Object.keys(today?.findingsByCode ?? {}),
  ]);
  for (const code of [...codes].sort()) {
    const b = before.findingsByCode ? (before.findingsByCode[code] ?? 0) : null;
    const t = today?.findingsByCode ? (today.findingsByCode[code] ?? 0) : null;
    const basis = CHECKS.find((c) => c.code === code)?.basis;
    const which = basis === "catalogue" || basis === undefined ? "products" : "pagesRead";
    const bd = denominatorOf(before, which);
    const td = denominatorOf(today, which);
    rows.push({
      key: `finding:${code}`,
      label: `${code}: ${CHECK_LABEL[code as FindingCode] ?? "a check this release does not know"}`,
      before: b,
      today: t,
      difference: b !== null && t !== null ? t - b : null,
      beforeDenominator: bd,
      todayDenominator: td,
      denominatorsDiffer: bd !== null && td !== null && bd !== td,
      state:
        b === null && t === null
          ? "notMeasuredEither"
          : b === null
            ? "notReadAtTheTime"
            : t === null
              ? "notReadNow"
              : "counted",
    });
  }

  return rows;
}

export type SinceTable = {
  /** Rows worth showing, ordered by the size of the difference, largest first. */
  rows: SinceRow[];
  /** Rows whose difference is exactly 0, collapsed by the card into one line. */
  unchanged: SinceRow[];
  /** The line that replaces them, or null when there are none. */
  unchangedLine: string | null;
};

/**
 * The table of section 1.2.
 *
 * Ordering is by the *size* of the difference and not by its sign, because the
 * question the card answers is "what moved", and a figure that fell by 40 is
 * as much an answer as one that rose by 40. Rows that could not be compared
 * sort after every row that could, in their defined order: they are not
 * "unchanged" and must never be collapsed into that line, which is the whole
 * distinction between a zero and an unmeasured field.
 */
export function sinceTable(before: FactsRow, today: FactsRow | null): SinceTable {
  const all = buildRows(before, today);

  const moved = all.filter((r) => r.difference !== null && r.difference !== 0);
  const unchanged = all.filter((r) => r.difference === 0);
  const uncomparable = all.filter((r) => r.difference === null);

  moved.sort((a, b) => Math.abs(b.difference!) - Math.abs(a.difference!));

  return {
    rows: [...moved, ...uncomparable],
    unchanged,
    unchangedLine:
      unchanged.length === 0
        ? null
        : `${unchanged.length} ${unchanged.length === 1 ? "figure is" : "figures are"} unchanged.`,
  };
}

// --- the sentences ---------------------------------------------------------

/** "5 September 2026". Plain characters only, no month abbreviation. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * The card's heading.
 *
 * A manual snapshot never says "since this engagement began", and the reason
 * is not politeness: it was taken after the key was already in use, so some of
 * what it records is this app's own output. Calling it the start would credit
 * the engagement with work done before it.
 */
export function sinceHeading(before: FactsRow): string {
  return before.takenBy === "manual"
    ? `Since ${formatDay(before.takenAt)}`
    : `Since this engagement began, ${formatDay(before.takenAt)}`;
}

/** The line under the heading. Null when there is nothing to qualify. */
export function sinceMethodLine(before: FactsRow, today: FactsRow | null): string {
  const source =
    "Both columns are counted the same way, from one catalogue read and the page scans as they stood.";
  const when = today
    ? `Today's figures are from the catalogue pass of ${formatDay(today.takenAt)}.`
    : "No catalogue pass has run since the snapshot was taken, so there is no today column yet.";
  const manual =
    before.takenBy === "manual"
      ? " This snapshot was taken by hand, after the setup code had already been applied, so it is a since-this-date and not a since-the-start."
      : "";
  return `${source} ${when}${manual}`;
}

/** What the card says instead of a table when no snapshot exists. */
export const NO_SNAPSHOT_SENTENCE =
  "No before snapshot exists for this shop: the setup code was applied before this app recorded one. " +
  "Until an operator takes one, this card can say what the store looks like today but not what changed.";

/** "30 of 50", or "30" for a figure that is its own denominator. */
export function figure(value: number | null, denominator: number | null): string {
  if (value === null) return "not read at the time";
  return denominator === null ? String(value) : `${value} of ${denominator}`;
}

/** "+15", "-3", or the sentence that replaces a difference nobody can compute. */
export function differenceLabel(row: SinceRow): string {
  if (row.state === "notReadAtTheTime") return "No page had been read at the time";
  if (row.state === "notReadNow") return "Not read since";
  if (row.state === "notMeasuredEither") return "Never read";
  const d = row.difference ?? 0;
  if (d === 0) return "No change";
  return d > 0 ? `+${d}` : String(d);
}

// --- "Written by this app since then" --------------------------------------

export const WRITTEN_LABEL: Record<string, string> = {
  seo_title: "Meta titles",
  seo_description: "Meta descriptions",
  questions: "Buyer questions",
  facts: "Attribute sets",
  summary: "Summaries",
  fit_for: "Who it suits",
};

export type WrittenRow = {
  key: string;
  label: string;
  count: number;
  earliest: string | null;
  latest: string | null;
};

/**
 * What this app wrote after the snapshot, per key, largest first.
 *
 * Returns null - not an empty list - when the figures on hand were counted
 * against a different date than the snapshot being displayed. That happens for
 * one real window: a snapshot taken by hand today, with the last catalogue
 * pass having run yesterday against no snapshot at all. A count under the
 * wrong date is worse than no count, and the next pass fixes it by itself.
 */
export function writtenRows(before: FactsRow, today: FactsRow | null): WrittenRow[] | null {
  if (!today) return null;
  if (!today.writtenSinceAt) return null;
  if (new Date(today.writtenSinceAt).getTime() !== new Date(before.takenAt).getTime()) {
    return null;
  }
  const since = today.writtenSince ?? {};
  return Object.entries(since)
    .map(([key, entry]) => ({
      key,
      label: WRITTEN_LABEL[key] ?? key,
      count: entry.count,
      earliest: entry.earliest,
      latest: entry.latest,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * The line that has to appear under that block, every time.
 *
 * PRD section 1.2 lists alt texts and structured data nodes among the things
 * counted here. Neither can be: `writeAltText` writes alt text straight onto
 * Shopify media and records no state entry, and structured data nodes are not
 * written at all - the Liquid block renders them at request time from the
 * facts and summary metafields, so nothing is stamped when a node starts
 * appearing. There is no timestamp for either to compare against the snapshot.
 * The card says that rather than showing a number nobody measured; the
 * amendment is on the record in the PRD.
 */
export const WRITTEN_OMISSION_SENTENCE =
  "Alt texts and structured data nodes are not counted here. This app stamps no dated record when it writes " +
  "either, so there is no honest count of what it wrote since this date - only of what it wrote in total.";

/** "No field this app writes has been written since then." */
export const WRITTEN_EMPTY_SENTENCE =
  "Nothing this app writes has been written on this store since then.";

/** The one shown when the count is real but was measured against another date. */
export const WRITTEN_NOT_YET_SENTENCE =
  "Not counted yet: the snapshot was taken after the last catalogue pass, so what this app has written " +
  "since then is counted on the next pass.";

// --- CSV (section 1.3) -----------------------------------------------------

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRows(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Both dates on the first line, so the file is self-describing on an invoice. */
function datesLine(before: FactsRow, today: FactsRow | null): (string | number)[] {
  return [
    "Snapshot taken",
    before.takenAt,
    `by ${before.takenBy}`,
    "Today's figures from",
    today ? today.takenAt : "no catalogue pass since the snapshot",
  ];
}

export function sinceCsv(before: FactsRow, today: FactsRow | null): string {
  const table = sinceTable(before, today);
  const body = [...table.rows, ...table.unchanged].map((r) => [
    r.label,
    r.before === null ? "not read at the time" : r.before,
    r.beforeDenominator === null ? "" : r.beforeDenominator,
    r.today === null ? "not read" : r.today,
    r.todayDenominator === null ? "" : r.todayDenominator,
    differenceLabel(r),
  ]);
  return csvRows([
    datesLine(before, today),
    [
      "Figure",
      "At the snapshot",
      "Out of",
      "Today",
      "Out of",
      "Difference",
    ],
    ...body,
  ]);
}

export function writtenCsv(before: FactsRow, today: FactsRow | null): string {
  const rows = writtenRows(before, today);
  if (rows === null) {
    return csvRows([datesLine(before, today), [WRITTEN_NOT_YET_SENTENCE]]);
  }
  return csvRows([
    datesLine(before, today),
    ["What this app wrote since then", "Count", "Earliest", "Latest"],
    ...rows.map((r) => [r.label, r.count, r.earliest ?? "", r.latest ?? ""]),
    [WRITTEN_OMISSION_SENTENCE],
  ]);
}
