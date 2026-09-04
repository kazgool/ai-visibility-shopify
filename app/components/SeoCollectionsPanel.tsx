// The Collections tab of the Search listings card (PRD-SEO-FULL-ONPAGE
// section 2).
//
// Its own module for the same reason SeoSinceCard is: a route cannot be
// imported in a test, so a panel that lives inside one can only be asserted
// through the functions it calls. This file imports Polaris and types, and
// renders strings it is handed.
//
// It is the products tab's shape with one deliberate difference: a collection
// has no facts, so its meta description is condensed from its own description
// text alone, and the panel says so rather than letting a merchant expect the
// attribute clauses a product listing carries.

import { useEffect, useState } from "react";
import { Form, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  InlineStack,
  List,
  Spinner,
  Text,
} from "@shopify/polaris";
import type {
  CollectionSeoQueue,
  CollectionQueueRow,
} from "../services/seo-collections.server";
import type { SeoKey } from "../services/seo.server";

export type CollectionJobLike = {
  id: string;
  status: string;
  progress: number;
  total: number;
  finishedAt: string | null;
  report: unknown;
} | null;

/**
 * A6 as a sentence, from the same report the queue produced.
 *
 * Its denominator is the collections that check read, never the catalogue -
 * the products card's denominators are products, and one number quoted under
 * the other's heading is how a count stops meaning anything (PRD section 2).
 */
export function collectionFindingSentence(report: CollectionSeoQueue | null): string {
  if (!report) {
    return "No collections check has run yet, so nothing is known about collection search listings.";
  }
  if (report.checked === 0) {
    return "This shop has no collections.";
  }
  return (
    `A6: ${report.withFinding} of ${report.checked} collection${report.checked === 1 ? "" : "s"} ` +
    `have a meta title or description absent. ` +
    `${report.missingTitle} have no meta title, ${report.missingDescription} have no meta description. ` +
    `${report.outsideApp} field${report.outsideApp === 1 ? "" : "s"} set outside this app; ` +
    `${report.editedByYou} edited by you here; ` +
    `${report.writtenByApp} written by this app. Neither of the first two is ever touched by a bulk pass.`
  );
}

export function SeoCollectionsPanel({
  queueJob,
  applyJob,
  report,
  stale,
}: {
  queueJob: CollectionJobLike;
  applyJob: CollectionJobLike;
  /** Null when the last queue is not usable - never a report known to be wrong. */
  report: CollectionSeoQueue | null;
  stale: boolean;
}) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const building = queueJob?.status === "queued" || queueJob?.status === "running";
  const applying = applyJob?.status === "queued" || applyJob?.status === "running";

  const rows: CollectionQueueRow[] = report?.rows ?? [];
  const rowKey = queueJob?.finishedAt ?? "none";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showProtected, setShowProtected] = useState(false);

  // Re-derive the default selection whenever a fresh build lands, so keys from
  // a previous queue can never linger into a new one.
  useEffect(() => {
    const next = new Set<string>();
    for (const row of rows) {
      if (row.titleSuggestion) next.add(`${row.id}:seo_title`);
      if (row.descriptionSuggestion) next.add(`${row.id}:seo_description`);
    }
    setSelected(next);
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
    const out: { collectionId: string; field: SeoKey; value: string }[] = [];
    if (row.titleSuggestion && selected.has(`${row.id}:seo_title`)) {
      out.push({ collectionId: row.id, field: "seo_title", value: row.titleSuggestion });
    }
    if (row.descriptionSuggestion && selected.has(`${row.id}:seo_description`)) {
      out.push({
        collectionId: row.id,
        field: "seo_description",
        value: row.descriptionSuggestion,
      });
    }
    return out;
  });

  const selectedCollections = new Set(selectedItems.map((i) => i.collectionId)).size;

  const applyReport =
    applyJob && applyJob.status !== "queued" && applyJob.status !== "running"
      ? (applyJob.report as { written?: number; skipped?: number; unchanged?: number; refused?: boolean; reason?: string; error?: string } | null)
      : null;

  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">
        Meta titles and meta descriptions condensed from each collection's own
        title and description. A collection has no attributes to quote, so its
        description is condensed from its own opening sentence alone. Nothing
        is invented, nothing is written until you review it here, and anything
        set by you or set outside this app is left alone.
      </Text>

      <InlineStack gap="200">
        <Form method="post">
          <input type="hidden" name="intent" value="seo_collection_preview" />
          <Button submit loading={busy && !building} disabled={building || applying}>
            {queueJob ? "Preview again" : "Preview collections"}
          </Button>
        </Form>

        <Form method="post">
          <input type="hidden" name="intent" value="seo_collection_apply" />
          {selectedItems.map((item) => (
            <input
              key={`${item.collectionId}:${item.field}`}
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
            {report
              ? `Write ${selectedItems.length} field${selectedItems.length === 1 ? "" : "s"} on ${selectedCollections} collection${selectedCollections === 1 ? "" : "s"}`
              : "Write fields"}
          </Button>
        </Form>
      </InlineStack>

      {stale ? (
        <Banner tone="info">
          The last collections preview is out of date - a write completed since
          it ran, so its proposals and counts are no longer shown. Press
          Preview again to see what still needs writing.
        </Banner>
      ) : (
        <Text as="p" variant="bodySm" tone="subdued">
          {collectionFindingSentence(report)}
        </Text>
      )}

      {building ? (
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text as="p" tone="subdued" variant="bodySm">
            {queueJob && queueJob.total > 0
              ? `Reading collections - ${queueJob.progress} of ${queueJob.total}.`
              : "Starting up..."}
          </Text>
        </InlineStack>
      ) : null}

      {applyReport?.error ? (
        <Banner tone="critical">
          {`The last write did not finish: ${applyReport.error}. Nothing beyond what is reported below was written.`}
        </Banner>
      ) : applyReport ? (
        <Banner tone={applyReport.refused ? "warning" : "success"}>
          {applyReport.refused
            ? (applyReport.reason ??
              "The SEO module was switched off before this write ran. Nothing was written.")
            : `Written: ${applyReport.written ?? 0}, left alone (protected): ${applyReport.skipped ?? 0}, already matched: ${applyReport.unchanged ?? 0}.`}
        </Banner>
      ) : null}

      {report && rows.length === 0 ? (
        <Text as="p" tone="subdued">
          Nothing to propose right now. Every collection either already has
          both fields set or is protected.
        </Text>
      ) : null}

      {rows.map((row) => (
        <Box key={row.id} padding="300" borderRadius="200" borderWidth="025" borderColor="border">
          <BlockStack gap="150">
            <InlineStack gap="200" blockAlign="center">
              <Text as="p" fontWeight="semibold">
                {row.title}
              </Text>
              <Badge>{row.handle}</Badge>
            </InlineStack>
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
                  {r.title} - {r.field === "seo_title" ? "meta title" : "meta description"}:{" "}
                  {r.reason}
                </List.Item>
              ))}
            </List>
          ) : null}
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}
