import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blockDefaults, renderBlock, SHOP_URL, storefront, storefrontLocale } from "./liquid-harness";

// CC-PROMPT-AI-READABILITY-2 item 6: every fixed string the extension prints
// on a storefront comes from its locale files, and a Romanian storefront shows
// no English one.

const EXTENSION = path.resolve("extensions/ai-visibility");
const LOCALES = path.join(EXTENSION, "locales");
const EMBED = "ai-visibility-content.liquid";
const defaults = blockDefaults(EMBED);

const readJson = (file: string) => JSON.parse(readFileSync(path.join(LOCALES, file), "utf8"));

/** Every leaf key of a locale file, dotted. */
function leaves(tree: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    value && typeof value === "object"
      ? leaves(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function liquidFiles(): string[] {
  return ["blocks", "snippets"].flatMap((dir) =>
    readdirSync(path.join(EXTENSION, dir)).map((f) => path.join(EXTENSION, dir, f)),
  );
}

// The English the content blocks and snippets used to print as fixed text.
const ENGLISH = [
  "About this product",
  "About this collection",
  "Suits",
  "Plain-text version of this page",
  "All products as plain text",
  "product comparison",
  "Product",
];

/** Visible text and attribute-free markup, whitespace collapsed. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const RO_PRODUCT = {
  summary: "Supliment alimentar ecologic din radacina de ashwagandha.",
  facts: [
    { k: "Forma", v: "capsule" },
    { k: "Gramaj", v: "29,7 g" },
  ],
  fitFor: "adulti",
  questions: [{ q: "Ce forma are Ashwagandha?", a: "capsule." }],
};

function roCollection() {
  const mf = (value: unknown) => ({ value });
  return {
    title: "Suplimente & ceaiuri",
    handle: "suplimente",
    url: "/collections/suplimente",
    metafields: {
      $app: {
        summary: mf("Suplimente are 12 produse."),
        criteria: mf(["Forma: capsule, pudra"]),
        questions: mf([{ q: "Câte produse sunt în Suplimente?", a: "12 produse." }]),
        table: mf({
          columns: ["Forma"],
          rows: [{ title: "Ashwagandha", handle: "ashwagandha", cells: ["capsule"] }],
        }),
      },
    },
  };
}

describe("the locale files", () => {
  it("carry the same keys in English and Romanian, storefront and schema alike", () => {
    expect(leaves(readJson("ro.json")).sort()).toEqual(leaves(readJson("en.default.json")).sort());
    expect(leaves(readJson("ro.schema.json")).sort()).toEqual(
      leaves(readJson("en.default.schema.json")).sort(),
    );
  });

  it("have every key the blocks and snippets translate, in both languages", () => {
    const storefrontKeys = new Set<string>();
    const schemaKeys = new Set<string>();
    for (const file of liquidFiles()) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/'([a-z_.]+)'\s*\|\s*t\b/g)) storefrontKeys.add(m[1]);
      for (const m of src.matchAll(/"t:([a-z_.0-9]+)"/g)) schemaKeys.add(m[1]);
    }
    expect(storefrontKeys.size).toBeGreaterThan(0);
    expect(schemaKeys.size).toBeGreaterThan(0);
    for (const [files, keys] of [
      [["en.default.json", "ro.json"], storefrontKeys],
      [["en.default.schema.json", "ro.schema.json"], schemaKeys],
    ] as const) {
      for (const file of files) {
        const have = new Set(leaves(readJson(file)));
        expect([...keys].filter((k) => !have.has(k)), file).toEqual([]);
      }
    }
  });

  it("write plain characters only", () => {
    for (const file of readdirSync(LOCALES)) {
      const raw = readFileSync(path.join(LOCALES, file), "utf8");
      expect(raw, file).not.toMatch(/[–—‘’“”…]|&#?\w+;/);
    }
  });
});

describe("a Romanian storefront", () => {
  it("prints the product block in Romanian, with no English fixed string", async () => {
    const html = await renderBlock(EMBED, storefront({ settings: defaults, data: RO_PRODUCT }), "ro");
    const t = text(html);
    expect(html).toMatch(/<h2[^>]*>Despre acest produs<\/h2>/);
    expect(t).toContain("Potrivit pentru: adulti");
    expect(html).toContain(`<a href="${SHOP_URL}/apps/ai-visibility/oak-chair">Versiunea text a acestei pagini</a>`);
    expect(html).toContain(`<a href="${SHOP_URL}/apps/ai-visibility/llms.txt">Toate produsele, în format text</a>`);
    for (const english of ENGLISH) expect(t, english).not.toContain(english);
    expect(html).not.toContain("translation missing");
  });

  it("prints the collection block in Romanian: heading, caption and first column", async () => {
    const html = await renderBlock(
      EMBED,
      storefront({ template: "collection", collection: roCollection(), settings: defaults }),
      "ro",
    );
    const t = text(html);
    expect(html).toMatch(/<h2[^>]*>Despre această colecție<\/h2>/);
    expect(html).toContain('<caption class="visually-hidden">Suplimente &amp; ceaiuri: comparație între produse</caption>');
    expect(t).toMatch(/Produs Forma/);
    for (const english of ENGLISH) expect(t, english).not.toContain(english);
    expect(html).not.toContain("translation missing");
  });

  it("prints the merchant's own heading as typed, in either language", async () => {
    for (const locale of ["en", "ro"]) {
      const html = await renderBlock(
        EMBED,
        storefront({ settings: { ...defaults, heading: "Fișa produsului" }, data: RO_PRODUCT }),
        locale,
      );
      expect(html).toMatch(/<h2[^>]*>Fișa produsului<\/h2>/);
    }
  });

  it("translates the comparison block's caption too, and keeps the merchant's column label", async () => {
    const html = await renderBlock(
      "comparison-table.liquid",
      storefront({
        template: "collection",
        collection: roCollection(),
        settings: { ...blockDefaults("comparison-table.liquid"), product_column: "Denumire" },
      }),
      "ro",
    );
    expect(html).toContain("Suplimente &amp; ceaiuri: comparație între produse");
    expect(text(html)).toContain("Denumire Forma");
  });

  it("renders against the extension's own Romanian file, not a stub", () => {
    expect(storefrontLocale("ro")).toHaveProperty("content.heading_product", "Despre acest produs");
  });
});
