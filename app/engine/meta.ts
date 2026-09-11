// Meta title and meta description - condensed from the merchant's own text,
// the same way the summary is (SEO-WORKSPACE-PRD §2, §3.3).
//
// No model, no invention. Every word in the output either appears in the
// product's own title/description or is a fact the dictionary extracted from
// it, plus structural connectives ("Key details:", " - "). Price is
// deliberately excluded (PRD §3.3): a meta description is cached by search
// engines and a stale price is worse than none.

import type { Fact } from "./extract";
import { stripTags, cleanOutput } from "./normalize";
import { orderFacts } from "./summary";
import { phrases, type Language } from "./phrases";

export type MetaInput = {
  /** The connective in the description ("Key details:") follows the shop's
   * content language (phrases.ts). Absent is English. */
  language?: Language | null;
  title: string;
  descriptionHtml?: string | null;
  facts: Fact[];
  /**
   * Not used by buildMetaTitle (see the function's own comment for why).
   * Kept on the type because buildMetaDescription's callers build one
   * shared MetaInput object for both functions.
   */
  vendor?: string | null;
  /** Not used by buildMetaTitle either, same reason. */
  shopName?: string | null;
};

const TITLE_TARGET = 60;
const DESCRIPTION_TARGET = 160;

/** Values that open with one of these are prose, never a title detail. */
const TITLE_CONNECTOR_LEAD =
  /^(?:with|for|contains?|includes?|including|compatible|cu|pentru|contine|din|de|per)\b/iu;

/** Cut to maxLen without splitting a word, and never with an ellipsis. */
function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

/** True when `value` appears in `title` as whole words, case-insensitively. */
function inTitleAsWords(title: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(title);
}

/** Prefer cutting at a sentence or clause boundary; fall back to a word. */
function truncateAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen + 1);
  const lastStop = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("; "),
    slice.lastIndexOf(", "),
  );
  if (lastStop > maxLen * 0.5) {
    const cut = slice.slice(0, lastStop + 1).trim();
    return cut.endsWith(",") || cut.endsWith(";") ? cut.slice(0, -1) : cut;
  }
  return truncateAtWord(text, maxLen);
}

/**
 * A meta title condensed from the product title, around 60 characters, cut
 * at a word boundary and never with an ellipsis character.
 *
 * Never carries the vendor or the shop name: the theme appends the shop name
 * to whatever it is given, unconditionally and invisibly from here, so any
 * brand token added here is doubled in the rendered browser title.
 */
export function buildMetaTitle(input: MetaInput, maxLength = TITLE_TARGET): string {
  const title = cleanOutput(input.title ?? "");
  if (title === "") return "";

  // Invariant: the result is never equal to the product title. Shopify keeps
  // seo.title as an override and does not store one that matches; a cut
  // title differs by itself, a short one gets the merchant's own facts or
  // nothing. Facts: one value at a time, numeric values first, no lone word
  // of three letters or fewer, no value opening with a connector, no value
  // already in the title as a whole word.
  if (title.length > maxLength) return tidyCut(truncateAtWord(title, maxLength));

  const values: string[] = [];
  for (const fact of orderFacts(input.facts ?? [])) {
    for (const raw of String(fact.v).split(/,\s+/)) {
      const value = cleanOutput(raw).trim();
      if (!/[\p{L}\p{N}]/u.test(value)) continue;
      if (!/\d/.test(value) && /^[\p{L}]{1,3}$/u.test(value)) continue;
      if (TITLE_CONNECTOR_LEAD.test(value)) continue;
      if (inTitleAsWords(title, value)) continue;
      if (values.some((v) => v.toLowerCase() === value.toLowerCase())) continue;
      values.push(value);
    }
  }
  const ordered = [...values.filter((v) => /\d/.test(v)), ...values.filter((v) => !/\d/.test(v))];

  const added: string[] = [];
  let candidate = title;
  for (const value of ordered) {
    const next = `${title} - ${[...added, value].join(", ")}`;
    if (next.length > maxLength) {
      if (added.length === 0) continue;
      break;
    }
    added.push(value);
    candidate = next;
  }

  return added.length === 0 ? "" : candidate;
}

/**
 * Strip what a word cut leaves dangling: a separator, an unclosed bracket,
 * or a trailing connector word ("..., fara", "... si", "... with").
 */
function tidyCut(text: string): string {
  let out = text.trim();
  const open = out.lastIndexOf("(");
  if (open !== -1 && out.indexOf(")", open) === -1) out = out.slice(0, open).trim();
  for (let i = 0; i < 3; i += 1) {
    const before = out;
    out = out.replace(/[\s,;:\-&|/]+$/u, "").trim();
    out = out.replace(TRAILING_CONNECTOR, "").trim();
    if (out === before) break;
  }
  return out;
}

const TRAILING_CONNECTOR =
  /\s(?:si|sau|cu|fara|de|din|pentru|la|and|or|with|without|for|of|the|a|an)$/iu;

/**
 * A meta description built from the product's own opening sentence plus up
 * to three ordered facts. Excludes price and availability on purpose - both
 * go stale in a description a search engine caches (SEO-WORKSPACE-PRD §3.3).
 * Aims for around 140 to 160 characters, truncated at a sentence or clause
 * boundary where possible.
 */
export function buildMetaDescription(
  input: MetaInput,
  maxLength = DESCRIPTION_TARGET,
): string {
  const title = cleanOutput(input.title ?? "");
  const clean = stripTags(input.descriptionHtml ?? "").replace(/\s+/g, " ").trim();
  const opener = clean === "" ? "" : (clean.split(/(?<=[.!?])\s/)[0] ?? clean);

  const parts: string[] = [];
  if (opener) {
    parts.push(opener.endsWith(".") ? opener : `${opener}.`);
  } else if (title) {
    parts.push(`${title}.`);
  }

  const facts = orderFacts(input.facts ?? []).slice(0, 3);
  if (facts.length > 0) {
    const clauses = facts.map((f) => `${f.k.toLowerCase()}: ${f.v}`);
    parts.push(phrases(input.language).keyDetails(clauses.join("; ")));
  }

  const text = cleanOutput(parts.join(" "));
  if (text === "") return "";
  return truncateAtBoundary(text, maxLength);
}
