import { describe, it, expect, vi } from "vitest";

// A6 and the collections meta writer (PRD-SEO-FULL-ONPAGE section 2).
//
// The acceptance rows this covers: A6 classifies a collection meta field the
// same way `classifyMetaField` does a product's, in all three states; and the
// writer never touches a human-written field and never writes an identical
// value.
//
// The classifier is asserted against the product one on the same input, not
// merely against expected strings. That is the claim the section makes - "the
// same three states it gives products" - and only a comparison can prove it;
// two independent expectations would both pass while the two implementations
// drifted apart.

import {
  buildCollectionSeoQueue,
  checkCollectionMetaFields,
  classifyCollection,
  ownerOf,
  revertCollectionSeo,
  writeCollectionSeo,
  COLLECTION_TITLE_TARGET,
} from "../seo-collections.server";
import { classifyMetaField } from "../seo.server";
import type { CollectionNode } from "../collections.server";

function collection(over: Partial<CollectionNode> = {}): CollectionNode {
  return {
    id: "gid://shopify/Collection/1",
    title: "Mese de sufragerie",
    handle: "mese-de-sufragerie",
    descriptionHtml: "<p>Mese din lemn masiv pentru sufragerie. Livrare in 5 zile.</p>",
    metafields: [],
    seo: { title: null, description: null },
    ...over,
  };
}

function state(entries: Record<string, { source: string; at: string; prev?: string }>) {
  return [{ key: "state", value: JSON.stringify(entries) }];
}

describe("A6: the three states, and that they are the product's own", () => {
  const cases: { name: string; node: CollectionNode; expected: string }[] = [
    {
      name: "empty is missing",
      node: collection({ seo: { title: "", description: null } }),
      expected: "missing",
    },
    {
      name: "a value with no state entry came from outside this app",
      node: collection({ seo: { title: "Mese", description: null } }),
      expected: "outside",
    },
    {
      name: "a value this app wrote is auto",
      node: collection({
        seo: { title: "Mese", description: null },
        metafields: state({ seo_title: { source: "auto", at: "2026-09-01T00:00:00Z" } }),
      }),
      expected: "auto",
    },
    {
      name: "a value a person wrote here is human, and protected",
      node: collection({
        seo: { title: "Mese", description: null },
        metafields: state({ seo_title: { source: "human", at: "2026-09-01T00:00:00Z" } }),
      }),
      expected: "human",
    },
  ];

  for (const { name, node, expected } of cases) {
    it(name, () => {
      expect(classifyCollection(node).title).toBe(expected);
    });

    it(`${name} - and the product classifier agrees on the same input`, () => {
      // Not a second expectation: the same function, called through the same
      // shape. A collection carries Shopify's `seo` pair and this app's
      // `state` metafield exactly as a product does, which is why extending
      // A6 needed no second rule.
      expect(classifyMetaField(ownerOf(node), "seo_title")).toBe(classifyCollection(node).title);
    });
  }

  it("names both absent fields, and says nothing when both are set", () => {
    expect(checkCollectionMetaFields(collection())!.missing).toEqual(["title", "description"]);
    expect(
      checkCollectionMetaFields(
        collection({ seo: { title: "Mese", description: "Mese din lemn." } }),
      ),
    ).toBeNull();
  });

  it("reports a field that is empty now, whatever a stale state entry claims", () => {
    const node = collection({
      seo: { title: "", description: "Mese din lemn." },
      metafields: state({ seo_title: { source: "auto", at: "2026-08-01T00:00:00Z" } }),
    });
    expect(checkCollectionMetaFields(node)!.missing).toEqual(["title"]);
  });
});

