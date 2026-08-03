// The answer capsule, starter questions and who-it-suits.
//
// Deterministic, like the rest of the engine: no model, no invention. Every
// sentence is assembled from things the merchant already wrote or from facts
// the dictionary extracted, so nothing can be hallucinated into a product page.
//
// The rule that matters most, carried from the WordPress module: an assistant
// answers with the sentence it can lift. If the price exists only in markup,
// the answer becomes "contact them for pricing"; if it is in the prose, the
// answer is "Model X, 3000 RON". So commercials go in the capsule text.

import type { Fact } from "./extract";
import { stripTags } from "./normalize";

export type CapsuleInput = {
  title: string;
  descriptionHtml?: string | null;
  facts: Fact[];
  price?: string | null;
  currency?: string | null;
  available?: boolean;
  vendor?: string | null;
  productType?: string | null;
  maxWords?: number;
};

/** Labels that describe what a thing *is*, in the order they read naturally. */
const DESCRIPTIVE_ORDER = [
  "material", "materials", "fabric", "finish", "finisaj",
  "cut", "silhouette", "shape", "style", "stil",
  "colour", "color", "culoare",
  "dimensions", "dimensiuni", "size", "weight",
  "capacity", "capacitate",
  "features", "functionality", "functionalitate",
  "room", "camera", "use", "occasion",
];

function orderFacts(facts: Fact[]): Fact[] {
  const rank = (f: Fact) => {
    const i = DESCRIPTIVE_ORDER.indexOf(f.k.toLowerCase());
    return i === -1 ? DESCRIPTIVE_ORDER.length : i;
  };
  return [...facts].sort((a, b) => rank(a) - rank(b));
}

function firstSentence(text: string, maxWords: number): string {
  const clean = stripTags(text).replace(/\s+/g, " ").trim();
  if (clean === "") return "";
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const words = sentence.split(" ");
  return words.length <= maxWords ? sentence : `${words.slice(0, maxWords).join(" ")}…`;
}

/**
 * A self-contained paragraph an assistant can quote whole: what it is, what
 * it is made of, and what it costs.
 */
export function buildSummary(input: CapsuleInput): string {
  const maxWords = input.maxWords ?? 80;
  const parts: string[] = [];

  const opener = firstSentence(input.descriptionHtml ?? "", 40);
  if (opener) {
    parts.push(opener.endsWith(".") ? opener : `${opener}.`);
  } else {
    const what = input.productType ? `${input.productType}` : "product";
    parts.push(`${input.title} is a ${what}.`);
  }

  const ordered = orderFacts(input.facts).slice(0, 4);
  if (ordered.length > 0) {
    const clauses = ordered.map((f) => `${f.k.toLowerCase()}: ${f.v}`);
    parts.push(`Key details — ${clauses.join("; ")}.`);
  }

  // Commercials in the sentence, not only in the markup.
  if (input.price) {
    const price = `${input.price}${input.currency ? ` ${input.currency}` : ""}`;
    const availability =
      input.available === false ? ", currently out of stock" : "";
    const brand = input.vendor ? ` from ${input.vendor}` : "";
    parts.push(`Priced at ${price}${brand}${availability}.`);
  }

  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  const words = text.split(" ");
  return words.length <= maxWords ? text : `${words.slice(0, maxWords).join(" ")}…`;
}

export type QA = { q: string; a: string };

/**
 * The questions people actually ask an assistant, answered from the facts we
 * hold. A question without a real answer is never emitted.
 */
export function buildQuestions(input: CapsuleInput): QA[] {
  const out: QA[] = [];
  const byLabel = new Map(input.facts.map((f) => [f.k.toLowerCase(), f]));

  const material =
    byLabel.get("material") ?? byLabel.get("materials") ?? byLabel.get("fabric");
  if (material) {
    out.push({
      q: `What is ${input.title} made of?`,
      a: `${material.v}.`,
    });
  }

  const size =
    byLabel.get("dimensions") ?? byLabel.get("dimensiuni") ?? byLabel.get("size");
  if (size) {
    out.push({
      q: `What are the dimensions of ${input.title}?`,
      a: `${size.v}.`,
    });
  }

  // Seats (people/places) and set contents (6 chairs) are different facts.
  // The presets keep them under separate labels; each gets its own question.
  const seats = byLabel.get("seats") ?? byLabel.get("locuri");
  if (seats) {
    out.push({
      q: `How many people does ${input.title} seat?`,
      a: `${seats.v}.`,
    });
  }

  const includes = byLabel.get("includes") ?? byLabel.get("continut") ?? byLabel.get("set");
  if (includes) {
    out.push({
      q: `What does ${input.title} include?`,
      a: `${includes.v}.`,
    });
  }

  // A merchant's own dictionary may still use one combined "Capacity" label;
  // stay neutral there rather than guess which meaning they intended.
  const capacity = byLabel.get("capacity") ?? byLabel.get("capacitate");
  if (capacity && !seats && !includes) {
    out.push({
      q: `What does ${input.title} include or seat?`,
      a: `${capacity.v}.`,
    });
  }

  if (input.price) {
    out.push({
      q: `How much does ${input.title} cost?`,
      a: `${input.price}${input.currency ? ` ${input.currency}` : ""}${
        input.available === false ? ", currently out of stock" : ""
      }.`,
    });
  }

  const room = byLabel.get("room") ?? byLabel.get("camera") ?? byLabel.get("occasion");
  if (room) {
    out.push({
      q: `Where is ${input.title} used?`,
      a: `${room.v}.`,
    });
  }

  return out.slice(0, 5);
}

/**
 * Who it suits, assembled only from facts that describe suitability. Empty
 * when we have nothing honest to say.
 */
export function buildFitFor(input: CapsuleInput): string {
  const byLabel = new Map(input.facts.map((f) => [f.k.toLowerCase(), f]));
  const bits: string[] = [];

  // Only facts that genuinely describe who or where it suits. Capacity is
  // deliberately excluded: "6 scaune" is package contents, not an audience,
  // and audienceType: "6 chairs" in structured data reads as nonsense.
  const room = byLabel.get("room") ?? byLabel.get("camera");
  if (room) bits.push(room.v);

  const occasion = byLabel.get("occasion") ?? byLabel.get("use") ?? byLabel.get("suited to");
  if (occasion) bits.push(occasion.v);

  return bits.join("; ");
}
