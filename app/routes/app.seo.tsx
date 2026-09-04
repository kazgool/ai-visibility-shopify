import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useEffect, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "@remix-run/react";
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
  Divider,
  Spinner,
  Box,
  Collapsible,
  Tabs,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueue } from "../services/queue.server";
import { isSeoUnlocked, hasPaidAccess } from "../services/billing.server";
import { checkAppEmbed, embedDeepLink } from "../services/embed-check.server";
import {
  scanStorefront,
  recordThemeScan,
  themeScanRowWasWritten,
  themeRowKey,
  deriveMissingReasons,
  type ThemeScanResult,
  type MissingReasonInput,
  type ConflictEntry,
} from "../services/theme-scan.server";
import { diffThemeScans, formatSeoWatchLine, type SeoWatchChange } from "../services/seo-watch";
import {
  cleanSentence,
  pagesReadSentence,
  themeNodeAdvice,
  themeNodeSentence,
  type FindingsAggregate,
  type ThemeNodeAggregate,
} from "../services/seo-aggregate";
import { readSeoAggregates } from "../services/seo-aggregate.server";
import {
  readCurrentFacts,
  readSeoSnapshot,
  serialiseFacts,
} from "../services/seo-snapshot.server";
import type { FactsRow } from "../services/seo-since";
import { SeoSinceCard } from "../components/SeoSinceCard";
import {
  SeoCollectionsPanel,
  type CollectionJobLike,
} from "../components/SeoCollectionsPanel";
import type { CollectionSeoQueue } from "../services/seo-collections.server";
import { CHECK_LABEL, CHECK_METHOD } from "../services/seo-findings";
import {
  describeGraphqlError,
  isInternalServerError,
  named,
  shopifyRequestId,
} from "../services/graphql-errors";
import {
  DEFAULT_DAILY_BUDGET,
  dailyBudget,
  robotsBlock,
  staleSitemapEntries,
} from "../services/seo-page.server";
import { organizationPairIsInformational } from "../services/conflicts";
import { businessFor } from "../services/business.server";
import type { SeoKey, SeoQueue } from "../services/seo.server";
import type { SeoApplyReport } from "../services/seo-bulk.server";
import { isQueueStale, isQueueUsable, seoFieldMetric } from "../services/seo-queue-metrics";

// A dashboard, not a diagnostics report - this mirrors app._index.tsx on
// purpose (see SEO-WORKSPACE-PRD.md and the brief that rebuilt this screen a
// fourth time): a metric row at the top, then cards that each carry a plain
// method line and something to press. Detail (the full node list, the crawl
// checks, the protected-field list) is one disclosure toggle, never the
// screen's primary structure - three earlier versions led with tabs and were
// rejected for exactly that reason.

const FIRST_PRODUCT = `#graphql
  query FirstOnlineProductSeo {
    products(first: 1, query: "published_status:published") {
      nodes {
        id
        handle
        onlineStoreUrl
        metafields(namespace: "$app", first: 10) { nodes { key value } }
      }
    }
  }
`;

const PRIMARY_DOMAIN = `#graphql
  query PrimaryDomainSeo {
    shop { primaryDomain { host } url }
  }
`;

