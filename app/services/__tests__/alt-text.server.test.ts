import { describe, expect, it, vi } from "vitest";
import { writeAltText } from "../alt-text.server";
import type { Fact } from "../../engine";

const facts: Fact[] = [{ k: "Material", v: "lemn masiv" }];

function graphqlMock(
  mediaAlt: string,
  options: { state?: Record<string, unknown> | null; media?: { id: string; alt: string }[] } = {},
) {
  const calls: { query: string; variables?: any }[] = [];
  const fn = vi.fn(async (query: string, variables?: any) => {
    calls.push({ query, variables });
    if (query.includes("ProductMedia")) {
      const nodes = (options.media ?? [{ id: "gid://shopify/MediaImage/1", alt: mediaAlt }]).map(
        (m) => ({ ...m, image: { url: `https://x/${m.id.split("/").pop()}.jpg` } }),
      );
      return {
        product: {
          id: variables.id,
          title: "Set masa",
          productType: "Mobilier",
          state: options.state ? { value: JSON.stringify(options.state) } : null,
          media: { nodes },
        },
      };
    }
    if (query.includes("UpdateMedia")) {
      return { productUpdateMedia: { mediaUserErrors: [] } };
    }
    if (query.includes("SetAltTextState")) {
      return { metafieldsSet: { userErrors: [] } };
    }
    return {};
  });
  return { fn, calls };
}

/** The state this pass wrote, parsed, or null when it wrote none. */
function stateWritten(calls: { query: string; variables?: any }[]) {
  const call = calls.find((c) => c.query.includes("SetAltTextState"));
  if (!call) return null;
  const entry = call.variables.metafields[0];
  expect(entry.key).toBe("state");
  expect(entry.namespace).toBe("$app");
  expect(entry.type).toBe("json");
  return JSON.parse(entry.value);
}

describe("writeAltText unchanged check", () => {
  it("does not write when the generated alt equals the existing machine alt (self-feed guard)", async () => {
    // First call establishes what buildAltText would produce for this input.
    const seededMedia = new Map<string, string>();
    const probe = graphqlMock("");
    const first = await writeAltText(probe.fn as any, "gid://shopify/Product/1", facts, seededMedia);
    expect(first.written).toBe(1);

    // Re-derive the alt text it wrote, then run again as if the catalogue
    // had not changed: the existing alt already equals what would be
    // generated, so a second pass must write nothing.
    const generatedCall = probe.calls.find((c) => c.query.includes("UpdateMedia"));
    const generatedAlt: string = generatedCall!.variables.media[0].alt;

    const rerun = graphqlMock(generatedAlt);
    const seenMedia = new Map<string, string>();
    const outcome = await writeAltText(rerun.fn as any, "gid://shopify/Product/1", facts, seenMedia);

    expect(outcome.written).toBe(0);
    expect(rerun.calls.some((c) => c.query.includes("UpdateMedia"))).toBe(false);
  });

  it("still writes when the alt is empty or genuinely machine-generated but different", async () => {
    const { fn } = graphqlMock("");
    const outcome = await writeAltText(fn as any, "gid://shopify/Product/1", facts, new Map());
    expect(outcome.written).toBe(1);
  });

  it("never touches a human-written alt", async () => {
    const { fn } = graphqlMock("Fotografie facuta de client in showroom");
    const outcome = await writeAltText(fn as any, "gid://shopify/Product/1", facts, new Map());
    expect(outcome.written).toBe(0);
    expect(outcome.keptHuman).toBe(1);
  });
});

