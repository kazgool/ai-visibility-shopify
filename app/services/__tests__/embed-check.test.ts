import { describe, expect, it } from "vitest";
import { checkAppEmbed, contentEmbedDeepLink } from "../embed-check.server";

// CC-PROMPT-AI-READABILITY-2 item 8: the "AI Visibility content" embed carries
// the same extension uid as the head embed. Matched on the uid it counted as a
// second head embed; read by handle, each is reported on its own.

const UID = "019fc7c8-03b7-7553-a37b-84b873e7cb96";
const head = (extra: Record<string, unknown> = {}) => ({
  type: `shopify://apps/mrdigital-ai-visibility-aio/blocks/ai-visibility/${UID}`,
  settings: { mode: "extend", enabled: true },
  ...extra,
});
const content = (extra: Record<string, unknown> = {}) => ({
  type: `shopify://apps/mrdigital-ai-visibility-aio/blocks/ai-visibility-content/${UID}`,
  settings: {},
  ...extra,
});

function theme(blocks: Record<string, unknown> | null, raw?: string) {
  const body = raw ?? JSON.stringify({ current: { blocks } });
  return async () =>
    new Response(
      JSON.stringify({
        data: {
          themes: {
            nodes: [{ id: "gid://shopify/OnlineStoreTheme/1", name: "Shella", files: { nodes: [{ body: { content: body } }] } }],
          },
        },
      }),
    );
}

describe("checkAppEmbed, head and content embeds apart", () => {
  it("reports the head embed on and the content embed absent", async () => {
    const r = await checkAppEmbed(theme({ a: head() }));
    expect(r).toMatchObject({ active: true, instances: 1, activeInstances: 1, mode: "extend" });
    expect(r.content).toMatchObject({ active: false, presentButDisabled: false, instances: 0, themeName: "Shella" });
  });

  it("does not count the content embed as a second head embed", async () => {
    const r = await checkAppEmbed(theme({ a: head(), b: content({ disabled: true }) }));
    expect(r.instances).toBe(1);
    expect(r.activeInstances).toBe(1);
    expect(r.content).toMatchObject({ active: false, presentButDisabled: true, instances: 1, activeInstances: 0 });
  });

  it("does not read the head embed as on when only the content embed is", async () => {
    const r = await checkAppEmbed(theme({ b: content() }));
    expect(r.active).toBe(false);
    expect(r.instances).toBe(0);
    expect(r.content).toMatchObject({ active: true, instances: 1, activeInstances: 1 });
  });

  it("reports both on, once each", async () => {
    const r = await checkAppEmbed(theme({ a: head(), b: content() }));
    expect(r.activeInstances).toBe(1);
    expect(r.content.activeInstances).toBe(1);
    expect(r.active && r.content.active).toBe(true);
  });

  it("flags a content embed saved against a development version", async () => {
    const r = await checkAppEmbed(
      theme({ b: { type: "shopify://apps/mrdigital-ai-visibility-aio/blocks/ai-visibility-content/dev-preview-uid" } }),
    );
    expect(r.content).toMatchObject({ active: false, staleReference: true, presentButDisabled: false });
  });

  it("says unknown, not off, when the settings file cannot be read", async () => {
    const r = await checkAppEmbed(theme(null, "{ not json"));
    expect(r.content.unreadable).toBe(true);
    expect(r.content.active).toBe(false);
  });
});

describe("contentEmbedDeepLink", () => {
  it("uses the documented form: client_id and the block's file name, on a product template", () => {
    expect(contentEmbedDeepLink("nordwood.myshopify.com")).toBe(
      "https://nordwood.myshopify.com/admin/themes/current/editor?context=apps&template=product&activateAppId=4261bcd7389bbd477f25254bd79d6298/ai-visibility-content",
    );
  });
});
