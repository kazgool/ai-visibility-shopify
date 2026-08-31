import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  List,
  Divider,
  DataTable,
  Tabs,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isSeoUnlocked } from "../services/billing.server";
import { checkAppEmbed, embedDeepLink } from "../services/embed-check.server";
import {
  scanStorefront,
  recordThemeScan,
  deriveMissingReasons,
  type ThemeScanResult,
  type MissingReasonInput,
} from "../services/theme-scan.server";
import { diffThemeScans, formatSeoWatchLine, type SeoWatchChange } from "../services/seo-watch";
import { businessFor } from "../services/business.server";

// The screen route itself refuses without the seo_unlocked flag, not only
// the nav link - a URL can be typed directly (ENTITLEMENT rule). One route
// file, one nav entry ("SEO"); the five tabs below are addressed by a
// ?tab= query parameter rather than nested Remix route files, because every
// tab reads the same persisted scan (ThemeScanResult in the db) and the
// same audit query - a nested route per tab would need its own loader
// duplicating that fetch, and its own copy of the entitlement check, for no
// benefit since nothing here needs a distinct URL segment beyond the tab id.

const TAB_IDS = ["overview", "schema", "conflicts", "meta", "crawl"] as const;
type TabId = (typeof TAB_IDS)[number];

function tabFromRequest(url: URL): TabId {
  const raw = url.searchParams.get("tab");
  return (TAB_IDS as readonly string[]).includes(raw ?? "") ? (raw as TabId) : "overview";
}

const FIRST_PRODUCT = `#graphql
  query FirstOnlineProductSeo {
    products(first: 1, query: "published_status:published") {
      nodes {
        id
        handle
        onlineStoreUrl
        metafields(namespace: "$app", first: 10) { nodes { key value } }
      }
    }
  }
`;

const PRODUCTS_SEO_AUDIT = `#graphql
  query ProductsSeoAudit($cursor: String) {
    products(first: 100, after: $cursor, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle
        title
        seo { title description }
      }
    }
  }
`;

const PRIMARY_DOMAIN = `#graphql
  query PrimaryDomainSeo {
    shop { primaryDomain { host } url }
  }
`;

const MAIN_THEME_ID = `#graphql
  query MainThemeIdSeo {
    themes(first: 1, roles: [MAIN]) {
      nodes { id }
    }
  }
`;

// A read-only audit, capped so an unusually large catalogue never turns this
// screen into a slow bulk operation. The denominator is always stated.
const MAX_AUDIT_PAGES = 3; // up to 300 products

type SeoFieldRow = { handle: string; title: string; missingTitle: boolean; missingDescription: boolean };

