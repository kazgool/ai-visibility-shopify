// Reading the catalogue at scale (PRD §5.5).
//
// One bulk operation exports every product as JSONL regardless of catalogue
// size. Never paginate a 10,000-product catalogue by hand: it burns the rate
// limit and takes minutes instead of seconds.

import db from "../db.server";
import type { GraphqlFn } from "./admin.server";
import { sleep } from "./admin.server";
import type { ProductInput } from "./facts.server";
import { NAMESPACE } from "./facts.server";

const SHOP_INFO_SETTING_KEY = "shopInfo";

const RUN_BULK = `#graphql
  mutation RunBulk($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const POLL_BULK = `#graphql
  query PollBulk {
    currentBulkOperation(type: QUERY) {
      id status errorCode objectCount url
    }
  }
`;

const PRODUCTS_QUERY = `
  {
    products {
      edges {
        node {
          id
          handle
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

const SINGLE_PRODUCT = `#graphql
  query OneProduct($id: ID!) {
    product(id: $id) {
      id
      handle
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
    selectedOptions: v.selectedOptions ?? [],
    metafields: (v.metafields?.nodes ?? []).map((n: any) => ({ key: n.key, value: n.value })),
  }));
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    vendor: p.vendor,
    productType: p.productType,
    category: p.category?.name ?? null,
    onlineStoreUrl: p.onlineStoreUrl,
    price: p.priceRangeV2?.minVariantPrice?.amount ?? null,
    currency: p.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
    available: typeof p.totalInventory === "number" ? p.totalInventory > 0 : undefined,
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
 * Run a bulk export and stream the result. JSONL from a bulk operation is
 * flat: product rows and their metafield children arrive as separate lines
 * linked by __parentId, so children are folded back into their parent here.
 */
export async function fetchAllProducts(graphql: GraphqlFn): Promise<ProductInput[]> {
  const start = await graphql<any>(RUN_BULK, { query: PRODUCTS_QUERY });
  const errors = start?.bulkOperationRunQuery?.userErrors ?? [];
  if (errors.length) throw new Error(`bulkOperationRunQuery: ${JSON.stringify(errors)}`);

  let url: string | null = null;
  for (let i = 0; i < 240; i += 1) {
    await sleep(2000);
    const poll = await graphql<any>(POLL_BULK);
    const op = poll?.currentBulkOperation;
    if (!op) continue;
    if (op.status === "COMPLETED") {
      url = op.url;
      break;
    }
    if (op.status === "FAILED" || op.status === "CANCELED") {
      throw new Error(`Bulk operation ${op.status}: ${op.errorCode ?? ""}`);
    }
  }
  if (!url) throw new Error("Bulk operation did not complete in time");

  const res = await fetch(url);
  const body = await res.text();

  const products = new Map<string, ProductInput>();
  const variants = new Map<
    string,
    { id: string; title: string | null; sku: string | null; selectedOptions: { name: string; value: string }[]; metafields: { key: string; value: string }[] }
  >();
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);

    if (row.id?.includes("/Product/") && row.title !== undefined) {
      products.set(row.id, {
        id: row.id,
        handle: row.handle,
        title: row.title,
        descriptionHtml: row.descriptionHtml,
        vendor: row.vendor,
        productType: row.productType,
        category: row.category?.name ?? null,
        onlineStoreUrl: row.onlineStoreUrl,
        price: row.priceRangeV2?.minVariantPrice?.amount ?? null,
        currency: row.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
        available: typeof row.totalInventory === "number" ? row.totalInventory > 0 : undefined,
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

  return Array.from(products.values());
}
