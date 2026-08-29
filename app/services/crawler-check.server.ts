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
};

export { CRAWLER_INFO, NON_CRAWLER_TOKENS } from "./crawler-info";

export type Cause =
  | "ok"
  | "password_page"
  | "bot_protection"
  | "cloudflare"
  | "redirect_loop"
  | "robots_disallow"
  | "server_error"
  | "unreachable"
  | "unknown";

export type AgentResult = {
  agent: string;
  status: number | null;
  cause: Cause;
  detail: string;
  ms: number;
};

const CAUSE_TEXT: Record<Cause, string> = {
  ok: "Reachable. The page was served in full.",
  password_page:
    "The store is password protected, so every crawler sees the password page instead of your products.",
  bot_protection:
    "A bot-protection layer refused the request. This is usually a security app, or Cloudflare Bot Fight Mode on a custom domain.",
  cloudflare:
    "Cloudflare answered instead of your store. Bot Fight Mode blocks AI crawlers by default.",
  redirect_loop:
    "The request bounced between redirects and never reached a product page. A redirect app is the usual cause.",
  robots_disallow: "robots.txt tells this crawler not to read the page.",
  server_error: "The store returned a server error for this crawler.",
  unreachable:
    "The request could not be completed. This is not the same as being blocked — it may be a timeout or a DNS problem.",
  unknown: "The response was unexpected and could not be classified.",
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
      return {
        agent: name,
        status: res.status,
        cause,
        detail: explain(cause),
        ms: Date.now() - started,
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

/** Read robots.txt once and report which of our agents it disallows. */
export async function robotsDisallows(origin: string): Promise<string[]> {
  try {
    const res = await fetchOnce(`${origin}/robots.txt`, AGENTS.GPTBot, 8000);
    if (!res.ok) return [];
    const text = await res.text();

    const disallowed: string[] = [];
    const blocks = text.split(/\n(?=user-agent:)/i);
    for (const block of blocks) {
      const agentLine = block.match(/user-agent:\s*(.+)/i)?.[1]?.trim() ?? "";
      const blocksAll = /disallow:\s*\/\s*$/im.test(block);
      if (!blocksAll) continue;
      for (const name of Object.keys(AGENTS)) {
        if (agentLine === "*" || agentLine.toLowerCase() === name.toLowerCase()) {
          disallowed.push(name);
        }
      }
    }
    return Array.from(new Set(disallowed));
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

  return { targetUrl, results, robotsDisallows: disallowed };
}
