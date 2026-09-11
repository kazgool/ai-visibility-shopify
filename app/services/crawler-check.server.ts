// Crawler reachability (PRD §4.5).
//
// The only honest test is an external request carrying the exact user agent,
// made from outside Shopify's network. Parsing robots.txt is not enough: the
// file can allow a bot that a security layer then blocks.
//
// Two lessons ported from the WordPress module (1.6.2): retry once before
// calling something blocked, and never report a timeout as a firewall block.
// A wrong diagnosis costs more trust than no diagnosis.

import db from "../db.server";

export const AGENTS: Record<string, string> = {
  GPTBot: "Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)",
  "OAI-SearchBot":
    "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
  "ChatGPT-User":
    "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
  "Claude-SearchBot":
    "Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://anthropic.com/claude-searchbot)",
  PerplexityBot:
    "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  DeepSeekBot: "Mozilla/5.0 (compatible; DeepSeekBot/1.0; +https://www.deepseek.com/about)",
  Applebot:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  "Google-CloudVertexBot":
    "Mozilla/5.0 (compatible; Google-CloudVertexBot; +https://cloud.google.com/generative-ai-app-builder/docs/prepare-data#website)",
  // Added 11 September 2026 for the three crawler families (crawler-info.ts,
  // CRAWLER_FAMILIES). The eight above are unchanged, including the five the
  // check started with. Strings as the vendors publish them where a fetch
  // could read the page (OpenAI, Perplexity, Google, Common Crawl); CCBot's
  // carries no "Mozilla" prefix because Common Crawl's does not.
  ClaudeBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  CCBot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  Googlebot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36",
  Bingbot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/131.0.0.0 Safari/537.36",
  "Claude-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  "Perplexity-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
};

/**
 * Crawlers whose real traffic a firewall may recognise by address rather than
 * by name. A request of ours carrying the name comes from our address, so a
 * store behind such a rule refuses it while letting the real crawler in. A
 * refusal of these is therefore reported with that said, never as a plain
 * block: telling a merchant Googlebot is blocked when only our imitation was
 * would be the wrong diagnosis the header warns about.
 */
const VERIFIED_BY_ADDRESS = new Set(["Googlebot", "Bingbot"]);
const VERIFIED_BY_ADDRESS_NOTE =
  " This crawler's real requests come from its own published addresses, and some firewalls let only those through, so a refusal of this test request does not prove the real crawler is refused. Google Search Console and Bing Webmaster Tools answer that from the inside.";

import { CAUSE_TEXT, disallowedAgents, familyReport, ROBOTS_ONLY_TOKENS, type Cause } from "./crawler-info";
import { VISIBLE_CONTENT_CLASS } from "./seo-onpage";

export { CRAWLER_INFO, NON_CRAWLER_TOKENS } from "./crawler-info";

// The cause taxonomy and its English both live in crawler-info.ts, which is not
// a .server module. The Report screen renders the same sentences in its own
// component and cannot import this file; keeping a second copy here is how the
// two drifted, and how the screen ended up printing "password page" beside a
// sentence that already existed. One map, imported by both sides.
export type { Cause } from "./crawler-info";

export type AgentResult = {
  agent: string;
  status: number | null;
  cause: Cause;
  detail: string;
  ms: number;
  /** The response carried this app's visible content block (PRD-AI-READABILITY P0.9). */
  visibleContent?: boolean;
};

export function explain(cause: Cause): string {
  return CAUSE_TEXT[cause];
}

function classify(res: Response, body: string): Cause {
  const server = (res.headers.get("server") ?? "").toLowerCase();

  if (res.status === 200) {
    if (/name=["']password["']/i.test(body) && !/ld\+json/i.test(body)) {
      return "password_page";
    }
    return "ok";
  }
  if (res.status === 401 || res.status === 403) {
    if (server.includes("cloudflare") || /cf-ray/i.test([...res.headers.keys()].join(" "))) {
      return "cloudflare";
    }
    return "bot_protection";
  }
  if (res.status === 429) return "bot_protection";
  if (res.status >= 500) return "server_error";
  return "unknown";
}

async function fetchOnce(url: string, agent: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": agent, Accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkAgent(url: string, name: string, agent: string): Promise<AgentResult> {
  const started = Date.now();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetchOnce(url, agent);
      const body = await res.text();
      const cause = classify(res, body);
      const refused = cause === "bot_protection" || cause === "cloudflare";
      return {
        agent: name,
        status: res.status,
        cause,
        detail: explain(cause) + (refused && VERIFIED_BY_ADDRESS.has(name) ? VERIFIED_BY_ADDRESS_NOTE : ""),
        ms: Date.now() - started,
        visibleContent: cause === "ok" && body.includes(VISIBLE_CONTENT_CLASS),
      };
    } catch (error) {
      // A single failure is not evidence of blocking — a store testing itself
      // competes with itself for capacity. Retry before concluding anything.
      if (attempt === 1) {
        return {
          agent: name,
          status: null,
          cause: "unreachable",
          detail: `${explain("unreachable")} (${String(error)})`,
          ms: Date.now() - started,
        };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return {
    agent: name,
    status: null,
    cause: "unknown",
    detail: explain("unknown"),
    ms: Date.now() - started,
  };
}

/**
 * Read robots.txt once and report which of our agents it disallows, plus the
 * robots.txt-only tokens (Google-Extended), which are asked here and nowhere
 * else because no request ever carries them. The parser is disallowedAgents
 * in crawler-info.ts, unchanged in behaviour, moved so it can be tested.
 */
export async function robotsDisallows(origin: string): Promise<string[]> {
  try {
    const res = await fetchOnce(`${origin}/robots.txt`, AGENTS.GPTBot, 8000);
    if (!res.ok) return [];
    const text = await res.text();
    return disallowedAgents(text, [...Object.keys(AGENTS), ...ROBOTS_ONLY_TOKENS]);
  } catch {
    return [];
  }
}

export async function runCrawlerCheck(shopId: string, targetUrl: string) {
  const origin = new URL(targetUrl).origin;
  const disallowed = await robotsDisallows(origin);

  const results: AgentResult[] = [];
  for (const [name, agent] of Object.entries(AGENTS)) {
    const result = await checkAgent(targetUrl, name, agent);
    // robots.txt is advisory, but if it disallows the agent that is the
    // finding the merchant can actually act on.
    //
    // Note what this cause does NOT mean: the request above succeeded and the
    // page came back in full. Nothing refused anything. Anywhere this cause is
    // rendered it has to read as the shop's own rule, never as a block - see
    // OWN_SETTING_CAUSES in crawler-info.ts.
    if (result.cause === "ok" && disallowed.includes(name)) {
      result.cause = "robots_disallow";
      result.detail = explain("robots_disallow");
    }
    results.push(result);

    await db.crawlerCheck.create({
      data: {
        shopId,
        agent: name,
        status: result.status,
        cause: result.cause,
      },
    });
  }

  // By family (PRD-AI-READABILITY P0.9): robots.txt, the page's answer and the
  // visible block, per training, search-index and user-fetch crawler. Carried
  // in the JobRun report and the Diagnostics result; no new column.
  return { targetUrl, results, robotsDisallows: disallowed, families: familyReport(results, disallowed) };
}
