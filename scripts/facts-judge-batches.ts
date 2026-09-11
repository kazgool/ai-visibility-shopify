// Cuts a corpus run's visible facts into judge batches (CC-PROMPT-AI-READABILITY-3
// item 7): every fact pair as the product page shows it, judged by rubric
// rules 2 and 3 against the product's own description.
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/facts-judge-batches.ts <run-name> [--set dev|holdout|all] [--budget 140000]
//
// Writes _shopify/corpus/batches/<run>-facts/b001.md (what the judge reads)
// and b001.index.json (id -> store, product, label, value), which
// scripts/faq-judge-merge.ts <run>-facts joins to the verdicts. A pair already
// judged is not batched again. Read only.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadVerdicts } from "./faq-judge-batches";

export function factId(store: string, product: string, k: string, v: string): string {
  return crypto.createHash("sha1").update(`${store}|${product}|fact|${k}|${v}`).digest("hex").slice(0, 16);
}

function wrap(text: string, width = 400): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let rest = line;
    while (rest.length > width) {
      const cut = rest.lastIndexOf(" ", width);
      const at = cut > width / 2 ? cut : width;
      out.push(rest.slice(0, at));
      rest = `    ${rest.slice(at).trimStart()}`;
    }
    out.push(rest);
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("facts-judge-batches.ts")) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
  const run = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  if (!run) throw new Error("usage: facts-judge-batches.ts <run-name> [--set dev|holdout|all] [--budget n]");
  const set = flag("--set") ?? "dev";
  const budget = Number(flag("--budget") ?? 140_000);
  const runDir = path.join("_shopify/corpus/runs", run);
  const outDir = path.join("_shopify/corpus/batches", `${run}-facts`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const verdicts = loadVerdicts();

  const batches: { text: string[]; index: Record<string, any> }[][] = [[]];
  let size = 0;
  let pairs = 0;
  let n = 0;
  for (const f of fs.readdirSync(runDir).filter((f) => f.endsWith(".json")).sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(runDir, f), "utf8"));
    if (set !== "all" && r.set !== set) continue;
    for (const p of r.products) {
      const facts = (p.facts as { k: string; v: string }[])
        .map((x) => ({ ...x, id: factId(r.store, p.id, x.k, x.v) }))
        .filter((x) => !verdicts.has(x.id));
      if (facts.length === 0) continue;
      n++;
      const t: string[] = [`### Product ${n}: ${p.title}`, `Store: ${r.store} (${r.set}), product id: ${p.id}`];
      t.push("Description, as the engine reads it (\"## \" marks a heading; long lines continue indented):");
      t.push(...wrap(p.outline || "(empty)").map((l) => `> ${l}`));
      t.push("Judge these pairs, as the product page shows them:");
      const index: Record<string, any> = {};
      for (const x of facts) {
        t.push(...wrap(`- id ${x.id} ${x.k}: ${x.v}`));
        index[x.id] = { store: r.store, set: r.set, product: p.id, title: p.title, q: x.k, a: x.v, source: "fact", intent: null };
      }
      t.push("");
      const cost = t.join("\n").length;
      if (size + cost > budget && batches[batches.length - 1].length > 0) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1].push({ text: t, index });
      size += cost;
      pairs += facts.length;
    }
  }
  const real = batches.filter((b) => b.length > 0);
  real.forEach((b, i) => {
    const name = `b${String(i + 1).padStart(3, "0")}`;
    const ids = b.reduce((s, e) => s + Object.keys(e.index).length, 0);
    fs.writeFileSync(
      path.join(outDir, `${name}.md`),
      [`# Facts judge batch ${run}/${name}: ${b.length} products, ${ids} pairs`, "", ...b.flatMap((e) => e.text)].join("\n"),
    );
    fs.writeFileSync(path.join(outDir, `${name}.index.json`), JSON.stringify(Object.assign({}, ...b.map((e) => e.index))));
  });
  console.log(`${real.length} batches, ${pairs} fact pairs to judge`);
}
