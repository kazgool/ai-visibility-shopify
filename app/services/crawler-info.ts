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
  // Added 11 September 2026 with the crawler families below.
  ClaudeBot: {
    company: "Anthropic",
    purpose: "Crawls to collect pages used to train Anthropic's models.",
  },
  CCBot: {
    company: "Common Crawl",
    purpose: "Crawls for Common Crawl's open archive of the web, a common source of model training data.",
  },
  Googlebot: {
    company: "Google",
    purpose: "Crawls to build Google's search index, which AI Overviews and AI Mode answer from.",
  },
  Bingbot: {
    company: "Microsoft",
    purpose: "Crawls to build the Bing search index.",
  },
  "Claude-User": {
    company: "Anthropic",
    purpose: "Fetches a page live because a Claude user asked about it right now.",
  },
  "Perplexity-User": {
    company: "Perplexity",
    purpose: "Fetches a page live because a Perplexity user asked about it right now.",
  },
};

// ---------------------------------------------------------------------------
// Crawler families (PRD-AI-READABILITY P0.9, 11 September 2026).
//
// Three kinds of reader, three different consequences. A training crawler
// decides what a model knows about the store with no search at all; a
// search-index crawler decides what an AI search can find; a user fetcher
// reads the page when somebody asks. Each member's `purpose` is the vendor's
// own words, quoted, with the page it is quoted from in the comment above it.
// The family a crawler sits in is this app's reading of those words.

export type CrawlerFamily = "training" | "searchIndex" | "userFetch";

export type FamilyMember = {
  name: string;
  company: string;
  /** The vendor's documented purpose, quoted; see the comment on each entry. */
  purpose: string;
  /** A robots.txt token only: no request ever carries it, so no page is fetched. */
  robotsOnly?: boolean;
};

export const CRAWLER_FAMILIES: {
  family: CrawlerFamily;
  label: string;
  means: string;
  members: FamilyMember[];
}[] = [
  {
    family: "training",
    label: "Training",
    means: "Collects pages that train the model. What a model says about your store without searching comes from here.",
    members: [
      // https://developers.openai.com/api/docs/bots (read 11 September 2026)
      { name: "GPTBot", company: "OpenAI", purpose: "crawl content that may be used in training our generative AI foundation models" },
      // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
      { name: "ClaudeBot", company: "Anthropic", purpose: "helps enhance the utility and safety of our generative AI models" },
      // https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
      // A robots.txt token, not a fetcher: it governs what Google's own
      // crawlers' pages may be used for, so only robots.txt can be asked.
      { name: "Google-Extended", company: "Google", purpose: "may be used for training future generations of Gemini models", robotsOnly: true },
      // https://commoncrawl.org/ccbot - Common Crawl describes an archive, not
      // training; it sits here because that archive is widely used to train
      // models, which is this app's reading and not Common Crawl's words.
      { name: "CCBot", company: "Common Crawl", purpose: "an open repository of web crawl data" },
    ],
  },
  {
    family: "searchIndex",
    label: "Search index",
    means: "Builds the index an AI search answers from. A page missing here is a page the search cannot cite.",
    members: [
      // https://developers.openai.com/api/docs/bots
      { name: "OAI-SearchBot", company: "OpenAI", purpose: "surface websites in search results in ChatGPT's search features" },
      // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
      { name: "Claude-SearchBot", company: "Anthropic", purpose: "navigates the web to improve search result quality for users" },
      // https://docs.perplexity.ai/guides/bots
      { name: "PerplexityBot", company: "Perplexity", purpose: "designed to surface and link websites in search results on Perplexity" },
      // https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
      { name: "Googlebot", company: "Google", purpose: "Find information for building Google's search indexes" },
      // https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0
      // NOT a quote: the page renders client-side and returned no text to a
      // fetch on 11 September 2026. Our words until someone quotes Bing's.
      { name: "Bingbot", company: "Microsoft", purpose: "crawls for the Bing search index (Bing's own wording not yet quoted)" },
    ],
  },
  {
    family: "userFetch",
    label: "User fetch",
    means: "Reads the page live because somebody asked about it just now.",
    members: [
      // https://developers.openai.com/api/docs/bots
      { name: "ChatGPT-User", company: "OpenAI", purpose: "certain user actions in ChatGPT and Custom GPTs" },
      // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
      { name: "Claude-User", company: "Anthropic", purpose: "supports Claude AI users" },
      // https://docs.perplexity.ai/guides/bots
      { name: "Perplexity-User", company: "Perplexity", purpose: "supports user actions within Perplexity" },
    ],
  },
];

