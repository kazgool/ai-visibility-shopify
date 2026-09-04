import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSubmit,
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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueue } from "../services/queue.server";
import { checkAppEmbed, embedDeepLink } from "../services/embed-check.server";
import { businessFor } from "../services/business.server";
import { hasPaidAccess, freeProductIds } from "../services/billing.server";
import { crawlerHitsForDashboard } from "../services/crawler-hits.server";
import { describeJobKind } from "../services/job-kinds";
import { readPass } from "../services/report-metrics";
import { altProblem, metricTiles, passProblem } from "../services/dashboard-metrics";
import { resolveLadder } from "../services/dashboard-steps";
import { DashboardLadder } from "../components/DashboardLadder";

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
  // The preview and the catalogue pass are read separately, not as one "last
  // run of either kind", because the ladder attributes a failure to the step
  // that queued it: a dry run that failed belongs to step three and a
  // catalogue pass that failed to step four. Merged, every failure would be
  // reported against whichever ran last, which is how a failed preview came to
  // wipe the figures of a real pass.
  const [lastDry, lastBulk, lastAlt, dictionary, lastWrite] = shop
    ? await Promise.all([
        db.jobRun.findFirst({
          where: { shopId: shop.id, kind: "dry_run" },
          orderBy: { startedAt: "desc" },
        }),
        db.jobRun.findFirst({
          where: { shopId: shop.id, kind: "bulk_extract" },
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
    : [null, null, null, null, null];

  // The headline tiles read whichever of the two ran last, which is what they
  // have always done.
  const lastRun =
    lastDry && lastBulk
      ? (lastDry.startedAt?.getTime() ?? 0) >= (lastBulk.startedAt?.getTime() ?? 0)
        ? lastDry
        : lastBulk
      : (lastDry ?? lastBulk);

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

  // The only door into a pass's figures, the same one the Report screen uses
  // (report-metrics.ts). A failed run's report is `{ error }`, which is
  // truthy, so reading `lastRun.report` directly rendered a failure as a
  // measurement: coverage 0%, "NaN produce attributes", "undefined products
  // read" (audit of 2 September 2026, finding 1.4). Only status "done" is a
  // measurement; everything else names itself.
  const pass = readPass(
    lastRun
      ? {
          status: lastRun.status,
          report: lastRun.report,
          startedAt: lastRun.startedAt?.toISOString() ?? null,
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          kind: lastRun.kind,
        }
      : null,
  );

  // The alt text pass has the same disease and the same cure. Its report has
  // no `sampled`, so readPass cannot judge it; the status can.
  const altPass =
    lastAlt && lastAlt.status === "done"
      ? {
          total: lastAlt.total,
          ...((lastAlt.report ?? {}) as {
            written?: number;
            keptHuman?: number;
            shared?: unknown[];
          }),
        }
      : null;
  const altFailed =
    lastAlt && lastAlt.status !== "done" && lastAlt.status !== "queued" && lastAlt.status !== "running"
      ? {
          status: lastAlt.status,
          reason:
            ((lastAlt.report ?? null) as { reason?: string; error?: string } | null)?.reason ??
            ((lastAlt.report ?? null) as { reason?: string; error?: string } | null)?.error ??
            "No reason was recorded with it.",
        }
      : null;

  // The ladder is resolved on the server, from this loader and nothing else,
  // so the browser never decides which step is open (audit findings 1.6 and
  // 1.7). No new JobRun kind serves it: every done state below is a row that
  // already existed.
  const asPass = (j: typeof lastDry) =>
    readPass(
      j
        ? {
            status: j.status,
            report: j.report,
            startedAt: j.startedAt?.toISOString() ?? null,
            finishedAt: j.finishedAt?.toISOString() ?? null,
            kind: j.kind,
          }
        : null,
    );

  const crawlerVerdicts = Array.from(latestByAgent.values()).map((c) => ({
    agent: c.agent,
    cause: c.cause ?? 'unknown',
  }));

  const ladder = resolveLadder({
    crawlerJob: crawlerJob
      ? {
          status: crawlerJob.status,
          report: crawlerJob.report,
          finishedAt: crawlerJob.finishedAt?.toISOString() ?? null,
        }
      : null,
    crawlers: crawlerVerdicts,
    embed,
    embedLink: embedDeepLink(session.shop),
    hasAccess,
    freeProductsRemaining,
    previewPass: asPass(lastDry),
    fillPass: asPass(lastBulk),
    lastWrite: lastWrite ? { finishedAt: lastWrite.finishedAt?.toISOString() ?? null } : null,
    hasDictionary: Boolean(dictionary?.value?.trim()),
    hasBusiness: Boolean(
      business &&
        (business.deliveryTime ||
          business.deliveryCost ||
          business.returnDays ||
          business.warranty ||
          business.paymentMethods),
    ),
    collectionsBuilt: collectionsJob
      ? {
          at: collectionsJob.finishedAt?.toISOString() ?? null,
          withTable: (collectionsJob.report as any)?.withTable ?? 0,
          total: (collectionsJob.report as any)?.collections ?? 0,
        }
      : null,
    blockingKind: activeJob?.kind ?? null,
  });

  return {
    stalledFor,
    activeJobKind: activeJob?.kind ?? null,
    products: json.data?.products?.nodes ?? [],
    totalProducts: json.data?.productsCount?.count ?? 0,
    ladder,
    pass,
    altPass,
    altFailed,
    // Progress only: nothing on this screen may read a report off these rows.
    lastRun: lastRun ? { status: lastRun.status, total: lastRun.total, progress: lastRun.progress } : null,
    lastAlt: lastAlt ? { status: lastAlt.status, total: lastAlt.total, progress: lastAlt.progress } : null,
    crawlers: crawlerVerdicts,
    crawlerJob: crawlerJob ? { status: crawlerJob.status } : null,
    // hasDictionary, hasBusiness, collectionsBuilt, embed and embedLink are
    // not returned any more: every one of them was a done state for the old
    // Setup checklist, and the ladder resolves them on the server above. A
    // value returned to a screen that does not read it is the next screen's
    // temptation to read it without the rule that goes with it.
    domain: session.shop,
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

export default function Dashboard() {
  const {
    products,
    totalProducts,
    ladder,
    pass,
    altPass,
    altFailed,
    lastRun,
    lastAlt,
    crawlers,
    crawlerJob,
    domain,
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

  // Figures exist only when the pass is done. Everywhere below reads
  // `figures`, never a report, so a failed pass cannot reach a tile.
  const figures = pass.state === "done" ? pass.figures : null;
  const altReport = altPass;


  // Assembled in dashboard-metrics.ts, not here: arithmetic inside JSX is what
  // put NaN on this screen and could not be tested without a browser.
  const tiles = metricTiles({ totalProducts, pass, alt: altPass, altFailed });
  const problem = passProblem(pass);
  const altProblemLine = altProblem(altFailed);

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

  // The ladder posts through this rather than through its own <Form>, so the
  // component stays free of Remix imports and can be rendered in a test. The
  // action is unchanged: the same one-at-a-time guard, the same `mode` field.
  const submit = useSubmit();
  const runJob = (mode: string) => {
    const fd = new FormData();
    fd.set("mode", mode);
    submit(fd, { method: "post" });
  };

  // Nothing is removed, only ranked. Everything the five steps do not own
  // lives here, one disclosure below them: the detail of the last pass, bulk
  // alt text, and every screen the nav also reaches. A merchant who wants the
  // old flat set of controls opens one toggle and has it.
  const everythingElse = (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            What the last pass found
          </Text>
          {figures ? (
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                {`${figures.sampled} products read, ${figures.none} without attributes, ${figures.wouldSkip ?? 0} protected.`}
              </Text>
              <InlineStack gap="100" wrap>
                {figures.byAttr?.slice(0, 6).map(([label, n]: [string, number]) => (
                  <Badge key={label} tone="info">{`${label} · ${n}`}</Badge>
                ))}
              </InlineStack>
              {figures.none > 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {`${figures.none} ${
                    figures.none === 1 ? "product states" : "products state"
                  } nothing an assistant could extract. That is what their descriptions say, not a fault to fix - though adding a material or a size to those descriptions would change it.`}
                </Text>
              ) : null}
            </BlockStack>
          ) : problem ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {problem}
            </Text>
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">
              No pass has finished yet, so there is nothing to detail here.
            </Text>
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              Describe your images
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Short, specific alt text built from the attributes - never a
              keyword dump, never over a description someone wrote.
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            {hasAccess ? (
              <Button loading={busy} disabled={anyRunning} onClick={() => runJob("alt")}>
                Write missing alt text
              </Button>
            ) : (
              <Link to="/app/plans">
                <Button>Subscribe to write alt text in bulk</Button>
              </Link>
            )}
          </InlineStack>
          {altReport ? (
            <Text as="p" tone="subdued" variant="bodySm">
              {`Last pass: ${altReport.total ?? "all"} products checked, ${
                altReport.written ?? 0
              } ${altReport.written === 1 ? "description" : "descriptions"} written, ${
                altReport.keptHuman ?? 0
              } left as a person wrote them.`}
            </Text>
          ) : altProblemLine ? (
            <Text as="p" tone="subdued" variant="bodySm">
              {altProblemLine}
            </Text>
          ) : null}
          {altReport?.shared?.length ? (
            <Banner tone="warning">
              {`${altReport.shared.length} images are used by more than one product. We left their descriptions alone rather than describe one product as another.`}
            </Banner>
          ) : null}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Every other screen
          </Text>
          <InlineStack gap="200" wrap>
            <Link to="/app/dictionary">
              <Button>Open dictionary</Button>
            </Link>
            <Link to="/app/business">
              <Button>Delivery, returns and warranty</Button>
            </Link>
            <Link to="/app/collections">
              <Button>Collections</Button>
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
  );

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
          {tiles.map((t) => (
            <Metric key={t.label} label={t.label} value={t.value} hint={t.hint} tone={t.tone} />
          ))}
        </InlineGrid>

        <DashboardLadder
          ladder={ladder}
          crawlers={crawlers}
          crawlerRunning={crawlerRunning}
          busy={busy}
          onJob={runJob}
          onRevalidate={() => revalidator.revalidate()}
          linkTo={(to, children) => <Link to={to}>{children}</Link>}
          everythingElse={everythingElse}
        />


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
