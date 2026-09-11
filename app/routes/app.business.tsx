import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  TextField,
  Checkbox,
  Divider,
  Select,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  businessFor,
  saveBusiness,
  saveShopLocale,
  sanitizeSocialProfiles,
  shopLocaleFor,
  type BusinessRecord,
} from "../services/business.server";
import {
  CONTENT_LANGUAGE_NAMES,
  fetchShopLocale,
  isContentLanguage,
  languageFromLocale,
  resolveContentLanguage,
} from "../services/content-language";
import { liveJobFilter } from "../services/job-stale";
import { enqueue } from "../services/queue.server";
// The platform list is imported from a plain module, not the .server one:
// the component below renders a field per platform, and importing a server
// module outside a loader or action pulls it into the client bundle and
// breaks the build.
import { SOCIAL_PLATFORMS } from "../services/social-profiles";
import { hasPaidAccess } from "../services/billing.server";
// Pure, for the same reason: the delivery line below is computed as the
// merchant types (CC-PROMPT-AI-READABILITY-4 item 2b).
import { deliveryCostLine, parseCountryList } from "../services/delivery-parse";

/** The shop's currency and country: a cost typed with no currency is in the
 * shop's, and no country typed means the shop's own. */
const SHOP_DELIVERY = `#graphql
  query ShopDelivery { shop { currencyCode billingAddress { countryCodeV2 } } }
`;

// The commercial answers a shop gives once (WP 1.6.7 port): delivery,
// returns, warranty, payment. Published as shipping and return-policy
// schema, and as buyer questions on every product. A field left empty
// publishes nothing - no placeholders, no guessed policies.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const business = shop ? await businessFor(shop.id) : null;

  // The store's default language, read on every visit so the preselection
  // below follows a change made in Shopify (content-language.ts). A refused
  // read keeps the last one stored, or none.
  let storeLocale = shop ? await shopLocaleFor(shop.id) : null;
  if (shop) {
    const fresh = await fetchShopLocale(async (query) => (await (await admin.graphql(query)).json()).data);
    if (fresh) {
      await saveShopLocale(shop.id, fresh);
      storeLocale = fresh;
    }
  }

  // A refused read leaves both null: the screen still saves, and the delivery
  // line falls back to the currency of the last save.
  let shopCurrency: string | null = null;
  let shopCountry: string | null = null;
  try {
    const json = await (await admin.graphql(SHOP_DELIVERY)).json();
    shopCurrency = json.data?.shop?.currencyCode ?? null;
    shopCountry = json.data?.shop?.billingAddress?.countryCodeV2 ?? null;
  } catch {
    // Nothing to show that would be true; the fields work without it.
  }
  return { business, storeLocale, shopCurrency, shopCountry };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  // ENTITLEMENT: this action writes to the store (FREE-TIER-SPEC §3). Hiding
  // the screen is not a gate - the form can be posted directly - so the write
  // itself refuses. Nothing already written is touched by the refusal.
  const paid = await hasPaidAccess(session.shop, shop.id, admin.graphql);
  if (!paid) {
    return {
      error:
        "This shop has no active subscription, so business info is not published. Nothing already written is touched.",
    };
  }

  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "").trim();

  const returnDaysRaw = text("returnDays");
  const returnDays = returnDaysRaw === "" ? undefined : Number(returnDaysRaw);
  if (returnDays !== undefined && (!Number.isFinite(returnDays) || returnDays < 0)) {
    return { error: "Return window must be a number of days." };
  }

  // Two-letter codes only. A word that is not one is named back to the
  // merchant rather than guessed into a code or dropped.
  const countryInput = parseCountryList(text("deliveryCountries"));
  if (countryInput.invalid.length > 0) {
    return {
      error:
        "Countries you deliver to: use two-letter country codes such as RO or MD, separated by commas. " +
        `Not a code: ${countryInput.invalid.join(", ")}.`,
    };
  }

  const socialProfiles = sanitizeSocialProfiles(
    Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, text(p)])),
  );

  // Read before the save: the language written until now is the one to
  // compare against.
  const previous = await businessFor(shop.id);

  const language = text("contentLanguage");
  const info: BusinessRecord = {
    contentLanguage: isContentLanguage(language) ? language : undefined,
    deliveryTime: text("deliveryTime") || undefined,
    deliveryCost: text("deliveryCost") || undefined,
    deliveryCostIsFrom: form.get("deliveryCostIsFrom") === "on",
    deliveryVaries: form.get("deliveryVaries") === "on",
    deliveryCountries: countryInput.countries.length > 0 ? countryInput.countries : undefined,
    returnDays,
    warranty: text("warranty") || undefined,
    paymentMethods: text("paymentMethods") || undefined,
    socialProfiles:
      Object.keys(socialProfiles).length > 0 ? socialProfiles : undefined,
  };

  await saveBusiness(shop.id, admin.graphql, info);

  // A new content language rewrites what the app wrote, through the pass
  // that already writes summaries and questions (CC-PROMPT-AI-READABILITY-2
  // item 7): bulk_extract, whose writer skips every value a person wrote or
  // edited (mayWrite) and every value that comes out identical. No new write
  // path. Compared on the language actually written, so confirming the
  // store's own language, preselected on this screen, queues nothing.
  const storeLocale = await shopLocaleFor(shop.id);
  const before = resolveContentLanguage(previous?.contentLanguage, storeLocale).language;
  const after = resolveContentLanguage(info.contentLanguage, storeLocale).language;
  if (before === after) return { saved: true };

  // The same one-at-a-time rule as the dashboard's buttons: a second job
  // would double the Admin calls and muddle both reports. A row a killed
  // worker left "running" does not count (job-stale.ts).
  const active = await db.jobRun.findFirst({
    where: { shopId: shop.id, ...liveJobFilter() },
    select: { kind: true },
  });
  if (active) return { saved: true, rewriteWaiting: true };

  const jobRun = await db.jobRun.create({ data: { shopId: shop.id, kind: "bulk_extract" } });
  await enqueue("bulk_extract", { shopId: shop.id, dryRun: false, jobRunId: jobRun.id });
  return { saved: true, rewriting: true };
};