describe("the dated record of what was written (5 September 2026)", () => {
  it("stamps one timestamp per photo written, on the product's state, after the media write", async () => {
    const { fn, calls } = graphqlMock("", {
      media: [
        { id: "gid://shopify/MediaImage/1", alt: "" },
        { id: "gid://shopify/MediaImage/2", alt: "Fotografie facuta de client in showroom" },
      ],
    });
    const before = Date.now();
    const outcome = await writeAltText(fn as any, "gid://shopify/Product/1", facts, new Map());
    expect(outcome.written).toBe(1);
    expect(outcome.keptHuman).toBe(1);

    const order = calls.map((c) => (c.query.includes("UpdateMedia") ? "media" : c.query.includes("SetAltTextState") ? "state" : "read"));
    expect(order).toEqual(["read", "media", "state"]);

    const state = stateWritten(calls)!;
    const entry = state.alt_text;
    expect(entry.source).toBe("auto");
    expect(Object.keys(entry.media)).toEqual(["gid://shopify/MediaImage/1"]);
    expect(Date.parse(entry.media["gid://shopify/MediaImage/1"])).toBeGreaterThanOrEqual(before);
    expect(entry.at).toBe(entry.media["gid://shopify/MediaImage/1"]);
  });

  it("writes no record at all on a pass that wrote nothing, so the unchanged rule still holds", async () => {
    const probe = graphqlMock("");
    await writeAltText(probe.fn as any, "gid://shopify/Product/1", facts, new Map());
    const generated: string = probe.calls.find((c) => c.query.includes("UpdateMedia"))!.variables.media[0].alt;

    const rerun = graphqlMock(generated);
    const outcome = await writeAltText(rerun.fn as any, "gid://shopify/Product/1", facts, new Map());
    expect(outcome.written).toBe(0);
    expect(rerun.calls.some((c) => c.query.includes("UpdateMedia"))).toBe(false);
    expect(stateWritten(rerun.calls)).toBeNull();
  });

  it("keeps the other keys of the state and the earlier photos' dates, and drops photos no longer on the product", async () => {
    const { fn, calls } = graphqlMock("", {
      state: {
        facts: { source: "auto", at: "2026-08-01T00:00:00.000Z" },
        summary: { source: "human", at: "2026-08-02T00:00:00.000Z" },
        alt_text: {
          source: "auto",
          at: "2026-08-03T00:00:00.000Z",
          media: {
            "gid://shopify/MediaImage/2": "2026-08-03T00:00:00.000Z",
            "gid://shopify/MediaImage/gone": "2026-08-03T00:00:00.000Z",
          },
        },
      },
      media: [
        { id: "gid://shopify/MediaImage/1", alt: "" },
        // An importer's filename, which looksLikeMachineAlt recognises:
        // rewritten, and its date moves.
        { id: "gid://shopify/MediaImage/2", alt: "IMG_20260503_1.jpg" },
      ],
    });
    const outcome = await writeAltText(fn as any, "gid://shopify/Product/1", facts, new Map());
    expect(outcome.written).toBe(2);

    const state = stateWritten(calls)!;
    expect(state.facts).toEqual({ source: "auto", at: "2026-08-01T00:00:00.000Z" });
    expect(state.summary).toEqual({ source: "human", at: "2026-08-02T00:00:00.000Z" });
    expect(Object.keys(state.alt_text.media).sort()).toEqual([
      "gid://shopify/MediaImage/1",
      "gid://shopify/MediaImage/2",
    ]);
    expect(state.alt_text.media["gid://shopify/MediaImage/2"]).not.toBe("2026-08-03T00:00:00.000Z");
  });

  it("leaves an earlier photo's date alone when only another photo is written", async () => {
    const probe = graphqlMock("");
    await writeAltText(probe.fn as any, "gid://shopify/Product/1", facts, new Map());
    const generated: string = probe.calls.find((c) => c.query.includes("UpdateMedia"))!.variables.media[0].alt;

    const { fn, calls } = graphqlMock("", {
      state: {
        alt_text: {
          source: "auto",
          at: "2026-08-03T00:00:00.000Z",
          media: { "gid://shopify/MediaImage/1": "2026-08-03T00:00:00.000Z" },
        },
      },
      media: [
        { id: "gid://shopify/MediaImage/1", alt: generated },
        { id: "gid://shopify/MediaImage/2", alt: "" },
      ],
    });
    const outcome = await writeAltText(fn as any, "gid://shopify/Product/1", facts, new Map());
    expect(outcome.written).toBe(1);
    const state = stateWritten(calls)!;
    expect(state.alt_text.media["gid://shopify/MediaImage/1"]).toBe("2026-08-03T00:00:00.000Z");
    expect(state.alt_text.media["gid://shopify/MediaImage/2"]).toBe(state.alt_text.at);
  });
});
