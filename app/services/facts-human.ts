// Protection per attribute row, not per table (CC-PROMPT-AI-READABILITY-4
// item 4b, approved by Marius).
//
// Why protection was per field until now, and why that stops here. The
// provenance record has been one entry per metafield since the facts writer
// was built (09847f3, "facts writer with provenance"): a metafield is the unit
// a write replaces, so "who wrote this metafield" was the question the state
// could answer, and the product panel shipped in version 4 with "a badge per
// field for automatic or merchant-edited". That is right for the summary, the
// questions and who it suits, which are one text each. It is wrong for the
// facts, which are a table: saving one corrected row marked the whole table
// human, every automatic pass then skipped the product, and every other row
// stayed as it was on the day of the save while the description moved on.
// The fence kept a person's work from being overwritten; per row it still
// does, and it no longer freezes the rows nobody touched.
//
// The model. `state.factsHuman` holds one entry per row a person changed,
// keyed by the row's normalised label - the dictionary identifies a group by
// its label and a stored fact carries nothing else, so the label is the key
// for every row. `v: null` is a row the person deleted: it stays deleted.
// Automatic passes compute the fresh rows and put these on top; the merged
// list is what the facts metafield holds, so every reader of that metafield
// (the page list, the facts fragment, the mirror, llms.txt, the summary and
// the questions) reads the result with no change of its own.
//
// Pure, and not a .server module: the product screen renders from the same
// functions the writers run.

import type { Fact } from "../engine";

/** One row a person changed. `k` is the label as they typed it; `v: null` means deleted. */
export type HumanRow = { k: string; v: string | null; at: string; engine: string };
export type FactsHuman = Record<string, HumanRow>;

export const FACTS_HUMAN_KEY = "factsHuman";

type StateLike = Record<string, unknown>;

/** The row key: the label, lower case, without diacritics, one space. "Culoare" and "culoare " are one row. */
export function factKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** A stored facts value, parsed; anything that is not a list of { k, v } strings is no facts. */
export function readFacts(raw: string | null | undefined): Fact[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((f) => f && typeof f.k === "string" && typeof f.v === "string").map((f) => ({ k: f.k, v: f.v }))
      : [];
  } catch {
    return [];
  }
}

/** The person's rows off a state object; malformed entries are ignored, never guessed. */
export function factsHumanOf(state: StateLike): FactsHuman {
  const raw = state[FACTS_HUMAN_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FactsHuman = {};
  for (const [key, row] of Object.entries(raw as Record<string, unknown>)) {
    const r = row as Partial<HumanRow> | null;
    if (r && typeof r.k === "string" && (r.v === null || typeof r.v === "string")) {
      out[key] = { k: r.k, v: r.v, at: String(r.at ?? ""), engine: String(r.engine ?? "") };
    }
  }
  return out;
}

/** Put the person's rows on a state object, or take the key off when there are none. */
export function withFactsHuman(state: StateLike, human: FactsHuman): void {
  if (Object.keys(human).length > 0) state[FACTS_HUMAN_KEY] = human;
  else delete state[FACTS_HUMAN_KEY];
}

/**
 * The whole table is a person's, in the state written before item 4b: the
 * facts entry says human, or a facts value exists with no state entry at all,
 * which this app has always treated as human (CLAUDE.md).
 */
export function isWholeTableHuman(state: StateLike, stored: Fact[]): boolean {
  const entry = state.facts as { source?: string } | undefined;
  if (entry?.source === "human") return true;
  return !entry && stored.length > 0 && Object.keys(factsHumanOf(state)).length === 0;
}

/**
 * The migration, in the safe direction (item 4b e): every row of the table a
 * person saved becomes a row of theirs, and every row the engine finds that
 * their table did not hold becomes a row they deleted. Their table was the
 * whole truth under the old rule, so a row missing from it was either removed
 * by them or never shown to them; either way, adding it now would change the
 * page they approved. The result publishes exactly the table they saved, and
 * from then on only a row they reset goes back to automatic.
 */
export function migrateWholeTable(stored: Fact[], fresh: Fact[], at: string, engine: string): FactsHuman {
  const human: FactsHuman = {};
  for (const fact of stored) human[factKey(fact.k)] = { k: fact.k, v: fact.v, at, engine };
  for (const fact of fresh) {
    const key = factKey(fact.k);
    if (!(key in human)) human[key] = { k: fact.k, v: null, at, engine };
  }
  return human;
}

/**
 * The fresh rows with the person's on top (item 4b c). A human value replaces
 * the row with its key, a human delete removes it, every other row is the
 * fresh one; a stored automatic row the engine no longer finds is gone, as it
 * was before. Order: the stored order first, so rows do not jump between
 * passes, then rows new to this pass, then rows a person added.
 */
export function mergeFacts(fresh: Fact[], stored: Fact[], human: FactsHuman): Fact[] {
  const freshByKey = new Map(fresh.map((f) => [factKey(f.k), f]));
  const out: Fact[] = [];
  const seen = new Set<string>();
  const take = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const row = human[key];
    if (row) {
      if (row.v !== null) out.push({ k: row.k, v: row.v });
      return;
    }
    const fact = freshByKey.get(key);
    if (fact) out.push(fact);
  };
  for (const fact of stored) take(factKey(fact.k));
  for (const fact of fresh) take(factKey(fact.k));
  for (const key of Object.keys(human)) take(key);
  return out;
}

export type HumanMerge = {
  /** What the facts metafield should hold. */
  facts: Fact[];
  /** The person's rows, as they should be stored. */
  human: FactsHuman;
  /** The state was the old whole-table form and was converted here. */
  migrated: boolean;
};

/** One call for every writer: the person's rows (migrated when the state is the old form) over the fresh rows. */
export function humanMerge(
  state: StateLike,
  stored: Fact[],
  fresh: Fact[],
  at: string,
  engine: string,
): HumanMerge {
  if (isWholeTableHuman(state, stored)) {
    const human = migrateWholeTable(stored, fresh, at, engine);
    return { facts: mergeFacts(fresh, stored, human), human, migrated: true };
  }
  const human = factsHumanOf(state);
  return { facts: mergeFacts(fresh, stored, human), human, migrated: false };
}

/**
 * What a save changed (item 4b b): the rows submitted against the rows the
 * screen showed. Only a changed, added or deleted row gets an entry; a
 * renamed label is its old key deleted and a new row. No change, no entry.
 */
export function diffFactRows(original: Fact[], submitted: Fact[], at: string, engine: string): FactsHuman {
  const before = new Map(original.map((f) => [factKey(f.k), f]));
  const after = new Map(submitted.map((f) => [factKey(f.k), f]));
  const changes: FactsHuman = {};
  for (const [key, fact] of before) {
    if (!after.has(key)) changes[key] = { k: fact.k, v: null, at, engine };
  }
  for (const [key, fact] of after) {
    const was = before.get(key);
    if (!was || was.v !== fact.v) changes[key] = { k: fact.k, v: fact.v, at, engine };
  }
  return changes;
}

/** Rows a person wrote or deleted. A product with at least one is "written by a person" (item 4b f). */
export function humanRowCount(human: FactsHuman): number {
  return Object.keys(human).length;
}
