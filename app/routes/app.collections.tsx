import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  Box,
  Divider,
  ProgressBar,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueue } from "../services/queue.server";
import { hasPaidAccess } from "../services/billing.server";

// The listing-page half of the product (PRD §4.8). A collection page is where
// a buyer - or an assistant - asks "what kinds are there and which suits me",
// and a grid of thumbnails answers neither. This screen shows what we would
// publish for each collection, and says plainly when a collection has nothing
// worth comparing.

const COLLECTIONS = `#graphql
  query CollectionsOverview {
    collections(first: 30, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        productsCount { count }
        metafields(namespace: "$app", first: 10) { nodes { key value } }
      }
    }
  }
`;

type Row = {
  id: string;
  title: string;
  handle: string;
  products: number;
  columns: string[];
  rows: number;
  summary: string;
  written: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const res = await admin.graphql(COLLECTIONS);
  const json = await res.json();

  const nodes = json.data?.collections?.nodes ?? [];
  const rows: Row[] = nodes.map((c: any) => {
    const mf = new Map<string, string>(
      (c.metafields?.nodes ?? []).map((m: any) => [m.key, m.value]),
    );
    let columns: string[] = [];
    let tableRows = 0;
    try {
      const table = JSON.parse(mf.get("table") ?? "{}");
      columns = Array.isArray(table.columns) ? table.columns : [];
      tableRows = Array.isArray(table.rows) ? table.rows.length : 0;
    } catch {
      // A malformed value is treated as absent, never as a crash.
    }
    return {
      id: c.id,
      title: c.title,
      handle: c.handle,
      products: c.productsCount?.count ?? 0,
      columns,
      rows: tableRows,
      summary: mf.get("summary") ?? "",
      written: Boolean(mf.get("summary")),
    };
  });

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const job = shop
    ? await db.jobRun.findFirst({
        where: { shopId: shop.id, kind: "collections" },
        orderBy: { startedAt: "desc" },
      })
    : null;

  return { rows, job };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ok: false };

  // ENTITLEMENT: collections are a paid feature (FREE-TIER-SPEC §3). The nav
  // link and any upsell copy only hide the button; a form can still be
  // posted directly, so the action itself must refuse. Nothing already
  // written is touched by this refusal.
  const paid = await hasPaidAccess(session.shop, shop.id, admin.graphql);
  if (!paid) {
    return {
      ok: false,
      error:
        "This shop has no active subscription, so building collection pages is not available. Nothing already written is touched.",
    };
  }

  const active = await db.jobRun.findFirst({
    where: { shopId: shop.id, status: { in: ["queued", "running"] } },
  });
  if (active) return { ok: false, alreadyRunning: true };

  const jobRun = await db.jobRun.create({
    data: { shopId: shop.id, kind: "collections" },
  });
  await enqueue("bulk_collections", { shopId: shop.id, jobRunId: jobRun.id });
  return { ok: true };
};

export default function Collections() {
  const { rows, job } = useLoaderData<typeof loader>() as {
    rows: Row[];
    job: any;
  };
  const actionData = useActionData<typeof action>() as
    | { ok: boolean; error?: string; alreadyRunning?: boolean }
    | undefined;
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const busy = nav.state !== "idle";
  const running = job && (job.status === "queued" || job.status === "running");

  // Progress lives in the database, so a refresh loses nothing; the page just
  // asks again while work is in flight.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => revalidator.revalidate(), 2000);
    return () => clearInterval(t);
  }, [running, revalidator]);

  const withTable = rows.filter((r) => r.columns.length > 0).length;
  const done = rows.filter((r) => r.written).length;

  return (
    <Page
      title="Collections"
      subtitle="What your listing pages tell an assistant about the range they show."
      primaryAction={{
        content: running ? "Working..." : "Build collection pages",
        loading: busy || running,
        disabled: busy || running,
        onAction: () => {
          const form = document.getElementById("build-collections") as HTMLFormElement;
          form?.requestSubmit();
        },
      }}
    >
      <Form method="post" id="build-collections" style={{ display: "none" }} />
      <BlockStack gap="500">
        {actionData?.error ? <Banner tone="critical">{actionData.error}</Banner> : null}

        {actionData?.alreadyRunning ? (
          <Banner tone="warning" title="A job is already running">
            <Text as="p">
              Nothing new was started - one pass runs at a time. The running
              job's progress is saved on our servers and shows here as it
              moves.
            </Text>
          </Banner>
        ) : null}

        {job?.status === "refused" ? (
          <Banner tone="critical" title="The last build was refused">
            <Text as="p">
              {(job.report as any)?.reason ??
                "This shop has no active subscription, so building collection pages is not available."}{" "}
              Nothing already written was touched.
            </Text>
          </Banner>
        ) : null}

        {running ? (
          <Card>
            <BlockStack gap="300">
              <Text as="p">
                Reading {job.total || "your"} collections and writing what can be
                compared. You can close this tab; the work continues.
              </Text>
              <ProgressBar
                progress={job.total ? Math.round((job.progress / job.total) * 100) : 0}
                size="small"
              />
            </BlockStack>
          </Card>
        ) : null}

        {!running && done === 0 ? (
          <Banner tone="info">
            <Text as="p">
              Nothing published yet. Fill your catalogue first, then build the
              collection pages: the comparison table is assembled from the
              attributes already written on your products.
            </Text>
          </Banner>
        ) : null}

        {done > 0 ? (
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="600" wrap>
                <Metric label="Collections" value={String(rows.length)} />
                <Metric label="Described" value={String(done)} />
                <Metric label="With a comparison table" value={String(withTable)} />
              </InlineStack>
              {job?.status === "done" && job.finishedAt ? (
                <Text as="p" tone="subdued" variant="bodySm">
                  {`Last built ${new Date(job.finishedAt).toLocaleString()}: ${
                    job.report?.collections ?? "?"
                  } collections read, ${job.report?.withTable ?? 0} with a comparison table.`}
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}

        {rows.map((row) => (
          <Card key={row.id}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {row.title}
                  </Text>
                  {row.columns.length > 0 ? (
                    <Badge tone="success">Comparison table</Badge>
                  ) : row.written ? (
                    <Badge>Described</Badge>
                  ) : (
                    <Badge tone="attention">Not built</Badge>
                  )}
                </InlineStack>
                <Text as="span" tone="subdued">
                  {row.products === 1 ? "1 product" : `${row.products} products`}
                </Text>
              </InlineStack>

              {row.summary ? (
                <Text as="p" tone="subdued">
                  {row.summary}
                </Text>
              ) : null}

              {row.columns.length > 0 ? (
                <>
                  <Divider />
                  <InlineStack gap="200" wrap>
                    <Text as="span" tone="subdued">
                      Compared on:
                    </Text>
                    {row.columns.map((c) => (
                      <Badge key={c}>{c}</Badge>
                    ))}
                    <Text as="span" tone="subdued">
                      {row.rows === 1 ? "1 row" : `${row.rows} rows`}
                    </Text>
                  </InlineStack>
                </>
              ) : row.written ? (
                <Text as="p" tone="subdued">
                  Nothing varies enough here to compare. A column where every
                  product says the same thing helps nobody choose, so we left it
                  out rather than fill the page.
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        ))}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Showing the table on your storefront
            </Text>
            <Text as="p">
              The structured data is published automatically. To show the table
              itself, open your theme editor on a collection page, add the
              "AI Visibility comparison" block where you want it, and save. It
              ships no JavaScript.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <BlockStack gap="050">
        <Text as="p" tone="subdued" variant="bodySm">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
      </BlockStack>
    </Box>
  );
}