async function auditSeoFields(
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
): Promise<{ rows: SeoFieldRow[]; checked: number }> {
  const rows: SeoFieldRow[] = [];
  let checked = 0;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_AUDIT_PAGES; page += 1) {
    const res = await graphql(PRODUCTS_SEO_AUDIT, { variables: { cursor } });
    const json = await res.json();
    const products = json.data?.products;
    if (!products) break;
    for (const p of products.nodes ?? []) {
      checked += 1;
      const missingTitle = !p.seo?.title;
      const missingDescription = !p.seo?.description;
      if (missingTitle || missingDescription) {
        rows.push({ handle: p.handle, title: p.title, missingTitle, missingDescription });
      }
    }
    if (!products.pageInfo?.hasNextPage) break;
    cursor = products.pageInfo.endCursor;
  }
  return { rows, checked };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  const unlocked = shop ? await isSeoUnlocked(shop.id) : false;
  if (!unlocked) {
    return { unlocked: false as const };
  }

  const url = new URL(request.url);
  const tab = tabFromRequest(url);

  const themeScan = shop
    ? await db.themeScan.findFirst({
        where: { shopId: shop.id },
        orderBy: { scannedAt: "desc" },
      })
    : null;

  const embed = await checkAppEmbed(admin.graphql);
  const audit = await auditSeoFields(admin.graphql);

  return {
    unlocked: true as const,
    tab,
    themeScan,
    embed,
    embedLink: embedDeepLink(session.shop),
    audit,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  // Refuse directly: the nav link only hides the entry, the action must also
  // check, because the form can be posted to without ever seeing the link.
  const unlocked = await isSeoUnlocked(shop.id);
  if (!unlocked) return { error: "This screen is not enabled for this shop." };

  const tab = tabFromRequest(new URL(request.url));

  const productRes = await admin.graphql(FIRST_PRODUCT);
  const productJson = await productRes.json();
  const productNode = productJson.data?.products?.nodes?.[0];
  const productUrl = productNode?.onlineStoreUrl ?? `https://${session.shop}`;

  const domainRes = await admin.graphql(PRIMARY_DOMAIN);
  const domainJson = await domainRes.json();
  const homeUrl = domainJson.data?.shop?.url ?? `https://${session.shop}`;

  const password = await db.setting.findUnique({
    where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
  });

  const result = await scanStorefront(productUrl, homeUrl, password?.value);

  // Weekly-watch bookkeeping: diff against whatever was scanned last, so a
  // manual "scan now" also feeds the same dated history the scheduled job
  // writes to.
  const themeRes = await admin.graphql(MAIN_THEME_ID);
  const themeJson = await themeRes.json();
  const themeId = themeJson.data?.themes?.nodes?.[0]?.id;

  let watchChanges: SeoWatchChange[] = [];
  if (themeId) {
    const previousRow = await db.themeScan.findUnique({
      where: { shopId_themeId: { shopId: shop.id, themeId: String(themeId) } },
    });
    const previous = (previousRow?.detail as any as ThemeScanResult) ?? null;
    const nowIso = new Date().toISOString();
    const newChanges = diffThemeScans(previous, result, nowIso);
    const priorHistory: SeoWatchChange[] = previous?.watchChanges ?? [];
    watchChanges = [...priorHistory, ...newChanges].slice(-20);
  }

  const business = await businessFor(shop.id);

  const facts = (productNode?.metafields?.nodes ?? []).find((m: any) => m.key === "facts")?.value;
  const summary = (productNode?.metafields?.nodes ?? []).find((m: any) => m.key === "summary")?.value;
  const fitFor = (productNode?.metafields?.nodes ?? []).find((m: any) => m.key === "fit_for")?.value;

  const embed = await checkAppEmbed(admin.graphql);

  // The rating and FAQ-question findings are read off the page the scan
  // just fetched (result.hasAggregateRating / result.hasFAQPage), not
  // guessed. When the page could not be read at all (password wall), the
  // value is genuinely unknown rather than false - see deriveMissingReasons.
  const reasonInput: MissingReasonInput = {
    embedActive: Boolean(embed?.active),
    mode: "extend",
    hasFacts: Boolean(facts),
    hasSummary: Boolean(summary),
    hasFitFor: Boolean(fitFor),
    hasReturnDays: Boolean(business?.returnDays),
    hasDeliveryTime: Boolean(business?.deliveryTime) && !business?.deliveryVaries,
    hasRating: result.passwordProtected ? null : Boolean(result.hasAggregateRating),
    hasCollectionQuestions: result.passwordProtected ? null : Boolean(result.hasFAQPage),
    hasSocialProfiles: Boolean(
      business?.socialProfiles && Object.keys(business.socialProfiles).length > 0,
    ),
    seoUnlocked: true,
    isCollectionPage: false,
  };

  const missingReasons = deriveMissingReasons(reasonInput);
  const richResultsUrl = `https://search.google.com/test/rich-results?url=${encodeURIComponent(productUrl)}`;

  const stored: ThemeScanResult = { ...result, watchChanges, missingReasons, richResultsUrl };

  if (themeId) {
    await recordThemeScan(shop.id, String(themeId), stored, admin.graphql);
  }

  // Redirect rather than returning actionData: every tab reads the loader's
  // persisted state, so after a scan every tab (not just the one the form
  // was submitted from) sees the fresh result without a stale actionData
  // overlay diverging from what a tab switch would show.
  return redirect(`/app/seo?tab=${tab}`);
};

