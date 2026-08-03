// Collection capsules, choice criteria, Q&A and the comparison table
// (PRD §4.8, ported from the WordPress module).
//
// A listing page that is only a grid of thumbnails has nothing an assistant
// can quote, yet it is exactly the page that should answer "what kinds of X
// are there" and "which one suits me". Everything here is assembled from
// attributes already extracted from the merchant's own descriptions - no
// model, no invention, same contract as the rest of the engine.
//
// Pure: no Shopify, no Prisma, no I/O.

import type { Fact } from "./extract";
import { cleanOutput, stripTags } from "./normalize";

export type CollectionMember = {
  id: string;
  title: string;
  handle?: string | null;
  facts: Fact[];
};

export type CollectionInput = {
  title: string;
  descriptionHtml?: string | null;
  products: CollectionMember[];
  /** Columns in the comparison table. More than a handful stops comparing. */
  maxColumns?: number;
  /** Rows in the comparison table. A 400-row table helps nobody. */
  maxRows?: number;
};

export type ComparisonTable = {
  columns: string[];
  rows: { id: string; title: string; handle?: string | null; cells: string[] }[];
};

export type CollectionCapsule = {
  summary: string;
  criteria: string[];
  questions: { q: string; a: string }[];
  table: ComparisonTable;
};

/**
 * Label -> distinct values for prose, in order of first appearance.
 *
 * Values are split on commas first: one product says "burete", another says
 * "textil, burete", and joining those unsplit into a comma-separated sentence
 * reads as "burete, textil, burete" - a duplicate that is really a composite.
 * The comparison table keeps composite values whole; this list is for
 * sentences, where the components are what a person would name.
 */
function valuesByLabel(products: CollectionMember[]): Map<string, string[]> {
  const seen = new Map<string, Set<string>>();
  const order = new Map<string, string[]>();

  for (const product of products) {
    for (const fact of product.facts) {
      const label = fact.k;
      if (!seen.has(label)) {
        seen.set(label, new Set());
        order.set(label, []);
      }
      for (const part of fact.v.split(",")) {
        // Compared case-insensitively with whitespace and trailing
        // punctuation normalised, kept as written: the merchant's casing is
        // what buyers recognise.
        const shown = part.replace(/\s+/g, " ").trim();
        if (shown === "") continue;
        const key = shown.toLowerCase().replace(/[.;:]+$/, "");
        const set = seen.get(label)!;
        if (!set.has(key)) {
          set.add(key);
          order.get(label)!.push(shown);
        }
      }
    }
  }
  return order;
}

