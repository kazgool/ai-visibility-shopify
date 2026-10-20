// graphile-worker as its own Fly process (ARCHITECTURE §1), next to the
// database, so bulk passes survive a closed browser tab. Maintenance mode runs
// the same runner inside the web process instead (server/maintenance.ts).

import { CRONTAB_ALWAYS_ON, startWorker } from "./runner";
import { describeGraphqlError } from "../app/services/graphql-errors";

async function main() {
  const worker = await startWorker(CRONTAB_ALWAYS_ON);

  async function shutdown(signal: NodeJS.Signals) {
    await worker.stop(`${signal} received`);
    console.log(`worker: exiting after ${signal}`);
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await worker.runner.promise;
}

main().catch((err) => {
  // The formatter, not the object: a boot failure on a Shopify call used to
  // print a Response at Node's default depth and say nothing.
  console.error(describeGraphqlError(err, "worker boot"));
  process.exit(1);
});
