// Builds the FAQ corpus: one read of a store's public /products.json.
//
// Usage (from F:\ai-visibility-shopify):
//   npx tsx scripts/corpus-fetch.ts <domain> [<domain> ...] [--out _shopify/corpus/stores]
//
// Rules, from CC-PROMPT-AI-READABILITY-3 item 1:
// - only the public /products.json endpoint, read only;
// - robots.txt is read first and honoured: a store whose robots.txt disallows
//   /products.json for every user agent (the "*" group) is skipped and says so;
// - polite: one request per second across the whole run;
// - at most 250 products per store, which is exactly one page (limit=250), so
//   no store is paginated past its first page.
//
// Writes <out>/<domain>.json as { domain, fetchedAt, robots, products } and
// prints one line per store. Nothing else is written, nothing is sent.
import fs from "node:fs";
import path from "node:path";

const UA = "MRDigital-AIVisibility-corpus/1.0 (+https://mrdigital.ro; read-only research, 1 req/s)";
const MAX_PRODUCTS = 250;
const GAP_MS = 1000;

let last = 0;
async function politeGet(url: string): Promise<Response> {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  return fetch(url, { headers: { "User-Agent": UA, Accept: "application/json,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
}

type Rule = { allow: boolean; pattern: string };

/** The rules of the "*" group (or of a group naming our agent), per RFC 9309:
 * the longest matching pattern wins, Allow wins a tie. */
export function robotsRules(txt: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (key === "allow" || key === "disallow") {
        if (key === "disallow" && value === "") continue;
        current.rules.push({ allow: key === "allow", pattern: value });
      }
    }
  }
  const ours = groups.filter((g) => g.agents.some((a) => a !== "*" && UA.toLowerCase().includes(a)));
  const chosen = ours.length > 0 ? ours : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

function patternMatches(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(target);
}

export function robotsAllows(rules: Rule[], target: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!patternMatches(r.pattern, target)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

async function fetchStore(domain: string, outDir: string): Promise<string> {
  const target = `/products.json?limit=${MAX_PRODUCTS}`;
  let robots = "none";
  try {
    const r = await politeGet(`https://${domain}/robots.txt`);
    if (r.ok) {
      const rules = robotsRules(await r.text());
      if (!robotsAllows(rules, target)) return `${domain}\tSKIPPED\trobots.txt disallows ${target}`;
      robots = "allows";
    } else robots = `status ${r.status}`;
  } catch (e) {
    robots = `unreadable (${(e as Error).message})`;
  }
  const res = await politeGet(`https://${domain}${target}`);
  if (!res.ok) return `${domain}\tFAILED\tstatus ${res.status}`;
  const body = (await res.json()) as { products?: unknown[] };
  if (!Array.isArray(body.products)) return `${domain}\tFAILED\tno products array`;
  const products = body.products.slice(0, MAX_PRODUCTS);
  fs.writeFileSync(
    path.join(outDir, `${domain}.json`),
    JSON.stringify({ domain, fetchedAt: new Date().toISOString(), robots, products }),
  );
  return `${domain}\tOK\t${products.length} products\trobots ${robots}`;
}

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx === -1 ? "_shopify/corpus/stores" : args[outIdx + 1];
const domains = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--out"));
fs.mkdirSync(outDir, { recursive: true });
for (const d of domains) {
  try {
    console.log(await fetchStore(d, outDir));
  } catch (e) {
    console.log(`${d}\tFAILED\t${(e as Error).message}`);
  }
}
