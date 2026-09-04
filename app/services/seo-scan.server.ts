// Source A of the per-product SEO scan, persisted (PRD-SEO-PER-PRODUCT
// build step 2).
//
// Called at the end of every catalogue pass, with the read already in hand.
// It costs no Shopify request except A4's redirect lookup, which only runs
// for a product whose handle changed since the last pass - normally none.
//
// Three rules this module keeps, all of them learned elsewhere in this repo:
//
//  1. Never write an identical row. The `unchanged` check in facts.server.ts
//     exists because writing marks a product updated and feeds our own
//     webhooks; here the loop is only a database write, but the reason to
//     avoid it is the same shape - five catalogue passes a week over 20,000
//     products is 100,000 pointless row versions. Rows whose content did not
//     change get their `bulkAt` refreshed in one statement and nothing else.
//  2. A short read never deletes. `complete` is the same flag
//     reconcileMirrors obeys: a truncated bulk download looks exactly like a
//     catalogue that shrank, and acting on the difference would throw away
//     rows for products that are still on sale.
//  3. A field that was not read is not reported. Everything on that is in
//     seo-scan.ts, which holds the checks themselves.
//  4. Source A rewrites only its own half of the `findings` column. Source B
//     (seo-page.server.ts) writes into the same column, months of passes
//     apart; without this rule every catalogue pass would erase every page
//     finding, and the comparison in rule 1 would also see a changed row on
//     every pass and rewrite all of them.

import db from "../db.server";
import { describeGraphqlError } from "./graphql-errors";
import { businessFor } from "./business.server";
import { checkAppEmbed } from "./embed-check.server";
import { deriveMissingReasons } from "./theme-scan.server";
import { b6Detail, type NodeContext } from "./seo-nodes";
import type { GraphqlFn } from "./admin.server";
import { isSeoUnlocked } from "./billing.server";
import { recordCurrentFacts } from "./seo-snapshot.server";
import type { ProductInput } from "./facts.server";
import {
  duplicationByProduct,
  findingsOf,
  isSourceAFinding,
  offerFacts,
  sourceAFindings,
  type Finding,
  type OfferFacts,
} from "./seo-scan";
import {
  REDIRECT_READ_CAP,
  checkDuplicateDescription,
  checkHomeRedirect,
  checkImageFilenames,
  checkOrphan,
  duplicateDescriptions,
  homePageRedirects,
  type MenuLinks,
  type RedirectEntry,
  type RedirectRead,
} from "./seo-catalogue";

/**
 * How many renamed products get a redirect lookup in one pass. A rename is
 * rare; a catalogue where thousands of handles changed at once is an import,
 * and an import must not turn one catalogue pass into thousands of Admin
 * requests. The ones beyond the cap are left unchecked - which A4 reads as
 * "not checked", never as "no redirect" - and are picked up next pass.
 */
export const REDIRECT_LOOKUP_CAP = 50;

/** Postgres takes 65535 bind parameters; nothing here goes near it at 500. */
const CHUNK = 500;

const FIND_REDIRECT = `#graphql
  query FindRedirect($query: String!) {
    urlRedirects(first: 1, query: $query) {
      nodes { id path target }
    }
  }
`;

export type SourceAReport = {
  /** Products the pass read, and therefore rows this shop should end with. */
  products: number;
  created: number;
  /** Content changed, so the row was rewritten. */
  updated: number;
  /** Content identical, so only bulkAt moved. */
  touched: number;
  removed: number;
  /** Rows left in place because the read was short (rule 2 above). */
  keptOnShortRead: number;
  redirectsChecked: number;
  /** One count per finding code, for the JobRun report and the SEO card. */
  byCode: Record<string, number>;
  /**
   * Whether this pass refreshed the shop's rolling `current` figures, the
   * "today" half of the since-card (PRD-SEO-FULL-ONPAGE section 1.2). False on
   * a short read, where writing them would put a `products` total below the
   * real catalogue behind every difference on the card.
   */
  currentFacts?: { written: boolean; reason?: string };
  /**
   * Set when source A failed. Source A is an addition to passes that already
   * did their job without it, so it is best effort in the same sense
   * pingProducts is: it must never be the reason a catalogue pass, a weekly
   * sweep or an alt-text run fails. The failure is reported rather than
   * swallowed - a null report means "no SEO key", and the two must not look
   * the same to whoever reads the JobRun.
   */
  error?: string;
};

