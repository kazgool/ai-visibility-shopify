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

// Google-Extended and Applebot-Extended are robots.txt-only tokens, not
// crawlers. Google and Apple's real crawlers (Googlebot, Applebot) fetch the
// page; these tokens only tell the company what it may do afterward with
// what was already fetched. No request ever carries either name, so they are
// deliberately absent from AGENTS - testing them would test nothing, and a
// request claiming to be one of them is something else, usually a scanner.
// Verified against Google Search Central and Apple's Applebot documentation
// on 22 August 2026.
export const NON_CRAWLER_TOKENS = ["Google-Extended", "Applebot-Extended"];
