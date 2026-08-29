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
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runCrawlerCheck, type AgentResult } from "../services/crawler-check.server";
import { CRAWLER_INFO } from "../services/crawler-info";
import { scanThemeForProductLd, recordThemeScan } from "../services/theme-scan.server";
import {
  preferredSourceEligibilityFor,
  recordPreferredSourceEligibility,
  type PreferredSourceStatus,
} from "../services/preferred-source.server";

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

const MAIN_THEME_ID = `#graphql
  query MainThemeId {
    themes(first: 1, roles: [MAIN]) {
      nodes { id }
    }
  }
`;

// The eligibility link has to carry the same domain the storefront block puts
// in its href, which is the primary domain, not the *.myshopify.com one that
// session.shop always holds. Checking the wrong domain at Google's tool
// answers a question nobody asked.
const PRIMARY_DOMAIN = `#graphql
  query PrimaryDomain {
    shop { primaryDomain { host } }
  }
`;

async function primaryDomainFor(
  graphql: (query: string) => Promise<Response>,
  fallback: string,
): Promise<string> {
  try {
    const response = await graphql(PRIMARY_DOMAIN);
    const body = await response.json();
    return body?.data?.shop?.primaryDomain?.host || fallback;
  } catch {
    return fallback;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
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
  const preferredSource = shop ? await preferredSourceEligibilityFor(shop.id) : null;
  const domain = await primaryDomainFor(admin.graphql, session.shop);

  return { recent, themeScan, domain, preferredSource };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "record_preferred_source") {
    const status = formData.get("status");
    if (status !== "listed" && status !== "not_listed") {
      return { error: "Invalid status" };
    }
    const preferredSource = await recordPreferredSourceEligibility(
      shop.id,
      status as PreferredSourceStatus,
    );
    return { preferredSource };
  }

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
    // Persist and mirror to the shop metafield here too, not only on the
    // themes/publish webhook: a merchant who fills in profile URLs without
    // ever republishing a theme should not wait indefinitely for the
    // Organization detection to reach the storefront block.
    const themeRes = await admin.graphql(MAIN_THEME_ID);
    const themeJson = await themeRes.json();
    const themeId = themeJson.data?.themes?.nodes?.[0]?.id;
    if (themeId) {
      await recordThemeScan(shop.id, String(themeId), theme, admin.graphql);
    }
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

function formatRecordedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function Diagnostics() {
  const { themeScan, domain, preferredSource } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const crawler = result?.crawler;
  const theme = result?.theme ?? (themeScan?.detail as any);
  const preferredSourceRecord = result?.preferredSource ?? preferredSource;
  const preferredSourceUrl = `https://www.google.com/preferences/source?q=${domain}`;

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

              {crawler.results.map((r: AgentResult) => {
                const info = CRAWLER_INFO[r.agent];
                return (
                  <BlockStack gap="100" key={r.agent}>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={toneFor(r.cause)}>{r.agent}</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {r.status ?? "no response"} · {r.ms} ms
                      </Text>
                    </InlineStack>
                    {info ? (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {info.company} - {info.purpose}
                      </Text>
                    ) : null}
                    <Text as="p">{r.detail}</Text>
                  </BlockStack>
                );
              })}

              <Text as="p" variant="bodySm" tone="subdued">
                Google-Extended and Applebot-Extended are not crawlers, so you
                will not see them here. They are robots.txt-only tokens that
                tell Google and Apple what their real crawlers - Googlebot and
                Applebot, already checked above - are allowed to do with pages
                already fetched. No request ever arrives carrying either name.
                If your logs show one, it is something else, usually a
                scanner borrowing the name.
              </Text>

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

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Preferred source
            </Text>
            <Text as="p">
              Google's source preferences tool lets a shopper mark a site as a
              preferred source in Search, AI Mode and AI Overviews. Only
              domain-level and subdomain-level sites are eligible - appearing
              there is a precondition, not something this app can check for
              you. There is no API for this check, so it cannot be automated;
              enter your storefront domain at{" "}
              <a href={preferredSourceUrl} target="_blank" rel="noopener noreferrer">
                google.com/preferences/source
              </a>{" "}
              to see whether it appears, then record what you saw below.
            </Text>

            {preferredSourceRecord ? (
              <Text as="p">
                Recorded on {formatRecordedDate(preferredSourceRecord.recordedAt)}:
                the domain{" "}
                {preferredSourceRecord.status === "listed"
                  ? "appears in Google's source preferences tool."
                  : "does not appear yet in Google's source preferences tool."}
              </Text>
            ) : (
              <Text as="p" tone="subdued">
                Nothing recorded yet. This cannot be checked automatically -
                there is no API for it - so record what you see at the link
                above.
              </Text>
            )}

            <InlineStack gap="200">
              <Form method="post">
                <input type="hidden" name="intent" value="record_preferred_source" />
                <input type="hidden" name="status" value="listed" />
                <Button submit loading={busy}>
                  It appears
                </Button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="record_preferred_source" />
                <input type="hidden" name="status" value="not_listed" />
                <Button submit loading={busy}>
                  It does not appear
                </Button>
              </Form>
            </InlineStack>

            <Divider />

            <Text as="p">
              Start with yourself: tap the link below once, signed in with
              your own Google account, so you see the confirmation screen
              your customers will see, then look for the preferred badge in
              your own AI Mode results.
            </Text>

            <TextField
              label="Deeplink"
              value={preferredSourceUrl}
              readOnly
              autoComplete="off"
              onChange={() => {}}
              helpText="Send this anywhere - WhatsApp, email, a newsletter. Each person who taps it and confirms sees this store favoured in their own Search, AI Mode and AI Overviews results, and may click through from there. It only affects that one person's results."
            />

            <TextField
              label="Prewritten message"
              value={`If you shop with us and use Google, you can tell it to show our store first when you ask about products like ours. It takes one tap: ${preferredSourceUrl}`}
              readOnly
              autoComplete="off"
              multiline={3}
              onChange={() => {}}
            />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
