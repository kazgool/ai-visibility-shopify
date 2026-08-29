// A published analysis of 1.4 million ChatGPT prompts found that assistants
// do not search the user's prompt as written: they rewrite it into narrower
// sub-questions and search those, and the pages that get cited are the ones
// whose titles share wording with those sub-questions. The app already
// generates buyer questions per product from real data, so this checks
// whether the product's own title (and, as a fallback, the opening of its
// summary) actually shares wording with the questions a buyer would ask.
//
// This is a word overlap ratio, not a similarity model. It counts how many
// distinct words from the generated questions also appear in the title or
// summary opening, after stripping diacritics, lowercasing and removing
// stopwords. Nothing here understands meaning, synonyms or word order.

import { normalize } from "./normalize";
import { stopwordSet } from "./stopwords";
import type { QA } from "./summary";

const STOPWORDS = stopwordSet();

export type CitationVerdict = "good" | "partial" | "weak";

export type CitationCheck = {
  verdict: CitationVerdict;
  titleScore: number;
  openingScore: number;
  handleIsDescriptive: boolean;
  /** Distinct question words missing from the title, for the "consider adding" suggestion. */
  missingFromTitle: string[];
};

/** Normalise, drop stopwords, dedupe. Used identically on both sides of the comparison. */
function distinctWords(text: string): string[] {
  const words = normalize(text ?? "").split(" ").filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** Share of `words` that also appear in `against`. Zero when there is nothing to check. */
function overlapScore(words: string[], against: Set<string>): number {
  if (words.length === 0) return 0;
  const matched = words.filter((w) => against.has(w)).length;
  return matched / words.length;
}

/**
 * A handle reads as natural language when it is hyphen-separated words, or a
 * single plain word - not a bare number and not an opaque identifier such as
 * a SKU or a random-looking alphanumeric string.
 */
export function isDescriptiveHandle(handle: string): boolean {
  const h = String(handle ?? "").trim().toLowerCase();
  if (h === "") return false;
  if (/^\d+$/.test(h)) return false;

  const segments = h.split("-").filter(Boolean);
  if (segments.length >= 2) return true;

  const single = segments[0] ?? "";
  if (single === "") return false;
  if (single.length > 12) return false;
  if (/\d/.test(single) && /[a-z]/.test(single)) return false;
  return /^[a-z]+$/.test(single);
}

/**
 * Verdict on whether this product's title and handle would surface in the
 * sub-questions an assistant generates from a buyer's prompt. Returns null
 * when the product has no generated questions: there is nothing to compare
 * against, which is different from comparing and finding no overlap.
 */
export function checkCitationReadiness(input: {
  title: string;
  summaryOpening: string;
  questions: QA[];
  handle: string;
}): CitationCheck | null {
  if (!input.questions || input.questions.length === 0) return null;

  const questionWords: string[] = [];
  const seen = new Set<string>();
  for (const qa of input.questions) {
    for (const word of distinctWords(qa.q)) {
      if (seen.has(word)) continue;
      seen.add(word);
      questionWords.push(word);
    }
  }

  const titleWords = new Set(distinctWords(input.title));
  const openingWords = new Set(distinctWords(input.summaryOpening));

  const titleScore = overlapScore(questionWords, titleWords);
  const openingScore = overlapScore(questionWords, openingWords);
  const handleIsDescriptive = isDescriptiveHandle(input.handle);

  let verdict: CitationVerdict;
  if (titleScore >= 0.4 && handleIsDescriptive) {
    verdict = "good";
  } else if (titleScore >= 0.2 || openingScore >= 0.4) {
    verdict = "partial";
  } else {
    verdict = "weak";
  }

  const missingFromTitle = questionWords.filter((w) => !titleWords.has(w));

  return { verdict, titleScore, openingScore, handleIsDescriptive, missingFromTitle };
}
