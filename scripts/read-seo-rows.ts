// Read-only. What source B actually wrote into the `SeoScan` rows it scanned,
// field by field, so a run's summary can be checked against the rows rather
// than reasoned about.
//
// Written 4 September 2026 to answer two questions about a run on the dev
// store that reported 5 pages fetched, 0 behind the password form and no
// finding on any of them:
//
//   1. Is the storefront unlock working, or is something answering 200 that is
//      not the product page? Read from `status`, `canonical`, the node types
//      and `appBlock`.
//   2. Why did B1 raise nothing on five pages, when Diagnostics says this theme
//      emits no Product node? Read from `nodes` and the stored `findings`, and
//      by recomputing what `readingOf` would have counted.
//
// It writes nothing: no metafield, no row, no Setting, and it makes no Shopify
// request at all - every value here was already written by the pass.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-seo-rows.ts <shop-domain> [--limit N]
//
// Without a domain it picks the single installed shop and refuses to guess when
// there is more than one, like the other read-only scripts.
//
// **It prints no product text.** No title, no description, no meta field, no
// finding detail prose. Handles and slugs are masked: a canonical URL is
// reported as its shape (`/products/<handle>`, `/collections/<slug>/products/
// <handle>`) plus whether it matches this row's own handle, which is what the
// question is, and the numeric product id is printed so a row can be found in
// the admin without its text being here. Same rule as
// scripts/seo-fields-census.ts, for the same reason.

import db from "../app/db.server";
import { describeGraphqlError } from "../app/services/graphql-errors";
import { isOurNode } from "../app/services/conflicts";
import { canonicalNodeId } from "../app/services/theme-scan.server";
import { findingsOf } from "../app/services/seo-findings";
import {
  themeNodeAdvice,
  themeNodeAggregate,
  themeNodeSentence,
} from "../app/services/seo-aggregate";

/** Path segments that are Shopify's own vocabulary and carry no product text. */
const KNOWN_SEGMENTS = new Set([
  "products",
  "collections",
  "all",
  "pages",
  "blogs",
  "cart",
  "search",
  "",
]);

/**
 * A URL reduced to its shape. Every segment that is not Shopify's own
 * vocabulary becomes `<handle>` or `<slug>`, and the query keeps its keys and
 * drops its values, so "the canonical points at a collection-prefixed URL with
 * a ?variant" is legible without a catalogue appearing in a terminal.
 */
function shapeOf(url: string | null, ownHandle: string | null): string {
  if (!url) return "(none)";
  let parsed: URL;
  try {
    parsed = new URL(url, "https://shape.invalid");
  } catch {
    return "(unparseable)";
  }
  const segments = parsed.pathname.split("/").map((segment, index, all) => {
    if (KNOWN_SEGMENTS.has(segment)) return segment;
    const previous = all[index - 1];
    if (previous === "products") return "<handle>";
    return "<slug>";
  });
  const keys = [...parsed.searchParams.keys()];
  const query = keys.length > 0 ? `?${keys.map((k) => `${k}=...`).join("&")}` : "";
  const host = parsed.host === "shape.invalid" ? "" : `${parsed.protocol}//${parsed.host}`;
  const path = segments.join("/") + query;
  const matches =
    ownHandle && parsed.pathname.endsWith(`/products/${ownHandle}`) ? " [own handle]" : "";
  return `${host}${path}${matches}`;
}

type NodeLike = { types?: unknown; id?: unknown; hasAggregateRating?: unknown };

/** What `readingOf` would have counted from these stored nodes, recomputed. */
function recount(nodes: unknown, canonical: string | null) {
  const list = Array.isArray(nodes) ? (nodes as NodeLike[]) : [];
  const products = list.filter(
    (n) => Array.isArray(n?.types) && n.types.map(String).includes("Product"),
  );
  const ids = new Set<string>();
  let idless = 0;
  let ours = 0;
  let theirs = 0;
  for (const node of products) {
    const id = typeof node?.id === "string" ? node.id : "";
    if (isOurNode(node as { ours?: boolean })) ours += 1;
    else theirs += 1;
    const resolved = canonicalNodeId(id, canonical ?? undefined);
    if (resolved === null) idless += 1;
    else ids.add(resolved);
  }
  return { total: list.length, products: products.length, ours, theirs, distinct: ids.size + idless };
}

function parseArgs(argv: string[]): { domain?: string; limit: number } {
  let domain: string | undefined;
  let limit = 5;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit" || arg.startsWith("--limit=")) {
      const raw = arg.includes("=") ? arg.slice("--limit=".length) : argv[++i];
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`read-seo-rows: --limit needs a positive number, got "${raw ?? ""}".`);
      }
      limit = Math.floor(value);
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`read-seo-rows: unknown option "${arg}".`);
    domain = arg;
  }
  return { domain, limit };
}

