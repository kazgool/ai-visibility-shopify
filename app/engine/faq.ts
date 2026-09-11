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
//      and, when a description has warnings but no warnings heading, the
//      sentences that open like a warning;
//   c. the shop's own mappings: "this heading asks this question", "this
//      dictionary group asks this question";
//   d. preset templates for the preset's own groups, where the facts are clean;
//   e. Shopify data: the product's options, its vendor;
//   f. the shop's business record: delivery, returns, warranty, payment.
//
// Rules: no answer, no question; no two questions alike; no answer under two
// questions; answers cut at a sentence or list boundary, never mid-sentence,
// within MAX_ANSWER_CHARS (LONG_ANSWER_CHARS for package contents and safety,
// and package contents are never cut at all); a cap (default 8) that never
// cuts a safety question, which is always first.
//
// Every rule was measured by the judge (_shopify/corpus/judge-rubric.md) on
// the corpus's dev stores and is written for a class of description, never
// for one store. The intent keyword lists are heading texts of the dev
// stores with their counts in _shopify/corpus/intent-keywords.md.
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
/** Package contents and warnings: a list whose completeness is the meaning. */
export const LONG_ANSWER_CHARS = 1500;
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
 *
 * Left out after the judge, each for naming something its question does not
 * ask: "content" (caffeine content is not what a bundle contains), the
 * nutrition headings (a nutrition table is not an ingredient list), "doza" (a
 * dose is not how to use a product), "finisaj" (a finish is not a material).
 */
export const INTENT_KEYWORDS: Record<Language, Partial<Record<Intent, string[]>>> = {
  en: {
    safety: ["warning*", "precaution*", "safety"],
    usage: ["use"],
    composition: ["ingredient*"],
    storage: ["storage"],
    contents: ["includes", "included"],
    compatibility: ["compatible", "fits"],
    benefits: ["benefit*", "special", "stand out"],
  },
  ro: {
    safety: ["atentionar*", "alergen*"],
    usage: ["folosest*", "utilizare"],
    composition: ["ce contine", "ingrediente"],
    materials: ["material*"],
    storage: ["pastrare"],
    dimensions: ["dimensiun*", "lungime*", "latime", "inaltime", "suprafata de dormit"],
    contents: ["continut pachet", "continut set", "componenta set"],
    suitability: ["ideal pentru", "potrivit pentru", "cine"],
    benefits: ["benefici*", "de ce sa alegi", "caracteristic*"],
  },
};

/** Words that turn a heading into its opposite: "Fara alergeni" is a claim
 * that there are none, not a warning about them. */
const NEGATORS = new Set(["fara", "free", "without", "no", "non", "nu"]);

/** A "?" between two letters is a character lost to a wrong encoding
 * ("Aten?ionare"); it stands for any one letter. */
const LOST = "ſ";

function wordMatches(word: string, key: string): boolean {
  const prefix = key.endsWith("*");
  const k = prefix ? key.slice(0, -1) : key;
  if (prefix ? word.length < k.length : word.length !== k.length) return false;
  for (let i = 0; i < k.length; i++) if (word[i] !== k[i] && word[i] !== LOST) return false;
  return true;
}

function matchesKeyword(words: string[], keyword: string): boolean {
  const kw = keyword.split(" ");
  for (let i = 0; i + kw.length <= words.length; i++) {
    if (kw.every((k, j) => wordMatches(words[i + j], k))) return true;
  }
  return false;
}

/** A label's words, a parenthesis left out: "Dimensiune totala (cap in cap)"
 * and "Ingrediente (lista completa)" name their section in the words before
 * it, and the parenthesis only qualifies them. */
function labelWords(label: string): string[] {
  const bare = label.replace(/\([^)]*\)/g, " ").replace(/(\p{L})\?(\p{L})/gu, `$1${LOST}$2`);
  return normalize(bare).split(" ").filter(Boolean);
}

/** True when a heading text contains a keyword, as classifyHeading reads it.
 * Exported for the corpus report that counts each keyword's evidence. */
export function keywordMatches(label: string, keyword: string): boolean {
  return matchesKeyword(labelWords(label), keyword);
}

/**
 * The intent a heading text names, or null. A label longer than `maxWords`
 * words describes something rather than naming a section: "Formula
 * personalizata cu extra ingrediente" is a claim, not the ingredient list.
 */
