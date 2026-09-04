// Renders every JSON-LD node in the storefront block against a matrix of
// present and absent fields and parses each result as JSON. Any combination
// that does not parse fails the run.
//
// This exists because of a defect nothing in the repo could catch. The
// extend-mode Product node gave every optional field a trailing comma and the
// last one none, so a product with a summary and no facts rendered
// `"description": "...",}` - invalid JSON, which every parser drops silently.
// For those products the app published nothing at all and no screen said so.
// Found by reading the template on 4 September 2026, not by a test.
//
// Why no existing check saw it: `check-liquid.mjs` looks for literal braces
// inside output tags, the unit tests never render Liquid, `shopify app deploy`
// parses Liquid syntax and not the JSON the template produces, and the app's own
// page scan reads whatever the storefront returns - a dropped node looks exactly
// like a theme that never emitted one. The only way to catch it is to render the
// template and parse the output, which is what this does.
//
//   node scripts/check-liquid-json.mjs [path-to-liquid]
//
// With no argument it checks the block in extensions/. A path is accepted so an
// older revision can be measured:
//   git show HEAD:extensions/ai-visibility/blocks/ai-visibility.liquid > old.liquid
//
// It prints counts only - no product data - and its fixtures are invented.

import { readFileSync } from "node:fs";
import { Liquid } from "liquidjs";

const FILE =
  process.argv[2] ?? "extensions/ai-visibility/blocks/ai-visibility.liquid";

// --- the engine -------------------------------------------------------------

const engine = new Liquid({ strictFilters: false, strictVariables: false });

// Shopify's `json` filter. Nil becomes null, exactly as the platform does, so a
// missing value produces valid JSON rather than an empty token.
engine.registerFilter("json", (value) =>
  JSON.stringify(value === undefined ? null : value),
);

// Shopify's image_url takes named arguments; the URL it returns does not matter
// here, only that it is a string the `json` filter can encode.
engine.registerFilter("image_url", () => "//cdn.example/files/x.jpg");

// --- the nodes --------------------------------------------------------------

/** Every ld+json script body in the template, with the line it starts on. */
function nodesOf(source) {
  const out = [];
  const pattern =
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split("\n").length;
    out.push({ line, body: match[1] });
  }
  return out;
}

// --- the matrix -------------------------------------------------------------

/**
 * One switch a merchant's data can flip, and the two states it can be in.
 *
 * `probe` is what marks the field as referenced by a node body, so a node is
 * only permuted over the switches it actually reads - otherwise the matrix is
 * the product of every switch in the file and most of it is redundant.
 */
const SWITCHES = [
  { probe: "av_summary", on: { av_summary: "A short summary." }, off: { av_summary: "" } },
  { probe: "av_fit", on: { av_fit: "small kitchens" }, off: { av_fit: "" } },
  {
    probe: "av_facts",
    on: { av_facts: [{ k: "Material", v: "Oak" }, { k: "Width", v: "80 cm" }] },
    off: { av_facts: null },
  },
  {
    // One fact as well as two: the forloop's `unless forloop.last` comma is a
    // separate branch and a single-item list is where that goes wrong.
    probe: "av_facts",
    on: { av_facts: [{ k: "Material", v: "Oak" }] },
    off: { av_facts: null },
  },
  {
    probe: "av_rating",
    on: { av_rating: { value: 4.5 }, av_rating_count: 12 },
    off: { av_rating: null, av_rating_count: 0 },
  },
  { probe: "av_seo_unlocked", on: { av_seo_unlocked: true }, off: { av_seo_unlocked: false } },
  { probe: "av_org_id", on: { av_org_id: "https://shop.example/#org" }, off: { av_org_id: "" } },
  {
    probe: "av_same_as_list",
    on: { av_same_as_list: ["https://a.example", "https://b.example"] },
    off: { av_same_as_list: [] },
  },
  {
    probe: "av_questions",
    on: { av_questions: [{ q: "Q1", a: "A1" }, { q: "Q2", a: "A2" }] },
    off: { av_questions: [] },
  },
  {
    probe: "av_c_criteria",
    on: { av_c_criteria: ["Size", "Finish"] },
    off: { av_c_criteria: [] },
  },
  {
    probe: "av_c_questions",
    on: { av_c_questions: [{ q: "Q1", a: "A1" }] },
    off: { av_c_questions: [] },
  },
  {
    probe: "av_business.deliveryTime",
    on: { av_business: { deliveryTime: "2 to 4 days", deliveryVaries: false, returnDays: 30 } },
    off: { av_business: { deliveryTime: "", deliveryVaries: false, returnDays: 30 } },
  },
  {
    probe: "av_business.returnDays",
    on: { av_business: { deliveryTime: "2 to 4 days", deliveryVaries: false, returnDays: 30 } },
    off: { av_business: { deliveryTime: "2 to 4 days", deliveryVaries: false, returnDays: null } },
  },
  {
    probe: "featured_image",
    on: { __image: "//cdn.example/x.jpg" },
    off: { __image: null },
  },
  { probe: "product.vendor", on: { __vendor: "Acme" }, off: { __vendor: "" } },
  { probe: "sku", on: { __sku: "SKU-1" }, off: { __sku: "" } },
  { probe: "barcode", on: { __barcode: "0123456789012" }, off: { __barcode: "" } },
  { probe: "price_varies", on: { __priceVaries: true }, off: { __priceVaries: false } },
  { probe: "product.available", on: { __available: true }, off: { __available: false } },
  {
    probe: "av_bc_collection",
    on: { __collection: { title: "Chairs", url: "/collections/chairs", products_count: 3, products: [] } },
    off: { __collection: null },
  },
];

