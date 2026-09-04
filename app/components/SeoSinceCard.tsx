// The "since this engagement began" card (PRD-SEO-FULL-ONPAGE section 1.2).
//
// Its own module rather than a function inside app.seo.tsx, and the reason is
// testability rather than tidiness: a route module imports `authenticate` from
// shopify.server and cannot be loaded in a test at all, so a card living
// inside one can only ever be asserted through the functions it calls. This
// file imports Polaris and the pure seo-since module and nothing else, so a
// test renders it with `renderToStaticMarkup` and asserts on the sentences a
// merchant actually reads - the QA row the per-product wave declined, with its
// reason still standing.
//
// It assembles no counts. Every string it places comes from seo-since.ts.
//
// Rendered at the top of /app/seo for now, so it is visible before the
// dedicated dashboard exists. Build step 5 moves it to /app/seo/dashboard;
// nothing here is written for that position.

import { BlockStack, Button, Card, Divider, InlineStack, Text } from "@shopify/polaris";
import {
  NO_SNAPSHOT_SENTENCE,
  WRITTEN_EMPTY_SENTENCE,
  WRITTEN_NOT_YET_SENTENCE,
  WRITTEN_OMISSION_SENTENCE,
  differenceLabel,
  figure,
  formatDay,
  sinceHeading,
  sinceMethodLine,
  sinceTable,
  writtenRows,
  type FactsRow,
} from "../services/seo-since";

export function SeoSinceCard({
  before,
  today,
}: {
  before: FactsRow | null;
  today: FactsRow | null;
}) {
  if (!before) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Since this engagement began
          </Text>
          <Text as="p" tone="subdued">
            {NO_SNAPSHOT_SENTENCE}
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const table = sinceTable(before, today);
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

        <BlockStack gap="200">
          {table.rows.map((row) => (
            <InlineStack key={row.key} align="space-between" blockAlign="center" gap="200">
              <Text as="span">{row.label}</Text>
              <InlineStack gap="400" blockAlign="center">
                <Text as="span" tone="subdued" numeric>
                  {figure(row.before, row.beforeDenominator)}
                </Text>
                <Text as="span" numeric>
                  {row.today === null ? "not read" : figure(row.today, row.todayDenominator)}
                </Text>
                <Text as="span" numeric tone={row.state === "counted" ? undefined : "subdued"}>
                  {differenceLabel(row)}
                </Text>
              </InlineStack>
            </InlineStack>
          ))}
          {table.unchangedLine ? (
            <Text as="p" tone="subdued">
              {table.unchangedLine}
            </Text>
          ) : null}
        </BlockStack>

        <Divider />

        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Written by this app since then
          </Text>
          {written === null ? (
            <Text as="p" tone="subdued">
              {WRITTEN_NOT_YET_SENTENCE}
            </Text>
          ) : written.length === 0 ? (
            <Text as="p" tone="subdued">
              {WRITTEN_EMPTY_SENTENCE}
            </Text>
          ) : (
            written.map((row) => (
              <InlineStack key={row.key} align="space-between" blockAlign="center" gap="200">
                <Text as="span">{row.label}</Text>
                <InlineStack gap="400" blockAlign="center">
                  <Text as="span" numeric>
                    {row.count}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {row.earliest && row.latest
                      ? `${formatDay(row.earliest)} to ${formatDay(row.latest)}`
                      : ""}
                  </Text>
                </InlineStack>
              </InlineStack>
            ))
          )}
          <Text as="p" variant="bodySm" tone="subdued">
            {WRITTEN_OMISSION_SENTENCE}
          </Text>
        </BlockStack>

        <InlineStack gap="200">
          <Button url="/app/seo/export/since" download target="_blank">
            Take the comparison away (CSV)
          </Button>
          <Button url="/app/seo/export/written" download target="_blank">
            Take the written list away (CSV)
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
