// The FAQ engine (CC-PROMPT-AI-READABILITY-3 item 2).
//
// Replaces the generic label template ("What {label} does X have?"), which
// restated the facts list as questions: it added no information, published
// every extraction error a second time, and under a cap let trivia cut the
// safety labels. Every question here comes from something the merchant wrote
// or stated, in this order of trust:
//
//   a. merchant questions: a heading or line of the description that already
//      is a question, answered by the text under it;
//   b. description sections: a heading classified into one of a small set of
//      intents (warnings, usage, composition, care...), answered by its text;
//   c. the shop's own mappings: "this heading asks this question", "this
//      dictionary group asks this question";
//   d. preset templates for the preset's own groups, where the facts are clean;
//   e. Shopify data: the product's options, its vendor;
//   f. the shop's business record: delivery, returns, warranty, payment.
//
// Rules: no answer, no question; no two questions alike; no answer under two
// questions; answers cut at a sentence or list boundary within
// MAX_ANSWER_CHARS, never mid-sentence; a cap (default 8) that never cuts a
// safety question, which is always first.
//
// The intent keyword lists come from the heading texts of the corpus's dev
// stores (`npx tsx scripts/corpus-headings.ts`, counts in
// _shopify/corpus/intent-keywords.md), not from memory, and are the same for
// every store: no rule here knows which merchant it runs for.
//
// Pure, like the rest of the engine: no Shopify, no Prisma, no I/O.

import type { Fact } from "./extract";
import type { BusinessInfo } from "./summary";
import { warrantyWithUnit } from "./summary";
import { cleanOutput, decodeEntities, normalize } from "./normalize";
import { phrases, type Language, type Phrases } from "./phrases";

export type Intent =
  | "safety"
  | "usage"
  | "composition"
  | "materials"
  | "storage"
  | "care"
  | "dimensions"
  | "contents"
  | "compatibility"
  | "suitability"
  | "benefits";

/** The order questions are published in, and the order intents are tried in
 * when a heading matches more than one. Composition and materials share a
 * place (one is food, the other furniture), as do storage and care. */
export const INTENT_ORDER: readonly Intent[] = [
  "safety",
  "usage",
  "composition",
  "materials",
  "storage",
  "care",
  "dimensions",
  "contents",
  "compatibility",
  "suitability",
  "benefits",
];

export type FaqSource =
  | "section"
  | "merchant"
  | "mapping"
  | "preset"
  | "variants"
  | "vendor"
  | "business";

export type FaqItem = {
  q: string;
  a: string;
  source: FaqSource;
  intent?: Intent;
  /** Offsets into descriptionHtml, [start, end), of the heading and the text
   * the answer was taken from. Only on answers that come from the description. */
  sourceSpan?: { start: number; end: number };
};

export type FaqOption = { name: string; values: string[] };

/** A shop's own questions (item 3), stored with its dictionary. */
export type FaqMappings = {
  /** A description heading, as the merchant writes it, and the question it asks. */
  sections?: { heading: string; question: string }[];
  /** A dictionary group label and the question its value answers. */
  groups?: { group: string; question: string }[];
};

export type FaqInput = {
  title: string;
  descriptionHtml?: string | null;
  options?: FaqOption[] | null;
  vendor?: string | null;
  productType?: string | null;
  facts: Fact[];
  business?: BusinessInfo | null;
  language?: Language | null;
  /** The trade preset the shop's dictionary started from, when known. */
  presetId?: string | null;
  mappings?: FaqMappings | null;
  /** The shop's name, to tell a third-party brand from the shop's own. */
  shopName?: string | null;
  /** Questions per product. Absent is DEFAULT_FAQ_CAP. */
  cap?: number | null;
};

export const DEFAULT_FAQ_CAP = 8;
export const MAX_ANSWER_CHARS = 600;
export const TITLE_PLACEHOLDER = "{title}";

// ---------------------------------------------------------------------------
// Intents

/**
 * Keywords per intent per language, normalised (lowercase, no diacritics,
 * punctuation read as a space). A keyword is a whole word or phrase; a
 * trailing "*" matches any word starting with the stem. Every entry is a
 * heading text of the dev corpus; an intent with no dev evidence in a
 * language has no list there and produces nothing from headings.
 *
 * A heading is classified with both languages' lists, because a shop's
 * content language and the language a description was written in can differ;
 * the question is always in the content language.
 */
