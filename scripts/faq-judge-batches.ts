// Cuts a corpus run into judge batches (CC-PROMPT-AI-READABILITY-3 item 5).
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/faq-judge-batches.ts <run-name> [--set dev|holdout|all] [--budget 140000]
//
// Reads _shopify/corpus/runs/<run>/*.json and every verdict already given
// (_shopify/corpus/verdicts/*.json), and writes, in
// _shopify/corpus/batches/<run>/, for each batch:
//   b001.md          what the judge reads: one section per product, lines
//                    wrapped so a file reader never truncates one;
//   b001.index.json  every id in it with store, product, question, answer and
//                    source, which scripts/faq-judge-merge.ts joins the
//                    judge's verdicts to.
// Only what has no verdict yet is batched: a Q&A is identified by store,
// product, question and answer, so an unchanged Q&A is never judged twice.
//
// Each product carries what rubric rules 1 to 7 need: title, facts, options,
// vendor, the business record, every Q&A with its source, and the description
// as the engine reads it. The description is left out only when no answer
// comes from it AND it has none of the warning vocabulary below: then it can
// serve no rule. Rules 1 to 5 and 7 are judged on the data the answer came
// from, and rule 6 needs a warning to exist.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalize } from "../app/engine/normalize";

export const WARNING_WORDS = [
  // English
  "warning", "caution", "precaution", "safety", "danger", "hazard", "choking", "keep out of reach",
  "not suitable", "do not", "allerg", "contraindic", "consult", "pregnan", "children",
  // Romanian, without diacritics
  "atentie", "atentionar", "avertis", "precaut", "pericol", "a nu se", "nu se recomanda",
  "alerg", "sufoc", "copii", "insarcinat", "contraindica",
];

export function itemId(store: string, product: string, q: string, a: string): string {
  return crypto.createHash("sha1").update(`${store}|${product}|${q}|${a}`).digest("hex").slice(0, 16);
}

export function safetyId(store: string, product: string, outline: string, hasSafety: boolean): string {
  return crypto.createHash("sha1").update(`${store}|${product}|rule6|${hasSafety}|${outline}`).digest("hex").slice(0, 16);
}

export const VERDICT_DIR = "_shopify/corpus/verdicts";

/**
 * Every verdict given, by id; a later file's verdict for the same id wins.
 * A duplicate-question error (rubric rule 7) is not kept: it depends on the
 * product's other questions, and the one it duplicated may be gone since, so
 * it is judged again. An "ok" stays: a new duplicate is judged as the second
 * of the two and caught on its own. The report passes `keepDuplicates`: it
 * counts the latest verdict as given, duplicate errors included.
 *
 * Files are read in run order with numbers compared as numbers, so dev10 is
 * read after dev9 (a plain sort put it before dev4, and an old verdict then
 * overrode a newer one).
 */