function ConflictList({ label, conflicts }: { label: string; conflicts?: { type: string; count: number; weEmitOne: boolean }[] }) {
  if (!conflicts || conflicts.length === 0) {
    return (
      <Text as="p" tone="subdued">
        No repeated node types found on the {label} in the last scan.
      </Text>
    );
  }
  return (
    <List>
      {conflicts.map((c) => (
        <List.Item key={c.type}>
          {c.type} appears {c.count} times on the {label}.{" "}
          {c.weEmitOne
            ? "One of them is ours - switch the app embed to Extend mode so we reference the theme's node instead of adding a second one."
            : "Unknown source - the other instance is not something we can identify; check the theme and any other installed apps."}
        </List.Item>
      ))}
    </List>
  );
}

function OverviewTab({
  themeScan,
  result,
  richResultsUrl,
}: {
  themeScan: any;
  result: ThemeScanResult | undefined;
  richResultsUrl: string | undefined;
}) {
  if (!result) {
    return (
      <Card>
        <Text as="p" tone="subdued">
          Not scanned yet. Press "Scan now" below - it reads the product page
          and the home page once, the same way a crawler would, and nothing
          is written to your store.
        </Text>
      </Card>
    );
  }

  const nodeTypeCount = new Set([
    ...(result.product?.nodes.flatMap((n) => n.types) ?? []),
    ...(result.home?.nodes.flatMap((n) => n.types) ?? []),
  ]).size;
  const conflictCount = (result.productConflicts?.length ?? 0) + (result.homeConflicts?.length ?? 0);
  const gapCount = result.missingReasons?.filter((r) => !r.emitted).length ?? 0;

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="p" tone="subdued">
          Last scanned {themeScan?.scannedAt ? new Date(themeScan.scannedAt).toLocaleString() : "never"}.
        </Text>
        <Text as="p">
          {nodeTypeCount} distinct node type{nodeTypeCount === 1 ? "" : "s"} published, counted
          across the product page and the home page from that scan.
        </Text>
        <Text as="p">
          {conflictCount} conflict{conflictCount === 1 ? "" : "s"} - a node type appearing more
          than once on the same page. Detail on the Conflicts tab.
        </Text>
        <Text as="p">
          {gapCount} gap{gapCount === 1 ? "" : "s"} - a node type the extension is capable of
          emitting but did not, with the reason. Detail on the Published schema tab.
        </Text>
        {richResultsUrl ? (
          <BlockStack gap="100">
            <Button url={richResultsUrl} target="_blank">
              Open Google's Rich Results Test
            </Button>
            <Text as="p" variant="bodySm" tone="subdued">
              That verdict is Google's, not ours - use it to check what we
              report against how Google actually parses the page.
            </Text>
          </BlockStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}

function SchemaTab({ result }: { result: ThemeScanResult | undefined }) {
  if (!result) {
    return (
      <Card>
        <Text as="p" tone="subdued">
          Not scanned yet. Press "Scan now" below to publish this list.
        </Text>
      </Card>
    );
  }
  if (result.passwordProtected) {
    return (
      <Banner tone="warning">
        The storefront answered with the password page, so nothing could be
        read. Development stores always have this on.
      </Banner>
    );
  }
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Product page: {result.product?.url}
          </Text>
          {result.product?.nodes.length ? (
            <BlockStack gap="100">
              {result.product.nodes.map((n, i) => (
                <InlineStack gap="200" key={i}>
                  <Badge>{n.types.join(", ")}</Badge>
                  {n.id ? (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {n.id}
                    </Text>
                  ) : null}
                </InlineStack>
              ))}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">
              No JSON-LD found on this page in the last scan.
            </Text>
          )}
        </BlockStack>
      </Card>

      {result.home ? (
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Home page: {result.home.url}
            </Text>
            {result.home.passwordProtected ? (
              <Text as="p" tone="subdued">
                Password protected - not readable.
              </Text>
            ) : result.home.nodes.length ? (
              <BlockStack gap="100">
                {result.home.nodes.map((n, i) => (
                  <InlineStack gap="200" key={i}>
                    <Badge>{n.types.join(", ")}</Badge>
                    {n.id ? (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {n.id}
                      </Text>
                    ) : null}
                  </InlineStack>
                ))}
              </BlockStack>
            ) : (
              <Text as="p" tone="subdued">
                No JSON-LD found on this page in the last scan.
              </Text>
            )}
          </BlockStack>
        </Card>
      ) : null}

      {result.missingReasons ? (
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Why each property is or is not emitted
            </Text>
            <List>
              {result.missingReasons.map((r) => (
                <List.Item key={r.nodeType}>
                  <Badge tone={r.emitted ? "success" : "attention"}>{r.nodeType}</Badge>{" "}
                  {r.emitted ? "emitted" : r.reason}
                  {!r.emitted && r.fixScreen ? (
                    <>
                      {" "}
                      <a href={r.fixScreen}>Fix it</a>
                    </>
                  ) : null}
                </List.Item>
              ))}
            </List>
          </BlockStack>
        </Card>
      ) : null}

      {result.watchChanges && result.watchChanges.length > 0 ? (
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Weekly watch
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Recorded automatically once a week, comparing this scan to the
              previous one. Nothing here is fixed automatically.
            </Text>
            <List>
              {result.watchChanges.map((c, i) => (
                <List.Item key={i}>{formatSeoWatchLine(c)}</List.Item>
              ))}
            </List>
          </BlockStack>
        </Card>
      ) : null}
    </BlockStack>
  );
}

function ConflictsTab({ result }: { result: ThemeScanResult | undefined }) {
  if (!result) {
    return (
      <Card>
        <Text as="p" tone="subdued">
          Not scanned yet. Press "Scan now" below to check for repeated node
          types.
        </Text>
      </Card>
    );
  }
  if (result.passwordProtected) {
    return (
      <Banner tone="warning">
        The storefront answered with the password page, so nothing could be
        read.
      </Banner>
    );
  }
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Product page
        </Text>
        <ConflictList label="product page" conflicts={result.productConflicts} />
        <Divider />
        <Text as="h2" variant="headingMd">
          Home page
        </Text>
        <ConflictList label="home page" conflicts={result.homeConflicts} />
      </BlockStack>
    </Card>
  );
}