/** Robots.txt tokens the check asks about that no request ever carries. */
export const ROBOTS_ONLY_TOKENS: string[] = CRAWLER_FAMILIES.flatMap((f) =>
  f.members.filter((m) => m.robotsOnly).map((m) => m.name),
);

/** Said once, to a merchant whose robots.txt turns a training crawler away. The choice stays theirs. */
export const TRAINING_BLOCKED_SENTENCE =
  "This crawler collects pages that train the model. Blocking it means the model will not learn your products from your own site.";

/**
 * Which of `names` a robots.txt turns away from the whole site. Ported
 * unchanged from robotsDisallows (a group whose Disallow is "/" and whose
 * user-agent is the name or "*"), and moved here so it can be tested without
 * a fetch.
 */
export function disallowedAgents(robotsTxt: string, names: string[]): string[] {
  const disallowed: string[] = [];
  const blocks = robotsTxt.split(/\n(?=user-agent:)/i);
  for (const block of blocks) {
    const agentLine = block.match(/user-agent:\s*(.+)/i)?.[1]?.trim() ?? "";
    const blocksAll = /disallow:\s*\/\s*$/im.test(block);
    if (!blocksAll) continue;
    for (const name of names) {
      if (agentLine === "*" || agentLine.toLowerCase() === name.toLowerCase()) {
        disallowed.push(name);
      }
    }
  }
  return Array.from(new Set(disallowed));
}

export type AgentCheckLike = {
  agent: string;
  status: number | null;
  cause: string;
  visibleContent?: boolean;
};

export type FamilyAgentReport = {
  name: string;
  company: string;
  purpose: string;
  robotsAllowed: boolean;
  /** Null for a robots.txt-only token, which has no page to fetch. */
  pageOk: boolean | null;
  /** Whether the response carried this app's visible content block. Null when not fetched. */
  visibleContent: boolean | null;
  /** The one sentence for a blocked training crawler, otherwise null. */
  note: string | null;
};

export type FamilyReport = {
  family: CrawlerFamily;
  label: string;
  means: string;
  agents: FamilyAgentReport[];
  robotsAllowed: number;
  /** Members a page was fetched for: the denominator of pageOk and visibleContent. */
  pageChecked: number;
  pageOk: number;
  visibleContent: number;
};

/**
 * The check's results, by family: allowed by robots.txt, page returned 200
 * to that user agent, and whether the response contained the visible block.
 * A page served in full to a crawler robots.txt names still counts as 200:
 * nothing refused it, robots.txt is the separate answer.
 */
export function familyReport(results: AgentCheckLike[], disallowed: string[]): FamilyReport[] {
  const blocked = new Set(disallowed.map((d) => d.toLowerCase()));
  return CRAWLER_FAMILIES.map(({ family, label, means, members }) => {
    const agents: FamilyAgentReport[] = members.map((m) => {
      const result = m.robotsOnly ? undefined : results.find((r) => r.agent === m.name);
      const robotsAllowed = !blocked.has(m.name.toLowerCase());
      const pageOk = result
        ? result.status === 200 && (result.cause === "ok" || result.cause === "robots_disallow")
        : null;
      return {
        name: m.name,
        company: m.company,
        purpose: m.purpose,
        robotsAllowed,
        pageOk,
        visibleContent: result ? pageOk === true && result.visibleContent === true : null,
        note: family === "training" && !robotsAllowed ? TRAINING_BLOCKED_SENTENCE : null,
      };
    });
    const fetched = agents.filter((a) => a.pageOk !== null);
    return {
      family,
      label,
      means,
      agents,
      robotsAllowed: agents.filter((a) => a.robotsAllowed).length,
      pageChecked: fetched.length,
      pageOk: fetched.filter((a) => a.pageOk).length,
      visibleContent: fetched.filter((a) => a.visibleContent).length,
    };
  });
}

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
