// Reading the catalogue at scale (PRD §5.5).
//
// One bulk operation exports every product as JSONL regardless of catalogue
// size. Never paginate a 10,000-product catalogue by hand: it burns the rate
// limit and takes minutes instead of seconds.

import db from "../db.server";
import type { GraphqlFn } from "./admin.server";
import { sleep } from "./admin.server";
import type { ProductInput, VariantInput } from "./facts.server";
import { NAMESPACE } from "./facts.server";
import { catalogueQuery, DEFAULT_PREFS } from "./eligibility";

const SHOP_INFO_SETTING_KEY = "shopInfo";

const RUN_BULK = `#graphql
  mutation RunBulk($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

// Both counts come back on the BulkOperation and both are needed: objectCount
// counts every JSONL line the export produced, rootObjectCount only the
// products at the root of the query. Comparing them against what was parsed is
// what tells a caller whether the download was whole, and a delete is only
// safe on a whole one.
const POLL_BULK = `#graphql
  query PollBulk {
    currentBulkOperation(type: QUERY) {
      id status errorCode objectCount rootObjectCount url
    }
  }
`;

// The filter is an argument rather than a constant because the merchant's
// "include unlisted products" toggle widens it (section J.4). Out of stock is
// never in it: the read has to return sold-out products so their pages can be
// withdrawn when that toggle is off, and so their metafields keep being
// maintained either way. `status` is on the node so eligibility is decided
// from the product's own fields on this path too, not assumed from the filter.
export function productsBulkQuery(filter: string): string {
  return `
  {
    products(query: "${filter}") {
      edges {
        node {
          id
          handle
          status
          title
          descriptionHtml
          vendor
          productType
          category { name }
          onlineStoreUrl
          featuredImage { url altText }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          totalInventory
          seo { title description }
          collections(first: 5) {
            edges { node { id handle title } }
          }
          metafields(namespace: "${NAMESPACE}", first: 10) {
            edges { node { key value } }
          }
          variants {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                availableForSale
                selectedOptions { name value }
                metafields(namespace: "${NAMESPACE}", first: 3) {
                  edges { node { key value } }
                }
              }
            }
          }
        }
      }
    }
  }
`;
}

const SINGLE_PRODUCT = `#graphql
  query OneProduct($id: ID!) {
    product(id: $id) {
      id
      handle
      status
      title
      descriptionHtml
      vendor
      productType
      category { name }
      onlineStoreUrl
      featuredImage { url altText }
      priceRangeV2 { minVariantPrice { amount currencyCode } }
      totalInventory
      seo { title description }
      collections(first: 5) {
        nodes { handle title }
      }
      metafields(namespace: "${NAMESPACE}", first: 10) {
        nodes { key value }
      }
      variants(first: 100) {
        nodes {
          id
          title
          sku
          barcode
          price
          compareAtPrice
          availableForSale
          selectedOptions { name value }
          metafields(namespace: "${NAMESPACE}", first: 3) {
            nodes { key value }
          }
        }
      }
    }
  }
`;

const SHOP_INFO = `#graphql
  query ShopInfo {
    shop {
      name
      primaryDomain { url }
    }
  }
