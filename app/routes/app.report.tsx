import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  Checkbox,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Banner,
  Box,
  Button,
  DataTable,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { hasPaidAccess } from "../services/billing.server";
import {
  catalogueQuery,
  DEFAULT_PREFS,
  NEVER_GIVEN_A_PAGE,
  OUT_OF_STOCK_HELP,
  OUT_OF_STOCK_LABEL,
  OUT_OF_STOCK_MEANING,
  TOGGLES_METHOD_LINE,
  UNLISTED_HELP,
  UNLISTED_LABEL,
  WITHDRAWAL_METHOD_LINE,
  type PublishPrefs,
} from "../services/eligibility";
import { prefsFor, savePrefs } from "../services/eligibility.server";
import { enqueue } from "../services/queue.server";
import {
  crawlerHitsForDashboard,
  nonCrawlerTokenHits,
} from "../services/crawler-hits.server";
import { CRAWLER_HIT_RETENTION_DAYS } from "../services/retention";
import { cleanOutput, extractProduct } from "../engine";
import { dictionaryFor, extraStopwordsFor } from "../services/extract.server";
import {
  AI_ASSISTANT_BOTS,
  SEARCH_ENGINE_BOTS,
  READY_FAMILIES,
  PassOn,
  buildFindings,
  crawlerRows,
  depthHistogram,
  depthState,
  detailSummary,
  dialArc,
  hasDepth,
  highlightSpans,
  missingFamilies,
  nothingToActOn,
  passOn,
  readPass,
  readiness,
  type CrawlerRow,
  type Finding,
  type PassState,
  type Segment,
} from "../services/report-metrics";

// Reporting at a glance (PRD-REPORT-SCREEN.md). A read-only screen: it starts
// no job, writes nothing, and every panel names the source it was computed
// from in the same card as the number.
//
// It sits beside the dashboard rather than replacing it. The dashboard's own
// problems are a separate wave, and folding two changes into one makes a
// revert expensive.
//
// The window everywhere on this screen is 30 days because
// CRAWLER_HIT_RETENTION_DAYS is 30: a longer one would show a shortfall
// caused by deletion as a shortfall in traffic. There is deliberately no
// control offering a longer one.

// The same filter the catalogue pass uses, passed in rather than fixed here,
// because the merchant's "include unlisted products" toggle widens it and the
// two must never disagree (section J.4). Without any filter this panel could
// hold up a draft product as the example of what the app does to this shop -
// a product no other panel on the screen counts, because every other panel is
// fed by a pass that never read it.
const EXAMPLE_PRODUCTS = `#graphql
  query ReportExampleProducts($query: String!) {
    products(
      first: 25
      sortKey: UPDATED_AT
      reverse: true
      query: $query
    ) {
      nodes {
        id
        title
        descriptionHtml
      }
    }
  }
`;

type ExampleFact = { k: string; v: string };
type Example = {
  title: string;
  description: string;
  facts: ExampleFact[];
  /** True when the text above was cut to fit the panel. */
  shortened: boolean;
} | null;

/** How much of a description the before-and-after panel shows. */
const EXAMPLE_CHARS = 700;

/** Description text as a reader sees it, so a highlight lands on words and
 * never inside a tag.
 *
 * The block-level tags become spaces first, so two paragraphs do not run into
 * one word, and then the whole thing goes through cleanOutput - the same
 * function every string this app publishes goes through. The hand-written
 * entity list this replaced covered six named entities and no numeric ones, so
 * an imported catalogue's "45 [numeric en dash entity] 50 cm" was rendered literally, and the
 * highlight for the value "45 - 50 cm" could then never be found in it. */
