// Pure cutoff arithmetic for data-retention pruning. No I/O, so it is
// testable directly against a fixed "now" rather than the real clock.
//
// PRIVACY.md promises raw CrawlerHit records are kept 30 days. This is the
// one place that number is turned into a Date; the worker task that prunes
// CrawlerHit (worker/tasks.ts) imports it rather than repeating the
// arithmetic inline.

export const CRAWLER_HIT_RETENTION_DAYS = 30;

/** Rows with `at` older than the returned cutoff are past their retention window. */
export function crawlerHitCutoff(now: Date, days: number = CRAWLER_HIT_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
