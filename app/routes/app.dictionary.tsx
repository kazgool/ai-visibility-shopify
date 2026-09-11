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
  Checkbox,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  DEFAULT_DICTIONARY,
  PRESETS,
  presetText,
  coverage,
  extractProduct,
  collidingTerms,
} from "../engine";
import { hasPaidAccess } from "../services/billing.server";
import {
  cleanMappings,
  dictionaryGroups,
  normaliseHidden,
  parseMappings,
  validateCap,
  validateMappings,
  MAX_FAQ_CAP,
  type MappingError,
  type Mappings,
} from "../services/faq-settings";
import {
  faqSettingsFor,
  saveFaqSettings,
  saveHiddenGroups,
  savePresetId,
} from "../services/faq-settings.server";

// The dictionary is the product. This screen is where a merchant decides what
// "comparable" means for their trade - and, just as importantly, in which
// language. Terms only match the language the descriptions are written in;
// the coverage test below makes that obvious in seconds instead of after a
// disappointing bulk pass.
//
// It also holds what is stored with the dictionary (CC-PROMPT-AI-READABILITY-3
// item 3): the shop's own buyer questions for a description heading or a
// dictionary group, how many questions a product gets, and which groups the
// product page's facts list shows.

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
  const dictionary = setting?.value ?? "";
  const faq = shop ? await faqSettingsFor(shop.id) : null;

  return {
    dictionary,
    presets: Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label })),
    presetId: faq?.presetId ?? null,
    mappings: faq?.mappings ?? { sections: [], groups: [] },
    cap: faq?.cap ?? null,
    hiddenGroups: faq?.hiddenGroups ?? [],
    // The groups of the saved dictionary: a group typed but not saved yet has
    // no values on any product, so it is not offered until it is saved.
    groups: dictionaryGroups(dictionary),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "test");
  const text = String(form.get("dictionary") ?? "");

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  // ENTITLEMENT: the dictionary decides what the app writes to every product
  // (FREE-TIER-SPEC §3), and the test intent reads the catalogue through the
  // Admin API. A hidden button is not a gate, so the action refuses.
  const paid = await hasPaidAccess(session.shop, shop.id, admin.graphql);
  if (!paid) {
    return {
      error:
        "This shop has no active subscription, so the dictionary cannot be saved or tested. Nothing already written is touched.",
    };
  }

  if (intent === "save") {
    await db.setting.upsert({
      where: { shopId_key: { shopId: shop.id, key: "dictionary" } },
      create: { shopId: shop.id, key: "dictionary", value: text },
      update: { value: text },
    });
    // The preset the text started from decides which preset questions apply.
    // Nothing picked this time keeps what was recorded before.
    const preset = String(form.get("preset") ?? "");
    if (preset && PRESETS[preset]) await savePresetId(shop.id, preset);
    return { saved: true };
  }

  if (intent === "save_faq") {
    const mappings = cleanMappings(parseMappings(String(form.get("faq") ?? "")));
    const capRaw = String(form.get("cap") ?? "");
    const faqErrors = validateMappings(mappings);
    const capError = validateCap(capRaw);
    if (faqErrors.length > 0 || capError) return { faqErrors, capError };
    await saveFaqSettings(shop.id, mappings, Number(capRaw.trim()));
    return { faqSaved: true };
  }

  if (intent === "save_display") {
    let hidden: string[] = [];
    try {
      const raw = JSON.parse(String(form.get("hidden") ?? "[]"));
      hidden = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return { error: "The list of groups could not be read. Nothing was changed." };
    }
    await saveHiddenGroups(shop.id, admin.graphql, normaliseHidden(hidden));
    return { displaySaved: true };
  }

  // Test: run the dictionary in the box - saved or not - against a live
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
  const collisions = collidingTerms(dictionary);

  return { report, examples, collisions };
};

function mappingErrorText(e: MappingError): string {
  const list = e.list === "sections" ? "Heading question" : "Group question";
  return e.row === 0 ? `${list}s: ${e.message}` : `${list} ${e.row}: ${e.message}`;
}

