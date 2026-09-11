import { describe, expect, it } from "vitest";
import {
  CRAWLER_FAMILIES,
  CRAWLER_INFO,
  disallowedAgents,
  familyReport,
  ROBOTS_ONLY_TOKENS,
  TRAINING_BLOCKED_SENTENCE,
  type AgentCheckLike,
} from "../crawler-info";
import { AGENTS } from "../crawler-check.server";

// PRD-AI-READABILITY P0.9: the crawler check grouped into training, search
// index and user fetch, each reported for robots.txt, the page's answer and
// this app's visible block.

const members = (family: string) =>
  CRAWLER_FAMILIES.find((f) => f.family === family)!.members.map((m) => m.name);

describe("the three families", () => {
  it("hold exactly the crawlers the brief names", () => {
    expect(members("training")).toEqual(["GPTBot", "ClaudeBot", "Google-Extended", "CCBot"]);
    expect(members("searchIndex")).toEqual([
      "OAI-SearchBot",
      "Claude-SearchBot",
      "PerplexityBot",
      "Googlebot",
      "Bingbot",
    ]);
    expect(members("userFetch")).toEqual(["ChatGPT-User", "Claude-User", "Perplexity-User"]);
  });

  it("fetch a page as every member except the robots.txt-only token", () => {
    expect(ROBOTS_ONLY_TOKENS).toEqual(["Google-Extended"]);
    for (const family of CRAWLER_FAMILIES) {
      for (const m of family.members) {
        if (m.robotsOnly) expect(AGENTS[m.name]).toBeUndefined();
        else expect(AGENTS[m.name], m.name).toBeTruthy();
      }
    }
  });

  it("keep the check's original agents, none removed", () => {
    for (const name of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "PerplexityBot"]) {
      expect(AGENTS[name]).toBeTruthy();
    }
    for (const name of ["DeepSeekBot", "Applebot", "Google-CloudVertexBot"]) {
      expect(AGENTS[name]).toBeTruthy();
    }
  });

  it("give every fetched member a company and a plain purpose on the Diagnostics screen", () => {
    for (const name of Object.keys(AGENTS)) {
      expect(CRAWLER_INFO[name]?.company, name).toBeTruthy();
      expect(CRAWLER_INFO[name]?.purpose, name).toBeTruthy();
    }
  });

  it("quote each purpose in plain characters", () => {
    for (const family of CRAWLER_FAMILIES) {
      expect(family.means).not.toMatch(/[–—‘’“”…]/);
      for (const m of family.members) {
        expect(m.purpose.length, m.name).toBeGreaterThan(10);
        expect(m.purpose).not.toMatch(/[–—‘’“”…]/);
      }
    }
  });
});

describe("disallowedAgents: the robots.txt reading, moved and unchanged", () => {
  it("names a crawler whose group disallows the whole site", () => {
    expect(disallowedAgents("User-agent: GPTBot\nDisallow: /\n", ["GPTBot", "ClaudeBot"])).toEqual(["GPTBot"]);
  });

  it("reads a robots.txt-only token like any other name", () => {
    const robots = "User-agent: Google-Extended\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n";
    expect(disallowedAgents(robots, ["Googlebot", "Google-Extended"])).toEqual(["Google-Extended"]);
  });

  it("names every crawler under a wildcard group that disallows everything", () => {
    expect(disallowedAgents("User-agent: *\nDisallow: /\n", ["GPTBot", "CCBot"])).toEqual(["GPTBot", "CCBot"]);
  });

  it("names none under Shopify's default rules, which block no AI crawler", () => {
    const shopify = "User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /search\n";
    expect(disallowedAgents(shopify, Object.keys(AGENTS))).toEqual([]);
  });
});

describe("familyReport", () => {
  const ok = (agent: string, visibleContent = true): AgentCheckLike => ({
    agent,
    status: 200,
    cause: "ok",
    visibleContent,
  });
  const all = Object.keys(AGENTS).map((a) => ok(a));

  it("training: tells the merchant, in one sentence, what blocking a training crawler costs", () => {
    const [training] = familyReport(all, ["GPTBot", "Google-Extended"]);
    expect(training.family).toBe("training");
    const gpt = training.agents.find((a) => a.name === "GPTBot")!;
    expect(gpt.robotsAllowed).toBe(false);
    expect(gpt.note).toBe(TRAINING_BLOCKED_SENTENCE);
    expect(TRAINING_BLOCKED_SENTENCE).toBe(
      "This crawler collects pages that train the model. Blocking it means the model will not learn your products from your own site.",
    );
    expect(training.agents.find((a) => a.name === "Google-Extended")!.note).toBe(TRAINING_BLOCKED_SENTENCE);
    expect(training.agents.find((a) => a.name === "ClaudeBot")!.note).toBeNull();
    expect(training.robotsAllowed).toBe(2);
  });

  it("training: asks Google-Extended of robots.txt only, and says there is no page for it", () => {
    const [training] = familyReport(all, []);
    const token = training.agents.find((a) => a.name === "Google-Extended")!;
    expect(token.pageOk).toBeNull();
    expect(token.visibleContent).toBeNull();
    expect(training.pageChecked).toBe(3);
  });

  it("search index: counts pages that answered 200 and carried the visible block", () => {
    const results = [
      ...all.filter((r) => !["Googlebot", "Bingbot"].includes(r.agent)),
      { agent: "Googlebot", status: 403, cause: "cloudflare" },
      ok("Bingbot", false),
    ];
    const search = familyReport(results, []).find((f) => f.family === "searchIndex")!;
    expect(search.pageChecked).toBe(5);
    expect(search.pageOk).toBe(4);
    expect(search.visibleContent).toBe(3);
    expect(search.agents.every((a) => a.note === null)).toBe(true);
  });

  it("user fetch: a page served in full to a crawler robots.txt names still answered 200", () => {
    const results = all.map((r) => (r.agent === "ChatGPT-User" ? { ...r, cause: "robots_disallow" } : r));
    const fetch = familyReport(results, ["ChatGPT-User"]).find((f) => f.family === "userFetch")!;
    const chatgpt = fetch.agents.find((a) => a.name === "ChatGPT-User")!;
    expect(chatgpt.robotsAllowed).toBe(false);
    expect(chatgpt.pageOk).toBe(true);
    expect(chatgpt.note).toBeNull();
  });

  it("reports a password page as not a 200 product page, and no visible block", () => {
    const results = all.map((r) => ({ ...r, cause: "password_page", visibleContent: false }));
    for (const family of familyReport(results, [])) {
      expect(family.pageOk).toBe(0);
      expect(family.visibleContent).toBe(0);
    }
  });
});