const MAIN_THEME_ID = `#graphql
  query MainThemeIdSeo {
    themes(first: 1, roles: [MAIN]) {
      nodes { id }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: the route itself refuses without seo_unlocked, not only the
  // nav link - a URL can be typed directly.
  const unlocked = shop ? await isSeoUnlocked(shop.id) : false;
  if (!unlocked) {
    return { unlocked: false as const };
  }

  // Pinned to the published theme's own row - the row this screen's scan
  // writes - rather than "most recent of anything": a themes/publish
  // webhook once wrote a narrow scan under a differently-spelled theme id,
  // and findFirst-by-date then surfaced that instead of the rich scan.
  // Writers now merge and normalise (recordNarrowThemeScan / themeRowKey),
  // and this read stops depending on write order entirely. Falls back to
  // the most recent row for shops whose scans predate the normalisation.
  let themeScan = null;
  if (shop) {
    try {
      const themeRes = await named("MainThemeIdSeo", () => admin.graphql(MAIN_THEME_ID));
      const themeJson = await themeRes.json();
      const mainThemeId = themeJson.data?.themes?.nodes?.[0]?.id;
      if (mainThemeId) {
        themeScan = await db.themeScan.findUnique({
          where: {
            shopId_themeId: { shopId: shop.id, themeId: themeRowKey(String(mainThemeId)) },
          },
        });
      }
    } catch {
      themeScan = null;
    }
    if (!themeScan) {
      themeScan = await db.themeScan.findFirst({
        where: { shopId: shop.id },
        orderBy: { scannedAt: "desc" },
      });
    }
  }

  // Storefront password: only report whether one is saved, never the value
  // itself - it is a merchant credential and never belongs in a loader
  // payload that reaches the browser.
  const passwordRow = shop
    ? await db.setting.findUnique({
        where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
      })
    : null;
  const hasStorefrontPassword = Boolean(passwordRow?.value);

  const embed = await checkAppEmbed(admin.graphql);

  // The two bulk-pass jobs this screen can start (SEO-WORKSPACE-PRD §3.5):
  // the queue build (read-only, also carries the term-gap card's data) and
  // the apply (writes the approved rows). Read here, not recomputed in the
  // browser - JobRun is the record.
  const [queueJob, applyJob, collectionQueueJob, collectionApplyJob] = shop
    ? await Promise.all([
        db.jobRun.findFirst({ where: { shopId: shop.id, kind: "seo_queue" }, orderBy: { createdAt: "desc" } }),
        db.jobRun.findFirst({ where: { shopId: shop.id, kind: "seo_apply" }, orderBy: { createdAt: "desc" } }),
        // The Collections tab's own pair. Separate kinds on purpose: each tab
        // says what its own check found, and pressing Preview on one must not
        // present the other's numbers.
        db.jobRun.findFirst({
          where: { shopId: shop.id, kind: "seo_collection_queue" },
          orderBy: { createdAt: "desc" },
        }),
        db.jobRun.findFirst({
          where: { shopId: shop.id, kind: "seo_collection_apply" },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [null, null, null, null];

  // Per-product SEO scan (PRD-SEO-PER-PRODUCT build step 4). Both cards below
  // read one aggregate over the whole SeoScan table, so the Findings card and
  // the Structured data card can never disagree about the same catalogue. The
  // budget comes with them because the pages-read sentence has to do this
  // shop's own arithmetic, not repeat a constant.
  // The robots block comes with them for the same reason: a shop whose own
  // robots.txt disallows /products/ has a card full of "waiting for the
  // nightly page read" rows and a night that has already decided to fetch
  // nothing. The sentence at the top of the card has to say so (QA, 3
  // September 2026).
  const [scan, scanBudget, scanRobotsBlock, staleSitemap] = shop
    ? await Promise.all([
        readSeoAggregates(shop.id),
        dailyBudget(shop.id),
        robotsBlock(shop.id),
        // A7's other half. It cannot be a row - a withdrawn product has no row
        // to put it on - so the nightly pass records it per shop.
        staleSitemapEntries(shop.id),
      ])
    : [null, DEFAULT_DAILY_BUDGET, null, null];

  // The since-card (PRD-SEO-FULL-ONPAGE §1.2). Two rows, both already
  // computed: the before, written once at unlock, and the rolling current,
  // rewritten by the last complete catalogue pass. No catalogue read on this
  // request - that is the whole reason the current row exists.
  const [beforeRow, currentRow] = shop
    ? await Promise.all([readSeoSnapshot(shop.id), readCurrentFacts(shop.id)])
    : [null, null];

  // isQueueUsable/isQueueStale read a serialised job (finishedAt as a string),
  // which is what the browser gets; here the row still carries a Date.
  const collectionQueueView = collectionQueueJob
    ? {
        status: collectionQueueJob.status,
        finishedAt: collectionQueueJob.finishedAt?.toISOString() ?? null,
        report: collectionQueueJob.report,
      }
    : null;

  return {
    unlocked: true as const,
    staleSitemap,
    collections: {
      queueJob: collectionQueueJob,
      applyJob: collectionApplyJob,
      // The same rule the products tab follows: a report is only trustworthy
      // in status "done". "stale" means a write has since made its counts
      // false, so it is presented as null rather than as data known to be
      // wrong.
      report: isQueueUsable(collectionQueueView) ? collectionQueueJob!.report : null,
      stale: isQueueStale(collectionQueueView),
    },
    since: {
      before: beforeRow ? (serialiseFacts(beforeRow) as FactsRow) : null,
      today: currentRow ? (serialiseFacts(currentRow) as FactsRow) : null,
    },
    themeScan,
    embed,
    embedLink: embedDeepLink(session.shop),
    queueJob,
    applyJob,
    hasStorefrontPassword,
    scan,
    scanBudget,
    scanRobotsBlock,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  // ENTITLEMENT: the nav link only hides the entry, the action must also
  // check, because a form can be posted without ever seeing the link. Covers
  // every intent below - the queue build, the apply, and the scan.
  const unlocked = await isSeoUnlocked(shop.id);
  if (!unlocked) return { error: "This screen is not enabled for this shop." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "scan");

  // Storefront password: a credential belonging to the merchant, stored in
  // the same Setting row scanStorefront/scanPage already read (and always
  // read, never once written - that gap is what this intent closes). Never
  // logged, never echoed back in a response body.
  if (intent === "seo_save_password") {
    const password = String(form.get("storefront_password") ?? "").trim();
    if (!password) return { error: "Enter a password before saving." };
    await db.setting.upsert({
      where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
      create: { shopId: shop.id, key: "storefront_password", value: password },
      update: { value: password },
    });
    return redirect(`/app/seo`);
  }

  if (intent === "seo_clear_password") {
    await db.setting.deleteMany({
      where: { shopId: shop.id, key: "storefront_password" },
    });
    return redirect(`/app/seo`);
  }

  // ENTITLEMENT (Marius's ruling, 31 Aug 2026): seo_unlocked being on is not
  // enough for either write path here - a shop with no active subscription
  // (and no comp) may run neither the bulk preview pass nor the apply.
  // admin.graphql is already at hand on this route, so this is the
  // hasPaidAccess form, not the job-loop mayProcessAutomatically form (that
  // one re-runs inside the worker tasks themselves, since a queue can sit
  // for a while between being built and being applied). Read paths (the
  // loader, the scan intent, the password settings) are unaffected.
  if (
    intent === "seo_build_queue" ||
    intent === "seo_apply" ||
    intent === "seo_collection_preview" ||
    intent === "seo_collection_apply"
  ) {
    const paid = await named("hasPaidAccess", () =>
      hasPaidAccess(session.shop, shop.id, admin.graphql),
    );
    if (!paid) {
      return {
        error:
          "This shop has no active subscription, so writing search listings is not available. Everything already written stays written; nothing is cleared or reverted.",
      };
    }
  }

  if (intent === "seo_build_queue") {
    const active = await db.jobRun.findFirst({
      where: { shopId: shop.id, kind: "seo_queue", status: { in: ["queued", "running"] } },
    });
    if (active) return { error: "A preview is already running." };

    const jobRun = await db.jobRun.create({ data: { shopId: shop.id, kind: "seo_queue" } });
    await enqueue("seo_queue_build", { shopId: shop.id, jobRunId: jobRun.id });
    return { queued: true };
  }

  // The Collections tab (PRD-SEO-FULL-ONPAGE section 2). Same shape as the two
  // product intents above, against its own JobRun kinds, so each tab reports
  // its own check and neither can present the other's numbers.
  if (intent === "seo_collection_preview") {
    const active = await db.jobRun.findFirst({
      where: {
        shopId: shop.id,
        kind: "seo_collection_queue",
        status: { in: ["queued", "running"] },
      },
    });
    if (active) return { error: "A collections preview is already running." };

    const jobRun = await db.jobRun.create({
      data: { shopId: shop.id, kind: "seo_collection_queue" },
    });
    await enqueue("seo_collection_queue", { shopId: shop.id, jobRunId: jobRun.id });
    return { queued: true };
  }

  if (intent === "seo_collection_apply") {
    const items = form
      .getAll("items")
      .map(String)
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw) as {
            collectionId: string;
            field: SeoKey;
            value: string;
          };
          if (!parsed?.collectionId || !parsed?.field) return null;
          return {
            collectionId: parsed.collectionId,
            field: parsed.field,
            value: String(parsed.value ?? ""),
          };
        } catch {
          return null;
        }
      })
      .filter(
        (i): i is { collectionId: string; field: SeoKey; value: string } => i !== null,
      );

    if (items.length === 0) return { error: "Nothing was selected to write." };

    const jobRun = await db.jobRun.create({
      data: { shopId: shop.id, kind: "seo_collection_apply" },
    });
    await enqueue("seo_collection_apply", { shopId: shop.id, jobRunId: jobRun.id, items });
    return { queued: true };
  }

  if (intent === "seo_apply") {
    const raw = form.getAll("items").map(String);
    const items = raw
      .map((s) => {
        try {
          const parsed = JSON.parse(s) as { id: string; field: SeoKey; value: string };
          if (!parsed?.id || !parsed?.field) return null;
          return { productId: parsed.id, field: parsed.field, value: String(parsed.value ?? "") };
        } catch {
          return null;
        }
      })
      .filter((i): i is { productId: string; field: SeoKey; value: string } => i !== null);

    if (items.length === 0) return { error: "Nothing was selected." };

    // The queue JobRun these items were reviewed against, so the worker can
    // mark it stale once this apply finishes - see seo_apply in
    // worker/tasks.ts and seo-queue-metrics.ts. Optional only because a very
    // old client without this field must not fail to apply; the invalidation
    // simply does not fire for it.
    const queueJobId = String(form.get("queueJobId") ?? "").trim() || null;

    // The UI hides every row once its queue goes stale, so this only fires
    // on a race - a second tab, or a click landing between an earlier
    // apply's write and this page's next revalidation. The write itself
    // would still be safe either way (runSeoApply re-reads each product
    // fresh right before writing), but the review the operator saw is no
    // longer current, so the apply is refused rather than run on stale
    // consent.
    if (queueJobId) {
      const reviewedQueue = await db.jobRun.findUnique({ where: { id: queueJobId } });
      if (!reviewedQueue || reviewedQueue.status !== "done") {
        return { error: "This preview is out of date. Press Preview again before writing." };
      }
    }

    const active = await db.jobRun.findFirst({
      where: { shopId: shop.id, kind: "seo_apply", status: { in: ["queued", "running"] } },
    });
    if (active) return { error: "An apply is already running." };

    const jobRun = await db.jobRun.create({ data: { shopId: shop.id, kind: "seo_apply" } });
    await enqueue("seo_apply", { shopId: shop.id, jobRunId: jobRun.id, items, queueJobId });
    return { applied: true };
  }

  // The scan, in a try for one reason only: an INTERNAL_SERVER_ERROR from
  // Shopify's own API is not this app failing and must not reach the merchant
  // as an Application Error banner. Everything else still throws, so a real
  // bug here is still loud (4 September 2026 - it reproduced twice, at
  // 04:30:20 and 04:58:26).
  //
  // Every Admin call on this path is named, so the next failure says which one
  // (that is the whole reason named() exists, and it was not closed on this
  // path until the same day).
  try {
  const productRes = await named("FirstOnlineProductSeo", () => admin.graphql(FIRST_PRODUCT));
  const productJson = await productRes.json();
  const productNode = productJson.data?.products?.nodes?.[0];
  const productUrl = productNode?.onlineStoreUrl ?? `https://${session.shop}`;

  const domainRes = await named("PrimaryDomainSeo", () => admin.graphql(PRIMARY_DOMAIN));
  const domainJson = await domainRes.json();
  const homeUrl = domainJson.data?.shop?.url ?? `https://${session.shop}`;

  const password = await db.setting.findUnique({
    where: { shopId_key: { shopId: shop.id, key: "storefront_password" } },
  });

  const result = await scanStorefront(productUrl, homeUrl, password?.value);

  // Weekly-watch bookkeeping: diff against whatever was scanned last, so a
  // manual "scan now" also feeds the same dated history the scheduled job
  // writes to.
  const themeRes = await named("MainThemeIdSeo", () => admin.graphql(MAIN_THEME_ID));
  const themeJson = await themeRes.json();
  const themeId = themeJson.data?.themes?.nodes?.[0]?.id;

  let watchChanges: SeoWatchChange[] = [];
  if (themeId) {
    const previousRow = await db.themeScan.findUnique({
      where: { shopId_themeId: { shopId: shop.id, themeId: String(themeId) } },
    });
    const previous = (previousRow?.detail as any as ThemeScanResult) ?? null;
    const nowIso = new Date().toISOString();
    const newChanges = diffThemeScans(previous, result, nowIso);
    const priorHistory: SeoWatchChange[] = previous?.watchChanges ?? [];
    watchChanges = [...priorHistory, ...newChanges].slice(-20);
  }

  const business = await businessFor(shop.id);

  const facts = (productNode?.metafields?.nodes ?? []).find((m: any) => m.key === "facts")?.value;
  const summary = (productNode?.metafields?.nodes ?? []).find((m: any) => m.key === "summary")?.value;
  const fitFor = (productNode?.metafields?.nodes ?? []).find((m: any) => m.key === "fit_for")?.value;

  const embed = await checkAppEmbed(admin.graphql);

  // The rating and FAQ-question findings are read off the page the scan
  // just fetched (result.hasAggregateRating / result.hasFAQPage), not
  // guessed. When the page could not be read at all (password wall), the
  // value is genuinely unknown rather than false - see deriveMissingReasons.
  const reasonInput: MissingReasonInput = {
    embedActive: Boolean(embed?.active),
    mode: "extend",
    hasFacts: Boolean(facts),
    hasSummary: Boolean(summary),
    hasFitFor: Boolean(fitFor),
    hasReturnDays: Boolean(business?.returnDays),
    hasDeliveryTime: Boolean(business?.deliveryTime) && !business?.deliveryVaries,
    hasRating: result.passwordProtected ? null : Boolean(result.hasAggregateRating),
    // Read off the scan's own node lists, not inferred from the module being
    // enabled: WebSite lives on the home page, BreadcrumbList on the product
    // page, and a page that could not be read yields null, never false.
    hasWebSiteNode:
      !result.home || result.home.passwordProtected
        ? null
        : result.home.nodes.some((n) => n.types.includes("WebSite")),
    hasBreadcrumbNode:
      !result.product || result.product.passwordProtected
        ? null
        : result.product.nodes.some((n) => n.types.includes("BreadcrumbList")),
    hasCollectionQuestions: result.passwordProtected ? null : Boolean(result.hasFAQPage),
    hasSocialProfiles: Boolean(
      business?.socialProfiles && Object.keys(business.socialProfiles).length > 0,
    ),
    seoUnlocked: true,
    isCollectionPage: false,
  };

  const missingReasons = deriveMissingReasons(reasonInput);
  const richResultsUrl = `https://search.google.com/test/rich-results?url=${encodeURIComponent(productUrl)}`;

  const stored: ThemeScanResult = { ...result, watchChanges, missingReasons, richResultsUrl };

  if (themeId) {
    await recordThemeScan(shop.id, String(themeId), stored, admin.graphql);
  }

  // Redirect rather than returning actionData: the loader's persisted state
  // is what every card on this screen reads, so after a scan the whole
  // dashboard sees the fresh result without a stale actionData overlay.
  return redirect(`/app/seo`);
  } catch (error) {
    // Only Shopify's own failure is turned into a sentence. Anything else is
    // ours and keeps throwing.
    if (!isInternalServerError(error)) throw error;

    // Logged with the operation name the named() wrappers attached, so the
    // next occurrence names the call even though this catch cannot.
    console.error(describeGraphqlError(error, "POST /app/seo scan"));

    const requestId = shopifyRequestId(error);
    const reference = requestId
      ? ` Give Shopify support this request ID: ${requestId}.`
      : "";

    // The scan row is written before the storefront mirror, so a failure in
    // the mirror leaves the scan saved and only the mirror stale. Saying "the
    // scan was lost" then would be false, which is why recordThemeScan marks
    // the error rather than letting this guess.
    if (themeScanRowWasWritten(error)) {
      return {
        error:
          "Shopify's API returned an internal error on their side, so the storefront mirror " +
          "was not updated. The scan itself was saved and every card below reflects it. " +
          "Nothing was lost and nothing was reverted; the next scan updates the mirror." +
          reference,
      };
    }
    return {
      error:
        "Shopify's API returned an internal error on their side, so this scan could not " +
        "finish. Nothing was written and nothing was lost: your products, your metafields " +
        "and the last scan's results are all untouched. Try again in a few minutes." +
        reference,
    };
  }
};