function plainDescription(html: string): string {
  return cleanOutput(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: the same gate as Collections (FREE-TIER-SPEC §3). The route
  // gate in app.tsx already redirects a shop with no subscription, and this
  // check is here because a route gate is an entrance, not a lock: it reads
  // across the whole catalogue and is not part of the free tier.
  const paid = await hasPaidAccess(session.shop, shop?.id, admin.graphql);
  if (!paid) return { paid: false as const };

  const passJob = shop
    ? await db.jobRun.findFirst({
        where: { shopId: shop.id, kind: { in: ["dry_run", "bulk_extract"] } },
        orderBy: { startedAt: "desc" },
      })
    : null;

  const pass = readPass(
    passJob
      ? {
          status: passJob.status,
          report: passJob.report,
          startedAt: passJob.startedAt?.toISOString() ?? null,
          finishedAt: passJob.finishedAt?.toISOString() ?? null,
        }
      : null,
  );

  // The CSV lives at /app/report/export/:table, which has no default export.
  // A loader on a route that renders a component cannot return a file: Remix
  // hands whatever it returns to that component as data. See
  // app.report.export.$table.tsx.

  // Latest verdict per crawler, newest first - one row each, the same read the
  // dashboard does. A crawler with no row is "not checked", never "blocked".
  const checkRows = shop
    ? await db.crawlerCheck.findMany({
        where: { shopId: shop.id },
        orderBy: { checkedAt: "desc" },
        take: 60,
      })
    : [];
  const latestByAgent = new Map<string, { agent: string; cause: string }>();
  for (const c of checkRows) {
    // A row with no cause recorded is not evidence either way, so it is left
    // out and that crawler reads as "not checked" rather than as blocked.
    if (!c.cause) continue;
    if (!latestByAgent.has(c.agent)) latestByAgent.set(c.agent, { agent: c.agent, cause: c.cause });
  }
  const checks = Array.from(latestByAgent.values());

  // CrawlerHit.shopId holds the shop domain, never the Shop row's id.
  const hits = await crawlerHitsForDashboard(session.shop, CRAWLER_HIT_RETENTION_DAYS);
  const tokens = await nonCrawlerTokenHits(session.shop, CRAWLER_HIT_RETENTION_DAYS);

  // One real product, read on demand: its own description on one side, the
  // values that description produced on the other. The one with the most
  // distinct families, because the panel is there to show what the work looks
  // like, and the emptiest product shows nothing.
  // Read before the example, because the example is filtered by it.
  const prefs = shop ? await prefsFor(shop.id) : DEFAULT_PREFS;

  let example: Example = null;
  if (shop) {
    try {
      const res = await admin.graphql(EXAMPLE_PRODUCTS, {
        variables: { query: catalogueQuery(prefs) },
      });
      const json = await res.json();
      const nodes = (json.data?.products?.nodes ?? []) as {
        title: string;
        descriptionHtml: string | null;
      }[];
      const dictionary = await dictionaryFor(shop.id);
      const extraStopwords = await extraStopwordsFor(shop.id);
      let best: Example = null;
      let bestFamilies = 0;
      for (const node of nodes) {
        const description = plainDescription(node.descriptionHtml ?? "");
        if (description === "") continue;
        const facts = extractProduct(node, dictionary, { extraStopwords });
        const families = new Set(facts.map((f) => f.k)).size;
        if (families > bestFamilies) {
          bestFamilies = families;
          // Cut with a visible mark. Without one the text simply stopped, and
          // a value the engine took from beyond the cut appeared on the right
          // with no highlight on the left and nothing to explain why - the
          // method line blamed trimming for something that was our own
          // shortening.
          const shortened = description.length > EXAMPLE_CHARS;
          best = {
            title: node.title,
            description: shortened
              ? `${description.slice(0, EXAMPLE_CHARS).trimEnd()}...`
              : description,
            facts,
            shortened,
          };
        }
      }
      example = best;
    } catch {
      // A product read that fails leaves the panel out rather than showing a
      // staged one.
      example = null;
    }
  }

  // The "What is switched on" card, Plain text pages row. Every row for the
  // shop, with no productId clause: the proxy serves any row by handle and
  // llms.txt lists every row (llms-txt.server.ts), so this is the one count
  // the three can agree on. It used to exclude rows written before the
  // productId column, which llms.txt still listed and the proxy still served,
  // so the card undercounted the public set until the first reconciliation
  // adopted them (PRD-PORT-1.7.8 I.6, "Second render"; QA of 3 September 2026,
  // blocking 3).
  const mirrorCount = shop
    ? await db.mirrorCache.count({ where: { shopId: shop.id } })
    : 0;
  const reconcileJob = shop
    ? await db.jobRun.findFirst({
        where: { shopId: shop.id, kind: "reconcile" },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const reconcile = reconcileJob
    ? {
        status: reconcileJob.status,
        finishedAt: reconcileJob.finishedAt?.toISOString() ?? null,
        report: (reconcileJob.report ?? null) as unknown as {
          skipped?: boolean;
          deleted?: number;
          queued?: number;
          read?: number;
          expected?: number;
        } | null,
      }
    : null;

  return {
    paid: true as const,
    domain: session.shop,
    pass,
    checks,
    hits,
    tokens,
    example,
    prefs,
    mirrorCount,
    reconcile,
    windowDays: CRAWLER_HIT_RETENTION_DAYS,
  };
};

/**
 * The only write this screen makes: the two publishing toggles of section J.
 * Everything else here is read-only, and stays that way.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "Shop not found" };

  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "publish_prefs") {
    return { error: "Unknown action" };
  }

  // ENTITLEMENT: the same shape as app.business.tsx. Hiding the card is not a
  // gate, because the form can be posted directly. Nothing already published
  // is touched by the refusal - and withdrawal itself is never gated, so a
  // shop in this state still loses the page of a product it unpublishes.
  const paid = await hasPaidAccess(session.shop, shop.id, admin.graphql);
  if (!paid) {
    return {
      error:
        "This shop has no active subscription, so these settings are not saved. Nothing already published is touched.",
    };
  }

  // An unchecked checkbox is not submitted at all, which is what makes the
  // absence of the field mean "off" here.
  const next: PublishPrefs = {
    includeOutOfStock: form.get("includeOutOfStock") != null,
    includeUnlisted: form.get("includeUnlisted") != null,
  };

  // One at a time, the same rule the dashboard applies to its own buttons
  // (app._index.tsx). A reconcile is a full catalogue export, Shopify allows
  // one bulk query per shop at a time, and a second POST ten seconds after
  // the first used to create a second JobRun and a second job that failed on
  // that collision and left the card silent (QA of 3 September 2026, wave fix
  // 4). The setting itself is not saved either, so what the checkbox shows is
  // what the running job will apply.
  const active = await db.jobRun.findFirst({
    where: { shopId: shop.id, status: { in: ["queued", "running"] } },
    select: { kind: true },
  });
  if (active) {
    return {
      error:
        active.kind === "reconcile"
          ? "A setting change is still being applied. Wait for it to finish, then save again."
          : "A catalogue job is running. Wait for it to finish, then save again.",
    };
  }

  // Only when something actually moved: a save that changed nothing must not
  // withdraw and re-add every page in the shop.
  const changed = await savePrefs(shop.id, next);
  if (changed) {
    const jobRun = await db.jobRun.create({
      data: { shopId: shop.id, kind: "reconcile", status: "queued" },
    });
    // The jobKey collapses two enqueues before the first runs into one, the
    // way every other enqueue in worker/tasks.ts does; the guard above is
    // what stops the second while the first is running.
    await enqueue(
      "reconcile_mirrors",
      { shopId: shop.id, jobRunId: jobRun.id },
      { jobKey: `reconcile:${shop.id}` },
    );
  }

  return { prefs: next, queued: changed };
};

// ---------------------------------------------------------------------------

const SEVERITY_TONE: Record<Finding["severity"], "critical" | "attention" | "info"> = {
  critical: "critical",
  attention: "attention",
  info: "info",
};

function MethodLine({ children }: { children: React.ReactNode }) {
  return (
    <Text as="p" variant="bodySm" tone="subdued">
      {children}
    </Text>
  );
}

/** The dial. Inline SVG, no library: it carries role="img" and an aria-label
 * stating the same fraction the sighted reader sees, so the number is never
 * only in the picture. */
function Dial({ percent, ready, total }: { percent: number; ready: number; total: number }) {
  const radius = 78;
  const cx = 100;
  const cy = 78;
  // The geometry, including the large-arc flag that is always 0, lives in
  // dialArc() so it can be tested without a browser. See the comment there:
  // the sweep of a semicircle is never 180 degrees or more.
  const arc = dialArc(percent, radius, cx, cy);
  return (
    <svg
      width="150"
      height="88"
      viewBox="0 0 200 92"
      role="img"
      aria-label={`${percent} percent of products are ready: ${ready} of ${total}`}
    >
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="#e3e3e3"
        strokeWidth="13"
        strokeLinecap="round"
      />
      {percent > 0 ? (
        <path
          d={arc.d}
          fill="none"
          stroke="#4a4a4a"
          strokeWidth="13"
          strokeLinecap="round"
        />
      ) : null}
      <text x={cx} y="66" textAnchor="middle" fontSize="32" fontWeight="600" fill="#303030">
        {`${percent}%`}
      </text>
      <text x={cx} y="86" textAnchor="middle" fontSize="11" fill="#616161">
        {`${ready} of ${total} products`}
      </text>
    </svg>
  );
}

function SegmentedBar({
  ready,
  partly,
  nothing,
  total,
}: {
  ready: number;
  partly: number;
  nothing: number;
  total: number;
}) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <svg
      width="100%"
      height="14"
      viewBox="0 0 100 14"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${ready} ready, ${partly} partly ready, ${nothing} with nothing to read, of ${total} products`}
    >
      <rect x="0" y="0" width={pct(ready)} height="14" fill="#3f6a4a" />
      <rect x={pct(ready)} y="0" width={pct(partly)} height="14" fill="#b98900" />
      <rect x={pct(ready) + pct(partly)} y="0" width={pct(nothing)} height="14" fill="#8e0b21" />
    </svg>
  );
}

function LegendDot({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: 2,
        background: colour,
        marginRight: 6,
      }}
    />
  );
}

/** The histogram of how many kinds of detail one product states.
 *
 * The counts are printed above the bars as HTML rather than as SVG <text>: the
 * chart is preserveAspectRatio="none" so it can fill the card at any width, and
 * anything drawn inside it is stretched horizontally by whatever that width
 * turns out to be. A row of divs above the chart, laid out on the same twelve
 * columns as the axis labels below it, puts the number over its own bar without
 * distorting it - and it means the figures are not only in the aria-label,
 * which is where they were. */
function Histogram({ buckets }: { buckets: { label: string; count: number }[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <BlockStack gap="100">
      <InlineStack gap="0" wrap={false}>
        {buckets.map((b) => (
          <div key={b.label} style={{ flex: 1, textAlign: "center" }}>
            <Text as="span" variant="bodySm" tone="subdued">
              {b.count > 0 ? String(b.count) : ""}
            </Text>
          </div>
        ))}
      </InlineStack>
      <svg
        width="100%"
        height="80"
        viewBox={`0 0 ${buckets.length * 10} 80`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Products by number of kinds of detail: ${buckets
          .map((b) => `${b.count} products stating ${b.label}`)
          .join(", ")}`}
      >
        {buckets.map((b, i) => {
          const h = (b.count / max) * 76;
          return (
            <rect
              key={b.label}
              x={i * 10 + 1}
              y={80 - h}
              width="8"
              height={h}
              fill={b.count === max ? "#4a4a4a" : "#c9c9c9"}
            />
          );
        })}
      </svg>
      <InlineStack gap="0" wrap={false}>
        {buckets.map((b) => (
          <div key={b.label} style={{ flex: 1, textAlign: "center" }}>
            <Text as="span" variant="bodySm" tone="subdued">
              {b.label}
            </Text>
          </div>
        ))}
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued">
        Horizontal axis: distinct kinds of detail found on one product, single
        values up to five and then in ranges. Vertical axis: how many products,
        printed above each bar.
      </Text>
    </BlockStack>
  );
}

