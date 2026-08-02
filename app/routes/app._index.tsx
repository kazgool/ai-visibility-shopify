import { useEffect } from "react";
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

// A dashboard, not a form: a merchant should see the state of their catalogue
// in one glance — how much is covered, what is protected, what is left to do —
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

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const [lastRun, lastAlt, dictionary] = shop
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
      ])
    : [null, null, null];

  return {
    products: json.data?.products?.nodes ?? [],
    totalProducts: json.data?.productsCount?.count ?? 0,
    lastRun,
    lastAlt,
    hasDictionary: Boolean(dictionary?.value?.trim()),
    domain: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const mode = String(form.get("mode") ?? "dry");

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ok: false };

  if (mode === "alt") {
    const jobRun = await db.jobRun.create({
      data: { shopId: shop.id, kind: "alt_text" },
    });
    await enqueue("bulk_alt_text", { shopId: shop.id, jobRunId: jobRun.id });
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
  const { products, totalProducts, lastRun, lastAlt, hasDictionary, domain } =
    useLoaderData<typeof loader>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const running = lastRun?.status === "queued" || lastRun?.status === "running";
  const altRunning = lastAlt?.status === "queued" || lastAlt?.status === "running";
  const anyRunning = running || altRunning;
  const active = running ? lastRun : lastAlt;

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
  const written = lastRun?.kind === "bulk_extract" && lastRun?.status === "done";

  // Keep the numbers moving while a pass runs, or people press the button twice.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => revalidator.revalidate(), 2000);
    return () => clearInterval(id);
  }, [anyRunning, revalidator]);

  return (
    <Page
      title="AI Visibility"
      subtitle="Make this catalogue readable by ChatGPT, Claude, Gemini and Perplexity"
    >
      <BlockStack gap="500">
        {anyRunning ? (
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
                      : `${percent}% — ${progress} of ${total} products. You can close this tab; it keeps running.`}
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
            value={report ? `${coverage}%` : "—"}
            hint={report ? `${covered} produce attributes` : "run a check to find out"}
            tone={report && coverage >= 80 ? "success" : undefined}
          />
          <Metric
            label="Protected"
            value={report ? String(report.wouldSkip) : "—"}
            hint="written by a person, never overwritten"
          />
          <Metric
            label="Alt text"
            value={altReport ? String(altReport.written) : "—"}
            hint={altReport ? `${altReport.keptHuman} left as written` : "not run yet"}
          />
        </InlineGrid>

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
                    Short, specific alt text built from the attributes — never a
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
                  <Step done={Boolean(written)} title="Attributes written">
                    {written
                      ? "Your products carry comparable attributes."
                      : "Run a preview first, then fill the catalogue."}
                  </Step>
                  <Step done={false} title="App embed active in your theme">
                    Turn on “AI Visibility” under App embeds so the data reaches
                    the storefront. Nothing is published until you do.
                  </Step>
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
                      —
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
