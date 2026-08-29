// llms.txt and agents.md (EXPERIENCE-PRD §8).
//
// Both served through the app proxy, generated per request from tables we
// already maintain - MirrorCache and the Business setting - never written to
// a file on a schedule. That is a real differentiator: every competitor
// checked for BATTLECARDS.md generates llms.txt as a static file on a timer
// or a button.
//
// Content: shop name and storefront URL, the official profile URLs from the
// Business screen, the commercial facts from the same screen where filled,
// and an index of every processed product (title and its mirror URL).
//
// agents.md carries the same information as llms.txt. The community
// conventions for both describe a plain-text index for a language model or
// agent to read; neither publishes a divergent structure for the two
// filenames, and nothing in this app's own data changes between them, so one
// renderer backs both paths rather than inventing a difference that does not
// exist.
//
// This route must never call the Admin API on the request path (PRD §5.2,
// ARCHITECTURE §3). The shop name is read from a Setting row persisted the
// last time extraction ran (see catalogue.server.ts saveShopInfo, which
// writes the same "shopInfo" key read here), and each product's title and
// URL are read from MirrorCache.body, which already carries them in its
// front matter - neither is fetched fresh from Shopify.
//
// The read below does not import catalogue.server.ts: that module pulls in
// admin.server.ts for the bulk-export helpers, which in turn loads
// shopify.server.ts and constructs a real PrismaSessionStorage at import
// time. This route is on the request path and is unit tested directly, so it
// must not carry that weight just to read one Setting row - the key string
// is duplicated instead, the same way business.server.ts keeps its own
// private SETTING_KEY rather than sharing one.

import db from "../db.server";
import { warrantyWithUnit } from "../engine";
import { cleanOutput } from "../engine/normalize";
import type { BusinessRecord } from "./business.server";
import { businessFor } from "./business.server";
import { SOCIAL_PLATFORMS } from "./social-profiles";

const SHOP_INFO_SETTING_KEY = "shopInfo";

export type LlmsTxtProduct = { title: string; url: string };

export type LlmsTxtInput = {
  shopName: string;
  storeUrl: string;
  business?: BusinessRecord | null;
  products: LlmsTxtProduct[];
};

export function renderLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [];

  lines.push(`# ${cleanOutput(input.shopName)}`);
  lines.push("");
  lines.push(input.storeUrl);

  const profileUrls = SOCIAL_PLATFORMS.map((p) => input.business?.socialProfiles?.[p]).filter(
    (v): v is string => !!v,
  );
  for (const url of profileUrls) lines.push(url);

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

function fallbackShopName(domain: string): string {
  return domain.replace(/\.myshopify\.com$/, "");
}

/** The shop name persisted to Setting the last time extraction ran (see
 * catalogue.server.ts saveShopInfo). Null for a shop that has never run
 * extraction, so the caller falls back to the domain slug. */
async function persistedShopName(shopId: string): Promise<string | null> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SHOP_INFO_SETTING_KEY } },
  });
  if (!row?.value) return null;
  try {
    const info = JSON.parse(row.value) as { name?: string };
    return info.name || null;
  } catch {
    return null;
  }
}

/**
 * Assembles the content from indexed reads only - no Admin API call on the
 * request path. Three queries, each on its own index (Setting and
 * MirrorCache are both keyed by shopId), run concurrently.
 */
export async function llmsTxtBody(shopId: string, shopDomain: string): Promise<string> {
  const [business, mirrors, shopName] = await Promise.all([
    businessFor(shopId),
    db.mirrorCache.findMany({
      where: { shopId },
      select: { body: true },
      orderBy: { handle: "asc" },
    }),
    persistedShopName(shopId),
  ]);

  const products: LlmsTxtProduct[] = [];
  for (const m of mirrors) {
    const title = frontMatterField(m.body, "title");
    const url = frontMatterField(m.body, "url");
    if (title && url) products.push({ title, url });
  }

  return renderLlmsTxt({
    shopName: shopName ?? fallbackShopName(shopDomain),
    storeUrl: `https://${shopDomain}`,
    business,
    products,
  });
}