/**
 * Key order in JSONB is not preserved - Postgres reorders it - so comparing
 * JSON.stringify of a row read back against JSON.stringify of a freshly built
 * value would report every row as changed on every pass, which is exactly the
 * rewrite storm rule 1 is about. Sorting keys at every level makes the
 * comparison mean what it says. Arrays keep their order: the order of
 * findings is meaningful and is fixed by sourceAFindings.
 */
function stable(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = walk((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/**
 * Is there a redirect from this old path? Returns null, not false, when the
 * lookup could not be made: a failed Admin call must not be read as "the
 * merchant did not create a redirect".
 */
export async function lookupRedirect(
  graphql: GraphqlFn,
  path: string,
): Promise<boolean | null> {
  try {
    const data = await graphql<any>(FIND_REDIRECT, { query: `path:"${path}"` });
    const nodes = data?.urlRedirects?.nodes;
    if (!Array.isArray(nodes)) return null;
    return nodes.some((n: any) => n?.path === path);
  } catch {
    return null;
  }
}

// --- A13 and A16: the two per-pass Admin reads -----------------------------

const ALL_REDIRECTS = `#graphql
  query AllRedirects($first: Int!, $after: String) {
    urlRedirects(first: $first, after: $after) {
      nodes { path target }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const SHOP_MENUS = `#graphql
  query MenusForSeo {
    menus(first: 25) {
      nodes {
        id
        handle
        items {
          type
          resourceId
          url
          items {
            type
            resourceId
            url
            items { type resourceId url }
          }
        }
      }
    }
  }
`;

/**
 * Every URL redirect the shop holds, up to the cap, for A13.
 *
 * Returns null rather than throwing, and null is the whole point: this query
 * needs an access scope this app does not carry today. Verified against a live
 * shop on 4 September 2026, which answered
 * `Access denied for urlRedirects field` - the same answer A4's single-redirect
 * lookup has been getting since it was written, which is why A4 has been
 * reporting "not checked" on every renamed product rather than a redirect
 * verdict. A13 reads null as "could not run" and never as "no redirect points
 * at the home page".
 */
export async function readUrlRedirects(graphql: GraphqlFn): Promise<RedirectRead | null> {
  try {
    const entries: RedirectEntry[] = [];
    let after: string | null = null;
    let partial = false;
    for (let page = 0; page < 20; page += 1) {
      const data: any = await graphql<any>(ALL_REDIRECTS, { first: 250, after });
      const nodes = data?.urlRedirects?.nodes;
      if (!Array.isArray(nodes)) return null;
      for (const node of nodes) {
        entries.push({ path: String(node?.path ?? ""), target: String(node?.target ?? "") });
      }
      if (entries.length >= REDIRECT_READ_CAP) {
        partial = Boolean(data?.urlRedirects?.pageInfo?.hasNextPage);
        break;
      }
      if (!data?.urlRedirects?.pageInfo?.hasNextPage) break;
      after = String(data.urlRedirects.pageInfo.endCursor ?? "");
      if (after === "") break;
    }
    return { entries, partial, read: entries.length };
  } catch {
    return null;
  }
}

/**
 * Every product a menu links to, by id and by handle, for A16.
 *
 * Both forms, because a menu item picked from the product list carries a
 * `resourceId` and one typed by hand carries only a `url`; a product linked by
 * either is linked. Three levels deep, which is what Shopify's navigation
 * allows.
 *
 * Null on refusal, for the same reason and with the same consequence as
 * `readUrlRedirects`: this query needs a scope this app does not carry today
 * (verified 4 September 2026, `Access denied for menus field`), and a product
 * reported as an orphan because nobody was allowed to look at the menus would
 * be an accusation rather than a finding.
 */
export async function readMenus(graphql: GraphqlFn): Promise<MenuLinks | null> {
  try {
    const data = await graphql<any>(SHOP_MENUS);
    const nodes = data?.menus?.nodes;
    if (!Array.isArray(nodes)) return null;

    const productIds = new Set<string>();
    const handles = new Set<string>();
    const walk = (items: any[] | undefined) => {
      for (const item of items ?? []) {
        const resourceId = typeof item?.resourceId === "string" ? item.resourceId : "";
        if (resourceId.includes("/Product/")) productIds.add(resourceId);
        const url = typeof item?.url === "string" ? item.url : "";
        const match = /\/products\/([^/?#]+)/.exec(url);
        if (match) handles.add(match[1]);
        walk(item?.items);
      }
    };
    for (const menu of nodes) walk(menu?.items);
    return { productIds, handles };
  } catch {
    return null;
  }
}

/**
 * Which checks were attempted this pass and could not be asked, with the
 * reason, so the SEO card can say so instead of rendering them as clean.
 *
 * A Setting rather than a column, because it is one fact per shop per pass and
 * nothing about a product - the same shape `seo_scan_robots_block` and
 * `seo_markets` already use. Rewritten in full every pass, so a scope that
 * arrives clears the entry on the next catalogue read with nothing to migrate.
 */
export const UNAVAILABLE_SETTING_KEY = "seo_checks_unavailable";

export async function recordUnavailableChecks(
  shopId: string,
  unavailable: Record<string, string>,
): Promise<void> {
  const value = JSON.stringify(unavailable);
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: UNAVAILABLE_SETTING_KEY } },
    create: { shopId, key: UNAVAILABLE_SETTING_KEY, value },
    update: { value },
  });
}

export async function unavailableChecks(shopId: string): Promise<Record<string, string>> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: UNAVAILABLE_SETTING_KEY } },
  });
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * A13's other half: redirects to the home page whose path names no product in
 * this catalogue - a deleted product, a collection, a page. They have no row to
 * sit on and are the majority on a migrated store, so they are recorded per
 * shop and the card states them under the row. Exactly the shape A7's
 * withdrawn-product half already has (`recordStaleSitemapEntries`).
 */
export const HOME_REDIRECT_SETTING_KEY = "seo_home_redirects";

export const HOME_REDIRECT_CAP = 50;

export async function recordHomeRedirects(
  shopId: string,
  entries: RedirectEntry[] | null,
): Promise<void> {
  if (entries === null) {
    await db.setting
      .deleteMany({ where: { shopId, key: HOME_REDIRECT_SETTING_KEY } })
      .catch(() => undefined);
    return;
  }
  const value = JSON.stringify({
    paths: entries.slice(0, HOME_REDIRECT_CAP).map((e) => e.path),
    total: entries.length,
    at: new Date().toISOString(),
  });
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: HOME_REDIRECT_SETTING_KEY } },
    create: { shopId, key: HOME_REDIRECT_SETTING_KEY, value },
    update: { value },
  });
}

export async function homeRedirectsFor(
  shopId: string,
): Promise<{ paths: string[]; total: number; at: string } | null> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: HOME_REDIRECT_SETTING_KEY } },
  });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** The columns source A reads back to decide whether a row needs rewriting. */
type ExistingRow = {
  id: string;
  productId: string;
  handle: string | null;
  findings: unknown;
  offer: unknown;
  /**
   * Read for B6. Three of deriveMissingReasons' inputs are things only a page
   * read can establish - whether the page carried a WebSite node, a
   * BreadcrumbList, a rating - and source B stored them here on its last pass.
   * Null when the page has never been read, which B6 reports as "could not be
   * determined" and never as "missing".
   */
  nodes: unknown;
  scannedAt: Date | null;
};

/** What one product's row holds after source A. */
type RowContent = {
  handle: string | null;
  findings: Finding[];
  offer: OfferFacts;
};

/**
 * Everything B6 needs that is the same for every product in a pass: the shop's
 * mode, the app embed's state, and the two Business-screen answers. Read once,
 * not once per product - a per-product embed read would be one Admin call per
 * product, which is exactly the shape this app refuses everywhere else.
 */
type NodeExpectation = {
  embedActive: boolean;
  mode: "extend" | "full" | "unknown";
  context: NodeContext;
  hasReturnDays: boolean;
  hasDeliveryTime: boolean;
  hasSocialProfiles: boolean;
};

/**
 * The per-pass half of B6. Returns null when it could not be established, and
 * a null turns B6 off for the pass rather than reporting six missing nodes
 * from one failed Admin call.
 */
async function readNodeExpectation(
  shopId: string,
  graphql: GraphqlFn,
): Promise<NodeExpectation | null> {
  try {
    // GraphqlFn returns parsed data; checkAppEmbed wants the Response-shaped
    // client the routes pass. Adapted here rather than changing either.
    const embed = await checkAppEmbed(async (query, options) => {
      const data = await graphql<any>(query, (options?.variables ?? {}) as any);
      return new Response(JSON.stringify({ data }));
    });
    const business = await businessFor(shopId);
    return {
      embedActive: Boolean(embed.active),
      mode: embed.mode,
      context: {
        outputDisabled: Boolean(embed.outputDisabled),
        presentButDisabled: Boolean(embed.presentButDisabled),
        seoUnlocked: true, // computeSourceA only runs behind the key.
        unreadable: Boolean(embed.unreadable),
      },
      hasReturnDays: Boolean(business?.returnDays),
      hasDeliveryTime: Boolean(business?.deliveryTime) && !business?.deliveryVaries,
      hasSocialProfiles: Boolean(
        business?.socialProfiles && Object.keys(business.socialProfiles).length > 0,
      ),
    };
  } catch {
    return null;
  }
}

/** Did the stored page nodes carry this type? Null when no page was ever read. */
function nodeSeen(row: ExistingRow | undefined, type: string): boolean | null {
  if (!row || !row.scannedAt) return null;
  const list = Array.isArray(row.nodes) ? (row.nodes as any[]) : null;
  if (!list) return null;
  return list.some((n) => Array.isArray(n?.types) && n.types.map(String).includes(type));
}

/** Did the stored Product node carry a nested aggregateRating? Null if unread. */
function ratingSeen(row: ExistingRow | undefined): boolean | null {
  if (!row || !row.scannedAt) return null;
  const list = Array.isArray(row.nodes) ? (row.nodes as any[]) : null;
  if (!list) return null;
  return list.some((n) => n?.hasAggregateRating === true);
}

/** B6 for one product, or null when there is nothing missing that we can fix. */
function b6For(
  product: ProductInput,
  row: ExistingRow | undefined,
  expectation: NodeExpectation,
): Finding | null {
  const metafield = (key: string) =>
    Boolean((product.metafields ?? []).find((m) => m.key === key)?.value);

  const reasons = deriveMissingReasons({
    embedActive: expectation.embedActive,
    // The real mode, not a hardcoded "extend": in Full mode the Product node is
    // emitted regardless of facts, so assuming extend reported a missing node
    // on every unprocessed product of a Full-mode store.
    mode: expectation.mode,
    hasFacts: metafield("facts"),
    hasSummary: metafield("summary"),
    hasFitFor: metafield("fit_for"),
    hasReturnDays: expectation.hasReturnDays,
    hasDeliveryTime: expectation.hasDeliveryTime,
    // Page-derived, off this product's own last page read. Null until source B
    // has read it, which reads as "could not be determined".
    hasRating: ratingSeen(row),
    hasWebSiteNode: nodeSeen(row, "WebSite"),
    hasBreadcrumbNode: nodeSeen(row, "BreadcrumbList"),
    hasCollectionQuestions: null,
    hasSocialProfiles: expectation.hasSocialProfiles,
    seoUnlocked: true,
    isCollectionPage: false,
  });

  const detail = b6Detail(reasons, expectation.context);
  // Source "A", not "B": source A computes and rewrites it. If it carried "B",
  // source B would own it and erase it on the next page scan without being
  // able to recompute it.
  return detail ? { code: "B6", source: "A", detail } : null;
}

/**
 * Compute A1, A3, A4 and A5 for every product in a catalogue read and store
 * one row per product.
 *
 * Returns null when the shop has no SEO key: the capability is separately
 * billed (PRD section 3), and a shop that has not bought it gets no rows at
 * all rather than rows nothing may show. Turning the key on fills them at the
 * next catalogue pass.
 */
export async function computeSourceA(
  shopId: string,
  graphql: GraphqlFn,
  catalogue: { products: ProductInput[]; complete: boolean },
  log?: (message: string) => void,
): Promise<SourceAReport | null> {
  if (!(await isSeoUnlocked(shopId))) return null;
  try {
    return await sourceAPass(shopId, graphql, catalogue, log);
  } catch (error) {
    // The formatter: a source A failure is almost always the one Admin call
    // this module makes (A4's redirect lookup), and its GraphQL errors are
    // what the JobRun report needs to carry.
    const message = describeGraphqlError(error, "source A");
    log?.(`source A ${shopId}: failed, the pass continues - ${message}`);
    return {
      products: catalogue.products.length,
      created: 0,
      updated: 0,
      touched: 0,
      removed: 0,
      keptOnShortRead: 0,
      redirectsChecked: 0,
      byCode: {},
      currentFacts: { written: false, reason: "source_a_failed" },
      error: message,
    };
  }
}

async function sourceAPass(
  shopId: string,
  graphql: GraphqlFn,
  catalogue: { products: ProductInput[]; complete: boolean },
  log?: (message: string) => void,
): Promise<SourceAReport> {
  const products = catalogue.products;
  const existing: ExistingRow[] = await db.seoScan.findMany({
    where: { shopId },
    select: {
      id: true,
      productId: true,
      handle: true,
      findings: true,
      offer: true,
      nodes: true,
      scannedAt: true,
    },
  });
  const byProductId = new Map(existing.map((row) => [row.productId, row]));

  // A3 is a question about the catalogue, not about a product, so it is
  // answered once for the whole read. A12 is the same question about the
  // description text, and is answered the same way.
  const duplication = duplicationByProduct(products);
  const sharedDescriptions = duplicateDescriptions(products);

  // A13 and A16: one Admin query each, per pass, never per product. Both can be
  // refused by a token without the scope, and a refusal is recorded as a check
  // that could not run rather than allowed to read as a clean result. Skipped
  // entirely on an empty read, where there is nothing to attach either to.
  const unavailable: Record<string, string> = {};
  const redirects = products.length > 0 ? await readUrlRedirects(graphql) : null;
  if (products.length > 0 && redirects === null) {
    unavailable.A13 =
      "The shop's URL redirects could not be read. This app's access does not include them, " +
      "so nothing is known about where a redirect points.";
  }
  const homeRedirects = homePageRedirects(redirects);
  // The half that has no product row: a redirect from a deleted product, a
  // collection or a page. Recorded per shop, exactly as A7's withdrawn-product
  // half is, and null clears it so a refused read never leaves a stale list on
  // the screen.
  await recordHomeRedirects(shopId, homeRedirects ? homeRedirects.unmatched : null);

  const menus = products.length > 0 ? await readMenus(graphql) : null;
  if (products.length > 0 && menus === null) {
    unavailable.A16 =
      "The shop's menus could not be read. This app's access does not include navigation, " +
      "so a product with no collection cannot be told apart from one a menu links to.";
  }

  // A4 first, because it is the only part that costs a request. Only products
  // whose stored handle differs from the one just read are candidates; a
  // product with no row yet has nothing to have been renamed from.
  const renamed = products.filter((p) => {
    const row = byProductId.get(p.id);
    const previous = (row?.handle ?? "").trim();
    return previous !== "" && previous !== (p.handle ?? "").trim();
  });
  const redirectByProductId = new Map<string, boolean | null>();
  for (const product of renamed.slice(0, REDIRECT_LOOKUP_CAP)) {
    const previous = byProductId.get(product.id)?.handle ?? "";
    redirectByProductId.set(
      product.id,
      await lookupRedirect(graphql, `/products/${previous}`),
    );
  }
  if (renamed.length > REDIRECT_LOOKUP_CAP) {
    log?.(
      `source A ${shopId}: ${renamed.length} handles changed, ${REDIRECT_LOOKUP_CAP} redirects checked this pass; the rest next pass`,
    );
  }

  const report: SourceAReport = {
    products: products.length,
    created: 0,
    updated: 0,
    touched: 0,
    removed: 0,
    keptOnShortRead: 0,
    redirectsChecked: redirectByProductId.size,
    byCode: {},
  };

  const toCreate: { shopId: string; productId: string; bulkAt: Date }[] = [];
  const createContent = new Map<string, RowContent>();
  const toUpdate: { id: string; content: RowContent; keptFromSourceB: Finding[] }[] = [];
  const toTouch: string[] = [];
  const now = new Date();

  // B6's per-pass half: one embed read and one business read for the whole
  // catalogue. Null means it could not be established, and then B6 is simply
  // not computed this pass rather than guessed at.
  const expectation = products.length > 0 ? await readNodeExpectation(shopId, graphql) : null;
  if (!expectation) {
    log?.(`source A ${shopId}: node expectations unavailable this pass, B6 not computed`);
  }

  for (const product of products) {
    const row = byProductId.get(product.id);
    const findings = sourceAFindings({
      product,
      duplication: duplication.get(product.id),
      previousHandle: row?.handle,
      redirectExists: redirectByProductId.has(product.id)
        ? (redirectByProductId.get(product.id) ?? null)
        : null,
    });
    // A12, A13, A15 and A16, in code order, before B6, so the order stays
    // stable for the "did this row change" comparison (rule 1) whichever
    // findings a product happens to carry. Each returns null when its input was
    // not available, and a null is never a pass.
    const a12 = checkDuplicateDescription(sharedDescriptions.get(product.id));
    if (a12) findings.push(a12);
    const a13 = checkHomeRedirect(
      homeRedirects?.byHandle.get((product.handle ?? "").trim()),
      redirects,
    );
    if (a13) findings.push(a13);
    const a15 = checkImageFilenames(product);
    if (a15) findings.push(a15);
    const a16 = checkOrphan(product, menus);
    if (a16) findings.push(a16);

    // B6 last, so the order stays stable for the "did this row change"
    // comparison (rule 1) whichever findings a product happens to carry.
    if (expectation) {
      const b6 = b6For(product, row, expectation);
      if (b6) findings.push(b6);
    }
    for (const finding of findings) {
      report.byCode[finding.code] = (report.byCode[finding.code] ?? 0) + 1;
    }

    const content: RowContent = {
      handle: product.handle ?? null,
      findings,
      offer: offerFacts(product),
    };

    if (!row) {
      toCreate.push({ shopId, productId: product.id, bulkAt: now });
      createContent.set(product.id, content);
      continue;
    }

    // Rule 4: compare against source A's half only. Source B's findings sit
    // in the same array and change on their own schedule.
    const storedFromSourceA = findingsOf(row.findings).filter(isSourceAFinding);
    const same =
      (row.handle ?? null) === content.handle &&
      stable(storedFromSourceA) === stable(content.findings) &&
      stable(row.offer ?? null) === stable(content.offer);

    if (same) toTouch.push(row.id);
    else {
      toUpdate.push({
        id: row.id,
        content,
        keptFromSourceB: findingsOf(row.findings).filter((f) => !isSourceAFinding(f)),
      });
    }
  }

  // Created rows carry their content on the same insert; createMany cannot
  // take differing JSON per row through a single object, so the rows go in
  // one at a time. New rows are the first pass only - after that this list
  // is a handful of newly added products.
  for (const row of toCreate) {
    const content = createContent.get(row.productId)!;
    await db.seoScan.create({
      data: {
        shopId: row.shopId,
        productId: row.productId,
        bulkAt: row.bulkAt,
        handle: content.handle,
        findings: content.findings as any,
        offer: content.offer as any,
      },
    });
    report.created += 1;
  }

  for (const row of toUpdate) {
    await db.seoScan.update({
      where: { id: row.id },
      data: {
        bulkAt: now,
        handle: row.content.handle,
        // Rule 4: source A first, then whatever source B had already found on
        // this page, carried through untouched.
        findings: [...row.content.findings, ...row.keptFromSourceB] as any,
        offer: row.content.offer as any,
      },
    });
    report.updated += 1;
  }

  // Rule 1: one statement for every row whose content did not change.
  for (let i = 0; i < toTouch.length; i += CHUNK) {
    const ids = toTouch.slice(i, i + CHUNK);
    await db.seoScan.updateMany({ where: { id: { in: ids } }, data: { bulkAt: now } });
    report.touched += ids.length;
  }

  // Rule 2: rows for products the read did not contain. Deleted only when the
  // read was whole; on a short read they are counted and kept, and the report
  // says so rather than reporting a silent nothing.
  const readIds = new Set(products.map((p) => p.id));
  const stale = existing.filter((row) => !readIds.has(row.productId));
  if (stale.length > 0) {
    if (!catalogue.complete) {
      report.keptOnShortRead = stale.length;
      log?.(
        `source A ${shopId}: ${stale.length} rows kept, the catalogue read was short`,
      );
    } else {
      for (let i = 0; i < stale.length; i += CHUNK) {
        const ids = stale.slice(i, i + CHUNK).map((row) => row.id);
        const { count } = await db.seoScan.deleteMany({ where: { id: { in: ids } } });
        report.removed += count;
      }
    }
  }

  // Which checks were asked for and refused, written in full so a scope that
  // arrives clears the entry on the next pass with nothing to migrate.
  await recordUnavailableChecks(shopId, unavailable);
  if (Object.keys(unavailable).length > 0) {
    log?.(
      `source A ${shopId}: ${Object.keys(unavailable).join(", ")} could not run - the Admin read was refused`,
    );
  }

  // The "today" half of the since-card, from the read this pass already holds.
  // Last, after every SeoScan write above, so the findings it counts are the
  // ones this pass just stored rather than the previous pass's.
  // In its own try, and not inside the pass's: every SeoScan row above is
  // already written by this point, and a failure to refresh the card's "today"
  // column must not turn a successful pass into a reported failure with its
  // counts lost. Same best-effort rule source A itself follows towards the
  // catalogue pass that hosts it.
  try {
    report.currentFacts = await recordCurrentFacts(shopId, products, catalogue.complete);
  } catch (error) {
    report.currentFacts = { written: false, reason: describeGraphqlError(error, "current facts") };
  }
  if (!report.currentFacts.written) {
    log?.(
      `source A ${shopId}: current figures not refreshed (${report.currentFacts.reason})`,
    );
  }

  log?.(
    `source A ${shopId}: ${report.products} products, ${report.created} new, ${report.updated} changed, ${report.touched} unchanged, ${report.removed} removed`,
  );
  return report;
}