const SOCIAL_LABELS: Record<(typeof SOCIAL_PLATFORMS)[number], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  pinterest: "Pinterest",
};

export default function Business() {
  const { business, storeLocale, shopCurrency, shopCountry } = useLoaderData<typeof loader>() as {
    business: BusinessRecord | null;
    storeLocale: string | null;
    shopCurrency: string | null;
    shopCountry: string | null;
  };
  // A choice already saved, else the store's default language when this app
  // writes it, else nothing chosen (English is written until one is).
  const storeLanguage = languageFromLocale(storeLocale);
  const [contentLanguage, setContentLanguage] = useState<string>(
    business?.contentLanguage ?? storeLanguage ?? "",
  );
  const result = useActionData<typeof action>() as
    | { saved?: boolean; error?: string; rewriting?: boolean; rewriteWaiting?: boolean }
    | undefined;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [deliveryTime, setDeliveryTime] = useState(business?.deliveryTime ?? "");
  const [deliveryCost, setDeliveryCost] = useState(business?.deliveryCost ?? "");
  const [deliveryCostIsFrom, setDeliveryCostIsFrom] = useState(
    Boolean(business?.deliveryCostIsFrom),
  );
  const [deliveryVaries, setDeliveryVaries] = useState(Boolean(business?.deliveryVaries));
  const [deliveryCountries, setDeliveryCountries] = useState(
    (business?.deliveryCountries ?? []).join(", "),
  );
  // What goes to Google from what is typed, recomputed on every keystroke by
  // the same function the save runs (delivery-parse.ts).
  const costLine = deliveryCostLine(
    deliveryCost,
    deliveryCostIsFrom,
    shopCurrency ?? business?.deliveryCostParsed?.currency ?? "",
  );
  const [returnDays, setReturnDays] = useState(
    business?.returnDays != null ? String(business.returnDays) : "",
  );
  const [warranty, setWarranty] = useState(business?.warranty ?? "");
  const [paymentMethods, setPaymentMethods] = useState(business?.paymentMethods ?? "");
  const [socialProfiles, setSocialProfiles] = useState<Record<string, string>>(
    Object.fromEntries(
      SOCIAL_PLATFORMS.map((p) => [p, business?.socialProfiles?.[p] ?? ""]),
    ),
  );

  return (
    <Page
      title="Business info"
      subtitle="Delivery, returns, warranty and payment - stated once, published everywhere an assistant looks."
    >
      <BlockStack gap="500">
        {result?.saved ? (
          <Banner tone="success">
            <Text as="p">
              Saved. New product passes will include these answers; run Fill
              catalogue to update existing products now.
            </Text>
          </Banner>
        ) : null}
        {result?.rewriting ? (
          <Banner tone="info">
            <Text as="p">
              Summaries and questions are being rewritten in the new language.
              Anything you edited yourself is kept.
            </Text>
          </Banner>
        ) : null}
        {result?.rewriteWaiting ? (
          <Banner tone="warning">
            <Text as="p">
              Another job is running, so the rewrite in the new language has
              not started. Run Fill catalogue on the dashboard when it
              finishes. Anything you edited yourself is kept.
            </Text>
          </Banner>
        ) : null}
        {result?.error ? (
          <Banner tone="critical">
            <Text as="p">{result.error}</Text>
          </Banner>
        ) : null}

        <Form method="post">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Language
                </Text>
                <Select
                  label="Language your product pages are written in"
                  name="contentLanguage"
                  options={[
                    ...(business?.contentLanguage || storeLanguage
                      ? []
                      : [{ label: "Not chosen yet (English is written)", value: "" }]),
                    { label: CONTENT_LANGUAGE_NAMES.en, value: "en" },
                    { label: CONTENT_LANGUAGE_NAMES.ro, value: "ro" },
                  ]}
                  value={contentLanguage}
                  onChange={setContentLanguage}
                  helpText="The summary and buyer questions this app writes use this language."
                />
                {!business?.contentLanguage && storeLanguage ? (
                  <Text as="p" tone="subdued">
                    Preselected from your store's default language. Save to keep it.
                  </Text>
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Delivery
                </Text>
                <TextField
                  label="Delivery time"
                  name="deliveryTime"
                  value={deliveryTime}
                  onChange={setDeliveryTime}
                  autoComplete="off"
                  placeholder="2-4 working days"
                  disabled={deliveryVaries}
                  helpText="Leave the exact wording you would tell a customer on the phone."
                />
                <Checkbox
                  label="Delivery time varies by product"
                  name="deliveryVaries"
                  checked={deliveryVaries}
                  onChange={setDeliveryVaries}
                  helpText="Tick if bulky and small items ship differently. No single time is published."
                />
                <TextField
                  label="Delivery cost"
                  name="deliveryCost"
                  value={deliveryCost}
                  onChange={setDeliveryCost}
                  autoComplete="off"
                  placeholder="Free over 500, or: 25"
                  helpText="Write it with your own currency, exactly as you want it published. Shops with several shipping rates: state the lowest and tick the box below."
                />
                <Checkbox
                  label="This is a starting price"
                  name="deliveryCostIsFrom"
                  checked={deliveryCostIsFrom}
                  onChange={setDeliveryCostIsFrom}
                  helpText='Published with "From" in front of what you typed above - honest when the real cost depends on size or distance.'
                />
                {costLine ? (
                  <Text as="p" tone="subdued">
                    {costLine}
                  </Text>
                ) : null}
                <TextField
                  label="Countries you deliver to"
                  name="deliveryCountries"
                  value={deliveryCountries}
                  onChange={setDeliveryCountries}
                  autoComplete="off"
                  placeholder={shopCountry ?? "RO"}
                  helpText={
                    "Two-letter country codes, separated by commas, for example RO, MD. " +
                    (shopCountry
                      ? `Left empty, your store's country is used: ${shopCountry}.`
                      : "Left empty, your store's country is used.")
                  }
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Returns and warranty
                </Text>
                <TextField
                  label="Return window, in days"
                  name="returnDays"
                  value={returnDays}
                  onChange={setReturnDays}
                  autoComplete="off"
                  placeholder="14"
                  helpText="EU distance selling gives buyers 14 days; state yours if it is longer."
                />
                <TextField
                  label="Warranty"
                  name="warranty"
                  value={warranty}
                  onChange={setWarranty}
                  autoComplete="off"
                  placeholder="24 months"
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Payment
                </Text>
                <TextField
                  label="Payment methods"
                  name="paymentMethods"
                  value={paymentMethods}
                  onChange={setPaymentMethods}
                  autoComplete="off"
                  placeholder="card, bank transfer, cash on delivery"
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Official store profiles
                </Text>
                <Text as="p" tone="subdued">
                  Published as sameAs on your store's structured data, so
                  assistants can confirm this is your real shop. All
                  optional; leave any blank you do not run. Only https links
                  are accepted - anything else is dropped rather than
                  published.
                </Text>
                {SOCIAL_PLATFORMS.map((platform) => (
                  <TextField
                    key={platform}
                    label={SOCIAL_LABELS[platform]}
                    name={platform}
                    value={socialProfiles[platform]}
                    onChange={(value) =>
                      setSocialProfiles((prev) => ({ ...prev, [platform]: value }))
                    }
                    autoComplete="off"
                    placeholder={`https://www.${platform}.com/yourstore`}
                  />
                ))}
              </BlockStack>
            </Card>

            <Divider />
            <InlineStack>
              <Button submit variant="primary" loading={busy}>
                Save
              </Button>
            </InlineStack>
          </BlockStack>
        </Form>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Where these answers appear
            </Text>
            <Text as="p">
              As buyer questions on every product ("Can I return it?", "How
              long does delivery take?") and in the plain text mirror, in
              your own words. The delivery price and free-delivery threshold
              read from what you typed publish as your store's delivery
              policy for Google, on every page. The return window and
              delivery details publish on each product's offer when this app
              publishes the product's description itself. Store profile URLs
              publish as sameAs on your store's Organization data. A field
              left empty publishes nothing.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
