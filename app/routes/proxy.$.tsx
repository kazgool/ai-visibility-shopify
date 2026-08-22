import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { keyFileBody } from "../services/indexnow.server";

// App proxy: shop.com/apps/ai-visibility/<handle> → here.
//
// Single indexed read, static headers, no Admin API on the request path
// (PRD §5.2, §4.6). Content-Type must be set explicitly or Shopify wraps the
// response in the theme layout.

// Phase 0 raw logging (CRAWLER-HITS-SPEC §3): answers whether the proxy
// forwards the real user agent and a usable IP, and whether Shopify's edge
// caches the response. Fire-and-forget - never awaited by the caller, and
// every failure is swallowed here so a logging outage can never turn into a
// 500 on the mirror. Uses the shop domain as shopId rather than the internal
// Shop row id, because some requests below (no session, indexnow key files)
// never look the shop up and this path is not allowed a second query.
function logCrawlerHit(row: {
  shopId: string;
  agent: string;
  ip: string | null;
  forwarding: string | null;
  handle: string | null;
  path: string;
  status: number;
}): void {
  db.crawlerHit.create({ data: row }).catch(() => {});
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("fly-client-ip") ?? request.headers.get("x-forwarded-for");
  if (!forwarded) return null;
  return forwarded.split(",")[0]?.trim() || null;
}

// Diagnostic only, temporary (CRAWLER-HITS-SPEC §2, §10.2): `fly-client-ip`
// is by definition whoever connected to Fly, which the real four hits so far
// confirm is Cloudflare's edge, not the browser or bot. This records every
// candidate forwarding header as received so we can tell, from real traffic,
// whether any of them ever carries the actual client address. Once that is
// known, this column either becomes the basis of bot verification (§5
// Option B) or gets dropped along with the idea of displaying a verified
// count.
const FORWARDING_HEADERS = [
  "x-forwarded-for",
  "fly-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
  "forwarded",
] as const;

function forwardingHeaders(request: Request): string | null {
  const found: Record<string, string> = {};
  for (const name of FORWARDING_HEADERS) {
    const value = request.headers.get(name);
    if (value) found[name] = value;
  }
  return Object.keys(found).length ? JSON.stringify(found) : null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Verifies the proxy signature; an unsigned request is not from Shopify.
  const { session } = await authenticate.public.appProxy(request);
  const handle = (params["*"] ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
  const path = new URL(request.url).pathname;
  const agent = request.headers.get("user-agent") ?? "";
  const ip = clientIp(request);
  const forwarding = forwardingHeaders(request);

  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  };

  const log = (shopId: string, status: number, loggedHandle: string | null = handle || null) =>
    logCrawlerHit({ shopId, agent, ip, forwarding, handle: loggedHandle, path, status });

  if (!session?.shop || handle === "") {
    log(session?.shop ?? "", 404);
    return new Response("Not found.\n", { status: 404, headers });
  }

  // IndexNow ownership key (PRD §4.9): served from the shop's own domain
  // through the proxy, so no theme changes are needed. Deterministic, so
  // this path needs no database.
  if (handle.startsWith("indexnow-") && handle.endsWith(".txt")) {
    const body = keyFileBody(session.shop, handle);
    if (body) {
      log(session.shop, 200, null);
      return new Response(body, {
        status: 200,
        headers: { ...headers, "Cache-Control": "public, max-age=86400" },
      });
    }
    log(session.shop, 404, null);
    return new Response("Not found.\n", { status: 404, headers });
  }

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) {
    log(session.shop, 404);
    return new Response("Not found.\n", { status: 404, headers });
  }

  const cached = await db.mirrorCache.findUnique({
    where: { shopId_handle: { shopId: shop.id, handle } },
  });

  if (!cached) {
    log(session.shop, 404);
    return new Response("Not found.\n", { status: 404, headers });
  }

  log(session.shop, 200);
  return new Response(cached.body, {
    status: 200,
    headers: {
      ...headers,
      // Point crawlers back at the canonical product page, and at the store's
      // llms.txt. The llms.txt proposal names the Link header as the way to
      // do this for non-HTML resources, which is what this response is.
      Link:
        `<https://${session.shop}/products/${handle}>; rel="canonical", ` +
        `<https://${session.shop}/llms.txt>; rel="describedby"`,
      "Last-Modified": cached.updatedAt.toUTCString(),
    },
  });
};
