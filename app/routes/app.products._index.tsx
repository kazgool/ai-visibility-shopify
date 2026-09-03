import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { Link, useLoaderData, useSearchParams, useNavigation, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Thumbnail,
  Text,
  Badge,
  Box,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  Pagination,
  TextField,
  Select,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { cleanOutput } from "../engine";
import db from "../db.server";
import {
  hasPaidAccess,
  isSeoUnlocked,
  freeProductIds,
  addFreeProduct,
  removeFreeProduct,
} from "../services/billing.server";
import { extractOneProduct } from "../services/extract.server";
// metaColumnState only runs in the loader (it needs parseState), so it is
// imported from the .server module; the labels below are plain display
// logic the client component also uses, so they come from a module with no
// ".server" suffix - see meta-column.ts for why that split matters.
import { metaColumnState } from "../services/seo.server";
import { CHECK_LABEL } from "../services/seo-findings";
import {
  PAGE_STATE_LABEL,
  PAGE_STATE_TONE,
  pageStateOf,
  type PageState,
} from "../services/seo-aggregate";
import { FINDING_LIST_CAP, productsWithFinding, scanRowsFor } from "../services/seo-aggregate.server";
import {
  metaColumnLabel,
  metaColumnMissing,
  META_FIELD_LABEL,
  type MetaColumnState,
} from "../services/meta-column";

// Results nobody can see do not exist (Marius, 3 Aug 2026). The dashboard
// says how much of the catalogue is covered; this screen says which products
// those numbers are made of, one row each, with filters for the three
// questions a merchant actually asks: what is missing, what did I edit, and
// where is alt text still absent.

const COLLECTIONS = `#graphql
  query CollectionsForFilter {
    collections(first: 50, sortKey: TITLE) {
      nodes { id title handle productsCount { count } }
    }
  }
`;

// The Meta column needs Product.seo, which no other card on this screen
// reads. Fetching it costs nothing extra when the SEO module is off for
// this shop - the whole field is left out of the query rather than fetched
// and ignored (SEO-WORKSPACE-PRD §4: the loader must not do the extra work
// either, not just hide the column).
function productFields(withSeo: boolean): string {
  return `
    id
    title
    handle
    status
    featuredMedia { preview { image { url } } }
    images(first: 50) { nodes { id altText } }
    metafields(namespace: "$app", first: 10) { nodes { key value } }
    ${withSeo ? "seo { title description }" : ""}
  `;
}

function productsQuery(withSeo: boolean): string {
  return `#graphql
  query ProductsOverview($cursor: String, $before: String, $query: String) {
    products(first: 25, after: $cursor, before: $before, query: $query, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      nodes {
        ${productFields(withSeo)}
      }
    }
  }
`;
}

// The "Page" column filter (PRD-SEO-PER-PRODUCT build step 6) is answered
// from our own SeoScan rows, not from a Shopify search: which products carry
// finding B3 is not something Shopify knows. So that list arrives as a set of
// ids and is fetched by id, with our own paging over it - the products query
// above cannot express the question at all.
function productsByIdsQuery(withSeo: boolean): string {
  return `#graphql
  query ProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        ${productFields(withSeo)}
      }
    }
  }
`;
}

/** Products per page in the finding list, matching the Shopify page size. */
const FINDING_PAGE_SIZE = 25;

type Row = {
  id: string;
  title: string;
  handle: string;
  status: string;
  image: string | null;
  attributes: number;
  questions: number;
  hasSummary: boolean;
  described: number;
  images: number;
  edited: boolean;
  readable: boolean;
  mirrored: boolean;
  /** Only computed when seo_unlocked - see the loader. */
  metaState: MetaColumnState | null;
  /** What the last page read found. Only computed when seo_unlocked. */
  pageState: PageState | null;
  isFreeProduct: boolean;
};

function parseCount(value: string | undefined): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const filter = url.searchParams.get("filter") ?? "all";
  const search = (url.searchParams.get("q") ?? "").trim();
  const collection = url.searchParams.get("collection") ?? "";

  // Search and collection are handled by Shopify, not by us: filtering a
  // page of 25 in the browser would be a lie at 2,000 products, where the
  // match is usually on a page you never loaded.
  const clauses: string[] = [];
  if (search !== "") {
    const escaped = search.replace(/["\\]/g, "");
    clauses.push(`(title:*${escaped}* OR sku:*${escaped}* OR vendor:*${escaped}*)`);
  }
  if (collection !== "") clauses.push(`collection_id:${collection}`);
  const query = clauses.length > 0 ? clauses.join(" AND ") : null;

  // ENTITLEMENT: read once, before the products query is even built, so an
  // unlocked shop never pays for the seo{} fields and a non-SEO merchant's
  // loader does no extra work at all - not just a hidden column.
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const seoUnlocked = shop ? await isSeoUnlocked(shop.id) : false;

  // The finding list: /app/products?finding=B3, linked from every row of the
  // SEO screen's Findings per product card. Only reachable behind the SEO
  // key, since the rows it reads only exist for a shop that has one; a
  // hand-typed finding= on a locked shop falls through to the normal list.
  const finding = seoUnlocked ? (url.searchParams.get("finding") ?? "").trim() : "";
  const findingPage = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);

  let findingList: { total: number; capped: boolean; ids: string[] } | null = null;
  if (finding !== "" && shop) {
    const hits = await productsWithFinding(shop.id, finding);
    findingList = { total: hits.total, capped: hits.capped, ids: hits.productIds };
  }

  const [res, colRes] = await Promise.all([
    findingList
      ? admin.graphql(productsByIdsQuery(seoUnlocked), {
          variables: {
            ids: findingList.ids.slice(
              findingPage * FINDING_PAGE_SIZE,
              findingPage * FINDING_PAGE_SIZE + FINDING_PAGE_SIZE,
            ),
          },
        })
      : admin.graphql(productsQuery(seoUnlocked), { variables: { cursor, before, query } }),
    admin.graphql(COLLECTIONS),
  ]);
  const json = await res.json();
  // A product deleted between the row being written and this read comes back
  // as null from nodes(ids:) - dropped rather than rendered as a blank row.
  const page = findingList
    ? { nodes: (json.data?.nodes ?? []).filter((n: any) => n?.id), pageInfo: null }
    : json.data?.products;
  const colJson = await colRes.json();
  const collections = (colJson.data?.collections?.nodes ?? []).map((c: any) => ({
    id: String(c.id).split("/").pop(),
    title: cleanOutput(c.title),
    count: c.productsCount?.count ?? 0,
  }));

  const handles: string[] = (page?.nodes ?? []).map((p: any) => p.handle);
  const mirrored = shop && handles.length > 0
    ? await db.mirrorCache.findMany({
        where: { shopId: shop.id, handle: { in: handles } },
        select: { handle: true },
      })
    : [];
  const mirroredHandles = new Set(mirrored.map((m) => m.handle));

  // FREE-TIER-SPEC §2, §4: three merchant-chosen products are free without a
  // subscription. A subscribed shop sees none of this. The set of chosen
  // product ids, not a bare counter, is the authority - see
  // billing.server.ts's freeProductIds for why.
  const hasAccess = await hasPaidAccess(session.shop, shop?.id, admin.graphql);
  const freeIds = shop ? await freeProductIds(shop.id) : [];
  const freeProductsRemaining = Math.max(0, 3 - freeIds.length);

  // The Page column. One query for the 25 products on this page, so the
  // column costs the same on a 50-product store and a 20,000-product one.
  const pageStates = shop && seoUnlocked
    ? await scanRowsFor(
        shop.id,
        (page?.nodes ?? []).map((p: any) => p.id),
      )
    : new Map();

  const rows: Row[] = (page?.nodes ?? []).map((p: any) => {
    const mf = new Map<string, string>(
      (p.metafields?.nodes ?? []).map((m: any) => [m.key, m.value]),
    );
    let state: Record<string, { source?: string }> = {};
    try {
      state = JSON.parse(mf.get("state") ?? "{}");
    } catch {
      state = {};
    }
    const images = p.images?.nodes ?? [];
    const attributes = parseCount(mf.get("facts"));

    return {
      id: p.id,
      title: cleanOutput(p.title),
      handle: p.handle,
      status: p.status,
      image: p.featuredMedia?.preview?.image?.url ?? null,
      attributes,
      questions: parseCount(mf.get("questions")),
      hasSummary: Boolean(mf.get("summary")),
      described: images.filter((i: any) => (i.altText ?? "").trim() !== "").length,
      images: images.length,
      // Any field a person wrote makes the product theirs, not ours.
      edited: Object.values(state).some((s) => s?.source === "human"),
      // Published means an assistant has something to read on this product.
      readable: attributes > 0 && Boolean(mf.get("summary")),
      // Whether the plain text mirror exists for this handle, so the link
      // never points to a 404.
      mirrored: mirroredHandles.has(p.handle),
      // ENTITLEMENT: null (not computed) when the SEO module is off - the
      // seo{} fields were never fetched for this shop, so there is nothing
      // to derive a state from.
      metaState: seoUnlocked ? metaColumnState({ id: p.id, metafields: p.metafields?.nodes, seo: p.seo ?? null }) : null,
      // Already one of the three free products - reprocessing it is free
      // regardless of whether the cap is otherwise full.
      isFreeProduct: freeIds.includes(p.id),
      // ENTITLEMENT: null when the SEO module is off, the same as metaState -
      // the rows were never read for this shop, so there is no state to show.
      pageState: seoUnlocked ? pageStateOf(pageStates.get(p.id) ?? null) : null,
    };
  });

  const filtered = rows.filter((r) => {
    if (filter === "no_attributes") return r.attributes === 0;
    if (filter === "edited") return r.edited;
    if (filter === "missing_alt") return r.images > 0 && r.described < r.images;
    // ENTITLEMENT: only reachable when unlocked and metaState was actually
    // computed - a hand-typed filter=missing_meta on a locked shop falls
    // through to "all" rather than doing anything with data it never fetched.
    if (filter === "missing_meta") return seoUnlocked && r.metaState ? metaColumnMissing(r.metaState) : true;
    return true;
  });

  return {
    rows: filtered,
    total: rows.length,
    finding,
    findingLabel: finding ? (CHECK_LABEL[finding as keyof typeof CHECK_LABEL] ?? finding) : null,
    findingTotal: findingList?.total ?? 0,
    findingCapped: findingList?.capped ?? false,
    findingPage,
    findingCap: FINDING_LIST_CAP,
    findingPageSize: FINDING_PAGE_SIZE,
    filter,
    search,
    collection,
    collections,
    pageInfo: page?.pageInfo ?? null,
    domain: session.shop,
    hasAccess,
    freeProductsRemaining,
    seoUnlocked,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const productId = String(form.get("productId") ?? "");
  if (!productId) return { ok: false };

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ok: false };

  const hasAccess = await hasPaidAccess(session.shop, shop.id, admin.graphql);

  // FREE-TIER-SPEC §4 fix: reserve the slot in the free-product set before
  // the write runs, not after it succeeds. Reserving first is what closes
  // the two-overlapping-submissions race - addFreeProduct's check-and-add
  // happens inside one serializable transaction, so only one of two
  // concurrent submissions for two different products can observe room and
  // commit; the loser is refused outright rather than both landing. A
  // resubmission of a product already in the set is always allowed (that is
  // the "reprocessing a free product is free" rule) and reserves nothing
  // new.
  let reservedNewSlot = false;
  if (!hasAccess) {
    const reservation = await addFreeProduct(shop.id, productId);
    if (!reservation.ok) {
      return { ok: false, limitReached: true };
    }
    reservedNewSlot = !reservation.alreadyMember;
  }

  const outcome = await extractOneProduct(shop.id, productId);
  const succeeded = outcome.written.length > 0;

  // A failed write must not consume one of the three (FREE-TIER-SPEC §4).
  // The reservation above is optimistic - it has to be, to close the race -
  // so a reservation that turns out to cover a no-op write is given back
  // here rather than left counted.
  if (!hasAccess && reservedNewSlot && !succeeded) {
    await removeFreeProduct(shop.id, productId);
  }

  return { ok: true, succeeded };
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "no_attributes", label: "Without attributes" },
  { key: "edited", label: "Edited by hand" },
  { key: "missing_alt", label: "Missing image descriptions" },
];

