// Turns dumps written by scripts/audit-engine-run.ts --dump into markdown.
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/audit-engine-report.ts report <dump.json> [samples]
//   npx tsx scripts/audit-engine-report.ts diff <before.json> <after.json> [samples]
//
// report: summary count, question count per product (distribution), question
//         templates fired with counts, summaries carrying a price sentence,
//         and <samples> (default 10) Q&A pairs spread across the catalogue.
// diff:   the same metrics for both, templates added and removed, summaries
//         changed, and every fact value that a before summary or answer
//         carried and no after summary or answer carries.
//
// Read only; prints to stdout.
import fs from "node:fs";

type QA = { q: string; a: string };
type Row = { id: string; title: string; facts: { k: string; v: string }[]; summary: string; questions: QA[]; fit_for: string };
type Dump = { which: string; lang: string; business: boolean; products: Row[] };

// Checked in order; the first match names the template. English and Romanian
// wording of every template the engine has emitted, so a before and an after
// in different languages are counted against the same names.
const TEMPLATES: [string, RegExp][] = [
  ["price", /^How much does .* cost\?$|^Cât costă .*\?$/],
  ["delivery", /^How long does delivery take for |^În cât timp se livrează /],
  ["returns", /^Can I return |^Pot returna /],
  ["warranty", /^What warranty does |^Ce garanție are /],
  ["payment", /^How can I pay\?$|^Cum pot plăti\?$/],
  ["material", / made of\?$|^Din ce este făcut /],
  ["dimensions", /^What are the dimensions of |^Ce dimensiuni are /],
  ["seats", /^How many people does .* seat\?$|^Câte persoane /],
  ["includes-or-seats", / include or seat\?$|^Ce include sau câte locuri /],
  ["includes", /^What does .* include\?$|^Ce include /],
  ["room", /^Where is .* used\?$|^Unde se folosește /],
  ["generic", /^What .+ does .+ have\?$|^Ce .+ are .+\?$/],
];

export function templateOf(q: string): string {
  for (const [name, re] of TEMPLATES) if (re.test(q)) return name;
  return "unclassified";
}

const PRICE_SENTENCE = /Priced at |Preț: |Prețul este /;

function metrics(d: Dump, samples: number): string {
  const rows = d.products;
  const out: string[] = [];
  const withSummary = rows.filter((r) => r.summary.trim() !== "").length;
  out.push(`- Products: ${rows.length}`);
  out.push(`- Summaries (non-empty): ${withSummary}`);
  out.push(`- Summaries carrying a price sentence: ${rows.filter((r) => PRICE_SENTENCE.test(r.summary)).length}`);
  out.push(`- Content language passed: ${d.lang}; business answers passed: ${d.business ? "yes" : "no"}`);
  const total = rows.reduce((n, r) => n + r.questions.length, 0);
  out.push(`- Questions: ${total} in all, ${(total / rows.length).toFixed(2)} per product`);
  out.push("");
  out.push("Questions per product:");
  out.push("");
  out.push("| Questions | Products |");
  out.push("|---|---|");
  const dist = new Map<number, number>();
  for (const r of rows) dist.set(r.questions.length, (dist.get(r.questions.length) ?? 0) + 1);
  for (const [n, c] of [...dist.entries()].sort((a, b) => a[0] - b[0])) out.push(`| ${n} | ${c} |`);
  out.push("");
  out.push("Templates fired:");
  out.push("");
  out.push("| Template | Questions | Products |");
  out.push("|---|---|---|");
  for (const [name, n] of templateCounts(d)) out.push(`| ${name} | ${n.q} | ${n.p} |`);
  out.push("");
  out.push(`${samples} sample Q&A pairs:`);
  out.push("");
  for (const s of samplePairs(d, samples)) out.push(`- **${s.q}** ${s.a}`);
  return out.join("\n");
}

function templateCounts(d: Dump): Map<string, { q: number; p: number }> {
  const m = new Map<string, { q: number; p: number }>();
  for (const r of d.products) {
    const seen = new Set<string>();
    for (const qa of r.questions) {
      const t = templateOf(qa.q);
      const e = m.get(t) ?? { q: 0, p: 0 };
      e.q += 1;
      if (!seen.has(t)) e.p += 1;
      seen.add(t);
      m.set(t, e);
    }
  }
  return new Map([...m.entries()].sort((a, b) => b[1].q - a[1].q));
}

/** Spread across the catalogue, and across templates within it, so ten pairs
 * are not ten "How can I pay?". */
