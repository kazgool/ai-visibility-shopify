// Maintenance mode (ARCHITECTURE §1): one Fly machine that runs the web
// server and the worker in one process, and stops itself when nothing is
// happening. Fly starts it again on the next request (a webhook, the admin,
// the app proxy), so the machine is billed only for the minutes it is awake.
//
// The web half is what `remix-serve` does in production (compression, the
// two static mounts, morgan, the Remix handler), with one addition: every
// request is counted, so the process knows when it has been idle. The worker
// half is worker/runner.ts with the maintenance crontab.

import path from "node:path";
import url from "node:url";
import compression from "compression";
import express from "express";
import morgan from "morgan";
import { createRequestHandler } from "@remix-run/express";
import { installGlobals, type ServerBuild } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { CRONTAB_MAINTENANCE, startWorker } from "../worker/runner";
import { shouldStop } from "./idle";

const IDLE_MS = Number(process.env.IDLE_MINUTES ?? 5) * 60_000;
const CHECK_EVERY_MS = 30_000;

// Fly's own health check calls /healthz every 30 s while the machine is up.
// Counting it would keep the machine awake for ever.
const NOT_ACTIVITY = new Set(["/healthz"]);

// A job counts while it is locked (running) or runnable within the idle
// window. A job that used all its attempts is dead and never runs again, and
// a lock older than graphile's four-hour expiry belongs to a crashed process.
const QUEUE_BUSY_SQL = `
  select exists(
    select 1 from graphile_worker.jobs
    where attempts < max_attempts
      and (locked_at > now() - interval '4 hours'
           or run_at <= now() + make_interval(secs => $1::int))
  ) as busy`;

async function main() {
  const bootedAt = Date.now();
  let lastActivityAt = bootedAt;
  let inFlight = 0;

  const buildPath = path.resolve("build/server/index.js");
  const build = (await import(url.pathToFileURL(buildPath).href)) as ServerBuild;
  installGlobals({ nativeFetch: build.future.v3_singleFetch });

  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (NOT_ACTIVITY.has(req.path)) return next();
    inFlight += 1;
    lastActivityAt = Date.now();
    res.once("close", () => {
      inFlight -= 1;
      lastActivityAt = Date.now();
    });
    next();
  });
  app.use(compression());
  app.use(build.publicPath, express.static(build.assetsBuildDirectory, { immutable: true, maxAge: "1y" }));
  app.use(express.static("public", { maxAge: "1h" }));
  app.use(morgan("tiny"));
  app.all("*", createRequestHandler({ build, mode: process.env.NODE_ENV }));

  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => console.log(`maintenance: listening on ${port}`));

  const worker = await startWorker(CRONTAB_MAINTENANCE);
  // The cursor in poll_changes covers the whole time the machine was asleep,
  // so one poll per boot catches any webhook that was lost meanwhile.
  await worker.runner.addJob("poll_changes", {}, { jobKey: "poll_changes:boot" });

  const db = new PrismaClient();

  let stopping = false;
  async function stopAll(reason: string) {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    server.close();
    server.closeIdleConnections();
    await worker.stop(reason);
    await db.$disconnect().catch(() => undefined);
    // Exit 0 on purpose: the restart policy in fly.toml is "on-failure", so a
    // clean exit leaves the machine stopped until Fly's proxy starts it.
    console.log(`maintenance: ${reason}, exiting`);
    process.exit(0);
  }

  const timer = setInterval(async () => {
    if (stopping) return;
    let queueBusy = true;
    try {
      const rows = await db.$queryRawUnsafe<{ busy: boolean }[]>(QUEUE_BUSY_SQL, Math.round(IDLE_MS / 1000));
      queueBusy = rows[0]?.busy ?? true;
    } catch (error) {
      // Unknown means busy: stopping on a failed read could cut a job short.
      console.error(`maintenance: queue check failed: ${error instanceof Error ? error.message : error}`);
    }
    const now = Date.now();
    if (shouldStop({ now, bootedAt, lastActivityAt, inFlight, queueBusy, idleMs: IDLE_MS })) {
      await stopAll(`idle for ${Math.round((now - lastActivityAt) / 60_000)} min`);
    }
  }, CHECK_EVERY_MS);

  process.on("SIGTERM", () => void stopAll("SIGTERM received"));
  process.on("SIGINT", () => void stopAll("SIGINT received"));

  await worker.runner.promise;
}

main().catch((error) => {
  console.error(`maintenance boot: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
  process.exit(1);
});