export function classifyHeading(label: string, maxWords = 4): Intent | null {
  const words = labelWords(label);
  if (words.length === 0 || words.length > maxWords) return null;
  const negated = words.some((w) => NEGATORS.has(w));
  for (const intent of INTENT_ORDER) {
    if (intent === "safety" && negated) continue;
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

/** Contents and warnings are lists whose completeness is the meaning. */
function limitFor(intent: Intent | null | undefined): { max: number; whole: boolean } {
  if (intent === "contents") return { max: LONG_ANSWER_CHARS, whole: true };
  if (intent === "safety") return { max: LONG_ANSWER_CHARS, whole: false };
  return { max: MAX_ANSWER_CHARS, whole: false };
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

/** Stands where a link read only "here": the sentence around it points at a
 * page the answer no longer carries, and is dropped from every answer. */
const LINK_MARK = "";
const DEICTIC_LINK =
  /<a\b[^>]*>(?:(?!<\/a>)[^<]|<(?!\/a>)[^>]*>){0,120}?\b(?:here|aici|link|linkul)\s*(?:<\/[^>]+>\s*)*<\/a>/gi;

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
  return out.replace(DEICTIC_LINK, (m) => LINK_MARK + " ".repeat(m.length - 1));
}

/** Bullets, symbols and dashes opening a line, never the sign of a number:
 * "+15cm" (fifteen centimetres more than the mattress) and "-5°C" keep it. */
const LEAD_JUNK = /^(?:(?![+\-−]\d)[\s\p{So}\p{Po}\p{Sk}\p{Sm}\p{Pd}])+/u;
const INLINE_SEPARATOR = /^(?:(?![+\-−]\d)[\s:|\p{Pd}])+/u;

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
  while (i < segments.length && !segments[i].bold && segments[i].text.replace(LEAD_JUNK, "") === "") i++;
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
    // boilerplate starts.
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
    .join("\n")
    .split(LINK_MARK)
    .join("[link]");
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

/** A "Label: value" line: bold ("<b>Lungime</b>: 100 cm") or plain
 * ("Lungime: 100cm"), short, with the colon inside its first forty characters. */
/** How long a line of a list can run: "Jelly Much Gel Eyeshadow Stick in
 * Golden Coast: Golden bronze with gold and copper sparkle" is one item. */
const LIST_LINE_CHARS = 120;

function isPair(b: Block): boolean {
  return b.rank === 8 || (b.rank === 99 && b.text.length <= LIST_LINE_CHARS && /^[^:]{1,40}:\s*\S/.test(b.text));
}

/** A line of a list written as paragraphs: a "Label: value" pair, or a short
 * line that is not a sentence ("- Enchanted Rose Lip Mask"). */
function isListLine(b: Block): boolean {
  return isPair(b) || (b.rank === 99 && b.text.length <= LIST_LINE_CHARS && !/[.!?]$/.test(b.text));
}

/** A list, and a list of "Label: value" lines, end where their lines end:
 * the prose after them is where shops put delivery notes and brand stories. */
function trimToRun(blocks: Block[], body: number[]): number[] {
  if (body.length === 0) return body;
  const first = blocks[body[0]];
  const sameRun = first.tag === "li" ? (b: Block) => b.tag === "li" : isListLine(first) ? isListLine : null;
  if (!sameRun) return body;
  const end = body.findIndex((j) => !sameRun(blocks[j]));
  return end === -1 ? body : body.slice(0, end);
}

function bodyOf(blocks: Block[], i: number): number[] {
  const head = blocks[i];
  if (head.inline !== undefined) return [];
  const body: number[] = [];
  // A label followed by <br> lines owns the rest of its own paragraph only.
  if (head.rank === 7 && blocks[i + 1]?.para === head.para) {
    for (let j = i + 1; j < blocks.length && blocks[j].para === head.para; j++) body.push(j);
    return trimToRun(blocks, body);
  }
  for (let j = i + 1; j < blocks.length; j++) {
    if (blocks[j].rank <= head.rank) break;
    body.push(j);
  }
  return trimToRun(blocks, body);
}

const READER_WORDS = new Set([
  "you", "your", "yours", "yourself",
  "tu", "te", "iti", "tau", "ta", "tale", "voi", "dumneavoastra", "dvs",
]);

function wordCount(text: string): number {
  return normalize(text).split(" ").filter(Boolean).length;
}

/**
 * A heading shaped like a question is a buyer's question only when it is not
 * put to the reader - "What are you waiting for?", "Why have just one when
 * you can have both?" are marketing - and is at most twenty words long.
 */
function isBuyerQuestion(label: string): boolean {
  const words = normalize(label).split(/[\s-]+/).filter(Boolean);
  return words.length <= 15 && !words.some((w) => READER_WORDS.has(w)) && !CONJUNCTIONS.has(words[0] ?? "");
}

/** A question that opens with "But" or "And" follows the one before it on
 * the page ("Dar daca valoarea cumparaturilor e mai mare?") and means
 * nothing on its own. */
const CONJUNCTIONS = new Set(["dar", "si", "iar", "sau", "deci", "and", "but", "or", "so"]);

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
      intent: classifyHeading(b.label, question ? 12 : 4),
      mapped: mapped.get(normalize(b.label)) ?? null,
      body: bodyOf(blocks, i),
    });
  });
  return out;
}

