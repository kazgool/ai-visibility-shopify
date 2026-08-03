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

export function keyLocation(shopDomain: string): string {
  return `https://${shopDomain}/apps/ai-visibility/${keyFileName(shopDomain)}`;
}

/** Is this proxy path the key file? Return the body to serve, else null. */
export function keyFileBody(shopDomain: string, requestedFile: string): string | null {
  return requestedFile === keyFileName(shopDomain) ? indexNowKey(shopDomain) : null;
}

/**
 * Ping IndexNow with changed URLs. Batched (the protocol caps a submission
 * at 10,000 URLs; ours are far smaller), deduplicated, best effort.
 */
export async function pingIndexNow(
  shopDomain: string,
  urls: string[],
): Promise<{ ok: boolean; submitted: number; status?: number }> {
  const unique = [...new Set(urls)].filter((u) => u.startsWith("http"));
  if (unique.length === 0) return { ok: true, submitted: 0 };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: shopDomain,
        key: indexNowKey(shopDomain),
        keyLocation: keyLocation(shopDomain),
        urlList: unique.slice(0, 10000),
      }),
    });
    // 200 and 202 both mean accepted. Anything else is logged by the caller.
    return { ok: res.status === 200 || res.status === 202, submitted: unique.length, status: res.status };
  } catch {
    return { ok: false, submitted: 0 };
  }
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
  const urls = handles.filter(Boolean).map((h) => `https://${shopDomain}/products/${h}`);
  const result = await pingIndexNow(shopDomain, urls);
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
  const urls = handles.filter(Boolean).map((h) => `https://${shopDomain}/collections/${h}`);
  const result = await pingIndexNow(shopDomain, urls);
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