/** How many products carry each label. */
function coverageByLabel(products: CollectionMember[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const product of products) {
    // A product listing the same label twice still counts once.
    const labels = new Set(product.facts.map((f) => f.k));
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which attributes are worth comparing on.
 *
 * Two conditions, and the second is the one that matters: an attribute has to
 * *vary*. A column where every product says "PAL melaminat" is visual noise -
 * it looks like information and helps nobody choose. An attribute that only a
 * third of the catalogue carries makes a table full of holes, so it is out
 * too.
 */
export function comparableLabels(
  products: CollectionMember[],
  maxColumns = 5,
): string[] {
  if (products.length === 0) return [];

  const coverage = coverageByLabel(products);
  const values = valuesByLabel(products);
  const threshold = Math.max(2, Math.ceil(products.length * 0.5));

  return [...coverage.entries()]
    .filter(([label, count]) => {
      if (count < threshold) return false;
      const distinct = values.get(label)?.length ?? 0;
      return distinct > 1;
    })
    .sort((a, b) => {
      // Best columns first: widest coverage, then richest variation.
      if (b[1] !== a[1]) return b[1] - a[1];
      const va = values.get(a[0])?.length ?? 0;
      const vb = values.get(b[0])?.length ?? 0;
      return vb - va;
    })
    .slice(0, maxColumns)
    .map(([label]) => label);
}

/**
 * The comparison table. Rows keep the collection's own product order, which
 * is the merchant's merchandising decision, not ours to re-sort.
 */
export function buildComparisonTable(
  input: CollectionInput,
): ComparisonTable {
  const columns = comparableLabels(input.products, input.maxColumns ?? 5);
  if (columns.length === 0) return { columns: [], rows: [] };

  const rows = input.products
    .map((product) => {
      const byLabel = new Map(product.facts.map((f) => [f.k, f.v]));
      const cells = columns.map((label) => cleanOutput(byLabel.get(label) ?? ""));
      return {
        id: product.id,
        title: cleanOutput(product.title),
        handle: product.handle ?? null,
        cells,
        filled: cells.filter(Boolean).length,
      };
    })
    // A row with nothing in any compared column is an empty line in a table
    // that exists to compare. Drop it; the product still has its own page.
    .filter((row) => row.filled > 0)
    .slice(0, input.maxRows ?? 50)
    .map(({ filled: _filled, ...row }) => row);

  return { columns, rows };
}

function firstSentence(text: string, maxWords: number): string {
  const clean = stripTags(text).replace(/\s+/g, " ").trim();
  if (clean === "") return "";
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const words = sentence.split(" ");
  return words.length <= maxWords ? sentence : `${words.slice(0, maxWords).join(" ")}...`;
}

function listValues(values: string[], max = 4): string {
  const shown = values.slice(0, max);
  const rest = values.length - shown.length;
  const joined = shown.join(", ");
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}

/**
 * A paragraph an assistant can lift whole when asked "what kinds of X do they
 * have". Says how many, and what actually differs between them.
 */
export function buildCollectionSummary(input: CollectionInput): string {
  const count = input.products.length;
  const parts: string[] = [];

  const opener = firstSentence(input.descriptionHtml ?? "", 40);
  if (opener) {
    parts.push(opener.endsWith(".") ? opener : `${opener}.`);
  }

  parts.push(
    count === 1
      ? `${input.title} has 1 product.`
      : `${input.title} has ${count} products.`,
  );

  const labels = comparableLabels(input.products, input.maxColumns ?? 5);
  const values = valuesByLabel(input.products);
  // Always name the values, four at a time. A merchant's catalogue repeats
  // more than it looks: the same model appears once per variation, so what
  // reads as twenty different sizes is often five sizes seen four times.
  const clauses = labels
    .slice(0, 3)
    .map((label) => `${label.toLowerCase()}: ${listValues(values.get(label) ?? [])}`);

  if (clauses.length > 0) {
    parts.push(`They differ by ${clauses.join("; ")}.`);
  }

  return cleanOutput(parts.join(" "));
}

/**
 * What to decide on, in the merchant's own vocabulary. This is the "which one
 * suits me" half of a listing page, and it is worth stating plainly because
 * the alternative - a grid of thumbnails - states nothing.
 */
export function buildCollectionCriteria(input: CollectionInput): string[] {
  const labels = comparableLabels(input.products, input.maxColumns ?? 5);
  const values = valuesByLabel(input.products);

  return labels.map((label) =>
    cleanOutput(`${label}: ${listValues(values.get(label) ?? [], 6)}`),
  );
}

/** Questions a buyer asks about a range, answered from what varies in it. */
export function buildCollectionQuestions(
  input: CollectionInput,
): { q: string; a: string }[] {
  const labels = comparableLabels(input.products, input.maxColumns ?? 5);
  const values = valuesByLabel(input.products);
  const out: { q: string; a: string }[] = [];

  if (input.products.length > 0) {
    out.push({
      q: `How many products are in ${input.title}?`,
      a: cleanOutput(
        input.products.length === 1
          ? "1 product."
          : `${input.products.length} products.`,
      ),
    });
  }

  for (const label of labels.slice(0, 4)) {
    const list = values.get(label) ?? [];
    if (list.length === 0) continue;
    out.push({
      q: `What ${label.toLowerCase()} options are there in ${input.title}?`,
      a: cleanOutput(`${listValues(list, 6)}.`),
    });
  }

  return out;
}

/** Everything a collection page publishes, in one deterministic pass. */
export function buildCollectionCapsule(input: CollectionInput): CollectionCapsule {
  return {
    summary: buildCollectionSummary(input),
    criteria: buildCollectionCriteria(input),
    questions: buildCollectionQuestions(input),
    table: buildComparisonTable(input),
  };
}
