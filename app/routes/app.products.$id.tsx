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
  TextField,
  Badge,
  Banner,
  Divider,
  Thumbnail,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  buildAnswerPreview,
  checkCitationReadiness,
  cleanOutput,
  extractProduct,
  buildMetaTitle,
  buildMetaDescription,
  type CitationCheck,
  type Fact,
} from "../engine";
import { buildAltText, looksLikeMachineAlt } from "../engine/alt-text";
import { NAMESPACE, ENGINE_VERSION, parseState } from "../services/facts.server";
import { isSeoUnlocked, hasPaidAccess, isFreeProduct } from "../services/billing.server";
import { describeFinding, findingsForProduct } from "../services/seo-aggregate";
import { scanRowFor } from "../services/seo-aggregate.server";
import { pageBudget, scanOneProductPage } from "../services/seo-page.server";
import {
  writeSeo,
  revertSeo,
  mayWriteSeo,
  classifyMetaField,
  clearSeoHumanFlag,
  type SeoKey,
} from "../services/seo.server";

// The editor pattern the WordPress module got right, and the reason human work
// survives: the extracted value is shown as the starting point, the merchant
// edits on top, and a reset puts it back to automatic. Anything the merchant
// touches is marked `human` in state and is then invisible to bulk passes.

const PRODUCT = `#graphql
  query ProductForEditor($id: ID!) {
    shop { name }
    product(id: $id) {
      id
      title
      handle
      descriptionHtml
      productType
      vendor
      seo { title description }
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

const PRIMARY_DOMAIN_FOR_SCAN = `#graphql
  query PrimaryDomainForProductScan {
    shop { url }
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
  const shopName = json.data?.shop?.name ?? null;

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  // Entitlement (ENTITLEMENT rule): the card is gated here, not only on
  // display - the action below checks it again for the "seo" intents, since
  // a form can be posted directly regardless of what the loader rendered.
  const seoUnlocked = await isSeoUnlocked(shop?.id);
  const mirror = shop
    ? await db.mirrorCache.findUnique({
        where: { shopId_handle: { shopId: shop.id, handle: product.handle } },
      })
    : null;
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

  // Does the title (and, as a fallback, the summary opening) actually share
  // wording with the questions buyers would ask? Computed fresh on every
  // load: it reads and reports, it writes nothing.
  const summaryText = metafields.find((m) => m.key === "summary")?.value ?? "";
  const summaryOpening = summaryText.split(/(?<=[.!?])\s/)[0] ?? summaryText;
  const citation = checkCitationReadiness({
    title: cleanOutput(product.title),
    summaryOpening: cleanOutput(summaryOpening),
    questions: storedQuestions,
    handle: product.handle,
  });

  // Search listing card (SEO-WORKSPACE-PRD §3.4). Gated on seoUnlocked; the
  // suggestions are computed either way so the action can reuse them without
  // a second round trip, but the UI below only renders when unlocked.
  const seoProductLike = { id: product.id, metafields, seo: product.seo ?? null };
  const facts = storedFacts.length > 0 ? storedFacts : autoFacts;
  const metaInput = {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    facts,
    vendor: product.vendor ?? null,
    shopName,
  };
  const titleSuggestion = buildMetaTitle(metaInput);
  const descriptionSuggestion = buildMetaDescription(metaInput);
  const currentSeoTitle = product.seo?.title ?? "";
  const currentSeoDescription = product.seo?.description ?? "";

  // Badge and writability (finding: the source badge can lie). Both now go
  // through classifyMetaField/mayWriteSeo's live-value check rather than a
  // local reimplementation that trusted the state entry over the field
  // Shopify actually holds today. A field this app (or the merchant, inside
  // this app) once marked "human" but that is now empty - cleared by
  // Shopify's native search-listing editor, an import, anything outside
  // this app - reads as "missing" here, not as a stale "Edited by you" over
  // a blank box, and stays reachable by Generate: `|| current === ""` widens
  // canWrite beyond mayWriteSeo's stricter bulk-pass rule specifically for
  // this per-product screen, where the merchant is looking straight at the
  // empty field and choosing to fill it themselves. The action below applies
  // the matching write-time change so Save actually succeeds, not just the
  // button.
  const seo = {
    unlocked: seoUnlocked,
    title: currentSeoTitle,
    description: currentSeoDescription,
    titleSuggestion,
    descriptionSuggestion,
    titleSource: classifyMetaField(seoProductLike, "seo_title"),
    descriptionSource: classifyMetaField(seoProductLike, "seo_description"),
    titleCanRevert: Boolean((state.seo_title as any)?.prev !== undefined),
    descriptionCanRevert: Boolean((state.seo_description as any)?.prev !== undefined),
    titleCanWrite: mayWriteSeo(seoProductLike, "seo_title") || currentSeoTitle === "",
    descriptionCanWrite:
      mayWriteSeo(seoProductLike, "seo_description") || currentSeoDescription === "",
  };

  // Per-product SEO scan (PRD-SEO-PER-PRODUCT build step 5). Read straight
  // off the row, never from anything the last action returned: after the
  // button, the loader runs again and this is what the second render shows.
  // ENTITLEMENT: behind the SEO key, the same key the SEO screen is behind.
  // Not behind a subscription - decision 2 of section 7 is that the button
  // exists wherever the key is present, including on the three products a
  // free-tier shop chose, because the key is what is paid for.
  let crawlerPage = null;
  if (shop && seoUnlocked) {
    const [row, budget] = await Promise.all([
      scanRowFor(shop.id, product.id),
      pageBudget(shop.id),
    ]);
    crawlerPage = {
      hasRow: row !== null,
      scannedAt: row?.scannedAt ? new Date(row.scannedAt).toISOString() : null,
      status: row?.status ?? null,
      canonical: (row as any)?.canonical ?? null,
      noindex: (row as any)?.noindex ?? null,
      appBlock: (row as any)?.appBlock ?? null,
      cacheControl: (row as any)?.cacheControl ?? null,
      findings: findingsForProduct(row).map((f) => ({
        code: String(f.code),
        source: f.source,
        text: describeFinding(f),
      })),
      budget: { budget: budget.budget, spent: budget.spent, remaining: budget.remaining },
    };
  }

  return {
    answer,
    citation,
    crawlers,
    crawlerPage,
    product: {
      id: product.id,
      // The page header is ours; imported titles carry entities.
      title: cleanOutput(product.title),
      handle: product.handle,
      image: product.featuredMedia?.preview?.image?.url ?? null,
    },
    mirrorUrl: mirror ? `https://${session.shop}/apps/ai-visibility/${product.handle}` : null,
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
    seo,
  };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = gid(params.id!);

  // GraphqlFn wrapper for the seo.server.ts writer, which shares its shape
  // with the worker's admin client (admin.server.ts) rather than the raw
  // Remix admin.graphql Response.
  const graphql = async (query: string, variables: Record<string, unknown> = {}) => {
    const r = await admin.graphql(query, { variables });
    const j: any = await r.json();
    if (j.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(j.errors)}`);
    return j.data;
  };

  // Entitlement (ENTITLEMENT rule): the card being hidden in the loader does
  // not stop a form being posted directly, so every seo intent is checked
  // again here. Two entitlements, both required (Marius's ruling, 31 Aug
  // 2026): seo_unlocked opens the capability, but a shop with no active
  // subscription (and no comp) may still not write here - the same rule
  // app.seo.tsx enforces for the bulk pass. admin.graphql is already at
  // hand on this route, so this is the hasPaidAccess form. The SEO module is
  // a separate paid add-on and is never covered by the free-tier's three
  // products - FREE-TIER-SPEC §3 lists it under "not free" alongside every
  // other volume/continuity feature.
  // "Read this page now" (PRD section 4). Its own gate, and only one: the SEO
  // key. Decision 2 of section 7 puts the button wherever the key is,
  // including on the three products a free-tier shop chose, so neither the
  // paid gate below nor the free-product gate applies to it. It writes
  // nothing to Shopify - it fetches one public page and updates our own row -
  // so there is nothing here for a subscription to be protecting.
  if (intent === "seo_scan_page") {
    const shop = await db.shop.findUnique({ where: { domain: session.shop } });
    if (!shop) return { error: "Shop not found." };
    if (!(await isSeoUnlocked(shop.id))) {
      return { error: "The per-product page read is not enabled for this shop." };
    }

    // The primary domain, not the myshopify one: a page fetched on the wrong
    // host answers with a redirect, and the row would report finding B5 about
    // a redirect this app caused itself (same reason as the nightly task).
    const domainJson = await (await admin.graphql(PRIMARY_DOMAIN_FOR_SCAN)).json();
    const shopUrl = domainJson.data?.shop?.url ?? `https://${session.shop}`;
    let origin = `https://${session.shop}`;
    try {
      origin = new URL(shopUrl).origin;
    } catch {
      // Keep the myshopify origin rather than refuse the read.
    }

    const password = await db.setting.findUnique({
      where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
    });

    const outcome = await scanOneProductPage({
      shopId: shop.id,
      productId: id,
      origin,
      password: password?.value,
    });

    // Refusals are sentences, not exceptions. Whatever happened, the loader
    // runs again and the section is rendered from the row, not from this.
    if (outcome.ok) return { scanRefusal: null };
    return {
      scanRefusal:
        outcome.reason === "budget"
          ? `This store has used all ${outcome.budget.budget} page reads for today. The nightly pass continues tomorrow.`
          : outcome.reason === "robots"
            ? `Your robots.txt disallows ${outcome.detail}, so this page was not fetched. robots.txt lives in your theme as robots.txt.liquid.`
            : outcome.reason === "no_handle"
              ? "This product has no handle recorded yet, so there is no page address to fetch."
              : "This product has no row in the per-product scan yet. It gets one on the next catalogue pass.",
    };
  }

  if (intent === "seo" || intent === "seo_revert" || intent === "seo_reset") {
    const shop = await db.shop.findUnique({ where: { domain: session.shop } });
    const unlocked = await isSeoUnlocked(shop?.id);
    if (!unlocked) {
      return { error: "The search listing capability is not enabled for this shop." };
    }
    const paid = await hasPaidAccess(session.shop, shop?.id, admin.graphql);
    if (!paid) {
      return { error: "This shop has no active subscription, so writing search listings is not available." };
    }
  }

  // ENTITLEMENT: every other write intent on this route - the facts save
  // (default branch below), capsule, capsule_reset, reset and alt - was
  // previously ungated, so any authenticated shop could write any product
  // through this action regardless of subscription. FREE-TIER-SPEC §2 says
  // the three merchant-chosen products are "not a preview - the real write",
  // fully editable the same way a paid catalogue is, so a shop with no
  // subscription may still write here when this product is one of its three
  // (or fewer) free products; any other product is refused. A paid shop
  // (or comp) always passes. This intentionally does not gate GET-only
  // reads or the seo intents above, which have their own rule.
  if (
    intent !== "seo" &&
    intent !== "seo_revert" &&
    intent !== "seo_reset" &&
    intent !== "seo_scan_page"
  ) {
    const shop = await db.shop.findUnique({ where: { domain: session.shop } });
    if (!shop) return { error: "Shop not found." };
    const paid = await hasPaidAccess(session.shop, shop.id, admin.graphql);
    if (!paid) {
      const free = await isFreeProduct(shop.id, id);
      if (!free) {
        return {
          error:
            "This product is not one of your three free products and this shop has no active subscription, so it cannot be edited here. Nothing already written is touched.",
        };
      }
    }
  }

  if (intent === "seo") {
    const res = await admin.graphql(PRODUCT, { variables: { id } });
    const json = await res.json();
    const productData = json.data?.product;
    const metafields = (productData?.metafields?.nodes ?? []) as { key: string; value: string }[];

    // Mirrors the loader's canWrite widening: a live field that is
    // currently empty has nothing left to protect, so a stale "human" flag
    // must not silently turn this Save into a no-op skip after the editor
    // already showed the field as fillable. clearSeoHumanFlag only drops the
    // flag - it keeps `prev`, so a genuine pre-app value is still there to
    // revert to; it never deletes the entry outright.
    const stateForWrite = parseState({ id, title: "", metafields });
    if ((productData?.seo?.title ?? "") === "") clearSeoHumanFlag(stateForWrite, "seo_title");
    if ((productData?.seo?.description ?? "") === "")
      clearSeoHumanFlag(stateForWrite, "seo_description");
    const metafieldsForWrite = [
      ...metafields.filter((m) => m.key !== "state"),
      { key: "state", value: JSON.stringify(stateForWrite) },
    ];
    const productLike = { id, metafields: metafieldsForWrite, seo: productData?.seo ?? null };

    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const titleSuggestion = String(form.get("titleSuggestion") ?? "");
    const descriptionSuggestion = String(form.get("descriptionSuggestion") ?? "");

    const fields: Partial<Record<SeoKey, { value: string; source: "auto" | "human" }>> = {};
    if (form.has("title")) {
      fields.seo_title = { value: title, source: title === titleSuggestion ? "auto" : "human" };
    }
    if (form.has("description")) {
      fields.seo_description = {
        value: description,
        source: description === descriptionSuggestion ? "auto" : "human",
      };
    }

    const outcome = await writeSeo(graphql, productLike, fields);
    return { seoSaved: true, outcome };
  }

  if (intent === "seo_revert") {
    const res = await admin.graphql(PRODUCT, { variables: { id } });
    const json = await res.json();
    const productData = json.data?.product;
    const metafields = (productData?.metafields?.nodes ?? []) as { key: string; value: string }[];
    const productLike = { id, metafields, seo: productData?.seo ?? null };

    const keys = form.getAll("key").map(String) as SeoKey[];
    const reverted = await revertSeo(graphql, productLike, keys);
    return { seoReverted: true, reverted };
  }

  if (intent === "seo_reset") {
    // Back to automatic: drop the human flag but keep prev, so a later
    // revert still restores the pre-app value; the next pass may regenerate.
    const res = await admin.graphql(PRODUCT, { variables: { id } });
    const json = await res.json();
    const metafields = (json.data?.product?.metafields?.nodes ?? []) as {
      key: string;
      value: string;
    }[];
    const state = parseState({ id, title: "", metafields });
    const keys = form.getAll("key").map(String) as SeoKey[];
    for (const key of keys) {
      const entry = state[key] as { source: "auto" | "human"; at: string; engine?: string; prev: string } | undefined;
      if (entry) state[key] = { ...entry, source: "auto" };
    }
    await admin.graphql(SET, {
      variables: {
        metafields: [
          { ownerId: id, namespace: NAMESPACE, key: "state", type: "json", value: JSON.stringify(state) },
        ],
      },
    });
    return { seoReset: true };
  }

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

type CrawlerPage = {
  hasRow: boolean;
  scannedAt: string | null;
  status: string | null;
  canonical: string | null;
  noindex: boolean | null;
  appBlock: string | null;
  cacheControl: string | null;
  findings: { code: string; source: string; text: string }[];
  budget: { budget: number; spent: number; remaining: number };
};

/**
 * What a crawler sees on this page (PRD-SEO-PER-PRODUCT section 4, build
 * step 5): this product's row from the per-product scan, and a button that
 * fetches the page now.
 *
 * Everything here comes off the row. Nothing is held in component state and
 * nothing is carried over from the action's return value, which is what makes
 * the second render honest: after the button, the loader re-reads the row and
 * the section shows the scannedAt and the findings that were actually
 * written. Two bugs shipped in this app by showing what a screen was told
 * rather than what was stored (CLAUDE.md: the SEO queue kept showing
 * pre-write proposals and read "0 of 50" on a fully written store).
 *
 * The button exists wherever the SEO key is present, including on a free-tier
 * shop's three products (PRD section 7, decision 2): the key is what is paid
 * for, and the annual licence is a separate product.
 */
function CrawlerPageCard({
  page,
  busy,
}: {
  page: {
    hasRow: boolean;
    scannedAt: string | null;
    status: string | null;
    canonical: string | null;
    noindex: boolean | null;
    appBlock: string | null;
    cacheControl: string | null;
    findings: { code: string; source: string; text: string }[];
    budget: { budget: number; spent: number; remaining: number };
    refusal: string | null;
  };
  busy: boolean;
}) {
  const scanned = page.scannedAt ? new Date(page.scannedAt).toLocaleString() : null;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              What a crawler sees on this page
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              The product page fetched from outside the store, the way a
              crawler would fetch it. Nothing here is written to your store.
            </Text>
          </BlockStack>
          <Form method="post">
            <input type="hidden" name="intent" value="seo_scan_page" />
            <Button submit loading={busy} disabled={page.budget.remaining <= 0}>
              {scanned ? "Read this page again" : "Read this page now"}
            </Button>
          </Form>
        </InlineStack>

        {page.refusal ? <Banner tone="warning">{page.refusal}</Banner> : null}

        <Text as="p" tone="subdued" variant="bodySm">
          {`${page.budget.spent} of ${page.budget.budget} page reads used today for this store.` +
            (page.budget.remaining <= 0
              ? " Today's allowance is used up; the nightly pass continues tomorrow."
              : "")}
        </Text>

        {!page.hasRow ? (
          <Text as="p" tone="subdued">
            This product has no row yet. It gets one on the next catalogue
            pass - run Fill catalogue from the dashboard, then read the page.
          </Text>
        ) : !scanned ? (
          <Text as="p" tone="subdued">
            This page has not been read yet. The nightly pass works through
            the catalogue oldest first, or you can read this one now.
          </Text>
        ) : page.status !== "ok" ? (
          <Banner tone="warning">
            {`The page could not be read as a crawler would read it on ${scanned} (${page.status}). Nothing is concluded about the page from that - not that it lacks a Product node, and not that it has one.`}
          </Banner>
        ) : (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {`Read on ${scanned}.`}
            </Text>
            <InlineStack gap="150" wrap>
              <Badge tone={page.noindex ? "critical" : "success"}>
                {page.noindex ? "noindex" : "Indexable"}
              </Badge>
              <Badge tone={page.appBlock === "present" ? "success" : "attention"}>
                {page.appBlock === "present" ? "Our block found" : "Our block not found"}
              </Badge>
              {page.cacheControl ? (
                <Badge>{`Cache-Control: ${page.cacheControl}`}</Badge>
              ) : null}
            </InlineStack>
            {page.canonical ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {`Canonical: ${page.canonical}`}
              </Text>
            ) : null}
          </BlockStack>
        )}

        {page.findings.length > 0 ? (
          <BlockStack gap="150">
            <Divider />
            {page.findings.map((f, i) => (
              <InlineStack key={`${f.code}-${i}`} gap="200" blockAlign="start" wrap={false}>
                <Box paddingBlockStart="050">
                  <Badge tone={f.source === "A" ? "info" : "attention"}>{f.code}</Badge>
                </Box>
                <Text as="p" variant="bodySm">
                  {f.text}
                </Text>
              </InlineStack>
            ))}
          </BlockStack>
        ) : page.hasRow && scanned && page.status === "ok" ? (
          <Text as="p" tone="subdued" variant="bodySm">
            Nothing found on this product by any check that has run.
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

export default function ProductEditor() {
  const {
    product,
    crawlerPage,
    images,
    storedFacts,
    autoFacts,
    source,
    updatedAt,
    capsule,
    crawlers,
    answer,
    citation,
    mirrorUrl,
    seo,
  } =
    useLoaderData<typeof loader>() as {
      answer: {
        question: string;
        withApp: string;
        withoutApp: string;
        sources: string[];
      } | null;
      citation: CitationCheck | null;
      crawlers: { agent: string; ok: boolean; checkedAt: string }[];
      crawlerPage: CrawlerPage | null;
      product: { id: string; title: string; handle: string; image: string | null };
      mirrorUrl: string | null;
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
      seo: {
        unlocked: boolean;
        title: string;
        description: string;
        titleSuggestion: string;
        descriptionSuggestion: string;
        titleSource: "human" | "auto" | "outside" | "missing";
        descriptionSource: "human" | "auto" | "outside" | "missing";
        titleCanRevert: boolean;
        descriptionCanRevert: boolean;
        titleCanWrite: boolean;
        descriptionCanWrite: boolean;
      };
    };
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  // Refusal errors from the action (entitlement checks, write failures) were
  // returned but never rendered, so a refused save looked like a successful
  // one. Surfaced as a critical banner at the top of the editor.
  const actionData = useActionData<typeof action>() as
    | { error?: string; scanRefusal?: string | null }
    | undefined;

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
  const [seoTitle, setSeoTitle] = useState(seo?.title ?? "");
  const [seoDescription, setSeoDescription] = useState(seo?.description ?? "");

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

  function SeoSourceBadge({ src }: { src: "human" | "auto" | "outside" | "missing" }) {
    return src === "human" ? (
      <Badge tone="attention">Edited by you</Badge>
    ) : src === "auto" ? (
      <Badge tone="success">Automatic</Badge>
    ) : src === "outside" ? (
      <Badge tone="warning">Set outside this app</Badge>
    ) : (
      <Badge>Not set</Badge>
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
        {actionData?.error ? <Banner tone="critical">{actionData.error}</Banner> : null}

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
            {mirrorUrl ? (
              <Text as="p" variant="bodySm">
                <a href={mirrorUrl} target="_blank" rel="noreferrer">
                  What AI reads for this product
                </a>
              </Text>
            ) : (
              <Text as="p" tone="subdued" variant="bodySm">
                Not readable yet - runs when this product is processed. Use
                Preview changes or Fill catalogue from the dashboard, or
                process it from the Products screen.
              </Text>
            )}
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

        {crawlerPage ? (
          <CrawlerPageCard
            page={{ ...crawlerPage, refusal: actionData?.scanRefusal ?? null }}
            busy={busy}
          />
        ) : null}

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
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Readability
            </Text>
            <Text as="p" tone="subdued">
              Based on a published analysis of 1.4 million ChatGPT prompts.
              This is a rule of thumb about wording, not a guarantee of being
              cited.
            </Text>
            {citation === null ? (
              <Text as="p" tone="subdued">
                No buyer questions are published for this product yet, so
                there is nothing to compare the title against. Add questions
                below first.
              </Text>
            ) : (
              <BlockStack gap="200">
                <InlineStack gap="150" blockAlign="center">
                  <Badge
                    tone={
                      citation.verdict === "good"
                        ? "success"
                        : citation.verdict === "partial"
                          ? "warning"
                          : "critical"
                    }
                  >
                    {citation.verdict === "good"
                      ? "Title matches buyer questions"
                      : citation.verdict === "partial"
                        ? "Title partially matches buyer questions"
                        : "Title does not match buyer questions"}
                  </Badge>
                </InlineStack>
                {citation.verdict !== "good" && citation.missingFromTitle.length > 0 ? (
                  <Text as="p" tone="subdued">
                    {`Consider working these words into the title: ${citation.missingFromTitle.join(", ")}.`}
                  </Text>
                ) : null}
                {!citation.handleIsDescriptive ? (
                  <Text as="p" tone="subdued">
                    {`The URL handle ("${product.handle}") reads as an identifier rather than natural language. Changing it now would break every existing link to this product - Shopify only keeps a redirect when one is created explicitly - so this is not worth doing for a live product. Worth considering when naming new products.`}
                  </Text>
                ) : null}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

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
                                We would write: "{img.suggestion}"
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

        {seo?.unlocked ? (
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="seo" />
              <input type="hidden" name="titleSuggestion" value={seo.titleSuggestion} />
              <input type="hidden" name="descriptionSuggestion" value={seo.descriptionSuggestion} />
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Search listing (meta title and description)
                </Text>
                <Text as="p" tone="subdued">
                  Generated by condensing this product's own text; nothing is
                  written until you save, and anything a person wrote is never
                  overwritten.
                </Text>

                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingSm">
                    Meta title
                  </Text>
                  <SeoSourceBadge src={seo.titleSource} />
                </InlineStack>
                <TextField
                  label="Meta title"
                  labelHidden
                  name="title"
                  value={seoTitle}
                  onChange={setSeoTitle}
                  autoComplete="off"
                  disabled={!seo.titleCanWrite}
                  helpText={
                    seo.titleCanWrite
                      ? `${seoTitle.length} characters, aiming for under 60.`
                      : "Set outside this app or edited by hand - protected from bulk passes."
                  }
                />
                <InlineStack gap="200">
                  <Button
                    size="micro"
                    disabled={!seo.titleCanWrite}
                    onClick={() => setSeoTitle(seo.titleSuggestion)}
                  >
                    Generate
                  </Button>
                </InlineStack>

                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingSm">
                    Meta description
                  </Text>
                  <SeoSourceBadge src={seo.descriptionSource} />
                </InlineStack>
                {seo.descriptionSource === "missing" ? (
                  <Text as="p" tone="subdued">
                    This field is empty, so what search engines see is decided
                    by your theme: most fall back to a cut of the description,
                    some publish no description at all. Generate fills the
                    field from this product's own text, so it stops depending
                    on the theme.
                  </Text>
                ) : null}
                <TextField
                  label="Meta description"
                  labelHidden
                  name="description"
                  value={seoDescription}
                  onChange={setSeoDescription}
                  multiline={3}
                  autoComplete="off"
                  disabled={!seo.descriptionCanWrite}
                  helpText={
                    seo.descriptionCanWrite
                      ? `${seoDescription.length} characters, aiming for 140 to 160.`
                      : "Set outside this app or edited by hand - protected from bulk passes."
                  }
                />
                <InlineStack gap="200">
                  <Button
                    size="micro"
                    disabled={!seo.descriptionCanWrite}
                    onClick={() => setSeoDescription(seo.descriptionSuggestion)}
                  >
                    Generate
                  </Button>
                </InlineStack>

                <InlineStack gap="200">
                  <Button submit variant="primary" loading={busy}>
                    Save
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>

            {seo.titleCanRevert || seo.descriptionCanRevert ? (
              <Box paddingBlockStart="300">
                <Form method="post">
                  <input type="hidden" name="intent" value="seo_revert" />
                  {seo.titleCanRevert ? <input type="hidden" name="key" value="seo_title" /> : null}
                  {seo.descriptionCanRevert ? (
                    <input type="hidden" name="key" value="seo_description" />
                  ) : null}
                  <Button submit loading={busy} tone="critical">
                    Revert to before the app
                  </Button>
                  <Box paddingBlockStart="100">
                    <Text as="p" tone="subdued" variant="bodySm">
                      Puts back exactly what these fields held before this app
                      first wrote to them. Where that was nothing, the field
                      goes back to empty and what search engines see is again
                      up to your theme.
                    </Text>
                  </Box>
                </Form>
              </Box>
            ) : null}
          </Card>
        ) : null}

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
