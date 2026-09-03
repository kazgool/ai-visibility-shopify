import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Thumbnail,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
  InlineGrid,
  Box,
  Banner,
  ProgressBar,
  Spinner,
  Divider,
  Icon,
} from "@shopify/polaris";
import { CheckIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueue } from "../services/queue.server";
import { checkAppEmbed, embedDeepLink } from "../services/embed-check.server";
import { businessFor } from "../services/business.server";
import { hasPaidAccess, freeProductIds } from "../services/billing.server";
import { crawlerHitsForDashboard } from "../services/crawler-hits.server";
import { describeJobKind } from "../services/job-kinds";

// A dashboard, not a form: a merchant should see the state of their catalogue
// in one glance - how much is covered, what is protected, what is left to do -
// and reach every action from the same screen.

const PRODUCTS = `#graphql
  query DashboardProducts {
    productsCount { count }
    products(first: 20, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        status
        featuredMedia { preview { image { url altText } } }
        metafields(namespace: "$app", first: 10) { nodes { key value } }
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const res = await admin.graphql(PRODUCTS);
  const json = await res.json();

  // Verified against the published theme on every load, never assumed: an
  // installed but disabled embed renders nothing and nobody notices.
  const embed = await checkAppEmbed(admin.graphql);

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const [lastRun, lastAlt, dictionary, lastWrite] = shop
    ? await Promise.all([
        db.jobRun.findFirst({
          where: { shopId: shop.id, kind: { in: ["dry_run", "bulk_extract"] } },
          orderBy: { startedAt: "desc" },
        }),
        db.jobRun.findFirst({
          where: { shopId: shop.id, kind: "alt_text" },
          orderBy: { startedAt: "desc" },
        }),
        db.setting.findUnique({
          where: { shopId_key: { shopId: shop.id, key: "dictionary" } },
        }),
        // A preview run after a real pass must not make the checklist forget
        // that the catalogue was already filled.
        db.jobRun.findFirst({
          where: { shopId: shop.id, kind: "bulk_extract", status: "done" },
          orderBy: { finishedAt: "desc" },
        }),
      ])
    : [null, null, null, null];

  // Latest verdict per crawler: one row each, newest first.
  const checks = shop
    ? await db.crawlerCheck.findMany({
        where: { shopId: shop.id },
        orderBy: { checkedAt: "desc" },
        take: 25,
      })
    : [];
  const latestByAgent = new Map<string, (typeof checks)[number]>();
  for (const c of checks) if (!latestByAgent.has(c.agent)) latestByAgent.set(c.agent, c);

  const crawlerJob = shop
    ? await db.jobRun.findFirst({
        where: { shopId: shop.id, kind: "crawler_check" },
        orderBy: { startedAt: "desc" },
      })
    : null;

  const collectionsJob = shop
    ? await db.jobRun.findFirst({
        where: { shopId: shop.id, kind: "collections", status: "done" },
        orderBy: { finishedAt: "desc" },
      })
    : null;
  const business = shop ? await businessFor(shop.id) : null;

  // CRAWLER-HITS-SPEC §6, EXPERIENCE-PRD §7: real requests to the plain text
  // mirror and llms.txt, logged by the app proxy. session.shop is the domain
  // string CrawlerHit.shopId is keyed on - never shop.id.
  const crawlerHits = await crawlerHitsForDashboard(session.shop, 7);

  // FREE-TIER-SPEC §2, §5: the crawler check and the coverage score (dry
  // run) are free for every shop; a subscribed shop sees none of this.
  const hasAccess = await hasPaidAccess(session.shop, shop?.id, admin.graphql);
  // The set of chosen product ids is the authority on the free tier, not the
  // legacy freeProductsUsed counter: the counter counted writes, so a shop
  // that reprocessed one free product under the old rule shows a higher
  // count than products actually chosen, and the two screens would disagree.
  const freeProductsUsed = shop ? (await freeProductIds(shop.id)).length : 0;
  const freeProductsRemaining = Math.max(0, 3 - freeProductsUsed);

  // Is a job stuck? Answered from the row, not from a counter in the browser
  // that resets on every refresh. `updatedAt` moves on every progress write,
  // so a job that is genuinely working never looks stalled however long the
  // catalogue is; one that nothing is consuming does, and says so on the
  // first load rather than only to whoever leaves the tab open.
  //
  // Any kind, the same set the action's one-at-a-time guard blocks on. The
  // list used to be [lastRun, lastAlt, crawlerJob], so a queued job of any
  // other kind - a setting change from the Report screen, a collections pass -
  // blocked every button here while this banner never fired, and the merchant
  // was locked out with no explanation (QA of 3 September 2026, wave fix 5).
  const STALL_MS = 3 * 60 * 1000;
  const activeJob = shop
    ? await db.jobRun.findFirst({
        where: { shopId: shop.id, status: { in: ["queued", "running"] } },
        orderBy: { updatedAt: "desc" },
        select: { kind: true, status: true, updatedAt: true },
      })
    : null;
  const stalledFor =
    activeJob && Date.now() - activeJob.updatedAt.getTime() > STALL_MS
      ? Math.floor((Date.now() - activeJob.updatedAt.getTime()) / 60000)
      : null;

  return {
    stalledFor,
    activeJobKind: activeJob?.kind ?? null,
    products: json.data?.products?.nodes ?? [],
    totalProducts: json.data?.productsCount?.count ?? 0,
    lastRun,
    lastAlt,
    lastWrite,
    crawlers: Array.from(latestByAgent.values()),
    crawlerJob,
    hasDictionary: Boolean(dictionary?.value?.trim()),
    collectionsBuilt: collectionsJob
      ? {
          at: collectionsJob.finishedAt?.toISOString() ?? null,
          withTable: (collectionsJob.report as any)?.withTable ?? 0,
          total: (collectionsJob.report as any)?.collections ?? 0,
        }
      : null,
    hasBusiness: Boolean(
      business &&
        (business.deliveryTime ||
          business.deliveryCost ||
          business.returnDays ||
          business.warranty ||
          business.paymentMethods),
    ),
    domain: session.shop,
    embed,
    embedLink: embedDeepLink(session.shop),
    hasAccess,
    freeProductsRemaining,
    crawlerHits,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const mode = String(form.get("mode") ?? "dry");

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ok: false };

  // The coverage score (dry run) and the crawler check are free
  // (FREE-TIER-SPEC §2). Writing to the whole catalogue, and bulk alt text,
  // are not - only the three merchant-chosen products on the Products
  // screen are free.
  if (mode === "write" || mode === "alt") {
    const hasAccess = await hasPaidAccess(session.shop, shop.id, admin.graphql);
    if (!hasAccess) return { ok: false, needsSubscription: true };
  }

  // A merchant who thinks nothing is happening presses the button again.
  // Progress itself is safe - it lives in the database, so refreshing or
  // closing the tab loses nothing - but a second job would double the API
  // calls and muddle the report. One at a time.
  const active = await db.jobRun.findFirst({
    where: { shopId: shop.id, status: { in: ["queued", "running"] } },
    select: { kind: true },
  });
  if (active) return { ok: false, alreadyRunning: true, blockingKind: active.kind };

  if (mode === "alt") {
    const jobRun = await db.jobRun.create({
      data: { shopId: shop.id, kind: "alt_text" },
    });
    await enqueue("bulk_alt_text", { shopId: shop.id, jobRunId: jobRun.id });
    return { ok: true };
  }

  if (mode === "crawlers") {
    const jobRun = await db.jobRun.create({
      data: { shopId: shop.id, kind: "crawler_check" },
    });
    await enqueue("crawler_check", { shopId: shop.id, jobRunId: jobRun.id });
    return { ok: true };
  }

  const dryRun = mode !== "write";
  const jobRun = await db.jobRun.create({
    data: { shopId: shop.id, kind: dryRun ? "dry_run" : "bulk_extract" },
  });
  await enqueue("bulk_extract", { shopId: shop.id, dryRun, jobRunId: jobRun.id });
  return { ok: true };
};

type ProductRow = {
  id: string;
  title: string;
  status: string;
  featuredMedia?: { preview?: { image?: { url: string; altText?: string } } };
  metafields?: { nodes: { key: string; value: string }[] };
};

function factCount(p: ProductRow): number {
  const raw = p.metafields?.nodes?.find((m) => m.key === "facts")?.value;
  if (!raw) return 0;
  try {
    return (JSON.parse(raw) as unknown[]).length;
  } catch {
    return 0;
  }
}

/** Short labels for the dashboard; Diagnostics carries the full explanation. */
const CAUSE_SHORT: Record<string, string> = {
  password_page: "Sees the password page",
  bot_protection: "Blocked by bot protection",
  cloudflare: "Blocked by Cloudflare",
  redirect_loop: "Lost in redirects",
  robots_disallow: "Disallowed in robots.txt",
  server_error: "Store returned an error",
  unreachable: "No response - not the same as blocked",
  unknown: "Unclear response",
};

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
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
        {hint ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {hint}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

/**
 * A step is done, not done, or optional. The third state exists because a
 * caution icon on something genuinely optional reads as "you did something
 * wrong" - and a merchant who cannot make a warning go away writes a support
 * ticket about it. Optional steps get a neutral dot and neutral wording.
 */
function Step({
  done,
  optional,
  title,
  children,
}: {
  done: boolean;
  optional?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <InlineStack gap="200" blockAlign="start" wrap={false}>
      <Box paddingBlockStart="050">
        {done ? (
          <Icon source={CheckIcon} tone="success" />
        ) : optional ? (
          <Box
            background="bg-fill-tertiary"
            borderRadius="full"
            minHeight="8px"
            minWidth="8px"
          />
        ) : (
          <Icon source={AlertCircleIcon} tone="caution" />
        )}
      </Box>
      <BlockStack gap="050">
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {title}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {children}
        </Text>
      </BlockStack>
    </InlineStack>
  );
}

export default function Dashboard() {
  const {
    products,
    totalProducts,
    lastRun,
    lastAlt,
    lastWrite,
    crawlers,
    crawlerJob,
    hasDictionary,
    domain,
    embed,
    embedLink,
    collectionsBuilt,
    hasBusiness,
    stalledFor,
    activeJobKind,
    hasAccess,
    freeProductsRemaining,
    crawlerHits,
  } = useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>() as
    | {
        ok: boolean;
        alreadyRunning?: boolean;
        blockingKind?: string;
        needsSubscription?: boolean;
      }
    | undefined;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const running = lastRun?.status === "queued" || lastRun?.status === "running";
  const altRunning = lastAlt?.status === "queued" || lastAlt?.status === "running";
  const crawlerRunning =
    crawlerJob?.status === "queued" || crawlerJob?.status === "running";
  const anyRunning = running || altRunning || crawlerRunning;
  const active = running ? lastRun : altRunning ? lastAlt : crawlerJob;

  const total = active?.total ?? 0;
  const progress = active?.progress ?? 0;
  const percent = total > 0 ? Math.round((progress / total) * 100) : 0;

  const report = lastRun?.report as
    | { sampled: number; none: number; wouldSkip: number; byAttr: [string, number][] }
    | undefined;
  const altReport = lastAlt?.report as
    | { written: number; keptHuman: number; shared: unknown[] }
    | undefined;

  const covered = report ? report.sampled - report.none : 0;
  const coverage = report && report.sampled > 0
    ? Math.round((covered / report.sampled) * 100)
    : 0;
  const written = Boolean(lastWrite);

  // Keep the numbers moving while a pass runs, or people press the button twice.
  //
  // Whether the job is stuck is decided on the server, from the row's own
  // timestamp, so the answer survives a refresh and is the same for everyone
  // looking. Polling stops once it is, rather than hammering a server that
  // has already said nothing is consuming the queue.
  const revalidator = useRevalidator();
  const stalled = typeof stalledFor === "number";

  useEffect(() => {
    if (!anyRunning || stalled) return;
    const id = setInterval(() => revalidator.revalidate(), 2000);
    return () => clearInterval(id);
  }, [anyRunning, stalled, revalidator]);

  return (
    <Page
      title="AI Visibility"
      subtitle="Make this catalogue readable by ChatGPT, Claude, Gemini and Perplexity"
    >
      <BlockStack gap="500">
        {actionData?.alreadyRunning ? (
          <Banner
            tone="warning"
            title={`${describeJobKind(actionData.blockingKind)} is already running`}
          >
            <Text as="p">
              Nothing new was started: one job runs at a time, so a second
              would only double the API calls and muddle the report. Its
              progress is saved on our servers
              {actionData.blockingKind === "reconcile"
                ? " and its result shows on the Report screen."
                : " - it shows on this screen as it moves."}
            </Text>
          </Banner>
        ) : null}

        {actionData?.needsSubscription ? (
          <Banner tone="critical" title="This needs a subscription">
            <Text as="p">
              Nothing was written. Filling the whole catalogue and bulk alt
              text are subscription features; the crawler check, the coverage
              preview and your three chosen products stay free. Everything
              already written stays written.
            </Text>
          </Banner>
        ) : null}

        {!hasAccess ? (
          <Banner tone="info" title="Before you subscribe">
            <BlockStack gap="100">
              <Text as="p">
                {"The crawler check and the coverage score are free, and so are the three products you choose to process, from the Products screen ("}
                {freeProductsRemaining}
                {" of 3 remaining). Everything else - the rest of the catalogue, automatic freshness, collections, bulk alt text - needs a subscription."}
              </Text>
              <Text as="p">
                What gets written stays written, in your own Shopify metafields, whether you subscribe or not.
              </Text>
            </BlockStack>
          </Banner>
        ) : null}

        {stalled ? (
          <Banner
            tone="warning"
            title={`${describeJobKind(activeJobKind)} has not moved in ${stalledFor} minute${stalledFor === 1 ? "" : "s"}`}
          >
            <Text as="p">
              The background worker is not picking work up. Nothing is lost -
              the job stays queued and runs from where it stopped as soon as
              the worker is back. If this does not clear on its own, write to
              us and we will look at it.
            </Text>
          </Banner>
        ) : null}

        {running || altRunning ? (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="300" blockAlign="center">
                <Spinner size="small" />
                <BlockStack gap="050">
                  <Text as="p" variant="headingSm">
                    {running ? "Reading your catalogue" : "Writing alt text"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {total === 0
                      ? "Starting up..."
                      : `${percent}% - ${progress} of ${total} products.`}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    This runs on our servers. Close the tab, refresh, come back
                    tomorrow - the progress is saved, not in this window.
                  </Text>
                </BlockStack>
              </InlineStack>
              {total > 0 ? <ProgressBar progress={percent} size="small" tone="primary" /> : null}
            </BlockStack>
          </Card>
        ) : null}

        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Metric label="Products" value={String(totalProducts)} hint="in this catalogue" />
          <Metric
            label="Coverage"
            value={report ? `${coverage}%` : "-"}
            hint={report ? `${covered} produce attributes` : "run a check to find out"}
            tone={report && coverage >= 80 ? "success" : undefined}
          />
          <Metric
            label="Protected"
            value={report ? String(report.wouldSkip) : "-"}
            hint="written by a person, never overwritten"
          />
          <Metric
            label="Alt text"
            value={altReport ? String(altReport.written) : "-"}
            hint={altReport ? `${altReport.keptHuman} left as written` : "not run yet"}
          />
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap={false}>
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">
                  Can AI assistants read this store?
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  We request a product page from outside Shopify, once per
                  crawler, with the exact user agent it uses.
                </Text>
              </BlockStack>
              <Form method="post">
                <input type="hidden" name="mode" value="crawlers" />
                <Button submit loading={busy} disabled={crawlerRunning}>
                  {crawlers.length ? "Check again" : "Check now"}
                </Button>
              </Form>
            </InlineStack>

            {crawlerRunning ? (
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" />
                <Text as="p" variant="bodySm" tone="subdued">
                  Asking each crawler...
                </Text>
              </InlineStack>
            ) : crawlers.length === 0 ? (
              <Text as="p" tone="subdued">
                Not checked yet.
              </Text>
            ) : (
              <InlineGrid columns={{ xs: 1, sm: 2, md: 5 }} gap="300">
                {crawlers.map((c: any) => (
                  <Box
                    key={c.agent}
                    padding="300"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                    background={c.cause === "ok" ? "bg-fill-success-secondary" : "bg-fill-critical-secondary"}
                  >
                    <BlockStack gap="100">
                      <InlineStack gap="100" blockAlign="center" wrap={false}>
                        <Icon
                          source={c.cause === "ok" ? CheckIcon : AlertCircleIcon}
                          tone={c.cause === "ok" ? "success" : "critical"}
                        />
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {c.agent}
                        </Text>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {c.cause === "ok" ? "Can read your products" : CAUSE_SHORT[c.cause] ?? c.cause}
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
              </InlineGrid>
            )}

            {crawlers.length > 0 && crawlers.some((c: any) => c.cause !== "ok") ? (
              <Banner tone="warning">
                <InlineStack gap="200" align="space-between" blockAlign="center" wrap={false}>
                  <Text as="p">
                    Some crawlers cannot reach your products. Diagnostics
                    explains each cause and what to change.
                  </Text>
                  <Link to="/app/diagnostics">
                    <Button size="slim">See why</Button>
                  </Link>
                </InlineStack>
              </Banner>
            ) : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">
                Who requested your plain text pages
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Real requests to your plain text mirror and llms.txt, logged
                by our proxy in the last {crawlerHits.days} days. Not visits
                to your themed storefront - Shopify serves those directly and
                we never see them.
              </Text>
            </BlockStack>

            {crawlerHits.byBot.length === 0 ? (
              <Text as="p" tone="subdued">
                No requests recorded in the last {crawlerHits.days} days.
                These pages only get requested once the app embed is active
                in your theme and products have been processed - see Setup
                below. We log real requests only; we never estimate a number
                here.
              </Text>
            ) : (
              <InlineStack gap="150" wrap>
                {crawlerHits.byBot.map((b: { bot: string; count: number; lastSeen: string }) => (
                  <Box
                    key={b.bot}
                    padding="200"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                  >
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {b.bot}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {`${b.count} request${b.count === 1 ? "" : "s"} - last ${new Date(b.lastSeen).toLocaleDateString()}`}
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Extract comparable attributes
                </Text>
                <Text as="p" tone="subdued">
                  We read the descriptions you already wrote and pull out the
                  attributes buyers compare. Nothing is invented, and anything
                  you edit by hand is never touched again.
                </Text>
              </BlockStack>

              <InlineStack gap="200" wrap>
                <Form method="post">
                  <input type="hidden" name="mode" value="dry" />
                  <Button submit loading={busy} disabled={anyRunning} size="large">
                    Preview changes
                  </Button>
                </Form>
                {hasAccess ? (
                  <Form method="post">
                    <input type="hidden" name="mode" value="write" />
                    <Button
                      submit
                      variant="primary"
                      loading={busy}
                      disabled={anyRunning}
                      size="large"
                    >
                      Fill catalogue
                    </Button>
                  </Form>
                ) : (
                  <Link to="/app/plans">
                    <Button variant="primary" size="large">
                      Subscribe to fill the whole catalogue
                    </Button>
                  </Link>
                )}
              </InlineStack>

              {report && !anyRunning ? (
                <>
                  <Divider />
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Last {written ? "pass" : "preview"}: {report.sampled} products read,{" "}
                      {report.none} without attributes, {report.wouldSkip} protected.
                    </Text>
                    <InlineStack gap="100" wrap>
                      {report.byAttr?.slice(0, 6).map(([label, n]) => (
                        <Badge key={label} tone="info">{`${label} · ${n}`}</Badge>
                      ))}
                    </InlineStack>
                  </BlockStack>
                </>
              ) : null}
            </BlockStack>
          </Card>

          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Describe your images
                  </Text>
                  <Text as="p" tone="subdued">
                    Short, specific alt text built from the attributes - never a
                    keyword dump, never over a description someone wrote.
                  </Text>
                </BlockStack>
                <InlineStack gap="200">
                  {hasAccess ? (
                    <Form method="post">
                      <input type="hidden" name="mode" value="alt" />
                      <Button submit loading={busy} disabled={anyRunning}>
                        Write missing alt text
                      </Button>
                    </Form>
                  ) : (
                    <Link to="/app/plans">
                      <Button>Subscribe to write alt text in bulk</Button>
                    </Link>
                  )}
                </InlineStack>
                {altReport && lastAlt?.status === "done" ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {`Last pass: ${lastAlt.total ?? "all"} products checked, ${
                      altReport.written
                    } ${altReport.written === 1 ? "description" : "descriptions"} written, ${
                      altReport.keptHuman
                    } left as a person wrote them.`}
                  </Text>
                ) : null}
                {altReport?.shared?.length ? (
                  <Banner tone="warning">
                    {altReport.shared.length} images are used by more than one
                    product. We left their descriptions alone rather than
                    describe one product as another.
                  </Banner>
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Setup
                </Text>
                <BlockStack gap="300">
                  <Step done={hasDictionary} title="Dictionary for your trade">
                    {hasDictionary
                      ? "Saved. Edit it whenever your catalogue changes."
                      : "Pick a preset and translate the terms into the language your descriptions use."}
                  </Step>
                  <Step done={written} title="Attributes written">
                    {written
                      ? `Written ${new Date(lastWrite.finishedAt).toLocaleDateString()}. New and edited products are picked up automatically.`
                      : "Run a preview first, then fill the catalogue."}
                  </Step>
                  <Step
                    done={Boolean(collectionsBuilt)}
                    optional
                    title="Collection pages built"
                  >
                    {collectionsBuilt
                      ? `${collectionsBuilt.withTable} of ${collectionsBuilt.total} collections carry a comparison table. The rest have nothing that varies enough to compare, which is a fact about the products, not a fault.`
                      : "Collections can carry a summary and a comparison table. Build them from the Collections screen."}
                  </Step>
                  <Step
                    done={hasBusiness}
                    optional
                    title="Delivery, returns and warranty"
                  >
                    {hasBusiness
                      ? "Stated once and published as buyer questions on every product."
                      : "Optional. Fill these in on the Business screen and every product answers them; leave them empty and nothing about them is published. Either way is a complete setup."}
                  </Step>
                  <Step done={embed?.active} title="App embed active in your theme">
                    {embed?.active
                      ? `Verified in ${embed.themeName || "your published theme"}. The storefront output is live.`
                      : embed?.staleReference
                        ? "Enabled, but pointing at an old development version, so it renders nothing. Open the theme editor, switch AI Visibility off and on again, and save."
                        : embed?.presentButDisabled
                          ? 'Added but switched off. Open the theme editor, turn on "AI Visibility" and save.'
                          : 'Turn on "AI Visibility" under App embeds so the data reaches the storefront. Nothing is published until you do.'}
                  </Step>
                  {!embed?.active ? (
                    <InlineStack gap="200">
                      <Button url={embedLink} target="_top">
                        Open theme editor
                      </Button>
                      <Button
                        variant="plain"
                        onClick={() => revalidator.revalidate()}
                        loading={revalidator.state === "loading"}
                      >
                        Check again
                      </Button>
                    </InlineStack>
                  ) : null}
                </BlockStack>
                {report && report.none > 0 ? (
                  <>
                    <Divider />
                    <Text as="p" tone="subdued" variant="bodySm">
                      {`${report.none} ${
                        report.none === 1 ? "product states" : "products state"
                      } nothing an assistant could extract. That is what their descriptions say, not a fault to fix - though adding a material or a size to those descriptions would change it.`}
                    </Text>
                  </>
                ) : null}

                <InlineStack gap="200">
                  <Link to="/app/dictionary">
                    <Button>Open dictionary</Button>
                  </Link>
                  <Link to="/app/products?filter=no_attributes">
                    <Button>See what is missing</Button>
                  </Link>
                  <Link to="/app/diagnostics">
                    <Button>Run diagnostics</Button>
                  </Link>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </InlineGrid>

        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Recently updated
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {domain}
              </Text>
            </InlineStack>
          </Box>
          <IndexTable
            resourceName={{ singular: "product", plural: "products" }}
            itemCount={products.length}
            selectable={false}
            headings={[
              { title: "" },
              { title: "Product" },
              { title: "Attributes" },
              { title: "Status" },
            ]}
          >
            {products.map((p: ProductRow, i: number) => (
              <IndexTable.Row id={p.id} key={p.id} position={i}>
                <IndexTable.Cell>
                  <Thumbnail
                    source={p.featuredMedia?.preview?.image?.url ?? ""}
                    alt={p.featuredMedia?.preview?.image?.altText ?? ""}
                    size="small"
                  />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Link to={`/app/products/${p.id.split("/").pop()}`}>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {p.title}
                    </Text>
                  </Link>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {factCount(p) > 0 ? (
                    <Badge tone="success">{`${factCount(p)}`}</Badge>
                  ) : (
                    <Text as="span" tone="subdued">
                      -
                    </Text>
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={p.status === "ACTIVE" ? "success" : "info"}>
                    {p.status.toLowerCase()}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}
