// Theme JSON-LD detection (PRD §4.2).
//
// Most themes already emit a Product node. Two Product nodes on one page is
// worse than one, and unlike on WordPress we cannot filter the theme's output.
// So we look at the rendered page from outside, once on install and again when
// the theme changes, and let the merchant choose knowingly.
//
// Runs server side, never on a page view.

import db from "../db.server";
import { NAMESPACE } from "./facts.server";

export type ThemeScanResult = {
  hasProductLd: boolean;
  nodeCount: number;
  emitters: string[];
  /** Same detection, for the store-wide Organization node (sameAs). */
  hasOrganizationLd: boolean;
  organizationEmitters: string[];
  checkedUrl: string;
  /** The storefront answered with the password page: nothing can be read. */
  passwordProtected?: boolean;
};

const LD_BLOCK = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function typesOf(node: any): string[] {
  const t = node?.["@type"];
  if (!t) return [];
  return Array.isArray(t) ? t.map(String) : [String(t)];
}

function collectNodes(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed.flatMap(collectNodes);
  if (parsed && typeof parsed === "object") {
    const graph = parsed["@graph"];
    if (Array.isArray(graph)) return graph.flatMap(collectNodes);
    return [parsed];
  }
  return [];
}

/**
 * Fetch a product page as a plain client and report what structured data the
 * theme already publishes. Deliberately not authenticated: this is what a
 * crawler sees.
 */
export async function scanThemeForProductLd(
  productUrl: string,
  storefrontPassword?: string | null,
): Promise<ThemeScanResult> {
  const headers: Record<string, string> = {
    // Identify honestly; some merchants log user agents.
    "User-Agent": "AI-Visibility-App/1.0 (+https://apps.shopify.com)",
    Accept: "text/html",
  };

  // Development stores cannot turn password protection off, and a live store
  // left password-protected is the first reason assistants cannot see it. If
  // the merchant gave us the password we unlock a session for the scan; the
  // crawler check reports the protection either way.
  if (storefrontPassword) {
    const origin = new URL(productUrl).origin;
    const unlock = await fetch(`${origin}/password`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        form_type: "storefront_password",
        utf8: "✓",
        password: storefrontPassword,
      }),
      redirect: "manual",
    });
    const cookie = unlock.headers.get("set-cookie");
    if (cookie) headers.Cookie = cookie.split(";")[0];
  }

  const res = await fetch(productUrl, { headers, redirect: "follow" });

  const html = await res.text();

  // A password page is not a theme finding — say so plainly.
  if (/name=["']password["']/i.test(html) && !/ld\+json/i.test(html)) {
    return {
      hasProductLd: false,
      nodeCount: 0,
      emitters: [],
      hasOrganizationLd: false,
      organizationEmitters: [],
      checkedUrl: productUrl,
      passwordProtected: true,
    };
  }
  const emitters: string[] = [];
  const organizationEmitters: string[] = [];
  let nodeCount = 0;

  for (const match of html.matchAll(LD_BLOCK)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue; // A theme with broken JSON-LD is a finding in itself, later.
    }

    for (const node of collectNodes(parsed)) {
      const types = typesOf(node);
      const id = String(node["@id"] ?? "");
      if (types.includes("Product")) {
        nodeCount += 1;
        if (id) emitters.push(id);
      }
      if (types.includes("Organization")) {
        if (id) organizationEmitters.push(id);
        else organizationEmitters.push("");
      }
    }
  }

  return {
    hasProductLd: nodeCount > 0,
    nodeCount,
    emitters,
    hasOrganizationLd: organizationEmitters.length > 0,
    organizationEmitters,
    checkedUrl: productUrl,
  };
}

const SHOP_ID = `#graphql
  query ShopId { shop { id } }
`;

const SET_METAFIELD = `#graphql
  mutation SetShopThemeScan($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/**
 * Mirror the Organization detection to a shop metafield, so the storefront
 * block can decide extend-or-emit at render time without a fetch. The block
 * needs the actual identifier, not just a boolean: a theme Organization node
 * with no @id of its own gives us nothing to reference, so organizationId
 * stays empty and the block falls back to emitting its own node.
 */
async function mirrorThemeScanMetafield(
  shopId: string,
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
  result: ThemeScanResult,
): Promise<void> {
  const idRes = await graphql(SHOP_ID);
  const idJson = await idRes.json();
  const shopGid = idJson.data?.shop?.id;
  if (!shopGid) return;

  const organizationId = result.organizationEmitters.find((id) => id !== "") ?? "";

  const res = await graphql(SET_METAFIELD, {
    variables: {
      metafields: [
        {
          ownerId: shopGid,
          namespace: NAMESPACE,
          key: "theme_scan",
          type: "json",
          value: JSON.stringify({
            hasOrganizationLd: result.hasOrganizationLd,
            organizationId,
          }),
        },
      ],
    },
  });
  const json = await res.json();
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`metafieldsSet (shop theme_scan): ${JSON.stringify(errors)}`);
  }
}

export async function recordThemeScan(
  shopId: string,
  themeId: string,
  result: ThemeScanResult,
  graphql?: (query: string, options?: { variables?: object }) => Promise<Response>,
) {
  await db.themeScan.upsert({
    where: { shopId_themeId: { shopId, themeId } },
    create: {
      shopId,
      themeId,
      hasProductLd: result.hasProductLd,
      detail: result as any,
    },
    update: {
      hasProductLd: result.hasProductLd,
      detail: result as any,
      scannedAt: new Date(),
    },
  });

  if (graphql) {
    await mirrorThemeScanMetafield(shopId, graphql, result);
  }
}
