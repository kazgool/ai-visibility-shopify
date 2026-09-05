// Everything the merchant SEO dashboard draws, with the loader left behind in
// app/routes/app.seo_.dashboard.tsx.
//
// Its own module rather than a function inside the route, and the reason is
// the acceptance row of PRD-SEO-FULL-ONPAGE section 5: "every count on the
// card is asserted on the rendered string, not only on the aggregate". A route
// module imports `authenticate` from shopify.server, which cannot be loaded in
// a test at all, so a screen living inside one can only ever be asserted
// through the functions it calls - and the whole failure this screen is
// written against is a set of correct functions rendering a wrong sentence.
// This file imports Polaris and the pure services and nothing else, so a test
// renders it with renderToStaticMarkup on all five shapes of store and reads
// what a merchant would read. Same reason SeoSinceCard.tsx exists.
//
// It assembles no counts of its own. Every figure it places comes from
// seo-readiness.ts, seo-aggregate.ts or seo-since.ts.
//
// The vocabulary rule this screen keeps: nothing here uses the words a search
// specification uses, and a check code never appears. seo-findings.ts says why
// at OWNER_LABEL, and seo-readiness.test.ts asserts it.

import { useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  Divider,
  InlineGrid,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import {
  pagesReadSentence,
  type CheckRow,
  type FindingsAggregate,
  type ThemeNodeAggregate,
} from "../services/seo-aggregate";
import type { CollectionSeoQueue } from "../services/seo-collections.server";
import { dialArc } from "../services/report-metrics";
import {
  FINDING_OWNER,
  OWNER_LABEL,
  type FindingCode,
  type FindingOwner,
} from "../services/seo-findings";
import {
  GROUP_WORD,
  PUBLISHED_LABEL,
  columnAccount,
  groupWordFor,
  listingMethod,
  listingReadiness,
  shopWideCrossReference,
  shopWideItems,
  shopWideMethod,
  type GroupView,
  type ListingProperty,
  type Readiness,
  type ReadinessGroup,
} from "../services/seo-readiness";
import {
  NO_SNAPSHOT_SENTENCE,
  OWNER_WRITTEN_LABEL,
  OWNER_WRITTEN_OMISSION_SENTENCE,
  WRITTEN_EMPTY_SENTENCE,
  WRITTEN_NOT_YET_SENTENCE,
  differenceLabel,
  figure,
  formatDay,
  ownerFigureLabel,
  ownerSinceRows,
  sinceHeading,
  sinceMethodLine,
  sinceTable,
  writtenRows,
  type FactsRow,
} from "../services/seo-since";

/**
 * Exactly what the loader returns, declared here rather than inferred from it,
 * so this module never reaches into a route and a test can build any of the
 * five stores as a literal.
 */
export type SeoDashboardData =
  | { unlocked: false }
  | {
      unlocked: true;
      domain: string;
      findings: FindingsAggregate;
      themeNodes: ThemeNodeAggregate;
      readiness: Readiness;
      budget: number;
      blockedBy: string | null;
      since: { before: FactsRow | null; today: FactsRow | null };
      business: { deliveryStated: boolean; returnsStated: boolean } | null;
      blogPosts: { read: number; withoutLinks: number } | null;
      collections: CollectionSeoQueue | null;
      published: {
        at: string | null;
        reasons: { nodeType: string; emitted: boolean; reason: string | null }[];
      };
    };

// ---------------------------------------------------------------------------
// Colour, drawn by hand. No chart library, from a CDN or otherwise.
// ---------------------------------------------------------------------------

const COLOUR = {
  good: "#2f9e68",
  merchant: "#d9822b",
  theme: "#6b7f96",
  app: "#9a6fb0",
  track: "#e9e9e9",
  faint: "#8f8f8f",
};

const GROUP_COLOUR: Record<ReadinessGroup, string> = {
  clean: COLOUR.good,
  merchant: COLOUR.merchant,
  theme: COLOUR.theme,
  app: COLOUR.app,
};

function ownerColour(code: string): string {
  const owner = FINDING_OWNER[code as FindingCode] as FindingOwner | undefined;
  return owner ? GROUP_COLOUR[owner] : COLOUR.theme;
}

/** A whole number of percent, or null when there is no denominator to divide by. */
function percentOf(count: number, of: number): number | null {
  if (of <= 0) return null;
  return Math.round((count / of) * 100);
}

// ---------------------------------------------------------------------------
// Small drawings. Every one scales by viewBox, so nothing clips at 375 wide.
// ---------------------------------------------------------------------------

/**
 * A value on its range, drawn as a bullet bar.
 *
 * Every circular gauge on this screen except the hero dial was replaced by one
 * of these on 4 September 2026. NN/g's dashboard research is explicit that
 * gauges mimicking a car dashboard "consume a lot of precious space on a
 * dashboard and are also harder to interpret than linear graphs", and that
 * donut charts are poor at most information-communication tasks; the named
 * replacement for a value on a range is the bullet chart. They also note that
 * most bullet charts wrongly hide the overall range, so the track here is
 * always the full denominator and is always drawn, including at zero.
 *
 * The hero dial stays, and stays alone: it carries one share and is the
 * anchor of the screen.
 */
function Bar({
  count,
  of,
  colour,
  label,
  height = 10,
}: {
  count: number | null;
  of: number | null;
  colour: string;
  /** What a screen reader is told. The figure is always printed beside it too. */
  label: string;
  height?: number;
}) {
  const share =
    count === null || of === null || of <= 0 ? 0 : Math.max(0, Math.min(1, count / of));
  return (
    <div
      role="img"
      aria-label={label}
      style={{
        background: COLOUR.track,
        borderRadius: height / 2,
        height,
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${share === 0 ? 0 : Math.max(share * 100, 1.5)}%`,
          background: colour,
          borderRadius: height / 2,
          height,
        }}
      />
    </div>
  );
}

/**
 * One headline tile. The count is the large figure, the range is under it, and
 * the bar is the same two numbers drawn - never a percentage on its own.
 */
function Kpi({
  count,
  of,
  colour,
  value,
  label,
  denominator,
}: {
  count: number | null;
  of: number | null;
  colour: string;
  value: string;
  label: string;
  denominator: string;
}) {
  const percent = count === null || of === null ? null : percentOf(count, of);
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="baseline" wrap>
          <Text as="p" variant="headingLg" numeric>
            {value}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued" numeric>
            {denominator}
            {percent === null ? "" : ` (${percent}%)`}
          </Text>
        </InlineStack>
        <Text as="p" variant="bodySm">
          {label}
        </Text>
        <Bar count={count} of={of} colour={colour} label={`${value} ${label}, ${denominator}`} />
      </BlockStack>
    </Card>
  );
}

/**
 * The half-circle dial: the one circular element left on the screen, and the
 * anchor of it.
 *
 * Its denominator is the catalogue, not the read set. With the read set under
 * it, a shop of 50 products whose first 12 pages had been read showed "100%"
 * and "12 of 12 products" - true arithmetic, and from two metres away it says
 * the shop is finished. The products nobody has checked yet are a segment of
 * the bar beside it and part of this denominator, so the headline cannot read
 * as complete while products remain unexamined.
 */
function HeroDial({ clean, catalogue }: { clean: number; catalogue: number }) {
  const readSet = catalogue;
  const percent = percentOf(clean, readSet) ?? 0;
  const arc = dialArc(percent, 85, 110, 130);
  return (
    <svg
      viewBox="0 0 220 152"
      width="100%"
      style={{ maxWidth: 250 }}
      role="img"
      aria-label={`${clean} of ${readSet} products have nothing of their own to fix`}
    >
      <path
        d="M 25 130 A 85 85 0 0 1 195 130"
        fill="none"
        stroke="#ededed"
        strokeWidth="20"
        strokeLinecap="round"
      />
      {percent > 0 ? (
        <path d={arc.d} fill="none" stroke={COLOUR.good} strokeWidth="20" strokeLinecap="round" />
      ) : null}
      <text
        x="110"
        y="114"
        textAnchor="middle"
        fontSize="40"
        fontWeight="700"
        fill="#1f1f1f"
      >
        {clean}
      </text>
      <text x="110" y="136" textAnchor="middle" fontSize="12.5" fill="#5c5c5c">
        {`of ${readSet} products`}
      </text>
    </svg>
  );
}

/**
 * The four groups plus the products nobody has fully checked yet, as one bar
 * over the catalogue, with a legend that names every segment in words.
 *
 * The legend is not decoration. Colour reinforces and never carries: a reader
 * who cannot separate the orange from the grey has to be able to read the same
 * five numbers, so each one is printed with its name beside it.
 */
function Segments({ readiness }: { readiness: Readiness }) {
  const of = readiness.products;
  if (of === 0) return null;
  const parts: { key: string; count: number; colour: string; name: string }[] = [
    ...readiness.groups.map((g) => ({
      key: g.group,
      count: g.count,
      colour: GROUP_COLOUR[g.group],
      name: GROUP_WORD[g.group],
    })),
    {
      key: "notChecked",
      count: readiness.notChecked,
      colour: COLOUR.track,
      name: "Not checked yet",
    },
  ].filter((p) => p.count > 0);
  if (parts.length === 0) return null;
  return (
    <BlockStack gap="200">
      <div
        style={{ display: "flex", width: "100%", borderRadius: 6, overflow: "hidden", height: 18 }}
      >
        {parts.map((p) => (
          <div
            key={p.key}
            style={{ width: `${(p.count / of) * 100}%`, background: p.colour, height: 18 }}
            title={`${p.count} ${p.name}`}
          />
        ))}
      </div>
      <BlockStack gap="050">
        {parts.map((p) => (
          <InlineStack key={p.key} align="space-between" blockAlign="center" gap="200" wrap>
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: p.colour,
                  flex: "0 0 auto",
                }}
              />
              <Text as="span" variant="bodySm">
                {p.name}
              </Text>
            </InlineStack>
            <Text as="span" variant="bodySm" numeric>
              {`${p.count} of ${of}`}
            </Text>
          </InlineStack>
        ))}
      </BlockStack>
    </BlockStack>
  );
}

/**
 * One row of the findings columns: label, whose it is in words, the count of
 * its denominator, and the bar.
 *
 * The group is printed and not only coloured. Up to 8 percent of men have some
 * form of colour blindness, and until 4 September 2026 the bar's hue was the
 * only thing on the row saying whether the merchant, the theme or this app had
 * to move.
 */
function FindingBar({ row }: { row: CheckRow }) {
  return (
    <BlockStack gap="100">
      <InlineStack align="space-between" blockAlign="start" gap="200" wrap>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <Text as="span" variant="bodySm">
            {OWNER_LABEL[row.code]}
          </Text>
        </div>
        <InlineStack gap="200" blockAlign="center" wrap>
          <Text as="span" variant="bodySm" tone="subdued">
            {groupWordFor(row.code)}
          </Text>
          <Text as="span" variant="bodySm" numeric>
            {`${row.count} of ${row.denominator}`}
          </Text>
        </InlineStack>
      </InlineStack>
      <Bar
        count={row.count}
        of={row.denominator}
        colour={ownerColour(row.code)}
        height={6}
        label={`${OWNER_LABEL[row.code]}: ${row.count} of ${row.denominator}, ${groupWordFor(row.code)}`}
      />
    </BlockStack>
  );
}

/**
 * What stands where the figure would be, when there is no figure.
 *
 * Three different absences, and they are not the same sentence: one row is
 * deliberately not published, two are waiting on a field the merchant has not
 * filled in, and three are waiting on the next catalogue pass. Printing "not
 * published" for all of them told a merchant their brand was not being
 * published when it simply had not been counted yet.
 */
function missingWord(property: ListingProperty): string {
  if (property.basis === "notPublished") return "not published";
  if (property.basis === "fromBusiness") return "not filled in yet";
  return "not counted yet";
}

/** One row on the Google card. A property nobody measured is a sentence. */
function ListingBar({ property }: { property: ListingProperty }) {
  const measured = property.have !== null && property.of !== null;
  const complete = measured && property.of! > 0 && property.have === property.of;
  return (
    <BlockStack gap="100">
      <InlineStack align="space-between" blockAlign="start" gap="200" wrap>
        <div style={{ flex: "1 1 160px", minWidth: 0 }}>
          <Text as="span" variant="bodySm">
            {property.label}
          </Text>
        </div>
        <InlineStack gap="200" blockAlign="center" wrap>
          <Text as="span" variant="bodySm" tone="subdued">
            {property.requirement}
          </Text>
          <Text as="span" variant="bodySm" numeric>
            {measured ? `${property.have} of ${property.of}` : missingWord(property)}
          </Text>
        </InlineStack>
      </InlineStack>
      <Bar
        count={property.have}
        of={property.of}
        colour={complete ? COLOUR.good : COLOUR.merchant}
        height={6}
        label={`${property.label}, ${property.requirement}: ${
          measured ? `${property.have} of ${property.of}` : missingWord(property)
        }`}
      />
    </BlockStack>
  );
}

function Method({ children }: { children: React.ReactNode }) {
  return (
    <Text as="p" variant="bodySm" tone="subdued">
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// The four expandable groups
// ---------------------------------------------------------------------------

function GroupPanel({ view }: { view: GroupView }) {
  const [open, setOpen] = useState(false);
  const hasSteps = view.rows.length > 0;
  return (
    <Box
      padding="300"
      borderWidth="025"
      borderColor="border"
      borderRadius="200"
      background="bg-surface"
    >
      <BlockStack gap="200">
        {/* Wraps rather than holding one line: at 375 wide inside the admin
            iframe a fixed row squeezes the disclosure button off the edge,
            and Built for Shopify 4.1.2 fails a collapsed section with no way
            to expand it. */}
        <InlineStack gap="300" blockAlign="center" wrap>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 5,
              background: GROUP_COLOUR[view.group],
              flex: "0 0 auto",
            }}
          />
          <Text as="span" variant="headingLg" numeric>
            {view.count}
          </Text>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <BlockStack gap="050">
              <Text as="p" variant="headingSm">
                {view.title}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {view.summary}
              </Text>
            </BlockStack>
          </div>
          {hasSteps ? (
            <Button
              variant="plain"
              disclosure={open ? "up" : "down"}
              onClick={() => setOpen((v) => !v)}
              ariaExpanded={open}
              ariaControls={`group-${view.group}`}
            >
              {open ? "Hide the steps" : "What to do"}
            </Button>
          ) : null}
        </InlineStack>

        {hasSteps ? (
          <Collapsible
            open={open}
            id={`group-${view.group}`}
            transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
          >
            <BlockStack gap="300">
              <Divider />
              {view.rows.map((row, index) => (
                <BlockStack gap="100" key={row.code}>
                  <Text as="p" variant="bodySm">
                    <b>{`${index + 1}. ${row.count} of ${row.denominator}: ${row.label.toLowerCase()}.`}</b>
                    {` ${row.what}`}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {row.where}
                  </Text>
                </BlockStack>
              ))}
              <Text as="p" variant="bodySm" tone="subdued">
                {view.foot}
              </Text>
            </BlockStack>
          </Collapsible>
        ) : null}
      </BlockStack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function SeoDashboardScreen({ data }: { data: SeoDashboardData }) {
  if (!data.unlocked) {
    return (
      <Page title="SEO">
        <Card>
          <Text as="p">
            This screen is not enabled for this shop. It is part of the SEO module, which is
            switched on per shop.
          </Text>
        </Card>
      </Page>
    );
  }

  const {
    domain,
    findings,
    themeNodes,
    readiness,
    budget,
    blockedBy,
    since,
    business,
    blogPosts,
    collections,
    published,
  } = data;

  const before = since.before;
  const today = since.today;
  const listing = listingReadiness(
    today
      ? {
          products: today.products,
          withVendor: today.withVendor,
          withImage: today.withImage,
          withBarcode: today.withBarcode,
        }
      : null,
    business,
    // One source for "has the catalogue been read": the rows this screen
    // counts everything else from. The card used to answer it from whether a
    // snapshot row existed, so a shop with 50 rows read and no snapshot yet
    // was told in one card that its catalogue had been read and in the next
    // that it had not.
    findings.bulkRead,
  );
  const wide = shopWideItems(readiness, {
    deliveryStated: business ? business.deliveryStated : null,
    returnsStated: business ? business.returnsStated : null,
    barcode: today ? { have: today.withBarcode, of: today.products } : null,
    catalogue: today ? today.products : findings.bulkRead > 0 ? findings.bulkRead : null,
    publishedReasons: published.reasons.length > 0 ? published.reasons : null,
  });

  const dayNumber =
    before && before.takenAt
      ? Math.max(
          1,
          Math.floor((Date.now() - new Date(before.takenAt).getTime()) / 86400000) + 1,
        )
      : null;

  const headerParts = [
    domain,
    readiness.readSet > 0
      ? `${readiness.readSet} of ${readiness.products} products fully checked`
      : `${readiness.products} products in the catalogue`,
    readiness.lastPageReadAt
      ? `last page read ${formatDay(readiness.lastPageReadAt)}`
      : "no product page read yet",
    dayNumber !== null ? `day ${dayNumber}` : null,
  ].filter(Boolean) as string[];

  const shopWideSet = new Set<string>(readiness.shopWideCodes);
  const notShopWide = (row: CheckRow) => !shopWideSet.has(row.code);
  const found = findings.rows.filter((r) => r.state === "found").filter(notShopWide);
  const counted = findings.rows.filter((r) => r.state === "counted");
  const catalogueFound = found.filter((r) => r.source === "A");
  const pageFound = found.filter((r) => r.source === "B");

  return (
    <Page title="SEO" subtitle={headerParts.join("  |  ")}>
      <BlockStack gap="400">
        <ReadWarnings
          readiness={readiness}
          findings={findings}
          budget={budget}
          blockedBy={blockedBy}
        />

        {readiness.readSet > 0 ? (
          // Two columns only from lg. The app renders inside the admin iframe,
          // which is roughly 250 to 300 px narrower than the browser window,
          // so a breakpoint chosen against the window puts four tiles side by
          // side in a frame that has room for two.
          <InlineGrid columns={{ xs: 1, sm: 1, md: 2, lg: 4 }} gap="400">
            <Kpi
              count={readiness.clean}
              of={readiness.products}
              colour={COLOUR.good}
              value={String(readiness.clean)}
              label="products with nothing of their own to fix"
              denominator={`of ${readiness.products} in your catalogue`}
            />
            <Kpi
              count={readiness.needSomething}
              of={readiness.products}
              colour={COLOUR.merchant}
              value={String(readiness.needSomething)}
              label="products needing something specific"
              denominator={`of ${readiness.products} in your catalogue`}
            />
            <Kpi
              count={null}
              of={null}
              colour={COLOUR.merchant}
              value={String(wide.length)}
              label="fixes that cover the whole shop"
              denominator="listed once, not per product"
            />
            <Kpi
              count={listing.inPlace}
              of={listing.total}
              colour={COLOUR.good}
              value={String(listing.inPlace)}
              label="details Google asks for, in place"
              denominator={`of ${listing.total}`}
            />
          </InlineGrid>
        ) : null}

        {/* How ready your shop is */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                How ready your shop is
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {readiness.readSet > 0
                  ? `Every one of the ${readiness.readSet} products we have fully checked falls into exactly one of these four.${
                      readiness.notChecked > 0
                        ? ` The other ${readiness.notChecked} are the last band on the bar, and the dial counts them in.`
                        : ""
                    }`
                  : "No product has been fully checked yet, so there is nothing to group. This card fills in as the nightly read works through your catalogue."}
              </Text>
            </BlockStack>

            {readiness.readSet > 0 ? (
              <>
                <InlineGrid columns={{ xs: 1, lg: 2 }} gap="400">
                  <HeroDial clean={readiness.clean} catalogue={readiness.products} />
                  <BlockStack gap="200">
                    <Segments readiness={readiness} />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Each product is counted once, under whoever has to move first.
                    </Text>
                  </BlockStack>
                </InlineGrid>

                <BlockStack gap="200">
                  {readiness.groups.map((view) => (
                    <GroupPanel key={view.group} view={view} />
                  ))}
                </BlockStack>
              </>
            ) : null}

            <Method>
              A product with several gaps is counted once, in the group of whoever has to move
              first: you, then us, then your theme. This is not a grade and nothing is weighted.
              {readiness.shopWideCodes.length > 0
                ? ` Problems that affect every product equally are not counted here at all, because those are one decision each and not ${readiness.readSet}. ${shopWideCrossReference(readiness, wide, "below")}`
                : " A problem that affected every product equally would be moved out of this card and into the shop-wide one below; today there is none."}{" "}
              The dial is drawn against your whole catalogue, and a product joins one of the four
              groups only once its catalogue row and its live page have both been read.
              {readiness.awaitingPage > 0
                ? ` ${readiness.awaitingPage} of ${readiness.products} ${
                    readiness.awaitingPage === 1 ? "product is" : "products are"
                  } still waiting for a first page read, and ${
                    readiness.awaitingPage === 1 ? "it is" : "they are"
                  } in none of the four groups.`
                : ""}
            </Method>
          </BlockStack>
        </Card>

        {/* Fixes that cover the whole shop */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {wide.length === 0
                  ? "Fixes that cover the whole shop"
                  : `${wide.length} ${wide.length === 1 ? "fix that covers" : "fixes that cover"} the whole shop`}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {/* No blanket denominator. Two of these three rows are facts
                    about the whole catalogue and one is about the pages read,
                    so one number under all of them is wrong for two of them.
                    Each row states its own scope instead. */}
                {wide.length === 0
                  ? "Nothing here today."
                  : "Each of these is here because it affects every product the same way. Each one says what it applies to and the number it was counted over."}
              </Text>
            </BlockStack>

            {wide.map((item, index) => (
              <Box
                key={item.key}
                padding="300"
                borderWidth="025"
                borderColor="border"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  <InlineStack gap="300" blockAlign="start" wrap>
                    <Text as="span" variant="headingMd" numeric tone="subdued">
                      {String(index + 1)}
                    </Text>
                    <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <Text as="p" variant="headingSm">
                        {item.title}
                      </Text>
                    </div>
                    <div style={{ flex: "0 1 auto", minWidth: 0 }}>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.ownerNote}
                      </Text>
                    </div>
                  </InlineStack>
                  <Text as="p" variant="bodySm">
                    {item.what}
                  </Text>
                  {item.why ? (
                    <Text as="p" variant="bodySm">
                      {item.why}
                    </Text>
                  ) : null}
                  <Text as="p" variant="bodySm" tone="subdued">
                    {item.appliesTo}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {item.where}
                  </Text>
                </BlockStack>
              </Box>
            ))}

            <Method>{shopWideMethod(readiness, wide)}</Method>
          </BlockStack>
        </Card>

        {/* What has changed since we started */}
        <SinceCard before={before} today={today} collections={collections} />

        {/* The detail behind the products that need something */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {readiness.needSomething > 0
                  ? `The detail behind those ${readiness.needSomething} products`
                  : "The detail behind each check"}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Every row says whose it is - you, your theme, or us - and the colour repeats it.
              </Text>
            </BlockStack>

            <InlineGrid columns={{ xs: 1, lg: 2 }} gap="500">
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  {findings.bulkRead === 0
                    ? "Found in your Shopify admin - no product has been read yet"
                    : `Found in your Shopify admin - ${findings.bulkRead} products${
                        collections ? `, ${collections.checked} collections` : ""
                      }`}
                </Text>
                {catalogueFound.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Nothing was found on this side.
                  </Text>
                ) : (
                  catalogueFound.map((row) => <FindingBar key={row.code} row={row} />)
                )}
                <CollectionRows collections={collections} />
                <ColumnNotes
                  rows={findings.rows}
                  clean={findings.clean}
                  source="A"
                  shopWideCodes={readiness.shopWideCodes}
                />
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  {findings.pagesRead === 0
                    ? "Found on the live page - no page has been opened yet"
                    : `Found on the live page - ${findings.pagesRead} pages opened`}
                </Text>
                {pageFound.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Nothing was found on this side.
                  </Text>
                ) : (
                  pageFound.map((row) => <FindingBar key={row.code} row={row} />)
                )}
                <BlogRow blogPosts={blogPosts} />
                <ColumnNotes
                  rows={findings.rows}
                  clean={findings.clean}
                  source="B"
                  shopWideCodes={readiness.shopWideCodes}
                />
              </BlockStack>
            </InlineGrid>

            <Method>
              Each bar is measured against the group named at the top of its column, never the
              other one, so a row counting collections says so in its own figure.
              {wide.length > 0 ? ` ${shopWideCrossReference(readiness, wide, "above")}` : ""}{" "}
              A check that could not run says so and never shows as a clean zero.
            </Method>
          </BlockStack>
        </Card>

        {/* Ready for Google's free product listings */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Ready for Google's free product listings
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                The details Google asks a shop to publish about each product.
              </Text>
            </BlockStack>

            {listing.unmeasured ? (
              // One sentence, and no rows at all. The card used to print the
              // same "not read yet" line eleven times: once as a blanket line
              // and once under each of the ten rows.
              <Text as="p" tone="subdued">
                Your products have not been read yet, so none of these has been counted. The first
                read fills this card in.
              </Text>
            ) : (
              <>
                <InlineGrid columns={{ xs: 1, lg: 2 }} gap="400">
                  {listing.properties.map((property) => (
                    <ListingBar key={property.key} property={property} />
                  ))}
                </InlineGrid>
                <ListingNotes properties={listing.properties} />
              </>
            )}

            <Method>{listingMethod(listing)}</Method>
          </BlockStack>
        </Card>

        {/* What search engines and AI read about each product */}
        <PublishedCard
          published={published}
          themeNodes={themeNodes}
        />

        {/* Counted, with no verdict */}
        <CountedCard rows={counted} />
      </BlockStack>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Cards that are long enough to sit on their own
// ---------------------------------------------------------------------------

/**
 * The sentences that have to be read before any figure below them is worth
 * anything: how much of the catalogue has been read at all, and whether the
 * shop's own robots.txt has already decided that nothing will be.
 */
function ReadWarnings({
  readiness,
  findings,
  budget,
  blockedBy,
}: {
  readiness: Readiness;
  findings: FindingsAggregate;
  budget: number;
  blockedBy: string | null;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p">{pagesReadSentence(findings, budget, blockedBy)}</Text>
        {readiness.awaitingPage > 0 && readiness.products > 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`${readiness.awaitingPage} of ${readiness.products} products have been read from your catalogue but their live page has not been opened yet, so they are counted in none of the four groups below. Nothing is claimed about a page nobody has read.`}
          </Text>
        ) : null}
        {findings.couldNotBeRead > 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`${findings.couldNotBeRead} of the pages we asked for did not answer the way a search engine would see them. Those are not counted as clean.`}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

/** A6, A10 and A11 carry the collections denominator, never the catalogue's. */
function CollectionRows({ collections }: { collections: CollectionSeoQueue | null }) {
  if (!collections || collections.checked === 0) {
    return (
      <Text as="p" variant="bodySm" tone="subdued">
        Your collections have not been checked yet, so nothing about them is counted here.
      </Text>
    );
  }
  const rows = (
    [
      { code: "A6", count: collections.withFinding },
      { code: "A10", count: collections.thinDescription?.length ?? 0 },
      { code: "A11", count: collections.thinMembership?.length ?? 0 },
    ] as { code: FindingCode; count: number }[]
  ).filter((r) => r.count > 0);
  if (rows.length === 0) {
    return (
      <Text as="p" variant="bodySm" tone="subdued">
        {`Nothing was found on your ${collections.checked} collections.`}
      </Text>
    );
  }
  return (
    <>
      {rows.map((r) => (
        <FindingBar
          key={r.code}
          row={{
            code: r.code,
            label: OWNER_LABEL[r.code],
            source: "A",
            state: "found",
            count: r.count,
            denominator: collections.checked,
            notRead: 0,
          }}
        />
      ))}
    </>
  );
}

/** B30's denominator is the posts the last pass read, and never the catalogue. */
function BlogRow({
  blogPosts,
}: {
  blogPosts: { read: number; withoutLinks: number } | null;
}) {
  if (!blogPosts || blogPosts.read === 0) return null;
  if (blogPosts.withoutLinks === 0) {
    return (
      <Text as="p" variant="bodySm" tone="subdued">
        {`All ${blogPosts.read} blog posts we read link to at least one product or category.`}
      </Text>
    );
  }
  return (
    <FindingBar
      row={{
        code: "B30",
        label: OWNER_LABEL.B30,
        source: "B",
        state: "found",
        count: blogPosts.withoutLinks,
        denominator: blogPosts.read,
        notRead: 0,
      }}
    />
  );
}

/**
 * The notes under the Google card, each written once.
 *
 * Identical notes are merged and named by the rows they cover: three rows can
 * be waiting on the same catalogue pass, and printing the same sentence three
 * times says nothing the first one did not.
 */
function ListingNotes({ properties }: { properties: ListingProperty[] }) {
  const byNote = new Map<string, string[]>();
  for (const property of properties) {
    if (property.have !== null || !property.note) continue;
    byNote.set(property.note, [...(byNote.get(property.note) ?? []), property.label]);
  }
  if (byNote.size === 0) return null;
  return (
    <BlockStack gap="100">
      {[...byNote.entries()].map(([note, labels]) => (
        <Text as="p" variant="bodySm" tone="subdued" key={note}>
          {`${labels.join(", ")}: ${note}`}
        </Text>
      ))}
    </BlockStack>
  );
}

/**
 * The sentences that replace rows, and the arithmetic that proves none is
 * missing.
 *
 * Checks that found nothing, that have nothing to read yet, that could not
 * run, that do not apply, that state no verdict, that were moved to the
 * shop-wide card, and that count collections or blog posts rather than
 * products. The card used to account for 38 of the 44 codes and say nothing
 * at all about the other six, so a merchant reading "8 found, 28 found
 * nothing" had no way to know whether the rest were fine or never asked.
 * `columnAccount` computes the lines and the arithmetic, and the tests assert
 * that the parts add up on all five stores.
 */
function ColumnNotes({
  rows,
  clean,
  source,
  shopWideCodes,
}: {
  rows: CheckRow[];
  clean: CheckRow[];
  source: "A" | "B";
  shopWideCodes: FindingCode[];
}) {
  const account = columnAccount({ source, rows, clean, shopWideCodes });
  if (account.lines.length === 0) return null;
  return (
    <BlockStack gap="100">
      {account.lines.map((line) => (
        <Text as="p" variant="bodySm" tone="subdued" key={line}>
          {line}
        </Text>
      ))}
    </BlockStack>
  );
}

function SinceCard({
  before,
  today,
  collections,
}: {
  before: FactsRow | null;
  today: FactsRow | null;
  collections: CollectionSeoQueue | null;
}) {
  if (!before) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            What has changed since we started
          </Text>
          <Text as="p" tone="subdued">
            {NO_SNAPSHOT_SENTENCE}
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const table = sinceTable(before, today);
  const rows = ownerSinceRows(table);
  const written = writtenRows(before, today);

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {sinceHeading(before)}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {sinceMethodLine(before, today)}
          </Text>
        </BlockStack>

        <InlineGrid columns={{ xs: 1, lg: 2 }} gap="500">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Then and now
            </Text>
            {rows.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Nothing has moved yet.
              </Text>
            ) : (
              <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Products that have
                  </Text>
                </div>
                <InlineStack gap="300" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Then
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Now
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Change
                  </Text>
                </InlineStack>
              </InlineStack>
            )}
            {rows.length === 0 ? null : (
              rows.map((row) => (
                <InlineStack key={row.key} align="space-between" blockAlign="start" gap="200" wrap>
                  <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                    <Text as="span" variant="bodySm">
                      {ownerFigureLabel(row)}
                    </Text>
                  </div>
                  <InlineStack gap="300" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued" numeric>
                      {figure(row.before, row.beforeDenominator)}
                    </Text>
                    <Text as="span" variant="bodySm" numeric>
                      {row.today === null ? "not read" : figure(row.today, row.todayDenominator)}
                    </Text>
                    <Text as="span" variant="bodySm" numeric>
                      {differenceLabel(row)}
                    </Text>
                  </InlineStack>
                </InlineStack>
              ))
            )}
            {table.unchangedLine ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {table.unchangedLine}
              </Text>
            ) : null}
            {collections ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {`Of your ${collections.checked} collections, ${collections.checked - collections.withFinding} have both a title and a description for Google today. The starting figure for collections was not recorded, so there is no then to compare it with.`}
              </Text>
            ) : null}
          </BlockStack>

          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Written by this app since then
            </Text>
            {written === null ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {WRITTEN_NOT_YET_SENTENCE}
              </Text>
            ) : written.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {WRITTEN_EMPTY_SENTENCE}
              </Text>
            ) : (
              written.map((row) => (
                <InlineStack key={row.key} align="space-between" blockAlign="center" gap="200">
                  <Text as="span" variant="bodySm">
                    {OWNER_WRITTEN_LABEL[row.key] ?? row.label}
                  </Text>
                  <Text as="span" variant="bodySm" numeric>
                    {row.count}
                  </Text>
                </InlineStack>
              ))
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              {OWNER_WRITTEN_OMISSION_SENTENCE}
            </Text>
          </BlockStack>
        </InlineGrid>

        <Method>
          Both columns are counted the same way and every figure carries the number it is out of.
          A figure that nobody measured on the starting date says so and shows no difference,
          because a difference against a number that was never taken is not a difference.
        </Method>
      </BlockStack>
    </Card>
  );
}

/**
 * What the product pages publish about each product.
 *
 * Two denominators, deliberately kept apart and each stated on its own row.
 * The product itself is counted across every page read - that aggregate exists
 * because one page cannot answer the question, and a card that answered it
 * from one page is a bug this app has already had. Everything else comes from
 * the last scan of one product page, which is a sample, and the card says the
 * date it was taken rather than implying a catalogue-wide figure.
 */
function PublishedCard({
  published,
  themeNodes,
}: {
  published: { at: string | null; reasons: { nodeType: string; emitted: boolean; reason: string | null }[] };
  themeNodes: { pagesRead: number; theme: number; none: number; two: number; appOnly: number };
}) {
  const namedKinds = published.reasons.filter((r) => PUBLISHED_LABEL[r.nodeType]);
  const unnamed = published.reasons.length - namedKinds.length;

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            What search engines and AI read about each product
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {themeNodes.pagesRead > 0
              ? `The product itself is counted across all ${themeNodes.pagesRead} pages read. The rest is from one product page.`
              : "No product page has been read yet."}
          </Text>
        </BlockStack>

        {themeNodes.pagesRead === 0 ? (
          <Text as="p" tone="subdued">
            No product page has been read yet, so there is nothing to say about what your pages
            publish. The first read answers this.
          </Text>
        ) : (
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center" gap="200">
              <Text as="span" variant="bodySm">
                The product itself, described by your theme
              </Text>
              <Text as="span" variant="bodySm" numeric>
                {`${themeNodes.theme} of ${themeNodes.pagesRead} pages`}
              </Text>
            </InlineStack>
            {themeNodes.none > 0 ? (
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" variant="bodySm">
                  Pages describing no product at all
                </Text>
                <Text as="span" variant="bodySm" numeric>
                  {`${themeNodes.none} of ${themeNodes.pagesRead} pages`}
                </Text>
              </InlineStack>
            ) : null}
            {themeNodes.two > 0 ? (
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" variant="bodySm">
                  Pages describing two products where there should be one
                </Text>
                <Text as="span" variant="bodySm" numeric>
                  {`${themeNodes.two} of ${themeNodes.pagesRead} pages`}
                </Text>
              </InlineStack>
            ) : null}
          </BlockStack>
        )}

        {namedKinds.length > 0 ? (
          <BlockStack gap="200">
            <Divider />
            <Text as="h3" variant="headingSm">
              {published.at
                ? `On the product page we read on ${formatDay(published.at)}`
                : "On the product page we read"}
            </Text>
            {namedKinds.map((r) => (
              <InlineStack key={r.nodeType} align="space-between" blockAlign="center" gap="200">
                <Text as="span" variant="bodySm">
                  {PUBLISHED_LABEL[r.nodeType]}
                </Text>
                <Badge tone={r.emitted ? "success" : undefined}>
                  {r.emitted ? "published" : "not published"}
                </Badge>
              </InlineStack>
            ))}
            {unnamed > 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {`${unnamed} other ${unnamed === 1 ? "kind" : "kinds"} of detail were looked at and are named only in the operator view, because their names are not words you should have to learn.`}
              </Text>
            ) : null}
          </BlockStack>
        ) : null}

        <Method>
          We add only what your pages leave out, and we reference what your theme already
          publishes rather than repeating it, so assistants read one product and not two. We never
          publish a star rating you did not receive.
        </Method>
      </BlockStack>
    </Card>
  );
}

/**
 * B29 and B32: counts with no target behind them, so they are rendered apart
 * from every row that states a verdict, and as averages per page with the
 * number of pages beside them. A sum across pages would be a number nobody can
 * act on, and neither check names one as a problem.
 */
function CountedCard({ rows }: { rows: CheckRow[] }) {
  const usable = rows.filter((r) => r.count > 0 && r.totals);
  if (usable.length === 0) return null;

  const perPage = (row: CheckRow, key: string): number =>
    row.count > 0 ? (row.totals?.[key] ?? 0) / row.count : 0;

  const links = usable.find((r) => r.code === "B29");
  const scripts = usable.find((r) => r.code === "B32");

  const linkKinds = links
    ? [
        { label: "Category links", value: perPage(links, "collection") },
        { label: "Breadcrumb", value: perPage(links, "breadcrumb") },
        { label: "Related products", value: perPage(links, "related") },
        { label: "Inside the text", value: perPage(links, "inDescription") },
      ].sort((a, b) => b.value - a.value)
    : [];
  const maxLink = Math.max(1, ...linkKinds.map((k) => k.value));

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            Counted, with no verdict
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Numbers worth watching, with no right answer attached.
          </Text>
        </BlockStack>

        <InlineGrid columns={{ xs: 1, lg: 2 }} gap="500">
          {links ? (
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {`Links on a product page, by kind - average over ${links.count} pages`}
              </Text>
              {linkKinds.map((kind) => (
                <BlockStack gap="100" key={kind.label}>
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <Text as="span" variant="bodySm">
                      {kind.label}
                    </Text>
                    <Text as="span" variant="bodySm" numeric>
                      {kind.value.toFixed(1)}
                    </Text>
                  </InlineStack>
                  <div style={{ background: COLOUR.track, borderRadius: 3, height: 6 }}>
                    <div
                      style={{
                        width: `${(kind.value / maxLink) * 100}%`,
                        background: COLOUR.theme,
                        borderRadius: 3,
                        height: 6,
                      }}
                    />
                  </div>
                </BlockStack>
              ))}
              <Text as="p" variant="bodySm" tone="subdued">
                The four kinds overlap and are not a division of the total: a related-products
                block whose links go through a category is counted under both.
              </Text>
            </BlockStack>
          ) : null}

          {scripts ? (
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {`Code your product page loads - average over ${scripts.count} pages`}
              </Text>
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" variant="bodySm">
                  Pieces of code on the page
                </Text>
                <Text as="span" variant="bodySm" numeric>
                  {perPage(scripts, "scripts").toFixed(1)}
                </Text>
              </InlineStack>
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" variant="bodySm">
                  Different places it comes from
                </Text>
                <Text as="span" variant="bodySm" numeric>
                  {perPage(scripts, "origins").toFixed(1)}
                </Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                The places themselves are named per page in the operator view. This card carries
                the totals across every page read, and a name summed across pages would say
                nothing.
              </Text>
            </BlockStack>
          ) : null}
        </InlineGrid>

        <Method>
          We do not tell you what these numbers should be, because nobody credible states a
          target. They are here so you can see when they change.
        </Method>
      </BlockStack>
    </Card>
  );
}