describe("the collections queue", () => {
  it("counts A6 with its own denominator and proposes only for empty, writable fields", () => {
    const queue = buildCollectionSeoQueue([
      collection({ id: "c1" }),
      collection({ id: "c2", seo: { title: "Scaune", description: "Scaune din lemn." } }),
      collection({
        id: "c3",
        seo: { title: "", description: "Rafturi." },
        metafields: state({ seo_title: { source: "human", at: "2026-09-01T00:00:00Z" } }),
      }),
    ]);

    expect(queue.checked).toBe(3);
    // c1 has both absent, c3 has its title absent. c2 has both set.
    expect(queue.withFinding).toBe(2);
    expect(queue.missingTitle).toBe(2);
    expect(queue.missingDescription).toBe(1);
    // Only c1 is proposed: c2 has nothing empty, c3's empty title is protected.
    expect(queue.rows.map((r) => r.id)).toEqual(["c1"]);
    expect(queue.protectedRows.map((r) => `${r.id}:${r.field}`)).toEqual(["c3:seo_title"]);
  });

  it("keeps the two protected reasons apart, as the products queue does", () => {
    const queue = buildCollectionSeoQueue([
      collection({ id: "c1", seo: { title: "Set by the merchant", description: null } }),
      collection({
        id: "c2",
        seo: { title: "Edited here", description: null },
        metafields: state({ seo_title: { source: "human", at: "2026-09-01T00:00:00Z" } }),
      }),
      collection({
        id: "c3",
        seo: { title: "Written by us", description: null },
        metafields: state({ seo_title: { source: "auto", at: "2026-09-01T00:00:00Z" } }),
      }),
    ]);

    expect(queue.outsideApp).toBe(1);
    expect(queue.editedByYou).toBe(1);
    expect(queue.writtenByApp).toBe(1);
  });

  it("condenses the collection's own words and invents nothing", () => {
    const queue = buildCollectionSeoQueue([collection()]);
    const row = queue.rows[0];

    expect(row.titleSuggestion).toBe("Mese de sufragerie");
    // Its own opening sentence, and no attribute clauses: a collection has no
    // facts, so there is nothing else to condense.
    expect(row.descriptionSuggestion).toBe(
      "Mese din lemn masiv pentru sufragerie.",
    );
    expect(row.descriptionSuggestion).not.toContain("Key details");
  });

  it("truncates a long title at a word boundary, on the collection budget", () => {
    const long = "Mese de sufragerie din lemn masiv de stejar pentru apartamente mici si case mari";
    const queue = buildCollectionSeoQueue([collection({ title: long })]);
    const suggestion = queue.rows[0].titleSuggestion!;

    expect(suggestion.length).toBeLessThanOrEqual(COLLECTION_TITLE_TARGET);
    expect(long.startsWith(suggestion)).toBe(true);
    // Never mid-word, and never an ellipsis character (CLAUDE.md).
    expect(suggestion.endsWith("...")).toBe(false);
    expect(long[suggestion.length]).toBe(" ");
  });

  it("proposes no description for a collection that has no words of its own", () => {
    // Found by running this against the dev store, 5 September 2026. Both its
    // collections have no description, and buildMetaDescription falls back to
    // the title with a full stop - so "Sofas" would have been offered "Sofas."
    // as its meta description, a duplicate of the meta title rather than a
    // description of anything. This app condenses the merchant's words; where
    // there are none, it proposes nothing.
    const queue = buildCollectionSeoQueue([
      collection({ title: "Sofas", handle: "sofas", descriptionHtml: "" }),
    ]);
    const row = queue.rows[0];

    expect(row.titleSuggestion).toBe("Sofas");
    expect(row.descriptionSuggestion).toBeNull();
    // And the absent field is still reported: A6 fires on it, so the merchant
    // is told what is missing even though this app will not fill it.
    expect(queue.missingDescription).toBe(1);
    expect(queue.withFinding).toBe(1);
  });

  it("treats a description of only markup as no words at all", () => {
    const queue = buildCollectionSeoQueue([
      collection({ descriptionHtml: "<p></p><br>" }),
    ]);
    expect(queue.rows[0].descriptionSuggestion).toBeNull();
  });

  it("proposes nothing at all for an empty shop", () => {
    const queue = buildCollectionSeoQueue([]);
    expect(queue).toMatchObject({ checked: 0, withFinding: 0, rows: [], protectedRows: [] });
  });
});

