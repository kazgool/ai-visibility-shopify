// Crawler taxonomy. Deliberately not in a .server file: the diagnostics screen
// renders these strings in its component, and importing a server module from
// anything other than a loader or action pulls it into the client bundle and
// breaks the build. Plain data, no I/O, safe on both sides.

// Who each crawler belongs to and what it is actually fetching for. A
// merchant reading a verdict needs this as much as the verdict itself:
// a training crawler and one answering a live question mean very
// different things for the same "unreachable" result.
export const CRAWLER_INFO: Record<string, { company: string; purpose: string }> = {
  GPTBot: {
    company: "OpenAI",
    purpose: "Crawls to train OpenAI's models.",
  },
  "OAI-SearchBot": {
    company: "OpenAI",
    purpose: "Crawls to build the search index behind ChatGPT search.",
  },
  "ChatGPT-User": {
    company: "OpenAI",
    purpose: "Fetches a page live because a ChatGPT user asked about it right now.",
  },
  "Claude-SearchBot": {
    company: "Anthropic",
    purpose: "Crawls to build the search index behind Claude's web search.",
  },
  PerplexityBot: {
    company: "Perplexity",
    purpose: "Crawls to build the search index behind Perplexity's answers.",
  },
  DeepSeekBot: {
    company: "DeepSeek",
    purpose:
      "Crawls to gather content for DeepSeek's models and search features. DeepSeek has not published an official statement of purpose for this crawler.",
  },
  Applebot: {
    company: "Apple",
    purpose:
      "Crawls to power Siri, Spotlight and Safari search, and to give Apple Intelligence features current context.",
  },
  "Google-CloudVertexBot": {
    company: "Google",
    purpose:
      "Crawls only when a site owner requests it while building a Vertex AI Agent. It does not affect Google Search ranking.",
  },
};

// ---------------------------------------------------------------------------
// Why a reachability check ended the way it did.
//
// The cause is a database enum: it is written to CrawlerCheck.cause and read
// back on two screens. The English for each one lives here, beside the
// taxonomy, and not in crawler-check.server.ts, because the Report screen has
// to render the same sentence and cannot import a .server module. There is one
// map; the check imports it. The Report screen used to print the enum with its
// underscores turned into spaces ("password page"), which is not a sentence and
// is not what this file already had written for it.

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

export const CAUSE_TEXT: Record<Cause, string> = {
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
    "The request could not be completed. This is not the same as being blocked; it may be a timeout or a DNS problem.",
  unknown: "The response was unexpected and could not be classified.",
};

/** The sentence for a cause. Unknown strings - a row written by an older
 * version, or one this build does not know - get a plain fallback rather than
 * the enum itself, because the enum is not English. */
export function explainCause(cause: string | undefined): string {
  if (cause === undefined) return CAUSE_TEXT.unknown;
  return CAUSE_TEXT[cause as Cause] ?? CAUSE_TEXT.unknown;
}

/**
 * Causes that are the shop's own settings rather than anything refusing the
 * request.
 *
 * `robots_disallow` is set on a check whose HTTP request succeeded: the page
 * was served in full, and robots.txt separately names the crawler. Nothing
 * turned anyone away, so "the last check did not get the page" is a false
 * sentence about it, and a message asking the host to stop returning an error
 * asks for a fix to something that never happened.
 *
 * `password_page` is a Shopify preference. Every crawler and every visitor
 * without the password sees the same page, so it is never one crawler being
 * singled out either.
 *
 * Both are fixed by the merchant, in their own admin, and neither belongs in a
 * message addressed to whoever runs the server.
 */
export const OWN_SETTING_CAUSES: readonly string[] = ["robots_disallow", "password_page"];

export function isOwnSetting(cause: string | undefined): boolean {
  return cause !== undefined && OWN_SETTING_CAUSES.includes(cause);
}

/** What the merchant does about it, in their own admin. Written per cause
 * because the two places are nothing alike: one is a line of theme code, the
 * other is a store-wide preference. */
export const OWN_SETTING_FIX: Record<string, string> = {
  robots_disallow:
    "Your own robots.txt names this crawler and tells it not to read the page. Nothing refused the request - the page was served in full - so this is a rule of yours, not a block by anyone else. Edit it in Online Store, Themes, Edit code, robots.txt.liquid.",
  password_page:
    "Your storefront is password protected, so every crawler and every visitor without the password sees the same page. This is not about one crawler and no crawler can be let through on its own. Remove the password in Online Store, Preferences.",
};

// Google-Extended and Applebot-Extended are robots.txt-only tokens, not
// crawlers. Google and Apple's real crawlers (Googlebot, Applebot) fetch the
// page; these tokens only tell the company what it may do afterward with
// what was already fetched. No request ever carries either name, so they are
// deliberately absent from AGENTS - testing them would test nothing, and a
// request claiming to be one of them is something else, usually a scanner.
// Verified against Google Search Central and Apple's Applebot documentation
// on 22 August 2026.
export const NON_CRAWLER_TOKENS = ["Google-Extended", "Applebot-Extended"];
