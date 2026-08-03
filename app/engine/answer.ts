// What an assistant could answer about this product (PRD: the listing sells
// the failure mode of the alternatives).
//
// Competitors show a mock "here is how you appear in ChatGPT". Nobody can
// know that: an assistant composes a fresh answer each time and publishes no
// ranking. What CAN be known, exactly, is what it has to work with - so this
// builds the answer strictly from what is published, and shows the same
// question answered without the app beside it.
//
// No model call, no invention: every sentence is assembled from the values
// already written to the merchant's metafields.
//
// Pure: no Shopify, no Prisma, no I/O.

import type { Fact } from "./extract";
import { cleanOutput } from "./normalize";

export type AnswerInput = {
  title: string;
  facts: Fact[];
  summary?: string | null;
  questions?: { q: string; a: string }[];
  price?: string | null;
  currency?: string | null;
  /** The description, used to show what an assistant faces without us. */
  descriptionHtml?: string | null;
};

export type AnswerPreview = {
  question: string;
  /** What an assistant can quote now, from published data. */
  withApp: string;
  /** What it would have without us: the theme's bare product markup. */
  withoutApp: string;
  /** Which published values the answer used - shown so nothing looks magic. */
  sources: string[];
};

function labelled(facts: Fact[], names: string[]): Fact | undefined {
  const byLabel = new Map(facts.map((f) => [f.k.toLowerCase(), f]));
  for (const n of names) {
    const hit = byLabel.get(n);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The comparison question - the one assistants answer with a table, and the
 * one a product with no attributes can never appear in.
 */
export function buildAnswerPreview(input: AnswerInput): AnswerPreview | null {
  const title = cleanOutput(input.title);
  const facts = input.facts ?? [];
  if (facts.length === 0 && !input.summary) return null;

  const material = labelled(facts, ["material", "materials", "fabric", "materiale"]);
  const size = labelled(facts, ["dimensions", "dimensiuni", "size", "marime"]);
  const colour = labelled(facts, ["colour", "color", "culoare"]);

  const question = material
    ? `What is ${title} made of, and what size is it?`
    : `Tell me about ${title}.`;

  const parts: string[] = [];
  const sources: string[] = [];

  if (input.summary) {
    parts.push(cleanOutput(input.summary));
    sources.push("summary");
  }

  const details: string[] = [];
  if (material) {
    details.push(`made of ${material.v}`);
    sources.push(material.k);
  }
  if (size) {
    details.push(`${size.v}`);
    sources.push(size.k);
  }
  if (colour) {
    details.push(`in ${colour.v}`);
    sources.push(colour.k);
  }
  if (details.length > 0 && !input.summary) {
    parts.push(cleanOutput(`${title} is ${details.join(", ")}.`));
  }

  // A published answer to a real buyer question is the strongest evidence
  // that the page is quotable, so include one if there is one.
  const extra = (input.questions ?? []).find(
    (qa) => qa.a && qa.a.trim() !== "" && !qa.q.toLowerCase().includes("made of"),
  );
  if (extra) {
    parts.push(cleanOutput(extra.a.replace(/\.$/, "") + "."));
    sources.push("questions");
  }

  const withApp = parts.join(" ").trim();

  // Without the app the assistant has the theme's Product markup: a name, a
  // price, a stock flag. The attributes live only in prose it may not parse,
  // which is precisely why comparison answers skip such products.
  const bare = input.price
    ? `${title}, ${input.price}${input.currency ? ` ${input.currency}` : ""}.`
    : `${title}.`;
  const withoutApp = cleanOutput(
    `${bare} No stated material, size or colour an assistant could compare.`,
  );

  return {
    question,
    withApp,
    withoutApp,
    sources: Array.from(new Set(sources)),
  };
}
