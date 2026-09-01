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

export type MetaInput = {
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

/** Cut to maxLen without splitting a word, and never with an ellipsis. */
function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
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
 * A meta title condensed from the product title. Aims for around 60
 * characters; a title that alone exceeds the target is truncated at a word
 * boundary, never mid-word, never with an ellipsis character.
 *
 * This used to append the vendor (or the shop name) as a " - Suffix" tail.
 * That produced a doubled brand in the rendered browser title: a Shopify
 * theme's own <title> tag appends the shop name to whatever seo.title we
 * write - not conditionally, not something we can detect from here, just
 * appends it - so "Viborg Bathroom Shelf with Mirror - Nordwood" became
 * "Viborg Bathroom Shelf with Mirror - Nordwood - MRDigital-dev" once the
 * theme was done with it (found reading a live storefront's page source,
 * 31 Aug 2026). Shortening the suffix or skipping it only when the title
 * already names the vendor both leave that example untouched - "Nordwood"
 * is not in the product title and the combined length was 45 characters,
 * comfortably under the 60 target - so neither rule would have prevented
 * the bug that was actually observed. The only rule that removes the
 * doubling unconditionally is to never add a second brand token ourselves:
 * we do not control, and cannot see, what the theme does after we hand
 * back a title, so the one thing guaranteed not to collide with it is
 * nothing at all.
 */
export function buildMetaTitle(input: MetaInput, maxLength = TITLE_TARGET): string {
  const title = cleanOutput(input.title ?? "");
  if (title === "") return "";

  if (title.length <= maxLength) return title;
  return truncateAtWord(title, maxLength);
}

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
    parts.push(`Key details: ${clauses.join("; ")}.`);
  }

  const text = cleanOutput(parts.join(" "));
  if (text === "") return "";
  return truncateAtBoundary(text, maxLength);
}
