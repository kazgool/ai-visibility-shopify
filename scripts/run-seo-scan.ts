// Development runner for source B of the per-product SEO scan
// (PRD-SEO-PER-PRODUCT section 3), so a night's scan can be watched now
// instead of at 03:45 UTC.
//
// **THIS WRITES.** It is not the census script. It runs the real nightly pass
// for one shop, so it writes:
//
//   - a `SeoScan` row per product it reads: scannedAt, status, nodes,
//     canonical, noindex, appBlock, cacheControl, and source B's half of the
//     findings column (source A's half is carried through untouched);
//   - a `JobRun` row of kind `seo_scan`, which is `running` for the duration
//     and therefore refuses every dashboard button while it runs, exactly as
//     the nightly pass does;
//   - Setting `seo_scan_spent`, the day's page counter, one page at a time;
//   - Setting `seo_scan_robots_block`, set or cleared by every pass.
//
// It also fetches the shop's public product pages, one at a time, 500 ms
// apart, as a plain client. That is a real storefront under load, which is why
// `--limit` exists.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/run-seo-scan.ts <shop-domain> [--limit N]
//
// Without an argument it picks the single installed shop and refuses to guess
// when there is more than one. It refuses outright unless the domain ends in
// myshopify.com: a development runner that can be pointed at an arbitrary host
// is a scanner, and this one sends a storefront password.
//
// It calls `scanProductPagesForShop` - the same function the `seo_scan_products`
// task calls, per shop - so the entitlement order, the origin resolution, the
// budget, the robots rule, the password rule and the JobRun are all the task's
// and none of them are reimplemented here. The helpers it passes print to the
// console; nothing may queue work, and the addJob it hands over throws to
// prove it.
//
// It prints counts and statuses only: never a product title, a handle, a URL
// or any page content. What went wrong on which product is a question for the
// SEO screen and the product editor, which are behind the merchant's own
// login. Same rule as scripts/seo-fields-census.ts, for the same reason.

import db from "../app/db.server";
import { describeGraphqlError } from "../app/services/graphql-errors";
import { DEFAULT_DAILY_BUDGET, dailyBudget, cappedBudget } from "../app/services/seo-page.server";
import { scanProductPagesForShop } from "../worker/tasks";

/**
 * A wrong command line, as opposed to a scan that failed. It prints one line
 * and no stack: a stack trace for a mistyped flag buries the sentence that
 * says what to type instead.
 */
class UsageError extends Error {}

/** The only host suffix this runner will fetch from. */
const ALLOWED_SUFFIX = ".myshopify.com";

/**
 * The helpers the task is given by graphile-worker, as much of them as
 * `scanProductPagesForShop` uses, plus an `addJob` that refuses.
 *
 * Nothing in source B queues a job - it reads pages and writes its own rows -
 * and this is where that is asserted rather than assumed. If a later change
 * adds an enqueue to the scan, this runner fails loudly on the first run
 * instead of quietly filling the queue of whatever database the operator
 * happens to be pointed at.
 */
const helpers = {
  logger: {
    info: (message: string) => console.log(`  ${message}`),
    error: (message: string) => console.error(`  ${message}`),
  },
  addJob: async (name: string) => {
    throw new Error(
      `run-seo-scan: the scan tried to queue "${name}". Source B queues nothing; ` +
        `if that changed on purpose, this runner needs a decision, not a queue.`,
    );
  },
};

/**
 * The domain and the limit, separated in one pass so that `--limit`'s value is
 * never mistaken for the domain. `--limit 5` and `--limit=5` both work, in
 * either order relative to the domain.
 */
export function parseArgs(argv: string[]): { domain?: string; limit: number | null } {
  let domain: string | undefined;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit" || arg.startsWith("--limit=")) {
      const raw = arg.includes("=") ? arg.slice("--limit=".length) : argv[++i];
      const value = Number(raw);
      if (raw === undefined || raw === "" || !Number.isFinite(value) || value < 0) {
        throw new UsageError(`--limit needs a number of pages, got "${raw ?? ""}".`);
      }
      limit = Math.floor(value);
      continue;
    }
    if (arg.startsWith("--")) {
      throw new UsageError(`unknown option "${arg}". Only --limit N is understood.`);
    }
    if (domain === undefined) domain = arg;
    else throw new UsageError(`one shop domain, not two ("${domain}" and "${arg}").`);
  }
  return { domain, limit };
}

function table(byCode: Record<string, number>): string[] {
  const codes = Object.keys(byCode).sort();
  if (codes.length === 0) return ["  (no finding on any page read)"];
  return codes.map((code) => `  ${code.padEnd(6)} ${String(byCode[code]).padStart(6)}`);
}