function samplePairs(d: Dump, n: number): QA[] {
  const rows = d.products.filter((r) => r.questions.length > 0);
  if (rows.length === 0) return [];
  const out: QA[] = [];
  for (let k = 0; out.length < n && k < n * 4; k++) {
    const r = rows[Math.floor((k * rows.length) / n) % rows.length];
    // Rotate through the row's questions, taking the first one not yet shown.
    for (let j = 0; j < r.questions.length; j++) {
      const qa = r.questions[(k + j) % r.questions.length];
      if (!out.some((o) => o.q === qa.q)) { out.push(qa); break; }
    }
  }
  return out;
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function diff(before: Dump, after: Dump, samples: number): string {
  const out: string[] = [];
  const tb = templateCounts(before);
  const ta = templateCounts(after);
  out.push("Templates, before and after:");
  out.push("");
  out.push("| Template | Before | After | Change |");
  out.push("|---|---|---|---|");
  for (const t of new Set([...tb.keys(), ...ta.keys()])) {
    const b = tb.get(t)?.q ?? 0;
    const a = ta.get(t)?.q ?? 0;
    out.push(`| ${t} | ${b} | ${a} | ${a - b >= 0 ? "+" : ""}${a - b} |`);
  }
  out.push("");
  const afterById = new Map(after.products.map((r) => [r.id, r]));
  let changed = 0;
  const lost: string[] = [];
  const removedByTemplate = new Map<string, string[]>();
  for (const b of before.products) {
    const a = afterById.get(b.id);
    if (!a) continue;
    if (a.summary !== b.summary) changed += 1;
    // Every value a before text carried, checked against every after text.
    // A fact counts as carried when its value appears in the summary or in an
    // answer; the price is reported apart, because it goes on purpose.
    const afterText = norm([a.summary, ...a.questions.map((q) => `${q.q} ${q.a}`)].join(" \n "));
    const beforeText = norm([b.summary, ...b.questions.map((q) => `${q.q} ${q.a}`)].join(" \n "));
    for (const f of b.facts) {
      for (const v of f.v.split(/,\s/)) {
        const nv = norm(v.trim());
        if (nv && beforeText.includes(nv) && !afterText.includes(nv)) {
          lost.push(`${b.title} | ${f.k}: ${v.trim()}`);
        }
      }
    }
    const aTemplates = new Map<string, number>();
    for (const q of a.questions) aTemplates.set(templateOf(q.q), (aTemplates.get(templateOf(q.q)) ?? 0) + 1);
    for (const q of b.questions) {
      const t = templateOf(q.q);
      const left = aTemplates.get(t) ?? 0;
      if (left > 0) aTemplates.set(t, left - 1);
      else {
        const list = removedByTemplate.get(t) ?? [];
        list.push(`${q.q} -> ${q.a}`);
        removedByTemplate.set(t, list);
      }
    }
  }
  out.push(`Summaries changed: ${changed} of ${before.products.length}`);
  out.push("");
  out.push("Questions removed, per template (a product lost a question of this template):");
  out.push("");
  for (const [t, list] of removedByTemplate) {
    out.push(`- ${t}: ${list.length}`);
  }
  out.push("");
  out.push(`Fact values carried by a before summary or answer and by no after summary or answer: ${lost.length}`);
  out.push("");
  for (const l of lost) out.push(`- ${l}`);
  out.push("");
  out.push(`${samples} sample Q&A pairs, after:`);
  out.push("");
  for (const s of samplePairs(after, samples)) out.push(`- **${s.q}** ${s.a}`);
  return out.join("\n");
}

const [mode, a, b, c] = process.argv.slice(2);
const load = (p: string): Dump => JSON.parse(fs.readFileSync(p, "utf8"));
if (mode === "report") {
  console.log(metrics(load(a), Number(b ?? 10)));
} else if (mode === "diff") {
  console.log(diff(load(a), load(b), Number(c ?? 10)));
} else if (mode === "removed") {
  // Every removed question in full, for reading one by one.
  const before = load(a);
  const afterById = new Map(load(b).products.map((r) => [r.id, r]));
  for (const r of before.products) {
    const after = afterById.get(r.id);
    const kept = new Map<string, number>();
    for (const q of after?.questions ?? []) kept.set(templateOf(q.q), (kept.get(templateOf(q.q)) ?? 0) + 1);
    for (const q of r.questions) {
      const t = templateOf(q.q);
      if ((kept.get(t) ?? 0) > 0) kept.set(t, kept.get(t)! - 1);
      else console.log(`${t}\t${r.title}\t${q.q}\t${q.a}`);
    }
  }
} else {
  console.log("usage: report <dump> [samples] | diff <before> <after> [samples] | removed <before> <after>");
}
