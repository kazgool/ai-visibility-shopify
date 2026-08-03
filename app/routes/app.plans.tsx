import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useEffect, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
  Box,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { redirect } from "@remix-run/node";
import { PLANS, type PlanHandle } from "../services/plans";
import {
  activeSubscription,
  checkMasterKey,
  grantComp,
  isComped,
  planFromName,
  startSubscription,
} from "../services/billing.server";
import { extractProduct } from "../engine";
import { cleanOutput } from "../engine/normalize";

// The merchant has installed and cannot see the product working yet, so this
// screen carries the proof itself: their own product count, and one real
// product from their catalogue with the attributes we would extract from it
// (DESIGN-BRIEF §9). Computed live, not a stock screenshot.

const PROOF = `#graphql
  query PlanProof {
    shop { name plan { displayName partnerDevelopment shopifyPlus } }
    productsCount { count }
    products(first: 1, sortKey: UPDATED_AT, reverse: true) {
      nodes { title descriptionHtml }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const res = await admin.graphql(PROOF);
  const json = await res.json();
  const count = json.data?.productsCount?.count ?? 0;
  const sample = json.data?.products?.nodes?.[0] ?? null;

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const setting = shop
    ? await db.setting.findUnique({
        where: { shopId_key: { shopId: shop.id, key: "dictionary" } },
      })
    : null;

  const subscription = await activeSubscription(admin.graphql);
  const comped = await isComped(session.shop, shop?.id);

  return {
    comped,
    count,
    sample: sample
      ? {
          // Imported catalogues carry HTML entities in titles (&amp; etc).
          title: cleanOutput(sample.title as string),
          facts: extractProduct(sample, setting?.value ?? "").slice(0, 5),
        }
      : null,
    currentPlan: subscription ? planFromName(subscription.name) : null,
    renewsAt: subscription?.currentPeriodEnd ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  // Access code: opens the gate for this shop without a Shopify subscription.
  // Deliberately quiet in the interface; the key itself lives in fly secrets.
  if (form.get("intent") === "code") {
    const shop = await db.shop.findUnique({ where: { domain: session.shop } });
    if (!shop) return { error: "Shop not found" };

    if (!checkMasterKey(String(form.get("code") ?? ""))) {
      return { codeError: "That code is not valid." };
    }
    await grantComp(shop.id, `code:${new Date().toISOString()}`);
    // Same rule as the gate: losing the query string logs the merchant out.
    throw redirect(`/app${new URL(request.url).search}`);
  }

  const plan = String(form.get("plan")) as PlanHandle;
  if (!PLANS[plan]) return { error: "Unknown plan" };

  // Development stores must be charged in test mode or Shopify refuses.
  const shopRes = await admin.graphql(
    `#graphql
      query ShopPlan { shop { plan { partnerDevelopment } } }
    `,
  );
  const shopJson = await shopRes.json();
  const isTest = Boolean(shopJson.data?.shop?.plan?.partnerDevelopment);

  const returnUrl = `https://admin.shopify.com/store/${session.shop.replace(
    ".myshopify.com",
    "",
  )}/apps/${process.env.SHOPIFY_API_KEY}/app/plans`;

  const { confirmationUrl, error } = await startSubscription(
    admin.graphql,
    plan,
    returnUrl,
    isTest,
  );

  // Temporary while debugging the payment flow; visible in the dev terminal.
  console.log("[plans] subscription result", { plan, isTest, confirmationUrl, error });

  if (error || !confirmationUrl) return { error: error ?? "Could not start the plan" };

  // App Bridge cannot render Shopify's confirmation page inside the iframe,
  // so the browser has to leave the app for it.
  return { confirmationUrl };
};

export default function Plans() {
  const { comped, count, sample, currentPlan, renewsAt } = useLoaderData<
    typeof loader
  >() as {
    comped: boolean;
    count: number;
    sample: { title: string; facts: { k: string; v: string }[] } | null;
    currentPlan: PlanHandle | null;
    renewsAt: string | null;
  };
  const result = useActionData<typeof action>() as
    | { codeError?: string; error?: string; confirmationUrl?: string }
    | undefined;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [showCode, setShowCode] = useState(Boolean(result?.codeError));

  // Shopify's confirmation page refuses to render inside the admin iframe, so
  // the whole browser window has to go there. Without this the merchant sees
  // a blank frame and assumes the app is broken.
  useEffect(() => {
    if (result?.confirmationUrl) {
      window.top!.location.href = result.confirmationUrl;
    }
  }, [result?.confirmationUrl]);

  const suggested: PlanHandle = count > 20000 ? "high_volume" : "standard";

  return (
    <Page
      title={currentPlan ? "Your plan" : "Choose a plan"}
      subtitle={
        currentPlan
          ? undefined
          : "One price, billed yearly. Everything the app does is included."
      }
    >
      <BlockStack gap="500">
        {result?.error ? (
          <Banner tone="critical">
            <Text as="p">{result.error}</Text>
          </Banner>
        ) : null}
        {comped ? (
          <Banner tone="success">
            <Text as="p">
              This store has been given access. No subscription is needed and
              nothing will be charged.
            </Text>
          </Banner>
        ) : null}

        {currentPlan ? (
          <Banner tone="success">
            <Text as="p">
              {PLANS[currentPlan].name} is active
              {renewsAt
                ? `, renewing ${new Date(renewsAt).toLocaleDateString()}`
                : ""}
              . Shopify handles billing and renewal; nothing to do here.
            </Text>
          </Banner>
        ) : null}

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          {(Object.keys(PLANS) as PlanHandle[]).map((handle) => {
            const plan = PLANS[handle];
            const isCurrent = currentPlan === handle;
            const fits = handle === suggested;

            return (
              <Card key={handle}>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingLg">
                        {plan.name}
                      </Text>
                      {isCurrent ? <Badge tone="success">Current</Badge> : null}
                      {!isCurrent && fits ? <Badge>Fits your catalogue</Badge> : null}
                    </InlineStack>
                    <Text as="p" variant="heading2xl">
                      ${plan.amount}
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {" "}
                        / year
                      </Text>
                    </Text>
                    <Text as="p" tone="subdued">
                      {plan.blurb}
                    </Text>
                  </BlockStack>

                  <Text as="p">
                    {plan.limit === null
                      ? `You have ${count.toLocaleString()} products. This plan has no limit.`
                      : count <= plan.limit
                        ? `You have ${count.toLocaleString()} products. ${plan.name} covers your catalogue.`
                        : `You have ${count.toLocaleString()} products, above this plan's ${plan.limit.toLocaleString()}.`}
                  </Text>

                  {!isCurrent ? (
                    <Form method="post">
                      <input type="hidden" name="plan" value={handle} />
                      <Button submit variant={fits ? "primary" : undefined} loading={busy}>
                        {currentPlan ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
                      </Button>
                    </Form>
                  ) : null}
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>

        {sample && sample.facts.length > 0 ? (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                What this looks like on your own catalogue
              </Text>
              <Text as="p" tone="subdued">
                Read from your product just now, not a demo.
              </Text>
              <Box
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">
                    {sample.title}
                  </Text>
                  <InlineStack gap="100" wrap>
                    {sample.facts.map((f) => (
                      <Badge key={f.k}>{`${f.k}: ${f.v}`}</Badge>
                    ))}
                  </InlineStack>
                </BlockStack>
              </Box>
              <Text as="p">
                Those attributes get written to your products, published as
                structured data, and served as plain text for crawlers.
              </Text>
            </BlockStack>
          </Card>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              What you are paying for
            </Text>
            <List>
              <List.Item>
                Comparable attributes read from the descriptions you already
                wrote. Nothing invented.
              </List.Item>
              <List.Item>
                Summaries, starter questions, and image descriptions built from
                those attributes.
              </List.Item>
              <List.Item>
                Structured data and a plain text version on your storefront,
                with no JavaScript added to your theme.
              </List.Item>
              <List.Item>
                New and edited products picked up automatically, and crawler
                access re-checked when your theme or apps change. This is
                maintenance, not a one-off clean-up.
              </List.Item>
            </List>
            <Text as="p" fontWeight="semibold">
              If you cancel, your extracted attributes stay in your Shopify
              metafields and keep working, with or without this app.
            </Text>
          </BlockStack>
        </Card>

        {!comped && !currentPlan ? (
          <Box paddingBlockStart="200">
            {showCode ? (
              <Card>
                <Form method="post">
                  <input type="hidden" name="intent" value="code" />
                  <BlockStack gap="300">
                    <TextField
                      label="Access code"
                      name="code"
                      autoComplete="off"
                      error={result?.codeError}
                      helpText="If you were given a code, enter it here."
                    />
                    <InlineStack gap="200">
                      <Button submit variant="primary" loading={busy}>
                        Apply code
                      </Button>
                      <Button onClick={() => setShowCode(false)}>Cancel</Button>
                    </InlineStack>
                  </BlockStack>
                </Form>
              </Card>
            ) : (
              <Button variant="plain" onClick={() => setShowCode(true)}>
                Have an access code?
              </Button>
            )}
          </Box>
        ) : null}
      </BlockStack>
    </Page>
  );
}
