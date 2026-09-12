// Section I.5: the comparison table was the second leak, of a different
// shape. The Admin API returns a collection's members whatever their status,
// and every table row links to /products/{handle} - so a draft, archived or
// unpublished member was written into the collection's `table` metafield with
// a link to a 404, and an unlisted member appeared in the one place Shopify
// says it does not. It persisted there until the next collections pass.

import { describe, expect, it } from "vitest";
import {
  buildForCollection,
  eligibleMembers,
  writeCollections,
  type CollectionNode,
} from "../collections.server";
import { DEFAULT_PREFS } from "../eligibility";

function member(handle: string, extra: Record<string, unknown> = {}) {
  return {
    id: `gid://shopify/Product/${handle}`,
    title: handle,
    handle,
    status: "ACTIVE",
    onlineStoreUrl: `https://x/products/${handle}`,
    metafields: [
      {
        key: "facts",
        value: JSON.stringify([
          { k: "Material", v: handle === "live" ? "oak" : "pine" },
          { k: "Dimensions", v: handle === "live" ? "120 x 60 cm" : "80 x 40 cm" },
        ]),
      },
    ],
    ...extra,
  };
}

function collection(nodes: any[]): CollectionNode {
  return {
    id: "gid://shopify/Collection/1",
    title: "Mese",
    handle: "mese",
    descriptionHtml: "",
    productsCount: { count: nodes.length },
    metafields: [],
    products: { nodes },
  };
}

describe("eligibleMembers", () => {
  it("drops a draft member and an unlisted member at the default settings", () => {
    const c = collection([
      member("live"),
      member("hidden", { status: "UNLISTED" }),
      member("draft", { status: "DRAFT" }),
      member("archived", { status: "ARCHIVED" }),
      member("offline", { onlineStoreUrl: null }),
    ]);

    expect(eligibleMembers(c, DEFAULT_PREFS).map((p) => p.handle)).toEqual(["live"]);
  });

  it("keeps an unlisted member when the merchant includes unlisted products", () => {
    const c = collection([member("live"), member("hidden", { status: "UNLISTED" })]);
    const kept = eligibleMembers(c, { includeOutOfStock: true, includeUnlisted: true });
    expect(kept.map((p) => p.handle)).toEqual(["live", "hidden"]);
  });

  it("keeps a sold-out member whatever the merchant's toggle says", () => {
    // Shopify's own collection page lists sold-out members, and the table sits
    // on that page, so the table follows the page.
    const c = collection([member("live"), member("sold", { available: false })]);
    const kept = eligibleMembers(c, { includeOutOfStock: false, includeUnlisted: false });
    expect(kept.map((p) => p.handle)).toEqual(["live", "sold"]);
  });
});

describe("buildForCollection", () => {
  it("builds no row for a member that has no public product page", () => {
    const c = collection([
      member("live"),
      member("other"),
      member("draft", { status: "DRAFT" }),
    ]);
    const capsule = buildForCollection(c, DEFAULT_PREFS);
    const handles = capsule.table.rows.map((r) => r.handle);

    expect(handles).not.toContain("draft");
    // The table is still built - dropping the draft must not empty it.
    expect(handles).toContain("live");
  });
});

describe("writeCollections preserves omissions for review", () => {
  function calls() {
    const seen: { mutation: string; vars: any }[] = [];
    const graphql = async (query: string, vars: any) => {
      const mutation = query.includes("metafieldsDelete") ? "delete" : "set";
      seen.push({ mutation, vars });
      return mutation === "delete"
        ? { metafieldsDelete: { userErrors: [] } }
        : { metafieldsSet: { userErrors: [] } };
    };
    return { graphql, seen };
  }

  const oldTable = JSON.stringify({
    columns: ["Material"],
    rows: [{ handle: "gone", title: "gone", values: ["oak"] }],
  });

  it("keeps an auto-written table when every member has left and reports it", async () => {
    const c = collection([member("gone", { status: "DRAFT" })]);
    c.metafields = [
      { key: "table", value: oldTable },
      { key: "state", value: JSON.stringify({ table: { source: "auto", at: "x", engine: "y" } }) },
    ];
    const { graphql, seen } = calls();

    const [outcome] = await writeCollections(graphql as any, [c], DEFAULT_PREFS);

    expect(outcome.removed).toEqual([]);
    expect(outcome.wouldRemove).toEqual([
      expect.objectContaining({ field: "table", previousValue: oldTable }),
    ]);
    expect(outcome.empty).toBe(true);
    const del = seen.find((s) => s.mutation === "delete");
    expect(del).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("keeps every auto field of an empty collection and proposes each for review", async () => {
    const c = collection([member("gone", { status: "DRAFT" })]);
    c.metafields = [
      { key: "summary", value: "gone has 0 products." },
      { key: "questions", value: JSON.stringify([{ q: "x", a: "y" }]) },
      { key: "table", value: oldTable },
      {
        key: "state",
        value: JSON.stringify({
          summary: { source: "auto", at: "x", engine: "y" },
          questions: { source: "auto", at: "x", engine: "y" },
          table: { source: "auto", at: "x", engine: "y" },
        }),
      },
    ];
    const { graphql, seen } = calls();

    const [outcome] = await writeCollections(graphql as any, [c], DEFAULT_PREFS);

    expect(outcome.members).toBe(0);
    expect(outcome.written).toEqual([]);
    expect(outcome.removed).toEqual([]);
    expect(outcome.wouldRemove.map((removal) => removal.field).sort()).toEqual(["questions", "summary", "table"]);
    const setKeys = seen
      .filter((s) => s.mutation === "set")
      .flatMap((s) => s.vars.metafields)
      .map((m: any) => m.key);
    expect(setKeys).toEqual([]);
  });

  it("never deletes a table a human wrote", async () => {
    const c = collection([member("gone", { status: "DRAFT" })]);
    c.metafields = [
      { key: "table", value: oldTable },
      { key: "state", value: JSON.stringify({ table: { source: "human", at: "x" } }) },
    ];
    const { graphql, seen } = calls();

    const [outcome] = await writeCollections(graphql as any, [c], DEFAULT_PREFS);

    expect(outcome.removed).toEqual([]);
    expect(outcome.wouldRemove).toEqual([]);
    expect(outcome.skipped).toContain("table");
    expect(seen.find((s) => s.mutation === "delete")).toBeUndefined();
  });

  it("deletes nothing when there was no table to begin with", async () => {
    const c = collection([member("gone", { status: "DRAFT" })]);
    const { graphql, seen } = calls();

    const [outcome] = await writeCollections(graphql as any, [c], DEFAULT_PREFS);

    expect(outcome.removed).toEqual([]);
    expect(outcome.wouldRemove).toEqual([]);
    expect(seen.find((s) => s.mutation === "delete")).toBeUndefined();
  });

  it("updates an automatic field when the collection has a new concrete capsule", async () => {
    const c = collection([member("live")]);
    c.metafields = [
      { key: "summary", value: "Old automatic summary." },
      { key: "state", value: JSON.stringify({ summary: { source: "auto", at: "x", engine: "y" } }) },
    ];
    const { graphql, seen } = calls();

    const [outcome] = await writeCollections(graphql as any, [c], DEFAULT_PREFS);

    expect(outcome.written).toContain("summary");
    expect(outcome.wouldRemove).toEqual([]);
    expect(seen.some((call) => call.mutation === "delete")).toBe(false);
  });
});
