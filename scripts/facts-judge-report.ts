// The facts judge's results (CC-PROMPT-AI-READABILITY-3 item 7): error rate of
// the visible facts list per store and per dictionary group, dev and hold-out
// apart. Measures only; no default changes on it in this batch.
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/facts-judge-report.ts <run-name> [--out file.md]
import fs from "node:fs";
import path from "node:path";
import { loadVerdicts } from "./faq-judge-batches";
import { factId } from "./facts-judge-batches";

const args = process.argv.slice(2);
const run = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!run) throw new Error("usage: facts-judge-report.ts <run-name> [--out file.md]");
const outIdx = args.indexOf("--out");
const verdicts = loadVerdicts();

type T = { shown: number; judged: number; errors: number };
const blank = (): T => ({ shown: 0, judged: 0, errors: 0 });
const byStore = new Map<string, T & { set: string }>();
const byGroup = new Map<string, T>();
const bySet = new Map<string, T>();
const errors: string[] = [];
for (const f of fs.readdirSync(path.join("_shopify/corpus/runs", run)).filter((f) => f.endsWith(".json")).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join("_shopify/corpus/runs", run, f), "utf8"));
  const st = { ...blank(), set: r.set };
  byStore.set(r.store, st);
  const total = bySet.get(r.set) ?? blank();
  bySet.set(r.set, total);
  for (const p of r.products) {
    for (const x of p.facts as { k: string; v: string }[]) {
      const g = byGroup.get(`${r.store} / ${x.k}`) ?? blank();
      byGroup.set(`${r.store} / ${x.k}`, g);
      for (const t of [st, g, total]) t.shown++;
      const v = verdicts.get(factId(r.store, p.id, x.k, x.v));
      if (!v) continue;
      for (const t of [st, g, total]) t.judged++;
      if (v.verdict === "error") {
        for (const t of [st, g, total]) t.errors++;
        errors.push(`- **${r.store}** (${r.set}), ${p.title}: "${x.k}: ${x.v}" [rule ${v.rule}] - ${v.reason}`);
      }
    }
  }
}
const rate = (t: T) => (t.judged === 0 ? "-" : `${((100 * t.errors) / t.judged).toFixed(1)}% (${t.errors}/${t.judged})`);
const lines = [`# Visible facts, judged, run ${run}`, "", "## By set", "", "| Set | Pairs shown | judged | errors | error rate |", "|---|---|---|---|---|"];
for (const [k, t] of bySet) lines.push(`| ${k} | ${t.shown} | ${t.judged} | ${t.errors} | ${rate(t)} |`);
lines.push("", "## By store", "", "| Store | Set | Pairs shown | judged | errors | error rate |", "|---|---|---|---|---|---|");
for (const [k, t] of [...byStore].sort((a, b) => a[1].set.localeCompare(b[1].set) || a[0].localeCompare(b[0]))) {
  lines.push(`| ${k} | ${t.set} | ${t.shown} | ${t.judged} | ${t.errors} | ${rate(t)} |`);
}
lines.push("", "## By store and group", "", "| Store / group | Pairs shown | judged | errors | error rate |", "|---|---|---|---|---|");
for (const [k, t] of [...byGroup].sort()) lines.push(`| ${k} | ${t.shown} | ${t.judged} | ${t.errors} | ${rate(t)} |`);
lines.push("", `## Every error (${errors.length})`, "", ...errors);
const text = lines.join("\n");
if (outIdx !== -1) fs.writeFileSync(args[outIdx + 1], text);
console.log(lines.slice(0, 40).join("\n"));