// ENTITLEMENT: appended only when the SEO module is on for this shop - see
// the render, not this constant, since that decision needs the loader flag.
const SEO_FILTER = { key: "missing_meta", label: "Missing meta fields" };

const META_TONE: Record<string, "success" | "attention" | "info" | undefined> = {
  auto: "success",
  human: "attention",
  outside: "info",
  missing: undefined,
};

/**
 * Reads honestly when the two fields disagree (SEO-WORKSPACE-PRD §4): a
 * human title with an empty description never collapses into one badge that
 * would claim more, or less, than what is actually true of each field.
 */
function MetaCell({ state }: { state: MetaColumnState }) {
  if (state.title === state.description) {
    return (
      <BlockStack gap="050">
        <Badge tone={META_TONE[state.title]}>{metaColumnLabel(state)}</Badge>
        {state.title === "missing" ? (
          <Text as="span" variant="bodySm" tone="subdued">
            Not generated yet - run the queue on the SEO screen.
          </Text>
        ) : null}
      </BlockStack>
    );
  }
  return (
    <BlockStack gap="050">
      <Text as="span" variant="bodySm">
        {`Title: ${META_FIELD_LABEL[state.title]}`}
      </Text>
      <Text as="span" variant="bodySm">
        {`Description: ${META_FIELD_LABEL[state.description]}`}
      </Text>
    </BlockStack>
  );
}