async function main() {
  const { domain: wanted, limit } = parseArgs(process.argv.slice(2));

  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });
  const shop = wanted
    ? shops.find((s: { domain: string }) => s.domain === wanted)
    : shops.length === 1
      ? shops[0]
      : null;
  if (!shop) {
    console.log(
      wanted
        ? `No installed shop with domain ${wanted}.`
        : `Expected one installed shop, found ${shops.length}. Pass the domain as an argument.`,
    );
    await db.$disconnect();
    return;
  }

  console.log(`READ ONLY: no Shopify request, no write. Shop: ${shop.domain}`);

  const total = await db.seoScan.count({ where: { shopId: shop.id } });
  const scanned = await db.seoScan.count({
    where: { shopId: shop.id, scannedAt: { not: null } },
  });
  console.log(`Rows for this shop: ${total}; with a page read: ${scanned}`);

  const byStatus = await db.seoScan.groupBy({
    by: ["status"],
    where: { shopId: shop.id },
    _count: { _all: true },
  });
  console.log("Status across every row:");
  for (const group of byStatus) {
    console.log(`  ${String(group.status ?? "(never read)").padEnd(14)} ${group._count._all}`);
  }

  const rows = await db.seoScan.findMany({
    where: { shopId: shop.id, scannedAt: { not: null } },
    orderBy: { scannedAt: "desc" },
    take: limit,
    select: {
      productId: true,
      handle: true,
      scannedAt: true,
      status: true,
      canonical: true,
      noindex: true,
      appBlock: true,
      cacheControl: true,
      nodes: true,
      findings: true,
      bulkAt: true,
    },
  });

  console.log("");
  console.log(`The ${rows.length} most recently scanned rows:`);

  for (const [index, row] of rows.entries()) {
    const numericId = String(row.productId).split("/").pop();
    const counts = recount(row.nodes, row.canonical);
    const list = Array.isArray(row.nodes) ? (row.nodes as NodeLike[]) : [];

    console.log("");
    console.log(`#${index + 1}  product ${numericId}`);
    console.log(`  status            ${row.status ?? "(null)"}`);
    console.log(`  scannedAt         ${row.scannedAt?.toISOString() ?? "(null)"}`);
    console.log(`  bulkAt            ${row.bulkAt?.toISOString() ?? "(null)"}`);
    console.log(`  canonical         ${shapeOf(row.canonical, row.handle)}`);
    console.log(`  noindex           ${row.noindex === null ? "(null)" : String(row.noindex)}`);
    console.log(`  appBlock          ${row.appBlock ?? "(null)"}`);
    console.log(`  cacheControl      ${row.cacheControl ?? "(null)"}`);
    console.log(
      `  nodes             ${counts.total} total, ${counts.products} Product ` +
        `(${counts.ours} ours, ${counts.theirs} theirs, ${counts.distinct} distinct by @id)`,
    );

    if (list.length === 0) {
      console.log("  node types        (none stored)");
    } else {
      for (const node of list) {
        const types = Array.isArray(node?.types) ? node.types.map(String).join("+") : "(no types)";
        const id = typeof node?.id === "string" ? node.id : "";
        const whose = isOurNode(node as { ours?: boolean })
          ? "ours (marker)"
          : id === ""
            ? "theirs, no @id"
            : "theirs";
        const rating = node?.hasAggregateRating === true ? ", hasAggregateRating" : "";
        // The @id itself, shape only. Which nodes share an id is the whole
        // question when two of them merge. Ownership is read from our emitter
        // marker, never from the suffix.
        const shape = id === "" ? "" : `  id=${shapeOf(id, row.handle)}`;
        console.log(`  node              ${types} (${whose}${rating})${shape}`);
      }
    }

    // Codes and sources only. A finding's detail can carry handles and URLs, so
    // only B1's node count is printed from it - the one number question 2 needs.
    const findings = findingsOf(row.findings);
    if (findings.length === 0) {
      console.log("  findings          (none)");
    } else {
      for (const finding of findings) {
        const extra =
          finding.code === "B1"
            ? ` productNodes=${String((finding.detail as any)?.productNodes ?? "?")}`
            : "";
        console.log(`  finding           ${finding.code} (source ${finding.source})${extra}`);
      }
    }
  }

  // The aggregate itself, from these rows, because a recommendation on a
  // merchant screen must be read out of the data and not reasoned about.
  const all = await db.seoScan.findMany({
    where: { shopId: shop.id },
    select: {
      productId: true,
      handle: true,
      bulkAt: true,
      scannedAt: true,
      status: true,
      findings: true,
      nodes: true,
    },
  });
  const nodesAgg = themeNodeAggregate(all as any);
  console.log("");
  console.log("The Structured data card, computed from these rows:");
  console.log(`  pages the verdict rests on   ${nodesAgg.pagesRead}`);
  console.log(`  pages with a THEME node      ${nodesAgg.theme}`);
  console.log(`  pages with no Product node   ${nodesAgg.none}`);
  console.log(`  pages with two or more       ${nodesAgg.two}`);
  console.log(`  pages where only ours        ${nodesAgg.appOnly}`);
  console.log(`  verdict                      ${nodesAgg.verdict}`);
  console.log("");
  console.log(`  sentence: ${themeNodeSentence(nodesAgg)}`);
  console.log(`  advice:   ${themeNodeAdvice(nodesAgg)}`);

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(describeGraphqlError(error, "read-seo-rows"));
  await db.$disconnect();
  process.exit(1);
});
