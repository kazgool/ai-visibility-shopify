// A job whose worker died keeps its lock, and nothing reclaims it.
//
// Fly restarts the worker on every deploy. `worker/index.ts` handles no
// signals, so a job in flight at that moment dies without releasing itself:
// graphile-worker will not touch a locked job until `maxJobExpiry` passes,
// which is four hours by default and is not overridden here. Meanwhile the
// JobRun row stays "running", and the dashboard's one-job-at-a-time guard
// reads that row, so every button on the screen is disabled for those four
// hours with no way out from inside the app.
//
// Releasing the lock fixes both: the worker picks the job up within one poll
// interval, runs it, and sets the JobRun row to done itself.
//
//   npx tsx scripts/queue-unstick.ts                 read only, lists them
//   npx tsx scripts/queue-unstick.ts --release       clears the locks
//   npx tsx scripts/queue-unstick.ts --release --minutes 30
//
// Only jobs locked for longer than --minutes (default 10) are touched, so a
// job that is genuinely running right now can never be released underneath
// its worker.

import db from "../app/db.server";

type LockedJob = {
  id: string;
  task_identifier: string;
  locked_at: Date;
  locked_by: string;
  attempts: number;
  max_attempts: number;
  minutes_locked: number;
};

type StaleRun = {
  id: string;
  kind: string;
  status: string;
  startedAt: Date | null;
  minutes_running: number;
};

async function main() {
  const release = process.argv.includes("--release");
  const flag = process.argv.indexOf("--minutes");
  const minutes = flag === -1 ? 10 : Number(process.argv[flag + 1]);
  if (!Number.isFinite(minutes) || minutes < 1) {
    console.error("--minutes must be a number of at least 1");
    process.exit(1);
  }

  console.log(
    `${release ? "RELEASE" : "READ ONLY"}: jobs locked for more than ${minutes} minutes\n`,
  );

  const locked = await db.$queryRawUnsafe<LockedJob[]>(`
    SELECT id::text, task_identifier, locked_at, locked_by, attempts, max_attempts,
           EXTRACT(EPOCH FROM (now() - locked_at))::int / 60 AS minutes_locked
    FROM graphile_worker._private_jobs
    WHERE locked_at IS NOT NULL
      AND locked_at < now() - INTERVAL '${minutes} minutes'
    ORDER BY locked_at
  `);

  const runs = await db.$queryRawUnsafe<StaleRun[]>(`
    SELECT id, kind, status, "startedAt",
           EXTRACT(EPOCH FROM (now() - "startedAt"))::int / 60 AS minutes_running
    FROM "JobRun"
    WHERE status = 'running'
      AND "startedAt" < now() - INTERVAL '${minutes} minutes'
    ORDER BY "startedAt"
  `);

  console.log(`  locked jobs   ${locked.length}`);
  for (const j of locked) {
    console.log(
      `    ${j.task_identifier}  id=${j.id}  ${j.minutes_locked} min  attempt ${j.attempts}/${j.max_attempts}  by ${j.locked_by}`,
    );
  }

  console.log(`  stale JobRun  ${runs.length}`);
  for (const r of runs) {
    console.log(`    ${r.kind}  id=${r.id}  running for ${r.minutes_running} min`);
  }

  if (locked.length === 0 && runs.length === 0) {
    console.log("\nNothing is stuck.");
    return;
  }

  if (!release) {
    console.log("\nNothing was changed. Add --release to clear the locks.");
    return;
  }

  // Only the lock is cleared. The job keeps its attempt count and its
  // payload, so the worker reruns the same work rather than a new job being
  // invented here, and the task itself is what closes the JobRun row.
  const freed = await db.$executeRawUnsafe(`
    UPDATE graphile_worker._private_jobs
    SET locked_at = NULL, locked_by = NULL
    WHERE locked_at IS NOT NULL
      AND locked_at < now() - INTERVAL '${minutes} minutes'
  `);

  console.log(`\n  released ${freed} job(s). The worker picks them up within a poll interval.`);
  console.log("  The JobRun rows are left alone: the rerun closes them itself.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
