// graphile-worker runner (ARCHITECTURE §1). Task list fills in Phase 2:
// bulk_extract, alt_text, crawler_check, theme_scan, indexnow_ping.
import { run } from "graphile-worker";

async function main() {
  const runner = await run({
    connectionString: process.env.DATABASE_URL,
    concurrency: 2,
    pollInterval: 2000,
    taskList: {
      // Placeholder so the runner boots; removed when real tasks land.
      noop: async (_payload, helpers) => {
        helpers.logger.info("noop task executed");
      },
    },
  });
  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