/**
 * The name a section sits under: the nearest heading above it, of its own
 * rank or higher, that names no intent, asks nothing, and is long enough to
 * be a product's name. In a bundle's description that is the product a
 * repeated block is about ("m36 Zinc Bisglycinate 25 mg, 90 tablete"), even
 * when the shop gives the product's name and its sections the same <h2>; a
 * short heading ("Bneficii cheie", a section with a typo) is not a name.
 */
function contextOf(blocks: Block[], sections: Map<number, Section>, i: number): string | null {
  const own = blocks[i].rank;
  for (let k = i - 1; k >= 0; k--) {
    const b = blocks[k];
    if (b.rank > 6 || b.rank > own) continue;
    const s = sections.get(k);
    if (s && (s.intent || s.question || s.mapped)) continue;
    if (wordCount(b.text) < 4) continue;
    // The name up to its last comma inside eighty characters: cutting at the
    // first comma left "SANATELE BIO Linte" for three different products.
    let head = cleanOutput(b.text).replace(/[\s:]+$/, "");
    if (head.length > 80) {
      // A list comma, followed by a space - never the decimal comma of
      // "29,7 g", which left "60 capsule (29" as a product's name.
      const commas = [...head.slice(0, 80).matchAll(/,\s/g)].map((m) => m.index!);
      const comma = commas.length > 0 ? commas[commas.length - 1] : -1;
      head = (comma > 20 ? head.slice(0, comma) : head.slice(0, head.lastIndexOf(" ", 80))).trim();
      // And never a parenthesis left open.
      const open = head.lastIndexOf("(");
      if (open > head.lastIndexOf(")")) head = head.slice(0, open).trim();
    }
    return letterCount(head) >= 3 ? head : null;
  }
  return null;
}

/** The heading a "Label: value" line sits under, when that heading names
 * nothing of its own and is not a product's name: "Spatar" over
 * "Inaltime: 70cm", so the height is the headboard's, not the bed's. */
function parentOf(blocks: Block[], sections: Map<number, Section>, i: number, intent: Intent | null): string | null {
  for (let k = i - 1; k >= 0; k--) {
    const b = blocks[k];
    if (b.rank >= blocks[i].rank) continue;
    const s = sections.get(k);
    if (!b.label || b.question || (s && s.intent === intent) || wordCount(b.label) >= 4) return null;
    return b.label;
  }
  return null;
}

/** A measurement line holds its measurement: "70cm Toate paturile noastre
 * sunt livrate..." is a height followed by a delivery note with its full
 * stop missing, and the note is not a dimension. */
