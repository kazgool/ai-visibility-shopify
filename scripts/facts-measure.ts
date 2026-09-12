// Batch 5 items 6 and 7: what a rule change did to error rate AND to coverage,
// measured against the verdicts already on disk.
//
// The judge is a subagent and costs a run per measurement. This does not need
// one. Every pair the judge has ever seen is keyed by (store, product, label,
// value), so a value the engine still emits keeps the verdict it already has.
// The three things that can happen to a pair are counted apart, because they
// are three different sentences:
//
//   kept       the engine still emits it and it was judged - it keeps its
//              verdict, and these are what the error rate is computed over.
//   dropped    the engine no longer emits it. If it was judged an error, the
//              rule removed an error; if it was judged ok, the rule cost
//              coverage. Both are reported, because a rule that removes noise
//              and value together is worse than the noise (DICTIONARY-PORT
//              section 10.1).
//   new        the engine emits it and no judge has seen it. It is NOT counted
//              as ok. It is reported as unjudged, with its own denominator, so
//              a rule that replaces wrong values with different wrong values
//              cannot read as an improvement.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/facts-measure.ts <run-name> [--set dev|holdout] [--store x]
//   npx tsx scripts/facts-measure.ts after5 --against base5    (two runs)
//
// Read only.

import fs from "node:fs";
import path from "node:path";
import { loadVerdicts } from "./faq-judge-batches";
import { factId } from "./facts-judge-batches";

type RunProduct = { id: string; title: string; facts: { k: string; v: string }[] };
type RunFile = { store: string; set: string; products: RunProduct[] };

function loadRun(run: string): RunFile[] {
  const dir = path.join("_shopify/corpus/runs", run);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RunFile);
}

type Tally = {
  /** Values the engine emits. */
  emitted: number;
  /** Of those, values a judge has seen. */
  judged: number;
  /** Of those judged, errors. */
  errors: number;
  /** Values the engine emits that no judge has seen. */
  unjudged: number;
  /** Products this group appears on. */
  products: Set<string>;
};

const blank = (): Tally => ({ emitted: 0, judged: 0, errors: 0, unjudged: 0, products: new Set() });

function main() {
  const args = process.argv.slice(2);
  const arg = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i === -1 ? null : args[i + 1];
  };
  const run = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  if (!run) throw new Error("usage: facts-measure.ts <run-name> [--set dev|holdout] [--store x] [--against run]");
  const set = arg("set");
  const store = arg("store");
  const against = arg("against");

  const verdicts = loadVerdicts();
  let files = loadRun(run);
  if (set) files = files.filter((f) => f.set === set);
  if (store) files = files.filter((f) => f.store === store);

  const byGroup = new Map<string, Tally>();
  const total = blank();
  let productCount = 0;
  const emittedIds = new Set<string>();

  for (const file of files) {
    for (const p of file.products) {
      productCount += 1;
      for (const f of p.facts ?? []) {
        const id = factId(file.store, p.id, f.k, f.v);
        emittedIds.add(id);
        const t = byGroup.get(f.k) ?? blank();
        byGroup.set(f.k, t);
        for (const x of [t, total]) {
          x.emitted += 1;
          x.products.add(`${file.store}|${p.id}`);
        }
        const v = verdicts.get(id);
        if (!v) {
          for (const x of [t, total]) x.unjudged += 1;
          continue;
        }
        for (const x of [t, total]) x.judged += 1;
        if (v.verdict === "error") for (const x of [t, total]) x.errors += 1;
      }
    }
  }

  const scope = [run, set ?? "every set", store ?? "every store"].join(" / ");
  console.log(`# Facts measured - ${scope}\n`);
  console.log(`Products: ${productCount}. Values emitted: ${total.emitted} `
    + `(${(total.emitted / Math.max(1, productCount)).toFixed(2)} per product).`);
  console.log(`Of them judged: ${total.judged}. Errors: ${total.errors} (${pct(total.errors, total.judged)}).`);
  console.log(`Emitted but never judged: ${total.unjudged} (${pct(total.unjudged, total.emitted)}). `
    + `These are NOT counted as correct.\n`);

  if (against) {
    let before = loadRun(against);
    if (set) before = before.filter((f) => f.set === set);
    if (store) before = before.filter((f) => f.store === store);
    let dropped = 0;
    let droppedErrors = 0;
    let droppedOk = 0;
    let droppedUnjudged = 0;
    let beforeEmitted = 0;
    for (const file of before) {
      for (const p of file.products) {
        for (const f of p.facts ?? []) {
          beforeEmitted += 1;
          const id = factId(file.store, p.id, f.k, f.v);
          if (emittedIds.has(id)) continue;
          dropped += 1;
          const v = verdicts.get(id);
          if (!v) droppedUnjudged += 1;
          else if (v.verdict === "error") droppedErrors += 1;
          else droppedOk += 1;
        }
      }
    }
    console.log(`## Against ${against}\n`);
    console.log(`Values before: ${beforeEmitted}. After: ${total.emitted}. `
      + `Dropped: ${dropped} (${pct(dropped, beforeEmitted)}).`);
    console.log(`Of the dropped: ${droppedErrors} were judged errors, ${droppedOk} were judged correct, `
      + `${droppedUnjudged} had never been judged.`);
    console.log(`Correct values lost per error removed: `
      + `${droppedErrors === 0 ? "-" : (droppedOk / droppedErrors).toFixed(2)}\n`);
  }

  console.log("## By dictionary group, 30 or more values judged\n");
  console.log("| Group | Emitted | Judged | Errors | Error rate | Unjudged | Bar (1%) |");
  console.log("|---|---|---|---|---|---|---|");
  const ranked = [...byGroup]
    .filter(([, t]) => t.judged >= 30)
    .sort((a, b) => b[1].errors / Math.max(1, b[1].judged) - a[1].errors / Math.max(1, a[1].judged));
  for (const [group, t] of ranked) {
    const rate = t.judged === 0 ? 0 : (100 * t.errors) / t.judged;
    console.log(
      `| ${group} | ${t.emitted} | ${t.judged} | ${t.errors} | ${pct(t.errors, t.judged)} | ${t.unjudged} | ${rate <= 1 ? "met" : "NOT met"} |`,
    );
  }
  const thin = [...byGroup].filter(([, t]) => t.judged < 30);
  console.log(
    `\n${thin.length} groups have fewer than 30 values judged and nothing is promised about them: `
      + thin.map(([g, t]) => `${g} (${t.errors}/${t.judged})`).join(", "),
  );
}

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}% (${n}/${d})`;
}

main();
