// llms.txt and agents.md (EXPERIENCE-PRD §8).
//
// Both served through the app proxy, generated per request from tables we
// already maintain - MirrorCache and the Business setting - never written to
// a file on a schedule. That is a real differentiator: every competitor
// checked for BATTLECARDS.md generates llms.txt as a static file on a timer
// or a button.
//
// Content: shop name and storefront URL, the commercial facts from the
// Business screen where filled, and an index of every processed product
// (title and its mirror URL).
//
// agents.md carries the same information as llms.txt. The community
// conventions for both describe a plain-text index for a language model or
// agent to read; neither publishes a divergent structure for the two
// filenames, and nothing in this app's own data changes between them, so one
// renderer backs both paths rather than inventing a difference that does not
// exist.
//
// This route must never call the Admin API on the request path (PRD §5.2,
// ARCHITECTURE §3), so the shop name and each product's title and URL are
// read from MirrorCache.body, which already carries them in its front matter
// and its Store section - not fetched fresh from Shopify.

import db from "../db.server";
import type { BusinessInfo } from "../engine";
import { warrantyWithUnit } from "../engine";
import { cleanOutput } from "../engine/normalize";
import { businessFor } from "./business.server";

export type LlmsTxtProduct = { title: string; url: string };

export type LlmsTxtInput = {
  shopName: string;
  storeUrl: string;
  business?: BusinessInfo | null;
  products: LlmsTxtProduct[];
};

export function renderLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [];

  lines.push(`# ${cleanOutput(input.shopName)}`);
  lines.push("");
  lines.push(input.storeUrl);
  lines.push("");

  const b = input.business;
  if (b) {
    const rows: string[] = [];
    if (b.deliveryVaries) {
      rows.push("- Delivery: varies by product, stated on each product page");
    } else if (b.deliveryTime) {
      rows.push(`- Delivery: ${cleanOutput(b.deliveryTime)}`);
    }
    if (b.deliveryCost) {
      const cost = cleanOutput(b.deliveryCost);
      rows.push(`- Delivery cost: ${b.deliveryCostIsFrom ? `from ${cost}` : cost}`);
    }
    if (b.returnDays) rows.push(`- Returns: ${b.returnDays} days`);
    if (b.warranty) rows.push(`- Warranty: ${cleanOutput(warrantyWithUnit(b.warranty))}`);
    if (b.paymentMethods) rows.push(`- Payment: ${cleanOutput(b.paymentMethods)}`);

    if (rows.length > 0) {
      lines.push("## Buying it");
      lines.push("");
      lines.push(...rows);
      lines.push("");
    }
  }

  lines.push("## Products");
  lines.push("");
  if (input.products.length > 0) {
    for (const p of input.products) {
      lines.push(`- [${cleanOutput(p.title)}](${p.url})`);
    }
  } else {
    lines.push("Nothing processed yet.");
  }
  lines.push("");

  return lines.join("\n");
}

/** First non-empty title on a `title: "..."` front matter line. Front matter
 * values are written by yamlEscape() in mirror.server.ts, which only escapes
 * double quotes, so unescaping is the exact inverse. */
function frontMatterField(body: string, field: string): string | null {
  const match = body.match(new RegExp(`^${field}: "((?:[^"\\\\]|\\\\.)*)"$`, "m"));
  if (!match) return null;
  return match[1].replace(/\\"/g, '"');
}

/** The shop name published in the mirror's own "## Store" section, if any
 * mirror carries one. Not always present - store info depends on what was
 * available when the mirror was last rendered - so this is a best-effort
 * read, never a second Admin API call. */
function storeNameFromBody(body: string): string | null {
  const idx = body.indexOf("## Store");
  if (idx === -1) return null;
  const line = body
    .slice(idx + "## Store".length)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (!line || line.startsWith("http")) return null;
  return line;
}

function fallbackShopName(domain: string): string {
  return domain.replace(/\.myshopify\.com$/, "");
}

/**
 * Assembles the content from indexed reads only - no Admin API call on the
 * request path. Two queries, both on their own index (Setting and
 * MirrorCache are each keyed by shopId), run concurrently.
 */
export async function llmsTxtBody(shopId: string, shopDomain: string): Promise<string> {
  const [business, mirrors] = await Promise.all([
    businessFor(shopId),
    db.mirrorCache.findMany({
      where: { shopId },
      select: { body: true },
      orderBy: { handle: "asc" },
    }),
  ]);

  const products: LlmsTxtProduct[] = [];
  let shopName: string | null = null;
  for (const m of mirrors) {
    const title = frontMatterField(m.body, "title");
    const url = frontMatterField(m.body, "url");
    if (title && url) products.push({ title, url });
    if (!shopName) shopName = storeNameFromBody(m.body);
  }

  return renderLlmsTxt({
    shopName: shopName ?? fallbackShopName(shopDomain),
    storeUrl: `https://${shopDomain}`,
    business,
    products,
  });
}
