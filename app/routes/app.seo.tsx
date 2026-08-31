import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useEffect, useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  Badge,
  Banner,
  List,
  Divider,
  Spinner,
  Box,
  Collapsible,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueue } from "../services/queue.server";
import { isSeoUnlocked } from "../services/billing.server";
import { checkAppEmbed, embedDeepLink } from "../services/embed-check.server";
import {
  scanStorefront,
  recordThemeScan,
  deriveMissingReasons,
  type ThemeScanResult,
  type MissingReasonInput,
  type ConflictEntry,
} from "../services/theme-scan.server";
import { diffThemeScans, formatSeoWatchLine, type SeoWatchChange } from "../services/seo-watch";
import { businessFor } from "../services/business.server";
import type { SeoKey, SeoQueue } from "../services/seo.server";
import type { SeoApplyReport } from "../services/seo-bulk.server";

// A dashboard, not a diagnostics report - this mirrors app._index.tsx on
// purpose (see SEO-WORKSPACE-PRD.md and the brief that rebuilt this screen a
// fourth time): a metric row at the top, then cards that each carry a plain
// method line and something to press. Detail (the full node list, the crawl
// checks, the protected-field list) is one disclosure toggle, never the
// screen's primary structure - three earlier versions led with tabs and were
// rejected for exactly that reason.

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: the route itself refuses without seo_unlocked, not only the
  // nav link - a URL can be typed directly.
  const unlocked = shop ? await isSeoUnlocked(shop.id) : false;
  if (!unlocked) {
    return { unlocked: false as const };
  }

  const themeScan = shop
    ? await db.themeScan.findFirst({
        where: { shopId: shop.id },
        orderBy: { scannedAt: "desc" },
      })
    : null;

  const embed = await checkAppEmbed(admin.graphql);

  // The two bulk-pass jobs this screen can start (SEO-WORKSPACE-PRD §3.5):
  // the queue build (read-only, also carries the term-gap card's data) and
  // the apply (writes the approved rows). Read here, not recomputed in the
  // browser - JobRun is the record.
  const [queueJob, applyJob] = shop
    ? await Promise.all([
        db.jobRun.findFirst({ where: { shopId: shop.id, kind: "seo_queue" }, orderBy: { createdAt: "desc" } }),
        db.jobRun.findFirst({ where: { shopId: shop.id, kind: "seo_apply" }, orderBy: { createdAt: "desc" } }),
      ])
    : [null, null];

  return {
    unlocked: true as const,
    themeScan,
    embed,
    embedLink: embedDeepLink(session.shop),
    queueJob,
    applyJob,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  // ENTITLEMENT: the nav link only hides the entry, the action must also
  // check, because a form can be posted without ever seeing the link. Covers
  // every intent below - the queue build, the apply, and the scan.
  const unlocked = await isSeoUnlocked(shop.id);
  if (!unlocked) return { error: "This screen is not enabled for this shop." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "scan");

  if (intent === "seo_build_queue") {
    const active = await db.jobRun.findFirst({
      where: { shopId: shop.id, kind: "seo_queue", status: { in: ["queued", "running"] } },
    });
    if (active) return { error: "A preview is already running." };

    const jobRun = await db.jobRun.create({ data: { shopId: shop.id, kind: "seo_queue" } });
    await enqueue("seo_queue_build", { shopId: shop.id, jobRunId: jobRun.id });
    return { queued: true };
  }

  if (intent === "seo_apply") {
    const raw = form.getAll("items").map(String);
    const items = raw
      .map((s) => {
        try {
          const parsed = JSON.parse(s) as { id: string; field: SeoKey; value: string };
          if (!parsed?.id || !parsed?.field) return null;
          return { productId: parsed.id, field: parsed.field, value: String(parsed.value ?? "") };
        } catch {
          return null;
        }
      })
      .filter((i): i is { productId: string; field: SeoKey; value: string } => i !== null);

    if (items.length === 0) return { error: "Nothing was selected." };

    const active = await db.jobRun.findFirst({
      where: { shopId: shop.id, kind: "seo_apply", status: { in: ["queued", "running"] } },
    });
    if (active) return { error: "An apply is already running." };

    const jobRun = await db.jobRun.create({ data: { shopId: shop.id, kind: "seo_apply" } });
    await enqueue("seo_apply", { shopId: shop.id, jobRunId: jobRun.id, items });
    return { applied: true };
  }

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

  // Redirect rather than returning actionData: the loader's persisted state
  // is what every card on this screen reads, so after a scan the whole
  // dashboard sees the fresh result without a stale actionData overlay.
  return redirect(`/app/seo`);
};