// ---------------------------------------------------------------------------
// Findings: the scan, conflicts and missing-reasons work that already
// existed, recomposed as one prioritised list instead of separate tabs.

type Severity = "critical" | "warning" | "info";

type Finding = {
  key: string;
  severity: Severity;
  text: string;
  fixHref: string | null;
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const SEVERITY_TONE: Record<Severity, "critical" | "attention" | "info"> = {
  critical: "critical",
  warning: "attention",
  info: "info",
};

/**
 * Nothing here is derived when the page could not be read (result is
 * undefined or passwordProtected) - a failed scan yields no findings, never
 * a false "0 problems" (EXPERIENCE-PRD §2: if we did not fetch it, we do not
 * say). The caller renders the password-wall banner separately.
 */
function buildFindings(result: ThemeScanResult | undefined): Finding[] {
  if (!result || result.passwordProtected) return [];
  const findings: Finding[] = [];

  const pages: { label: string; page: typeof result.product }[] = [
    { label: "product page", page: result.product },
    { label: "home page", page: result.home },
  ];
  for (const { label, page } of pages) {
    if (page && !page.passwordProtected && page.noindex) {
      findings.push({
        key: `noindex-${label}`,
        severity: "critical",
        text: `The ${label} carries a noindex tag, which blocks it from being indexed at all. This is almost always unintentional - fix it in your theme's robots meta tag settings.`,
        fixHref: null,
      });
    }
  }

  if (result.robots?.fetched) {
    for (const path of result.robots.disallowsRelevant) {
      findings.push({
        key: `robots-${path}`,
        severity: "critical",
        text: `robots.txt disallows ${path}, which blocks crawlers from reaching it. robots.txt lives in your theme as robots.txt.liquid - no app can rewrite it on your behalf.`,
        fixHref: null,
      });
    }
  }

  const conflictGroups: { label: string; conflicts?: ConflictEntry[] }[] = [
    { label: "product page", conflicts: result.productConflicts },
    { label: "home page", conflicts: result.homeConflicts },
  ];
  for (const { label, conflicts } of conflictGroups) {
    for (const c of conflicts ?? []) {
      // An Organization pair where one node is ours is expected, never a
      // defect: the theme's node has no identifier we can attach to, ours
      // carries the official profiles, and consumers merge or pick. It is
      // reported as informational so the merchant knows, and never as
      // warning or critical severity.
      if (organizationPairIsInformational(c)) {
        findings.push({
          key: `conflict-${label}-${c.type}`,
          severity: "info",
          text: `Organization appears ${c.count} times on the ${label}. The theme's node has no identifier we can attach to, so ours carries your official profiles alongside it; consumers merge or pick between the two. Adding an @id to the theme's node would merge them.`,
          fixHref: null,
        });
        continue;
      }
      findings.push({
        key: `conflict-${label}-${c.type}`,
        severity: "warning",
        text: `${c.type} appears ${c.count} times on the ${label}. ${
          c.weEmitOne
            ? "One of them is ours - switch the app embed to Extend mode so we reference the theme's node instead of adding a second one."
            : "The other instance is not something we can identify - check the theme and any other installed apps."
        }`,
        fixHref: c.weEmitOne ? "/app/diagnostics" : null,
      });
    }
  }

  for (const r of result.missingReasons ?? []) {
    if (r.emitted) continue;
    const unknown = r.reason?.includes("Could not be determined") ?? false;
    findings.push({
      key: `missing-${r.nodeType}`,
      severity: unknown ? "info" : "warning",
      text: `${r.nodeType} is not published: ${r.reason ?? "no reason recorded"}`,
      fixHref: r.fixScreen,
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function MetricTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "critical" | "subdued";
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl" tone={tone === "subdued" ? "subdued" : undefined}>
          {value}
        </Text>
        <Text as="p" variant="bodySm" tone={tone === "critical" ? "critical" : "subdued"}>
          {hint}
        </Text>
      </BlockStack>
    </Card>
  );
}

function ConflictList({ label, conflicts }: { label: string; conflicts?: ConflictEntry[] }) {
  if (!conflicts || conflicts.length === 0) {
    return (
      <Text as="p" tone="subdued">
        No repeated node types found on the {label} in the last scan.
      </Text>
    );
  }
  return (
    <List>
      {conflicts.map((c) => (
        <List.Item key={c.type}>
          {c.type} appears {c.count} times on the {label}.{" "}
          {organizationPairIsInformational(c)
            ? "Informational: the theme's node has no identifier we can attach to, so ours carries your official profiles alongside it; adding an @id to the theme's node would merge them."
            : c.weEmitOne
              ? "One of them is ours - switch the app embed to Extend mode so we reference the theme's node instead of adding a second one."
              : "Unknown source - the other instance is not something we can identify; check the theme and any other installed apps."}
        </List.Item>
      ))}
    </List>
  );
}

function SchemaDetail({ result }: { result: ThemeScanResult | undefined }) {
  if (!result || result.passwordProtected) return null;
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Product page: {result.product?.url}
          </Text>
          {result.product?.nodes.length ? (
            <BlockStack gap="100">
              {result.product.nodes.map((n, i) => (
                <InlineStack gap="200" key={i}>
                  <Badge>{n.types.join(", ")}</Badge>
                  {n.id ? (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {n.id}
                    </Text>
                  ) : null}
                </InlineStack>
              ))}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">
              No JSON-LD found on this page in the last scan.
            </Text>
          )}
        </BlockStack>
      </Card>

      {result.home ? (
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Home page: {result.home.url}
            </Text>
            {result.home.passwordProtected ? (
              <Text as="p" tone="subdued">
                Password protected - not readable.
              </Text>
            ) : result.home.nodes.length ? (
              <BlockStack gap="100">
                {result.home.nodes.map((n, i) => (
                  <InlineStack gap="200" key={i}>
                    <Badge>{n.types.join(", ")}</Badge>
                    {n.id ? (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {n.id}
                      </Text>
                    ) : null}
                  </InlineStack>
                ))}
              </BlockStack>
            ) : (
              <Text as="p" tone="subdued">
                No JSON-LD found on this page in the last scan.
              </Text>
            )}
          </BlockStack>
        </Card>
      ) : null}

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Conflicts
          </Text>
          <ConflictList label="product page" conflicts={result.productConflicts} />
          <Divider />
          <ConflictList label="home page" conflicts={result.homeConflicts} />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            robots.txt
          </Text>
          {result.robots?.fetched ? (
            <>
              {result.robots.disallowsRelevant.length > 0 ? (
                <Banner tone="warning" title="robots.txt disallows a scanned page">
                  <List>
                    {result.robots.disallowsRelevant.map((path) => (
                      <List.Item key={path}>Disallow: {path}</List.Item>
                    ))}
                  </List>
                </Banner>
              ) : (
                <Text as="p" tone="subdued">
                  Neither scanned page matched a Disallow rule in robots.txt
                  as fetched during the last scan.
                </Text>
              )}
            </>
          ) : (
            <Text as="p" tone="subdued">
              robots.txt could not be fetched during the last scan.
            </Text>
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Canonical tags
          </Text>
          <List>
            {[
              { label: "product page", page: result.product },
              { label: "home page", page: result.home },
            ].map(({ label, page }) => (
              <List.Item key={label}>
                {!page || page.passwordProtected
                  ? `${label}: could not be read in the last scan.`
                  : page.canonical
                    ? `${label}: canonical points to ${page.canonical}.`
                    : `${label}: no canonical tag found.`}
              </List.Item>
            ))}
          </List>
        </BlockStack>
      </Card>

      {result.watchChanges && result.watchChanges.length > 0 ? (
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Weekly watch
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Recorded automatically once a week, comparing this scan to the
              previous one. Nothing here is fixed automatically.
            </Text>
            <List>
              {result.watchChanges.map((c, i) => (
                <List.Item key={i}>{formatSeoWatchLine(c)}</List.Item>
              ))}
            </List>
          </BlockStack>
        </Card>
      ) : null}
    </BlockStack>
  );
}

function FindingsCard({
  themeScan,
  result,
  richResultsUrl,
  busy,
}: {
  themeScan: any;
  result: ThemeScanResult | undefined;
  richResultsUrl: string | undefined;
  busy: boolean;
}) {
  const findings = buildFindings(result);
  const scannedAt = themeScan?.scannedAt ? new Date(themeScan.scannedAt).toLocaleString() : null;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              What we found to fix
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              We fetch a published product page and the home page from
              outside the store, the same way a crawler would, and list every
              problem the last scan actually found - never a guess.
            </Text>
          </BlockStack>
          <Form method="post">
            <input type="hidden" name="intent" value="scan" />
            <Button submit loading={busy}>
              {themeScan ? "Scan again" : "Scan now"}
            </Button>
          </Form>
        </InlineStack>

        {!themeScan ? (
          <Text as="p" tone="subdued">
            Not scanned yet. Scanning reads the product page and the home
            page once, the same way a crawler would, and nothing is written
            to your store.
          </Text>
        ) : result?.passwordProtected ? (
          <Banner tone="warning">
            The storefront answered with the password page, so the last scan
            could not check for problems. Development stores always have
            this on.
          </Banner>
        ) : findings.length === 0 ? (
          <Text as="p" tone="subdued">
            {`No problems found in the last scan, ${scannedAt}.`}
          </Text>
        ) : (
          <BlockStack gap="300">
            {findings.map((f) => (
              <InlineStack key={f.key} gap="200" blockAlign="start" wrap={false}>
                <Box paddingBlockStart="050">
                  <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                </Box>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm">
                    {f.text}
                  </Text>
                  {f.fixHref ? (
                    <a href={f.fixHref}>
                      <Text as="span" variant="bodySm">
                        Fix it
                      </Text>
                    </a>
                  ) : null}
                </BlockStack>
              </InlineStack>
            ))}
          </BlockStack>
        )}

        {richResultsUrl ? (
          <Box>
            <Button url={richResultsUrl} target="_blank" variant="plain">
              Open Google's Rich Results Test
            </Button>
          </Box>
        ) : null}
      </BlockStack>
    </Card>
  );
}

/**
 * Storefront password entry. scanStorefront/scanPage already know how to
 * post it to /password and unlock a session - they just never had anywhere
 * to read a saved value from, so every scan on a password-protected store
 * reported the password wall. A Shopify development store cannot turn
 * password protection off at all (Shopify does not offer that toggle on
 * dev stores), so this is the only way this app can ever scan one; a store
 * that has not launched yet carries the same wall on purpose, and this
 * field does not suggest removing it.
 *
 * The value never comes back from the loader and is never set as the
 * input's value - only whether one is saved is shown, the same way any
 * other password field works.
 */
function StorefrontPasswordCard({
  hasPassword,
  busy,
}: {
  hasPassword: boolean;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd">
          Storefront password
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          A store that has not launched yet is behind a password, and
          without it we cannot see what the store publishes.
        </Text>
        <Text as="p" variant="bodySm">
          {hasPassword ? "A password is saved." : "No password saved yet."}
        </Text>
        <Form method="post" onSubmit={() => setValue("")}>
          <input type="hidden" name="intent" value="seo_save_password" />
          <InlineStack gap="200" blockAlign="end" wrap>
            <div style={{ minWidth: 260 }}>
              <TextField
                label="Storefront password"
                labelHidden
                name="storefront_password"
                type="password"
                autoComplete="off"
                value={value}
                onChange={setValue}
                placeholder={
                  hasPassword ? "Replace the saved password" : "Enter the storefront password"
                }
              />
            </div>
            <Button submit loading={busy} disabled={value.trim() === ""}>
              {hasPassword ? "Replace" : "Save"}
            </Button>
          </InlineStack>
        </Form>
        {hasPassword ? (
          <Form method="post">
            <input type="hidden" name="intent" value="seo_clear_password" />
            <Button submit variant="plain" tone="critical" loading={busy}>
              Clear saved password
            </Button>
          </Form>
        ) : null}
      </BlockStack>
    </Card>
  );
}

function TermGapCard({ report }: { report: SeoQueue | null }) {
  const rows = report?.termGap ?? [];
  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">
            What your descriptions say that your titles do not
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Terms your product descriptions use that appear in no product
            title and no meta field, counted from your own catalogue text.
            Not a keyword tool - we have no search volume and no ranking
            data, so nothing here is a recommendation.
          </Text>
        </BlockStack>

        {!report ? (
          <Text as="p" tone="subdued">
            Run Preview on the listing below to compute this from your
            catalogue.
          </Text>
        ) : rows.length === 0 ? (
          <Text as="p" tone="subdued">
            No gap terms found in the last check - every meaningful term in
            your descriptions also appears in a title or a meta field.
          </Text>
        ) : (
          <BlockStack gap="150">
            {rows.slice(0, 12).map((r) => (
              <Text as="p" variant="bodySm" key={r.term}>
                <Text as="span" fontWeight="semibold">
                  {r.term}
                </Text>
                {` - used in ${r.productCount} description${r.productCount === 1 ? "" : "s"}, in no title and no meta field.`}
              </Text>
            ))}
          </BlockStack>
        )}

        <Text as="p" tone="subdued" variant="bodySm">
          Nothing here applies automatically. Renaming a product is your
          decision, and changing a handle breaks existing links unless a
          redirect is created.
        </Text>
      </BlockStack>
    </Card>
  );
}

type JobRunLike = {
  id: string;
  status: string;
  progress: number;
  total: number;
  report: unknown;
  finishedAt: string | null;
} | null;

/**
 * The review-and-apply action for meta titles and meta descriptions
 * (SEO-WORKSPACE-PRD §3.5), reshaped to mirror the AI dashboard's action-card
 * pattern: a subtitle stating the method, then a preview button beside a
 * primary button naming the real count. Progress lives in the JobRun rows
 * passed down from the loader - queueJob for the read-only build, applyJob
 * for the write pass - never in local component state, so a closed tab or a
 * refresh loses nothing.
 *
 * Review before write is never bypassed: the primary button stays disabled
 * until a preview has produced rows to select from, and every row it will
 * write is listed with a checkbox before the button can do anything.
 */
function SeoListingsCard({
  queueJob,
  applyJob,
  collections,
}: {
  queueJob: JobRunLike;
  applyJob: JobRunLike;
  /** The Collections tab's half, read from its own JobRuns (PRD section 2). */
  collections: {
    queueJob: CollectionJobLike;
    applyJob: CollectionJobLike;
    report: CollectionSeoQueue | null;
    stale: boolean;
  };
}) {
  const [tab, setTab] = useState(0);
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const revalidator = useRevalidator();

  const building = queueJob?.status === "queued" || queueJob?.status === "running";
  const applying = applyJob?.status === "queued" || applyJob?.status === "running";
  // The collections jobs poll through this same effect: two intervals on one
  // card would revalidate twice as often for no extra information.
  const collectionsBusy =
    collections.queueJob?.status === "queued" ||
    collections.queueJob?.status === "running" ||
    collections.applyJob?.status === "queued" ||
    collections.applyJob?.status === "running";

  useEffect(() => {
    if (!building && !applying && !collectionsBusy) return;
    const id = setInterval(() => revalidator.revalidate(), 2000);
    return () => clearInterval(id);
  }, [building, applying, collectionsBusy, revalidator]);

  // A queue's report is only trustworthy in status "done" - see
  // seo-queue-metrics.ts. "stale" means an apply reviewed against this exact
  // queue has since finished, so every row and count below is presented as
  // null rather than as data known to be wrong (this is the fix for the bug
  // where a store with all 100 fields written still saw "0 of 50" and rows
  // offering to write already-written fields).
  const report = isQueueUsable(queueJob) ? (queueJob!.report as SeoQueue) : null;
  const queueStale = isQueueStale(queueJob);
  const queueTrouble =
    queueJob && (queueJob.status === "failed" || queueJob.status === "refused")
      ? ((queueJob.report as { error?: string; reason?: string } | null) ?? null)
      : null;
  const applyReport =
    applyJob && applyJob.status !== "queued" && applyJob.status !== "running" && applyJob.status !== "failed"
      ? ((applyJob.report as (SeoApplyReport & { reason?: string }) | null) ?? null)
      : null;
  const applyFailed =
    applyJob && applyJob.status === "failed"
      ? ((applyJob.report as { error?: string } | null) ?? null)
      : null;

  const rows = report?.rows ?? [];
  const rowKey = queueJob?.finishedAt ?? "none";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [showProtected, setShowProtected] = useState(false);
  const PAGE_SIZE = 100;

  // Re-derive the default selection (everything proposed, checked) whenever
  // a fresh build result arrives - stale keys from a previous queue must
  // never linger into a new one.
  useEffect(() => {
    const next = new Set<string>();
    for (const row of rows) {
      if (row.titleSuggestion) next.add(`${row.id}:seo_title`);
      if (row.descriptionSuggestion) next.add(`${row.id}:seo_description`);
    }
    setSelected(next);
    setPage(0);
    // rowKey changes only when a new queue result lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedItems = rows.flatMap((row) => {
    const out: { id: string; field: SeoKey; value: string }[] = [];
    if (row.titleSuggestion && selected.has(`${row.id}:seo_title`)) {
      out.push({ id: row.id, field: "seo_title", value: row.titleSuggestion });
    }
    if (row.descriptionSuggestion && selected.has(`${row.id}:seo_description`)) {
      out.push({ id: row.id, field: "seo_description", value: row.descriptionSuggestion });
    }
    return out;
  });

  const selectedProductCount = new Set(selectedItems.map((item) => item.id)).size;

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function selectAll() {
    const next = new Set<string>();
    for (const row of rows) {
      if (row.titleSuggestion) next.add(`${row.id}:seo_title`);
      if (row.descriptionSuggestion) next.add(`${row.id}:seo_description`);
    }
    setSelected(next);
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Write the missing search listings
        </Text>
        <Tabs
          tabs={[
            { id: "seo-listings-products", content: "Products" },
            { id: "seo-listings-collections", content: "Collections" },
          ]}
          selected={tab}
          onSelect={setTab}
          fitted
        />
      </BlockStack>
      <Box paddingBlockStart="400">
        {tab === 1 ? (
          <SeoCollectionsPanel
            queueJob={collections.queueJob}
            applyJob={collections.applyJob}
            report={collections.report}
            stale={collections.stale}
          />
        ) : (
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="p" tone="subdued">
            Meta titles and meta descriptions condensed from each product's
            own title and description. Nothing is invented, nothing is
            written until you review it below, and anything set by you or
            set outside this app is left alone.
          </Text>
        </BlockStack>

        <InlineStack gap="200">
          <Form method="post">
            <input type="hidden" name="intent" value="seo_build_queue" />
            <Button submit loading={busy && !building} disabled={building || applying}>
              {queueJob ? "Preview again" : "Preview"}
            </Button>
          </Form>

          <Form method="post">
            <input type="hidden" name="intent" value="seo_apply" />
            <input type="hidden" name="queueJobId" value={queueJob?.id ?? ""} />
            {selectedItems.map((item) => (
              <input
                key={`${item.id}:${item.field}`}
                type="hidden"
                name="items"
                value={JSON.stringify(item)}
              />
            ))}
            <Button
              submit
              variant="primary"
              loading={busy && !applying}
              disabled={!report || selectedItems.length === 0 || applying || building}
            >
              {/* Count fields, and name the products separately. A listing has
                  two fields, so labelling fields as "listings" doubles the
                  number the merchant expects to see. */}
              {report
                ? `Write ${selectedItems.length} field${selectedItems.length === 1 ? "" : "s"} on ${selectedProductCount} product${selectedProductCount === 1 ? "" : "s"}`
                : "Write fields"}
            </Button>
          </Form>
        </InlineStack>

        {report ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`${report.checked} products checked. ${report.missingTitle} have no meta title, ${report.missingDescription} have no meta description. ${report.outsideApp} field${report.outsideApp === 1 ? "" : "s"} set outside this app; ${report.editedByYou} field${report.editedByYou === 1 ? "" : "s"} edited by you here; neither is ever touched by a bulk pass.`}
          </Text>
        ) : queueStale ? (
          <Banner tone="info">
            {`The last preview is out of date${queueJob?.finishedAt ? ` (checked ${new Date(queueJob.finishedAt).toLocaleString()})` : ""} - a write completed since it ran, so its proposals and counts are no longer shown. Press Preview again to see what still needs writing.`}
          </Banner>
        ) : (
          <Text as="p" variant="bodySm" tone="subdued">
            Preview reads the whole catalogue and proposes a value for every
            empty, unprotected field; nothing is written by this step.
          </Text>
        )}

        {building ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" />
            <Text as="p" tone="subdued" variant="bodySm">
              {queueJob && queueJob.total > 0
                ? `Reading the catalogue - ${queueJob.progress} of ${queueJob.total} products.`
                : "Starting up..."}
            </Text>
          </InlineStack>
        ) : null}

        {queueTrouble ? (
          <Banner tone="warning">
            {queueTrouble.reason ?? queueTrouble.error ?? "The last preview did not finish."}
          </Banner>
        ) : null}

        {applyFailed ? (
          <Banner tone="critical">
            {`The last write did not finish: ${applyFailed.error ?? "unknown error"}. Nothing beyond what is reported below was written.`}
          </Banner>
        ) : null}

        {applyReport ? (
          <Banner tone={applyReport.refused ? "warning" : "success"}>
            {applyReport.refused
              ? (applyReport.reason ?? "The SEO module was switched off before this write ran. Nothing was written.")
              : `Written: ${applyReport.written}, left alone (protected): ${applyReport.skipped}, already matched: ${applyReport.unchanged}.`}
          </Banner>
        ) : null}

        {applying ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" />
            <Text as="p" tone="subdued" variant="bodySm">
              {applyJob && applyJob.total > 0
                ? `Writing - ${applyJob.progress} of ${applyJob.total} products.`
                : "Starting up..."}
            </Text>
          </InlineStack>
        ) : null}

        {report && rows.length === 0 ? (
          <Text as="p" tone="subdued">
            Nothing to propose right now. Every product either already has
            both fields set or is protected.
          </Text>
        ) : null}

        {rows.length > 0 ? (
          <BlockStack gap="300">
            <InlineStack gap="200">
              <Button size="slim" onClick={selectAll}>
                Select all
              </Button>
              <Button size="slim" onClick={() => setSelected(new Set())}>
                Clear all
              </Button>
            </InlineStack>

            <BlockStack gap="200">
              {pageRows.map((row) => (
                <Box
                  key={row.id}
                  padding="300"
                  borderRadius="200"
                  borderWidth="025"
                  borderColor="border"
                >
                  <BlockStack gap="150">
                    <Text as="p" fontWeight="semibold">
                      {row.title}
                    </Text>
                    {row.titleSuggestion ? (
                      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={selected.has(`${row.id}:seo_title`)}
                          onChange={() => toggle(`${row.id}:seo_title`)}
                        />
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            {row.currentTitle
                              ? `Meta title (currently "${row.currentTitle}")`
                              : "Meta title - not set"}
                          </Text>
                          <Text as="span" variant="bodySm">
                            {row.titleSuggestion}
                          </Text>
                        </BlockStack>
                      </label>
                    ) : null}
                    {row.descriptionSuggestion ? (
                      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={selected.has(`${row.id}:seo_description`)}
                          onChange={() => toggle(`${row.id}:seo_description`)}
                        />
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Meta description - not set
                          </Text>
                          <Text as="span" variant="bodySm">
                            {row.descriptionSuggestion}
                          </Text>
                        </BlockStack>
                      </label>
                    ) : null}
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>

            {pageCount > 1 ? (
              <InlineStack gap="200" blockAlign="center">
                <Button size="slim" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Text as="span" variant="bodySm" tone="subdued">
                  {`Page ${page + 1} of ${pageCount}`}
                </Text>
                <Button
                  size="slim"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </InlineStack>
            ) : null}
          </BlockStack>
        ) : null}

        {report && report.protectedRows.length > 0 ? (
          <BlockStack gap="200">
            <InlineStack>
              <Button variant="plain" onClick={() => setShowProtected((v) => !v)}>
                {`${showProtected ? "Hide" : "Show"} ${report.protectedRows.length} protected field${report.protectedRows.length === 1 ? "" : "s"}`}
              </Button>
            </InlineStack>
            {showProtected ? (
              <List>
                {report.protectedRows.slice(0, 200).map((r, i) => (
                  <List.Item key={`${r.id}:${r.field}:${i}`}>
                    {r.title} -{" "}
                    {r.field === "seo_title" ? "meta title" : "meta description"}: {r.reason}
                  </List.Item>
                ))}
              </List>
            ) : null}
          </BlockStack>
        ) : null}
      </BlockStack>
        )}
      </Box>
    </Card>
  );
}

/**
 * Findings per product (PRD-SEO-PER-PRODUCT section 4, build step 4).
 *
 * One row per check, `count of denominator`, ordered by the count this store
 * actually has. Nothing in this component decides which finding matters -
 * aggregateFindings sorted the rows, and it sorted them by data. That is what
 * makes the same card read correctly on a 50-product fixture, a 20,000-product
 * store, an empty one and one where the nightly page pass has never run.
 *
 * Three things it will not do:
 *  - print a zero for a check that could not run. Those rows read "not yet
 *    read" with their own count, because "we looked and found nothing" and
 *    "nobody has looked" are different sentences (EXPERIENCE-PRD section 2).
 *  - hide the denominator. A count without one is how a number stops meaning
 *    anything.
 *  - print a wall of zeros. Checks that ran and found nothing collapse into
 *    one line, so a clean store reads as clean.
 */
function FindingsPerProductCard({
  aggregate,
  budget,
  blockedBy,
  collectionReport,
  staleSitemap,
}: {
  aggregate: FindingsAggregate;
  budget: number;
  /** The Disallow path that stopped the last nightly pass, or null. */
  blockedBy: string | null;
  /** A6's source. Its denominator is collections, so it is its own row. */
  collectionReport: CollectionSeoQueue | null;
  /** A7's other half: handles the sitemap lists that have no product row. */
  staleSitemap: { handles: string[]; total: number } | null;
}) {
  const clean = cleanSentence(aggregate);
  const found = aggregate.rows.filter((r) => r.state === "found");
  const notYetRead = aggregate.rows.filter((r) => r.state === "notYetRead");
  const notApplicable = aggregate.rows.filter((r) => r.state === "notApplicable");

  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">
            Findings per product
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Every check this app makes about a product, counted over the
            catalogue. The ones that need the product page read are counted
            over the pages read so far, never over the whole catalogue.
          </Text>
        </BlockStack>

        <Text as="p" variant="bodySm">
          {pagesReadSentence(aggregate, budget, blockedBy)}
        </Text>

        {aggregate.products === 0 ? (
          <Text as="p" tone="subdued">
            No products have been read into this table yet. It fills on the
            next catalogue pass - run Fill catalogue from the dashboard.
          </Text>
        ) : (
          <BlockStack gap="200">
            {found.map((row) => (
              <InlineStack key={row.code} align="space-between" blockAlign="center" wrap={false}>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm">
                    {row.label}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {row.source === "A"
                      ? "From the catalogue read."
                      : "From reading the product page."}
                  </Text>
                  {/* The method line: where a threshold comes from, in the
                      source's own words. PRD-SEO-FULL-ONPAGE section 3 asks
                      for it by name on B10 and B11, so that a change to what
                      Google says changes this line and nothing else. */}
                  {CHECK_METHOD[row.code] ? (
                    <Text as="p" tone="subdued" variant="bodySm">
                      {CHECK_METHOD[row.code]}
                    </Text>
                  ) : null}
                </BlockStack>
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <Text as="span" fontWeight="semibold">
                    {`${row.count} of ${row.denominator}`}
                  </Text>
                  <Link to={`/app/products?finding=${row.code}`}>
                    <Text as="span" variant="bodySm">
                      See products
                    </Text>
                  </Link>
                </InlineStack>
              </InlineStack>
            ))}

            {notYetRead.map((row) => (
              <InlineStack key={row.code} align="space-between" blockAlign="center" wrap={false}>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm">
                    {row.label}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {row.source === "A"
                      ? "Waiting for the next catalogue pass."
                      : "Waiting for the nightly page read, or the pages answered with the password form."}
                  </Text>
                </BlockStack>
                <Text as="span" tone="subdued">
                  {`Not yet read on ${row.notRead}`}
                </Text>
              </InlineStack>
            ))}

            {/* A6 counts collections, not products, so it carries its own
                denominator and never borrows the catalogue's. */}
            <InlineStack align="space-between" blockAlign="center" wrap={false}>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm">
                  {CHECK_LABEL.A6}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  From the collections check. Counted over collections, not over products.
                </Text>
              </BlockStack>
              <Text
                as="span"
                fontWeight={collectionReport ? "semibold" : undefined}
                tone={collectionReport ? undefined : "subdued"}
              >
                {collectionReport
                  ? `${collectionReport.withFinding} of ${collectionReport.checked}`
                  : "Not checked yet"}
              </Text>
            </InlineStack>

            {notApplicable.map((row) => (
              <InlineStack key={row.code} align="space-between" blockAlign="center" wrap={false}>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm">
                    {row.label}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    This shop has one market, so there are no alternate
                    language versions for a page to declare.
                  </Text>
                </BlockStack>
                <Text as="span" tone="subdued">
                  Not applicable
                </Text>
              </InlineStack>
            ))}

            {staleSitemap && staleSitemap.total > 0 ? (
              <Text as="p" tone="subdued" variant="bodySm">
                {`${staleSitemap.total} URL${staleSitemap.total === 1 ? "" : "s"} in this shop's sitemap point at products that are no longer published: ${staleSitemap.handles.slice(0, 5).join(", ")}${staleSitemap.total > 5 ? ", and others" : ""}. Shopify owns the sitemap and regenerates it; there is nothing to edit, and the entries drop out on their own.`}
              </Text>
            ) : null}

            {clean ? (
              <Text as="p" tone="subdued" variant="bodySm">
                {clean}
              </Text>
            ) : null}

            {aggregate.couldNotBeRead > 0 ? (
              <Text as="p" tone="subdued" variant="bodySm">
                {`${aggregate.couldNotBeRead} of the ${aggregate.pagesAttempted} pages fetched could not be read as a crawler would read them - a password page, a redirect or an error. Nothing is concluded about those pages.`}
              </Text>
            ) : null}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

/**
 * Structured data, from the aggregate of B1 over every page read rather than
 * from one product page.
 *
 * The failure this replaces, 3 September 2026: the card read one product page
 * and recommended a mode from it. Both pages it fetched that day were the
 * storefront password form, and it reported "No Product node found" as a
 * finding about the theme. A theme can also emit a node on one template and
 * not another, and an app can inject one on some pages and not others - one
 * page cannot see any of that. So Full is recommended only when no scanned
 * page has a theme node, and the card says how many pages that rests on.
 */
function StructuredDataCard({ aggregate }: { aggregate: ThemeNodeAggregate }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd">
          Structured data
        </Text>
        <InlineStack gap="150" blockAlign="center" wrap>
          <Badge
            tone={
              aggregate.verdict === "unknown"
                ? undefined
                : aggregate.verdict === "extend"
                  ? "success"
                  : "attention"
            }
          >
            {aggregate.verdict === "unknown"
              ? "No pages read yet"
              : aggregate.verdict === "extend"
                ? "Extend mode"
                : "Full mode"}
          </Badge>
          <Text as="span" variant="bodySm">
            {themeNodeSentence(aggregate)}
          </Text>
        </InlineStack>
        <Text as="p">{themeNodeAdvice(aggregate)}</Text>
        {aggregate.two > 0 ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {`Two or more Product nodes on ${aggregate.two} page${aggregate.two === 1 ? "" : "s"}: assistants read two products where there is one. Those pages are listed under the "No Product node on the page, or two of them" row above.`}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

export default function Seo() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as any;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [detailOpen, setDetailOpen] = useState(false);

  if (!data.unlocked) {
    return (
      <Page title="SEO">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Not enabled for this shop
            </Text>
            <Text as="p" tone="subdued">
              This screen is part of an operator-configured module. It is not
              part of the standard plan yet.
            </Text>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  const stored = data.themeScan?.detail as any as ThemeScanResult | undefined;
  const queueJob = data.queueJob as any as JobRunLike;
  const report = isQueueUsable(queueJob) ? (queueJob!.report as SeoQueue) : null;
  const scanDate = data.themeScan?.scannedAt
    ? new Date(data.themeScan.scannedAt).toLocaleDateString()
    : null;

  // Metric row (SEO-WORKSPACE-PRD dashboard rebuild): four fractions, each
  // with its method beneath. A missing or failed read never prints as a
  // zero - the tile states what happened instead. seoFieldMetric also covers
  // "stale" (a write consumed this queue since it was built) so the fraction
  // is never shown as current when it is known to be wrong - see
  // seo-queue-metrics.ts.
  const metaDescriptionMetric = seoFieldMetric(queueJob, "description");
  const metaTitleMetric = seoFieldMetric(queueJob, "title");

  let schemaMetric: { value: string; hint: string; tone?: "success" | "critical" | "subdued" };
  let conflictMetric: { value: string; hint: string; tone?: "success" | "critical" | "subdued" };
  if (!data.themeScan || !stored) {
    schemaMetric = { value: "Not scanned yet", hint: "Press Scan now below - nothing is written to your store." };
    conflictMetric = { value: "Not scanned yet", hint: "Press Scan now below - nothing is written to your store." };
  } else if (stored.passwordProtected) {
    schemaMetric = {
      value: "Could not be read",
      hint: "The storefront answered with the password page on the last scan.",
    };
    conflictMetric = {
      value: "Could not be read",
      hint: "The storefront answered with the password page on the last scan.",
    };
  } else {
    const nodeTypeCount = new Set([
      ...(stored.product?.nodes.flatMap((n) => n.types) ?? []),
      ...(stored.home?.nodes.flatMap((n) => n.types) ?? []),
    ]).size;
    const allConflicts = [...(stored.productConflicts ?? []), ...(stored.homeConflicts ?? [])];
    const conflictCount = allConflicts.length;
    // The informational Organization pair (theme's id-less node beside ours)
    // still counts, but it never colours the tile critical on its own.
    const realConflictCount = allConflicts.filter(
      (c) => !organizationPairIsInformational(c),
    ).length;
    schemaMetric = {
      value: String(nodeTypeCount),
      hint: `Distinct JSON-LD types found on the product and home page, scanned ${scanDate}.`,
    };
    conflictMetric = {
      value: String(conflictCount),
      hint: `A node type appearing more than once on the same page, scanned ${scanDate}.`,
      tone: realConflictCount > 0 ? "critical" : undefined,
    };
  }

  return (
    <Page title="SEO" subtitle="Search listings, structured data and what still needs work">
      <BlockStack gap="500">
        {actionData?.error ? <Banner tone="critical">{actionData.error}</Banner> : null}

        <SeoSinceCard before={data.since?.before ?? null} today={data.since?.today ?? null} />

        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <MetricTile label="Meta descriptions" {...metaDescriptionMetric} />
          <MetricTile label="Meta titles" {...metaTitleMetric} />
          <MetricTile label="Schema node types" {...schemaMetric} />
          <MetricTile label="Conflicts" {...conflictMetric} />
        </InlineGrid>

        {data.scan ? (
          <FindingsPerProductCard
            aggregate={data.scan.findings as unknown as FindingsAggregate}
            budget={data.scanBudget}
            blockedBy={data.scanRobotsBlock}
            collectionReport={data.collections.report as unknown as CollectionSeoQueue | null}
            staleSitemap={data.staleSitemap}
          />
        ) : null}

        {data.scan ? (
          <StructuredDataCard
            aggregate={data.scan.themeNodes as unknown as ThemeNodeAggregate}
          />
        ) : null}

        <SeoListingsCard
          queueJob={queueJob}
          applyJob={data.applyJob as any as JobRunLike}
          collections={data.collections as any}
        />

        <TermGapCard report={report} />

        <StorefrontPasswordCard hasPassword={data.hasStorefrontPassword} busy={busy} />

        <FindingsCard
          themeScan={data.themeScan}
          result={stored}
          richResultsUrl={stored?.richResultsUrl}
          busy={busy}
        />

        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Full scan detail
              </Text>
              <Button variant="plain" onClick={() => setDetailOpen((v) => !v)}>
                {detailOpen ? "Hide" : "Show"}
              </Button>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              Every JSON-LD node found on the last scan, robots.txt, canonical
              tags and the weekly watch history - the evidence the cards
              above summarise.
            </Text>
            <Collapsible open={detailOpen} id="seo-full-detail">
              <Box paddingBlockStart="300">
                {!stored || stored.passwordProtected ? (
                  <Text as="p" tone="subdued">
                    {!data.themeScan
                      ? "Not scanned yet."
                      : "The storefront answered with the password page, so nothing could be read in the last scan."}
                  </Text>
                ) : (
                  <SchemaDetail result={stored} />
                )}
              </Box>
            </Collapsible>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
