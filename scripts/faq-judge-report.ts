// The judge's results for a corpus run (CC-PROMPT-AI-READABILITY-3 item 5).
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/faq-judge-report.ts <run-name> [--set dev|holdout|all] [--out file.md]
//
// Joins every Q&A of the run to its verdict (_shopify/corpus/verdicts) and
// prints, per store and per source: produced, judged, errors, error rate.
// A missing safety question (rubric rule 6) is an error with no Q&A behind
// it: it is counted as one more item that should have been produced, so the
// rate is errors / (produced + missing safety questions). Every error is
// listed with its rule and reason. Read only.
import fs from "node:fs";
import path from "node:path";
import { hasWarningWords, itemId, loadVerdicts, safetyId } from "./faq-judge-batches";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const run = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!run) throw new Error("usage: faq-judge-report.ts <run-name> [--set dev|holdout|all] [--out file.md]");
const set = flag("--set") ?? "all";
const runDir = path.join("_shopify/corpus/runs", run);
const verdicts = loadVerdicts(true);

type Tally = { produced: number; judged: number; errors: number; missingSafety: number };
const blank = (): Tally => ({ produced: 0, judged: 0, errors: 0, missingSafety: 0 });
const byStore = new Map<string, Tally & { set: string }>();
const bySource = new Map<string, Tally>();
const bySet = new Map<string, Tally>();
const errors: any[] = [];
let unjudged = 0;

for (const f of fs.readdirSync(runDir).filter((f) => f.endsWith(".json")).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(runDir, f), "utf8"));
  if (set !== "all" && r.set !== set) continue;
  const st = { ...blank(), set: r.set };
  byStore.set(r.store, st);
  const totals = bySet.get(r.set) ?? blank();
  bySet.set(r.set, totals);
  for (const p of r.products) {
    for (const x of p.faq) {
      const src = x.intent === "safety" ? "section:safety" : x.source;
      const s = bySource.get(src) ?? blank();
      bySource.set(src, s);
      for (const t of [st, s, totals]) t.produced++;
      const v = verdicts.get(itemId(r.store, p.id, x.q, x.a));
      if (!v) { unjudged++; continue; }
      for (const t of [st, s, totals]) t.judged++;
      if (v.verdict === "error") {
        for (const t of [st, s, totals]) t.errors++;
        errors.push({ set: r.set, store: r.store, product: p.title, source: src, q: x.q, a: x.a, rule: v.rule, reason: v.reason });
      }
    }
    const hasSafety = p.faq.some((x: any) => x.intent === "safety");
    if (!hasSafety && hasWarningWords(p.outline)) {
      const v = verdicts.get(safetyId(r.store, p.id, p.outline, hasSafety));
      if (!v) { unjudged++; continue; }
      if (v.verdict === "error") {
        const s = bySource.get("missing safety") ?? blank();
        bySource.set("missing safety", s);
        for (const t of [st, s, totals]) { t.missingSafety++; t.errors++; }
        errors.push({ set: r.set, store: r.store, product: p.title, source: "missing safety", q: "(missing safety question)", a: "", rule: 6, reason: v.reason });
      }
    }
  }
}

const rate = (t: Tally) => {
  const d = t.produced + t.missingSafety;
  return d === 0 ? "-" : `${((100 * t.errors) / d).toFixed(2)}% (${t.errors}/${d})`;
};
const lines: string[] = [];
lines.push(`# Judge results, run ${run}`, "", `Unjudged items: ${unjudged}.`, "");
lines.push("## Totals by set", "", "| Set | Q&A produced | judged | missing safety | errors | error rate |", "|---|---|---|---|---|---|");
for (const [k, t] of bySet) lines.push(`| ${k} | ${t.produced} | ${t.judged} | ${t.missingSafety} | ${t.errors} | ${rate(t)} |`);
lines.push("", "## By store", "", "| Store | Set | Q&A produced | judged | missing safety | errors | error rate |", "|---|---|---|---|---|---|---|");
for (const [k, t] of [...byStore].sort((a, b) => a[1].set.localeCompare(b[1].set) || a[0].localeCompare(b[0]))) {
  lines.push(`| ${k} | ${t.set} | ${t.produced} | ${t.judged} | ${t.missingSafety} | ${t.errors} | ${rate(t)} |`);
}
lines.push("", "## By source", "", "| Source | Q&A produced | judged | errors | error rate |", "|---|---|---|---|---|");
for (const [k, t] of [...bySource].sort()) lines.push(`| ${k} | ${t.produced} | ${t.judged} | ${t.errors} | ${rate(t)} |`);
lines.push("", `## Every error (${errors.length})`, "");
for (const e of errors) {
  lines.push(`- **${e.store}** (${e.set}), ${e.product} [${e.source}, rule ${e.rule}]: "${e.q}" -> "${String(e.a).slice(0, 240)}" - ${e.reason}`);
}
const out = lines.join("\n");
const file = flag("--out");
if (file) fs.writeFileSync(file, out);
console.log(out.split("\n").slice(0, 60).join("\n"));