export const INTENT_KEYWORDS: Record<Language, Partial<Record<Intent, string[]>>> = {
  en: {
    safety: ["warning*", "precaution*", "safety"],
    usage: ["use"],
    composition: ["ingredient*", "nutrition*", "content"],
    storage: ["storage"],
    contents: ["includes", "included"],
    compatibility: ["compatible", "fits"],
    benefits: ["benefit*", "special", "love", "stand out"],
  },
  ro: {
    safety: ["atentionar*"],
    usage: ["folosest*", "utilizare", "doza"],
    composition: ["ce contine", "ingrediente", "valori nutritionale", "declaratie nutritionala"],
    materials: ["material*", "finisaj"],
    storage: ["pastrare"],
    dimensions: ["dimensiun*", "lungime*", "latime", "inaltime", "suprafata de dormit"],
    contents: ["continut pachet", "continut set", "componenta set"],
    suitability: ["ideal pentru", "potrivit pentru"],
    benefits: ["benefici*", "de ce sa alegi", "caracteristic*"],
  },
};

/** True when a heading text contains a keyword, as classifyHeading reads it.
 * Exported for the corpus report that counts each keyword's evidence. */
export function keywordMatches(label: string, keyword: string): boolean {
  return matchesKeyword(normalize(label).split(" ").filter(Boolean), keyword);
}

function matchesKeyword(words: string[], keyword: string): boolean {
  const kw = keyword.split(" ");
  for (let i = 0; i + kw.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < kw.length && ok; j++) {
      const k = kw[j];
      const w = words[i + j];
      ok = k.endsWith("*") ? w.startsWith(k.slice(0, -1)) : w === k;
    }
    if (ok) return true;
  }
  return false;
}

/**
 * The intent a heading text names, or null. A label longer than `maxWords`
 * words describes something rather than naming a section: "Forma convenabila
 * si usoara de utilizare" is a benefit that mentions use, not instructions.
 */
export function classifyHeading(label: string, maxWords = 6): Intent | null {
  const words = normalize(label).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > maxWords) return null;
  for (const intent of INTENT_ORDER) {
    for (const language of ["en", "ro"] as const) {
      const list = INTENT_KEYWORDS[language][intent] ?? [];
      if (list.some((k) => matchesKeyword(words, k))) return intent;
    }
  }
  return null;
}

function intentQuestion(p: Phrases, intent: Intent, title: string): string {
  switch (intent) {
    case "safety": return p.qSafety(title);
    case "usage": return p.qUsage(title);
    case "composition": return p.qComposition(title);
    case "materials": return p.qMaterial(title);
    case "storage": return p.qStorage(title);
    case "care": return p.qCare(title);
    case "dimensions": return p.qDimensions(title);
    case "contents": return p.qIncludes(title);
    case "compatibility": return p.qCompatibility(title);
    case "suitability": return p.qSuitability(title);
    case "benefits": return p.qBenefits(title);
  }
}

// ---------------------------------------------------------------------------
// The description as blocks

/** Elements that start and end a block of text. */
const BLOCK_TAGS = new Set([
  "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr",
  "table", "tbody", "thead", "section", "article", "blockquote", "dt", "dd",
  "header", "footer", "figure", "figcaption",
]);

/** Elements whose content is never text a buyer reads. */
const SKIP_TAGS = ["style", "script", "svg", "noscript", "template", "iframe", "object"];

type Segment = { text: string; bold: boolean; start: number; end: number };

export type Block = {
  text: string;
  start: number;
  end: number;
  /** The element the text sits in: h2..h6, p, li, div... */
  tag: string;
  /** Shared by the lines one element splits into at <br>. */
  para: number;
  /** 2-6 for h2-h6, 7 for a label on its own line, 8 for "Label: value" on
   * one line, 99 for text. A section runs until a block of equal or lower rank. */
  rank: number;
  /** The heading text, cleaned; absent when the block is not a heading. */
  label?: string;
  /** The value after an inline label, on the same line. */
  inline?: string;
  question?: boolean;
};

/** Replaces comments and non-text elements with spaces of the same length,
 * so every offset still points into the original HTML. */
function blankNonText(html: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  let out = html.replace(/<!--[\s\S]*?-->/g, blank);
  for (const tag of SKIP_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), blank);
  }
  return out;
}

