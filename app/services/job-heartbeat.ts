// A sign of life for long jobs (CC-PROMPT-AI-READABILITY-2 item 3).
//
// job-stale.ts reads a "running" JobRun row as stuck once both its startedAt
// and its updatedAt are older than 30 minutes, and the one-job-at-a-time
// guards then let a second job start. A job that is alive but writes nothing
// for that long is therefore indistinguishable from a dead one: the nightly
// page read wrote its JobRun only at the start and at the end, so a scan past
// 30 minutes read "stuck" while it was running.
//
// The heartbeat is tied to work, never to a timer: it writes when the job has
// done something (a page read, an Admin call, a row written), so a job hung on
// one await still goes stale, which is what the stale rule is for. Throttled
// to one write per HEARTBEAT_EVERY_ITEMS units or HEARTBEAT_EVERY_MS,
// whichever comes first, so a 500-page scan costs about 50 writes, not 500.
//
// A heartbeat write that fails is not the job failing: the error is reported
// through onError and the next unit of work tries again.
//
// Pure: no database, no Shopify. The caller supplies the write.

import type { GraphqlFn } from "./admin.server";

export const HEARTBEAT_EVERY_ITEMS = 10;
export const HEARTBEAT_EVERY_MS = 60_000;

/** What one heartbeat write carries: counts, or null for a sign of life
 * alone (the row's updatedAt), which never overwrites counts a task wrote
 * itself. */
export type HeartbeatWrite = { done: number; total: number } | null;

export type Heartbeat = {
  /** Throttled: writes the counts when HEARTBEAT_EVERY_ITEMS units or
   * HEARTBEAT_EVERY_MS have passed since the last write, whichever first. */
  progress(done: number, total: number): Promise<void>;
  /** Throttled on time alone, and writes no counts. For work that has none
   * of its own: a bulk-operation poll, a database row, another row's pages. */
  touch(): Promise<void>;
};

export function createHeartbeat(
  save: (write: HeartbeatWrite) => Promise<void>,
  options: { now?: () => number; onError?: (error: unknown) => void } = {},
): Heartbeat {
  // Read through a closure so a test that replaces Date.now is honoured.
  const now = options.now ?? (() => Date.now());
  let lastAt = now();
  let lastDone = 0;

  const flush = async (write: HeartbeatWrite) => {
    try {
      await save(write);
      lastAt = now();
      if (write) lastDone = write.done;
    } catch (error) {
      options.onError?.(error);
    }
  };

  return {
    async progress(done, total) {
      if (done - lastDone >= HEARTBEAT_EVERY_ITEMS || now() - lastAt >= HEARTBEAT_EVERY_MS) {
        await flush({ done, total });
      }
    },
    async touch() {
      if (now() - lastAt >= HEARTBEAT_EVERY_MS) await flush(null);
    },
  };
}

/**
 * The Admin client, beating after every call. A bulk-operation read polls
 * every two seconds for up to eight minutes and writes nothing of its own;
 * through this wrapper each poll is a sign of life, with no change to the
 * functions that make the calls. Without a beat it returns the client as is.
 */
export function beatingGraphql(graphql: GraphqlFn, beat?: () => Promise<void>): GraphqlFn {
  if (!beat) return graphql;
  return (async (query: string, variables?: Record<string, unknown>) => {
    const result = await graphql(query, variables);
    await beat();
    return result;
  }) as GraphqlFn;
}
