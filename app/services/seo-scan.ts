// Source A of the per-product SEO scan: everything a finding can say from
// the catalogue read alone (PRD-SEO-PER-PRODUCT section 2, checks A1 to A5).
//
// Pure on purpose, and with no ".server" suffix: no database, no fetch, no
// Admin API. The persistence and the one Admin query A4 needs live in
// seo-scan.server.ts. Two reasons for the split - the checks are testable
// without a database or an .env, and the screens in build step 4 can import
// the types and the labels without pulling a .server module into the browser
// bundle (CLAUDE.md: this has happened four times).
//
// The rule every check here obeys, and the one that makes the row honest:
// a field that was not read is never reported as absent. A product whose
// variants did not arrive has no barcode and no SKU *as far as we know*, and
// "as far as we know" is not a finding about the merchant's data. Findings
// name what is missing; what could not be checked is named separately, in
// the same detail object, under `notRead`.

import type { ProductInput } from "./facts.server";
import { classifyMetaField } from "./seo.server";

// The finding vocabulary - the codes, the Finding shape and CHECK_LABEL -
// lives in ./seo-findings (no ".server" suffix and no import that has one),
// because build step 4 renders those labels in the browser and this module
// imports classifyMetaField from seo.server for A5. Re-exported here so every
// caller and every test keeps the import it already had; see seo-findings.ts
// for the client build that failed before the split.
export {
  CHECK_LABEL,
  findingsOf,
  isSourceAFinding,
  type Finding,
  type FindingCode,
  type FindingSource,
} from "./seo-findings";

import { findingsOf, type Finding } from "./seo-findings";

export const IDENTIFIERS = ["barcode", "vendor", "sku", "image"] as const;
export type Identifier = (typeof IDENTIFIERS)[number];

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

// --- A1: identifiers -------------------------------------------------------

/**
 * Names the absent identifiers. It does not score four equal checks and it
 * does not weigh them against each other: which of the four matters is a
 * property of the catalogue, not of this function, and the screen orders its
 * rows by the counts it actually has (PRD section 4).
 *
 * `barcode` and `sku` live on variants. When no variant was read they go into
 * `notRead`, never into `missing` - a product always has at least one variant,
 * so an empty list means the read did not carry them.
 */
export function checkIdentifiers(product: ProductInput): Finding | null {
  const variants = product.variants ?? [];
  const missing: Identifier[] = [];
  const notRead: Identifier[] = [];

  if (variants.length === 0) {
    notRead.push("barcode", "sku");
  } else {
    if (!variants.some((v) => filled(v.barcode))) missing.push("barcode");
    if (!variants.some((v) => filled(v.sku))) missing.push("sku");
  }

  if (!filled(product.vendor)) missing.push("vendor");
  if (!filled(product.imageUrl)) missing.push("image");

  if (missing.length === 0) return null;

  // Sorted into the documented order so two passes over the same product
  // produce the same JSON and the row is not rewritten for nothing.
  const order = (a: Identifier, b: Identifier) =>
    IDENTIFIERS.indexOf(a) - IDENTIFIERS.indexOf(b);
  const detail: Record<string, unknown> = { missing: [...missing].sort(order) };
  if (notRead.length > 0) detail.notRead = [...notRead].sort(order);
  return { code: "A1", source: "A", detail };
}

// --- A2: the offer ---------------------------------------------------------

/**
 * What source A knows about the offer, stored on the row so that source B's
 * comparison in build step 3 has something to compare against without a
 * second catalogue read.
 *
 * `available` is null, not false, when no variant was read: the same
 * distinction availableFromVariants makes in catalogue.server.ts, for the
 * same reason - a made-to-order product must never be reported sold out
 * because nobody looked.
 */
export type OfferFacts = {
  variantsRead: number;
  available: boolean | null;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string | null;
};

export type SchemaOffer = {
  /** As the page's JSON-LD states it: a schema.org URL or the bare word. */
  availability: string | null;
  price: string | null;
};

export function offerFacts(product: ProductInput): OfferFacts {
  const variants = product.variants ?? [];
  const prices = variants
    .map((v) => v.price)
    .filter((p): p is string => filled(p))
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n));

  return {
    variantsRead: variants.length,
    available: variants.length === 0 ? null : variants.some((v) => v.availableForSale === true),
    minPrice: prices.length > 0 ? String(Math.min(...prices)) : (product.price ?? null),
    maxPrice: prices.length > 0 ? String(Math.max(...prices)) : (product.price ?? null),
    currency: product.currency ?? null,
  };
}

function saysInStock(availability: string): boolean {
  return /InStock|BackOrder|PreOrder|LimitedAvailability/i.test(availability);
}

function saysOutOfStock(availability: string): boolean {
  return /OutOfStock|SoldOut|Discontinued/i.test(availability);
}

/**
 * The A + B half of A2, written now and wired to a real page in build step 3.
 * Returns null while `schema` is null: a page nobody has read yet is "not yet
 * read" on the screen, which is a different sentence from "the offer agrees",
 * and the row must not be able to claim the second when it means the first.
 */
