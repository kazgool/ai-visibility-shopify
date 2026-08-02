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
  Select,
  TextField,
  Banner,
  List,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  DEFAULT_DICTIONARY,
  PRESETS,
  presetText,
  coverage,
  extractProduct,
} from "../engine";

// The dictionary is the product. This screen is where a merchant decides what
// "comparable" means for their trade — and, just as importantly, in which
// language. Terms only match the language the descriptions are written in;
// the coverage test below makes that obvious in seconds instead of after a
// disappointing bulk pass.

const SAMPLE = `#graphql
  query SampleProducts {
    products(first: 40, sortKey: UPDATED_AT, reverse: true) {
      nodes { id title descriptionHtml }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const setting = shop
    ? await db.setting.findUnique({
        where: { shopId_key: { shopId: shop.id, key: "dictionary" } },
      })
    : null;

  return {
    dictionary: setting?.value ?? "",
    presets: Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "test");
  const text = String(form.get("dictionary") ?? "");

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  if (intent === "save") {
    await db.setting.upsert({
      where: { shopId_key: { shopId: shop.id, key: "dictionary" } },
      create: { shopId: shop.id, key: "dictionary", value: text },
      update: { value: text },
    });
    return { saved: true };
  }

  // Test: run the dictionary in the box — saved or not — against a live
  // sample. The 1.6.4 lesson from WordPress: testing the saved list instead
  // of the edited one looks exactly like broken matching.
  const res = await admin.graphql(SAMPLE);
  const json = await res.json();
  const products = (json.data?.products?.nodes ?? []) as {
    title: string;
    descriptionHtml: string;
  }[];

  const dictionary = text.trim() === "" ? DEFAULT_DICTIONARY : text;
  const report = coverage(products, dictionary);
  const examples = products.slice(0, 3).map((p) => ({
    title: p.title,
    facts: extractProduct(p, dictionary),
  }));

  return { report, examples };
};

export default function DictionaryPage() {
  const { dictionary, presets } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [text, setText] = useState(dictionary || DEFAULT_DICTIONARY);
  const [preset, setPreset] = useState("");

  function loadPreset(value: string) {
    setPreset(value);
    if (value) setText(presetText(value));
  }

  return (
    <Page title="Dictionary" subtitle="What counts as a comparable attribute in your trade">
      <BlockStack gap="400">
        {result?.saved ? <Banner tone="success">Dictionary saved.</Banner> : null}

        <Card>
          <BlockStack gap="300">
            <Select
              label="Start from a trade preset"
              options={[{ label: "Choose a trade…", value: "" }, ...presets]}
              value={preset}
              onChange={loadPreset}
              helpText="A preset is a starting point. Edit the terms into the language your descriptions are actually written in — a term only matches text in its own language."
            />

            <Form method="post">
              <input type="hidden" name="dictionary" value={text} />
              <BlockStack gap="300">
                <TextField
                  label="Dictionary"
                  value={text}
                  onChange={setText}
                  multiline={14}
                  autoComplete="off"
                  helpText="One attribute per line: Label: term, term. Use 'term *' to capture what follows, '* term' for a count written before the word, '#size' to read measurements, and '| default: value' for a fallback."
                />
                <InlineStack gap="200">
                  <Button submit name="intent" value="test" loading={busy}>
                    Test on 40 products
                  </Button>
                  <Button submit name="intent" value="save" variant="primary" loading={busy}>
                    Save
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        {result?.report ? (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Test result
              </Text>
              <Text as="p">
                {result.report.sampled - result.report.none} of {result.report.sampled}{" "}
                sampled products produced attributes.
              </Text>
              <List>
                {result.report.byAttr.map(([label, n]: [string, number]) => (
                  <List.Item key={label}>
                    {label}: {n} products
                  </List.Item>
                ))}
              </List>

              {result.examples?.map((ex: any) => (
                <BlockStack gap="100" key={ex.title}>
                  <Text as="h3" variant="headingSm">
                    {ex.title}
                  </Text>
                  <InlineStack gap="100" wrap>
                    {ex.facts.length === 0 ? (
                      <Text as="span" tone="subdued">
                        No attributes found
                      </Text>
                    ) : (
                      ex.facts.map((f: any) => (
                        <Badge key={f.k}>{`${f.k}: ${f.v}`}</Badge>
                      ))
                    )}
                  </InlineStack>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </Page>
  );
}