`;

export type ShopInfo = { name: string; url: string };

/** Shop name and storefront URL, for the mirror's Store section. */
export async function fetchShopInfo(graphql: GraphqlFn): Promise<ShopInfo | null> {
  const data = await graphql<any>(SHOP_INFO);
  const shop = data?.shop;
  if (!shop?.name) return null;
  return { name: shop.name, url: shop.primaryDomain?.url ?? "" };
}

/**
 * Persist the last shop name and storefront URL fetched from the Admin API
 * to Setting (per-shop key/value, same table and same upsert shape as
 * business.server.ts), so llms.txt can read the shop name without an Admin
 * API call on the request path. Read back by llms-txt.server.ts, which keeps
 * its own copy of the "shopInfo" key rather than importing this module - see
 * the comment at the top of llms-txt.server.ts for why.
 */
export async function saveShopInfo(shopId: string, info: ShopInfo): Promise<void> {
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: SHOP_INFO_SETTING_KEY } },
    create: { shopId, key: SHOP_INFO_SETTING_KEY, value: JSON.stringify(info) },
    update: { value: JSON.stringify(info) },
  });
}

/**
 * Undefined, not false, when no variant row was in hand: a product always has
 * at least one variant, so an empty list means we did not read them, and the
 * mirror prints no availability line rather than claiming a sell-out.
 */
function availableFromVariants(
  variants: { availableForSale?: boolean }[],
): boolean | undefined {
  if (variants.length === 0) return undefined;
  return variants.some((v) => v.availableForSale === true);
}

export async function fetchProduct(
  graphql: GraphqlFn,
  id: string,
): Promise<ProductInput | null> {
  const data = await graphql<any>(SINGLE_PRODUCT, { id });
  const p = data?.product;
  if (!p) return null;
  const variants = (p.variants?.nodes ?? []).map((v: any) => ({
    id: v.id,
    title: v.title,
    sku: v.sku ?? null,
    barcode: v.barcode ?? null,
    price: v.price ?? null,
    compareAtPrice: v.compareAtPrice ?? null,
    availableForSale: v.availableForSale === true,
    selectedOptions: v.selectedOptions ?? [],
    metafields: (v.metafields?.nodes ?? []).map((n: any) => ({ key: n.key, value: n.value })),
  }));
  return {
    id: p.id,
    handle: p.handle,
    status: p.status,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    vendor: p.vendor,
    productType: p.productType,
    category: p.category?.name ?? null,
    onlineStoreUrl: p.onlineStoreUrl,
    price: p.priceRangeV2?.minVariantPrice?.amount ?? null,
    currency: p.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
    // Availability is asked of the variants, not of totalInventory. A product
    // with inventory tracking off, or with a variant whose policy is to keep
    // selling at zero, has totalInventory 0 while Shopify sells it - so the
    // old reading called made-to-order and dropshipped products out of stock.
    // availableForSale is Shopify's own answer to "can this be ordered right
    // now", and the mirror's availability line, the summary's out-of-stock
    // clause and the merchant's toggle now all read this one value.
    available: availableFromVariants(variants),
    sku: variants[0]?.sku ?? null,
    imageUrl: p.featuredImage?.url ?? null,
    imageAlt: p.featuredImage?.altText ?? null,
    metafields: (p.metafields?.nodes ?? []).map((n: any) => ({ key: n.key, value: n.value })),
    variants,
    collections: (p.collections?.nodes ?? []).map((c: any) => ({ handle: c.handle, title: c.title })),
    seo: p.seo ? { title: p.seo.title ?? null, description: p.seo.description ?? null } : null,
  };
}

/**
 * What one catalogue read produced, and whether it was whole.
 *
 * The bare array this used to be could not say the one thing a caller that
 * deletes has to know. A truncated download looks exactly like a catalogue
 * that shrank, and acting on the difference empties the mirror for a shop
 * whose products are all still on sale. Writers may act on a short read - a
 * write is idempotent and a missed product is caught next time - but a delete
 * may not.
 */
export type CatalogueRead = {
  products: ProductInput[];
  /**
   * True when the number of products parsed matches the number Shopify
   * announced. This is the flag a delete is allowed to act on; see the
   * comment where it is computed for why the object count does not vote.
   */
  complete: boolean;
  /**
   * Whether the object count matched too. Reported, never a veto: it is a
   * signal that Shopify's counting and this parser's counting have drifted,
   * which is worth seeing in a JobRun report and worth nobody's pages.
   */
  objectsMatch: boolean;
  /** From the bulk operation: rootObjectCount and objectCount. */
  expected: { root: number; objects: number };
  /** Products folded together, and non-empty JSONL lines parsed. */
  read: { root: number; objects: number };
};

/**
 * Run a bulk export and stream the result. JSONL from a bulk operation is
 * flat: product rows and their metafield children arrive as separate lines
 * linked by __parentId, so children are folded back into their parent here.
 */
export async function fetchAllProducts(
  graphql: GraphqlFn,
  filter: string = catalogueQuery(DEFAULT_PREFS),
): Promise<CatalogueRead> {
  const start = await graphql<any>(RUN_BULK, { query: productsBulkQuery(filter) });
  const errors = start?.bulkOperationRunQuery?.userErrors ?? [];
  if (errors.length) throw new Error(`bulkOperationRunQuery: ${JSON.stringify(errors)}`);

  let completed = false;
  let url: string | null = null;
  let expectedRoot = 0;
  let expectedObjects = 0;
  for (let i = 0; i < 240; i += 1) {
    await sleep(2000);
    const poll = await graphql<any>(POLL_BULK);
    const op = poll?.currentBulkOperation;
    if (!op) continue;
    if (op.status === "COMPLETED") {
      completed = true;
      url = op.url ?? null;
      // Both arrive as UnsignedInt64, which is a string over the wire.
      expectedRoot = Number(op.rootObjectCount ?? 0);
      expectedObjects = Number(op.objectCount ?? 0);
      break;
    }
    if (op.status === "FAILED" || op.status === "CANCELED") {
      throw new Error(`Bulk operation ${op.status}: ${op.errorCode ?? ""}`);
    }
  }
  if (!completed) throw new Error("Bulk operation did not complete in time");

  // A completed operation with no result file is an empty export: Shopify
  // writes no file when the query matched nothing. That is a complete read of
  // zero products, not a failure - and it has to be, or a shop that
  // unpublished its whole catalogue could never have its pages withdrawn.
  const body = url ? await (await fetch(url)).text() : "";

  const products = new Map<string, ProductInput>();
  const variants = new Map<
    string,
    VariantInput & { metafields: { key: string; value: string }[] }
  >();
  let objects = 0;
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    objects += 1;
    const row = JSON.parse(line);

    if (row.id?.includes("/Product/") && row.title !== undefined) {
      products.set(row.id, {
        id: row.id,
        handle: row.handle,
        status: row.status,
        title: row.title,
        descriptionHtml: row.descriptionHtml,
        vendor: row.vendor,
        productType: row.productType,
        category: row.category?.name ?? null,
        onlineStoreUrl: row.onlineStoreUrl,
        price: row.priceRangeV2?.minVariantPrice?.amount ?? null,
        currency: row.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
        // Filled in after the whole file is parsed: the variant rows that
        // decide it arrive on later lines.
        available: undefined,
        sku: null,
        imageUrl: row.featuredImage?.url ?? null,
        imageAlt: row.featuredImage?.altText ?? null,
        metafields: [],
        variants: [],
        collections: [],
        // seo is a plain object field, not a connection, so the bulk export
        // flattens it inline on the product row like priceRangeV2 - it never
        // arrives as a separate JSONL line keyed by __parentId.
        seo: row.seo ? { title: row.seo.title ?? null, description: row.seo.description ?? null } : null,
      });
      continue;
    }

    // Variant child row. Registered in its own map so its metafield children
    // (whose __parentId is the variant, not the product) find their way home.
    if (row.id?.includes("/ProductVariant/") && row.__parentId) {
      const parent = products.get(row.__parentId);
      const variant = {
        id: row.id,
        title: row.title ?? null,
        sku: row.sku ?? null,
        barcode: row.barcode ?? null,
        price: row.price ?? null,
        compareAtPrice: row.compareAtPrice ?? null,
        availableForSale: row.availableForSale === true,
        selectedOptions: row.selectedOptions ?? [],
        metafields: [] as { key: string; value: string }[],
      };
      if (parent) {
        parent.variants!.push(variant);
        // First variant is enough for the mirror's sku field.
        if (parent.sku == null) parent.sku = variant.sku;
      }
      variants.set(row.id, variant);
      continue;
    }

    // Collection membership child row - the bulk operation flattens this
    // connection into its own JSONL rows the same way it does variants, one
    // row per collection the product belongs to, linked by __parentId.
    if (row.id?.includes("/Collection/") && row.__parentId) {
      const parent = products.get(row.__parentId);
      if (parent) parent.collections!.push({ handle: row.handle, title: row.title });
      continue;
    }

    // Metafield child row - of a product or of a variant.
    if (row.__parentId && row.key !== undefined) {
      const parent = products.get(row.__parentId);
      if (parent) {
        parent.metafields!.push({ key: row.key, value: row.value });
        continue;
      }
      const variant = variants.get(row.__parentId);
      if (variant) variant.metafields.push({ key: row.key, value: row.value });
    }
  }

  const list = Array.from(products.values());
  for (const product of list) {
    product.available = availableFromVariants(product.variants ?? []);
  }

  const read = { root: list.length, objects };

  // Completeness is decided on the root count alone, and deliberately not on
  // the object count as well.
  //
  // The only decision this flag protects is a delete, and a delete is made
  // from the set of product handles. A download cut short always shows up as
  // fewer root products parsed than Shopify announced, so the root comparison
  // is sufficient for the question being asked.
  //
  // The object count is a different measure: Shopify counts child rows -
  // variants, metafields, collection memberships - and this parser counts
  // non-empty JSONL lines. If those two definitions ever disagree by one,
  // requiring them to match would make `complete` false on every shop, the
  // reconciliation would delete nothing for ever, and the withdrawal it
  // guards would be silently inert while appearing to ship. A guard that
  // fails closed and says nothing is worse than the leak it was written to
  // stop. The comparison is kept and reported so a mismatch is visible to
  // whoever reads the JobRun report, but it does not veto the delete.
  const objectsMatch = expectedObjects === read.objects;
  return {
    products: list,
    complete: expectedRoot === read.root,
    objectsMatch,
    expected: { root: expectedRoot, objects: expectedObjects },
    read,
  };
}
