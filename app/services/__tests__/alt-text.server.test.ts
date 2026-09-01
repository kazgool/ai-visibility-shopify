import { describe, expect, it, vi } from "vitest";
import { writeAltText } from "../alt-text.server";
import type { Fact } from "../../engine";

const facts: Fact[] = [{ k: "Material", v: "lemn masiv" }];

function graphqlMock(mediaAlt: string) {
  const calls: { query: string; variables?: any }[] = [];
  const fn = vi.fn(async (query: string, variables?: any) => {
    calls.push({ query, variables });
    if (query.includes("ProductMedia")) {
      return {
        product: {
          id: variables.id,
          title: "Set masa",
          productType: "Mobilier",
          media: {
            nodes: [{ id: "gid://shopify/MediaImage/1", alt: mediaAlt, image: { url: "https://x/1.jpg" } }],
          },
        },
      };
    }
    if (query.includes("UpdateMedia")) {
      return { productUpdateMedia: { mediaUserErrors: [] } };
    }
    return {};
  });
  return { fn, calls };
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
