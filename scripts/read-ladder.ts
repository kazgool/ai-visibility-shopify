// Read-only. Prints the dashboard ladder exactly as /app resolves it for a
// shop: which step is open, which are locked and why, and the sentence each
// one shows. Writes nothing - no metafield, no Setting, no JobRun - and calls
// the same reads the loader does.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-ladder.ts [shop-domain]
//
// It exists so a delivery note can state what the screen says today rather
// than what the code ought to make it say (CLAUDE.md: check.bat passing is not
// the same as the feature working). Without an argument it picks the single
// installed shop and refuses to guess when there is more than one.

import db from "../app/db.server";
import { adminGraphql } from "../app/services/admin.server";
import { businessFor } from "../app/services/business.server";
import { hasPaidAccess, freeProductIds } from "../app/services/billing.server";
import { checkAppEmbed, embedDeepLink } from "../app/services/embed-check.server";
import { readPass } from "../app/services/report-metrics";
import { resolveLadder } from "../app/services/dashboard-steps";

async function main() {
  const arg = process.argv[2];
  const shops = await db.shop.findMany();
  const shop = arg ? shops.find((s) => s.domain === arg) : shops.length === 1 ? shops[0] : null;
  if (!shop) {
    console.error(
      arg
        ? `No installed shop with domain ${arg}.`
        : `Give a domain: ${shops.map((s) => s.domain).join(", ") || "no shops installed"}`,
    );
    process.exit(1);
  }

  // adminGraphql returns parsed JSON; checkAppEmbed and hasPaidAccess expect a
  // fetch-shaped caller, as the route's `admin.graphql` is. Same adaptation as
  // scripts/read-app-embed.ts.
  const raw = await adminGraphql(shop.domain);
  const graphql = async (query: string, options?: { variables?: object }) => {
    const data = await raw<any>(query, (options?.variables ?? {}) as any);
    return new Response(JSON.stringify({ data }));
  };
  const embed = await checkAppEmbed(graphql);

  const [lastDry, lastBulk, lastWrite, dictionary, collectionsJob, crawlerJob, activeJob] =
    await Promise.all([
      db.jobRun.findFirst({ where: { shopId: shop.id, kind: "dry_run" }, orderBy: { startedAt: "desc" } }),
      db.jobRun.findFirst({ where: { shopId: shop.id, kind: "bulk_extract" }, orderBy: { startedAt: "desc" } }),
      db.jobRun.findFirst({
        where: { shopId: shop.id, kind: "bulk_extract", status: "done" },
        orderBy: { finishedAt: "desc" },
      }),
      db.setting.findUnique({ where: { shopId_key: { shopId: shop.id, key: "dictionary" } } }),
      db.jobRun.findFirst({
        where: { shopId: shop.id, kind: "collections", status: "done" },
        orderBy: { finishedAt: "desc" },
      }),
      db.jobRun.findFirst({ where: { shopId: shop.id, kind: "crawler_check" }, orderBy: { startedAt: "desc" } }),
      db.jobRun.findFirst({
        where: { shopId: shop.id, status: { in: ["queued", "running"] } },
        orderBy: { updatedAt: "desc" },
        select: { kind: true },
      }),
    ]);

  const checks = await db.crawlerCheck.findMany({
    where: { shopId: shop.id },
    orderBy: { checkedAt: "desc" },
    take: 25,
  });
  const latest = new Map<string, (typeof checks)[number]>();
  for (const c of checks) if (!latest.has(c.agent)) latest.set(c.agent, c);

  const business = await businessFor(shop.id);
  const hasAccess = await hasPaidAccess(shop.domain, shop.id, graphql);
  const freeUsed = (await freeProductIds(shop.id)).length;

  const asPass = (j: typeof lastDry) =>
    readPass(
      j
        ? {
            status: j.status,
            report: j.report,
            startedAt: j.startedAt?.toISOString() ?? null,
            finishedAt: j.finishedAt?.toISOString() ?? null,
            kind: j.kind,
          }
        : null,
    );

  const ladder = resolveLadder({
    crawlerJob: crawlerJob
      ? {
          status: crawlerJob.status,
          report: crawlerJob.report,
          finishedAt: crawlerJob.finishedAt?.toISOString() ?? null,
        }
      : null,
    crawlers: Array.from(latest.values()).map((c) => ({ agent: c.agent, cause: c.cause ?? "unknown" })),
    embed,
    embedLink: embedDeepLink(shop.domain),
    hasAccess,
    freeProductsRemaining: Math.max(0, 3 - freeUsed),
    previewPass: asPass(lastDry),
    fillPass: asPass(lastBulk),
    lastWrite: lastWrite ? { finishedAt: lastWrite.finishedAt?.toISOString() ?? null } : null,
    hasDictionary: Boolean(dictionary?.value?.trim()),
    hasBusiness: Boolean(
      business &&
        (business.deliveryTime ||
          business.deliveryCost ||
          business.returnDays ||
          business.warranty ||
          business.paymentMethods),
    ),
    collectionsBuilt: collectionsJob
      ? {
          at: collectionsJob.finishedAt?.toISOString() ?? null,
          withTable: (collectionsJob.report as any)?.withTable ?? 0,
          total: (collectionsJob.report as any)?.collections ?? 0,
        }
      : null,
    blockingKind: activeJob?.kind ?? null,
  });

  console.log(`\n${shop.domain} - paid access: ${hasAccess}, current step: ${ladder.currentKey ?? "none"}\n`);
  for (const s of ladder.steps) {
    console.log(`${s.number}. ${s.title}  [${s.status}]`);
    if (s.result) console.log(`   result:  ${s.result}`);
    if (s.problem) console.log(`   problem: ${s.problem}`);
    for (const sub of s.subs) console.log(`   - ${sub.done ? "done" : "open"}: ${sub.label}`);
    if (s.action) {
      console.log(
        `   action:  ${s.action.label} (${s.action.kind})` +
          `${s.action.primary ? " PRIMARY" : ""}` +
          `${s.action.disabled ? ` disabled - ${s.action.disabledReason}` : ""}`,
      );
    }
    if (s.extra) console.log(`   extra:   ${s.extra.label} (${s.extra.kind})`);
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