/**
 * The Page column (PRD-SEO-PER-PRODUCT section 4, build step 6). Four states,
 * not three: a page that answered with the password form, a redirect or an
 * error is its own state, because green would claim a clean page and amber
 * would blame the theme for something nobody managed to look at. Grey means
 * the nightly pass has not reached this product yet, which on a large
 * catalogue is most of it for the first few weeks and is not a defect.
 */
function PageCell({ state }: { state: PageState }) {
  return (
    <BlockStack gap="050">
      <Badge tone={PAGE_STATE_TONE[state]}>{PAGE_STATE_LABEL[state]}</Badge>
      {state === "unread" ? (
        <Text as="span" variant="bodySm" tone="subdued">
          Read nightly, oldest first.
        </Text>
      ) : null}
    </BlockStack>
  );
}

function ProcessProductAction({
  productId,
  attributes,
}: {
  productId: string;
  attributes: number;
}) {
  const fetcher = useFetcher<{ ok: boolean; succeeded?: boolean; limitReached?: boolean }>();
  const busy = fetcher.state !== "idle";
  const done = fetcher.data?.succeeded;

  if (done) {
    return (
      <Text as="span" tone="success">
        Processed
      </Text>
    );
  }

  // Every outcome is said out loud (EXPERIENCE-PRD §6): a button that
  // silently does nothing reads as broken, and the merchant presses it
  // again. limitReached: the cap filled between render and submit (another
  // tab, another person). succeeded false: the write ran and found nothing
  // to write - the free slot was given back.
  return (
    <BlockStack gap="050">
      <fetcher.Form method="post">
        <input type="hidden" name="productId" value={productId} />
        <Button size="slim" submit loading={busy}>
          {attributes > 0 ? "Process again" : "Process this product"}
        </Button>
      </fetcher.Form>
      {fetcher.data?.limitReached ? (
        <Text as="span" variant="bodySm" tone="critical">
          All three free products are already chosen - this one was not
          processed and nothing was counted.
        </Text>
      ) : null}
      {fetcher.data?.ok && fetcher.data.succeeded === false ? (
        <Text as="span" variant="bodySm" tone="subdued">
          Nothing extractable found in this description, so nothing was
          written - and no free slot was used.
        </Text>
      ) : null}
    </BlockStack>
  );
}