function MetaTab({ audit }: { audit: { rows: SeoFieldRow[]; checked: number } }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd">
          Meta title and description
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          Read-only. These are Shopify's own fields, set on each product's
          Search engine listing preview - we never write them. {audit.checked}{" "}
          product{audit.checked === 1 ? "" : "s"} checked.
        </Text>
        {audit.rows.length === 0 ? (
          <Text as="p" tone="subdued">
            Every product checked has both a meta title and a meta
            description set.
          </Text>
        ) : (
          <DataTable
            columnContentTypes={["text", "text", "text"]}
            headings={["Product", "Meta title", "Meta description"]}
            rows={audit.rows.map((r) => [
              r.title,
              r.missingTitle ? "Empty" : "Set",
              r.missingDescription ? "Empty" : "Set",
            ])}
          />
        )}
      </BlockStack>
    </Card>
  );
}

function CrawlTab({ result }: { result: ThemeScanResult | undefined }) {
  if (!result) {
    return (
      <Card>
        <Text as="p" tone="subdued">
          Not scanned yet. Press "Scan now" below - robots.txt and the
          canonical/noindex signals on both pages come from that same scan,
          at no extra cost.
        </Text>
      </Card>
    );
  }
  if (result.passwordProtected) {
    return (
      <Banner tone="warning">
        The storefront answered with the password page, so nothing could be
        read.
      </Banner>
    );
  }

  const pages: { label: string; page: typeof result.product }[] = [
    { label: "product page", page: result.product },
    { label: "home page", page: result.home },
  ];
  const noindexed = pages.filter((p) => p.page && !p.page.passwordProtected && p.page.noindex);

  return (
    <BlockStack gap="400">
      {noindexed.length > 0 ? (
        <Banner tone="critical" title="A scanned page carries noindex">
          <List>
            {noindexed.map((p) => (
              <List.Item key={p.label}>
                The {p.label} tells search engines and assistants not to
                index it. This is almost always unintentional and blocks
                visibility entirely - check the theme's robots meta tag
                settings.
              </List.Item>
            ))}
          </List>
        </Banner>
      ) : null}

      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            robots.txt
          </Text>
          {result.robots?.fetched ? (
            <>
              {result.robots.disallowsRelevant.length > 0 ? (
                <Banner tone="warning" title="robots.txt disallows a scanned page">
                  <List>
                    {result.robots.disallowsRelevant.map((path) => (
                      <List.Item key={path}>Disallow: {path}</List.Item>
                    ))}
                  </List>
                </Banner>
              ) : (
                <Text as="p" tone="subdued">
                  Neither scanned page matched a Disallow rule in robots.txt
                  as fetched during the last scan.
                </Text>
              )}
              <Text as="p" variant="bodySm" tone="subdued">
                robots.txt lives in your theme as robots.txt.liquid. This
                app is read-only here - no app can rewrite that file on your
                behalf.
              </Text>
            </>
          ) : (
            <Text as="p" tone="subdued">
              robots.txt could not be fetched during the last scan.
            </Text>
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Canonical tags
          </Text>
          <List>
            {pages.map(({ label, page }) => (
              <List.Item key={label}>
                {!page || page.passwordProtected
                  ? `${label}: could not be read in the last scan.`
                  : page.canonical
                    ? `${label}: canonical points to ${page.canonical}.`
                    : `${label}: no canonical tag found.`}
              </List.Item>
            ))}
          </List>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

export default function Seo() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [searchParams, setSearchParams] = useSearchParams();

  if (!data.unlocked) {
    return (
      <Page title="SEO">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Not enabled for this shop
            </Text>
            <Text as="p" tone="subdued">
              This screen is part of an operator-configured module. It is not
              part of the standard plan yet.
            </Text>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  const tab = data.tab;
  const stored = data.themeScan?.detail as any as ThemeScanResult | undefined;

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "schema", content: "Published schema" },
    { id: "conflicts", content: "Conflicts" },
    { id: "meta", content: "Meta fields" },
    { id: "crawl", content: "Crawl" },
  ];
  const selectedIndex = TAB_IDS.indexOf(tab);

  return (
    <Page title="SEO" subtitle="What structured data is on the page right now">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              We fetch a published product page and the home page from
              outside the store, the same way a crawler would, and report
              every JSON-LD block found - not a checklist of what should be
              there.
            </Text>
            <Form method="post">
              <Button submit variant="primary" loading={busy}>
                Scan now
              </Button>
            </Form>
            {actionData?.error ? (
              <Banner tone="critical">{actionData.error}</Banner>
            ) : null}
          </BlockStack>
        </Card>

        <Tabs
          tabs={tabs}
          selected={selectedIndex === -1 ? 0 : selectedIndex}
          onSelect={(index) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", TAB_IDS[index]);
            setSearchParams(next);
          }}
        />

        {tab === "overview" ? (
          <OverviewTab themeScan={data.themeScan} result={stored} richResultsUrl={stored?.richResultsUrl} />
        ) : null}
        {tab === "schema" ? <SchemaTab result={stored} /> : null}
        {tab === "conflicts" ? <ConflictsTab result={stored} /> : null}
        {tab === "meta" ? <MetaTab audit={data.audit} /> : null}
        {tab === "crawl" ? <CrawlTab result={stored} /> : null}
      </BlockStack>
    </Page>
  );
}
