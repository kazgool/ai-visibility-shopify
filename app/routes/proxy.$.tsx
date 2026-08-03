import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { keyFileBody } from "../services/indexnow.server";

// App proxy: shop.com/apps/ai-visibility/<handle> → here.
//
// Single indexed read, static headers, no Admin API on the request path
// (PRD §5.2, §4.6). Content-Type must be set explicitly or Shopify wraps the
// response in the theme layout.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Verifies the proxy signature; an unsigned request is not from Shopify.
  const { session } = await authenticate.public.appProxy(request);
  const handle = (params["*"] ?? "").replace(/\/+$/, "").split("/").pop() ?? "";

  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  };

  if (!session?.shop || handle === "") {
    return new Response("Not found.\n", { status: 404, headers });
  }

  // IndexNow ownership key (PRD §4.9): served from the shop's own domain
  // through the proxy, so no theme changes are needed. Deterministic, so
  // this path needs no database.
  if (handle.startsWith("indexnow-") && handle.endsWith(".txt")) {
    const body = keyFileBody(session.shop, handle);
    if (body) {
      return new Response(body, {
        status: 200,
        headers: { ...headers, "Cache-Control": "public, max-age=86400" },
      });
    }
    return new Response("Not found.\n", { status: 404, headers });
  }

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) {
    return new Response("Not found.\n", { status: 404, headers });
  }

  const cached = await db.mirrorCache.findUnique({
    where: { shopId_handle: { shopId: shop.id, handle } },
  });

  if (!cached) {
    return new Response("Not found.\n", { status: 404, headers });
  }

  return new Response(cached.body, {
    status: 200,
    headers: {
      ...headers,
      // Point crawlers back at the canonical product page.
      Link: `<https://${session.shop}/products/${handle}>; rel="canonical"`,
      "Last-Modified": cached.updatedAt.toUTCString(),
    },
  });
};
