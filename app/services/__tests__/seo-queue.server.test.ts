import { describe, it, expect } from "vitest";
import { buildSeoQueue, type SeoQueueProduct } from "../seo.server";
import { stopwordSet } from "../../engine/stopwords";

const stopwords = stopwordSet();

function product(overrides: Partial<SeoQueueProduct> = {}): SeoQueueProduct {
  return {
    id: "gid://shopify/Product/1",
    handle: "oak-dining-table",
    title: "Oak Dining Table",
    descriptionHtml: "<p>A solid oak dining table for six.</p>",
    vendor: "Acme",
    metafields: [],
    seo: { title: null, description: null },
    facts: [{ k: "Material", v: "oak" }],
    ...overrides,
  };
}

describe("buildSeoQueue", () => {
  it("proposes both fields for a product with both empty and unprotected", () => {
    const queue = buildSeoQueue([product()], "Acme Store", stopwords);

    expect(queue.checked).toBe(1);
    expect(queue.missingTitle).toBe(1);
    expect(queue.missingDescription).toBe(1);
    expect(queue.outsideApp).toBe(0);
    expect(queue.protectedRows).toEqual([]);
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0].titleSuggestion).toBeTruthy();
    expect(queue.rows[0].descriptionSuggestion).toBeTruthy();
  });

  it("proposes only the description when the title is human-written and non-empty", () => {
    const state = { seo_title: { source: "human", at: "2026-01-01", prev: "" } };
    const p = product({
      seo: { title: "Hand-written title", description: "" },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });

    const queue = buildSeoQueue([p], null, stopwords);

    expect(queue.missingTitle).toBe(0); // not empty, so not counted as missing
    expect(queue.missingDescription).toBe(1);
    expect(queue.protectedRows).toEqual([]); // title is not empty, so it is not a "left blank" case
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0].titleSuggestion).toBeNull();
    expect(queue.rows[0].descriptionSuggestion).toBeTruthy();
  });

  it("puts a product protected on both empty fields into protectedRows, not rows", () => {
    const state = {
      seo_title: { source: "human", at: "2026-01-01", prev: "" },
      seo_description: { source: "human", at: "2026-01-01", prev: "" },
    };
    const p = product({
      seo: { title: "", description: "" },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });

    const queue = buildSeoQueue([p], null, stopwords);

    expect(queue.missingTitle).toBe(1);
    expect(queue.missingDescription).toBe(1);
    expect(queue.rows).toEqual([]);
    expect(queue.protectedRows).toHaveLength(2);
    expect(queue.protectedRows.map((r) => r.field).sort()).toEqual(["seo_description", "seo_title"]);
  });

  it("leaves a product that already carries our own auto value out of both rows and protectedRows", () => {
    const state = {
      seo_title: { source: "auto", at: "2026-01-01", prev: "" },
      seo_description: { source: "auto", at: "2026-01-01", prev: "" },
    };
    const p = product({
      seo: { title: "Oak Dining Table - Acme", description: "A solid oak dining table for six." },
      metafields: [{ key: "state", value: JSON.stringify(state) }],
    });

    const queue = buildSeoQueue([p], null, stopwords);

    expect(queue.missingTitle).toBe(0);
    expect(queue.missingDescription).toBe(0);
    expect(queue.outsideApp).toBe(0);
    expect(queue.rows).toEqual([]);
    expect(queue.protectedRows).toEqual([]);
  });

  it("counts a non-empty, unattributed field as outside the app and never proposes it", () => {
    const p = product({ seo: { title: "Set by a previous app", description: "" } });

    const queue = buildSeoQueue([p], null, stopwords);

    expect(queue.outsideApp).toBe(1);
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0].titleSuggestion).toBeNull();
    expect(queue.rows[0].descriptionSuggestion).toBeTruthy();
  });

  it("computes the term gap over the same catalogue read, without a second fetch", () => {
    const p = product({
      title: "Oak Dining Table",
      descriptionHtml: "<p>Finished with a durable varnish coating for daily use.</p>",
    });

    const queue = buildSeoQueue([p], null, stopwords);

    expect(queue.termGap.some((r) => r.term === "varnish")).toBe(true);
  });
});
