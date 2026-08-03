import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Badge,
  Banner,
  Divider,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { extractProduct, type Fact } from "../engine";
import { buildAltText, looksLikeFilename } from "../engine/alt-text";
import { NAMESPACE, ENGINE_VERSION, parseState } from "../services/facts.server";

// The editor pattern the WordPress module got right, and the reason human work
// survives: the extracted value is shown as the starting point, the merchant
// edits on top, and a reset puts it back to automatic. Anything the merchant
// touches is marked `human` in state and is then invisible to bulk passes.

const PRODUCT = `#graphql
  query ProductForEditor($id: ID!) {
    product(id: $id) {
      id
      title
      descriptionHtml
      productType
      featuredMedia { preview { image { url altText } } }
      media(first: 20) {
        nodes {
          ... on MediaImage {
            id
            alt
            image { url(transform: { maxWidth: 200, maxHeight: 200 }) }
          }
        }
      }
      metafields(namespace: "${NAMESPACE}", first: 10) { nodes { key value } }
    }
  }
`;

const SET = `#graphql
  mutation SetFacts($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { userErrors { field message } }
  }
`;

const SET_ALT = `#graphql
  mutation SetAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      mediaUserErrors { field message }
    }
  }
`;

function gid(id: string) {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const res = await admin.graphql(PRODUCT, { variables: { id: gid(params.id!) } });
  const json = await res.json();
  const product = json.data?.product;

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const setting = shop
    ? await db.setting.findUnique({
        where: { shopId_key: { shopId: shop.id, key: "dictionary" } },
      })
    : null;

  const metafields = (product?.metafields?.nodes ?? []) as { key: string; value: string }[];
  const stored = metafields.find((m) => m.key === "facts")?.value;
  const state = parseState({ id: product.id, title: product.title, metafields });

  let storedFacts: Fact[] = [];
  try {
    storedFacts = stored ? JSON.parse(stored) : [];
  } catch {
    storedFacts = [];
  }

  const autoFacts = extractProduct(product, setting?.value ?? "");

  // Every image with its current description, where that description came
  // from, and what we would write if it were empty. A merchant should be able
  // to judge our alt text without digging through the Shopify media library.
  const images = (product?.media?.nodes ?? [])
    .filter((m: any) => m?.id)
    .map((m: any, index: number) => {
      const alt = (m.alt ?? "").trim();
      const isFilename = alt !== "" && looksLikeFilename(alt);
      return {
        id: m.id,
        url: m.image?.url ?? "",
        alt,
        // "human" is the safe assumption for anything we did not clearly write.
        source: alt === "" ? "missing" : isFilename ? "filename" : "written",
        suggestion: buildAltText(
          { title: product.title, productType: product.productType },
          autoFacts,
          index,
        ),
      };
    });

  return {
    product: {
      id: product.id,
      title: product.title,
      image: product.featuredMedia?.preview?.image?.url ?? null,
    },
    images,
    storedFacts,
    autoFacts,
    source: state.facts?.source ?? null,
    updatedAt: state.facts?.at ?? null,
  };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = gid(params.id!);

  // Alt text is media, not metafields, so it takes its own path.
  if (intent === "alt") {
    const mediaIds = form.getAll("mediaId").map(String);
    const alts = form.getAll("alt").map(String);
    const media = mediaIds
      .map((mid, i) => ({ id: mid, alt: (alts[i] ?? "").trim() }))
      .filter((m) => m.id);

    if (media.length > 0) {
      const altRes = await admin.graphql(SET_ALT, {
        variables: { productId: id, media },
      });
      const altJson = await altRes.json();
      const errors = altJson.data?.productUpdateMedia?.mediaUserErrors ?? [];
      if (errors.length) return { error: JSON.stringify(errors) };
    }
    return { altSaved: true };
  }

  // Read current state so we only change the facts entry.
  const res = await admin.graphql(PRODUCT, { variables: { id } });
  const json = await res.json();
  const metafields = (json.data?.product?.metafields?.nodes ?? []) as {
    key: string;
    value: string;
  }[];
  const state = parseState({ id, title: "", metafields });

  if (intent === "reset") {
    // Back to automatic: drop the human flag, let the next pass refill it.
    delete state.facts;
    await admin.graphql(SET, {
      variables: {
        metafields: [
          {
            ownerId: id,
            namespace: NAMESPACE,
            key: "state",
            type: "json",
            value: JSON.stringify(state),
          },
        ],
      },
    });
    return { reset: true };
  }

  // Save: whatever is in the boxes becomes the truth, and is protected.
  const labels = form.getAll("label").map(String);
  const values = form.getAll("value").map(String);
  const facts: Fact[] = labels
    .map((k, i) => ({ k: k.trim(), v: (values[i] ?? "").trim() }))
    .filter((f) => f.k !== "" && f.v !== "");

  state.facts = { source: "human", at: new Date().toISOString(), engine: ENGINE_VERSION };

  await admin.graphql(SET, {
    variables: {
      metafields: [
        {
          ownerId: id,
          namespace: NAMESPACE,
          key: "facts",
          type: "json",
          value: JSON.stringify(facts),
        },
        {
          ownerId: id,
          namespace: NAMESPACE,
          key: "state",
          type: "json",
          value: JSON.stringify(state),
        },
      ],
    },
  });

  return { saved: true };
};