export function checkOfferConsistency(
  offer: OfferFacts,
  schema: SchemaOffer | null,
): Finding | null {
  if (!schema) return null;
  if (offer.variantsRead === 0 || offer.available === null) return null;

  const availability = schema.availability ?? "";
  if (availability !== "") {
    if (saysInStock(availability) && offer.available === false) {
      return {
        code: "A2",
        source: "A+B",
        detail: { mismatch: "availability", pageSays: availability, everyVariantSoldOut: true },
      };
    }
    if (saysOutOfStock(availability) && offer.available === true) {
      return {
        code: "A2",
        source: "A+B",
        detail: { mismatch: "availability", pageSays: availability, aVariantIsForSale: true },
      };
    }
  }

  // Price: a range is a range. A page that states the lowest variant price on
  // a product with several is correct, so the comparison is against the whole
  // interval and not against one end of it.
  const pagePrice = Number(schema.price);
  const min = Number(offer.minPrice);
  const max = Number(offer.maxPrice);
  if (
    filled(schema.price) &&
    Number.isFinite(pagePrice) &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    (pagePrice < min || pagePrice > max)
  ) {
    return {
      code: "A2",
      source: "A+B",
      detail: {
        mismatch: "price",
        pageSays: schema.price,
        live: min === max ? offer.minPrice : `${offer.minPrice}-${offer.maxPrice}`,
        currency: offer.currency,
      },
    };
  }

  return null;
}

// --- A3: duplication across the catalogue ----------------------------------

export type Duplication = { title: number; description: number };

/**
 * How many *other* products share this product's meta title, and its meta
 * description. Computed once for the whole catalogue because that is the only
 * level at which the question exists.
 *
 * A value shared by three products yields 2 for each of the three, never 3:
 * "shares its title with 2 products" is what the row says, and a title that
 * appears once is not a collision with itself. Blank values never collide -
 * fifty products with no meta title are fifty instances of A5, not one
 * collision of fifty.
 */
export function duplicationByProduct(
  products: Pick<ProductInput, "id" | "seo">[],
): Map<string, Duplication> {
  const countTitles = new Map<string, number>();
  const countDescriptions = new Map<string, number>();

  const key = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  };

  for (const p of products) {
    const t = key(p.seo?.title);
    if (t) countTitles.set(t, (countTitles.get(t) ?? 0) + 1);
    const d = key(p.seo?.description);
    if (d) countDescriptions.set(d, (countDescriptions.get(d) ?? 0) + 1);
  }

  const out = new Map<string, Duplication>();
  for (const p of products) {
    const t = key(p.seo?.title);
    const d = key(p.seo?.description);
    out.set(p.id, {
      title: t ? (countTitles.get(t) ?? 1) - 1 : 0,
      description: d ? (countDescriptions.get(d) ?? 1) - 1 : 0,
    });
  }
  return out;
}

export function checkDuplication(duplication: Duplication | undefined): Finding | null {
  if (!duplication) return null;
  const fields: { field: "title" | "description"; sharedWith: number }[] = [];
  if (duplication.title > 0) fields.push({ field: "title", sharedWith: duplication.title });
  if (duplication.description > 0) {
    fields.push({ field: "description", sharedWith: duplication.description });
  }
  if (fields.length === 0) return null;
  return { code: "A3", source: "A", detail: { fields } };
}

// --- A4: a rename with no redirect -----------------------------------------

/**
 * The old handle is the one this app recorded on the last pass, so A4 can
 * only see renames that happened after the product first got a row. A product
 * whose row is new has nothing to compare against and is not a finding - the
 * alternative would be to report every product as renamed on the first pass.
 */
export function checkRedirect(input: {
  previousHandle: string | null | undefined;
  handle: string | null | undefined;
  redirectExists: boolean | null;
}): Finding | null {
  const previous = (input.previousHandle ?? "").trim();
  const current = (input.handle ?? "").trim();
  if (previous === "" || current === "" || previous === current) return null;
  // null means the redirect could not be looked up on this pass. Same rule as
  // everywhere else here: not checked is not a finding.
  if (input.redirectExists === null) return null;
  if (input.redirectExists) return null;
  return {
    code: "A4",
    source: "A",
    detail: { previousHandle: previous, handle: current, redirect: false },
  };
}

// --- A5: an absent meta field ----------------------------------------------

/**
 * Absent, so Shopify falls back to a truncation of the description. Uses the
 * same classifier the SEO screen and the products list already use, rather
 * than a second reading of the same fields: "missing" there means the field
 * is empty right now, whatever a stale state entry claims.
 */
export function checkMetaFields(product: ProductInput): Finding | null {
  const input = {
    id: product.id,
    metafields: product.metafields ?? [],
    seo: product.seo ?? null,
  };
  const missing: ("title" | "description")[] = [];
  if (classifyMetaField(input, "seo_title") === "missing") missing.push("title");
  if (classifyMetaField(input, "seo_description") === "missing") missing.push("description");
  if (missing.length === 0) return null;
  return { code: "A5", source: "A", detail: { missing } };
}

// --- the whole of source A for one product ---------------------------------

export type SourceAInput = {
  product: ProductInput;
  duplication: Duplication | undefined;
  previousHandle: string | null | undefined;
  /** null when no lookup was made on this pass (no rename, or the cap was hit). */
  redirectExists: boolean | null;
};

/**
 * A1, A3, A4 and A5 for one product, in code order so two passes over an
 * unchanged product produce byte-identical JSON and the row is not rewritten.
 * A2 is not here: it needs the page, and it is raised in build step 3 from
 * the offer facts this pass stores.
 */
export function sourceAFindings(input: SourceAInput): Finding[] {
  return [
    checkIdentifiers(input.product),
    checkDuplication(input.duplication),
    checkRedirect({
      previousHandle: input.previousHandle,
      handle: input.product.handle,
      redirectExists: input.redirectExists,
    }),
    checkMetaFields(input.product),
  ].filter((f): f is Finding => f !== null);
}