const LEAD_JUNK = /^[\s\p{So}\p{Po}\p{Sk}\p{Sm}\p{Pd}]+/u;
const INLINE_SEPARATOR = /^[\s:|\p{Pd}]+/u;

function cleanLabel(text: string): string {
  return cleanOutput(text.replace(LEAD_JUNK, "")).replace(/[\s:]+$/, "").trim();
}

function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/** A label is a short name, not a sentence: at least three letters, at most
 * eighty characters (a question may run to 150), and not ending in a full
 * stop or exclamation mark - "Safety first, coffee second." is a slogan. */
function validLabel(label: string): boolean {
  if (letterCount(label) < 3) return false;
  if (/\?$/.test(label)) return label.length <= 150;
  if (label.length > 80) return false;
  return !/[.!]$/.test(label);
}

function classifyBlock(block: Block, segments: Segment[]): void {
  const h = /^h([1-6])$/.exec(block.tag);
  if (h) {
    block.rank = Math.max(2, Number(h[1]));
    const text = cleanLabel(block.text);
    const colon = text.indexOf(":");
    if (colon > 0 && colon < text.length - 1 && !text.endsWith("?")) {
      const label = cleanLabel(text.slice(0, colon));
      const value = text.slice(colon + 1).replace(INLINE_SEPARATOR, "").trim();
      if (label.split(" ").length <= 5 && validLabel(label) && value !== "" && !/[.!]$/.test(text)) {
        block.label = label;
        block.inline = value;
        return;
      }
    }
    if (validLabel(text)) {
      block.label = text;
      block.question = text.endsWith("?");
    }
    return;
  }

  // A bold run opening the block, after any bullet or symbol.
  let i = 0;
  while (i < segments.length && !segments[i].bold && LEAD_JUNK.test(segments[i].text) && segments[i].text.replace(LEAD_JUNK, "") === "") i++;
  let bold = "";
  let j = i;
  while (j < segments.length && (segments[j].bold || segments[j].text.trim() === "")) {
    bold += segments[j].text;
    j++;
  }
  const rest = segments.slice(j).map((s) => s.text).join("");
  if (letterCount(bold) > 0) {
    let label = cleanLabel(bold);
    let inline = cleanOutput(rest).replace(INLINE_SEPARATOR, "").trim();
    // "<b>Finisaj: ulei walnut</b>": the whole line bold, label and value inside.
    const colon = label.indexOf(":");
    if (colon > 0 && !label.endsWith("?")) {
      inline = `${label.slice(colon + 1).trim()} ${inline}`.trim();
      label = cleanLabel(label.slice(0, colon));
    }
    const hasInline = inline !== "" && letterCount(inline) + (inline.match(/\d/g) ?? []).length > 0;
    if (validLabel(label)) {
      block.label = label;
      block.question = label.endsWith("?");
      if (hasInline) {
        block.rank = 8;
        block.inline = inline;
      } else {
        block.rank = 7;
      }
      return;
    }
    // A bold line of its own that is not a label ("PRODUS FABRICAT IN
    // ROMANIA!") still ends the section above it: it is where a shop's
    // boilerplate starts, and the dimensions list is not followed by it.
    if (!hasInline) {
      block.rank = 7;
      return;
    }
  }

  const text = cleanOutput(block.text);
  if (text.endsWith(":") && text.length <= 80) {
    const label = cleanLabel(text);
    if (validLabel(label)) {
      block.rank = 7;
      block.label = label;
      return;
    }
  }
  if (text.endsWith("?") && text.length <= 150) {
    const label = cleanLabel(text);
    if (validLabel(label)) {
      block.rank = 7;
      block.label = label;
      block.question = true;
    }
  }
}

/** The description as a list of blocks, headings marked. Exported for the
 * corpus scripts, which count headings exactly as the engine reads them. */
