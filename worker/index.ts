// graphile-worker runner (ARCHITECTURE §1). Runs in its own Fly process
// group, next to the database, so bulk passes survive a closed browser tab.

import { run } from "graphile-worker";
import * as tasks from "./tasks";

async function main() {
  const runner = await run({
    connectionString: process.env.DATABASE_URL,
    concurrency: 2,
    pollInterval: 2000,
    taskList: {
      bulk_extract: tasks.bulk_extract,
      extract_product: tasks.extract_product,
      bulk_alt_text: tasks.bulk_alt_text,
    },
  });
  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
