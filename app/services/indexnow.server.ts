// IndexNow (PRD §4.9).
//
// ChatGPT search runs on the Bing index, so fast Bing indexing is a direct
// path into AI answers. On product or collection change we ping IndexNow
// with the changed storefront URLs.
//
// The protocol wants proof of ownership: a key, served from the site the
// URLs belong to. We serve it through the app proxy
// (https://shop.com/apps/ai-visibility/indexnow-<key>.txt) and pass that
// location in the ping - no theme changes, works on every store.
//
// Failure here is never allowed to fail a job: indexing is a bonus on top
// of a successful write, not a condition of it.

import { createHash } from "node:crypto";
import db from "../db.server";

const ENDPOINT = "https://api.indexnow.org/indexnow";

/**
 * Per-shop key, deterministic so the proxy can validate it without a
 * database round trip on the serving path. Not a secret in the security
 * sense - the protocol only uses it to prove the pinger controls the host.
 */
export function indexNowKey(shopDomain: string): string {
  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  return createHash("sha256")
    .update(`indexnow:${shopDomain}:${secret}`)
    .digest("hex")
    .slice(0, 32);
}

export function keyFileName(shopDomain: string): string {
  return `indexnow-${indexNowKey(shopDomain)}.txt`;
}

/**
 * The key file's URL. `identityDomain` (always the stable .myshopify.com
 * domain) seeds the filename, since that never changes even if a merchant
 * repoints their primary domain; `publicDomain` is the domain the file must
 * actually be fetched from - the same one submitted as `host` and the one
 * every URL in the ping belongs to. On most stores these differ: session.shop
 * is myshopify.com, but the storefront and IndexNow's own crawl both live on
 * the connected primary domain (fix: this used to be the same domain for
 * both, so every submission and the mirror pages' own links pointed at the
 * redirecting myshopify duplicate instead of the real storefront URL).
 */
export function keyLocation(identityDomain: string, publicDomain: string): string {
  return `https://${publicDomain}/apps/ai-visibility/${keyFileName(identityDomain)}`;
}

/** Is this proxy path the key file? Return the body to serve, else null. */
export function keyFileBody(identityDomain: string, requestedFile: string): string | null {
  return requestedFile === keyFileName(identityDomain) ? indexNowKey(identityDomain) : null;
}

/**
 * Ping IndexNow with changed URLs. Batched (the protocol caps a submission
 * at 10,000 URLs; ours are far smaller), deduplicated, best effort.
 */
export async function pingIndexNow(
  identityDomain: string,
  publicDomain: string,
  urls: string[],
): Promise<{ ok: boolean; submitted: number; status?: number }> {
  const unique = [...new Set(urls)].filter((u) => u.startsWith("http"));
  if (unique.length === 0) return { ok: true, submitted: 0 };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: publicDomain,
        key: indexNowKey(identityDomain),
        keyLocation: keyLocation(identityDomain, publicDomain),
        urlList: unique.slice(0, 10000),
      }),
    });
    // 200 and 202 both mean accepted. Anything else is logged by the caller.
    return { ok: res.status === 200 || res.status === 202, submitted: unique.length, status: res.status };
  } catch {
    return { ok: false, submitted: 0 };
  }
}

const SHOP_INFO_SETTING_KEY = "shopInfo";

/**
 * The persisted primary domain (catalogue.server.ts saveShopInfo), or the
 * identity domain when a shop has never run extraction. Shared by
 * pingProducts and pingCollections so every IndexNow submission uses the
 * same real storefront URLs the merchant's customers actually see.
 */
async function publicDomainFor(shopId: string, identityDomain: string): Promise<string> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SHOP_INFO_SETTING_KEY } },
  });
  if (!row?.value) return identityDomain;
  try {
    const info = JSON.parse(row.value) as { url?: string };
    if (info.url) return new URL(info.url).hostname || identityDomain;
  } catch {
    // fall through
  }
  return identityDomain;
}

/**
 * Convenience for jobs: ping for a set of product handles, respecting the
 * shop's setting. Never throws.
 */
export async function pingProducts(
  shopId: string,
  shopDomain: string,
  handles: string[],
): Promise<void> {
  if (!(await isEnabled(shopId))) return;
  const publicDomain = await publicDomainFor(shopId, shopDomain);
  const urls = handles.filter(Boolean).map((h) => `https://${publicDomain}/products/${h}`);
  const result = await pingIndexNow(shopDomain, publicDomain, urls);
  if (!result.ok && result.submitted > 0) {
    console.warn(`indexnow ${shopDomain}: status ${result.status ?? "network error"}`);
  }
}

/** Same, for collection handles. */
export async function pingCollections(
  shopId: string,
  shopDomain: string,
  handles: string[],
): Promise<void> {
  if (!(await isEnabled(shopId))) return;
  const publicDomain = await publicDomainFor(shopId, shopDomain);
  const urls = handles.filter(Boolean).map((h) => `https://${publicDomain}/collections/${h}`);
  const result = await pingIndexNow(shopDomain, publicDomain, urls);
  if (!result.ok && result.submitted > 0) {
    console.warn(`indexnow ${shopDomain}: status ${result.status ?? "network error"}`);
  }
}

const SETTING_KEY = "indexnow_enabled";

/** On unless the merchant turned it off. */
export async function isEnabled(shopId: string): Promise<boolean> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SETTING_KEY } },
  });
  return row ? row.value === "true" : true;
}

export async function setEnabled(shopId: string, enabled: boolean): Promise<void> {
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: SETTING_KEY } },
    create: { shopId, key: SETTING_KEY, value: String(enabled) },
    update: { value: String(enabled) },
  });
}
