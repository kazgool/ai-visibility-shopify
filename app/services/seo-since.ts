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
import { csvRows, formatCount } from "./report-metrics";

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
  // Two dates on the today row since 5 September 2026: the catalogue half is
  // from the last catalogue pass, the page half follows every nightly scan.
  const when = today
    ? `Today's catalogue figures are from the catalogue pass of ${formatDay(today.takenAt)}; today's page figures are refreshed after every nightly page scan.`
    : "No catalogue pass has run since the snapshot was taken, so there is no today column yet.";
  const manual =
    before.takenBy === "manual"
      ? " This snapshot was taken by hand, after the setup code had already been applied, so it is a since-this-date and not a since-the-start."
      : "";
  return `${source} ${when}${manual}`;
}

/**
 * The line under the heading on the merchant surfaces. Same facts as
 * `sinceMethodLine`; the by-hand case no longer says "snapshot" or "setup
 * code", which are the operator's words (5 September 2026).
 */
export function ownerSinceMethodLine(before: FactsRow, today: FactsRow | null): string {
  const source =
    "Both columns are counted the same way, from one catalogue read and the page reads as they stood.";
  const when = today
    ? `Today's catalogue figures are from the catalogue pass of ${formatDay(today.takenAt)}; today's page figures are refreshed after every nightly page read.`
    : "No catalogue pass has run since the starting point was recorded, so there is no today column yet.";
  const manual =
    before.takenBy === "manual"
      ? " This starting point was recorded by hand, after the work had already begun, so it is a since-this-date and not a since-the-start."
      : "";
  return `${source} ${when}${manual}`;
}

/** What the operator's card says instead of a table when no snapshot exists. */
export const NO_SNAPSHOT_SENTENCE =
  "No before snapshot exists for this shop: the setup code was applied before this app recorded one. " +
  "Until an operator takes one, this card can say what the store looks like today but not what changed.";

/**
 * The same fact for the merchant surfaces, in words a shop owner has, and
 * naming the surface it is on rather than "this card" on a sheet of paper
 * (R2-18). "Snapshot", "setup code" and "operator" stay on /app/seo.
 */
export function ownerNoSnapshotSentence(surface: "screen" | "paper"): string {
  const here = surface === "paper" ? "this report" : "this card";
  return (
    "We have no record of how your store stood before this work began, because the work " +
    `started before this app began keeping one. Until a starting point is recorded, ${here} ` +
    "can say what your store looks like today but not what has changed."
  );
}

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

// Operator vocabulary, read by /app/seo and the CSV export. It keeps
// Record<string, string> and its `??` fallback below, because the keys come
// from a JSON column and an operator is better served by a raw key than by a
// dropped row. The merchant equivalents are OWNER_WRITTEN_LABEL, which are
// typed and never fall back.
export const WRITTEN_LABEL: Record<string, string> = {
  seo_title: "Meta titles",
  seo_description: "Meta descriptions",
  questions: "Buyer questions",
  facts: "Attribute sets",
  summary: "Summaries",
  fit_for: "Who it suits",
  alt_text: "Alt texts (one per photo)",
};

/**
 * The `state` key under which this app stamps its alt text writes, per media
 * id (alt-text.server.ts, 5 September 2026). Named here, in the pure module,
 * because both the writer and the counter import it and neither may import
 * the other.
 */
export const ALT_TEXT_KEY = "alt_text";

/**
 * The state keys this app stamps with a date, and therefore the only things
 * that can honestly be counted "since <date>". One list: the counter in
 * seo-snapshot.server.ts walks it and the merchant labels below are typed
 * over it, so a key added here without a plain label fails typecheck, and a
 * key added to the counter without being here cannot happen (R1 U4, settled 5
 * September 2026: the two lists are one).
 *
 * Structured data nodes are not here and cannot be: they are rendered at
 * request time from the facts and summary metafields, so nothing is stamped
 * when a node starts appearing.
 */
export const WRITTEN_KEYS = [
  "seo_title",
  "seo_description",
  "questions",
  "facts",
  "summary",
  "fit_for",
  ALT_TEXT_KEY,
] as const;

export type WrittenKey = (typeof WRITTEN_KEYS)[number];

/**
 * The same figures, in the words a shop owner reads (build step 5).
 *
 * FIGURES above keeps the operator's names, because the operator workspace,
 * the CSV and the weekly diff all read them and they name each thing by the
 * name the standard gives it. The merchant dashboard at /app/seo/dashboard may
 * not use that vocabulary at all, so it reads these instead. Keyed by the same
 * FIGURES keys and total over them, so a new figure that forgets a plain label
 * fails typecheck rather than shipping jargon.
 */
export const OWNER_FIGURE_LABEL: Record<OwnerFigureKey, string> = {
  products: "Products in your catalogue",
  metaTitleSet: "Products with a title for Google",
  metaTitleOurs: "Titles for Google written by this app",
  metaDescriptionSet: "Products with a description for Google",
  metaDescriptionOurs: "Descriptions for Google written by this app",
  withBarcode: "Products with a barcode",
  withVendor: "Products with a brand",
  withSku: "Products with a product code",
  withImage: "Products with a photo",
  pagesRead: "Product pages read the way a search engine reads them",
  productNodeTheme: "Pages where your theme already describes the product to search engines",
  productNodeNone: "Pages that describe no product to search engines",
};