export function parseBlocks(html: string): Block[] {
  const src = blankNonText(String(html ?? ""));
  const blocks: Block[] = [];
  const stack: string[] = [];
  let segments: Segment[] = [];
  let boldDepth = 0;
  let para = 0;

  const flush = (sameParagraph: boolean) => {
    const text = cleanOutput(segments.map((s) => s.text).join(""));
    const visible = segments.filter((s) => s.text.trim() !== "");
    if (text !== "" && visible.length > 0) {
      const block: Block = {
        text,
        start: visible[0].start,
        end: visible[visible.length - 1].end,
        tag: stack[stack.length - 1] ?? "",
        para,
        rank: 99,
      };
      classifyBlock(block, segments);
      blocks.push(block);
    }
    segments = [];
    if (!sameParagraph) para++;
  };

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let pos = 0;
  for (let m = tagRe.exec(src); m; m = tagRe.exec(src)) {
    if (m.index > pos) {
      const raw = src.slice(pos, m.index);
      segments.push({ text: decodeEntities(raw), bold: boldDepth > 0, start: pos, end: m.index });
    }
    pos = m.index + m[0].length;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (name === "br") {
      flush(true);
    } else if (BLOCK_TAGS.has(name)) {
      flush(false);
      if (closing) {
        const at = stack.lastIndexOf(name);
        if (at !== -1) stack.length = at;
      } else {
        stack.push(name);
      }
      boldDepth = 0;
    } else if (name === "strong" || name === "b") {
      boldDepth = Math.max(0, boldDepth + (closing ? -1 : 1));
    } else if (name === "td" || name === "th") {
      segments.push({ text: " ", bold: false, start: pos, end: pos });
    }
  }
  if (pos < src.length) {
    segments.push({ text: decodeEntities(src.slice(pos)), bold: boldDepth > 0, start: pos, end: src.length });
  }
  flush(false);
  return blocks;
}

/** The description as text, one block per line and headings marked "## ",
 * for the judge and the audit scripts. */
