// Before and after the FAQ builder changed (CC-PROMPT-AI-READABILITY-3 item 6).
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/audit-faq-compare.ts <before-dump.json> <after-dump.json> [--after faq|questions] [--out file.md]
//
// Both files are scripts/audit-engine-run.ts --dump outputs of the same
// catalogue. "Before" is the question list the live path wrote (the
// `questions` field, buildQuestions); "after" is, with `--after faq` (the
// default), what buildFaq would write once wired, and with `--after questions`
// what the live path writes now. Prints the totals per
// source after, and every question that was there before and is gone, grouped
// by its template (the product title replaced by {title}), with counts and the
// products it left. Read only.
import fs from "node:fs";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const afterIdx = args.indexOf("--after");
const afterField = afterIdx === -1 ? "faq" : args[afterIdx + 1];
const [beforeFile, afterFile] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!beforeFile || !afterFile) throw new Error("usage: audit-faq-compare.ts <before.json> <after.json> [--out file.md]");

type Q = { q: string; a: string; source?: string };
const load = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
const before = load(beforeFile);
const after = load(afterFile);
const afterById = new Map<string, any>(after.products.map((p: any) => [p.id, p]));
const listOf = (p: any, after: boolean): Q[] =>
  after && afterField === "faq" && Array.isArray(p.faq) ? p.faq : p.questions ?? [];
// Titles in a CSV export keep their entities ("&amp;"); the questions carry
// the cleaned title, so both spellings stand for {title}.
const template = (q: string, title: string) =>
  q.split(title).join("{title}").split(title.replace(/&amp;/g, "&")).join("{title}");

let beforeTotal = 0;
let afterTotal = 0;
const bySource = new Map<string, number>();
const removed = new Map<string, { n: number; products: string[] }>();
const added = new Map<string, number>();
for (const p of before.products) {
  const a = afterById.get(p.id);
  if (!a) continue;
  const was = listOf(p, false);
  const now = listOf(a, true);
  beforeTotal += was.length;
  afterTotal += now.length;
  for (const x of now) bySource.set(x.source ?? "(none)", (bySource.get(x.source ?? "(none)") ?? 0) + 1);
  const nowQ = new Set(now.map((x) => x.q));
  const wasQ = new Set(was.map((x) => x.q));
  for (const x of was) {
    if (nowQ.has(x.q)) continue;
    const t = template(x.q, p.title);
    const r = removed.get(t) ?? { n: 0, products: [] };
    r.n++;
    if (r.products.length < 5) r.products.push(p.title);
    removed.set(t, r);
  }
  for (const x of now) if (!wasQ.has(x.q)) {
    const t = `${template(x.q, p.title)} [${x.source ?? "-"}]`;
    added.set(t, (added.get(t) ?? 0) + 1);
  }
}

const lines = [
  `# FAQ before and after: ${before.which} (${before.products.length} products), after = ${afterField === "faq" ? "buildFaq, if wired" : "the live buildQuestions"}`,
  "",
  `Questions before: ${beforeTotal}. After: ${afterTotal}.`,
  "",
  "## After, by source",
  "",
  "| Source | Questions |",
  "|---|---|",
  ...[...bySource].sort((x, y) => y[1] - x[1]).map(([s, n]) => `| ${s} | ${n} |`),
  "",
  `## Every question removed, by template (${[...removed.values()].reduce((s, r) => s + r.n, 0)})`,
  "",
  "| Template | Removed | Products (first 5) |",
  "|---|---|---|",
  ...[...removed].sort((x, y) => y[1].n - x[1].n).map(([t, r]) => `| ${t} | ${r.n} | ${r.products.join("; ")} |`),
  "",
  `## New questions, by template and source (${[...added.values()].reduce((s, n) => s + n, 0)})`,
  "",
  "| Template [source] | Added |",
  "|---|---|",
  ...[...added].sort((x, y) => y[1] - x[1]).map(([t, n]) => `| ${t} | ${n} |`),
];
const text = lines.join("\n");
if (outIdx !== -1) fs.writeFileSync(args[outIdx + 1], text);
console.log(lines.slice(0, 30).join("\n"));
