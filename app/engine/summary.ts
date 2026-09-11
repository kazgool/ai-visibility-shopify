// The answer capsule, starter questions and who-it-suits.
//
// Deterministic, like the rest of the engine: no model, no invention. Every
// sentence is assembled from things the merchant already wrote or from facts
// the dictionary extracted, so nothing can be hallucinated into a product page.
//
// The price is not in here any more. The rule carried from the WordPress
// module was that an assistant answers with the sentence it can lift, so the
// price went into the capsule text and a "how much" question went into the
// list. Removed on 11 September 2026 (CC-PROMPT-AI-READABILITY-2 item 5c): the
// page and the Product node's offers carry the live price, and a price frozen
// into generated text is wrong at the first sale - Ashwagandha read 81.01 in
// our text and 98.80 lei on its own page the same day. The business answers
// stay: they are the merchant's standing policy, not a figure a sale changes.
//
// Every fixed phrase comes from phrases.ts, in the shop's content language.

import type { Fact } from "./extract";
import { stripTags, cleanOutput } from "./normalize";
import { phrases, type Language } from "./phrases";

/**
 * Warranty is always stated in months. A merchant who types "24" means 24
 * months, and publishing the bare number leaves an assistant unable to tell
 * months from years - the only thing the buyer wanted to know. A value written
 * in words already carries its unit and is returned untouched.
 */
export function warrantyWithUnit(warranty: string, language?: Language | null): string {
  const trimmed = warranty.trim();
  if (!/^\d+$/.test(trimmed)) return trimmed;
  return phrases(language).months(Number(trimmed));
}

/**
 * Shop-level commercial answers, set once by the merchant (WP 1.6.7 port).
 * Every field is optional and a question is only asked when its answer is
 * real - a policy nobody filled in produces nothing, never a placeholder.
 */
export type BusinessInfo = {
  /** e.g. "2-4 working days". Left empty when it varies by product. */
  deliveryTime?: string;
  /** e.g. "25 RON" or "free over 500 RON". */
  deliveryCost?: string;
  /** The stated cost is a starting price ("From 25 RON"). */
  deliveryCostIsFrom?: boolean;
  /** Bulky and small items ship differently; no single time is published. */
  deliveryVaries?: boolean;
  /** Return window in days, e.g. 14. */
  returnDays?: number;
  /** e.g. "24 months". */
  warranty?: string;
  /** e.g. "card, bank transfer, cash on delivery". */
  paymentMethods?: string;
};

export type CapsuleInput = {
  title: string;
  descriptionHtml?: string | null;
  facts: Fact[];
  /** Not read by buildSummary or buildQuestions since the price left the
   * generated text (see the top of this file). Kept because the callers
   * build one input for the capsule and the mirror. */
  price?: string | null;
  currency?: string | null;
  available?: boolean;
  vendor?: string | null;
  productType?: string | null;
  maxWords?: number;
  business?: BusinessInfo | null;
  /** The language the summary and questions are written in. Absent is
   * English, which is what every store had before it existed. */
  language?: Language | null;
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

/** Exported for meta.ts, which orders facts the same way for the same reason. */
export function orderFacts(facts: Fact[]): Fact[] {
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
  // Plain characters only, at the source: relying on cleanOutput to repair an
  // ellipsis character later works until someone uses this helper elsewhere.
  return words.length <= maxWords ? sentence : `${words.slice(0, maxWords).join(" ")}...`;
}

/**
 * A self-contained paragraph an assistant can quote whole: what it is and
 * what it is made of.
 */
export function buildSummary(input: CapsuleInput): string {
  const maxWords = input.maxWords ?? 80;
  const p = phrases(input.language);
  const parts: string[] = [];
  // Imported titles carry entities; every sentence we build from one must not.
  const title = cleanOutput(input.title);

  const opener = firstSentence(input.descriptionHtml ?? "", 40);
  if (opener) {
    parts.push(opener.endsWith(".") ? opener : `${opener}.`);
  } else {
    parts.push(input.productType ? p.isA(title, input.productType) : p.isAProduct(title));
  }

  const ordered = orderFacts(input.facts).slice(0, 4);
  if (ordered.length > 0) {
    parts.push(p.keyDetails(ordered.map((f) => `${f.k.toLowerCase()}: ${f.v}`).join("; ")));
  }

  const text = cleanOutput(parts.join(" "));
  const words = text.split(" ");
  return words.length <= maxWords ? text : `${words.slice(0, maxWords).join(" ")}...`;
}

export type QA = { q: string; a: string };

/** Questions per product, across all three kinds (item 5d). */
export const MAX_QUESTIONS = 6;

/**
 * The questions people actually ask an assistant, answered from the facts we
 * hold. A question without a real answer is never emitted.
 *
 * The business questions only, at most MAX_QUESTIONS.
 *
 * No question built from a fact's label any more (CC-PROMPT-AI-READABILITY-3
 * item 2). The generic "What {label} does X have?" restated the facts list
 * and published every extraction error twice. The label-specific templates
 * were to stay only if the judge found them within the 1% bar, and it did
 * not: "Ce dimensiuni are X?" was wrong on about a quarter of the furniture
 * products it was asked of (the dimensions fact itself is the error), "Ce
 * material are X?" on one in ten; seats, contents and room were never shown
 * to be within it (_shopify/corpus/faq-judge-dev.md). The material and care
 * questions of the clothing preset, which the judge did find within the bar,
 * live in faq.ts, which replaces this builder once it meets the bar.
 */
export function buildQuestions(input: CapsuleInput): QA[] {
  const p = phrases(input.language);
  // "Can I return Set Masa &amp; 6 Scaune?" is the exact failure the
  // plain-characters rule exists for; clean the title once, at the top.
  const title = cleanOutput(input.title);
  const out: QA[] = [];

  // Commercial questions (WP 1.6.7/1.6.9 port). Everything here is a product
  // for sale, so the 1.6.9 "only about things you actually sell" rule is
  // satisfied by construction. Each question exists only when the merchant
  // stated the answer.
  const b = input.business;
  if (b) {
    if (b.deliveryTime && !b.deliveryVaries) {
      out.push({
        q: p.qDelivery(title),
        a: cleanOutput(p.aDelivery(b.deliveryTime, b.deliveryCost || null, Boolean(b.deliveryCostIsFrom))),
      });
    }
    if (typeof b.returnDays === "number" && b.returnDays > 0) {
      out.push({ q: p.qReturns(title), a: p.aReturns(b.returnDays) });
    }
    // A bare number is the most common way this gets filled in, and "warranty:
    // 12" tells an assistant nothing - months or years is exactly the part that
    // matters. Warranty is always stated in months, so a number on its own gets
    // the unit. Anything the merchant wrote in words is left untouched.
    if (b.warranty) {
      out.push({
        q: p.qWarranty(title),
        a: cleanOutput(`${warrantyWithUnit(b.warranty, input.language)}.`),
      });
    }
    if (b.paymentMethods) {
      out.push({ q: p.qPayment(), a: cleanOutput(`${b.paymentMethods}.`) });
    }
  }

  return out.slice(0, MAX_QUESTIONS);
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
