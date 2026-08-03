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
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { buildAnswerPreview, cleanOutput, extractProduct, type Fact } from "../engine";
import { buildAltText, looksLikeMachineAlt } from "../engine/alt-text";
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
      priceRangeV2 { minVariantPrice { amount currencyCode } }
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
      const isFilename = alt !== "" && looksLikeMachineAlt(alt);
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

  let storedQuestions: { q: string; a: string }[] = [];
  try {
    const rawQ = metafields.find((m) => m.key === "questions")?.value;
    storedQuestions = rawQ ? JSON.parse(rawQ) : [];
  } catch {
    storedQuestions = [];
  }

  // Crawler access is a property of the store, not of one product: the same
  // verdict holds for all 355. Stating it per product without saying so
  // would be fake granularity - the exact dishonesty this app exists to
  // avoid - so the label says "this store", with the date of the check.
  const checks = shop
    ? await db.crawlerCheck.findMany({
        where: { shopId: shop.id },
        orderBy: { checkedAt: "desc" },
        take: 25,
      })
    : [];
  const latest = new Map<string, (typeof checks)[number]>();
  for (const c of checks) if (!latest.has(c.agent)) latest.set(c.agent, c);
  const crawlers = Array.from(latest.values()).map((c) => ({
    agent: c.agent,
    ok: c.cause === "ok",
    checkedAt: c.checkedAt.toISOString(),
  }));

  const answer = buildAnswerPreview({
    title: product.title,
    facts: storedFacts.length > 0 ? storedFacts : autoFacts,
    summary: metafields.find((m) => m.key === "summary")?.value ?? null,
    questions: storedQuestions,
    price: product.priceRangeV2?.minVariantPrice?.amount ?? null,
    currency: product.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
  });

  return {
    answer,
    crawlers,
    product: {
      id: product.id,
      // The page header is ours; imported titles carry entities.
      title: cleanOutput(product.title),
      image: product.featuredMedia?.preview?.image?.url ?? null,
    },
    images,
    storedFacts,
    autoFacts,
    source: state.facts?.source ?? null,
    updatedAt: state.facts?.at ?? null,
    capsule: {
      summary: metafields.find((m) => m.key === "summary")?.value ?? "",
      questions: storedQuestions,
      fitFor: metafields.find((m) => m.key === "fit_for")?.value ?? "",
      summarySource: state.summary?.source ?? null,
      questionsSource: state.questions?.source ?? null,
      fitForSource: state.fit_for?.source ?? null,
    },
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

  if (intent === "capsule") {
    // Whatever is in the boxes becomes the truth for the fields that
    // changed; untouched fields keep their current provenance.
    const summary = String(form.get("summary") ?? "").trim();
    const fitFor = String(form.get("fitFor") ?? "").trim();
    const qs = form.getAll("qq").map(String);
    const as_ = form.getAll("qa").map(String);
    const questions = qs
      .map((q, i) => ({ q: q.trim(), a: (as_[i] ?? "").trim() }))
      .filter((qa) => qa.q !== "" && qa.a !== "");

    const origSummary = String(form.get("origSummary") ?? "");
    const origFitFor = String(form.get("origFitFor") ?? "");
    const origQuestions = String(form.get("origQuestions") ?? "");

    const now = new Date().toISOString();
    const writes: Record<string, unknown>[] = [];
    const push = (key: string, type: string, value: string) => {
      writes.push({ ownerId: id, namespace: NAMESPACE, key, type, value });
    };

    if (summary !== origSummary.trim()) {
      state.summary = { source: "human", at: now, engine: ENGINE_VERSION };
      push("summary", "multi_line_text_field", summary);
    }
    if (fitFor !== origFitFor.trim()) {
      state.fit_for = { source: "human", at: now, engine: ENGINE_VERSION };
      push("fit_for", "single_line_text_field", fitFor);
    }
    const questionsJson = JSON.stringify(questions);
    if (questionsJson !== origQuestions) {
      state.questions = { source: "human", at: now, engine: ENGINE_VERSION };
      push("questions", "json", questionsJson);
    }

    if (writes.length > 0) {
      push("state", "json", JSON.stringify(state));
      const wRes = await admin.graphql(SET, { variables: { metafields: writes } });
      const wJson = await wRes.json();
      const errors = wJson.data?.metafieldsSet?.userErrors ?? [];
      if (errors.length) return { error: JSON.stringify(errors) };
    }
    return { capsuleSaved: true };
  }

  if (intent === "capsule_reset") {
    delete state.summary;
    delete state.questions;
    delete state.fit_for;
    await admin.graphql(SET, {
      variables: {
        metafields: [
          { ownerId: id, namespace: NAMESPACE, key: "state", type: "json", value: JSON.stringify(state) },
        ],
      },
    });
    return { capsuleReset: true };
  }

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
  const { product, images, storedFacts, autoFacts, source, updatedAt, capsule, crawlers, answer } =
    useLoaderData<typeof loader>() as {
      answer: {
        question: string;
        withApp: string;
        withoutApp: string;
        sources: string[];
      } | null;
      crawlers: { agent: string; ok: boolean; checkedAt: string }[];
      product: { id: string; title: string; image: string | null };
      images: {
        id: string;
        url: string;
        alt: string;
        source: string;
        suggestion: string;
      }[];
      storedFacts: Fact[];
      autoFacts: Fact[];
      source: string | null;
      updatedAt: string | null;
      capsule: {
        summary: string;
        questions: { q: string; a: string }[];
        fitFor: string;
        summarySource: string | null;
        questionsSource: string | null;
        fitForSource: string | null;
      };
    };
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const initial = storedFacts.length > 0 ? storedFacts : autoFacts;
  const [rows, setRows] = useState<Fact[]>(
    initial.length > 0 ? initial : [{ k: "", v: "" }],
  );
  const [altValues, setAltValues] = useState<string[]>(
    (images ?? []).map((img: any) => img.alt ?? ""),
  );
  const [summary, setSummary] = useState(capsule.summary);
  const [fitFor, setFitFor] = useState(capsule.fitFor);
  const [qas, setQas] = useState<{ q: string; a: string }[]>(
    capsule.questions.length > 0 ? capsule.questions : [],
  );

  function updateQa(i: number, field: "q" | "a", value: string) {
    setQas((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  }

  function SourceBadge({ src }: { src: string | null }) {
    return src === "human" ? (
      <Badge tone="attention">Edited by you</Badge>
    ) : src === "auto" ? (
      <Badge tone="success">Automatic</Badge>
    ) : (
      <Badge>Not written</Badge>
    );
  }

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
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Readable by assistants
            </Text>
            <InlineStack gap="150" wrap blockAlign="center">
              <Badge tone={storedFacts.length > 0 ? "success" : undefined}>
                {storedFacts.length > 0
                  ? `${storedFacts.length} attributes published`
                  : "No attributes yet"}
              </Badge>
              <Badge tone={capsule.summary ? "success" : undefined}>
                {capsule.summary ? "Summary published" : "No summary"}
              </Badge>
              <Badge tone={capsule.questions.length > 0 ? "success" : undefined}>
                {capsule.questions.length > 0
                  ? `${capsule.questions.length} questions`
                  : "No questions"}
              </Badge>
            </InlineStack>
            {crawlers.length > 0 ? (
              <>
                <Text as="p" tone="subdued" variant="bodySm">
                  {`Crawler access, checked for the whole store on ${new Date(
                    crawlers[0].checkedAt,
                  ).toLocaleDateString()}:`}
                </Text>
                <InlineStack gap="150" wrap>
                  {crawlers.map((c) => (
                    <Badge key={c.agent} tone={c.ok ? "success" : "critical"}>
                      {c.agent}
                    </Badge>
                  ))}
                </InlineStack>
              </>
            ) : (
              <Text as="p" tone="subdued" variant="bodySm">
                Crawler access has not been checked yet. Run it from
                Diagnostics; the verdict covers the whole store.
              </Text>
            )}
          </BlockStack>
        </Card>

        {answer ? (
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  What an assistant can answer about this product
                </Text>
                <Text as="p" tone="subdued">
                  Assembled from what is published right now - not a
                  simulation, and not a prediction of any assistant's wording.
                </Text>
              </BlockStack>

              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">
                    {`"${answer.question}"`}
                  </Text>
                  <InlineStack gap="200" blockAlign="start" wrap={false}>
                    <Badge tone="success">With this app</Badge>
                  </InlineStack>
                  <Text as="p">{answer.withApp}</Text>
                  <InlineStack gap="150" wrap>
                    {answer.sources.map((src) => (
                      <Badge key={src}>{src}</Badge>
                    ))}
                  </InlineStack>
                </BlockStack>
              </Box>

              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="200">
                  <InlineStack gap="200">
                    <Badge>Without it</Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {answer.withoutApp}
                  </Text>
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>
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
          <Form method="post">
            <input type="hidden" name="intent" value="capsule" />
            <input type="hidden" name="origSummary" value={capsule.summary} />
            <input type="hidden" name="origFitFor" value={capsule.fitFor} />
            <input
              type="hidden"
              name="origQuestions"
              value={JSON.stringify(capsule.questions)}
            />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Summary and buyer questions
              </Text>
              <Text as="p" tone="subdued">
                What an assistant quotes about this product. Edit any field and
                it becomes yours: bulk passes will never touch it again.
              </Text>

              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Summary
                </Text>
                <SourceBadge src={capsule.summarySource} />
              </InlineStack>
              <TextField
                label="Summary"
                labelHidden
                name="summary"
                value={summary}
                onChange={setSummary}
                multiline={4}
                autoComplete="off"
              />

              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Buyer questions
                </Text>
                <SourceBadge src={capsule.questionsSource} />
              </InlineStack>
              {qas.map((qa, i) => (
                <InlineStack key={i} gap="200" align="start" blockAlign="end">
                  <div style={{ flexGrow: 1, minWidth: 260 }}>
                    <TextField
                      label={i === 0 ? "Question" : ""}
                      labelHidden={i !== 0}
                      name="qq"
                      value={qa.q}
                      onChange={(v) => updateQa(i, "q", v)}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flexGrow: 1, minWidth: 260 }}>
                    <TextField
                      label={i === 0 ? "Answer" : ""}
                      labelHidden={i !== 0}
                      name="qa"
                      value={qa.a}
                      onChange={(v) => updateQa(i, "a", v)}
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    onClick={() => setQas((prev) => prev.filter((_, j) => j !== i))}
                    accessibilityLabel="Remove question"
                  >
                    Remove
                  </Button>
                </InlineStack>
              ))}

              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Who it suits
                </Text>
                <SourceBadge src={capsule.fitForSource} />
              </InlineStack>
              <TextField
                label="Who it suits"
                labelHidden
                name="fitFor"
                value={fitFor}
                onChange={setFitFor}
                autoComplete="off"
                helpText="Audience, not contents: 'living rooms, small flats' - never '6 chairs'."
              />

              <InlineStack gap="200">
                <Button onClick={() => setQas((prev) => [...prev, { q: "", a: "" }])}>
                  Add question
                </Button>
                <Button submit variant="primary" loading={busy}>
                  Save summary and questions
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              For comparison: what the dictionary reads from this description
            </Text>
            <Text as="p" tone="subdued">
              This never changes when you edit above - it is the automatic
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
