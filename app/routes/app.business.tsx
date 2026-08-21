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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  businessFor,
  saveBusiness,
  sanitizeSocialProfiles,
  type BusinessRecord,
} from "../services/business.server";
// The platform list is imported from a plain module, not the .server one:
// the component below renders a field per platform, and importing a server
// module outside a loader or action pulls it into the client bundle and
// breaks the build.
import { SOCIAL_PLATFORMS } from "../services/social-profiles";

// The commercial answers a shop gives once (WP 1.6.7 port): delivery,
// returns, warranty, payment. Published as shipping and return-policy
// schema, and as buyer questions on every product. A field left empty
// publishes nothing - no placeholders, no guessed policies.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const business = shop ? await businessFor(shop.id) : null;
  return { business };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "").trim();

  const returnDaysRaw = text("returnDays");
  const returnDays = returnDaysRaw === "" ? undefined : Number(returnDaysRaw);
  if (returnDays !== undefined && (!Number.isFinite(returnDays) || returnDays < 0)) {
    return { error: "Return window must be a number of days." };
  }

  const socialProfiles = sanitizeSocialProfiles(
    Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, text(p)])),
  );

  const info: BusinessRecord = {
    deliveryTime: text("deliveryTime") || undefined,
    deliveryCost: text("deliveryCost") || undefined,
    deliveryCostIsFrom: form.get("deliveryCostIsFrom") === "on",
    deliveryVaries: form.get("deliveryVaries") === "on",
    returnDays,
    warranty: text("warranty") || undefined,
    paymentMethods: text("paymentMethods") || undefined,
    socialProfiles:
      Object.keys(socialProfiles).length > 0 ? socialProfiles : undefined,
  };

  await saveBusiness(shop.id, admin.graphql, info);
  return { saved: true };
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
  const { business } = useLoaderData<typeof loader>() as {
    business: BusinessRecord | null;
  };
  const result = useActionData<typeof action>() as
    | { saved?: boolean; error?: string }
    | undefined;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [deliveryTime, setDeliveryTime] = useState(business?.deliveryTime ?? "");
  const [deliveryCost, setDeliveryCost] = useState(business?.deliveryCost ?? "");
  const [deliveryCostIsFrom, setDeliveryCostIsFrom] = useState(
    Boolean(business?.deliveryCostIsFrom),
  );
  const [deliveryVaries, setDeliveryVaries] = useState(Boolean(business?.deliveryVaries));
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
                  placeholder="25 RON, or: free over 500 RON"
                  helpText="Shops with several shipping rates: state the lowest and tick the box below."
                />
                <Checkbox
                  label="This is a starting price"
                  name="deliveryCostIsFrom"
                  checked={deliveryCostIsFrom}
                  onChange={setDeliveryCostIsFrom}
                  helpText={'Published as "From 25 RON" - honest when the real cost depends on size or distance.'}
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
              long does delivery take?"), in the plain text mirror, and as
              shipping and return-policy structured data when the app embed
              runs in Full mode. Store profile URLs publish as sameAs on
              your store's Organization data. A field left empty publishes
              nothing.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