/** The context every render starts from. Invented data, no catalogue. */
function baseContext(patch) {
  const image = patch.__image ?? null;
  const collection = patch.__collection === undefined ? { title: "Chairs", url: "/collections/chairs", products_count: 2, products: [{ title: "P1", url: "/products/p1" }, { title: "P2", url: "/products/p2" }] } : patch.__collection;
  return {
    shop: { name: "Shop", url: "https://shop.example" },
    cart: { currency: { iso_code: "RON" } },
    template: { name: "product" },
    block: { settings: { mode: "extend", enabled: true, mirror: true, llms_link: true, lift_snippets: true } },
    product: {
      title: "A chair",
      url: "/products/a-chair",
      description: "<p>A chair.</p>",
      vendor: patch.__vendor ?? "Acme",
      featured_image: image,
      price_varies: patch.__priceVaries ?? false,
      available: patch.__available ?? true,
      price_min: 10000,
      price_max: 20000,
      variants: { size: 2 },
      collections: { first: collection },
      selected_or_first_available_variant: {
        sku: patch.__sku ?? "SKU-1",
        barcode: patch.__barcode ?? "0123456789012",
        price: 12345,
      },
    },
    collection,
    av_bc_collection: collection,
    av_own_org_id: "https://shop.example/#organization",
    av_price_valid_until: "2027-01-01",
    av_c_summary: "A collection summary.",
    av_summary: "A short summary.",
    av_fit: "small kitchens",
    av_facts: [{ k: "Material", v: "Oak" }],
    av_rating: { value: 4.5 },
    av_rating_count: 12,
    av_seo_unlocked: true,
    av_org_id: "",
    av_same_as_list: ["https://a.example"],
    av_questions: [{ q: "Q1", a: "A1" }],
    av_c_criteria: ["Size"],
    av_c_questions: [{ q: "Q1", a: "A1" }],
    av_business: { deliveryTime: "2 to 4 days", deliveryVaries: false, returnDays: 30 },
    ...patch,
  };
}

async function main() {
  const source = readFileSync(FILE, "utf8");
  const nodes = nodesOf(source);
  if (nodes.length === 0) {
    console.error(`check-liquid-json: no ld+json blocks found in ${FILE}`);
    process.exit(1);
  }

  let combinations = 0;
  const failures = [];

  for (const node of nodes) {
    const relevant = SWITCHES.filter((s) => node.body.includes(s.probe));
    const count = 2 ** relevant.length;
    const seen = new Set();

    for (let mask = 0; mask < count; mask += 1) {
      const patch = {};
      const states = [];
      relevant.forEach((s, index) => {
        const on = (mask >> index) & 1;
        Object.assign(patch, on ? s.on : s.off);
        states.push(`${s.probe}=${on ? "on" : "off"}`);
      });

      let rendered;
      try {
        rendered = await engine.parseAndRender(node.body, baseContext(patch));
      } catch (error) {
        failures.push({ line: node.line, states, reason: `Liquid: ${error.message}` });
        combinations += 1;
        continue;
      }
      combinations += 1;

      // Identical output from two combinations is one thing to parse.
      if (seen.has(rendered)) continue;
      seen.add(rendered);

      try {
        JSON.parse(rendered);
      } catch (error) {
        failures.push({ line: node.line, states, reason: error.message });
      }
    }
  }

  console.log(
    `check-liquid-json: ${nodes.length} nodes, ${combinations} combinations of present and absent fields.`,
  );

  if (failures.length === 0) {
    console.log("check-liquid-json: every combination parses as JSON.");
    return;
  }

  // One line per distinct node and reason, with the combination that produced
  // it: a hundred identical failures from one node is one defect.
  const grouped = new Map();
  for (const failure of failures) {
    const key = `${failure.line}|${failure.reason}`;
    if (!grouped.has(key)) grouped.set(key, { ...failure, count: 0 });
    grouped.get(key).count += 1;
  }
  console.error(
    `check-liquid-json: ${failures.length} of ${combinations} combinations do NOT parse.`,
  );
  for (const failure of grouped.values()) {
    console.error(
      `  ${FILE}:${failure.line} - ${failure.count} combination(s): ${failure.reason}`,
    );
    console.error(`    first: ${failure.states.join(" ")}`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(`check-liquid-json: ${error?.stack ?? error}`);
  process.exit(1);
});