/**
 * The keys the merchant dashboard has a plain word for. Written as a union
 * rather than left as `string`, so the two records below are total over it and
 * a figure added tomorrow that forgets a plain label fails typecheck - which
 * the comment above used to claim while the type said `Record<string, string>`
 * and let anything through.
 */
export type OwnerFigureKey =
  | "products"
  | "metaTitleSet"
  | "metaTitleOurs"
  | "metaDescriptionSet"
  | "metaDescriptionOurs"
  | "withBarcode"
  | "withVendor"
  | "withSku"
  | "withImage"
  | "pagesRead"
  | "productNodeTheme"
  | "productNodeNone";

/** One list with WRITTEN_KEYS, by construction rather than by hand. */
export type OwnerWrittenKey = WrittenKey;

/** The same for the "written by this app since then" block. */
export const OWNER_WRITTEN_LABEL: Record<OwnerWrittenKey, string> = {
  seo_title: "Titles for Google",
  seo_description: "Descriptions for Google",
  questions: "Buyer questions",
  facts: "Sets of product details",
  summary: "Summaries",
  fit_for: "Who it suits",
  alt_text: "Photo descriptions (one per photo)",
};

/**
 * The rows the merchant dashboard shows: the fixed figures only.
 *
 * The per-code rows `sinceTable` also produces are deliberately dropped here.
 * Their labels start with the check code, and a check code never appears on
 * that screen - it stays in the CSV and in the operator view. The dashboard
 * shows what moved in the shop's own fields; what each check found is the
 * findings card's business, with its own denominators.
 */
export function ownerSinceRows(table: SinceTable): NamedSinceRow[] {
  return table.rows
    .filter((row) => !row.key.startsWith("finding:"))
    .map((row) => ({ row, ownerLabel: ownerFigureLabel(row) }))
    // A figure this release has no plain word for is dropped here rather than
    // shown under `row.label`, which carries the operator's wording. The
    // caller then gets rows whose label is a plain `string`, so no renderer
    // has a null to decide about and none can reach for the technical name.
    .filter((r): r is { row: SinceRow; ownerLabel: string } => r.ownerLabel !== null)
    .map(({ row, ownerLabel }) => ({ ...row, ownerLabel }));
}

/** A row of `ownerSinceRows`: a since row that is certain to have a plain label. */
export type NamedSinceRow = SinceRow & { ownerLabel: string };

/**
 * The unchanged rows the merchant surfaces would show, and the line that
 * stands in for them.
 *
 * Counted over the same rows `ownerSinceRows` keeps: the fixed figures with a
 * plain label, never the per-code rows. The screen used to print
 * `sinceTable`'s own line - "32 figures are unchanged" - under a table of
 * twelve figures, because twenty-one of the thirty-two were finding rows the
 * merchant is deliberately never shown (R1 1.2).
 */
export function ownerUnchangedRows(table: SinceTable): NamedSinceRow[] {
  return table.unchanged
    .filter((row) => !row.key.startsWith("finding:"))
    .map((row) => ({ row, ownerLabel: ownerFigureLabel(row) }))
    .filter((r): r is { row: SinceRow; ownerLabel: string } => r.ownerLabel !== null)
    .map(({ row, ownerLabel }) => ({ ...row, ownerLabel }));
}

/** "9 figures are unchanged.", over the merchant's rows only; null when none is. */
export function ownerUnchangedLine(table: SinceTable): string | null {
  const unchanged = ownerUnchangedRows(table).length;
  if (unchanged === 0) return null;
  return `${unchanged} ${unchanged === 1 ? "figure is" : "figures are"} unchanged.`;
}

/** The since figure on a merchant surface: "30 of 50", with a thousands separator. */
export function ownerFigure(value: number | null, denominator: number | null): string {
  if (value === null) return "not read at the time";
  return denominator === null
    ? formatCount(value)
    : `${formatCount(value)} of ${formatCount(denominator)}`;
}

/**
 * A plain label for a row of `ownerSinceRows`, or null when this release has
 * none.
 *
 * Null rather than `row.label`: that field carries the operator's wording -
 * "Meta titles", "Products with a vendor (brand)" - and falling back to it
 * puts the vocabulary a merchant would have to look up on the one screen
 * written to keep it out. A row nobody can name in plain words has nothing to
 * tell a merchant, so the caller drops it. The key comes out of a JSON column,
 * so the lookup can genuinely miss and the type says so.
 */
export function ownerFigureLabel(row: SinceRow): string | null {
  return OWNER_FIGURE_LABEL[row.key as OwnerFigureKey] ?? null;
}

