import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runCrawlerCheck, type AgentResult } from "../services/crawler-check.server";
import { scanThemeForProductLd } from "../services/theme-scan.server";

// What a merchant actually wants to know: can assistants read my store, and if
// not, why. Status codes alone are useless to a non-technical reader, so every
// result carries a plain-language cause.

const FIRST_PRODUCT = `#graphql
  query FirstOnlineProduct {
    products(first: 1, query: "published_status:published") {
      nodes { onlineStoreUrl title }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const recent = shop
    ? await db.crawlerCheck.findMany({
        where: { shopId: shop.id },
        orderBy: { checkedAt: "desc" },
        take: 5,
      })
    : [];
  const themeScan = shop
    ? await db.themeScan.findFirst({
        where: { shopId: shop.id },
        orderBy: { scannedAt: "desc" },
      })
    : null;

  return { recent, themeScan, domain: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  const res = await admin.graphql(FIRST_PRODUCT);
  const json = await res.json();
  const url =
    json.data?.products?.nodes?.[0]?.onlineStoreUrl ?? `https://${session.shop}`;

  const password = await db.setting.findUnique({
    where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
  });

  const crawler = await runCrawlerCheck(shop.id, url);

  let theme = null;
  try {
    theme = await scanThemeForProductLd(url, password?.value);
  } catch {
    theme = null;
  }

  return { crawler, theme };
};

function toneFor(cause: string): "success" | "critical" | "warning" | "info" {
  if (cause === "ok") return "success";
  if (cause === "unreachable" || cause === "unknown") return "warning";
  return "critical";
}

export default function Diagnostics() {
  const { themeScan, domain } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const crawler = result?.crawler;
  const theme = result?.theme ?? (themeScan?.detail as any);

  return (
    <Page
      title="Diagnostics"
      subtitle="Can assistants actually read this store?"
    >
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="p">
              We request a product page from outside Shopify, once for each AI
              crawler, using the exact user agent it uses. This is the only test
              that reflects what an assistant really sees.
            </Text>
            <Form method="post">
              <Button submit variant="primary" loading={busy}>
                Run the check
              </Button>
            </Form>
          </BlockStack>
        </Card>

        {crawler ? (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Crawler access
              </Text>
              <Text as="p" tone="subdued">
                Checked {crawler.targetUrl}
              </Text>

              {crawler.results.map((r: AgentResult) => (
                <BlockStack gap="100" key={r.agent}>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={toneFor(r.cause)}>{r.agent}</Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {r.status ?? "no response"} · {r.ms} ms
                    </Text>
                  </InlineStack>
                  <Text as="p">{r.detail}</Text>
                </BlockStack>
              ))}

              {crawler.robotsDisallows?.length ? (
                <Banner tone="warning" title="robots.txt blocks these crawlers">
                  <List>
                    {crawler.robotsDisallows.map((a: string) => (
                      <List.Item key={a}>{a}</List.Item>
                    ))}
                  </List>
                  <Text as="p">
                    robots.txt lives in your theme as robots.txt.liquid. We can
                    generate the rules for you to paste - no app can rewrite that
                    file on your behalf.
                  </Text>
                </Banner>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}

        {theme ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Structured data already on the page
              </Text>
              <Divider />
              {theme.passwordProtected ? (
                <Banner tone="warning">
                  The storefront answered with the password page, so nothing
                  could be read. Development stores always have this on.
                </Banner>
              ) : theme.hasProductLd ? (
                <BlockStack gap="100">
                  <Badge tone="success">
                    {`Theme emits ${theme.nodeCount} Product node${theme.nodeCount === 1 ? "" : "s"}`}
                  </Badge>
                  <Text as="p">
                    Keep the app embed in <b>Extend</b> mode. We will add only
                    what the theme omits, referenced to its node, so assistants
                    read one product rather than two.
                  </Text>
                </BlockStack>
              ) : (
                <BlockStack gap="100">
                  <Badge tone="attention">No Product node found</Badge>
                  <Text as="p">
                    Switch the app embed to <b>Full</b> mode so this store
                    publishes complete product data.
                  </Text>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        ) : null}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Plain text mirror
            </Text>
            <Text as="p">
              Every product with attributes is also served as plain text at{" "}
              <code>https://{domain}/apps/ai-visibility/&lt;handle&gt;</code> - a
              version a crawler can read without executing anything.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