describe("the writer's two guards", () => {
  it("never overwrites a field a human wrote, and sends no mutation at all", async () => {
    const graphql = vi.fn();
    const node = collection({
      seo: { title: "Written by the merchant", description: null },
      metafields: state({ seo_title: { source: "human", at: "2026-09-01T00:00:00Z" } }),
    });

    const outcome = await writeCollectionSeo(graphql as never, node, {
      seo_title: { value: "Ours", source: "auto" },
    });

    expect(outcome).toEqual({ written: [], skipped: ["seo_title"], unchanged: [] });
    // Not merely "did not change it": the mutation is never sent, so the
    // collection is not marked updated and no webhook of ours fires.
    expect(graphql).not.toHaveBeenCalled();
  });

  it("never overwrites a value set outside this app", async () => {
    const graphql = vi.fn();
    const node = collection({ seo: { title: "From an import", description: null } });

    const outcome = await writeCollectionSeo(graphql as never, node, {
      seo_title: { value: "Ours", source: "auto" },
    });

    expect(outcome.skipped).toEqual(["seo_title"]);
    expect(graphql).not.toHaveBeenCalled();
  });

  it("never writes an identical value", async () => {
    const graphql = vi.fn();
    const node = collection({
      seo: { title: "Mese de sufragerie", description: null },
      metafields: state({ seo_title: { source: "auto", at: "2026-09-01T00:00:00Z", prev: "" } }),
    });

    const outcome = await writeCollectionSeo(graphql as never, node, {
      seo_title: { value: "Mese de sufragerie", source: "auto" },
    });

    expect(outcome).toEqual({ written: [], skipped: [], unchanged: ["seo_title"] });
    // The self-feed rule: writing marks the collection updated, and an update
    // we caused is an update we would react to.
    expect(graphql).not.toHaveBeenCalled();
  });

  it("writes both subfields together and captures prev on the first write", async () => {
    const calls: { query: string; vars: any }[] = [];
    const graphql = vi.fn(async (query: string, vars: any) => {
      calls.push({ query, vars });
      return { collectionUpdate: { userErrors: [] }, metafieldsSet: { userErrors: [] } };
    });
    const node = collection({ seo: { title: "", description: "Kept as it is." } });

    const outcome = await writeCollectionSeo(graphql as never, node, {
      seo_title: { value: "Mese de sufragerie", source: "auto" },
    });

    expect(outcome.written).toEqual(["seo_title"]);
    // Both subfields, always: the Admin API's behaviour when only one is sent
    // is not documented, so the untouched one is filled from the live value.
    expect(calls[0].vars.input.seo).toEqual({
      title: "Mese de sufragerie",
      description: "Kept as it is.",
    });

    const stateValue = JSON.parse(calls[1].vars.metafields[0].value);
    expect(stateValue.seo_title.source).toBe("auto");
    // Empty before this app touched it, so revert restores empty.
    expect(stateValue.seo_title.prev).toBe("");
  });

  it("keeps the original prev when it regenerates a value it wrote before", async () => {
    const calls: any[] = [];
    const graphql = vi.fn(async (_q: string, vars: any) => {
      calls.push(vars);
      return { collectionUpdate: { userErrors: [] }, metafieldsSet: { userErrors: [] } };
    });
    const node = collection({
      seo: { title: "Our first attempt", description: null },
      metafields: state({
        seo_title: { source: "auto", at: "2026-09-01T00:00:00Z", prev: "What the merchant had" },
      }),
    });

    await writeCollectionSeo(graphql as never, node, {
      seo_title: { value: "Our second attempt", source: "auto" },
    });

    const stateValue = JSON.parse(calls[1].metafields[0].value);
    // Revert must always mean "as it was before this app touched it", however
    // many times the value is regenerated afterwards.
    expect(stateValue.seo_title.prev).toBe("What the merchant had");
  });

  it("throws rather than reporting success when Shopify refuses the update", async () => {
    const graphql = vi.fn(async () => ({
      collectionUpdate: { userErrors: [{ field: "seo", message: "nope" }] },
    }));
    const node = collection();

    await expect(
      writeCollectionSeo(graphql as never, node, {
        seo_title: { value: "Mese", source: "auto" },
      }),
    ).rejects.toThrow(/collectionUpdate/);
  });
});

describe("revert", () => {
  it("puts back what was there before this app wrote, and drops the state entry", async () => {
    const calls: any[] = [];
    const graphql = vi.fn(async (_q: string, vars: any) => {
      calls.push(vars);
      return { collectionUpdate: { userErrors: [] }, metafieldsSet: { userErrors: [] } };
    });
    const node = collection({
      seo: { title: "Ours", description: "Also ours" },
      metafields: state({
        seo_title: { source: "auto", at: "2026-09-01T00:00:00Z", prev: "Theirs" },
      }),
    });

    const reverted = await revertCollectionSeo(graphql as never, node, [
      "seo_title",
      "seo_description",
    ]);

    expect(reverted).toEqual(["seo_title"]);
    expect(calls[0].input.seo).toEqual({ title: "Theirs", description: "Also ours" });
    expect(JSON.parse(calls[1].metafields[0].value).seo_title).toBeUndefined();
  });

  it("does nothing, and sends nothing, for a field this app never wrote", async () => {
    const graphql = vi.fn();
    const reverted = await revertCollectionSeo(graphql as never, collection(), ["seo_title"]);
    expect(reverted).toEqual([]);
    expect(graphql).not.toHaveBeenCalled();
  });
});