export function descriptionOutline(html: string): string {
  return parseBlocks(html)
    .map((b) => (b.label ? `## ${b.label}${b.inline ? `: ${b.inline}` : ""}` : b.text))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Sections

type Section = {
  index: number;
  label: string;
  question: boolean;
  intent: Intent | null;
  mapped: string | null;
  /** Block indexes of the body; empty for an inline label. */
  body: number[];
};

function bodyOf(blocks: Block[], i: number): number[] {
  const head = blocks[i];
  if (head.inline !== undefined) return [];
  const body: number[] = [];
  // A label followed by <br> lines owns the rest of its own paragraph only.
  if (head.rank === 7 && blocks[i + 1]?.para === head.para) {
    for (let j = i + 1; j < blocks.length && blocks[j].para === head.para; j++) body.push(j);
    return body;
  }
  for (let j = i + 1; j < blocks.length; j++) {
    if (blocks[j].rank <= head.rank) break;
    body.push(j);
  }
  // A label followed by a list owns the list, and one followed by "Label:
  // value" lines owns those lines; neither takes the prose that comes after
  // them, which is where shops put delivery notes and brand stories.
  if (body.length > 0) {
    const first = blocks[body[0]];
    const sameRun =
      first.tag === "li"
        ? (b: Block) => b.tag === "li"
        : isPair(first)
          ? isPair
          : null;
    if (sameRun) {
      const end = body.findIndex((j) => !sameRun(blocks[j]));
      return end === -1 ? body : body.slice(0, end);
    }
  }
  return body;
}

/** A "Label: value" line: bold ("<b>Lungime</b>: 100 cm") or plain
 * ("Lungime: 100cm"), short, with the colon inside its first forty characters. */
function isPair(b: Block): boolean {
  return b.rank === 8 || (b.rank === 99 && b.text.length <= 80 && /^[^:]{1,40}:\s*\S/.test(b.text));
}

/**
 * The name a section sits under: the nearest heading above it, of its own
 * rank or higher, that names no intent and asks nothing. In a bundle's
 * description that is the product a repeated block is about ("m36 Zinc
 * Bisglycinate 25 mg, 90 tablete"), even when the shop gives the product's
 * name and its sections the same <h2>.
 */
function contextOf(blocks: Block[], sections: Map<number, Section>, i: number): string | null {
  const own = blocks[i].rank;
  for (let k = i - 1; k >= 0; k--) {
    const b = blocks[k];
    if (b.rank > 6 || b.rank > own) continue;
    const s = sections.get(k);
    if (s && (s.intent || s.question || s.mapped)) continue;
    const head = cleanOutput(b.text).split(",")[0].replace(/[\s:]+$/, "").trim();
    return head.length <= 80 && letterCount(head) >= 3 ? head : null;
  }
  return null;
}

const READER_WORDS = new Set([
  "you", "your", "yours", "yourself",
  "tu", "te", "iti", "tau", "ta", "tale", "voi", "dumneavoastra", "dvs",
]);

/**
 * A heading shaped like a question is a buyer's question only when it is not
 * put to the reader - "What are you waiting for?", "Why have just one when
 * you can have both?" are marketing - and is at most twenty words long.
 */
function isBuyerQuestion(label: string): boolean {
  const words = normalize(label).split(/[\s-]+/).filter(Boolean);
  return words.length <= 20 && !words.some((w) => READER_WORDS.has(w));
}

function wordCount(text: string): number {
  return normalize(text).split(" ").filter(Boolean).length;
}

function sectionsOf(blocks: Block[], mappings: FaqMappings | null | undefined): Map<number, Section> {
  const mapped = new Map(
    (mappings?.sections ?? [])
      .filter((m) => m.heading.trim() !== "" && m.question.trim() !== "")
      .map((m) => [normalize(m.heading), m.question] as const),
  );
  const out = new Map<number, Section>();
  blocks.forEach((b, i) => {
    if (!b.label) return;
    const question = Boolean(b.question) && isBuyerQuestion(b.label);
    out.set(i, {
      index: i,
      label: b.label,
      question,
      intent: classifyHeading(b.label, question ? 12 : 6),
      mapped: mapped.get(normalize(b.label)) ?? null,
      body: bodyOf(blocks, i),
    });
  });
  return out;
}

/** A section's answer units, leaving out every child section that asks
 * something else (a warning under "how to use" is its own question), and the
 * children it took in, so they are not asked again. */
function unitsOf(
  s: Section,
  blocks: Block[],
  sections: Map<number, Section>,
): { units: string[]; taken: number[]; end: number } {
  const units: string[] = [];
  const taken: number[] = [];
  const head = blocks[s.index];
  let end = head.end;
  if (head.inline !== undefined) {
    units.push(head.inline);
    return { units, taken, end };
  }
  const skip = new Set<number>();
  for (const j of s.body) {
    if (skip.has(j)) continue;
    const child = sections.get(j);
    if (child) {
      // Only a short heading is a section of its own; a long bold lead is
      // one item of the parent's list that happens to mention a keyword.
      const other =
        child.question ||
        child.mapped !== null ||
        (child.intent !== null && child.intent !== s.intent && wordCount(child.label) <= 4);
      if (other) {
        skip.add(j);
        child.body.forEach((k) => skip.add(k));
        continue;
      }
      taken.push(j);
    }
    // The line as the merchant wrote it: rebuilding "label: value" put a
    // colon where there was none ("Vegan 100%: Certificari si ...").
    units.push(blocks[j].text);
    end = blocks[j].end;
  }
  return { units, taken, end };
}

function hasContent(text: string): boolean {
  return letterCount(text) + (text.match(/\d/g) ?? []).length >= 2;
}

/**
 * Units joined into one answer of at most MAX_ANSWER_CHARS: whole units only,
 * except that a first unit longer than the limit is cut at its last sentence
 * end inside it. A unit that does not fit is left out whole, never cut, so a
 * list comes back shorter and every item in it complete. No sentence end
 * inside the limit means no answer.
 */
export function joinAnswer(rawUnits: string[], max = MAX_ANSWER_CHARS): string {
  const units = rawUnits
    .map((u) => cleanOutput(u).replace(LEAD_JUNK, "").replace(/\s+([.,;:!?])/g, "$1").trim())
    .filter(hasContent);
  const close = (u: string, last: boolean) => {
    if (!last) return /[.!?;:]$/.test(u) ? u : `${u};`;
    const trimmed = u.replace(/[;:,\s]+$/, "");
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  };
  const kept: string[] = [];
  for (const u of units) {
    const candidate = [...kept, u].map((x, i, all) => close(x, i === all.length - 1)).join(" ");
    if (candidate.length <= max) {
      kept.push(u);
      continue;
    }
    if (kept.length === 0) {
      const within = u.slice(0, max);
      const ends = [...within.matchAll(/[.!?](?=\s|$)/g)];
      if (ends.length === 0) return "";
      const cut = within.slice(0, ends[ends.length - 1].index! + 1);
      return hasContent(cut) ? cut : "";
    }
    break;
  }
  return kept.map((x, i, all) => close(x, i === all.length - 1)).join(" ");
}

// ---------------------------------------------------------------------------
// Presets and shop mappings

/**
 * Question templates per trade preset, for the preset's own group labels.
 * Shipped only where the dev corpus shows the group producing clean values
 * (_shopify/corpus/preset-values.md): furniture's five (the label-specific
 * templates the engine had before), clothing's Material and Care, bridal
 * Material. Not beauty Finish: "natural" matched "natural ingredients" on most
 * products. A preset whose group has no value asks nothing.
 */
export const PRESET_QUESTIONS: Record<string, Record<string, (p: Phrases, title: string) => string>> = {
  furniture: {
    material: (p, t) => p.qMaterial(t),
    dimensions: (p, t) => p.qDimensions(t),
    seats: (p, t) => p.qSeats(t),
    includes: (p, t) => p.qIncludes(t),
    room: (p, t) => p.qRoom(t),
  },
  clothing: {
    material: (p, t) => p.qMaterial(t),
    care: (p, t) => p.qCare(t),
  },
  fashion: {
    material: (p, t) => p.qMaterial(t),
  },
};

/** A size a dimensions question can carry: a length unit, inches or "AxB".
 * "100ml" on a cup is a capacity, and "What are the dimensions" of it reads wrong. */
const LENGTH = /\d\s*(mm|cm|m|in|inch|inches|ft)\b|\d\s*["”]|\d\s*[x×]\s*\d/i;

const NOT_PLAIN = /[–—‘’“”…]|&#?[a-z0-9]+;/i;

/** True when text holds only plain characters: no typographic dash, curly
 * quote or ellipsis character, no HTML entity. */
export function isPlainText(text: string): boolean {
  return !NOT_PLAIN.test(text);
}

/**
 * Why a merchant's question cannot be saved, or null when it can: it must
 * name the product through {title}, end with "?", and use plain characters.
 */
export function validateFaqQuestion(question: string): string | null {
  const q = question.trim();
  if (q === "") return "Write a question.";
  if (!q.includes(TITLE_PLACEHOLDER)) {
    return `Put ${TITLE_PLACEHOLDER} where the product's name goes, so each product's question names it.`;
  }
  if (!q.endsWith("?")) return "End the question with a question mark.";
  if (NOT_PLAIN.test(q)) {
    return 'Use plain characters: "-" for dashes, straight quotes, "..." for an ellipsis, and no HTML entities.';
  }
  if (q.length > 200) return "Keep the question under 200 characters.";
  return null;
}

function fillTitle(template: string, title: string): string {
  return cleanOutput(template.split(TITLE_PLACEHOLDER).join(title));
}

// ---------------------------------------------------------------------------
// Shopify data and business

function sameBrand(a: string, b: string): boolean {
  const n = (s: string) => normalize(s).replace(/[^a-z0-9]/g, "");
  const x = n(a);
  const y = n(b);
  return x !== "" && y !== "" && (x.includes(y) || y.includes(x));
}

function optionsAnswer(options: FaqOption[], p: Phrases): string {
  const parts = options.map((o) => {
    const values = [...new Set(o.values.map((v) => cleanOutput(v)).filter(Boolean))];
    let shown = values;
    let text = `${cleanOutput(o.name)}: ${shown.join(", ")}`;
    while (text.length > 300 && shown.length > 1) {
      shown = shown.slice(0, -1);
      text = `${cleanOutput(o.name)}: ${p.andMore(shown.join(", "), values.length - shown.length)}`;
    }
    return text;
  });
  const text = parts.join("; ");
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** A gift card is sold by the shop whatever its vendor field says: that is
 * the app that issues it. */
const GIFT_CARD = /gift\s*card|e-?gift|card(ul)?\s+cadou|voucher/i;

// ---------------------------------------------------------------------------
// The FAQ

type Candidate = FaqItem & { order: number; context: string | null };

export function buildFaq(input: FaqInput): FaqItem[] {
  const p = phrases(input.language);
  const title = cleanOutput(input.title);
  const html = input.descriptionHtml ?? "";
  const blocks = parseBlocks(html);
  const sections = sectionsOf(blocks, input.mappings);

  // a, b, c (headings): one candidate per section that asks something.
  const consumed = new Set<number>();
  const merchant: Candidate[] = [];
  const mapped: Candidate[] = [];
  type Part = { label: string; context: string | null; units: string[]; start: number; end: number };
  const byIntent = new Map<Intent, Part[]>();
  for (const s of sections.values()) {
    if (consumed.has(s.index)) continue;
    if (!s.question && !s.mapped && !s.intent) continue;
    const { units, taken, end } = unitsOf(s, blocks, sections);
    const answer = joinAnswer(units);
    if (answer === "") continue;
    taken.forEach((t) => consumed.add(t));
    const span = { start: blocks[s.index].start, end };
    const context = contextOf(blocks, sections, s.index);
    if (s.mapped) {
      mapped.push({ q: fillTitle(s.mapped, title), a: answer, source: "mapping", sourceSpan: span, order: s.index, context });
    } else if (s.question) {
      merchant.push({
        q: cleanOutput(s.label),
        a: answer,
        source: "merchant",
        ...(s.intent ? { intent: s.intent } : {}),
        sourceSpan: span,
        order: s.index,
        context,
      });
    } else if (s.intent) {
      const list = byIntent.get(s.intent) ?? [];
      list.push({ label: s.label, context, units, start: span.start, end: span.end });
      byIntent.set(s.intent, list);
    }
  }

  // A bundle's description repeats a block per product it contains, under
  // the same heading or the same question. Said once, each part under the
  // name of the product it is about, never merged into one text that mixes
  // "2 capsules a day" and "1 tablet a day" with nothing saying which is which.
  for (let i = 0; i < merchant.length; i++) {
    const key = normalize(merchant[i].q);
    const same = merchant.filter((m, j) => j > i && normalize(m.q) === key);
    if (same.length === 0) continue;
    const group = [merchant[i], ...same];
    merchant[i].a = joinAnswer(
      group
        .filter((m, j) => group.findIndex((n) => normalize(n.a) === normalize(m.a)) === j)
        .map((m) => (m.context ? `${m.context}: ${m.a}` : m.a)),
    );
    merchant[i].sourceSpan = {
      start: Math.min(...group.map((m) => m.sourceSpan!.start)),
      end: Math.max(...group.map((m) => m.sourceSpan!.end)),
    };
    for (const m of same) merchant.splice(merchant.indexOf(m), 1);
  }

  const labelled = (x: Part, repeated = false) => {
    const label = repeated && x.context ? x.context : x.label;
    return `${label}${label.endsWith("?") ? "" : ":"} ${joinAnswer(x.units)}`;
  };
  // A heading that states the basis of what follows ("per 100 g", "/ tablet",
  // "Dimensiuni taburet") is part of the answer: the figures mean nothing
  // without it.
  const qualified = (label: string) => /\d|\/|\bper\b|\bpe\b/i.test(label);

  const ordered: FaqItem[] = [];
  for (const intent of INTENT_ORDER) {
    const all = byIntent.get(intent) ?? [];
    // Shops repeat a block per product of a bundle; the same text is said once.
    const parts = all.filter(
      (x, i) => all.findIndex((y) => normalize(joinAnswer(y.units)) === normalize(joinAnswer(x.units))) === i,
    );
    const asks = merchant.filter((m) => m.intent === intent);
    const labelCount = new Map<string, number>();
    for (const x of parts) labelCount.set(normalize(x.label), (labelCount.get(normalize(x.label)) ?? 0) + 1);
    const tag = (x: Part) => labelled(x, (labelCount.get(normalize(x.label)) ?? 0) > 1);
    // One section: its own text. Several: each under its heading, so
    // "Lungime: 180 cm; Latime: 90 cm" keeps which number is which.
    const merged =
      parts.length === 0
        ? null
        : parts.length === 1
          ? {
              a: qualified(parts[0].label) ? joinAnswer([`${parts[0].label}:`, ...parts[0].units]) : joinAnswer(parts[0].units),
              start: parts[0].start,
              end: parts[0].end,
            }
          : {
              a: joinAnswer(parts.map(tag)),
              start: Math.min(...parts.map((x) => x.start)),
              end: Math.max(...parts.map((x) => x.end)),
            };
    if (merged && merged.a !== "" && asks.length > 0) {
      // The merchant already asks this: their question takes the sections in.
      const first = asks[0];
      first.a = joinAnswer([first.a, ...parts.map(tag)]);
      first.sourceSpan = {
        start: Math.min(first.sourceSpan!.start, merged.start),
        end: Math.max(first.sourceSpan!.end, merged.end),
      };
    } else if (merged && merged.a !== "") {
      ordered.push({
        q: intentQuestion(p, intent, title),
        a: merged.a,
        source: "section",
        intent,
        sourceSpan: { start: merged.start, end: merged.end },
      });
    }
    for (const m of asks) ordered.push(strip(m));
  }
  // The merchant's own questions with no intent, and the shop's mappings, in
  // the order they stand in the description.
  for (const m of [...mapped, ...merchant.filter((x) => !x.intent)].sort((a, b) => a.order - b.order)) {
    ordered.push(strip(m));
  }

  // c (groups) and d: a dictionary group's value under the shop's own
  // question first, the preset's template second.
  const groupQuestions = new Map(
    (input.mappings?.groups ?? [])
      .filter((g) => g.group.trim() !== "" && g.question.trim() !== "")
      .map((g) => [g.group.trim().toLowerCase(), g.question] as const),
  );
  const preset = input.presetId ? PRESET_QUESTIONS[input.presetId] : undefined;
  for (const fact of input.facts) {
    const key = fact.k.trim().toLowerCase();
    const value = cleanOutput(fact.v);
    if (!hasContent(value)) continue;
    const own = groupQuestions.get(key);
    if (own) {
      ordered.push({ q: fillTitle(own, title), a: `${value}.`, source: "mapping" });
    } else if (preset?.[key]) {
      if (key === "dimensions" && !LENGTH.test(value)) continue;
      ordered.push({ q: preset[key](p, title), a: `${value}.`, source: "preset" });
    }
  }

  // e: options with a real choice, and a brand that is not the shop's own.
  const options = (input.options ?? []).filter(
    (o) => o.name.trim().toLowerCase() !== "title" && new Set(o.values.map((v) => v.trim()).filter(Boolean)).size > 1,
  );
  if (options.length > 0) {
    ordered.push({ q: p.qOptions(title), a: optionsAnswer(options, p), source: "variants" });
  }
  // A vendor field of more than four words is a category someone typed there
  // ("BONE CONDUCTION OPEN-EAR SPORT HEADPHONES"), not a maker's name.
  const vendor = cleanOutput(input.vendor ?? "");
  if (
    vendor !== "" &&
    input.shopName &&
    !sameBrand(vendor, input.shopName) &&
    wordCount(vendor) <= 4 &&
    !GIFT_CARD.test(title)
  ) {
    ordered.push({ q: p.qVendor(title), a: `${vendor}.`, source: "vendor" });
  }

  // f: the shop's business record, unchanged from buildQuestions.
  const b = input.business;
  if (b) {
    if (b.deliveryTime && !b.deliveryVaries) {
      ordered.push({
        q: p.qDelivery(title),
        a: cleanOutput(p.aDelivery(b.deliveryTime, b.deliveryCost || null, Boolean(b.deliveryCostIsFrom))),
        source: "business",
      });
    }
    if (typeof b.returnDays === "number" && b.returnDays > 0) {
      ordered.push({ q: p.qReturns(title), a: p.aReturns(b.returnDays), source: "business" });
    }
    if (b.warranty) {
      ordered.push({
        q: p.qWarranty(title),
        a: cleanOutput(`${warrantyWithUnit(b.warranty, input.language)}.`),
        source: "business",
      });
    }
    if (b.paymentMethods) {
      ordered.push({ q: p.qPayment(), a: cleanOutput(`${b.paymentMethods}.`), source: "business" });
    }
  }

  // No question twice, no answer twice.
  const seenQ = new Set<string>();
  const seenA = new Set<string>();
  const unique = ordered.filter((item) => {
    const q = normalize(item.q);
    const a = normalize(item.a);
    if (q === "" || a === "" || seenQ.has(q) || seenA.has(a)) return false;
    seenQ.add(q);
    seenA.add(a);
    return true;
  });

  // The cap never cuts a safety question; safety is first and counts toward it.
  const cap = Math.max(1, input.cap ?? DEFAULT_FAQ_CAP);
  const safety = unique.filter((x) => x.intent === "safety");
  const rest = unique.filter((x) => x.intent !== "safety");
  return [...safety, ...rest.slice(0, Math.max(0, cap - safety.length))];
}

function strip(c: Candidate): FaqItem {
  const { order: _order, context: _context, ...item } = c;
  return item;
}
