// Batch 5 item 5: classify before fixing.
//
// Every facts error the judge has recorded, grouped into classes with counts
// and denominators. The classes are not written from memory: each one is
// matched on the words the judge itself used in its reason, and the vocabulary
// was read off the corpus first (the commonest tokens in 4,091 error reasons
// are "from", "torn", "fragment", "bare", "nothing saying", "comes from",
// "boilerplate"). A class that matched nothing would be a class that does not
// exist in this corpus, and is reported as zero rather than removed.
//
// Read only. It parses _shopify/corpus/verdicts/*.json and prints a table.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/facts-error-classes.ts              (every set)
//   npx tsx scripts/facts-error-classes.ts --set holdout
//   npx tsx scripts/facts-error-classes.ts --store republicabio.ro
//   npx tsx scripts/facts-error-classes.ts --show neighbour   (50 examples)

import fs from "node:fs";
import path from "node:path";

type Verdict = {
  id: string;
  store: string;
  set: string;
  product: string;
  title: string;
  /** The dictionary group, for a fact row. */
  q: string;
  /** The value as the page would show it. */
  a: string;
  source: string;
  verdict: "ok" | "error";
  rule: number | null;
  reason: string;
};

/** One class, and the evidence that decides membership. Order is significant:
 *  the first class that matches owns the row, most specific first. */
type ErrorClass = {
  key: string;
  /** What went wrong, in the words this project uses about it. */
  title: string;
  /** Matched against the judge's own reason, lowercased. */
  reason: RegExp;
  /** When present, the value must also match. Narrows a broad reason. */
  value?: RegExp;
};

