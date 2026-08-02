// Theme JSON-LD detection (PRD §4.2).
//
// Most themes already emit a Product node. Two Product nodes on one page is
// worse than one, and unlike on WordPress we cannot filter the theme's output.
// So we look at the rendered page from outside, once on install and again when
// the theme changes, and let the merchant choose knowingly.
//
// Runs server side, never on a page view.

import db from "../db.server";

export type ThemeScanResult = {
  hasProductLd: boolean;
  nodeCount: number;
  emitters: string[];
  checkedUrl: string;
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
): Promise<ThemeScanResult> {
  const res = await fetch(productUrl, {
    headers: {
      // Identify honestly; some merchants log user agents.
      "User-Agent": "AI-Visibility-App/1.0 (+https://apps.shopify.com)",
      Accept: "text/html",
    },
    redirect: "follow",
  });

  const html = await res.text();
  const emitters: string[] = [];
  let nodeCount = 0;

  for (const match of html.matchAll(LD_BLOCK)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue; // A theme with broken JSON-LD is a finding in itself, later.
    }

    for (const node of collectNodes(parsed)) {
      if (typesOf(node).includes("Product")) {
        nodeCount += 1;
        const id = String(node["@id"] ?? "");
        if (id) emitters.push(id);
      }
    }
  }

  return {
    hasProductLd: nodeCount > 0,
    nodeCount,
    emitters,
    checkedUrl: productUrl,
  };
}

export async function recordThemeScan(
  shopId: string,
  themeId: string,
  result: ThemeScanResult,
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
}