export function loadVerdicts(keepDuplicates = false): Map<string, any> {
  const out = new Map<string, any>();
  if (!fs.existsSync(VERDICT_DIR)) return out;
  const files = fs.readdirSync(VERDICT_DIR).filter((f) => f.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  for (const f of files) {
    for (const v of JSON.parse(fs.readFileSync(path.join(VERDICT_DIR, f), "utf8"))) {
      if (!keepDuplicates && v.verdict === "error" && v.rule === 7 && v.source !== "fact") {
        out.delete(v.id);
        continue;
      }
      out.set(v.id, v);
    }
  }
  return out;
}

export function hasWarningWords(outline: string): boolean {
  const text = ` ${normalize(outline)} `;
  return WARNING_WORDS.some((w) => text.includes(normalize(w)));
}

const FROM_DESCRIPTION = new Set(["section", "merchant", "mapping"]);

/** Lines of at most `width` characters, broken at a space. */
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

if (process.argv[1] && process.argv[1].endsWith("faq-judge-batches.ts")) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
  const run = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  if (!run) throw new Error("usage: faq-judge-batches.ts <run-name> [--set dev|holdout|all] [--budget n]");
  const set = flag("--set") ?? "dev";
  const budget = Number(flag("--budget") ?? 140_000);
  const runDir = path.join("_shopify/corpus/runs", run);
  const outDir = path.join("_shopify/corpus/batches", run);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const verdicts = loadVerdicts();

  type Entry = { text: string[]; index: Record<string, any> };
  const batches: Entry[][] = [[]];
  let size = 0;
  let items = 0;
  let checks = 0;
  let n = 0;
  for (const f of fs.readdirSync(runDir).filter((f) => f.endsWith(".json")).sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(runDir, f), "utf8"));
    if (set !== "all" && r.set !== set) continue;
    for (const p of r.products) {
      const hasSafety = p.faq.some((x: any) => x.intent === "safety");
      const warn = hasWarningWords(p.outline);
      const sid = safetyId(r.store, p.id, p.outline, hasSafety);
      const faq = p.faq
        .map((x: any) => ({ ...x, id: itemId(r.store, p.id, x.q, x.a) }))
        .filter((x: any) => !verdicts.has(x.id));
      const checkSafety = warn && !hasSafety && !verdicts.has(sid);
      if (faq.length === 0 && !checkSafety) continue;
      const withText = checkSafety || warn || faq.some((x: any) => FROM_DESCRIPTION.has(x.source));
      n++;
      const t: string[] = [];
      t.push(`### Product ${n}: ${p.title}`);
      t.push(`Store: ${r.store} (${r.set}), content language: ${r.language}, product id: ${p.id}`);
      t.push(`Vendor: ${p.vendor || "-"}; product type: ${p.productType || "-"}`);
      t.push(`Options: ${p.options.length ? p.options.map((o: any) => `${o.name}: ${o.values.join(", ")}`).join("; ") : "-"}`);
      t.push(...wrap(`Facts: ${p.facts.length ? p.facts.map((x: any) => `${x.k}: ${x.v}`).join("; ") : "-"}`));
      if (r.business) t.push(...wrap(`Business record: ${JSON.stringify(r.business)}`));
      t.push(`All questions this product has: ${p.faq.length ? p.faq.map((x: any, i: number) => `(${i + 1}) ${x.q}`).join(" ") : "none"}`);
      if (withText) {
        t.push("Description, as the engine reads it (\"## \" marks a heading; long lines continue indented):");
        t.push(...wrap(p.outline || "(empty)").map((l) => `> ${l}`));
      } else {
        t.push("Description: not included - no answer comes from it and it has no warning vocabulary.");
      }
      const index: Record<string, any> = {};
      if (faq.length) t.push("Judge these:");
      for (const x of faq) {
        t.push(...wrap(`- id ${x.id} [source: ${x.source}${x.intent ? `, intent: ${x.intent}` : ""}] Q: ${x.q} || A: ${x.a}`));
        index[x.id] = { store: r.store, set: r.set, product: p.id, title: p.title, q: x.q, a: x.a, source: x.source, intent: x.intent ?? null };
      }
      if (checkSafety) {
        t.push(`- id ${sid} [rule 6 check] Does the description have a safety or warning section? The product has no safety question.`);
        index[sid] = { store: r.store, set: r.set, product: p.id, title: p.title, q: "(missing safety question)", a: "", source: "rule6", intent: null };
      }
      t.push("");
      const cost = t.join("\n").length;
      if (size + cost > budget && batches[batches.length - 1].length > 0) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1].push({ text: t, index });
      size += cost;
      items += faq.length;
      if (checkSafety) checks++;
    }
  }
  const real = batches.filter((b) => b.length > 0);
  real.forEach((b, i) => {
    const name = `b${String(i + 1).padStart(3, "0")}`;
    const ids = b.reduce((s, e) => s + Object.keys(e.index).length, 0);
    fs.writeFileSync(
      path.join(outDir, `${name}.md`),
      [`# Judge batch ${run}/${name}: ${b.length} products, ${ids} ids`, "", ...b.flatMap((e) => e.text)].join("\n"),
    );
    fs.writeFileSync(path.join(outDir, `${name}.index.json`), JSON.stringify(Object.assign({}, ...b.map((e) => e.index))));
  });
  console.log(`${real.length} batches, ${items} Q&A to judge, ${checks} safety checks, ${verdicts.size} verdicts already given`);
}
