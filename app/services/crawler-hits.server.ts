// Turning raw CrawlerHit rows into what a merchant can read
// (CRAWLER-HITS-SPEC §6, EXPERIENCE-PRD §2, §6, §7).
//
// Two traps, both documented next to logCrawlerHit() in proxy.$.tsx and
// repeated here because a query that gets either wrong looks like "no
// traffic yet" instead of a bug:
//
// (a) CrawlerHit.shopId holds the shop DOMAIN string (session.shop), never
//     the Shop row's internal id. Querying by the internal id returns zero
//     rows forever.
// (b) These rows are requests to the app proxy only - the plain text mirror,
//     llms.txt, agents.md and the IndexNow key file. They are never visits
//     to the merchant's themed storefront pages, which Shopify serves
//     directly and this app never sees. Every string built from this data
//     must say "requested", never "visited your store" or "read by AI".

import db from "../db.server";
import { NON_CRAWLER_TOKENS } from "./crawler-info";

/** Recognised crawlers, matched by substring against the raw user agent.
 * Order matters: more specific names come first so "OAI-SearchBot" is never
 * absorbed by a looser match. Anything not on this list is grouped as
 * "other" and never shown as a named crawler - a user agent is a claim, not a
 * fact (CRAWLER-HITS-SPEC §5), and this app only names crawlers it
 * recognises.
 *
 * The four search-engine names below were added on 2 September 2026 for the
 * Report screen, checked against Google Search Central's crawler list and
 * Bing's webmaster documentation rather than from memory. Placed above
 * "Googlebot" for the same specificity reason as the rest: they carry their
 * own names and must never be folded into it. */
const KNOWN_BOTS: readonly string[] = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "ClaudeBot",
  "PerplexityBot",
  "DeepSeekBot",
  "Applebot",
  "Google-CloudVertexBot",
  "Google-InspectionTool",
  "Storebot-Google",
  "GoogleOther",
  "Googlebot",
  "bingbot",
];

export function normalizeBot(agent: string): string {
  const lower = agent.toLowerCase();
  // Google-Extended and Applebot-Extended are robots.txt control tokens; no
  // request is ever made under either name, so one that claims to be is not
  // the crawler whose name it borrows. Checked before the list because
  // "Applebot-Extended" contains "Applebot" and would otherwise be counted as
  // a real Applebot read. These are surfaced separately, by their own query,
  // and never inside a crawler total.
  for (const token of NON_CRAWLER_TOKENS) {
    if (lower.includes(token.toLowerCase())) return "other";
  }
  for (const name of KNOWN_BOTS) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  return "other";
}

export type HitRow = {
  agent: string;
  handle: string | null;
  path: string;
  status: number;
  at: Date;
};

export type BotCount = { bot: string; count: number; lastSeen: string };

/**
 * A miss (any non-200) is not a read (CRAWLER-HITS-SPEC §6): it stays out of
 * this headline count and belongs on the diagnostics list instead, so it
 * never blends a fault or a stale link into a number that is meant to prove
 * something was actually read.
 */
export function summarizeHits(rows: HitRow[]): BotCount[] {
  const byBot = new Map<string, { count: number; lastSeen: Date }>();
  for (const row of rows) {
    if (row.status !== 200) continue;
    const bot = normalizeBot(row.agent);
    if (bot === "other") continue;
    const existing = byBot.get(bot);
    if (existing) {
      existing.count += 1;
      if (row.at > existing.lastSeen) existing.lastSeen = row.at;
    } else {
      byBot.set(bot, { count: 1, lastSeen: row.at });
    }
  }
  return Array.from(byBot.entries())
    .map(([bot, v]) => ({ bot, count: v.count, lastSeen: v.lastSeen.toISOString() }))
    .sort((a, b) => b.count - a.count || a.bot.localeCompare(b.bot));
}

export type DashboardCrawlerHits = {
  days: number;
  total: number;
  byBot: BotCount[];
};

/** Card data for the dashboard: last N days, successful requests only, one
 * indexed read (CrawlerHit is indexed on [shopId, at]). */
export async function crawlerHitsForDashboard(
  shopDomain: string,
  days = 7,
): Promise<DashboardCrawlerHits> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.crawlerHit.findMany({
    where: { shopId: shopDomain, at: { gte: since } },
    select: { agent: true, handle: true, path: true, status: true, at: true },
  });
  const byBot = summarizeHits(rows);
  return { days, total: byBot.reduce((sum, b) => sum + b.count, 0), byBot };
}

export type TokenCount = { token: string; count: number };

/**
 * Requests that arrived carrying a robots.txt control token as their user
 * agent - Google-Extended, Applebot-Extended. Its own query on purpose:
 * normalizeBot deliberately returns "other" for these, so summarizeHits drops
 * them, and that is correct - they are not crawler reads and must never join a
 * crawler total. The row exists only to say the name was seen and what the
 * name actually is.
 *
 * Successful requests only, on the same rule as summarizeHits: a miss is not
 * a read, whatever name it gave.
 */
export async function nonCrawlerTokenHits(
  shopDomain: string,
  days: number,
): Promise<TokenCount[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.crawlerHit.findMany({
    where: {
      shopId: shopDomain,
      at: { gte: since },
      status: 200,
      // Case-insensitive on purpose: `contains` is case-SENSITIVE on
      // Postgres, while countTokens below lowercases both sides. Without this
      // the query and the counter disagreed - a request calling itself
      // "google-extended" was invisible to the query and would have been
      // counted by the pure half, so the row simply never appeared.
      OR: NON_CRAWLER_TOKENS.map((token) => ({
        agent: { contains: token, mode: "insensitive" as const },
      })),
    },
    select: { agent: true },
  });
  return countTokens(rows.map((r) => r.agent));
}

/** The counting half of nonCrawlerTokenHits, kept pure so the shape can be
 * checked without a database. */
export function countTokens(agents: string[]): TokenCount[] {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const lower = agent.toLowerCase();
    for (const token of NON_CRAWLER_TOKENS) {
      if (lower.includes(token.toLowerCase())) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
        break;
      }
    }
  }
  return NON_CRAWLER_TOKENS.filter((t) => counts.has(t)).map((token) => ({
    token,
    count: counts.get(token) ?? 0,
  }));
}

export type DiagnosticsHitRow = {
  bot: string;
  handle: string | null;
  path: string;
  status: number;
  at: string;
};

export const DIAGNOSTICS_HITS_PAGE_SIZE = 50;

/**
 * The fuller table for Diagnostics: every logged request, not only the
 * successful ones, most recent first. `id` is a BigInt and is never selected
 * here, so there is nothing for a Remix loader to fail on serializing.
 */
export async function recentHitsForDiagnostics(
  shopDomain: string,
  take: number = DIAGNOSTICS_HITS_PAGE_SIZE,
): Promise<DiagnosticsHitRow[]> {
  const rows = await db.crawlerHit.findMany({
    where: { shopId: shopDomain },
    orderBy: { at: "desc" },
    take,
    select: { agent: true, handle: true, path: true, status: true, at: true },
  });
  return rows.map((r) => ({
    bot: normalizeBot(r.agent),
    handle: r.handle,
    path: r.path,
    status: r.status,
    at: r.at.toISOString(),
  }));
}
