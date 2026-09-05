// The before-snapshot of a paid SEO engagement (PRD-SEO-FULL-ONPAGE §1.1).
//
// What it is for. `grantSeoUnlock` used to write one Setting row and nothing
// else, so there was no record of what the store looked like when the
// engagement began, and the SEO screen could only ever show state: "50 of 50
// have a meta title", which is indistinguishable from "it was always so". One
// row per shop, taken once, turns every figure on that screen into a
// difference.
//
// Three rules the whole module exists to keep:
//
//  1. **Written once, never updated.** Enforced twice: `(shopId, takenBy)` is
//     unique in Postgres, and every path here creates and never upserts. A second
//     `grantSeoUnlock` - the operator retyping the key, a double-submitted
//     form - must leave the first row exactly as it was, because a snapshot
//     re-taken after the app has been writing for a month is not a before.
//  2. **Page-derived fields are null, never 0, when source B has not run.**
//     Zero theme nodes over zero pages read is not a fact about the theme.
//     `pagesRead` is the one page-related column that is a real 0: it counts
//     rows, and "no row had been read" is exactly what it means to say.
//  3. **Nothing is fetched from a storefront here.** Every field comes from
//     the same bulk read source A uses and from the SeoScan rows as they
//     stand. Taking a snapshot must not spend the shop's page budget, and it
//     must not take four minutes on a 500-product store.
//
// Since build step 2 the table also holds a `current` row per shop: the same
// figures as they stand now, rewritten by every catalogue pass. It is not a
// snapshot and nothing about it is protected - it exists so the card can show
// a difference without a screen load paying for a bulk operation. `SNAPSHOT`
// and `CURRENT` below are the two halves, and `takeSeoSnapshot` will never
// write or overwrite the current one, nor `recordCurrentFacts` a before.

import db from "../db.server";
import type { GraphqlFn } from "./admin.server";
import { fetchAllProducts } from "./catalogue.server";
import { parseState, type ProductInput } from "./facts.server";
import { ALT_TEXT_KEY, WRITTEN_KEYS } from "./seo-since";
import { catalogueQuery } from "./eligibility";
import { prefsFor } from "./eligibility.server";
import { classifyMetaField } from "./seo.server";
import { findingsOf } from "./seo-findings";
import {
  buildThemeNodeAggregate,
  createThemeNodeCounters,
  foldThemeNodeRow,
  wasRead,
  type ScanRowLike,
} from "./seo-aggregate";
import { isOurNode } from "./conflicts";

/** Where the row came from. The card's wording depends on it (PRD §1.1). */
export type SnapshotOrigin = "unlock" | "manual";

/** The rolling half. Never a "before", and never protected from a rewrite. */
export const CURRENT = "current";

/** The two origins a real before can have. Read with `readSeoSnapshot`. */
export const BEFORE_ORIGINS: SnapshotOrigin[] = ["unlock", "manual"];

/** Exactly the section 1.1 list, computed and ready to store. */
export type SnapshotFacts = {
  products: number;
  metaTitleSet: number;
  metaTitleOurs: number;
  metaDescriptionSet: number;
  metaDescriptionOurs: number;
  withBarcode: number;
  withVendor: number;
  withSku: number;
  withImage: number;
  /** Null until source B has read at least one page. Never 0 in that state. */
  productNodeTheme: number | null;
  productNodeNone: number | null;
  themeNodeTypes: string[] | null;
  /** Null when the shop had no SeoScan rows at all; `{}` when rows carried no findings. */
  findingsByCode: Record<string, number> | null;
  pagesRead: number;
};

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The distinct JSON-LD types the theme emitted, across every page that
 * answered. Our own nodes are excluded by the same `isOurNode` marker the page
 * reader uses - the question is what the *theme* emits, and in extend mode our
 * node deliberately wears the theme's address, so the `@id` cannot be asked.
 *
 * Sorted, so two snapshots of the same shop are comparable as strings and the
 * list reads the same way on every screen.
 */
function themeTypesOf(rows: ScanRowLike[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!wasRead(row)) continue;
    const nodes = Array.isArray(row.nodes) ? (row.nodes as { types?: unknown; ours?: boolean }[]) : [];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (isOurNode(node)) continue;
      const types = Array.isArray(node.types) ? node.types.map(String) : [];
      for (const type of types) if (type.trim() !== "") seen.add(type);
    }
  }
  return [...seen].sort();
}

/**
 * How many rows carry each check code. One row can carry a code at most once,
 * so this is a count of products, which is what the card's denominator wants.
 * Codes are not filtered against the known vocabulary: a code this release
 * does not know about is still a fact about the shop on that day, and dropping
 * it would silently shrink a historical row when the vocabulary grows.
 */
