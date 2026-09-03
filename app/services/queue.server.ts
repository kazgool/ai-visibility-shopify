// Enqueueing jobs from the web process. The worker (a separate Fly process)
// picks them up; nothing heavy ever runs on a request path (PRD §5.2).

import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";

let utils: WorkerUtils | null = null;

async function workerUtils(): Promise<WorkerUtils> {
  if (!utils) {
    utils = await makeWorkerUtils({ connectionString: process.env.DATABASE_URL });
  }
  return utils;
}

export async function enqueue(
  task:
    | "bulk_extract"
    | "extract_product"
    | "bulk_alt_text"
    | "crawler_check"
    | "bulk_collections"
    | "reconcile_mirrors"
    | "seo_queue_build"
    | "seo_apply",
  payload: Record<string, unknown>,
  /**
   * jobKey de-duplicates: a second addJob with the same key before the first
   * runs replaces it rather than queuing a second job. `poll_changes` already
   * passes `extract:${productGid}` for this reason; the webhook handlers
   * (products/create, products/update) previously did not, so a burst of
   * updates to one product - a CSV import touching it twice, an app doing
   * its own writes - queued one extract_product job per webhook delivery
   * instead of collapsing to one.
   */
  options?: { jobKey?: string },
) {
  const u = await workerUtils();
  await u.addJob(task, payload, { maxAttempts: 3, jobKey: options?.jobKey });
}