function MiniBar({ value, max, label }: { value: number; max: number; label: string }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <svg
      width="90"
      height="8"
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <rect x="0" y="0" width="100" height="8" rx="4" fill="#efefef" />
      {width > 0 ? <rect x="0" y="0" width={width} height="8" rx="4" fill="#4a4a4a" /> : null}
    </svg>
  );
}

/** Panel 1 and 2 both refuse to render figures unless the pass is done and
 * carries a per-product distribution. Every other state says which one it is. */
function PassNotReady({ pass, what }: { pass: PassState; what: string }) {
  if (pass.state === "none") {
    return (
      <BlockStack gap="200">
        <Text as="p" tone="subdued">
          No pass has run yet, so {what} has not been measured. Press Preview
          changes on the dashboard - it reads your catalogue and writes nothing.
        </Text>
        <Box>
          <Button size="slim" url="/app">
            Open the dashboard
          </Button>
        </Box>
      </BlockStack>
    );
  }
  if (pass.state === "running") {
    return (
      <Text as="p" tone="subdued">
        A pass is running now. This panel fills in when it finishes; the
        progress is on the dashboard.
      </Text>
    );
  }
  if (pass.state === "failed") {
    return (
      <Banner tone="warning">
        {`${PassOn(pass.when)} failed: ${pass.reason} Nothing here is a measurement of zero - it is a pass that did not finish.`}
      </Banner>
    );
  }
  // An entitlement decision, not a fault. Saying "failed" here would send the
  // merchant looking for a broken thing, and the only thing to look at is the
  // plan.
  if (pass.state === "refused") {
    return (
      <BlockStack gap="200">
        <Text as="p" tone="subdued">
          {`${PassOn(pass.when)} did not run: ${pass.reason} Nothing failed and nothing is wrong with your catalogue.`}
        </Text>
        <Box>
          <Button size="slim" url="/app/plans">
            See the plans
          </Button>
        </Box>
      </BlockStack>
    );
  }
  // A pass that read no product at all. The catalogue filter is named, because
  // "run it again" is useless advice to a shop whose every product is a draft:
  // the next pass reads the same nothing.
  if (depthState(pass.figures) === "no products") {
    return (
      <Text as="p" tone="subdued">
        {`${PassOn(pass.when)} read no products, so ${what} has not been measured. The pass reads only products that are active and published to the Online Store, plus unlisted ones when you include them below; drafts and archived products are left out.`}
      </Text>
    );
  }
  return (
    <Text as="p" tone="subdued">
      {`${PassOn(pass.when)} predates the per-product measurement this panel needs. Run it again and the panel fills in.`}
    </Text>
  );
}

