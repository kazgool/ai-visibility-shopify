// Read-only. Answers the one question that decides whether crawler
// verification can exist on Shopify at all.
//
// CRAWLER-HITS-SPEC section 5 wants each request verified against the crawler
// owner's own network (forward-confirmed reverse DNS), the way the WordPress
// plugin has done since 1.7.7. That needs the requester's IP address. On
// Shopify the request reaches this app through Shopify's edge and then Fly,
// and it has never been established that a real client address survives that
// path. `CrawlerHit.forwarding` was added on 22 August as temporary
// instrumentation to find out: it stores the candidate forwarding headers as
// received, exactly as they arrived.
//
// Nobody has read it. This script does, and nothing else. No writes, no
// deletes, no schema change. Run it, read the verdict, then decide.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-forwarding.ts
//
// It prints no full IP addresses: an address is shown as its first two
// octets plus a mask, which is enough to tell a public client apart from
// private infrastructure without putting personal data on a screen.

import db from "../app/db.server";
import { describeGraphqlError } from "../app/services/graphql-errors";

/** RFC1918, loopback, link-local and the shared CGNAT range. */
function isPrivate(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^127\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ||
    ip === "::1" ||
    /^fd[0-9a-f]{2}:/i.test(ip) ||
    /^fe80:/i.test(ip)
  );
}

function mask(ip: string): string {
  if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:...`;
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : "unparseable";
}

async function main() {
  const total = await db.crawlerHit.count();
  const withForwarding = await db.crawlerHit.count({
    where: { forwarding: { not: null } },
  });
  const withIp = await db.crawlerHit.count({ where: { ip: { not: null } } });

  console.log("CrawlerHit rows in retention (30 days):", total);
  console.log("  with a forwarding record:", withForwarding);
  console.log("  with an ip value:", withIp);

  if (total === 0) {
    console.log(
      "\nNo rows. Either nothing has requested the text pages in 30 days, or the app embed is off. Nothing can be concluded about verification from this.",
    );
    await db.$disconnect();
    return;
  }

  const rows = await db.crawlerHit.findMany({
    where: { forwarding: { not: null } },
    select: { agent: true, ip: true, forwarding: true, at: true },
    orderBy: { at: "desc" },
    take: 400,
  });

  // Which header names ever carry anything, and how many distinct values each
  // one has. A header that is always present with one value is infrastructure;
  // one that varies per request is the interesting one.
  const headerValues = new Map<string, Set<string>>();
  for (const row of rows) {
    let parsed: Record<string, string | null>;
    try {
      parsed = JSON.parse(row.forwarding as string);
    } catch {
      continue;
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (value === null || value === "") continue;
      if (!headerValues.has(name)) headerValues.set(name, new Set());
      headerValues.get(name)!.add(String(value));
    }
  }

  console.log("\nForwarding headers actually received:");
  if (headerValues.size === 0) {
    console.log("  none - every record parsed to an empty set of headers.");
  }
  for (const [name, values] of headerValues) {
    const sample = [...values].slice(0, 3).map((v) => {
      const first = v.split(",")[0].trim();
      return isPrivate(first) ? `${mask(first)} (private)` : mask(first);
    });
    console.log(
      `  ${name}: ${values.size} distinct value${values.size === 1 ? "" : "s"} - e.g. ${sample.join(", ")}`,
    );
  }

  // The verdict. A public, varying address is the prerequisite for FCrDNS.
  const publicAddresses = new Set<string>();
  const privateAddresses = new Set<string>();
  for (const values of headerValues.values()) {
    for (const value of values) {
      const first = value.split(",")[0].trim();
      if (!/^[0-9a-f.:]+$/i.test(first)) continue;
      if (isPrivate(first)) privateAddresses.add(first);
      else publicAddresses.add(first);
    }
  }

  console.log("\nDistinct addresses seen:");
  console.log("  public:", publicAddresses.size);
  console.log("  private or infrastructure:", privateAddresses.size);

  console.log("\nVerdict");
  if (publicAddresses.size === 0) {
    console.log(
      "  No public client address ever arrived. Forward-confirmed reverse DNS cannot be",
    );
    console.log(
      "  built on this data, at any price, because the address to resolve does not reach",
    );
    console.log(
      "  the app. The counter must keep saying the user agent is self-declared, and the",
    );
    console.log("  ip and forwarding columns should be dropped as unused personal data.");
  } else if (publicAddresses.size < 5) {
    console.log(
      `  Only ${publicAddresses.size} distinct public address across ${rows.length} records.`,
    );
    console.log(
      "  That is more likely to be Shopify's or Fly's own egress than per-crawler client",
    );
    console.log(
      "  addresses. Check two of them against the published ranges before building anything.",
    );
  } else {
    console.log(
      `  ${publicAddresses.size} distinct public addresses across ${rows.length} records.`,
    );
    console.log(
      "  A real client address does reach the app, so forward-confirmed reverse DNS is",
    );
    console.log(
      "  buildable. Next step is a lookup, a cache and one column holding the verdict -",
    );
    console.log("  never the address itself beyond retention.");
  }

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(describeGraphqlError(error, "read-forwarding"));
  await db.$disconnect();
  process.exit(1);
});
