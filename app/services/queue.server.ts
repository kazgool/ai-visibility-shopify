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
    | "seo_queue_build"
    | "seo_apply",
  payload: Record<string, unknown>,
) {
  const u = await workerUtils();
  await u.addJob(task, payload, { maxAttempts: 3 });
}