async function main() {
  const { domain: wanted, limit } = parseArgs(process.argv.slice(2));

  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });
  const shop = wanted
    ? shops.find((s: { domain: string }) => s.domain === wanted)
    : shops.length === 1
      ? shops[0]
      : null;
  if (!shop) {
    console.log(
      wanted
        ? `No installed shop with domain ${wanted}.`
        : `Expected one installed shop, found ${shops.length}. Pass the domain as an argument.`,
    );
    await db.$disconnect();
    return;
  }

  if (!shop.domain.endsWith(ALLOWED_SUFFIX)) {
    console.log(
      `Refusing to run against ${shop.domain}: this runner only fetches from ` +
        `*${ALLOWED_SUFFIX}. It sends the storefront password and reads product pages.`,
    );
    await db.$disconnect();
    return;
  }

  // Said before anything is written, not after.
  console.log(
    `THIS WRITES: SeoScan rows for ${shop.domain}, a JobRun of kind seo_scan, ` +
      `and the day's page counter. It fetches this shop's public product pages.`,
  );

  const shopBudget = await dailyBudget(shop.id);
  const budget = cappedBudget(shopBudget, limit);
  console.log(
    `Budget: ${budget} pages` +
      (limit === null
        ? ` (seo_scan_daily_budget, default ${DEFAULT_DAILY_BUDGET})`
        : budget === shopBudget
          ? ` (--limit ${limit} is not below this shop's ${shopBudget}, so the shop's budget stands)`
          : ` (--limit ${limit}, lowered from this shop's ${shopBudget})`),
  );
  console.log("Running the same pass the nightly task runs...");

  const started = Date.now();
  const outcome = await scanProductPagesForShop(shop, helpers.logger, { budgetCap: limit });

  if (!outcome.ran) {
    console.log(
      outcome.reason === "no_seo_key"
        ? "Skipped: this shop has no SEO key, so it gets no seo_scan JobRun at all."
        : "Skipped: no active subscription or comp.",
    );
    await db.$disconnect();
    return;
  }

  const { report } = outcome;
  const seconds = Math.round((Date.now() - started) / 100) / 10;

  console.log("");

  // Three states, said differently, because "0 of everything" under the word
  // "catalogue" read as finished when nothing had started (4 September 2026).
  if (report.stopped === "no_catalogue") {
    console.log(`Nothing to scan after ${seconds}s: this shop has no products read yet.`);
    console.log("  The per-product table is empty, so there are no page addresses to fetch.");
    console.log("  Run a catalogue pass first: Fill catalogue on the app's dashboard.");
    console.log("  This is not a finished scan and nothing is wrong with the storefront.");
    await db.$disconnect();
    return;
  }

  const ended =
    report.stopped === "up_to_date"
      ? "every page that was waiting has been read"
      : report.stopped === "budget"
        ? `the daily budget ran out with ${report.remaining} still waiting`
        : "robots.txt turned the scan away";
  console.log(`Done in ${seconds}s: ${ended}.`);

  if (report.stopped === "robots") {
    const detail = (report.robots?.detail ?? {}) as Record<string, unknown>;
    console.log(
      `  robots.txt disallows ${String(detail.disallow)} for user agent ` +
        `${String(detail.userAgent)}, so no page was fetched.`,
    );
    console.log(`  The rule was matched against ${String(detail.path)}.`);
  }

  console.log("");
  console.log(`  pages fetched                 ${String(report.scanned).padStart(6)}`);
  console.log(`  answered with the password    ${String(report.password).padStart(6)}`);
  console.log(`  could not be reached          ${String(report.failed).padStart(6)}`);
  console.log(`  answered from a cache         ${String(report.fromCache).padStart(6)}`);
  console.log(`  still waiting                 ${String(report.remaining).padStart(6)}`);
  console.log(`  nights to finish              ${String(report.nightsToFinish).padStart(6)}`);
  // B16's spend, stated apart from the pages. Link fetches come out of the same
  // daily allowance, so a night that read fewer pages than its budget is not
  // necessarily a night that finished - see the `stopped` line above.
  if (report.links) {
    console.log(`  link addresses fetched (B16)  ${String(report.links.fetched).padStart(6)}`);
    console.log(`  pages whose links were read   ${String(report.links.pages).padStart(6)}`);
    console.log(`  pages with more than 20 links ${String(report.links.capped).padStart(6)}`);
  }
  console.log("");
  console.log("Findings raised on the pages read, by check:");
  for (const row of table(report.byCode)) console.log(row);

  await db.$disconnect();
}

main().catch(async (error) => {
  if (error instanceof UsageError) {
    console.error(`run-seo-scan: ${error.message}`);
    console.error("  npx tsx scripts/run-seo-scan.ts <shop-domain> [--limit N]");
  } else {
    console.error(describeGraphqlError(error, "run-seo-scan"));
  }
  await db.$disconnect();
  process.exit(1);
});
