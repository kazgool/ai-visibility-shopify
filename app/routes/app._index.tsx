import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useEffect } from "react";
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
  Banner,
  List,
  ProgressBar,
  Spinner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueue } from "../services/queue.server";

// Phase 2 trigger surface. Deliberately minimal — the real admin experience
// (dictionary editor, presets, progress view) is Phase 4. This exists so the
// engine can be exercised against a real catalogue end to end.

const PRODUCTS = `#graphql
  query FirstProducts {
    products(first: 50) {
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
  const lastRun = shop
    ? await db.jobRun.findFirst({
        where: { shopId: shop.id, kind: { in: ["dry_run", "bulk_extract"] } },
        orderBy: { startedAt: "desc" },
      })
    : null;

  return {
    products: json.data?.products?.nodes ?? [],
    lastRun,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const dryRun = form.get("mode") !== "write";

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ok: false };

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

export default function Index() {
  const { products, lastRun } = useLoaderData<typeof loader>() as {
    products: ProductRow[];
    lastRun: any;
  };
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const report = lastRun?.report as
    | { sampled: number; none: number; wouldSkip: number; byAttr: [string, number][] }
    | undefined;

  const running = lastRun?.status === "queued" || lastRun?.status === "running";
  const total = lastRun?.total ?? 0;
  const progress = lastRun?.progress ?? 0;
  const percent = total > 0 ? Math.round((progress / total) * 100) : 0;

  // A pass on a large catalogue takes minutes on the worker. Without visible
  // movement people conclude nothing is happening and press the button again.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => revalidator.revalidate(), 2000);
    return () => clearInterval(id);
  }, [running, revalidator]);

  return (
    <Page title="AI Visibility">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Extraction
            </Text>
            <Text as="p" tone="subdued">
              Reads your product descriptions and pulls out comparable attributes.
              A dry run writes nothing and shows what would change.
            </Text>
            <InlineStack gap="200">
              <Form method="post">
                <input type="hidden" name="mode" value="dry" />
                <Button submit loading={busy}>
                  Run dry run
                </Button>
              </Form>
              <Form method="post">
                <input type="hidden" name="mode" value="write" />
                <Button submit variant="primary" loading={busy}>
                  Fill catalogue
                </Button>
              </Form>
            </InlineStack>

            {running ? (
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="p" variant="bodyMd">
                    {total === 0
                      ? "Starting — reading your catalogue…"
                      : `${percent}% — ${progress} of ${total} products`}
                  </Text>
                </InlineStack>
                {total > 0 ? (
                  <ProgressBar progress={percent} size="small" tone="primary" />
                ) : null}
                <Text as="p" tone="subdued" variant="bodySm">
                  This runs on our servers. You can close this tab and come back.
                </Text>
              </BlockStack>
            ) : null}

            {lastRun && !running ? (
              <Banner tone={lastRun.status === "failed" ? "critical" : "info"}>
                <BlockStack gap="100">
                  <Text as="p">
                    Last {lastRun.kind === "dry_run" ? "dry run" : "pass"}:{" "}
                    {lastRun.status} ({lastRun.progress}/{lastRun.total})
                  </Text>
                  {report ? (
                    <List>
                      <List.Item>{report.sampled} products read</List.Item>
                      <List.Item>{report.none} produced no attributes</List.Item>
                      <List.Item>
                        {report.wouldSkip} protected (a person wrote those values)
                      </List.Item>
                      {report.byAttr?.slice(0, 5).map(([label, n]) => (
                        <List.Item key={label}>
                          {label}: {n} products
                        </List.Item>
                      ))}
                    </List>
                  ) : null}
                </BlockStack>
              </Banner>
            ) : null}
          </BlockStack>
        </Card>

        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "product", plural: "products" }}
            itemCount={products.length}
            selectable={false}
            headings={[{ title: "" }, { title: "Title" }, { title: "Attributes" }, { title: "Status" }]}
          >
            {products.map((p, i) => (
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
