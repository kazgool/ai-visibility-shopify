// PRD-FIX-WAVE-1 S1. Metafield writes are batched, and the batch boundary
// used to fall wherever the 24th entry happened to be. A product whose values
// landed in one call and whose `state` landed in the next is one failed call
// away from a value with no provenance - which every later pass reads as
// human and never touches again.

import { describe, expect, it } from "vitest";
import { sliceByOwner } from "../facts.server";

function fields(ownerId: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({ ownerId, key: `k${i}` }));
}

describe("sliceByOwner", () => {
  it("never splits one product across two calls", () => {
    const items = [
      ...fields("gid://shopify/Product/1", 7),
      ...fields("gid://shopify/Product/2", 7),
      ...fields("gid://shopify/Product/3", 7),
      ...fields("gid://shopify/Product/4", 7),
      ...fields("gid://shopify/Product/5", 7),
    ];

    const slices = sliceByOwner(items);
    expect(slices.length).toBeGreaterThan(1); // the batch really does cross 24

    for (const owner of new Set(items.map((i) => i.ownerId))) {
      const touching = slices.filter((s) => s.some((i) => i.ownerId === owner));
      expect(touching).toHaveLength(1);
      expect(touching[0].filter((i) => i.ownerId === owner)).toHaveLength(7);
    }
  });

  it("loses nothing and keeps the order it was given", () => {
    const items = [...fields("a", 20), ...fields("b", 20), ...fields("c", 3)];
    expect(slicesFlat(items)).toEqual(items);
  });

  it("fills a call up to the limit before starting the next", () => {
    const items = [...fields("a", 12), ...fields("b", 12), ...fields("c", 1)];
    expect(sliceByOwner(items).map((s) => s.length)).toEqual([24, 1]);
  });

  // metafieldsSet refuses more than 25 entries, so a 30-entry slice is not a
  // call of its own, it is a call that fails and takes the batch with it.
  it("chunks a product with more fields than the limit, and never over the limit", () => {
    const items = [...fields("a", 30), ...fields("b", 2)];
    const slices = sliceByOwner(items);
    expect(slices.map((s) => s.length)).toEqual([24, 6, 2]);
    for (const slice of slices) expect(slice.length).toBeLessThanOrEqual(24);
    expect(new Set(slices[0].map((i) => i.ownerId))).toEqual(new Set(["a"]));
    expect(new Set(slices[1].map((i) => i.ownerId))).toEqual(new Set(["a"]));
  });

  // The one asymmetry that matters: state written without its value is
  // recomputed on the next pass; a value written without its state is read as
  // human for ever. So state goes in the first chunk.
  it("puts the state entry in the first chunk when a product has to be chunked", () => {
    const items = [
      ...fields("a", 30),
      { ownerId: "a", key: "state" },
    ];
    const slices = sliceByOwner(items);
    expect(slices[0][0].key).toBe("state");
    expect(slices.flat()).toHaveLength(31);
  });

  it("returns nothing for nothing", () => {
    expect(sliceByOwner([])).toEqual([]);
  });
});

function slicesFlat(items: { ownerId: string; key: string }[]) {
  return sliceByOwner(items).flat();
}
