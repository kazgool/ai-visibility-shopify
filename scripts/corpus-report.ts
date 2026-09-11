// Per-store profile of the FAQ corpus (CC-PROMPT-AI-READABILITY-3 item 1).
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/corpus-report.ts <dir-or-file> [...]
//
// Reads files written by scripts/corpus-fetch.ts ({ domain, products }) or a
// plain /products.json read ({ products }), and prints one row per store:
// product count, a language guess, the share of descriptions with any heading
// or bold paragraph start, and the share with a line ending in "?".
// Read only. The language guess is a word count, printed so it can be checked;
// the manifest's language column is set by a person, not by this guess.
import fs from "node:fs";
import path from "node:path";
import { csvProducts } from "./csv";

type P = { body_html?: string | null };

/** Description text as lines, one per block element or <br>. */
export function htmlLines(html: string): string[] {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const HEADING = /<h[2-6]\b/i;
const BOLD_START = /<(p|div|li)\b[^>]*>\s*(<span[^>]*>\s*)*<(strong|b)\b/i;

export function hasHeading(html: string): boolean {
  return HEADING.test(html) || BOLD_START.test(html);
}

export function hasQuestionLine(html: string): boolean {
  return htmlLines(html).some((l) => /\?\s*$/.test(l));
}

const RO = /\b(si|și|pentru|este|sunt|care|din|cu|la|sau|produsul|acest)\b|[ăâîșțşţ]/gi;
const EN = /\b(the|and|with|for|is|are|this|your|of|to)\b/gi;

export function languageGuess(products: P[]): { lang: string; ro: number; en: number } {
  let ro = 0;
  let en = 0;
  for (const p of products) {
    const t = (p.body_html ?? "").replace(/<[^>]+>/g, " ");
    ro += (t.match(RO) ?? []).length;
    en += (t.match(EN) ?? []).length;
  }
  const lang = ro === 0 && en === 0 ? "?" : ro > en ? "ro" : "en";
  return { lang, ro, en };
}

function files(args: string[]): string[] {
  return args.flatMap((a) =>
    fs.statSync(a).isDirectory()
      ? fs.readdirSync(a).filter((f) => /\.(json|csv)$/.test(f)).map((f) => path.join(a, f))
      : [a],
  );
}

const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((100 * n) / d)}% (${n}/${d})`);

console.log("| Store | Products | With description | Language guess (ro/en words) | Heading or bold start | Line ending in ? |");
console.log("|---|---|---|---|---|---|");
for (const f of files(process.argv.slice(2))) {
  const text = fs.readFileSync(f, "utf8");
  const raw = f.endsWith(".csv") ? { products: csvProducts(text) } : JSON.parse(text);
  const products: P[] = raw.products ?? [];
  const name = raw.domain ?? path.basename(f, ".json");
  const described = products.filter((p) => (p.body_html ?? "").replace(/<[^>]+>/g, "").trim() !== "");
  const lg = languageGuess(products);
  const head = described.filter((p) => hasHeading(p.body_html ?? "")).length;
  const q = described.filter((p) => hasQuestionLine(p.body_html ?? "")).length;
  console.log(`| ${name} | ${products.length} | ${described.length} | ${lg.lang} (${lg.ro}/${lg.en}) | ${pct(head, described.length)} | ${pct(q, described.length)} |`);
}
