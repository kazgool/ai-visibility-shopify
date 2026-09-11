// Renders the theme app extension's Liquid in a test, the way
// scripts/check-liquid-json.mjs renders its node bodies, but whole: every
// branch, assign and render tag, so a test can count the nodes a page gets and
// read the visible markup a block prints. Invented data, no catalogue.
//
// Not a Shopify renderer. It knows the three filters the blocks use that
// liquidjs lacks (json, image_url; escape and the rest are built in) and strips
// the schema tag, which liquidjs does not know and which renders nothing on
// Shopify either. Differences from Shopify's Ruby Liquid that matter here are
// covered by the tests themselves: nil compared to false is false in both.

import { readFileSync } from "node:fs";
import path from "node:path";
import { Liquid } from "liquidjs";
import { extractLdObjects, OUR_NODE_MARKER } from "../theme-scan.server";

const EXTENSION = path.resolve("extensions/ai-visibility");
const SCHEMA_TAG = /{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/;

/** The storefront locale file for a language: en is en.default.json. */
export function storefrontLocale(locale: string): Record<string, unknown> {
  const file = locale === "en" ? "en.default.json" : `${locale}.json`;
  return JSON.parse(readFileSync(path.join(EXTENSION, "locales", file), "utf8"));
}

function engine(locale: string): Liquid {
  const liquid = new Liquid({
    root: [path.join(EXTENSION, "snippets")],
    extname: ".liquid",
    strictFilters: true,
    strictVariables: false,
  });
  // Shopify's json filter: nil becomes null.
  liquid.registerFilter("json", (value: unknown) => JSON.stringify(value === undefined ? null : value));
  liquid.registerFilter("image_url", () => "//cdn.example/files/x.jpg");
  // Shopify's t filter against the extension's own locale files, for one
  // storefront language. A key the file lacks prints what Shopify prints, so
  // a test sees the failure a shopper would.
  const strings = storefrontLocale(locale);
  liquid.registerFilter("t", (key: string, ...args: unknown[]) => {
    const value = key.split(".").reduce<any>((node, part) => node?.[part], strings);
    if (typeof value !== "string") return `translation missing: ${locale}.${key}`;
    const vars = Object.fromEntries(args.filter(Array.isArray) as [string, unknown][]);
    return value.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(vars[name] ?? ""));
  });
  return liquid;
}

/** A block's source with its schema removed. */
export function blockSource(file: string): string {
  return readFileSync(path.join(EXTENSION, "blocks", file), "utf8").replace(SCHEMA_TAG, "");
}

/** The settings a block's schema declares, with their defaults. */
export function blockDefaults(file: string): Record<string, unknown> {
  const raw = readFileSync(path.join(EXTENSION, "blocks", file), "utf8");
  const match = raw.match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/);
  if (!match) throw new Error(`${file} has no schema`);
  const schema = JSON.parse(match[1]) as { settings?: { id?: string; default?: unknown }[] };
  const out: Record<string, unknown> = {};
  for (const s of schema.settings ?? []) if (s.id) out[s.id] = s.default ?? false;
  return out;
}

/** `locale` is the storefront's language; "en" reads en.default.json. */
export async function renderBlock(
  file: string,
  context: Record<string, unknown>,
  locale = "en",
): Promise<string> {
  return engine(locale).parseAndRender(blockSource(file), context);
}

/** Every JSON-LD object on the rendered output, @graph flattened. Throws on invalid JSON. */
export function ldObjects(html: string): any[] {
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    JSON.parse(match[1]);
  }
  return extractLdObjects(html);
}

export function ourNodes(html: string, type: string): any[] {
  return ldObjects(html).filter((n) => n["@type"] === type && n[OUR_NODE_MARKER] !== undefined);
}

export type ProductData = {
  summary?: string | null;
  facts?: { k: string; v: string }[] | null;
  fitFor?: string | null;
  questions?: { q: string; a: string }[] | null;
};

export const SHOP_URL = "https://shop.example";

/** A storefront render context: a product page unless `template` says otherwise. */
export function storefront(options: {
  template?: string;
  settings?: Record<string, unknown>;
  themeScan?: Record<string, unknown> | null;
  data?: ProductData;
  collection?: Record<string, unknown> | null;
  seoUnlocked?: boolean;
  /** Dictionary group labels the facts list leaves out ($app.facts_display). */
  hiddenGroups?: string[] | null;
  /** The $app.business shop metafield (the Business screen's record). */
  business?: Record<string, unknown>;
  /** shop.address.country_code; "RO" unless given, null for none. */
  countryCode?: string | null;
  /** The visitor's currency (cart.currency.iso_code); "RON" unless given. */
  currency?: string;
}): Record<string, unknown> {
  const data = options.data ?? {};
  const mf = (value: unknown) => (value === undefined || value === null ? undefined : { value });
  return {
    template: { name: options.template ?? "product" },
    block: { settings: options.settings ?? {} },
    cart: { currency: { iso_code: options.currency ?? "RON" } },
    shop: {
      name: "Nordwood",
      url: SHOP_URL,
      address: { country_code: options.countryCode === undefined ? "RO" : options.countryCode },
      metafields: {
        $app: {
          theme_scan: mf(options.themeScan),
          business: { value: options.business ?? {} },
          seo_unlocked: { value: options.seoUnlocked ?? false },
          facts_display: options.hiddenGroups ? { value: { hidden: options.hiddenGroups } } : undefined,
        },
      },
    },
    product: {
      title: "Oak chair",
      handle: "oak-chair",
      url: "/products/oak-chair",
      description: "<p>A solid oak chair &amp; cushion.</p>",
      vendor: "Nordwood",
      featured_image: null,
      price_varies: false,
      available: true,
      variants: { size: 1 },
      collections: { first: null },
      selected_or_first_available_variant: { sku: "OAK-1", barcode: "", price: 12900 },
      metafields: {
        $app: {
          summary: mf(data.summary),
          facts: mf(data.facts),
          fit_for: mf(data.fitFor),
          questions: mf(data.questions),
        },
        reviews: {},
      },
    },
    collection: options.collection ?? null,
  };
}