function ReadabilityCard({ pass }: { pass: PassState }) {
  const usable = pass.state === "done" && hasDepth(pass.figures);
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          How much of the shop AI can read
        </Text>
        {!usable ? (
          <PassNotReady pass={pass} what="how much of the shop is readable" />
        ) : (
          (() => {
            const r = readiness(pass.figures.depth);
            return (
              <BlockStack gap="300">
                <InlineStack gap="400" blockAlign="center" wrap>
                  <Dial percent={r.percent} ready={r.ready} total={r.total} />
                  <Box maxWidth="260px">
                    <Text as="p" variant="bodySm">
                      Ready means the product states at least {READY_FAMILIES}{" "}
                      different kinds of detail - size, material, delivery and
                      so on. The figure moves on its own whenever someone
                      writes a real detail into a description.
                      {" "}Nothing is invented to move it.
                    </Text>
                  </Box>
                </InlineStack>

                <SegmentedBar
                  ready={r.ready}
                  partly={r.partly}
                  nothing={r.nothing}
                  total={r.total}
                />

                <InlineStack gap="400" wrap>
                  <Text as="span" variant="bodySm" tone="subdued">
                    <LegendDot colour="#3f6a4a" />
                    {`${r.ready} ready`}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    <LegendDot colour="#b98900" />
                    {`${r.partly} partly ready`}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    <LegendDot colour="#8e0b21" />
                    {`${r.nothing} nothing to read`}
                  </Text>
                </InlineStack>

                <MethodLine>
                  {`Counted from ${passOn(pass.when)}, over ${r.total} products.`}
                </MethodLine>
              </BlockStack>
            );
          })()
        )}
      </BlockStack>
    </Card>
  );
}

function DetailsCard({ pass }: { pass: PassState }) {
  const usable = pass.state === "done" && hasDepth(pass.figures);
  return (
    <Card>
      <BlockStack gap="300">
        {/* Retitled from "Details published so far". This number comes from a
            pass that may have been a dry run, which publishes nothing, and it
            counts values found in the descriptions - including ones sitting on
            a field a person filled in by hand, which are protected and are
            never written. What the figure honestly is, in both cases, is what
            the descriptions state. */}
        <Text as="h2" variant="headingMd">
          Details found in your descriptions
        </Text>
        {!usable ? (
          <PassNotReady pass={pass} what="how many details your descriptions state" />
        ) : (
          (() => {
            const s = detailSummary(pass.figures);
            return (
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="baseline" wrap>
                  <Text as="p" variant="heading2xl">
                    {String(s.values)}
                  </Text>
                  <Box maxWidth="300px">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {`values, taken from ${s.describing} of ${s.sampled} product description${s.sampled === 1 ? "" : "s"}.`}
                      {/* Suppressed when nothing stated anything: "0 per
                          product on average, over the 0 that stated
                          something" is arithmetic about an empty set, and it
                          reads as a fault rather than as a catalogue with
                          nothing in its descriptions yet. */}
                      {s.describing > 0
                        ? ` That is ${s.average} per product on average, over the ${s.describing} that stated something.`
                        : " No description stated anything we can use, so there is no average to take."}
                    </Text>
                  </Box>
                </InlineStack>

                <Histogram buckets={depthHistogram(pass.figures.depth)} />

                <MethodLine>
                  {/* This line used to say "This is a count of values, not of
                      products: one product stating two sizes contributes two",
                      which is arithmetic the engine does not do. extract.ts
                      emits one Fact per kind of detail per product and joins
                      the readings it found inside it, so a product stating two
                      sizes contributes one. Measured on 189 and on 355 real
                      products: no product anywhere produced two values under
                      the same name. */}
                  {`Counted from ${passOn(pass.when)}, over ${s.sampled} products. One value per product per kind of detail, holding every reading of that kind the description gave: a product stating two sizes contributes one size value with both in it, not two. So this total is the same one the histogram above spreads across its bars. The average is the mean, not the median: the two are different numbers on any catalogue with a few very well written pages.`}
                </MethodLine>
              </BlockStack>
            );
          })()
        )}
      </BlockStack>
    </Card>
  );
}

