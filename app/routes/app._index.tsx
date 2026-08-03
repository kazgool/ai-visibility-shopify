import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  Link,
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
        metafields(namespace: "$app", first: 5) { nodes { key value } }
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

  return {
    products: json.data?.products?.nodes ?? [],
    totalProducts: json.data?.productsCount?.count ?? 0,
    lastRun,
    lastAlt,
    lastWrite,
    crawlers: Array.from(latestByAgent.values()),
    crawlerJob,
    hasDictionary: Boolean(dictionary?.value?.trim()),
    domain: session.shop,
    embed,
    embedLink: embedDeepLink(session.shop),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const mode = String(form.get("mode") ?? "dry");

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ok: false };

  // A merchant who thinks nothing is happening presses the button again.
  // Progress itself is safe - it lives in the database, so refreshing or
  // closing the tab loses nothing - but a second job would double the API
  // calls and muddle the report. One at a time.
  const active = await db.jobRun.findFirst({
    where: { shopId: shop.id, status: { in: ["queued", "running"] } },
  });
  if (active) return { ok: false, alreadyRunning: true };

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

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <InlineStack gap="200" blockAlign="start" wrap={false}>
      <Box paddingBlockStart="050">
        <Icon source={done ? CheckIcon : AlertCircleIcon} tone={done ? "success" : "caution"} />
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
  } = useLoaderData<typeof loader>() as any;
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
  // Bounded on purpose: if the worker is down, a job sits in "queued" forever
  // and an unbounded poll would hammer the server and lie to the merchant.
  // After five minutes we stop and say so.
  const revalidator = useRevalidator();
  const [idlePolls, setIdlePolls] = useState(0);

  // Only a job that is not moving counts as stuck. A bulk alt-text pass over
  // a large catalogue legitimately takes minutes, and cutting its progress
  // display off would be worse than useless.
  useEffect(() => {
    setIdlePolls(0);
  }, [progress, active?.status]);

  const stalled = idlePolls >= 90; // three minutes without any movement

  useEffect(() => {
    if (!anyRunning || stalled) return;
    const id = setInterval(() => {
      setIdlePolls((n) => n + 1);
      revalidator.revalidate();
    }, 2000);
    return () => clearInterval(id);
  }, [anyRunning, stalled, revalidator]);

  return (
    <Page
      title="AI Visibility"
      subtitle="Make this catalogue readable by ChatGPT, Claude, Gemini and Perplexity"
    >
      <BlockStack gap="500">
        {stalled ? (
          <Banner tone="warning" title="This job has not moved in three minutes">
            <Text as="p">
              The background worker may be down. Nothing is lost - the job
              stays queued and runs as soon as the worker is back. Refresh to
              check again.
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
                      ? "Starting up…"
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
                  Asking each crawler…
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
                  <Form method="post">
                    <input type="hidden" name="mode" value="alt" />
                    <Button submit loading={busy} disabled={anyRunning}>
                      Write missing alt text
                    </Button>
                  </Form>
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
                  <Step done={embed?.active} title="App embed active in your theme">
                    {embed?.active
                      ? `Verified in ${embed.themeName || "your published theme"}. The storefront output is live.`
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
                <InlineStack gap="200">
                  <Link to="/app/dictionary">
                    <Button>Open dictionary</Button>
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
