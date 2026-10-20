// graphile-worker runner, shared by the two ways the app can run
// (ARCHITECTURE §1): its own Fly process (worker/index.ts, always on) and
// inside the web process in maintenance mode (server/maintenance.ts).

import { EventEmitter } from "node:events";
import { run, type Runner, type WorkerEvents, type WorkerPool } from "graphile-worker";
import * as tasks from "./tasks";

// How long a stop waits for the jobs in hand to finish before they are failed
// back to the queue. Fly sends the signal on every deploy and SIGKILL after
// kill_timeout (30 s in fly.toml), so this must fit inside it with room for
// the fallback below.
const SHUTDOWN_CEILING_MS = 25_000;
const FORCEFUL_CEILING_MS = 4_000;

export const TASK_LIST = {
  bulk_extract: tasks.bulk_extract,
  extract_product: tasks.extract_product,
  bulk_alt_text: tasks.bulk_alt_text,
  poll_changes: tasks.poll_changes,
  sweep_missing: tasks.sweep_missing,
  reconcile_mirrors: tasks.reconcile_mirrors,
  crawler_check: tasks.crawler_check,
  bulk_collections: tasks.bulk_collections,
  seo_watch: tasks.seo_watch,
  seo_scan_products: tasks.seo_scan_products,
  seo_snapshot: tasks.seo_snapshot,
  seo_queue_build: tasks.seo_queue_build,
  seo_apply: tasks.seo_apply,
  seo_collection_queue: tasks.seo_collection_queue,
  seo_collection_apply: tasks.seo_collection_apply,
  prune_crawler_hits: tasks.prune_crawler_hits,
};

// Freshness in layers: webhooks fire instantly, the poll closes the gap when
// one is dropped, the sweep guarantees nothing is missed for long.
export const CRONTAB_ALWAYS_ON = [
  "*/15 * * * * poll_changes",
  "30 3 * * 1 sweep_missing", // Monday 03:30 UTC
  "0 4 * * 1 seo_watch", // Monday 04:00 UTC, seo_unlocked shops only
  "45 3 * * * seo_scan_products", // nightly 03:45 UTC, after the Monday sweep starts
  "0 5 * * * prune_crawler_hits", // daily 05:00 UTC, PRIVACY.md 30-day retention
].join("\n");

// Maintenance mode: the machine is asleep most of the time, so a schedule
// only fires if it is awake at that minute. `fill` makes graphile run, on the
// next wake, the occurrence it slept through (one per window, not one per
// missed tick). The poll has no fill: server/maintenance.ts queues one poll at
// every boot, and the poll's own cursor covers the whole time asleep.
export const CRONTAB_MAINTENANCE = [
  "*/15 * * * * poll_changes",
  "30 3 * * 1 sweep_missing ?fill=1w",
  "0 4 * * 1 seo_watch ?fill=1w",
  "45 3 * * * seo_scan_products ?fill=1d",
  "0 5 * * * prune_crawler_hits ?fill=1d",
].join("\n");

/** Resolves "timeout" after `ms`, without keeping the process alive. */
function after(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms).unref());
}

export interface StartedWorker {
  runner: Runner;
  /** Stops taking jobs and releases every lock; never exits the process. */
  stop(reason: string): Promise<"stopped" | "timeout" | "failed">;
}

export async function startWorker(crontab: string): Promise<StartedWorker> {
  // Why the stop below exists: a deploy used to kill the worker mid-job with
  // nothing handling the signal, so the job's queue lock was orphaned and its
  // JobRun row said "running" for ever. The one-job-at-a-time guard then
  // greyed out every button - for four hours on the first paying store's
  // setup day, until the lock was released by hand on Neon (handoff of 11
  // September 2026, open item 3).
  //
  // Job expiry: graphile-worker 0.16.6 has no option for it. Its lock expiry
  // is four hours, written into its own SQL (get_job and resetLockedAt), so it
  // cannot be lowered from here. What can be done is to never orphan the lock
  // in the first place: on a stop, stop taking jobs, let the ones in hand
  // finish for up to 25 s, and fail back whatever is still running, which
  // clears its lock at once and lets graphile retry it with its usual
  // backoff. The screens' own 30-minute rule for a row left "running" is in
  // app/services/job-stale.ts.
  //
  // The pool is captured from its creation event because the runner exposes
  // stop() and nothing forceful; the event fires inside run(), so the emitter
  // has to be handed in rather than listened to afterwards.
  const events = new EventEmitter() as unknown as WorkerEvents;
  const poolRef: { current: WorkerPool | null } = { current: null };
  events.on("pool:create", ({ workerPool }) => {
    poolRef.current = workerPool;
  });

  const runner = await run({
    connectionString: process.env.DATABASE_URL,
    concurrency: 2,
    pollInterval: 2000,
    // Handled by the callers instead: graphile's own handler has no ceiling
    // and does not end the process with a clean exit code.
    noHandleSignals: true,
    events,
    taskList: TASK_LIST,
    crontab,
  });

  let stopped: Promise<"stopped" | "timeout" | "failed"> | null = null;

  async function doStop(reason: string) {
    console.log(`worker: ${reason}, stopping (ceiling ${SHUTDOWN_CEILING_MS / 1000} s)`);

    const outcome = await Promise.race([
      runner.stop().then(() => "stopped" as const),
      after(SHUTDOWN_CEILING_MS),
    ]).catch((error: unknown) => {
      console.error(`worker: graceful stop failed: ${error instanceof Error ? error.message : error}`);
      return "failed" as const;
    });

    if (outcome !== "stopped" && poolRef.current) {
      // A bulk pass does not finish in 25 s. Failing it back is what releases
      // the lock; exiting without it is the orphan this handler exists to end.
      const message = `worker ${reason}: shutdown ceiling reached, job returned to the queue`;
      await Promise.race([poolRef.current.forcefulShutdown(message), after(FORCEFUL_CEILING_MS)]).catch(
        (error: unknown) => {
          console.error(`worker: forceful stop failed: ${error instanceof Error ? error.message : error}`);
        },
      );
    }

    console.log(`worker: ${reason} handled (${outcome})`);
    return outcome;
  }

  return {
    runner,
    stop: (reason) => (stopped ??= doStop(reason)),
  };
}
