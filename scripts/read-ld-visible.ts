// Read only. Does the structured data this app puts on a product page describe
// only what the page shows? (PRD-AI-READABILITY P0.3, acceptance.)
//
// For one shop: fetch N product pages exactly as the nightly page read does
// (readProductPage, with the storefront unlocked once by storefrontCookie),
// take every JSON-LD node that carries this app's marker, collect every string
// value in it, and report each one that is absent from the page's visible
// text. Google's policy is "Don't mark up content that is not visible to
// readers of the page"
// (https://developers.google.com/search/docs/appearance/structured-data/sd-policies);
// this is that sentence, measured.
//
// Writes nothing: no row, no Setting, no metafield, no Admin call, and it does
// not spend the shop's daily page budget.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-ld-visible.ts <shop-domain> [N]
//
// N defaults to 20. Handles come from the storefront's product sitemap, the
// same file the nightly pass reads, in sitemap order.
//
// What counts as visible: the <body> with <script>, <style>, <noscript> and
// <template> removed, tags stripped, entities decoded, whitespace collapsed.
// What is compared: string values only, never keys. Structural values - the
// @context, @type and @id, the marker itself - are skipped, and so is any
// value that is a URL, because a URL is an address the page links to rather
// than text a reader sees; those are counted and printed separately so the
// denominator states what was and was not compared. A value that Liquid's
// truncate filter cut ends in "..."; it is compared without those three dots.

import db from "../app/db.server";
import { fetchSitemap, readProductPage } from "../app/services/seo-page.server";
import { extractLdObjects, OUR_NODE_MARKER, storefrontCookie } from "../app/services/theme-scan.server";

const STRUCTURAL_KEYS = new Set(["@context", "@type", "@id", OUR_NODE_MARKER]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** The page's visible text: body only, non-rendered elements removed. */
export function visibleText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const stripped = body
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return collapse(decodeEntities(stripped));
}

type StringValue = { path: string; value: string };

/** Every string value in a node, with the key path it sits at. */
function stringsOf(value: unknown, path: string, out: StringValue[]): void {
  if (typeof value === "string") {
    out.push({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => stringsOf(item, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (STRUCTURAL_KEYS.has(key)) continue;
      stringsOf(child, path ? `${path}.${key}` : key, out);
    }
  }
}

const isUrl = (value: string) => /^(https?:)?\/\//i.test(value.trim());

type Miss = { handle: string; type: string; path: string; value: string };

async function main() {
  const domain = process.argv[2];
  const limit = Number(process.argv[3] ?? 20);
  if (!domain || !Number.isFinite(limit) || limit < 1) {
    console.error("read-ld-visible: npx tsx scripts/read-ld-visible.ts <shop-domain> [N]");
    process.exit(1);
  }

  const shop = await db.shop.findFirst({ where: { domain, uninstalledAt: null } });
  if (!shop) {
    console.log(`No installed shop with domain ${domain}.`);
    return;
  }
  const passwordRow = await db.setting.findUnique({
    where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
  });

  // The myshopify address redirects to the primary domain; readProductPage
  // follows the chain by hand, so each page is read where a crawler lands.
  const origin = `https://${shop.domain}`;
  const cookie = passwordRow?.value ? await storefrontCookie(origin, passwordRow.value) : null;

  console.log(`READ ONLY: our JSON-LD against the visible text, ${shop.domain}`);
  console.log(`Storefront password: ${passwordRow?.value ? (cookie ? "unlocked" : "refused") : "none saved"}`);

  const sitemap = await fetchSitemap(origin, fetch, { cookie });
  if (!sitemap.read) {
    console.log(`No product sitemap: ${sitemap.error}. Nothing to read.`);
    return;
  }
  const handles = [...sitemap.read.handles].slice(0, limit);
  console.log(`Sitemap: ${sitemap.read.urls} product URLs, reading ${handles.length}.\n`);

  let pagesRead = 0;
  let pagesWithOurNodes = 0;
  let nodes = 0;
  let compared = 0;
  let found = 0;
  let urlsSkipped = 0;
  const misses: Miss[] = [];
  const unreadable: string[] = [];

  for (const handle of handles) {
    const page = await readProductPage(`${origin}/products/${handle}`, cookie);
    if (page.error || page.status !== 200 || page.passwordProtected) {
      unreadable.push(`${handle} (${page.error ?? (page.passwordProtected ? "password page" : page.status)})`);
      continue;
    }
    pagesRead += 1;
    const text = visibleText(page.html);
    const ours = extractLdObjects(page.html).filter((n) => n && n[OUR_NODE_MARKER] !== undefined);
    if (ours.length > 0) pagesWithOurNodes += 1;

    for (const node of ours) {
      nodes += 1;
      const type = Array.isArray(node["@type"]) ? node["@type"].join("/") : String(node["@type"] ?? "?");
      const values: StringValue[] = [];
      stringsOf(node, "", values);
      for (const { path, value } of values) {
        if (isUrl(value)) {
          urlsSkipped += 1;
          continue;
        }
        let wanted = collapse(decodeEntities(value));
        if (wanted.endsWith("...")) wanted = wanted.slice(0, -3).trimEnd();
        if (wanted === "") continue;
        compared += 1;
        if (text.includes(wanted)) found += 1;
        else misses.push({ handle, type, path, value: wanted });
      }
    }
  }

  const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((n / d) * 100)}%`);
  console.log(`  pages read                   ${pagesRead} of ${handles.length}`);
  console.log(`  pages carrying our nodes     ${pagesWithOurNodes} of ${pagesRead}`);
  console.log(`  our nodes                    ${nodes}`);
  console.log(`  string values compared       ${compared}`);
  console.log(`  found in the visible text    ${found} of ${compared} (${pct(found, compared)})`);
  console.log(`  missing from it              ${misses.length} of ${compared} (${pct(misses.length, compared)})`);
  console.log(`  URL values, not compared     ${urlsSkipped}`);
  if (unreadable.length > 0) {
    console.log(`\n  could not read ${unreadable.length}: ${unreadable.slice(0, 10).join(", ")}`);
  }

  if (misses.length > 0) {
    console.log(`\n  first ${Math.min(20, misses.length)} misses (handle, node, key, value):`);
    for (const m of misses.slice(0, 20)) {
      const shown = m.value.length > 80 ? `${m.value.slice(0, 77)}...` : m.value;
      console.log(`    ${m.handle}  ${m.type}  ${m.path}  "${shown}"`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