function measurementOnly(value: string): string {
  // Cut before a capitalised word that starts prose, never before one that
  // starts the next measurement: "+15cm Latime: +15cm" is two measures.
  const run = value.match(/^(.{0,160}?\d\s*(?:mm|cm|m|kg|g|ml|l|%|"|in)?\b\)?)\s+(?=\p{Lu}\p{Ll}{2,}(?![\p{L}\s/]{0,30}:))/u);
  if (run) return run[1];
  const end = value.search(/[.!?](\s|$)/);
  return end === -1 ? value : value.slice(0, end + 1);
}

type Unit = { text: string; heading?: boolean };

/** A section's answer units, leaving out every child section that asks
 * something else (a warning under "how to use" is its own question), and the
 * children it took in, so they are not asked again. */
function unitsOf(
  s: Section,
  blocks: Block[],
  sections: Map<number, Section>,
): { units: Unit[]; taken: number[]; end: number } {
  const units: Unit[] = [];
  const taken: number[] = [];
  const head = blocks[s.index];
  let end = head.end;
  if (head.inline !== undefined) {
    units.push({ text: s.intent === "dimensions" ? measurementOnly(head.inline) : head.inline });
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
    // colon where there was none ("Vegan 100%: Certificari si ..."). A
    // sub-heading keeps its colon, so the lines under it stay its own
    // ("Spatar: Inaltime: 70cm", not a bed 70cm high).
    const b = blocks[j];
    units.push(b.label && b.inline === undefined && !b.question ? { text: b.text, heading: true } : { text: b.text });
    end = b.end;
  }
  return { units, taken, end };
}

function hasContent(text: string): boolean {
  return letterCount(text) + (text.match(/\d/g) ?? []).length >= 2;
}

/**
 * Units joined into one answer of at most `max` characters: whole units only,
 * except that a first unit longer than the limit is cut at its last sentence
 * end inside it. A unit that does not fit is left out whole, never cut, so a
 * list comes back shorter and every item in it complete - or, with `whole`,
 * the answer is refused rather than shortened. A sentence said once is not
 * said again, a sentence that pointed at a link is dropped, and the answer
 * never ends on a heading. No sentence end inside the limit means no answer.
 */
export function joinAnswer(
  raw: (string | Unit)[],
  opts: { max?: number; whole?: boolean } = {},
): string {
  const max = opts.max ?? MAX_ANSWER_CHARS;
  const seen = new Set<string>();
  const units: Unit[] = [];
  for (const r of raw) {
    const u = typeof r === "string" ? { text: r } : r;
    const text = cleanOutput(u.text)
      .replace(LEAD_JUNK, "")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim()
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => {
        if (sentence.includes(LINK_MARK)) return false;
        const key = normalize(sentence);
        if (key.length < 20) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(" ")
      .trim();
    if (hasContent(text)) units.push({ text, heading: u.heading });
  }
  const close = (u: Unit, last: boolean) => {
    if (!last) {
      if (/[.!?;:]$/.test(u.text)) return u.text;
      return u.heading ? `${u.text}:` : `${u.text};`;
    }
    const trimmed = u.text.replace(/[;:,\s]+$/, "");
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  };
  const render = (list: Unit[]) => {
    const body = [...list];
    while (body.length > 0 && body[body.length - 1].heading) body.pop();
    return body.map((x, i, all) => close(x, i === all.length - 1)).join(" ");
  };
  const kept: Unit[] = [];
  for (const u of units) {
    if (render([...kept, u]).length <= max) {
      kept.push(u);
      continue;
    }
    if (opts.whole) return "";
    if (kept.length === 0) {
      const within = u.text.slice(0, max);
      const ends = [...within.matchAll(/[.!?](?=\s|$)/g)];
      if (ends.length === 0) return "";
      const cut = within.slice(0, ends[ends.length - 1].index! + 1);
      return hasContent(cut) ? cut : "";
    }
    break;
  }
  return render(kept);
}

// ---------------------------------------------------------------------------
// Warnings written as sentences

/**
 * Sentences that open like a warning, in the phrasing labels and leaflets use
 * in both languages, from the dev corpus's descriptions: "A nu se lasa la
 * indemana copiilor", "Poate contine urme de soia", "Keep out of reach of
 * children", "Not suitable for dogs with...". Read only when a description
 * has warnings and no warnings heading, so a buyer who asks what precautions
 * apply is not told nothing (rubric rule 6).
 *
 * Not a bare "Warning:", "Caution:" or "Atentie:": on the dev corpus those
 * opened jokes ("Warning: a few sprays will have you feeling like Poseidon")
 * and cooking tips as often as hazards, and a real warnings label is read as
 * a heading anyway.
 */
const WARNING_OPENING =
  /^(a nu se|nu se (recomanda|administreaza|consuma|utilizeaza|lasa)|nu este (potrivit|recomandat)|nu (depasi|depasiti|prepara|preparati|amesteca|amestecati|folosi|folositi|utiliza|utilizati|consuma|consumati|administra|administrati|expune|expuneti|lasa|lasati)|este recomandat sa nu|evita|poate contine urme|contraindicat|consulta|keep (out of|away from)|do not (use|exceed|give|leave|consume|take|swallow|apply)|not (suitable|recommended|intended) for|avoid|always (supervise|monitor)|consult (a|your)|may contain traces)\b/;
const WARNING_ANYWHERE = /\b(poate contine urme de|may contain traces of)\b/;

/** Warnings written as sentences, in the blocks `keep` accepts. A sentence
 * "Label: text" is read on both sides of its colon, and a plain "Alergeni:
 * contine caju" line - an allergen label with no bold - is a warning too. */
function warningSentences(blocks: Block[], keep: (i: number) => boolean = () => true): { units: Unit[]; start: number; end: number } | null {
  const units: Unit[] = [];
  let start = -1;
  let end = -1;
  blocks.forEach((b, i) => {
    if (!keep(i)) return;
    // Body text and the value of a "Label: value" line only: a heading that
    // opens with "Warning:" is a slogan as often as it is a warning, and a
    // warnings heading is read as a section before this ever runs.
    const text = b.inline ?? (b.rank === 99 ? b.text : "");
    const pairKey = b.rank === 99 && isPair(b) ? b.text.slice(0, b.text.indexOf(":")) : "";
    const labelled = pairKey !== "" && classifyHeading(pairKey) === "safety";
    for (const sentence of labelled ? [text] : text.split(/(?<=[.!?])\s+/)) {
      const bare = sentence.replace(LEAD_JUNK, "");
      const after = bare.includes(":") ? bare.slice(bare.indexOf(":") + 1).trim() : "";
      const key = normalize(bare);
      if (labelled || WARNING_OPENING.test(key) || WARNING_OPENING.test(normalize(after)) || WARNING_ANYWHERE.test(key)) {
        units.push({ text: sentence });
        if (start === -1) start = b.start;
        end = b.end;
      }
    }
  });
  return units.length > 0 ? { units, start, end } : null;
}

// ---------------------------------------------------------------------------
// Presets and shop mappings

/**
 * Question templates per trade preset, for the preset's own group labels.
 * Shipped only where the judge found the group's values clean on the dev
 * corpus: clothing's Material and Care, bridal Material. The furniture
 * templates the engine had before (material, dimensions, seats, includes,
 * room) went on 11 September 2026: 94 errors on three furniture stores -
 * "metal" as the material of a fabric sofa, "10 CM" as a sofa's size,
 * "l 80, L 130, h 79 cm, L 170" with no way to tell which length is which.
 */
export const PRESET_QUESTIONS: Record<string, Record<string, (p: Phrases, title: string) => string>> = {
  clothing: {
    material: (p, t) => p.qMaterial(t),
    care: (p, t) => p.qCare(t),
  },
  fashion: {
    material: (p, t) => p.qMaterial(t),
  },
};

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
// Merchant questions, Shopify data

/** Words too general to say which product a question is about. */
const GENERIC_WORDS = new Set([
  "produsul", "produs", "product", "products", "this", "that", "acest", "aceasta", "acesta",
  "pentru", "with", "from", "care", "este", "sunt", "does", "have", "what", "which",
]);

function contentWords(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w)));
}

/** A merchant's question read away from the page - in structured data, in
 * the plain-text page, in an assistant's answer - must say which product it
 * is about. "Ce contine?" does not; "Is BookArc compatible with...?" does. */
function namesProduct(question: string, title: string): boolean {
  const t = contentWords(title);
  for (const w of contentWords(question)) if (t.has(w)) return true;
  return false;
}

function sameBrand(a: string, b: string): boolean {
  const n = (s: string) => normalize(s).replace(/[^a-z0-9]/g, "");
  const x = n(a);
  const y = n(b);
  return x !== "" && y !== "" && (x.includes(y) || y.includes(x));
}

/** What shops type in the vendor field when there is no maker to name. */
const PLACEHOLDER_VENDOR = /^(nedefinit|necunoscut|undefined|unknown|default|none|n a|na|vendor|generic|no brand|fara brand)$/;

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

/** Topics of the business record, as a shop's own question names them (normalised text). */
const BUSINESS_TOPICS = {
  delivery: /\b(livr\w*|transport\w*|expedi\w*|shipping|ships?|deliver\w*)\b/,
  returns: /\b(retur\w*|return\w*|refund\w*)\b/,
  warranty: /\b(garanti\w*|warrant\w*|guarantee\w*)\b/,
  payment: /\b(plat(a|i|ii|esc|esti|este|ile|ilor|it\w*)|pay\w*)\b/,
};

// ---------------------------------------------------------------------------
// The FAQ

type Part = { label: string; context: string | null; units: Unit[]; start: number; end: number };
type Ask = { q: string; intent: Intent | null; context: string | null; units: Unit[]; start: number; end: number; order: number };

const partKey = (context: string | null) => context ?? "";

export function buildFaq(input: FaqInput): FaqItem[] {
  const p = phrases(input.language);
  const title = cleanOutput(input.title);
  const html = input.descriptionHtml ?? "";
  const blocks = parseBlocks(html);
  const sections = sectionsOf(blocks, input.mappings);

  // a, b, c (headings): what each section asks, and where it sits.
  const consumed = new Set<number>();
  const asks: Ask[] = [];
  const mapped: (FaqItem & { order: number })[] = [];
  const byIntent = new Map<Intent, Part[]>();
  for (const s of sections.values()) {
    if (consumed.has(s.index)) continue;
    if (!s.question && !s.mapped && !s.intent) continue;
    const { units, taken, end } = unitsOf(s, blocks, sections);
    if (joinAnswer(units, limitFor(s.intent)) === "") continue;
    taken.forEach((t) => consumed.add(t));
    const start = blocks[s.index].start;
    const context = contextOf(blocks, sections, s.index);
    if (s.mapped) {
      mapped.push({
        q: fillTitle(s.mapped, title),
        a: joinAnswer(units, limitFor(s.intent)),
        source: "mapping",
        sourceSpan: { start, end },
        order: s.index,
      });
    } else if (s.question) {
      asks.push({ q: cleanOutput(s.label), intent: s.intent, context, units, start, end, order: s.index });
    } else if (s.intent) {
      const list = byIntent.get(s.intent) ?? [];
      const parent = blocks[s.index].inline !== undefined ? parentOf(blocks, sections, s.index, s.intent) : null;
      // A dimensions answer holds measurements: the "Culoare: caramiziu" line
      // in the same list is not one.
      const kept = s.intent === "dimensions" ? units.filter((u) => u.heading || /\d/.test(u.text)) : units;
      list.push({ label: parent ? `${parent}, ${s.label}` : s.label, context, units: kept, start, end });
      byIntent.set(s.intent, list);
    }
  }

  // A bundle: sections sit under the names of two or more products it
  // contains. There an answer from one of them is not an answer about the
  // bundle, so a question is asked only when every product in it answers,
  // each part under the product's name. Package contents describe the
  // bundle itself, and warnings are always asked.
  const components = new Set<string>();
  for (const [intent, parts] of byIntent) if (intent !== "contents") parts.forEach((x) => components.add(partKey(x.context)));
  for (const a of asks) if (a.intent !== "contents") components.add(partKey(a.context));
  // A product whose part of the description only warns, in sentences with no
  // heading, is still one of the bundle's products. Only a named product
  // counts: text before the first product's name is the bundle's own intro.
  blocks.forEach((b, i) => {
    if (b.rank !== 99 && b.inline === undefined) return;
    if (!warningSentences([b])) return;
    const context = contextOf(blocks, sections, i);
    if (context) components.add(context);
  });
  const bundle = components.size >= 2;
  const coversAll = (contexts: (string | null)[]) => {
    const got = new Set(contexts.map(partKey));
    return [...components].every((c) => got.has(c));
  };
  const labelled = (label: string, units: Unit[], limit: { max: number; whole: boolean }) =>
    label === "" ? joinAnswer(units, limit) : `${label}${label.endsWith("?") ? "" : ":"} ${joinAnswer(units, limit)}`;

  // A bundle's warnings are every product's: one with no warnings heading
  // gives the sentences that warn in its own part of the description.
  if (bundle) {
    const safety = byIntent.get("safety") ?? [];
    const covered = new Set(safety.map((x) => partKey(x.context)));
    for (const component of components) {
      if (covered.has(component)) continue;
      const found = warningSentences(blocks, (i) => partKey(contextOf(blocks, sections, i)) === component);
      if (found) safety.push({ label: "", context: component || null, units: found.units, start: found.start, end: found.end });
    }
    if (safety.length > 0) byIntent.set("safety", safety);
  }

  // The same merchant question asked once per product of a bundle is one
  // question, answered per product.
  type AskGroup = { q: string; intent: Intent | null; items: Ask[]; order: number };
  const askGroups: AskGroup[] = [];
  for (const a of asks) {
    const g = askGroups.find((x) => normalize(x.q) === normalize(a.q));
    if (g) g.items.push(a);
    else askGroups.push({ q: a.q, intent: a.intent, items: [a], order: a.order });
  }
  const askAnswer = (g: AskGroup, extra: Part[] = []) => {
    const limit = limitFor(g.intent);
    // Name the product each answer is about only when they are about
    // different ones: on a single product's page its own name adds nothing.
    const tagged = bundle || new Set(g.items.map((a) => partKey(a.context))).size > 1;
    const pieces = [
      ...g.items.map((a) => (tagged && a.context ? labelled(a.context, a.units, limit) : joinAnswer(a.units, limit))),
      ...extra.map((x) => labelled(bundle && x.context ? x.context : x.label, x.units, limit)),
    ];
    return joinAnswer(pieces, limit);
  };
  const askQuestion = (q: string) => (namesProduct(q, title) ? q : p.aboutProduct(title, q));
  const askSpan = (g: AskGroup, extra: Part[] = []) => ({
    start: Math.min(...g.items.map((a) => a.start), ...extra.map((x) => x.start)),
    end: Math.max(...g.items.map((a) => a.end), ...extra.map((x) => x.end)),
  });

  // A heading that states the basis of what follows ("per 100 g", "/ tablet")
  // is part of the answer, and so is what a dimensions heading measures
  // ("Dimensiuni taburet", "Dimensiuni exterioare").
  const keepsLabel = (intent: Intent, label: string) => intent === "dimensions" || /\d|\/|\bper\b|\bpe\b/i.test(label);

  const hasContents = (byIntent.get("contents")?.length ?? 0) > 0 || askGroups.some((g) => g.intent === "contents");

  const ordered: FaqItem[] = [];
  for (const intent of INTENT_ORDER) {
    const limit = limitFor(intent);
    const all = byIntent.get(intent) ?? [];
    // Shops repeat a block per product of a bundle; the same text is said once.
    const parts = all.filter(
      (x, i) => all.findIndex((y) => normalize(joinAnswer(y.units, limit)) === normalize(joinAnswer(x.units, limit))) === i,
    );
    let groups = askGroups.filter((g) => g.intent === intent);
    if (bundle) {
      // In a bundle the merchant's questions of an intent are parts of the
      // intent's own question, each under its product's name: "De ce sa
      // alegi produsul?" asked of every product is one answer about the bundle.
      for (const g of groups) for (const a of g.items) parts.push({ label: a.q, context: a.context, units: a.units, start: a.start, end: a.end });
      groups = [];
      // A bundle's contents say what it contains; each product's
      // ingredients under "what does it contain" asks the same thing again.
      if (intent === "composition" && hasContents) continue;
    }
    if (parts.length === 0 && groups.length === 0) continue;
    if (bundle && intent !== "safety" && intent !== "contents") {
      const contexts = [...parts.map((x) => x.context), ...groups.flatMap((g) => g.items.map((a) => a.context))];
      if (!coversAll(contexts)) continue;
    }
    const labelCount = new Map<string, number>();
    for (const x of parts) labelCount.set(normalize(x.label), (labelCount.get(normalize(x.label)) ?? 0) + 1);
    const partText = (x: Part) =>
      bundle && x.context
        ? labelled(x.context, x.units, limit)
        : (labelCount.get(normalize(x.label)) ?? 0) > 1 && x.context
          ? labelled(x.context, x.units, limit)
          : labelled(x.label, x.units, limit);

    if (groups.length > 0) {
      // The merchant already asks this: their first question takes in the
      // sections and their other questions of the same intent - "De ce sa
      // alegi produsul?" and "De ce sa alegi colagenul MOY?" on one page are
      // one question, answered once.
      const [first, ...others] = groups;
      const merged = { ...first, items: [...first.items, ...others.flatMap((g) => g.items)] };
      const a = askAnswer(merged, parts);
      if (a !== "") ordered.push({ q: askQuestion(first.q), a, source: "merchant", intent, sourceSpan: askSpan(merged, parts) });
      continue;
    }
    // One section: its own text. Several: each under its heading, so
    // "Lungime: 180 cm; Latime: 90 cm" keeps which number is which.
    // In a bundle every product's part is in the answer or there is no
    // answer: cut to the first one, "how to use the pack" describes one of
    // its products. Warnings get more room and may be cut at a sentence,
    // because a bundle with warnings must have its warnings question.
    const bundleLimit =
      intent === "safety" ? { max: 2500, whole: false } : { max: LONG_ANSWER_CHARS, whole: intent !== "contents" || limit.whole };
    const a =
      parts.length === 1 && !bundle
        ? joinAnswer(keepsLabel(intent, parts[0].label) ? [{ text: parts[0].label, heading: true }, ...parts[0].units] : parts[0].units, limit)
        : joinAnswer(parts.map(partText), bundle ? bundleLimit : limit);
    if (a === "") continue;
    ordered.push({
      q: intentQuestion(p, intent, title),
      a,
      source: "section",
      intent,
      sourceSpan: { start: Math.min(...parts.map((x) => x.start)), end: Math.max(...parts.map((x) => x.end)) },
    });
  }

  // Warnings with no warnings heading: the sentences that say them.
  if (!ordered.some((x) => x.intent === "safety")) {
    const found = warningSentences(blocks);
    const a = found ? joinAnswer(found.units, limitFor("safety")) : "";
    if (found && a !== "") {
      ordered.unshift({ q: p.qSafety(title), a, source: "section", intent: "safety", sourceSpan: { start: found.start, end: found.end } });
    }
  }

  // The merchant's own questions with no intent, and the shop's mappings, in
  // the order they stand in the description. In a bundle, a question only one
  // of its products answers is not asked of the bundle.
  const rest: (FaqItem & { order: number })[] = [...mapped];
  for (const g of askGroups.filter((x) => x.intent === null)) {
    if (bundle && !coversAll(g.items.map((a) => a.context))) continue;
    const a = askAnswer(g);
    if (a !== "") rest.push({ q: askQuestion(g.q), a, source: "merchant", sourceSpan: askSpan(g), order: g.order });
  }
  for (const { order: _order, ...item } of rest.sort((x, y) => x.order - y.order)) ordered.push(item);

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
    if (own) ordered.push({ q: fillTitle(own, title), a: `${value}.`, source: "mapping" });
    else if (preset?.[key]) ordered.push({ q: preset[key](p, title), a: `${value}.`, source: "preset" });
  }

  // e: options with a real choice, and a brand that is not the shop's own.
  const options = (input.options ?? []).filter(
    (o) => o.name.trim().toLowerCase() !== "title" && new Set(o.values.map((v) => v.trim()).filter(Boolean)).size > 1,
  );
  if (options.length > 0) {
    ordered.push({ q: p.qOptions(title), a: optionsAnswer(options, p), source: "variants" });
  }
  // A vendor field of more than four words is a category someone typed there
  // ("BONE CONDUCTION OPEN-EAR SPORT HEADPHONES"), a placeholder is nobody,
  // and a bundle is made by more than one maker.
  const vendor = cleanOutput(input.vendor ?? "");
  if (
    vendor !== "" &&
    input.shopName &&
    !sameBrand(vendor, input.shopName) &&
    wordCount(vendor) <= 4 &&
    !PLACEHOLDER_VENDOR.test(normalize(vendor)) &&
    !GIFT_CARD.test(title) &&
    !bundle
  ) {
    ordered.push({ q: p.qVendor(title), a: `${vendor}.`, source: "vendor" });
  }

  // f: the shop's business record, unchanged from buildQuestions.
  // A gift card is not shipped or returned like goods: the store's delivery
  // times and return window are not its answers.
  // A question the shop already asks in its own words ("Cum il platesti?")
  // is not asked a second time from the business record.
  const b = input.business;
  const goods = !GIFT_CARD.test(title);
  const shopAsked = ordered
    .filter((x) => x.source === "merchant" || x.source === "mapping")
    .map((x) => ` ${normalize(x.q)} `)
    .join(" ");
  const asked = (topic: keyof typeof BUSINESS_TOPICS) => BUSINESS_TOPICS[topic].test(shopAsked);
  if (b) {
    if (b.deliveryTime && !b.deliveryVaries && goods && !asked("delivery")) {
      ordered.push({
        q: p.qDelivery(title),
        a: cleanOutput(p.aDelivery(b.deliveryTime, b.deliveryCost || null, Boolean(b.deliveryCostIsFrom))),
        source: "business",
      });
    }
    if (typeof b.returnDays === "number" && b.returnDays > 0 && goods && !asked("returns")) {
      ordered.push({ q: p.qReturns(title), a: p.aReturns(b.returnDays), source: "business" });
    }
    if (b.warranty && !asked("warranty")) {
      ordered.push({
        q: p.qWarranty(title),
        a: cleanOutput(`${warrantyWithUnit(b.warranty, input.language)}.`),
        source: "business",
      });
    }
    if (b.paymentMethods && !asked("payment")) {
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
  const others = unique.filter((x) => x.intent !== "safety");
  return [...safety, ...others.slice(0, Math.max(0, cap - safety.length))];
}
