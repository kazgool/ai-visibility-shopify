// The plain name of each JobRun kind, for the two dashboard banners that used
// to say "A job is already running" and "This job has not moved" without
// saying which. A merchant who pressed Fill catalogue and was refused because
// a setting change from the Report screen was still queued had no way to know
// that (QA of 3 September 2026, wave fix 5). Kept as a pure function so the
// sentence can be asserted on without a browser.

const NAMES: Record<string, string> = {
  dry_run: "A preview",
  bulk_extract: "A catalogue pass",
  alt_text: "The alt text pass",
  crawler_check: "The crawler check",
  collections: "The collections pass",
  reconcile: "A setting change",
  seo_queue: "The SEO queue build",
  seo_apply: "The SEO write",
  seo_scan: "The page scan",
};

/** "A catalogue pass", "A setting change", or "A job" for a kind not listed. */
export function describeJobKind(kind: string | null | undefined): string {
  if (!kind) return "A job";
  return NAMES[kind] ?? "A job";
}
