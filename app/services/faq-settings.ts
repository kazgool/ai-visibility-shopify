// A shop's FAQ settings and which dictionary groups its product pages show
// (CC-PROMPT-AI-READABILITY-3 item 3), stored with the dictionary.
//
// Pure: parsing and validation only, so the Dictionary route, the worker and
// the tests share one reading of what a merchant may save. Storage lives in
// faq-settings.server.ts.
import { DEFAULT_DICTIONARY, PRESETS, parseDictionary } from "../engine";
import { DEFAULT_FAQ_CAP, isPlainText, validateFaqQuestion, type FaqMappings } from "../engine/faq";

export const FAQ_MAPPINGS_KEY = "faq_mappings";
export const FAQ_CAP_KEY = "faq_cap";
export const DICTIONARY_PRESET_KEY = "dictionary_preset";
export const FACTS_HIDDEN_KEY = "facts_hidden";
/** The shop metafield the product page's facts list reads: { hidden: [label] }. */
export const FACTS_DISPLAY_METAFIELD = "facts_display";

export const MAX_FAQ_CAP = 20;
export const MAX_MAPPINGS = 50;

export type Mappings = Required<FaqMappings>;

export type FaqSettings = {
  mappings: Mappings;
  cap: number;
  /** The trade preset the dictionary started from, when the merchant picked one. */
  presetId: string | null;
  /** Dictionary group labels the product page's facts list leaves out. */
  hiddenGroups: string[];
};

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Stored mappings, whatever the row holds: bad JSON or a wrong shape reads
 * as no mappings, never as an error on a screen that did not cause it. */
export function parseMappings(raw: string | null | undefined): Mappings {
  try {
    const value = JSON.parse(raw ?? "");
    const sections = Array.isArray(value?.sections) ? value.sections : [];
    const groups = Array.isArray(value?.groups) ? value.groups : [];
    return {
      sections: sections.map((s: any) => ({ heading: text(s?.heading), question: text(s?.question) })),
      groups: groups.map((g: any) => ({ group: text(g?.group), question: text(g?.question) })),
    };
  } catch {
    return { sections: [], groups: [] };
  }
}

/** Rows trimmed, and a row left entirely blank dropped: an empty row is an
 * unused line on the form, not a mistake. */
export function cleanMappings(m: Mappings): Mappings {
  return {
    sections: m.sections
      .map((s) => ({ heading: s.heading.trim(), question: s.question.trim() }))
      .filter((s) => s.heading !== "" || s.question !== ""),
    groups: m.groups
      .map((g) => ({ group: g.group.trim(), question: g.question.trim() }))
      .filter((g) => g.group !== "" || g.question !== ""),
  };
}

export type MappingError = { list: "sections" | "groups"; row: number; message: string };

/** Every reason the mappings cannot be saved, one per row and field, rows
 * numbered from 1 as the form shows them. Empty means they can. */
export function validateMappings(m: Mappings): MappingError[] {
  const errors: MappingError[] = [];
  if (m.sections.length > MAX_MAPPINGS || m.groups.length > MAX_MAPPINGS) {
    errors.push({ list: m.sections.length > MAX_MAPPINGS ? "sections" : "groups", row: 0, message: `At most ${MAX_MAPPINGS} per list.` });
  }
  const headings = new Set<string>();
  m.sections.forEach((s, i) => {
    const row = i + 1;
    if (s.heading === "") errors.push({ list: "sections", row, message: "Write the heading as it appears in your descriptions." });
    else if (!isPlainText(s.heading)) errors.push({ list: "sections", row, message: 'Use plain characters in the heading: "-" for dashes, straight quotes.' });
    else if (s.heading.length > 120) errors.push({ list: "sections", row, message: "Keep the heading under 120 characters." });
    else if (headings.has(s.heading.toLowerCase())) errors.push({ list: "sections", row, message: "This heading is already listed." });
    headings.add(s.heading.toLowerCase());
    const q = validateFaqQuestion(s.question);
    if (q) errors.push({ list: "sections", row, message: q });
  });
  const groups = new Set<string>();
  m.groups.forEach((g, i) => {
    const row = i + 1;
    if (g.group === "") errors.push({ list: "groups", row, message: "Choose a dictionary group." });
    else if (groups.has(g.group.toLowerCase())) errors.push({ list: "groups", row, message: "This group already has a question." });
    groups.add(g.group.toLowerCase());
    const q = validateFaqQuestion(g.question);
    if (q) errors.push({ list: "groups", row, message: q });
  });
  return errors;
}

/** The cap as stored; anything unreadable is the default. */
export function parseCap(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_FAQ_CAP ? n : DEFAULT_FAQ_CAP;
}

/** Why a typed cap cannot be saved, or null. */
export function validateCap(raw: string): string | null {
  const n = Number(raw.trim());
  if (raw.trim() === "" || !Number.isInteger(n) || n < 1 || n > MAX_FAQ_CAP) {
    return `Questions per product must be a whole number from 1 to ${MAX_FAQ_CAP}.`;
  }
  return null;
}

/** Hidden group labels as stored: unique, in a stable order. */
export function parseHidden(raw: string | null | undefined): string[] {
  try {
    const value = JSON.parse(raw ?? "");
    return Array.isArray(value) ? normaliseHidden(value.filter((v) => typeof v === "string")) : [];
  } catch {
    return [];
  }
}

export function normaliseHidden(labels: string[]): string[] {
  return [...new Set(labels.map((l) => l.trim()).filter(Boolean))].sort();
}

/** The group labels of the dictionary a shop runs: its own, or the built-in
 * list when it has none. */
export function dictionaryGroups(dictionaryText: string): string[] {
  const text = dictionaryText.trim() === "" ? DEFAULT_DICTIONARY : dictionaryText;
  return parseDictionary(text).map((g) => g.label);
}

/**
 * The preset whose question templates apply: the one the merchant picked,
 * or furniture for a shop still on the built-in list, which is furniture's.
 * A dictionary written by hand with no preset picked asks no preset question.
 */
export function effectivePresetId(stored: string | null, dictionaryText: string): string | null {
  if (stored && PRESETS[stored]) return stored;
  return dictionaryText.trim() === "" ? "furniture" : null;
}
