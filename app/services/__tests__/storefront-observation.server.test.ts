import { describe, expect, it, vi } from "vitest";
import { productSchemaObservation, recordProductSchemaObservation } from "../storefront-observation.server";

describe("per-product storefront schema observation", () => {
  it("uses a small stable value, not a timestamp that would trigger product updates on every page read", () => {
    expect(productSchemaObservation(true)).toEqual({ productNode: "complete", version: 1 });
    expect(productSchemaObservation(false)).toEqual({ productNode: "absent", version: 1 });
  });

  it("does not write when the observation has not changed", async () => {
    const graphql = vi.fn(async () => ({ product: { metafield: { value: JSON.stringify(productSchemaObservation(true)) } } }));
    await expect(recordProductSchemaObservation(graphql as any, "gid://shopify/Product/1", true)).resolves.toBe(false);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("writes a changed result under its own metafield, never the provenance state", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({ product: { metafield: { value: null } } })
      .mockResolvedValueOnce({ metafieldsSet: { userErrors: [] } });

    await expect(recordProductSchemaObservation(graphql as any, "gid://shopify/Product/1", false)).resolves.toBe(true);
    const [, variables] = graphql.mock.calls[1];
    expect(variables.metafields[0]).toMatchObject({
      ownerId: "gid://shopify/Product/1",
      namespace: "$app",
      key: "schema_observation",
      type: "json",
      value: JSON.stringify({ productNode: "absent", version: 1 }),
    });
  });
});
