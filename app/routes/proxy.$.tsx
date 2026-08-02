// App proxy target (/apps/ai-visibility/* on the shop domain → /proxy/* here).
// Phase 3 serves the markdown mirror from MirrorCache. Until then: 501.
// The route exists now so the proxy config in shopify.app.toml has a target.
export const loader = async () => {
  return new Response("Not implemented yet.", {
    status: 501,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
