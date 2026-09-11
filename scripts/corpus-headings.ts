// Heading texts of the FAQ corpus's DEV set, counted, for the intent keyword
// lists of app/engine/faq.ts (CC-PROMPT-AI-READABILITY-3 item 2b).
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/corpus-headings.ts [--min 3] [--store <domain>]
//
// Only the dev stores are read: the list comes from scripts/corpus-stores.ts,
// the manifest's split as code, so a hold-out file cannot be opened by
// accident and a store moved to dev is counted from then on. A heading is
// what faq.ts treats as one: <h2>..<h6>, <strong>/<b> opening a paragraph, or a
// text line ending in ":". Each heading counts once per product. Read only.
import fs from "node:fs";
import path from "node:path";
import { csvProducts } from "./csv";
import { CORPUS_STORES } from "./corpus-stores";

export const DEV_STORES = CORPUS_STORES.filter((s) => s.set === "dev").map((s) => s.name);

const DIR = "_shopify/corpus/stores";

export function loadStore(name: string): { title: string; body_html: string }[] {
  const file = path.join(DIR, name.endsWith(".csv") ? name : `${name}.json`);
  const text = fs.readFileSync(file, "utf8");
  return name.endsWith(".csv") ? csvProducts(text) : JSON.parse(text).products;
}

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:\s]+$/, "")
    .toLowerCase();
}

/** Heading texts of one description, as faq.ts would see them. */
export function headingTexts(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) out.add(clean(m[2]));
  for (const m of html.matchAll(/<(p|div|li)\b[^>]*>\s*(?:<span[^>]*>\s*)*<(strong|b)\b[^>]*>([\s\S]*?)<\/\2>/gi)) out.add(clean(m[3]));
  const lines = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((l) => l.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
  for (const l of lines) if (/:\s*$/.test(l) && l.length <= 80) out.add(clean(l));
  out.delete("");
  return [...out].filter((h) => h.length <= 80);
}

if (process.argv[1] && process.argv[1].endsWith("corpus-headings.ts")) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
  const min = Number(flag("--min") ?? 3);
  const only = flag("--store");
  const stores = only ? DEV_STORES.filter((s) => s === only) : DEV_STORES;
  if (only && stores.length === 0) throw new Error(`${only} is not a dev store`);

  const total = new Map<string, { n: number; stores: Set<string> }>();
  for (const s of stores) {
    for (const p of loadStore(s)) {
      for (const h of headingTexts(p.body_html ?? "")) {
        const e = total.get(h) ?? { n: 0, stores: new Set() };
        e.n++;
        e.stores.add(s);
        total.set(h, e);
      }
    }
  }
  const rows = [...total.entries()].filter(([, e]) => e.n >= min).sort((a, b) => b[1].n - a[1].n);
  console.log(`dev stores read: ${stores.length}; distinct headings: ${total.size}; with at least ${min} products: ${rows.length}`);
  for (const [h, e] of rows) console.log(`${e.n}\t${e.stores.size}\t${h}\t[${[...e.stores].join(", ")}]`);
}
