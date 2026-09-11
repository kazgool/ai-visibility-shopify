// Joins a judge's verdicts to what was judged (CC-PROMPT-AI-READABILITY-3 item 5).
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/faq-judge-merge.ts <run-name>
//
// For every batch of the run that has a raw verdict file
// (_shopify/corpus/batches/<run>/<batch>.verdicts.json, written by a judge:
// [{ id, verdict: "ok" | "error", rule, reason }]), writes the logged form
// the brief asks for to _shopify/corpus/verdicts/<run>-<batch>.json:
// { id, store, set, product, title, q, a, source, verdict, rule, reason }.
// Refuses a batch whose verdicts miss an id or name one it did not contain,
// so a judge that skipped something is caught, not averaged away.
import fs from "node:fs";
import path from "node:path";
import { VERDICT_DIR } from "./faq-judge-batches";

const run = process.argv[2];
if (!run) throw new Error("usage: faq-judge-merge.ts <run-name>");
const dir = path.join("_shopify/corpus/batches", run);
fs.mkdirSync(VERDICT_DIR, { recursive: true });
let merged = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".index.json")).sort()) {
  const name = f.replace(".index.json", "");
  const rawFile = path.join(dir, `${name}.verdicts.json`);
  if (!fs.existsSync(rawFile)) { console.log(`${name}: no verdicts yet`); continue; }
  const index = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const raw: any[] = JSON.parse(fs.readFileSync(rawFile, "utf8"));
  const given = new Map(raw.map((v) => [v.id, v]));
  const missing = Object.keys(index).filter((id) => !given.has(id));
  const unknown = raw.filter((v) => !(v.id in index)).map((v) => v.id);
  const bad = raw.filter((v) => v.verdict !== "ok" && v.verdict !== "error").map((v) => v.id);
  if (missing.length || unknown.length || bad.length) {
    console.log(`${name}: REFUSED - missing ${missing.length}, unknown ${unknown.length}, bad verdict ${bad.length}`);
    continue;
  }
  const out = Object.entries(index).map(([id, meta]: [string, any]) => {
    const v = given.get(id);
    return { id, ...meta, verdict: v.verdict, rule: v.verdict === "error" ? v.rule ?? null : null, reason: v.reason ?? "" };
  });
  fs.writeFileSync(path.join(VERDICT_DIR, `${run}-${name}.json`), JSON.stringify(out, null, 1));
  merged++;
  const errors = out.filter((v) => v.verdict === "error").length;
  console.log(`${name}: ${out.length} verdicts, ${errors} errors`);
}
console.log(`${merged} batches merged`);
