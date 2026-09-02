import { describe, it, expect } from "vitest";
import {
  countTokens,
  normalizeBot,
  summarizeHits,
  type HitRow,
} from "../crawler-hits.server";

function hit(over: Partial<HitRow> = {}): HitRow {
  return {
    agent: "Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)",
    handle: "gothenburg-dining-table",
    path: "/apps/ai-visibility/gothenburg-dining-table",
    status: 200,
    at: new Date("2026-08-20T10:00:00Z"),
    ...over,
  };
}

describe("normalizeBot", () => {
  it("recognises a known bot from anywhere in the raw user agent", () => {
    expect(normalizeBot("Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)")).toBe(
      "GPTBot",
    );
    expect(normalizeBot("PerplexityBot/1.0")).toBe("PerplexityBot");
  });

  it("does not let a looser name swallow a more specific one", () => {
    expect(
      normalizeBot("Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)"),
    ).toBe("OAI-SearchBot");
  });

  it("groups anything unrecognised as other, never as a named crawler", () => {
    expect(normalizeBot("curl/8.4.0")).toBe("other");
    expect(normalizeBot("")).toBe("other");
  });

  it("recognises the four search-engine names the Report screen lists", () => {
    expect(
      normalizeBot("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"),
    ).toBe("bingbot");
    expect(normalizeBot("Mozilla/5.0 (compatible; Storebot-Google/1.0)")).toBe("Storebot-Google");
    expect(normalizeBot("Mozilla/5.0 (compatible; GoogleOther)")).toBe("GoogleOther");
    expect(normalizeBot("Mozilla/5.0 (compatible; Google-InspectionTool/1.0)")).toBe(
      "Google-InspectionTool",
    );
  });

  it("keeps Googlebot distinct from the more specific Google names", () => {
    expect(normalizeBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("Googlebot");
  });

  it("never names a robots.txt control token as a crawler", () => {
    // No request is ever made under either name, and "Applebot-Extended"
    // contains "Applebot", so without this it would be counted as a real
    // Applebot read.
    expect(normalizeBot("Google-Extended")).toBe("other");
    expect(normalizeBot("Applebot-Extended")).toBe("other");
  });
});

describe("countTokens", () => {
  it("counts the control tokens on their own, never inside a crawler total", () => {
    const agents = [
      "Google-Extended",
      "Google-Extended",
      "Mozilla/5.0 (compatible; GPTBot/1.1)",
      "Applebot-Extended",
    ];
    expect(countTokens(agents)).toEqual([
      { token: "Google-Extended", count: 2 },
      { token: "Applebot-Extended", count: 1 },
    ]);

    // The same rows summarised as crawler reads contribute nothing from the
    // tokens: only the GPTBot request survives.
    const rows: HitRow[] = agents.map((agent) => hit({ agent, status: 200 }));
    expect(summarizeHits(rows)).toEqual([
      { bot: "GPTBot", count: 1, lastSeen: "2026-08-20T10:00:00.000Z" },
    ]);
  });

  it("returns nothing when no request carried a token", () => {
    expect(countTokens(["curl/8.4.0"])).toEqual([]);
  });
});

describe("summarizeHits", () => {
  it("counts only successful requests, per bot, with the most recent time seen", () => {
    const rows: HitRow[] = [
      hit({ agent: "GPTBot/1.1", status: 200, at: new Date("2026-08-20T10:00:00Z") }),
      hit({ agent: "GPTBot/1.1", status: 200, at: new Date("2026-08-21T10:00:00Z") }),
      hit({ agent: "GPTBot/1.1", status: 404, at: new Date("2026-08-22T10:00:00Z") }),
      hit({ agent: "PerplexityBot/1.0", status: 200, at: new Date("2026-08-19T10:00:00Z") }),
    ];

    const summary = summarizeHits(rows);

    expect(summary).toEqual([
      { bot: "GPTBot", count: 2, lastSeen: "2026-08-21T10:00:00.000Z" },
      { bot: "PerplexityBot", count: 1, lastSeen: "2026-08-19T10:00:00.000Z" },
    ]);
  });

  it("a 404 is a miss, not a read - it never inflates the count", () => {
    const rows: HitRow[] = [hit({ status: 404 })];
    expect(summarizeHits(rows)).toEqual([]);
  });

  it("never reports an unrecognised agent as an AI crawler", () => {
    const rows: HitRow[] = [hit({ agent: "curl/8.4.0", status: 200 })];
    expect(summarizeHits(rows)).toEqual([]);
  });

  it("returns nothing for an empty log, not a fabricated zero row", () => {
    expect(summarizeHits([])).toEqual([]);
  });
});
