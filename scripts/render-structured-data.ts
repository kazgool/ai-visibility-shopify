// Read-only. Renders the storefront's structured data for one Republica BIO
// product, before and after CC-PROMPT-AI-READABILITY-4, and prints the
// Product and Organization nodes as JSON (item 5: "Before/after of the
// rendered Product and Organization nodes for Republica BIO data").
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/render-structured-data.ts [git-ref-for-before]
//
// "Before" is the head block at the given ref (default e357304, the last
// commit before this batch); "after" is the head block and the content embed
// in the working tree. Full mode, a theme with no Product node of its own,
// and the theme scan having seen our node - Republica BIO's case on 11
// September 2026.
//
// The data: the m31 collagen creamer as the corpus read it
// (_shopify/corpus/stores/republicabio.ro.json) with the facts the engine
// extracted in dev run 13, and Republica BIO's business record as
// scripts/corpus-stores.ts states it (their live page's wording on 11
// September), read into numbers the way saveBusiness does. The record Marius
// saves on the Business screen may be worded differently; the screen's line
// says what it publishes. Nothing is fetched and nothing is written.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Liquid } from "liquidjs";
import { readDeliveryCost, readDeliveryTime } from "../app/services/delivery-parse";
import { CORPUS_STORES } from "./corpus-stores";

const BEFORE_REF = process.argv[2] ?? "e357304";
const HANDLE = "m31-true-collagen-creamer-molecules-of-youth-15-plicuri-105-g-natural";
const EXTENSION = "extensions/ai-visibility";
const SCHEMA_TAG = /{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/;
const MARKER = "https://mrdigital.ro/ns/ai-visibility";

function engine(): Liquid {
  const liquid = new Liquid({ root: [path.join(EXTENSION, "snippets")], extname: ".liquid", strictVariables: false });
  liquid.registerFilter("json", (value: unknown) => JSON.stringify(value === undefined ? null : value));
  liquid.registerFilter("image_url", () => "//cdn.shopify.com/files/m31.jpg");
  liquid.registerFilter("t", (key: string) => key);
  return liquid;
}

function ldObjects(html: string): any[] {
  const out: any[] = [];
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    out.push(JSON.parse(match[1]));
  }
  return out;
}

const store = JSON.parse(fs.readFileSync("_shopify/corpus/stores/republicabio.ro.json", "utf8"));
const raw = store.products.find((p: any) => p.handle === HANDLE);
if (!raw) throw new Error(`${HANDLE} is not in the corpus read`);
const run = JSON.parse(fs.readFileSync("_shopify/corpus/runs/dev13/republicabio.ro.json", "utf8"));
const facts = run.products.find((p: any) => p.handle === HANDLE)?.facts ?? [];

const text = CORPUS_STORES.find((s) => s.name === "republicabio.ro")!.business!;
const saved = {
  ...text,
  deliveryCostParsed: text.deliveryCost ? readDeliveryCost(text.deliveryCost, "RON").parsed : undefined,
  deliveryTimeParsed: readDeliveryTime(text.deliveryTime ?? "") ?? undefined,
};

function context(business: Record<string, unknown>) {
  const variant = raw.variants?.[0] ?? {};
  return {
    template: { name: "product" },
    block: { settings: { enabled: true, mode: "full", mirror: true, llms_link: true, lift_snippets: true } },
    cart: { currency: { iso_code: "RON" } },
    shop: {
      name: "Republica BIO",
      url: "https://republicabio.ro",
      address: { country_code: "RO" },
      metafields: {
        $app: {
          business: { value: business },
          theme_scan: { value: { productId: "", hasProductLd: false, ourProductNode: true } },
          seo_unlocked: { value: false },
        },
      },
    },
    product: {
      title: raw.title,
      handle: raw.handle,
      url: `/products/${raw.handle}`,
      description: raw.body_html ?? "",
      vendor: raw.vendor,
      featured_image: raw.images?.[0]?.src ?? null,
      price_varies: false,
      available: true,
      variants: { size: raw.variants?.length ?? 1 },
      collections: { first: null },
      selected_or_first_available_variant: {
        sku: variant.sku ?? "",
        barcode: variant.barcode ?? "",
        price: Math.round(Number(variant.price ?? 0) * 100),
      },
      metafields: { $app: { facts: { value: facts } }, reviews: {} },
    },
  };
}

async function render(source: string, ctx: Record<string, unknown>): Promise<any[]> {
  return ldObjects(await engine().parseAndRender(source.replace(SCHEMA_TAG, ""), ctx));
}

function show(label: string, nodes: any[]) {
  const picked = nodes.filter((n) => n[MARKER] !== undefined && (n["@type"] === "Product" || n["@type"] === "Organization"));
  console.log(`\n=== ${label} ===`);
  if (picked.length === 0) console.log("(no Product or Organization node from this app)");
  for (const node of picked) console.log(JSON.stringify(node, null, 2));
}

async function main() {
  const beforeHead = execSync(`git show ${BEFORE_REF}:${EXTENSION}/blocks/ai-visibility.liquid`, { encoding: "utf8" });
  const afterHead = fs.readFileSync(`${EXTENSION}/blocks/ai-visibility.liquid`, "utf8");
  const afterBody = fs.readFileSync(`${EXTENSION}/blocks/ai-visibility-content.liquid`, "utf8");

  console.log(`Product: ${raw.title}`);
  console.log(`Business record (text): ${JSON.stringify(text)}`);
  console.log(`Read on save: ${JSON.stringify({ deliveryCostParsed: saved.deliveryCostParsed, deliveryTimeParsed: saved.deliveryTimeParsed })}`);

  show(`BEFORE (${BEFORE_REF}): head block`, await render(beforeHead, context(text)));
  show("AFTER: head block", await render(afterHead, context(saved)));
  const bodyCtx = {
    ...context(saved),
    block: {
      settings: {
        heading: "",
        heading_level: "h2",
        show_summary: true,
        show_facts: true,
        show_fit: true,
        show_questions: false,
        show_links: false,
        manual_placement: false,
      },
    },
  };
  show("AFTER: content embed (the facts fragment, same @id as the head node)", await render(afterBody, bodyCtx));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