function findingsByCodeOf(rows: ScanRowLike[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const codes = new Set(findingsOf(row.findings).map((f) => String(f.code)));
    for (const code of [...codes].sort()) counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

/**
 * Every field of section 1.1 from one catalogue read and the SeoScan rows as
 * they stand. Pure: no database, no network, so every shape below can be built
 * as a literal in a test.
 *
 * The identifier predicates are deliberately the same ones `checkIdentifiers`
 * uses for A1 (barcode and SKU on *some* variant, vendor and image on the
 * product), so the snapshot and the findings card cannot disagree about one
 * catalogue.
 */
export function snapshotFacts(
  products: ProductInput[],
  rows: ScanRowLike[],
): SnapshotFacts {
  const facts: SnapshotFacts = {
    products: products.length,
    metaTitleSet: 0,
    metaTitleOurs: 0,
    metaDescriptionSet: 0,
    metaDescriptionOurs: 0,
    withBarcode: 0,
    withVendor: 0,
    withSku: 0,
    withImage: 0,
    productNodeTheme: null,
    productNodeNone: null,
    themeNodeTypes: null,
    findingsByCode: null,
    pagesRead: 0,
  };

  for (const product of products) {
    const variants = product.variants ?? [];
    if (variants.some((v) => filled(v.barcode))) facts.withBarcode += 1;
    if (variants.some((v) => filled(v.sku))) facts.withSku += 1;
    if (filled(product.vendor)) facts.withVendor += 1;
    if (filled(product.imageUrl)) facts.withImage += 1;

    const seoInput = {
      id: product.id,
      metafields: product.metafields ?? [],
      seo: product.seo ?? null,
    };
    if (filled(product.seo?.title)) facts.metaTitleSet += 1;
    if (filled(product.seo?.description)) facts.metaDescriptionSet += 1;
    // "Ours" is the classifier's `auto`, not "has a state entry": a state
    // entry left behind by a value something outside this app has since
    // cleared classifies as `missing`, and counting it here would credit the
    // engagement with a field that is empty.
    if (classifyMetaField(seoInput, "seo_title") === "auto") facts.metaTitleOurs += 1;
    if (classifyMetaField(seoInput, "seo_description") === "auto") {
      facts.metaDescriptionOurs += 1;
    }
  }

  // The SeoScan half. `findingsByCode` stays null when the shop has no rows at
  // all, so `{}` can keep its own meaning: rows existed and none carried a
  // finding.
  if (rows.length > 0) facts.findingsByCode = findingsByCodeOf(rows);

  const counters = createThemeNodeCounters();
  for (const row of rows) foldThemeNodeRow(counters, row);
  const themeNodes = buildThemeNodeAggregate(counters);
  facts.pagesRead = themeNodes.pagesRead;
  if (themeNodes.pagesRead > 0) {
    facts.productNodeTheme = themeNodes.theme;
    facts.productNodeNone = themeNodes.none;
    facts.themeNodeTypes = themeTypesOf(rows);
  }

  return facts;
}

// --- "Written by this app since then" (PRD section 1.2, second block) -------

// The keys this app stamps with a date live in seo-since.ts (WRITTEN_KEYS),
// one list shared with the merchant labels, so the counter below and the card
// cannot disagree about what is countable. Alt text joined it on 5 September
// 2026, stamped per media id by writeAltText; structured data nodes are still
// not countable, for the reason given beside the list.

/** Count, and the span it happened over, for one key. */
export type WrittenSinceEntry = {
  count: number;
  /** ISO strings, straight from the state entries. Null when count is 0. */
  earliest: string | null;
  latest: string | null;
};

export type WrittenSince = Record<string, WrittenSinceEntry>;

/**
 * How much of this app's own output postdates the snapshot, per key.
 *
 * Two conditions, both required, and each one is a rule the product already
 * lives by. `source === "auto"`: a field a human wrote through this app is the
 * merchant's work, and claiming it on an invoice would be the opposite of the
 * never-overwrite promise. `at > since`: a state entry stamped before the
 * engagement began describes work the engagement did not do, and on a shop
 * where the key predates the table (the manual path) most entries will be
 * exactly that.
 *
 * An entry whose `at` will not parse is skipped rather than counted at epoch,
 * which would sort it before every snapshot and silently never count it - the
 * same value, arrived at deliberately.
 */
export function writtenSince(products: ProductInput[], since: Date): WrittenSince {
  const out: WrittenSince = {};
  const sinceMs = since.getTime();

  const count = (key: string, stampedAt: string | undefined) => {
    const at = Date.parse(stampedAt ?? "");
    if (!Number.isFinite(at) || at <= sinceMs) return;
    const when = stampedAt as string;
    const row = (out[key] ??= { count: 0, earliest: null, latest: null });
    row.count += 1;
    if (row.earliest === null || when < row.earliest) row.earliest = when;
    if (row.latest === null || when > row.latest) row.latest = when;
  };

  for (const product of products) {
    const state = parseState(product);
    for (const key of WRITTEN_KEYS) {
      const entry = state[key];
      if (!entry || entry.source !== "auto") continue;
      // Alt text is one entry per product carrying one date per photo, and
      // the figure is photos, not products: a product whose gallery was
      // described across two passes, one before the snapshot and one after,
      // counts only the photos from the second. An entry with no per-photo
      // map (none is written that way, but a JSON column can hold anything)
      // is counted once by its own date, like every other key.
      if (key === ALT_TEXT_KEY && entry.media && typeof entry.media === "object") {
        for (const at of Object.values(entry.media)) count(key, typeof at === "string" ? at : undefined);
        continue;
      }
      count(key, entry.at);
    }
  }
  return out;
}

/**
 * Rewrite the shop's `current` row from the catalogue read the pass already
 * holds. Called at the end of source A's pass, which is already gated on the
 * SEO key, so a shop without the key never gets one.
 *
 * **Nothing is written on a short read.** The same rule as the snapshot, for
 * the same reason: a `products` total below the real catalogue turns every
 * difference on the card into a fiction, and here it would do so silently on
 * every screen load until the next whole pass. Stale-but-true beats
 * fresh-and-short.
 */
export async function recordCurrentFacts(
  shopId: string,
  products: ProductInput[],
  complete: boolean,
): Promise<{ written: boolean; reason?: "short_read" }> {
  if (!complete) return { written: false, reason: "short_read" };

  const rows = (await db.seoScan.findMany({
    where: { shopId },
    select: SCAN_COLUMNS,
  })) as ScanRowLike[];

  const facts = snapshotFacts(products, rows);

  // Counted against the before row if there is one. `writtenSinceAt` records
  // which date it was counted against, so the card can refuse to show a figure
  // computed against a different snapshot than the one it is displaying.
  const before = await readSeoSnapshot(shopId);
  const since = before ? writtenSince(products, before.takenAt) : null;

  const data = {
    takenBy: CURRENT,
    takenAt: new Date(),
    ...facts,
    themeNodeTypes: facts.themeNodeTypes ?? undefined,
    findingsByCode: facts.findingsByCode ?? undefined,
    writtenSince: (since ?? undefined) as never,
    writtenSinceAt: before?.takenAt ?? null,
  };

  await db.seoSnapshot.upsert({
    where: { shopId_takenBy: { shopId, takenBy: CURRENT } },
    create: { shopId, ...data },
    update: data,
  });

  return { written: true };
}

/**
 * Refresh the page-derived half of the `current` row after a nightly page
 * read, without a catalogue read (R2 U3, settled 5 September 2026).
 *
 * The row is rewritten whole by every catalogue pass, and nothing else
 * touched it, so on a shop unlocked on a Tuesday the since card's "Now"
 * column said pages were "not read" until the Monday sweep while the header
 * beside it, read live off the scan table, said every product was fully
 * checked. The page half - pagesRead, the theme's Product nodes, the node
 * types, the count per code - is computed from the scan table alone, so it
 * can be brought up to date the moment the scan finishes. The catalogue half
 * is left exactly as the last catalogue pass wrote it, and `takenAt` with it:
 * the method line names that pass and a page read is not one.
 *
 * Nothing is written when there is no `current` row: a row of catalogue
 * figures cannot be invented from the scan table, and a page half with no
 * catalogue half is the fabricated-zero shape this table exists to avoid.
 * Identical values are not rewritten, so a night that read no page writes
 * nothing.
 */
export async function refreshCurrentPageFacts(
  shopId: string,
): Promise<{ written: boolean; reason?: "no_current" | "unchanged" }> {
  const current = await db.seoSnapshot.findUnique({
    where: { shopId_takenBy: { shopId, takenBy: CURRENT } },
  });
  if (!current) return { written: false, reason: "no_current" };

  const rows = (await db.seoScan.findMany({
    where: { shopId },
    select: SCAN_COLUMNS,
  })) as ScanRowLike[];
  const facts = snapshotFacts([], rows);

  const next = {
    productNodeTheme: facts.productNodeTheme,
    productNodeNone: facts.productNodeNone,
    themeNodeTypes: facts.themeNodeTypes,
    findingsByCode: facts.findingsByCode,
    pagesRead: facts.pagesRead,
  };
  const same =
    current.pagesRead === next.pagesRead &&
    current.productNodeTheme === next.productNodeTheme &&
    current.productNodeNone === next.productNodeNone &&
    JSON.stringify(current.themeNodeTypes ?? null) === JSON.stringify(next.themeNodeTypes) &&
    JSON.stringify(current.findingsByCode ?? null) === JSON.stringify(next.findingsByCode);
  if (same) return { written: false, reason: "unchanged" };

  await db.seoSnapshot.update({
    where: { shopId_takenBy: { shopId, takenBy: CURRENT } },
    data: {
      ...next,
      themeNodeTypes: next.themeNodeTypes ?? undefined,
      findingsByCode: next.findingsByCode ?? undefined,
    },
  });
  return { written: true };
}

/** What `takeSeoSnapshot` did, so callers can say it rather than guess. */
export type TakeSnapshotResult =
  | { written: true; facts: SnapshotFacts; takenBy: SnapshotOrigin }
  | { written: false; reason: "exists"; takenAt: Date; takenBy: string };

const SCAN_COLUMNS = {
  productId: true,
  handle: true,
  bulkAt: true,
  scannedAt: true,
  status: true,
  findings: true,
  nodes: true,
} as const;

/**
 * Take the before-snapshot for one shop, once.
 *
 * Returns without writing when a row already exists - which is the second-call
 * guarantee, and it is checked before the catalogue read so a retyped key
 * costs no bulk operation at all.
 *
 * **It throws on a short read, and that is deliberate.** A bulk read whose
 * parsed count does not match the count Shopify announced would store a
 * `products` total lower than the catalogue, and every difference computed
 * against it afterwards would be wrong in a direction that flatters us. There
 * is no such thing as a partial before: better no row and a retry than a row
 * that quietly understates the starting point. The same reasoning is why
 * `grantSeoUnlock` lets the throw reach the caller and does not store the key.
 */
export async function takeSeoSnapshot(
  shopId: string,
  graphql: GraphqlFn,
  takenBy: SnapshotOrigin,
): Promise<TakeSnapshotResult> {
  const existing = await readSeoSnapshot(shopId);
  if (existing) {
    return {
      written: false,
      reason: "exists",
      takenAt: existing.takenAt,
      takenBy: existing.takenBy,
    };
  }

  const prefs = await prefsFor(shopId);
  const read = await fetchAllProducts(graphql, catalogueQuery(prefs));
  if (!read.complete) {
    throw new Error(
      `Snapshot refused: the catalogue read was short (${read.read.root} of ${read.expected.root} products). ` +
        `A before-snapshot taken from a partial read understates every figure it is later compared against.`,
    );
  }

  const rows = (await db.seoScan.findMany({
    where: { shopId },
    select: SCAN_COLUMNS,
  })) as ScanRowLike[];

  const facts = snapshotFacts(read.products, rows);

  try {
    await db.seoSnapshot.create({
      data: {
        shopId,
        takenBy,
        ...facts,
        themeNodeTypes: facts.themeNodeTypes ?? undefined,
        findingsByCode: facts.findingsByCode ?? undefined,
      },
    });
  } catch (error) {
    // Two callers racing - a double-submitted form - hit the unique index
    // rather than producing a second row. The first one to land wins, which is
    // the same answer the `existing` check above gives.
    if ((error as { code?: string })?.code === "P2002") {
      const row = await readSeoSnapshot(shopId);
      if (row) {
        return { written: false, reason: "exists", takenAt: row.takenAt, takenBy: row.takenBy };
      }
    }
    throw error;
  }

  return { written: true, facts, takenBy };
}

/**
 * The shop's before-snapshot, or null. Never the `current` row: a shop that has
 * had one catalogue pass always has a current row, and returning it here would
 * make every screen believe a before exists and show a difference of zero.
 *
 * `findFirst` over the two before origins rather than `findUnique`, because
 * uniqueness is now on `(shopId, takenBy)`. At most one of the two can exist -
 * `takeSeoSnapshot` refuses when either does.
 */
export async function readSeoSnapshot(shopId: string) {
  return db.seoSnapshot.findFirst({
    where: { shopId, takenBy: { in: BEFORE_ORIGINS } },
  });
}

/** The rolling row: the same figures as the last complete catalogue pass saw. */
export async function readCurrentFacts(shopId: string) {
  return db.seoSnapshot.findUnique({
    where: { shopId_takenBy: { shopId, takenBy: CURRENT } },
  });
}

/**
 * The row as counts, one field per line, for the two scripts.
 *
 * A null page-derived field prints its reason rather than a blank or a dash,
 * because the whole point of storing null there is that the reader must not
 * read it as zero. The same sentence will be the card's wording in build step
 * 2 ("not read at the time"), so the two cannot drift into saying different
 * things about the same row.
 */
export function snapshotLines(f: SnapshotFacts): string[] {
  const NOT_READ = "null (no page had been read at the time)";
  const pad = (label: string) => `  ${label.padEnd(22)}`;
  return [
    `${pad("products")}${f.products}`,
    `${pad("metaTitleSet")}${f.metaTitleSet}`,
    `${pad("metaTitleOurs")}${f.metaTitleOurs}`,
    `${pad("metaDescriptionSet")}${f.metaDescriptionSet}`,
    `${pad("metaDescriptionOurs")}${f.metaDescriptionOurs}`,
    `${pad("withBarcode")}${f.withBarcode}`,
    `${pad("withVendor")}${f.withVendor}`,
    `${pad("withSku")}${f.withSku}`,
    `${pad("withImage")}${f.withImage}`,
    `${pad("pagesRead")}${f.pagesRead}`,
    `${pad("productNodeTheme")}${f.productNodeTheme ?? NOT_READ}`,
    `${pad("productNodeNone")}${f.productNodeNone ?? NOT_READ}`,
    `${pad("themeNodeTypes")}${
      f.themeNodeTypes ? f.themeNodeTypes.join(", ") || "(the theme emitted none)" : NOT_READ
    }`,
    `${pad("findingsByCode")}${
      f.findingsByCode
        ? JSON.stringify(f.findingsByCode)
        : "null (the shop had no SeoScan rows at the time)"
    }`,
  ];
}

/**
 * A stored row as the browser needs it: Dates flattened to ISO strings and the
 * two JSON columns narrowed from Prisma's `JsonValue` to the shapes the card
 * declares. Done here rather than in the route so both the screen and the CSV
 * route flatten it the same way - two loaders each doing their own casts is how
 * a screen and its export come to disagree about one row.
 */
export function serialiseFacts(row: {
  takenAt: Date;
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
  themeNodeTypes: unknown;
  findingsByCode: unknown;
  pagesRead: number;
  writtenSince?: unknown;
  writtenSinceAt?: Date | null;
}) {
  return {
    takenAt: row.takenAt.toISOString(),
    takenBy: row.takenBy,
    products: row.products,
    metaTitleSet: row.metaTitleSet,
    metaTitleOurs: row.metaTitleOurs,
    metaDescriptionSet: row.metaDescriptionSet,
    metaDescriptionOurs: row.metaDescriptionOurs,
    withBarcode: row.withBarcode,
    withVendor: row.withVendor,
    withSku: row.withSku,
    withImage: row.withImage,
    productNodeTheme: row.productNodeTheme,
    productNodeNone: row.productNodeNone,
    themeNodeTypes: Array.isArray(row.themeNodeTypes)
      ? (row.themeNodeTypes as unknown[]).map(String)
      : null,
    findingsByCode:
      row.findingsByCode && typeof row.findingsByCode === "object"
        ? (row.findingsByCode as Record<string, number>)
        : null,
    pagesRead: row.pagesRead,
    writtenSince:
      row.writtenSince && typeof row.writtenSince === "object"
        ? (row.writtenSince as WrittenSince)
        : null,
    writtenSinceAt: row.writtenSinceAt ? row.writtenSinceAt.toISOString() : null,
  };
}

/** A stored row read back as `SnapshotFacts`, so one formatter serves both scripts. */
export function factsOfRow(row: {
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
  themeNodeTypes: unknown;
  findingsByCode: unknown;
  pagesRead: number;
}): SnapshotFacts {
  return {
    products: row.products,
    metaTitleSet: row.metaTitleSet,
    metaTitleOurs: row.metaTitleOurs,
    metaDescriptionSet: row.metaDescriptionSet,
    metaDescriptionOurs: row.metaDescriptionOurs,
    withBarcode: row.withBarcode,
    withVendor: row.withVendor,
    withSku: row.withSku,
    withImage: row.withImage,
    productNodeTheme: row.productNodeTheme,
    productNodeNone: row.productNodeNone,
    themeNodeTypes: Array.isArray(row.themeNodeTypes)
      ? (row.themeNodeTypes as unknown[]).map(String)
      : null,
    findingsByCode:
      row.findingsByCode && typeof row.findingsByCode === "object"
        ? (row.findingsByCode as Record<string, number>)
        : null,
    pagesRead: row.pagesRead,
  };
}
