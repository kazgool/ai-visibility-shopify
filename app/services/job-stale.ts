// When a JobRun row that says "running" is not running any more (handoff of
// 11 September 2026, open item 3).
//
// A worker killed in the middle of a job - a deploy, a machine restart - never
// writes the row's final status. The row then says "running" for ever, and
// every one-job-at-a-time guard in the app reads it as a job in progress: on
// the first paying store's setup day that greyed out every button until the
// lock was released by hand on Neon.
//
// The worker now releases its jobs on SIGTERM and SIGINT (worker/index.ts), so
// this rule is the second line: a row still "running" with no sign of life for
// JOB_STALE_AFTER_MS is shown as stuck and stops blocking. "No sign of life"
// is both timestamps: startedAt, and updatedAt, which every progress write
// moves, so a long pass that is still writing progress never reads as stuck.
//
// graphile-worker 0.16.6 has no job-expiry option - its lock expiry is four
// hours, written into its own SQL - so 30 minutes is this app's figure, not
// the queue's. A stuck row stops blocking the buttons after 30 minutes; the
// orphaned queue job itself is retried by graphile after its four hours, with
// the same JobRun id, and writes nothing identical (facts.server.ts).
//
// Pure: imported by loaders, actions and the report screen's browser code.

import type { Prisma } from "@prisma/client";

export const JOB_STALE_AFTER_MS = 30 * 60 * 1000;

/** The status a stale row is presented under. Never written to the database. */
export const STUCK_STATUS = "stuck";

export const STUCK_REASON =
  "Stuck, released: this job stopped without finishing, most likely because the app " +
  "restarted while it ran. Nothing is waiting on it any more; press the button again to run it.";

type JobTimes = {
  status: string;
  startedAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

function millis(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * True when the row says "running" and neither its start nor its last
 * progress write is within JOB_STALE_AFTER_MS. A running row with no
 * startedAt is left alone: nothing proves it old.
 */
export function isStaleRunning(job: JobTimes, now: number = Date.now()): boolean {
  if (job.status !== "running") return false;
  const started = millis(job.startedAt);
  if (started === null) return false;
  const touched = Math.max(started, millis(job.updatedAt) ?? started);
  return now - touched > JOB_STALE_AFTER_MS;
}

/**
 * The row as a screen should see it: a stale "running" row comes back as
 * STUCK_STATUS with the reason in both fields the screens read failures
 * from, so every "is it running" check is false for it and every "why did
 * it not finish" line says what happened. Any other row is returned as is.
 */
export function presentJob<T extends JobTimes>(job: T | null, now: number = Date.now()): T | null {
  if (!job || !isStaleRunning(job, now)) return job;
  return { ...job, status: STUCK_STATUS, report: { reason: STUCK_REASON, error: STUCK_REASON } };
}

/**
 * The same rule as a Prisma filter, for the guards that refuse a second job:
 * queued, or running and not stale. Spread into a `where` in place of
 * `status: { in: ["queued", "running"] }`.
 */
export function liveJobFilter(now: number = Date.now()): Prisma.JobRunWhereInput {
  const cutoff = new Date(now - JOB_STALE_AFTER_MS);
  return {
    OR: [
      { status: "queued" },
      { status: "running", startedAt: null },
      { status: "running", startedAt: { gte: cutoff } },
      { status: "running", updatedAt: { gte: cutoff } },
    ],
  };
}