/** The same, for a row of `writtenRows`, and null for the same reason. */
export function ownerWrittenLabel(row: WrittenRow): string | null {
  return OWNER_WRITTEN_LABEL[row.key as OwnerWrittenKey] ?? null;
}

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
 * counted here. Alt texts are, since 5 September 2026: `writeAltText` stamps
 * one dated entry per media id on the product's `state`, and the count is per
 * photo. Alt texts written before that date carry no entry, so they are in
 * the totals the alt text pass reports and never in the since figure, and the
 * sentence says so. Structured data nodes still cannot be counted: they are
 * not written at all - the Liquid block renders them at request time from the
 * facts and summary metafields, so nothing is stamped when a node starts
 * appearing. The card says that rather than showing a number nobody measured.
 */
export const WRITTEN_OMISSION_SENTENCE =
  "Alt texts are counted one per photo, from the dated record this app stamps since 5 September 2026; " +
  "alt texts written before that date carry no record, so they are in the pass totals and never here. " +
  "Structured data nodes are not counted: this app stamps no dated record when a node starts appearing, " +
  "so there is no honest count of those since this date - only of what is published in total.";

/**
 * The same sentence for the merchant dashboard, which may not use the words
 * the operator's one uses. Same fact, same limits, none of the vocabulary.
 */
export const OWNER_WRITTEN_OMISSION_SENTENCE =
  "Photo descriptions are counted one per photo, from the dated record this app keeps since " +
  "5 September 2026; descriptions written before that date carry no record, so they are in the " +
  "totals this app reports elsewhere and never here. The details this app publishes for search " +
  "engines are not counted: nothing is dated when one starts appearing, so there is no honest count " +
  "of those since this date - only of what is published in total. We would rather say that than guess.";

/** "No field this app writes has been written since then." */
export const WRITTEN_EMPTY_SENTENCE =
  "Nothing this app writes has been written on this store since then.";

/** The one shown when the count is real but was measured against another date. */
export const WRITTEN_NOT_YET_SENTENCE =
  "Not counted yet: the snapshot was taken after the last catalogue pass, so what this app has written " +
  "since then is counted on the next pass.";

/** The same for the merchant surfaces, without the operator's word for the row. */
export const OWNER_WRITTEN_NOT_YET_SENTENCE =
  "Not counted yet: the starting point was recorded after the last catalogue pass, so what this app " +
  "has written since then is counted on the next pass.";

// --- CSV (section 1.3) -----------------------------------------------------

// The cell writer and the row writer are shared with the Report export rather
// than copied. This file used to carry its own two-line copy of both, and a
// defect fixed in one copy is a defect still shipping in the other - which is
// exactly what happened with the formula-injection guard. See csvCell in
// report-metrics.ts for why the guard exempts plain numbers: differenceLabel
// below is the caller that needs the exemption.

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

// --- the merchant's then-and-now file ----------------------------------------

/**
 * The then-and-now spreadsheet the merchant dashboard offers, from the same
 * two rows as `sinceCsv` and in the words the dashboard uses.
 *
 * `sinceCsv` above is the operator's file: FIGURES labels, one row per check
 * code, ISO dates and "by unlock". The dashboard's button pointed at it (R1
 * 2.4, R2-12), so a merchant pressing "Spreadsheet: then and now" received
 * "Meta title", "GTIN", "Product node" and check codes as row prefixes. This
 * file reads OWNER_FIGURE_LABEL and OWNER_WRITTEN_LABEL, both typed and total,
 * drops the per-code rows the way `ownerSinceRows` does, and writes the dates
 * the way the card does. `heading` is the report heading the other four
 * merchant files start with, so the file names its shop and its date on line
 * one however it is renamed.
 */
export function ownerSinceCsv(heading: string, before: FactsRow, today: FactsRow | null): string {
  const table = sinceTable(before, today);
  const rows = [...ownerSinceRows(table), ...ownerUnchangedRows(table)];
  const body = rows.map((r) => [
    r.ownerLabel,
    r.before === null ? "not read at the time" : r.before,
    r.beforeDenominator === null ? "" : r.beforeDenominator,
    r.today === null ? "not read" : r.today,
    r.todayDenominator === null ? "" : r.todayDenominator,
    differenceLabel(r),
  ]);
  const written = writtenRows(before, today);
  const writtenBlock: (string | number)[][] =
    written === null
      ? [[OWNER_WRITTEN_NOT_YET_SENTENCE]]
      : written.length === 0
        ? [[WRITTEN_EMPTY_SENTENCE]]
        : [
            ["What this app wrote since then", "Count", "Earliest", "Latest"],
            ...written
              .map((r) => ({ r, label: ownerWrittenLabel(r) }))
              .filter((x): x is { r: WrittenRow; label: string } => x.label !== null)
              .map(({ r, label }) => [
                label,
                r.count,
                r.earliest ? formatDay(r.earliest) : "",
                r.latest ? formatDay(r.latest) : "",
              ]),
          ];
  return csvRows([
    [heading],
    [sinceHeading(before)],
    [ownerSinceMethodLine(before, today)],
    [],
    ["Products that have", "Then", "Out of", "Now", "Out of", "Change"],
    ...body,
    [],
    ...writtenBlock,
    [OWNER_WRITTEN_OMISSION_SENTENCE],
  ]);
}