function BeforeAfterCard({ example }: { example: Example }) {
  if (!example || example.facts.length === 0) return null;
  const segments: Segment[] = highlightSpans(
    example.description,
    example.facts.map((f) => f.v),
  );
  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">
            What actually changes on a product page
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Nothing is rewritten - the same words become readable.
          </Text>
        </BlockStack>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">
              Before: the description as written
            </Text>
            <Text as="p" variant="bodySm">
              {segments.map((seg, i) =>
                seg.highlighted ? (
                  <mark key={i} style={{ background: "#ffeec2", color: "#4a3c10" }}>
                    {seg.text}
                  </mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </Text>
          </BlockStack>

          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">
              {`After: ${example.facts.length} readable value${example.facts.length === 1 ? "" : "s"}`}
            </Text>
            <BlockStack gap="100">
              {example.facts.map((f, i) => (
                <Box
                  key={`${f.k}-${i}`}
                  padding="200"
                  borderRadius="200"
                  borderWidth="025"
                  borderColor="border"
                >
                  <InlineStack gap="200" wrap={false}>
                    <Box minWidth="90px">
                      <Text as="span" variant="bodySm" tone="subdued">
                        {f.k}
                      </Text>
                    </Box>
                    <Text as="span" variant="bodySm">
                      {f.v}
                    </Text>
                  </InlineStack>
                </Box>
              ))}
            </BlockStack>
          </BlockStack>
        </InlineGrid>

        <MethodLine>
          {`One product from this catalogue, ${example.title}, read just now with today's dictionary: the richest of the 25 most recently updated products that are active and published. The left column is its own description, the right column is what that description produced.${example.shortened ? ` The description is shortened here to the first ${EXAMPLE_CHARS} characters, marked with "...", so a value taken from further down appears on the right with nothing to highlight on the left.` : ""} A value the engine trimmed on the way out can also fail to be found again in the text, and appears on the right without a highlight for the same reason.`}
        </MethodLine>
      </BlockStack>
    </Card>
  );
}

function FamiliesCard({ pass, showAll }: { pass: PassState; showAll: boolean }) {
  // A pass that read nothing is handed to PassNotReady, which has the sentence
  // for it already: depthState() returns "no products" and it names the
  // catalogue filter. This card used to print "found no kind of detail anywhere
  // in 0 descriptions", which reads as a result about the descriptions when the
  // fact is that there were none to read.
  const usable = pass.state === "done" && pass.figures.sampled > 0;
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          What your descriptions already say
        </Text>
        {!usable ? (
          <PassNotReady pass={pass} what="which kinds of detail your descriptions state" />
        ) : pass.figures.byAttr.length === 0 ? (
          <Text as="p" tone="subdued">
            {`${PassOn(pass.when)} found no kind of detail anywhere in ${pass.figures.sampled} description${pass.figures.sampled === 1 ? "" : "s"}. That is what the descriptions say, not a fault in them.`}
          </Text>
        ) : (
          (() => {
            // One tally under two names. `byAttrProducts` counts products, one
            // per product per family; `byAttr` was documented as a count of
            // values that could exceed the products read, and it is not - the
            // engine emits one Fact per family per product, so the two arrays
            // are identical on every catalogue. Reports written before
            // `byAttrProducts` existed carry the same figure under `byAttr`, so
            // it is read directly rather than shown under a different label.
            // The "(N values)" bracket that used to sit at the end of each row
            // could never render, because it only appeared when the two
            // differed.
            const source = pass.figures.byAttrProducts ?? pass.figures.byAttr;
            const rows = showAll ? source : source.slice(0, 12);
            const max = source[0]?.[1] ?? 1;
            return (
              <BlockStack gap="300">
                <BlockStack gap="100">
                  {rows.map(([name, count]) => (
                    <InlineStack key={name} gap="300" blockAlign="center" wrap={false}>
                      <Box minWidth="140px">
                        <Text as="span" variant="bodySm">
                          {name}
                        </Text>
                      </Box>
                      <MiniBar
                        value={count}
                        max={max}
                        label={`${name}: ${count} of ${pass.figures.sampled} products`}
                      />
                      <Text as="span" variant="bodySm" tone="subdued">
                        {`${count} of ${pass.figures.sampled} products`}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>

                {!showAll && source.length > 12 ? (
                  <Box>
                    <Button variant="plain" url="/app/report?families=all">
                      {`Show all ${source.length}`}
                    </Button>
                  </Box>
                ) : null}

                <MethodLine>
                  {`Counted from your own descriptions in ${passOn(pass.when)}, over ${pass.figures.sampled} products. Each product counts once for a kind of detail however many readings of it the description gives, so no figure here can exceed ${pass.figures.sampled}.`}
                </MethodLine>
              </BlockStack>
            );
          })()
        )}
      </BlockStack>
    </Card>
  );
}

function CrawlerTable({
  rows,
  max,
  windowDays,
}: {
  rows: CrawlerRow[];
  max: number;
  windowDays: number;
}) {
  return (
    <DataTable
      columnContentTypes={["text", "text", "text", "numeric"]}
      headings={[
        "Crawler",
        "Can it get in",
        "Against the busiest",
        `Requests in ${windowDays} days`,
      ]}
      rows={rows.map((r) => [
        <BlockStack key={`${r.bot}-n`} gap="0">
          <Text as="span" variant="bodySm">
            {r.bot}
          </Text>
          {r.hint ? (
            <Text as="span" variant="bodySm" tone="subdued">
              {r.hint}
            </Text>
          ) : null}
        </BlockStack>,
        // "could not tell" is deliberately toneless rather than critical: the
        // check timed out or got an answer it could not read, which says
        // nothing about the store. Colour is never the only signal - the word
        // in the badge says the same thing - and the line under it says what
        // actually happened.
        //
        // "no, your setting" is a warning and not critical for a different
        // reason: nothing is broken and nobody refused anything. The shop's own
        // robots.txt or password wall is doing exactly what it was set to do,
        // and on a store that has not opened yet that is deliberate.
        <BlockStack key={`${r.bot}-a`} gap="050">
          <Box>
            <Badge
              tone={
                r.access === "yes"
                  ? "success"
                  : r.access === "blocked"
                    ? "critical"
                    : r.access === "no, your setting"
                      ? "warning"
                      : undefined
              }
            >
              {r.access}
            </Badge>
          </Box>
          <Text as="span" variant="bodySm" tone="subdued">
            {r.accessDetail}
          </Text>
        </BlockStack>,
        <MiniBar
          key={`${r.bot}-b`}
          value={r.requests}
          max={max}
          label={`${r.bot}: ${r.requests} requests in ${windowDays} days`}
        />,
        `${r.requests} in ${windowDays} days`,
      ])}
    />
  );
}

function CrawlersCard({
  checks,
  hits,
  tokens,
  windowDays,
}: {
  checks: { agent: string; cause: string }[];
  hits: { days: number; total: number; byBot: { bot: string; count: number }[] };
  tokens: { token: string; count: number }[];
  windowDays: number;
}) {
  const assistants = crawlerRows(AI_ASSISTANT_BOTS, hits.byBot, checks);
  const engines = crawlerRows(SEARCH_ENGINE_BOTS, hits.byBot, checks);
  const max = Math.max(1, ...assistants.map((r) => r.requests), ...engines.map((r) => r.requests));

  // No crawler request logged: the sentence explaining why is the whole card
  // body. Rendering it above two tables of zeroes made the explanation look
  // like a footnote to a measurement, and the zeroes look like a finding.
  //
  // The guard used to also require that no control token had been seen, so a
  // shop whose only logged requests carried Google-Extended got fourteen rows
  // reading "0 in 30 days" - exactly what the comment above says not to do,
  // triggered by a fact that has nothing to do with either table. The token
  // block below renders on its own whenever there are tokens.
  const empty = hits.total === 0;

  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">
            Requests to your AI-readable pages
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            A crawler is a program that reads pages without a person watching -
            the ones below fetch text for search engines and AI assistants.
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {`Last ${windowDays} days, successful reads only.`}
          </Text>
        </BlockStack>

        {empty ? (
          <Text as="p" tone="subdued">
            {tokens.length > 0
              ? `No crawler request recorded in the last ${windowDays} days. The only requests logged in that time named a robots.txt control token as their user agent, and those are listed below on their own. These pages are requested by real crawlers once this app's block is switched on in your theme (Online Store, Themes, Customize, App embeds) and products have been processed. We log real requests only and never estimate a number here.`
              : `No request recorded in the last ${windowDays} days. These pages are requested once this app's block is switched on in your theme (Online Store, Themes, Customize, App embeds) and products have been processed. We log real requests only and never estimate a number here.`}
          </Text>
        ) : (
          <>
            <Text as="h3" variant="headingSm" tone="subdued">
              AI assistants
            </Text>
            <CrawlerTable rows={assistants} max={max} windowDays={windowDays} />

            <Text as="h3" variant="headingSm" tone="subdued">
              Search engines
            </Text>
            {/* The reachability check has its own list of crawlers (AGENTS in
                crawler-check.server.ts) and none of these names is on it, so
                their rows read "not checked" for ever. Rather than send six
                more outbound requests on every check, the card says here what
                the column can and cannot answer. Adding a name to AGENTS
                without adding a line like this one is the change to avoid: it
                leaves a column that never fills in and never explains why. */}
            <Text as="p" variant="bodySm" tone="subdued">
              We do not test whether search engines can reach your store, so
              "Can it get in" stays empty for them: Google Search Console and
              Bing Webmaster Tools already answer that from the inside, with
              far better evidence than one request of ours. The counts below
              are real requests to this app's text pages and are unaffected.
            </Text>
            <CrawlerTable rows={engines} max={max} windowDays={windowDays} />
          </>
        )}

        {/* The token block stands on its own. It is not a column of either
            table above and it is added to no total, so whether it renders
            depends only on whether a token was seen - not on whether the
            crawler tables had anything to show. */}
        {empty && tokens.length === 0 ? null : (
          <Text as="h3" variant="headingSm" tone="subdued">
            Names that cannot make requests
          </Text>
        )}
        {tokens.length === 0 ? (
          empty ? null : (
            <Text as="p" variant="bodySm" tone="subdued">
              {`No request in the last ${windowDays} days named a robots.txt control token as its user agent.`}
            </Text>
          )
        ) : (
          <BlockStack gap="100">
            {tokens.map((t) => (
              <InlineStack key={t.token} gap="300" blockAlign="center" wrap={false}>
                <Box minWidth="180px">
                  <Text as="span" variant="bodySm">
                    {t.token}
                  </Text>
                </Box>
                <Text as="span" variant="bodySm" tone="subdued">
                  {`${t.count} request${t.count === 1 ? "" : "s"}`}
                </Text>
              </InlineStack>
            ))}
            <Text as="p" variant="bodySm" tone="subdued">
              A robots.txt control token has no user agent of its own, so
              nothing legitimately makes a request under one of these names.
              Counted here on its own and added to no total on this screen.
            </Text>
          </BlockStack>
        )}

        <Divider />

        <MethodLine>
          {`Counts are successful requests to this app's own text pages in the last ${windowDays} days, from the app's own request log. ${windowDays} days is the whole retention period, so no longer window is offered; the dashboard's crawler card shows the last 7 days, which is why the two screens carry different numbers for the same crawler. "Can it get in" comes from the last reachability check: we asked your storefront for a page once per crawler, from outside Shopify, sending that crawler's own user agent and reading what came back. A crawler that check does not cover says "not checked", and never "blocked".`}
        </MethodLine>

        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              These are requests to the plain text pages, llms.txt and
              agents.md that this app serves, not visits to your themed
              storefront, which Shopify serves directly and this app never
              sees.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              There is no "Google AI Mode" or "Copilot" line here because
              there cannot be one. Google states that AI Overviews and AI Mode
              crawl using the existing Google user agents, and that
              Google-Extended has no user agent of its own. Copilot reads the
              Bing index rather than crawling under its own name. A tool that
              shows an "AI Mode" number is showing a model, not a measurement.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A user agent is a claim the requester makes about itself. This
              app records the name as given and does not check it against the
              crawler owner's network, so treat every count here as
              self-declared.
            </Text>
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}

function FindingsCard({
  findings,
  checked,
  passDone,
  sampled,
}: {
  findings: Finding[];
  checked: boolean;
  passDone: boolean;
  sampled: number;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          What to do, worst first
        </Text>
        {findings.length === 0 ? (
          <Text as="p" tone="subdued">
            {nothingToActOn(checked, passDone, sampled)}
          </Text>
        ) : (
          <BlockStack gap="400">
            {findings.map((f) => (
              <BlockStack key={f.key} gap="150">
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <Badge tone={SEVERITY_TONE[f.severity]}>{f.badge}</Badge>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {f.title}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {f.body}
                </Text>
                {f.paste ? (
                  <Box
                    padding="300"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                    background="bg-surface-secondary"
                  >
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        Send this to whoever runs your server
                      </Text>
                      <Text as="p" variant="bodySm">
                        {f.paste}
                      </Text>
                    </BlockStack>
                  </Box>
                ) : null}
                {f.linkHref ? (
                  <Box>
                    <Button size="slim" url={f.linkHref}>
                      {f.linkText ?? "Open"}
                    </Button>
                  </Box>
                ) : null}
              </BlockStack>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

function WeakestCard({ pass }: { pass: PassState }) {
  const weakest = pass.state === "done" ? pass.figures.weakest : undefined;
  const familyTotal = pass.state === "done" ? pass.figures.byAttr.length : 0;
  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">
            Products worth ten minutes of writing
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Fewest kinds of detail first. Not sorted by sales: that would need
            order data, and never reading orders, customers or payments is one
            of the three promises this app makes.
          </Text>
        </BlockStack>

        {pass.state !== "done" ? (
          <PassNotReady pass={pass} what="which products state the least" />
        ) : !weakest ? (
          <Text as="p" tone="subdued">
            {`${PassOn(pass.when)} did not record a per-product list, so there is nothing here to rank. Run it again and the list fills in.`}
          </Text>
        ) : weakest.length === 0 ? (
          <Text as="p" tone="subdued">
            {`No product was read in ${passOn(pass.when)}, so there is nothing to rank.`}
          </Text>
        ) : familyTotal === 0 ? (
          // Reachable on a real shop: a catalogue whose descriptions are all
          // images produces no family anywhere. The table would then print
          // "0 of 0" in every row, a bar with a zero denominator, and a bare
          // dash under "What is missing", because there is no family for
          // missingFamilies() to name. A sentence is the honest render.
          <Text as="p" tone="subdued">
            {`${PassOn(pass.when)} found no kind of detail in any of the ${pass.figures.sampled} description${pass.figures.sampled === 1 ? "" : "s"} it read, so there is nothing to rank one product against another by and nothing to list as missing. This list fills in once any description states something - a size, a material, a delivery time - written in words rather than shown in an image.`}
          </Text>
        ) : (
          <BlockStack gap="300">
            <DataTable
              columnContentTypes={["text", "text", "text"]}
              headings={["Product", "Kinds of detail found", "What is missing"]}
              rows={weakest.map((w, i) => [
                // The row links to the product wherever the pass recorded an
                // id. A title on its own is a name the merchant then has to go
                // and search for, and after a rename or a deletion it names
                // something that is not there. Reports written before the id
                // was stored still render, as plain text.
                w.id ? (
                  <Link key={`${w.title}-${i}-t`} to={`/app/products/${w.id.split("/").pop()}`}>
                    {w.title}
                  </Link>
                ) : (
                  <Text key={`${w.title}-${i}-t`} as="span" variant="bodySm">
                    {w.title}
                  </Text>
                ),
                <InlineStack key={`${w.title}-${i}-c`} gap="200" blockAlign="center" wrap={false}>
                  <MiniBar
                    value={w.families.length}
                    max={Math.max(1, familyTotal)}
                    label={`${w.title}: ${w.families.length} of ${familyTotal} kinds of detail`}
                  />
                  <Text as="span" variant="bodySm" tone="subdued">
                    {`${w.families.length} of ${familyTotal}`}
                  </Text>
                </InlineStack>,
                missingFamilies(w.families, pass.figures.byAttr).join(", ") || "-",
              ])}
            />
            <MethodLine>
              {`The ten products producing the fewest distinct kinds of detail in ${passOn(pass.when)}, out of ${pass.figures.sampled} read. "Of ${familyTotal}" is the number of kinds this catalogue states anywhere, and "what is missing" names the most common of those that this product does not state.`}
            </MethodLine>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ---------------------------------------------------------------------------

type ReconcileState = {
  status: string;
  finishedAt: string | null;
  report: {
    skipped?: boolean;
    deleted?: number;
    queued?: number;
    read?: number;
    expected?: number;
    /** Set by the worker when withdrawal ran but queueing was withheld. */
    queueingRefused?: string;
    refused?: boolean;
    reason?: string;
    error?: string;
  } | null;
} | null;

/** Same shape as every other date on this screen: the day, plainly. */
function onDay(iso: string | null): string {
  if (!iso) return "an unknown date";
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * What the last toggle change did, read from its JobRun row and never from
 * local state - the row is the source of truth for a job, and the browser
 * forgets on every refresh.
 */
function reconcileSentence(reconcile: ReconcileState): string | null {
  if (!reconcile) return null;
  if (reconcile.status === "queued" || reconcile.status === "running") {
    return "Applying your setting: pages that no longer qualify are being withdrawn.";
  }
  // Every terminal state gets a sentence. A failed or refused job used to
  // render nothing at all, so the checkbox showed its new state beside no
  // word about whether the pages had followed it - the "0 of 50" class from
  // CLAUDE.md (QA of 3 September 2026, wave fix 6).
  if (reconcile.status === "failed") {
    return (
      `The last setting change did not complete on ${onDay(reconcile.finishedAt)}. ` +
      "Your setting is saved; the pages will be brought in line by the next catalogue pass or the weekly check."
    );
  }
  if (reconcile.status === "refused") {
    return (
      (reconcile.report?.reason ?? "The last setting change was refused.") +
      " Pages that no longer qualify are still withdrawn by the weekly check."
    );
  }
  if (reconcile.status !== "done" || !reconcile.report) return null;
  const r = reconcile.report;
  if (r.skipped) {
    const why =
      (r.read ?? 0) > 0 && (r.expected ?? 0) === (r.read ?? 0)
        ? `${r.read} products were read and none qualified under the current settings`
        : `Shopify's catalogue download was short (${r.read ?? 0} of ${r.expected ?? 0} products)`;
    // Under the none-qualified floor the pages of products no longer in the
    // catalogue at all are still withdrawn (5 September 2026); the sentence
    // says how many, so "nothing" is never printed over a non-zero count.
    const withdrawn =
      (r.deleted ?? 0) > 0
        ? `so only the ${r.deleted === 1 ? "page" : `${r.deleted} pages`} of products no longer in the catalogue ${r.deleted === 1 ? "was" : "were"} withdrawn`
        : "so nothing was withdrawn";
    return `${why}, ${withdrawn}. It will be tried again on the next pass or the weekly check.`;
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const base = `${plural(r.deleted ?? 0, "page")} withdrawn, ${plural(r.queued ?? 0, "product")} queued for a page, on ${onDay(reconcile.finishedAt)}.`;
  return r.queueingRefused ? `${base} ${r.queueingRefused}` : base;
}

/**
 * The two toggles, in one form, each with its effect stated beside it rather
 * than in a tooltip.
 *
 * Remounted by its key whenever the loader's values change, so the second
 * render after a save shows what the database holds and not what the browser
 * happened to be holding. Nothing here keeps state across a revalidation.
 */
function PublishPrefsForm({ prefs }: { prefs: PublishPrefs }) {
  const [outOfStock, setOutOfStock] = useState(prefs.includeOutOfStock);
  const [unlisted, setUnlisted] = useState(prefs.includeUnlisted);

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="publish_prefs" />
      <BlockStack gap="300">
        <Checkbox
          label={OUT_OF_STOCK_LABEL}
          helpText={OUT_OF_STOCK_HELP}
          name="includeOutOfStock"
          checked={outOfStock}
          onChange={setOutOfStock}
        />
        <Checkbox
          label={UNLISTED_LABEL}
          helpText={UNLISTED_HELP}
          name="includeUnlisted"
          checked={unlisted}
          onChange={setUnlisted}
        />
        <Text as="p" variant="bodySm" tone="subdued">
          {OUT_OF_STOCK_MEANING}
        </Text>
        <Box>
          <Button submit>Save these settings</Button>
        </Box>
      </BlockStack>
    </Form>
  );
}

/**
 * What is switched on: the Plain text pages row, the two toggles that decide
 * which products get one, and what the last change to them did.
 */
function ModulesCard({
  mirrorCount,
  prefs,
  reconcile,
  error,
}: {
  mirrorCount: number;
  prefs: PublishPrefs;
  reconcile: ReconcileState;
  error?: string;
}) {
  const applied = reconcileSentence(reconcile);
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          What is switched on
        </Text>

        <InlineStack gap="200" blockAlign="center">
          <Text as="h3" variant="headingSm">
            Plain text pages
          </Text>
          <Badge tone="success">On</Badge>
        </InlineStack>

        <Text as="p">
          {mirrorCount > 0
            ? `${mirrorCount} product page${mirrorCount === 1 ? "" : "s"} served. One per public product, at /apps/ai-visibility/<handle>.`
            : "No product page yet. Pages appear as products are processed."}
        </Text>

        {error ? (
          <Banner tone="critical" title="Not saved">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <PublishPrefsForm
          key={`${prefs.includeOutOfStock}-${prefs.includeUnlisted}`}
          prefs={prefs}
        />

        <Text as="p" variant="bodySm">
          {NEVER_GIVEN_A_PAGE}
        </Text>

        {applied ? (
          <Text as="p" variant="bodySm">
            {applied}
          </Text>
        ) : null}

        <MethodLine>{TOGGLES_METHOD_LINE}</MethodLine>
        <MethodLine>{WITHDRAWAL_METHOD_LINE}</MethodLine>
      </BlockStack>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export default function Report() {
  const data = useLoaderData<typeof loader>() as any;

  // Every hook runs before the first return, without exception. The
  // unsubscribed branch below used to come first, so on the render after a
  // shop subscribes React saw a hook that was not there last time and threw
  // "Rendered more hooks than during the previous render" - the component is
  // not remounted by a loader revalidation, so the hook order has to be the
  // same on every pass through it.
  const [searchParams] = useSearchParams();
  const actionData = useActionData<typeof action>() as unknown as
    | { error?: string }
    | undefined;
  const showAll = searchParams.get("families") === "all";

  if (!data.paid) {
    return (
      <Page title="Report">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              This needs a subscription
            </Text>
            <Text as="p" tone="subdued">
              The report reads across your whole catalogue, so it is not part
              of the free tier. Everything already written stays written.
            </Text>
            <Box>
              <Button variant="primary" url="/app/plans">
                See the plans
              </Button>
            </Box>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  const pass = data.pass as PassState;

  const findings = buildFindings({
    checks: data.checks,
    nothingToRead: pass.state === "done" ? pass.figures.none : null,
    sampled: pass.state === "done" ? pass.figures.sampled : null,
    tokens: data.tokens,
    windowDays: data.windowDays,
  });

  const canExport = pass.state === "done";

  return (
    <Page
      title="Reporting at a glance"
      subtitle={`${data.domain} - how much of this shop is readable, what the descriptions say, and who asked for the text pages`}
    >
      {/* Print is the export path the PRD asks for; there is deliberately no
          control that promises a scheduled email, because nothing behind it
          would send one. */}
      <style>{`
        @media print {
          .Polaris-Frame__Navigation, .Polaris-TopBar, .av-report-actions { display: none !important; }
          .Polaris-Card { break-inside: avoid; box-shadow: none; border: 1px solid #ddd; }
        }
      `}</style>

      <BlockStack gap="500">
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <ReadabilityCard pass={pass} />
          <DetailsCard pass={pass} />
        </InlineGrid>

        <BeforeAfterCard example={data.example} />

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <FamiliesCard pass={pass} showAll={showAll} />
          <CrawlersCard
            checks={data.checks}
            hits={data.hits}
            tokens={data.tokens}
            windowDays={data.windowDays}
          />
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <FindingsCard
            findings={findings}
            checked={data.checks.length > 0}
            passDone={pass.state === "done"}
            sampled={pass.state === "done" ? pass.figures.sampled : 0}
          />
          <WeakestCard pass={pass} />
        </InlineGrid>

        <ModulesCard
          mirrorCount={data.mirrorCount}
          prefs={data.prefs}
          reconcile={data.reconcile}
          error={actionData?.error}
        />

        <div className="av-report-actions">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Take this away
              </Text>
              <InlineStack gap="200" wrap>
                <Button onClick={() => window.print()}>Print or save as PDF</Button>
                {/* Resource routes, not a query parameter on this one: see the
                    comment at the top of app.report.export.$table.tsx.
                    target="_blank" is load-bearing - Polaris renders url as a
                    Remix Link, which intercepts the click and asks the router
                    for the route instead of letting the browser fetch the
                    file. */}
                <Button
                  url="/app/report/export/families"
                  target="_blank"
                  disabled={!canExport}
                  download
                >
                  Export the table of details as CSV
                </Button>
                <Button
                  url="/app/report/export/weakest"
                  target="_blank"
                  disabled={!canExport}
                  download
                >
                  Export the weakest products as CSV
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {canExport
                  ? "Both files carry the same figures as the tables above, from the same pass."
                  : "The exports need a finished pass to read from; there is none yet."}
              </Text>
            </BlockStack>
          </Card>
        </div>
      </BlockStack>
    </Page>
  );
}