export default function ProductEditor() {
  const { product, images, storedFacts, autoFacts, source, updatedAt } =
    useLoaderData<typeof loader>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const initial = storedFacts.length > 0 ? storedFacts : autoFacts;
  const [rows, setRows] = useState<Fact[]>(
    initial.length > 0 ? initial : [{ k: "", v: "" }],
  );
  const [altValues, setAltValues] = useState<string[]>(
    (images ?? []).map((img: any) => img.alt ?? ""),
  );

  function update(i: number, field: "k" | "v", value: string) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  }

  return (
    <Page
      title={product.title}
      backAction={{ url: "/app" }}
      titleMetadata={
        source === "human" ? (
          <Badge tone="attention">Edited by hand</Badge>
        ) : source === "auto" ? (
          <Badge tone="success">Automatic</Badge>
        ) : (
          <Badge>Not written yet</Badge>
        )
      }
    >
      <BlockStack gap="400">
        {source === "human" ? (
          <Banner tone="info">
            These values were written by a person, so bulk passes leave them
            alone. Reset to automatic to let extraction fill them again.
          </Banner>
        ) : null}

        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Comparable attributes
              </Text>
              <Text as="p" tone="subdued">
                {updatedAt
                  ? `Last written ${new Date(updatedAt).toLocaleString()}.`
                  : "Nothing written to this product yet."}
              </Text>

              {rows.map((row, i) => (
                <InlineStack key={i} gap="200" align="start" blockAlign="end">
                  <div style={{ minWidth: 200 }}>
                    <TextField
                      label={i === 0 ? "Attribute" : ""}
                      labelHidden={i !== 0}
                      name="label"
                      value={row.k}
                      onChange={(v) => update(i, "k", v)}
                      autoComplete="off"
                      placeholder="Material"
                    />
                  </div>
                  <div style={{ flexGrow: 1, minWidth: 320 }}>
                    <TextField
                      label={i === 0 ? "Value" : ""}
                      labelHidden={i !== 0}
                      name="value"
                      value={row.v}
                      onChange={(v) => update(i, "v", v)}
                      autoComplete="off"
                      placeholder={autoFacts.find((f) => f.k === row.k)?.v ?? "oak, glass"}
                    />
                  </div>
                  <Button
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    accessibilityLabel="Remove attribute"
                  >
                    Remove
                  </Button>
                </InlineStack>
              ))}

              <input type="hidden" name="intent" value="save" />
              <InlineStack gap="200">
                <Button onClick={() => setRows((prev) => [...prev, { k: "", v: "" }])}>
                  Add attribute
                </Button>
                <Button submit variant="primary" loading={busy}>
                  Save
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="alt" />
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Images
                </Text>
                <Text as="p" tone="subdued">
                  Alt text is what a screen reader announces and what a
                  multimodal crawler reads. Short and specific beats a keyword
                  list, and anything a person wrote is left alone.
                </Text>
              </BlockStack>

              {images.length === 0 ? (
                <Text as="p" tone="subdued">
                  This product has no images.
                </Text>
              ) : (
                <BlockStack gap="300">
                  {images.map((img: any, i: number) => (
                    <InlineStack key={img.id} gap="300" blockAlign="start" wrap={false}>
                      <Thumbnail source={img.url} alt={img.alt} size="large" />
                      <div style={{ flexGrow: 1, minWidth: 260 }}>
                        <BlockStack gap="150">
                          <InlineStack gap="200" blockAlign="center">
                            {img.source === "missing" ? (
                              <Badge tone="critical">No description</Badge>
                            ) : img.source === "filename" ? (
                              <Badge tone="warning">Camera filename</Badge>
                            ) : (
                              <Badge tone="success">Described</Badge>
                            )}
                            <Text as="span" variant="bodySm" tone="subdued">
                              {(altValues[i] ?? "").length}/125
                            </Text>
                          </InlineStack>
                          <input type="hidden" name="mediaId" value={img.id} />
                          <TextField
                            label={`Alt text for image ${i + 1}`}
                            labelHidden
                            name="alt"
                            value={altValues[i] ?? ""}
                            onChange={(v) =>
                              setAltValues((prev) =>
                                prev.map((a, j) => (j === i ? v : a)),
                              )
                            }
                            autoComplete="off"
                            maxLength={125}
                            placeholder={img.suggestion}
                            multiline={2}
                          />
                          {img.source !== "written" && img.suggestion ? (
                            <InlineStack gap="200" blockAlign="center" wrap>
                              <Text as="span" variant="bodySm" tone="subdued">
                                We would write: “{img.suggestion}”
                              </Text>
                              <Button
                                size="micro"
                                onClick={() =>
                                  setAltValues((prev) =>
                                    prev.map((a, j) => (j === i ? img.suggestion : a)),
                                  )
                                }
                              >
                                Use this
                              </Button>
                            </InlineStack>
                          ) : null}
                        </BlockStack>
                      </div>
                    </InlineStack>
                  ))}
                  <InlineStack>
                    <Button submit variant="primary" loading={busy}>
                      Save image descriptions
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}
            </BlockStack>
          </Form>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              For comparison: what the dictionary reads from this description
            </Text>
            <Text as="p" tone="subdued">
              This never changes when you edit above — it is the automatic
              reading, kept so you can see what you are overriding.
            </Text>
            {autoFacts.length === 0 ? (
              <Text as="p" tone="subdued">
                The dictionary finds nothing in this description. Either the
                terms are missing from your dictionary, or the description does
                not state them.
              </Text>
            ) : (
              <InlineStack gap="100" wrap>
                {autoFacts.map((f) => (
                  <Badge key={f.k}>{`${f.k}: ${f.v}`}</Badge>
                ))}
              </InlineStack>
            )}
            <Divider />
            <Form method="post">
              <input type="hidden" name="intent" value="reset" />
              <Button submit loading={busy} tone="critical">
                Reset to automatic
              </Button>
            </Form>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