// ---------------------------------------------------------------------------
// Findings: the scan, conflicts and missing-reasons work that already
// existed, recomposed as one prioritised list instead of separate tabs.

type Severity = "critical" | "warning" | "info";

type Finding = {
  key: string;
  severity: Severity;
  text: string;
  fixHref: string | null;
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const SEVERITY_TONE: Record<Severity, "critical" | "attention" | "info"> = {
  critical: "critical",
  warning: "attention",
  info: "info",
};

/**
 * Nothing here is derived when the page could not be read (result is
 * undefined or passwordProtected) - a failed scan yields no findings, never
 * a false "0 problems" (EXPERIENCE-PRD §2: if we did not fetch it, we do not
 * say). The caller renders the password-wall banner separately.
 */
function buildFindings(result: ThemeScanResult | undefined): Finding[] {
  if (!result || result.passwordProtected) return [];
  const findings: Finding[] = [];

  const pages: { label: string; page: typeof result.product }[] = [
    { label: "product page", page: result.product },
    { label: "home page", page: result.home },
  ];
  for (const { label, page } of pages) {
    if (page && !page.passwordProtected && page.noindex) {
      findings.push({
        key: `noindex-${label}`,
        severity: "critical",
        text: `The ${label} carries a noindex tag, which blocks it from being indexed at all. This is almost always unintentional - fix it in your theme's robots meta tag settings.`,
        fixHref: null,
      });
    }
  }

  if (result.robots?.fetched) {
    for (const path of result.robots.disallowsRelevant) {
      findings.push({
        key: `robots-${path}`,
        severity: "critical",
        text: `robots.txt disallows ${path}, which blocks crawlers from reaching it. robots.txt lives in your theme as robots.txt.liquid - no app can rewrite it on your behalf.`,
        fixHref: null,
      });
    }
  }

  const conflictGroups: { label: string; conflicts?: ConflictEntry[] }[] = [
    { label: "product page", conflicts: result.productConflicts },
    { label: "home page", conflicts: result.homeConflicts },
  ];
  for (const { label, conflicts } of conflictGroups) {
    for (const c of conflicts ?? []) {
      findings.push({
        key: `conflict-${label}-${c.type}`,
        severity: "warning",
        text: `${c.type} appears ${c.count} times on the ${label}. ${
          c.weEmitOne
            ? "One of them is ours - switch the app embed to Extend mode so we reference the theme's node instead of adding a second one."
            : "The other instance is not something we can identify - check the theme and any other installed apps."
        }`,
        fixHref: c.weEmitOne ? "/app/diagnostics" : null,
      });
    }
  }

  for (const r of result.missingReasons ?? []) {
    if (r.emitted) continue;
    const unknown = r.reason?.includes("Could not be determined") ?? false;
    findings.push({
      key: `missing-${r.nodeType}`,
      severity: unknown ? "info" : "warning",
      text: `${r.nodeType} is not published: ${r.reason ?? "no reason recorded"}`,
      fixHref: r.fixScreen,
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function MetricTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "critical" | "subdued";
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl" tone={tone === "subdued" ? "subdued" : undefined}>
          {value}
        </Text>
        <Text as="p" variant="bodySm" tone={tone === "critical" ? "critical" : "subdued"}>
          {hint}
        </Text>
      </BlockStack>
    </Card>
  );
}

function ConflictList({ label, conflicts }: { label: string; conflicts?: ConflictEntry[] }) {
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

function SchemaDetail({ result }: { result: ThemeScanResult | undefined }) {
  if (!result || result.passwordProtected) return null;
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
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
            <Text as="h3" variant="headingSm">
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

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Conflicts
          </Text>
          <ConflictList label="product page" conflicts={result.productConflicts} />
          <Divider />
          <ConflictList label="home page" conflicts={result.homeConflicts} />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
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
          <Text as="h3" variant="headingSm">
            Canonical tags
          </Text>
          <List>
            {[
              { label: "product page", page: result.product },
              { label: "home page", page: result.home },
            ].map(({ label, page }) => (
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

      {result.watchChanges && result.watchChanges.length > 0 ? (
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
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

function FindingsCard({
  themeScan,
  result,
  richResultsUrl,
  busy,
}: {
  themeScan: any;
  result: ThemeScanResult | undefined;
  richResultsUrl: string | undefined;
  busy: boolean;
}) {
  const findings = buildFindings(result);
  const scannedAt = themeScan?.scannedAt ? new Date(themeScan.scannedAt).toLocaleString() : null;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              What we found to fix
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              We fetch a published product page and the home page from
              outside the store, the same way a crawler would, and list every
              problem the last scan actually found - never a guess.
            </Text>
          </BlockStack>
          <Form method="post">
            <input type="hidden" name="intent" value="scan" />
            <Button submit loading={busy}>
              {themeScan ? "Scan again" : "Scan now"}
            </Button>
          </Form>
        </InlineStack>

        {!themeScan ? (
          <Text as="p" tone="subdued">
            Not scanned yet. Scanning reads the product page and the home
            page once, the same way a crawler would, and nothing is written
            to your store.
          </Text>
        ) : result?.passwordProtected ? (
          <Banner tone="warning">
            The storefront answered with the password page, so the last scan
            could not check for problems. Development stores always have
            this on.
          </Banner>
        ) : findings.length === 0 ? (
          <Text as="p" tone="subdued">
            {`No problems found in the last scan, ${scannedAt}.`}
          </Text>
        ) : (
          <BlockStack gap="300">
            {findings.map((f) => (
              <InlineStack key={f.key} gap="200" blockAlign="start" wrap={false}>
                <Box paddingBlockStart="050">
                  <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                </Box>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm">
                    {f.text}
                  </Text>
                  {f.fixHref ? (
                    <a href={f.fixHref}>
                      <Text as="span" variant="bodySm">
                        Fix it
                      </Text>
                    </a>
                  ) : null}
                </BlockStack>
              </InlineStack>
            ))}
          </BlockStack>
        )}

        {richResultsUrl ? (
          <Box>
            <Button url={richResultsUrl} target="_blank" variant="plain">
              Open Google's Rich Results Test
            </Button>
          </Box>
        ) : null}
      </BlockStack>
    </Card>
  );
}

function TermGapCard({ report }: { report: SeoQueue | null }) {
  const rows = report?.termGap ?? [];
  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">
            What your descriptions say that your titles do not
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Terms your product descriptions use that appear in no product
            title and no meta field, counted from your own catalogue text.
            Not a keyword tool - we have no search volume and no ranking
            data, so nothing here is a recommendation.
          </Text>
        </BlockStack>

        {!report ? (
          <Text as="p" tone="subdued">
            Run Preview on the listing below to compute this from your
            catalogue.
          </Text>
        ) : rows.length === 0 ? (
          <Text as="p" tone="subdued">
            No gap terms found in the last check - every meaningful term in
            your descriptions also appears in a title or a meta field.
          </Text>
        ) : (
          <BlockStack gap="150">
            {rows.slice(0, 12).map((r) => (
              <Text as="p" variant="bodySm" key={r.term}>
                <Text as="span" fontWeight="semibold">
                  {r.term}
                </Text>
                {` - used in ${r.productCount} description${r.productCount === 1 ? "" : "s"}, in no title and no meta field.`}
              </Text>
            ))}
          </BlockStack>
        )}

        <Text as="p" tone="subdued" variant="bodySm">
          Nothing here applies automatically. Renaming a product is your
          decision, and changing a handle breaks existing links unless a
          redirect is created.
        </Text>
      </BlockStack>
    </Card>
  );
}

type JobRunLike = {
  status: string;
  progress: number;
  total: number;
  report: unknown;
  finishedAt: string | null;
} | null;

/**
 * The review-and-apply action for meta titles and meta descriptions
 * (SEO-WORKSPACE-PRD §3.5), reshaped to mirror the AI dashboard's action-card
 * pattern: a subtitle stating the method, then a preview button beside a
 * primary button naming the real count. Progress lives in the JobRun rows
 * passed down from the loader - queueJob for the read-only build, applyJob
 * for the write pass - never in local component state, so a closed tab or a
 * refresh loses nothing.
 *
 * Review before write is never bypassed: the primary button stays disabled
 * until a preview has produced rows to select from, and every row it will
 * write is listed with a checkbox before the button can do anything.
 */
function SeoListingsCard({ queueJob, applyJob }: { queueJob: JobRunLike; applyJob: JobRunLike }) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const revalidator = useRevalidator();

  const building = queueJob?.status === "queued" || queueJob?.status === "running";
  const applying = applyJob?.status === "queued" || applyJob?.status === "running";

  useEffect(() => {
    if (!building && !applying) return;
    const id = setInterval(() => revalidator.revalidate(), 2000);
    return () => clearInterval(id);
  }, [building, applying, revalidator]);

  const report = queueJob?.status === "done" ? (queueJob.report as SeoQueue) : null;
  const queueTrouble =
    queueJob && (queueJob.status === "failed" || queueJob.status === "refused")
      ? ((queueJob.report as { error?: string; reason?: string } | null) ?? null)
      : null;
  const applyReport =
    applyJob && applyJob.status !== "queued" && applyJob.status !== "running" && applyJob.status !== "failed"
      ? ((applyJob.report as (SeoApplyReport & { reason?: string }) | null) ?? null)
      : null;
  const applyFailed =
    applyJob && applyJob.status === "failed"
      ? ((applyJob.report as { error?: string } | null) ?? null)
      : null;

  const rows = report?.rows ?? [];
  const rowKey = queueJob?.finishedAt ?? "none";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [showProtected, setShowProtected] = useState(false);
  const PAGE_SIZE = 100;

  // Re-derive the default selection (everything proposed, checked) whenever
  // a fresh build result arrives - stale keys from a previous queue must
  // never linger into a new one.
  useEffect(() => {
    const next = new Set<string>();
    for (const row of rows) {
      if (row.titleSuggestion) next.add(`${row.id}:seo_title`);
      if (row.descriptionSuggestion) next.add(`${row.id}:seo_description`);
    }
    setSelected(next);
    setPage(0);
    // rowKey changes only when a new queue result lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedItems = rows.flatMap((row) => {
    const out: { id: string; field: SeoKey; value: string }[] = [];
    if (row.titleSuggestion && selected.has(`${row.id}:seo_title`)) {
      out.push({ id: row.id, field: "seo_title", value: row.titleSuggestion });
    }
    if (row.descriptionSuggestion && selected.has(`${row.id}:seo_description`)) {
      out.push({ id: row.id, field: "seo_description", value: row.descriptionSuggestion });
    }
    return out;
  });

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function selectAll() {
    const next = new Set<string>();
    for (const row of rows) {
      if (row.titleSuggestion) next.add(`${row.id}:seo_title`);
      if (row.descriptionSuggestion) next.add(`${row.id}:seo_description`);
    }
    setSelected(next);
  }

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            Write the missing search listings
          </Text>
          <Text as="p" tone="subdued">
            Meta titles and meta descriptions condensed from each product's
            own title and description. Nothing is invented, nothing is
            written until you review it below, and anything set by you or
            set outside this app is left alone.
          </Text>
        </BlockStack>

        <InlineStack gap="200">
          <Form method="post">
            <input type="hidden" name="intent" value="seo_build_queue" />
            <Button submit loading={busy && !building} disabled={building || applying}>
              {report ? "Preview again" : "Preview"}
            </Button>
          </Form>

          <Form method="post">
            <input type="hidden" name="intent" value="seo_apply" />
            {selectedItems.map((item) => (
              <input
                key={`${item.id}:${item.field}`}
                type="hidden"
                name="items"
                value={JSON.stringify(item)}
              />
            ))}
            <Button
              submit
              variant="primary"
              loading={busy && !applying}
              disabled={!report || selectedItems.length === 0 || applying || building}
            >
              {report
                ? `Write ${selectedItems.length} listing${selectedItems.length === 1 ? "" : "s"}`
                : "Write listings"}
            </Button>
          </Form>
        </InlineStack>

        {report ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`${report.checked} products checked. ${report.missingTitle} have no meta title, ${report.missingDescription} have no meta description. ${report.outsideApp} field${report.outsideApp === 1 ? "" : "s"} set outside this app; those are never touched.`}
          </Text>
        ) : (
          <Text as="p" variant="bodySm" tone="subdued">
            Preview reads the whole catalogue and proposes a value for every
            empty, unprotected field; nothing is written by this step.
          </Text>
        )}

        {building ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" />
            <Text as="p" tone="subdued" variant="bodySm">
              {queueJob && queueJob.total > 0
                ? `Reading the catalogue - ${queueJob.progress} of ${queueJob.total} products.`
                : "Starting up..."}
            </Text>
          </InlineStack>
        ) : null}

        {queueTrouble ? (
          <Banner tone="warning">
            {queueTrouble.reason ?? queueTrouble.error ?? "The last preview did not finish."}
          </Banner>
        ) : null}

        {applyFailed ? (
          <Banner tone="critical">
            {`The last write did not finish: ${applyFailed.error ?? "unknown error"}. Nothing beyond what is reported below was written.`}
          </Banner>
        ) : null}

        {applyReport ? (
          <Banner tone={applyReport.refused ? "warning" : "success"}>
            {applyReport.refused
              ? (applyReport.reason ?? "The SEO module was switched off before this write ran. Nothing was written.")
              : `Written: ${applyReport.written}, left alone (protected): ${applyReport.skipped}, already matched: ${applyReport.unchanged}.`}
          </Banner>
        ) : null}

        {applying ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" />
            <Text as="p" tone="subdued" variant="bodySm">
              {applyJob && applyJob.total > 0
                ? `Writing - ${applyJob.progress} of ${applyJob.total} products.`
                : "Starting up..."}
            </Text>
          </InlineStack>
        ) : null}

        {report && rows.length === 0 ? (
          <Text as="p" tone="subdued">
            Nothing to propose right now. Every product either already has
            both fields set or is protected.
          </Text>
        ) : null}

        {rows.length > 0 ? (
          <BlockStack gap="300">
            <InlineStack gap="200">
              <Button size="slim" onClick={selectAll}>
                Select all
              </Button>
              <Button size="slim" onClick={() => setSelected(new Set())}>
                Clear all
              </Button>
            </InlineStack>

            <BlockStack gap="200">
              {pageRows.map((row) => (
                <Box
                  key={row.id}
                  padding="300"
                  borderRadius="200"
                  borderWidth="025"
                  borderColor="border"
                >
                  <BlockStack gap="150">
                    <Text as="p" fontWeight="semibold">
                      {row.title}
                    </Text>
                    {row.titleSuggestion ? (
                      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={selected.has(`${row.id}:seo_title`)}
                          onChange={() => toggle(`${row.id}:seo_title`)}
                        />
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            {row.currentTitle
                              ? `Meta title (currently "${row.currentTitle}")`
                              : "Meta title - not set"}
                          </Text>
                          <Text as="span" variant="bodySm">
                            {row.titleSuggestion}
                          </Text>
                        </BlockStack>
                      </label>
                    ) : null}
                    {row.descriptionSuggestion ? (
                      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={selected.has(`${row.id}:seo_description`)}
                          onChange={() => toggle(`${row.id}:seo_description`)}
                        />
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Meta description - not set
                          </Text>
                          <Text as="span" variant="bodySm">
                            {row.descriptionSuggestion}
                          </Text>
                        </BlockStack>
                      </label>
                    ) : null}
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>

            {pageCount > 1 ? (
              <InlineStack gap="200" blockAlign="center">
                <Button size="slim" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Text as="span" variant="bodySm" tone="subdued">
                  {`Page ${page + 1} of ${pageCount}`}
                </Text>
                <Button
                  size="slim"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </InlineStack>
            ) : null}
          </BlockStack>
        ) : null}

        {report && report.protectedRows.length > 0 ? (
          <BlockStack gap="200">
            <InlineStack>
              <Button variant="plain" onClick={() => setShowProtected((v) => !v)}>
                {`${showProtected ? "Hide" : "Show"} ${report.protectedRows.length} protected field${report.protectedRows.length === 1 ? "" : "s"}`}
              </Button>
            </InlineStack>
            {showProtected ? (
              <List>
                {report.protectedRows.slice(0, 200).map((r, i) => (
                  <List.Item key={`${r.id}:${r.field}:${i}`}>
                    {r.title} -{" "}
                    {r.field === "seo_title" ? "meta title" : "meta description"}: {r.reason}
                  </List.Item>
                ))}
              </List>
            ) : null}
          </BlockStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}

export default function Seo() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [detailOpen, setDetailOpen] = useState(false);

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

  const stored = data.themeScan?.detail as any as ThemeScanResult | undefined;
  const queueJob = data.queueJob as any as JobRunLike;
  const report = queueJob?.status === "done" ? (queueJob.report as SeoQueue) : null;
  const scanDate = data.themeScan?.scannedAt
    ? new Date(data.themeScan.scannedAt).toLocaleDateString()
    : null;

  // Metric row (SEO-WORKSPACE-PRD dashboard rebuild): four fractions, each
  // with its method beneath. A missing or failed read never prints as a
  // zero - the tile states what happened instead.
  const metaDescriptionMetric = report
    ? {
        value: `${report.checked - report.missingDescription} of ${report.checked}`,
        hint: "Products with a meta description, from the last catalogue check.",
      }
    : {
        value: "Not checked yet",
        hint: "Press Preview on the listing below to check your catalogue.",
      };

  const metaTitleMetric = report
    ? {
        value: `${report.checked - report.missingTitle} of ${report.checked}`,
        hint: "Products with a meta title, from the last catalogue check.",
      }
    : {
        value: "Not checked yet",
        hint: "Press Preview on the listing below to check your catalogue.",
      };

  let schemaMetric: { value: string; hint: string; tone?: "success" | "critical" | "subdued" };
  let conflictMetric: { value: string; hint: string; tone?: "success" | "critical" | "subdued" };
  if (!data.themeScan || !stored) {
    schemaMetric = { value: "Not scanned yet", hint: "Press Scan now below - nothing is written to your store." };
    conflictMetric = { value: "Not scanned yet", hint: "Press Scan now below - nothing is written to your store." };
  } else if (stored.passwordProtected) {
    schemaMetric = {
      value: "Could not be read",
      hint: "The storefront answered with the password page on the last scan.",
    };
    conflictMetric = {
      value: "Could not be read",
      hint: "The storefront answered with the password page on the last scan.",
    };
  } else {
    const nodeTypeCount = new Set([
      ...(stored.product?.nodes.flatMap((n) => n.types) ?? []),
      ...(stored.home?.nodes.flatMap((n) => n.types) ?? []),
    ]).size;
    const conflictCount = (stored.productConflicts?.length ?? 0) + (stored.homeConflicts?.length ?? 0);
    schemaMetric = {
      value: String(nodeTypeCount),
      hint: `Distinct JSON-LD types found on the product and home page, scanned ${scanDate}.`,
    };
    conflictMetric = {
      value: String(conflictCount),
      hint: `A node type appearing more than once on the same page, scanned ${scanDate}.`,
      tone: conflictCount > 0 ? "critical" : undefined,
    };
  }

  return (
    <Page title="SEO" subtitle="Search listings, structured data and what still needs work">
      <BlockStack gap="500">
        {actionData?.error ? <Banner tone="critical">{actionData.error}</Banner> : null}

        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <MetricTile label="Meta descriptions" {...metaDescriptionMetric} />
          <MetricTile label="Meta titles" {...metaTitleMetric} />
          <MetricTile label="Schema node types" {...schemaMetric} />
          <MetricTile label="Conflicts" {...conflictMetric} />
        </InlineGrid>

        <SeoListingsCard queueJob={queueJob} applyJob={data.applyJob as any as JobRunLike} />

        <TermGapCard report={report} />

        <FindingsCard
          themeScan={data.themeScan}
          result={stored}
          richResultsUrl={stored?.richResultsUrl}
          busy={busy}
        />

        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Full scan detail
              </Text>
              <Button variant="plain" onClick={() => setDetailOpen((v) => !v)}>
                {detailOpen ? "Hide" : "Show"}
              </Button>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              Every JSON-LD node found on the last scan, robots.txt, canonical
              tags and the weekly watch history - the evidence the cards
              above summarise.
            </Text>
            <Collapsible open={detailOpen} id="seo-full-detail">
              <Box paddingBlockStart="300">
                {!stored || stored.passwordProtected ? (
                  <Text as="p" tone="subdued">
                    {!data.themeScan
                      ? "Not scanned yet."
                      : "The storefront answered with the password page, so nothing could be read in the last scan."}
                  </Text>
                ) : (
                  <SchemaDetail result={stored} />
                )}
              </Box>
            </Collapsible>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
