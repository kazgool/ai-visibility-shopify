// Client-safe half of the SEO dashboard's queue-derived numbers (bug fixed 1
// Sep 2026: the metric tiles and the review table were both read straight off
// a seo_queue JobRun's report forever, including after an apply had consumed
// it - so a store with every field written kept reading "0 of 50" and kept
// offering to write fields that were already written).
//
// No ".server" suffix: app.seo.tsx's default export (the client component)
// calls these directly, and a value import from a .server file anywhere the
// client can see it fails the build - the same reason meta-column.ts exists
// without one.
//
// The rule this file exists to enforce: a seo_queue JobRun's report may be
// read as current only in status "done". The worker (worker/tasks.ts,
// seo_apply) moves it to "stale" the moment an apply that was reviewed
// against it finishes without being refused - written or not, because even
// "already matched" means an earlier apply changed what the queue described.
// Every other status (queued, running, failed, refused, stale) must not have
// its report presented as a current figure.

export type SeoQueueJobLike = {
  status: string;
  report: unknown;
  finishedAt: string | null;
} | null | undefined;

export type SeoQueueReportLike = {
  checked: number;
  missingTitle: number;
  missingDescription: number;
};

export type SeoMetricTile = {
  value: string;
  hint: string;
};

/** The only status whose report may be treated as a current figure. */
export function isQueueUsable(queueJob: SeoQueueJobLike): boolean {
  return queueJob?.status === "done";
}

/** Consumed by an apply - the numbers it holds are known to be wrong now. */
export function isQueueStale(queueJob: SeoQueueJobLike): boolean {
  return queueJob?.status === "stale";
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "an unknown time";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "an unknown time";
  return parsed.toLocaleString();
}

/**
 * The "Meta titles" / "Meta descriptions" dashboard tile for one field.
 * Three states, and only one of them prints a fraction:
 *  - usable ("done"): the fraction, dated to when the check finished.
 *  - stale: no fraction - a write happened since, so the figure is known
 *    wrong. Names when the check was last valid and what to do about it.
 *  - anything else (never checked, still running, failed, refused): the
 *    existing "Not checked yet" prompt.
 */
export function seoFieldMetric(
  queueJob: SeoQueueJobLike,
  field: "title" | "description",
): SeoMetricTile {
  if (isQueueStale(queueJob)) {
    return {
      value: "Recheck needed",
      hint: `The catalogue check from ${formatWhen(queueJob?.finishedAt)} is out of date - a write completed after it. Press Preview again to see current numbers.`,
    };
  }

  if (!isQueueUsable(queueJob)) {
    return {
      value: "Not checked yet",
      hint: "Press Preview on the listing below to check your catalogue.",
    };
  }

  const report = queueJob!.report as SeoQueueReportLike;
  const missing = field === "title" ? report.missingTitle : report.missingDescription;
  const label = field === "title" ? "meta title" : "meta description";
  return {
    value: `${report.checked - missing} of ${report.checked}`,
    hint: `Products with a ${label}, from the catalogue check on ${formatWhen(queueJob!.finishedAt)}.`,
  };
}