export default function ProductsOverview() {
  const {
    rows,
    total,
    finding,
    findingLabel,
    findingTotal,
    findingCapped,
    findingPage,
    findingCap,
    findingPageSize,
    filter,
    search,
    collection,
    collections,
    pageInfo,
    domain,
    hasAccess,
    freeProductsRemaining,
    seoUnlocked,
  } = useLoaderData<typeof loader>() as {
    rows: Row[];
    total: number;
    finding: string;
    findingLabel: string | null;
    findingTotal: number;
    findingCapped: boolean;
    findingPage: number;
    findingCap: number;
    findingPageSize: number;
    filter: string;
    search: string;
    collection: string;
    collections: { id: string; title: string; count: number }[];
    pageInfo: any;
    domain: string;
    hasAccess: boolean;
    freeProductsRemaining: number;
    seoUnlocked: boolean;
  };
  const [term, setTerm] = useState(search);
  const [params, setParams] = useSearchParams();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  // ENTITLEMENT: the filter chip and the column below only exist in this
  // list when the module is on - absent, not merely empty, for a shop that
  // never subscribed to it.
  const filters = seoUnlocked ? [...FILTERS, SEO_FILTER] : FILTERS;

  const setFilter = (key: string) => {
    const next = new URLSearchParams(params);
    if (key === "all") next.delete("filter");
    else next.set("filter", key);
    // A filter applies to the whole catalogue, so paging starts again.
    next.delete("after");
    next.delete("before");
    setParams(next);
  };

  const apply = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === "") next.delete(k);
      else next.set(k, v);
    }
    // Any change of scope restarts paging: a cursor from the old result set
    // means nothing in the new one.
    next.delete("after");
    next.delete("before");
    setParams(next);
  };

  const movePage = (delta: number) => {
    const next = new URLSearchParams(params);
    const to = Math.max(0, findingPage + delta);
    if (to === 0) next.delete("page");
    else next.set("page", String(to));
    setParams(next);
  };

  const clearFinding = () => {
    const next = new URLSearchParams(params);
    next.delete("finding");
    next.delete("page");
    setParams(next);
  };

  const move = (dir: "after" | "before") => {
    const next = new URLSearchParams(params);
    next.delete("after");
    next.delete("before");
    next.set(dir, dir === "after" ? pageInfo.endCursor : pageInfo.startCursor);
    setParams(next);
  };

  return (
    <Page
      title="Products"
      subtitle="What the app has published for each product, and what it has not."
    >
      <BlockStack gap="400">
        {!hasAccess ? (
          <Banner tone="info" title="Before you subscribe">
            <BlockStack gap="100">
              <Text as="p">
                {"Three products of your choice can be fully processed for free ("}
                {freeProductsRemaining}
                {" remaining) - the same attributes, summary, questions and structured data a subscription writes. The rest of the catalogue needs a subscription."}
              </Text>
              <Text as="p">
                What gets written stays written, in your own Shopify metafields, whether you subscribe or not.
              </Text>
            </BlockStack>
          </Banner>
        ) : null}

        {finding ? (
          <Banner
            tone="info"
            title={`Products with: ${findingLabel}`}
            onDismiss={clearFinding}
          >
            <BlockStack gap="100">
              <Text as="p">
                {`${findingTotal} product${findingTotal === 1 ? "" : "s"} in this store carry finding ${finding}.`}
                {findingCapped
                  ? ` This list shows the first ${findingCap}; fix these and the next pass will show the rest.`
                  : ""}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Findings come from the per-product scan, not from a Shopify
                search, so this list is not affected by the search box or the
                collection filter above.
              </Text>
            </BlockStack>
          </Banner>
        ) : null}

        <Card>
          <InlineStack gap="300" wrap blockAlign="end">
            <div style={{ flexGrow: 1, minWidth: 260 }}>
              <TextField
                label="Search"
                labelHidden
                placeholder="Search by title, SKU or vendor"
                value={term}
                onChange={setTerm}
                onBlur={() => apply({ q: term })}
                autoComplete="off"
                clearButton
                onClearButtonClick={() => {
                  setTerm("");
                  apply({ q: "" });
                }}
              />
            </div>
            <div style={{ minWidth: 240 }}>
              <Select
                label="Collection"
                labelHidden
                options={[
                  { label: "All collections", value: "" },
                  ...collections.map((c) => ({
                    label: `${c.title} (${c.count})`,
                    value: c.id,
                  })),
                ]}
                value={collection}
                onChange={(v) => apply({ collection: v })}
              />
            </div>
            <Button onClick={() => apply({ q: term })} loading={busy}>
              Search
            </Button>
          </InlineStack>
        </Card>

        <InlineStack gap="200" wrap>
          {filters.map((f) => (
            <Button
              key={f.key}
              pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              disabled={busy}
            >
              {f.label}
            </Button>
          ))}
        </InlineStack>

        {rows.length === 0 ? (
          <Banner tone="info">
            <Text as="p">
              {finding
                ? "No product carries this finding any more. It was counted on the SEO screen when that page was built; the count refreshes on the next pass."
                : filter === "all"
                  ? "No products on this page yet. Run Fill catalogue from the dashboard."
                  : "Nothing on this page matches that filter. Try another page or another filter."}
            </Text>
          </Banner>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={rows.length}
              selectable={false}
              headings={[
                { title: "" },
                { title: "Product" },
                { title: "Attributes" },
                { title: "Questions" },
                { title: "Summary" },
                { title: "Image text" },
                { title: "State" },
                ...(seoUnlocked ? [{ title: "Meta" }, { title: "Page" }] : []),
                { title: "What AI reads" },
                ...(!hasAccess ? [{ title: "Free processing" }] : []),
              ]}
            >
              {rows.map((row, i) => (
                <IndexTable.Row id={row.id} key={row.id} position={i}>
                  <IndexTable.Cell>
                    <Thumbnail source={row.image ?? ""} alt="" size="small" />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Link to={`/app/products/${row.id.split("/").pop()}`}>
                      <Text as="span" fontWeight="semibold">
                        {row.title}
                      </Text>
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.attributes > 0 ? (
                      <Text as="span">{row.attributes}</Text>
                    ) : (
                      <Text as="span" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.questions > 0 ? (
                      <Text as="span">{row.questions}</Text>
                    ) : (
                      <Text as="span" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.hasSummary ? (
                      <Text as="span">Yes</Text>
                    ) : (
                      <Text as="span" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" tone={row.described < row.images ? "subdued" : undefined}>
                      {row.images === 0 ? "-" : `${row.described}/${row.images}`}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="100">
                      {row.edited ? <Badge tone="attention">Edited</Badge> : null}
                      {row.readable ? (
                        <Badge tone="success">Readable</Badge>
                      ) : (
                        <Badge>Nothing published</Badge>
                      )}
                    </InlineStack>
                  </IndexTable.Cell>
                  {seoUnlocked ? (
                    <IndexTable.Cell>
                      {row.metaState ? <MetaCell state={row.metaState} /> : null}
                    </IndexTable.Cell>
                  ) : null}
                  {seoUnlocked ? (
                    <IndexTable.Cell>
                      {row.pageState ? <PageCell state={row.pageState} /> : null}
                    </IndexTable.Cell>
                  ) : null}
                  <IndexTable.Cell>
                    {row.mirrored ? (
                      <a
                        href={`https://${domain}/apps/ai-visibility/${row.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View
                      </a>
                    ) : row.status === "UNLISTED" ? (
                      // An unlisted product is published; it is the
                      // merchant's own toggle that keeps it out, and the
                      // one screen that can change that is Report. Until
                      // 3 September 2026 this fell into the branch below and
                      // named the one cause it is not (QA wave fix 8).
                      <Text as="span" tone="subdued">
                        Unlisted in Shopify, and unlisted products are left
                        out unless you include them on the Report screen
                      </Text>
                    ) : row.status !== "ACTIVE" ? (
                      // Processed or not, a draft or archived product is
                      // never mirrored - saying "runs when processed" on
                      // one that was already processed is false. Publication
                      // is the missing step, so name it.
                      <Text as="span" tone="subdued">
                        Not published to the Online Store, so there is
                        nothing for AI to read
                      </Text>
                    ) : row.readable ? (
                      // ACTIVE and processed but no mirror row: the product
                      // is not published to the Online Store channel (the
                      // mirror only exists for published products).
                      <Text as="span" tone="subdued">
                        Not published to the Online Store, so there is
                        nothing for AI to read
                      </Text>
                    ) : (
                      <Text as="span" tone="subdued">
                        Not readable yet - runs when processed
                      </Text>
                    )}
                  </IndexTable.Cell>
                  {!hasAccess ? (
                    <IndexTable.Cell>
                      {freeProductsRemaining > 0 || row.isFreeProduct ? (
                        <ProcessProductAction
                          productId={row.id}
                          attributes={row.attributes}
                        />
                      ) : (
                        <Link to="/app/plans">
                          <Text as="span">Free products used - see plans</Text>
                        </Link>
                      )}
                    </IndexTable.Cell>
                  ) : null}
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}

        {finding ? (
          <InlineStack align="center">
            <Pagination
              hasPrevious={findingPage > 0}
              hasNext={(findingPage + 1) * findingPageSize < Math.min(findingTotal, findingCap)}
              onPrevious={() => movePage(-1)}
              onNext={() => movePage(1)}
            />
          </InlineStack>
        ) : pageInfo ? (
          <InlineStack align="center">
            <Pagination
              hasPrevious={pageInfo.hasPreviousPage}
              hasNext={pageInfo.hasNextPage}
              onPrevious={() => move("before")}
              onNext={() => move("after")}
            />
          </InlineStack>
        ) : null}

        <Box paddingBlockStart="200">
          <Text as="p" tone="subdued" variant="bodySm">
            {finding
              ? `${rows.length} of ${findingTotal} products with this finding, on this page.`
              : filter === "all"
                ? `${total} products on this page.`
                : `${rows.length} of ${total} products on this page match.`}
            {" Counts come from the metafields on each product, so they show what is published right now."}
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}