const CLASSES: ErrorClass[] = [
  {
    key: "merged-pack",
    title: "Several items' values merged into one",
    reason:
      /\b(merged|mixes|two lengths|both pieces|each belongs|which piece|which is which|sofa and|table and|chair dimensions|per-earbud|earbud \(|case \(|one value with|values of (both|two)|drops one dimension|a different product in the|other product's)/,
  },
  {
    key: "negation",
    title: "A negation read as an affirmation",
    reason:
      /\b(negation|states the reverse|says the opposite|is a negation|the reverse of what)\b|\bcomes from ['’"]?(zero|no |without|fara|fără)|\b(free from|zero )[a-z -]{0,24}\b(is a negation|reads as|read as|states)/,
  },
  {
    key: "bound-dropped",
    title: "A bound or an operator dropped",
    reason:
      /\bdrops ['’"]?(under|over|up to|from|at least|at most|approximately|about|min|max)\b|\b(upper (end|bound|limit)|lower bound|maximum of|minimum of|at most|at least|less than|more than|as a range|the range|'de la'|'pana la'|'până la'|drops the operator)\b|without the ['’"]?[<>]/,
  },
  {
    key: "subject-lost",
    title: "The unit's subject lost: a figure with nothing saying what it measures",
    reason:
      /\b(no indication of what it measures|nothing saying what|no way to know what it measures|bare numbers?|cut from its noun|no longer says|what each measures|gives no indication|says nothing about which|nothing states what|nothing says what is measured|stands alone with no noun|unlabelled|what it measures is lost|conflicting footprints|no unit is given|no unit at all)\b/,
  },
  {
    key: "torn-fragment",
    title: "A value cut before the words that carry its meaning",
    reason:
      /\b(torn|fragments?|cut from|cut to|cut before|is cut|meaning is lost|the capacity and meaning|so the (ingredient|meaning|value) is lost)\b/,
  },
  {
    key: "wrong-subject",
    title: "A value that is in the text, but is not what this label means",
    reason:
      /\bn(ot|either is|either are)\s+(a|an|the|its|their|his)?\s?(stated\s+)?(ingredient|size|finish|format|skin type|compatibility|material|colour|color|weight|volume|dimension|form|scent|memory|screen|battery|warranty|certification|origin|packaging|allergen|use|style|closure|concern)s?\b|\bnot (the|a|an) [a-z' ]{2,30}(format|ingredient|size|material|finish|form|colour|color)\b|\bis (a|an|the) [a-z' ]{2,45}(,| and) (it is )?not (a|an|the|its|their|[a-z])|\bthe product is (a|an) [a-z' ]{2,45}(,| and| that)|\b(scent|shade|shimmer|sparkle|glitter|colour|color|duochrome) (note|description|effect|tone|finish|flec)s?\b|\bthe product (is|has) no\b|\bonly (one|two|three|four|[0-9]+) of the [a-z]+ (pieces|items|products)\b|\bthe name of the [a-z]+ it derives from\b|\bone of the products it holds\b|\bitself is not\b|\bmis(states|describes|reads)\b|\bit is neither\b|\bnot part of this product\b|\bare features\b|\bnone of them\b/,
  },
  {
    key: "neighbour",
    title: "A value taken from a neighbouring sentence about something else",
    reason:
      /\b(comes? from|came from|is from|are from|taken from|derived from|boilerplate|instructions|feeding table|dosing|per-wash|per-serving|body weights|product's own name|collection name|a product in the|unrelated|elsewhere in the (text|description)|another sentence|a sentence about)\b/,
  },
  {
    key: "not-in-text",
    title: "A value the product's data does not state at all",
    reason:
      /\b(nothing in the text|the text never|never says|not stated anywhere|appears (derived|invented)|states no|not supported by)\b/,
  },
];

const UNCLASSIFIED = { key: "other", title: "Not matched by any class above" };

function loadAll(): Verdict[] {
  const dir = path.join("_shopify", "corpus", "verdicts");
  const out: Verdict[] = [];
  const seen = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Verdict[]) {
      if (r.source !== "fact") continue;
      // The same pair can be judged in more than one run. The id is the hash of
      // store, product, label and value, so the later run wins and the row is
      // counted once - otherwise every rate below is weighted by how often a
      // store happened to be re-judged.
      if (seen.has(r.id)) {
        out[out.findIndex((x) => x.id === r.id)] = r;
        continue;
      }
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

export function classify(v: Verdict): string {
  const reason = (v.reason ?? "").toLowerCase();
  for (const c of CLASSES) {
    if (!c.reason.test(reason)) continue;
    if (c.value && !c.value.test(v.a ?? "")) continue;
    return c.key;
  }
  return UNCLASSIFIED.key;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1];
  };
  const set = arg("set");
  const store = arg("store");
  const show = arg("show");

  let rows = loadAll();
  if (set) rows = rows.filter((r) => r.set === set);
  if (store) rows = rows.filter((r) => r.store === store);

  const errors = rows.filter((r) => r.verdict === "error");
  const scope = [set ? `set ${set}` : "every set", store ?? "every store"].join(", ");

  if (show) {
    const picked = errors.filter((r) => classify(r) === show).slice(0, 50);
    console.log(`# ${show}: ${picked.length} of ${errors.filter((r) => classify(r) === show).length} shown\n`);
    for (const r of picked) {
      console.log(`- [${r.store}] ${r.q} = ${JSON.stringify(r.a)}\n    ${r.reason}`);
    }
    return;
  }

  console.log(`# Facts errors by class - ${scope}\n`);
  console.log(`Values judged: ${rows.length}. Errors: ${errors.length} (${pct(errors.length, rows.length)}).\n`);
  console.log("| Class | Errors | Share of errors | Share of all values judged |");
  console.log("|---|---|---|---|");
  const counts = new Map<string, number>();
  for (const r of errors) counts.set(classify(r), (counts.get(classify(r)) ?? 0) + 1);
  for (const c of [...CLASSES, UNCLASSIFIED as ErrorClass]) {
    const n = counts.get(c.key) ?? 0;
    console.log(
      `| ${c.title} | ${n} | ${pct(n, errors.length)} | ${pct(n, rows.length)} |`,
    );
  }

  // Per group, so a rule can be told what it will cost where.
  console.log("\n## By dictionary group, groups with 30 or more values judged\n");
  console.log("| Group | Values judged | Errors | Error rate | Largest class |");
  console.log("|---|---|---|---|---|");
  const byGroup = new Map<string, Verdict[]>();
  for (const r of rows) byGroup.set(r.q, [...(byGroup.get(r.q) ?? []), r]);
  const ranked = [...byGroup]
    .filter(([, v]) => v.length >= 30)
    .sort((a, b) => b[1].filter((r) => r.verdict === "error").length - a[1].filter((r) => r.verdict === "error").length);
  for (const [group, all] of ranked) {
    const errs = all.filter((r) => r.verdict === "error");
    const local = new Map<string, number>();
    for (const r of errs) local.set(classify(r), (local.get(classify(r)) ?? 0) + 1);
    const top = [...local].sort((a, b) => b[1] - a[1])[0];
    const label = top ? `${CLASSES.find((c) => c.key === top[0])?.title ?? "unmatched"} (${top[1]})` : "-";
    console.log(`| ${group} | ${all.length} | ${errs.length} | ${pct(errs.length, all.length)} | ${label} |`);
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}% (${n}/${d})`;
}

main();