export default function DictionaryPage() {
  const loaded = useLoaderData<typeof loader>();
  const { dictionary, presets, groups } = loaded;
  const result = useActionData<typeof action>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [text, setText] = useState(dictionary || DEFAULT_DICTIONARY);
  const [preset, setPreset] = useState("");
  const [mappings, setMappings] = useState<Mappings>(loaded.mappings);
  const [cap, setCap] = useState(String(loaded.cap ?? 8));
  const [hidden, setHidden] = useState<string[]>(loaded.hiddenGroups);

  function loadPreset(value: string) {
    setPreset(value);
    if (value) setText(presetText(value));
  }

  const setSection = (i: number, field: "heading" | "question", value: string) =>
    setMappings((m) => ({ ...m, sections: m.sections.map((s, j) => (j === i ? { ...s, [field]: value } : s)) }));
  const setGroup = (i: number, field: "group" | "question", value: string) =>
    setMappings((m) => ({ ...m, groups: m.groups.map((g, j) => (j === i ? { ...g, [field]: value } : g)) }));

  const groupOptions = [{ label: "Choose a group...", value: "" }, ...groups.map((g) => ({ label: g, value: g }))];

  return (
    <Page title="Dictionary" subtitle="What counts as a comparable attribute in your trade">
      <BlockStack gap="400">
        {result?.saved ? <Banner tone="success">Dictionary saved.</Banner> : null}
        {result?.faqSaved ? <Banner tone="success">Buyer questions saved.</Banner> : null}
        {result?.displaySaved ? <Banner tone="success">Product page facts saved.</Banner> : null}
        {result?.error ? (
          <Banner tone="critical">
            <Text as="p">{result.error}</Text>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Select
              label="Start from a trade preset"
              options={[{ label: "Choose a trade...", value: "" }, ...presets]}
              value={preset}
              onChange={loadPreset}
              helpText="A preset is a starting point. Edit the terms into the language your descriptions are actually written in - a term only matches text in its own language."
            />

            <TextField
              label="Dictionary"
              value={text}
              onChange={setText}
              multiline={14}
              autoComplete="off"
              helpText="One attribute per line: Label: term, term. Use 'term *' to capture what follows, '* term' for a count written before the word, '#size' to read measurements, and '| default: value' for a fallback."
            />

            <InlineStack gap="200">
              <Form method="post">
                <input type="hidden" name="dictionary" value={text} />
                <input type="hidden" name="intent" value="test" />
                <Button submit loading={busy}>
                  Test on 40 products
                </Button>
              </Form>
              <Form method="post">
                <input type="hidden" name="dictionary" value={text} />
                <input type="hidden" name="preset" value={preset} />
                <input type="hidden" name="intent" value="save" />
                <Button submit variant="primary" loading={busy}>
                  Save
                </Button>
              </Form>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Buyer questions
            </Text>
            <Text as="p">
              Questions come from your own descriptions: a heading that is already a
              question, or a heading such as Ingredients, Warnings or How to use, with the
              text under it as the answer. Add your own below. Write {"{title}"} where the
              product's name goes.
            </Text>
            {result?.faqErrors?.length || result?.capError ? (
              <Banner tone="critical" title="Not saved">
                <List>
                  {(result.faqErrors ?? []).map((e: MappingError) => (
                    <List.Item key={`${e.list}-${e.row}-${e.message}`}>{mappingErrorText(e)}</List.Item>
                  ))}
                  {result.capError ? <List.Item>{result.capError}</List.Item> : null}
                </List>
              </Banner>
            ) : null}

            <Text as="h3" variant="headingSm">
              A heading in your descriptions, and the question it answers
            </Text>
            {mappings.sections.map((s, i) => (
              <InlineStack key={`s${i}`} gap="200" blockAlign="end" wrap={false}>
                <TextField
                  label={`Heading ${i + 1}`}
                  value={s.heading}
                  onChange={(v) => setSection(i, "heading", v)}
                  autoComplete="off"
                />
                <TextField
                  label="Question"
                  value={s.question}
                  onChange={(v) => setSection(i, "question", v)}
                  placeholder="How do I assemble {title}?"
                  autoComplete="off"
                />
                <Button onClick={() => setMappings((m) => ({ ...m, sections: m.sections.filter((_, j) => j !== i) }))}>
                  Remove
                </Button>
              </InlineStack>
            ))}
            <InlineStack>
              <Button onClick={() => setMappings((m) => ({ ...m, sections: [...m.sections, { heading: "", question: "" }] }))}>
                Add a heading
              </Button>
            </InlineStack>

            <Text as="h3" variant="headingSm">
              A dictionary group, and the question its value answers
            </Text>
            {mappings.groups.map((g, i) => (
              <InlineStack key={`g${i}`} gap="200" blockAlign="end" wrap={false}>
                <Select
                  label={`Group ${i + 1}`}
                  options={
                    g.group && !groups.includes(g.group)
                      ? [...groupOptions, { label: g.group, value: g.group }]
                      : groupOptions
                  }
                  value={g.group}
                  onChange={(v) => setGroup(i, "group", v)}
                />
                <TextField
                  label="Question"
                  value={g.question}
                  onChange={(v) => setGroup(i, "question", v)}
                  placeholder="What shape is {title}?"
                  autoComplete="off"
                />
                <Button onClick={() => setMappings((m) => ({ ...m, groups: m.groups.filter((_, j) => j !== i) }))}>
                  Remove
                </Button>
              </InlineStack>
            ))}
            <InlineStack>
              <Button onClick={() => setMappings((m) => ({ ...m, groups: [...m.groups, { group: "", question: "" }] }))}>
                Add a group question
              </Button>
            </InlineStack>

            <TextField
              label="Questions per product"
              type="number"
              value={cap}
              onChange={setCap}
              min={1}
              max={MAX_FAQ_CAP}
              autoComplete="off"
              helpText="Warnings are never cut: they always come first and count toward this number."
            />

            <Form method="post">
              <input type="hidden" name="intent" value="save_faq" />
              <input type="hidden" name="faq" value={JSON.stringify(mappings)} />
              <input type="hidden" name="cap" value={cap} />
              <Button submit loading={busy}>
                Save buyer questions
              </Button>
            </Form>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              On the product page
            </Text>
            <Text as="p">
              Each group's value is listed with your product's details on the product
              page. Switch a group off to leave it out of that list. It stays in your
              product data, the plain-text page and llms.txt.
            </Text>
            {groups.map((g) => (
              <Checkbox
                key={g}
                label={`Show ${g} on the product page`}
                checked={!hidden.includes(g)}
                onChange={(on) => setHidden((h) => (on ? h.filter((x) => x !== g) : [...h, g]))}
              />
            ))}
            <Text as="p" tone="subdued">
              These are the groups of your saved dictionary. Save the dictionary first to
              see a new group here.
            </Text>
            <Form method="post">
              <input type="hidden" name="intent" value="save_display" />
              <input type="hidden" name="hidden" value={JSON.stringify(hidden)} />
              <Button submit loading={busy}>
                Save product page facts
              </Button>
            </Form>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              How to write a dictionary
            </Text>
            <Text as="p">
              One attribute group per line, in the form <b>Label: term, term</b>.
              The label is what a buyer sees and what an assistant compares; the
              terms are what we look for in your product descriptions. Write the
              terms in the same language your descriptions are written in - a
              term only matches its own language, and a list nobody can read is
              worse than no list at all.
            </Text>
            <List>
              <List.Item>
                <b>Plain term</b> - <code>Material: oak, tempered glass</code>. Matches
                the whole word only, so "tul" never matches "tulip".
              </List.Item>
              <List.Item>
                <b>term *</b> - <code>Cut: silhouette *</code> captures up to three
                words after the term, so you do not have to list every variation.
                If a verb or a connector follows, nothing is captured: half a
                sentence is worse than a missing attribute.
              </List.Item>
              <List.Item>
                <b>* term</b> - <code>Capacity: * seats</code> reads a number written
                before the word: "6 seats", "4 people".
              </List.Item>
              <List.Item>
                <b>#size</b> - <code>Dimensions: #size</code> reads measurements
                straight out of the prose: "80x200 cm", "l 80, L 130, h 79 cm",
                "4 mm". No terms needed.
              </List.Item>
              <List.Item>
                <b>| default: value</b> - <code>Colour: white, black | default: white</code>{" "}
                fills the attribute when nothing matched, for a fact that is true
                of your whole catalogue.
              </List.Item>
            </List>
            <Text as="p" tone="subdued">
              Up to four values are published per label, longer terms win over
              shorter ones ("Chantilly lace" beats "lace"), and values that
              differ only by diacritics are listed once. Nothing a person wrote
              is ever overwritten.
            </Text>
          </BlockStack>
        </Card>

        {result?.collisions?.length ? (
          <Banner tone="warning" title="Some terms were ignored">
            <BlockStack gap="100">
              <Text as="p">
                These terms are also connectors or verbs, so matching them would
                tag every product. They are skipped - rename them to something
                unambiguous.
              </Text>
              <List>
                {result.collisions.map((c: any) => (
                  <List.Item key={`${c.label}-${c.term}`}>
                    {c.label}: <b>{c.term}</b>
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </Banner>
        ) : null}

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
