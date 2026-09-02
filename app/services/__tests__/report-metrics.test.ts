import { describe, it, expect } from "vitest";
import {
  READY_FAMILIES,
  buildFindings,
  crawlerRows,
  depthHistogram,
  depthState,
  detailSummary,
  dialArc,
  familiesCsv,
  formatDay,
  hasDepth,
  highlightSpans,
  isInconclusive,
  missingFamilies,
  passOn,
  readPass,
  readiness,
  weakestCsv,
} from "../report-metrics";
import { CAUSE_TEXT } from "../crawler-info";

function doneJob(report: unknown) {
  return {
    status: "done",
    report,
    startedAt: "2026-08-31T08:00:00.000Z",
    finishedAt: "2026-08-31T08:04:00.000Z",
  };
}

const FIGURES = {
  sampled: 5,
  none: 1,
  byAttr: [
    ["Material", 5],
    ["Dimensions", 4],
    ["Colour", 2],
  ] as [string, number][],
  byAttrProducts: [
    ["Material", 4],
    ["Dimensions", 3],
    ["Colour", 2],
  ] as [string, number][],
  depth: [0, 1, 4, 6, 18],
  wouldSkip: 0,
  weakest: [
    { title: "Bergen bedside table", families: [] },
    { title: "Stavanger shelf", families: ["Material"] },
  ],
};

describe("readPass", () => {
  it("treats a failed job as a named failure, never as a measurement of zero", () => {
    // The trap this codebase already shipped once: `{ error }` is truthy, so
    // a failed report read without a status check renders as figures.
    const state = readPass({
      status: "failed",
      report: { error: "Admin API returned 502" },
      startedAt: "2026-08-31T08:00:00.000Z",
      finishedAt: "2026-08-31T08:01:00.000Z",
    });
    expect(state.state).toBe("failed");
    if (state.state !== "failed") throw new Error("unreachable");
    expect(state.reason).toBe("Admin API returned 502");
  });

  it("reports no pass at all separately from a failed one", () => {
    expect(readPass(null).state).toBe("none");
    expect(readPass(undefined).state).toBe("none");
  });

  it("reports a running pass as running, not as an empty result", () => {
    expect(readPass({ status: "running", report: null, startedAt: null, finishedAt: null }).state).toBe(
      "running",
    );
  });

  it("yields figures only from a done job", () => {
    const state = readPass(doneJob(FIGURES));
    expect(state.state).toBe("done");
    if (state.state !== "done") throw new Error("unreachable");
    expect(state.figures.sampled).toBe(5);
    expect(state.figures.depth).toEqual([0, 1, 4, 6, 18]);
  });

  it("refuses a done job whose report carries no figures", () => {
    expect(readPass(doneJob(null)).state).toBe("failed");
    expect(readPass(doneJob({ notAReport: true })).state).toBe("failed");
  });

  it("does not invent a distribution for a report written before depth existed", () => {
    const state = readPass(doneJob({ sampled: 5, none: 1, byAttr: [], wouldSkip: 0 }));
    if (state.state !== "done") throw new Error("unreachable");
    expect(state.figures.depth).toEqual([]);
    expect(hasDepth(state.figures)).toBe(false);
  });

  it("tells a refusal apart from a failure", () => {
    // worker/tasks.ts writes status "refused" with a reason when a shop has no
    // active subscription. Nothing went wrong; the pass was declined.
    const state = readPass({
      status: "refused",
      report: {
        refused: true,
        reason: "This shop has no active subscription, so the catalogue pass is not available.",
      },
      startedAt: "2026-08-31T08:00:00.000Z",
      finishedAt: "2026-08-31T08:00:01.000Z",
    });
    expect(state.state).toBe("refused");
    if (state.state !== "refused") throw new Error("unreachable");
    expect(state.reason).toContain("no active subscription");
  });

  it("leaves byAttrProducts undefined on a report written before it existed", () => {
    const before = readPass(doneJob({ sampled: 5, none: 1, byAttr: [["Material", 9]] }));
    if (before.state !== "done") throw new Error("unreachable");
    expect(before.figures.byAttrProducts).toBeUndefined();

    const after = readPass(doneJob(FIGURES));
    if (after.state !== "done") throw new Error("unreachable");
    expect(after.figures.byAttrProducts).toEqual(FIGURES.byAttrProducts);
  });
});

describe("formatDay", () => {
  it("writes the date out in English, in UTC, whatever the server locale is", () => {
    expect(formatDay("2026-08-31T08:04:00.000Z")).toBe("31 August 2026");
    expect(formatDay("2026-01-01T00:30:00.000Z")).toBe("1 January 2026");
  });

  it("returns null rather than naming an unknown date", () => {
    expect(formatDay(null)).toBeNull();
    expect(formatDay(undefined)).toBeNull();
    expect(formatDay("not a date")).toBeNull();
    // And the clause that goes into a method line simply carries no date.
    expect(passOn(formatDay(null))).toBe("the last pass");
    expect(passOn(formatDay("2026-08-31T08:04:00.000Z"))).toBe("the pass on 31 August 2026");
  });
});

describe("dialArc", () => {
  it("never sets the large-arc flag, because a semicircle cannot sweep 180 degrees", () => {
    for (const percent of [0, 1, 49, 50, 51, 75, 99, 100, -20, 400]) {
      expect(dialArc(percent, 78, 100, 78).large).toBe(0);
      expect(dialArc(percent, 78, 100, 78).d).toContain("A 78 78 0 0 1");
    }
  });

  it("ends on the upper half of the circle, so the stroke never goes round the bottom", () => {
    // y is measured downwards from the top of the viewBox and cy is 78, so a
    // point on the drawn semicircle always has y <= cy.
    for (const percent of [0, 25, 50, 51, 75, 100]) {
      expect(dialArc(percent, 78, 100, 78).y).toBeLessThanOrEqual(78 + 1e-9);
    }
    // 100 percent lands at the far end of the diameter, 0 percent at the near.
    expect(dialArc(100, 78, 100, 78).x).toBeCloseTo(178, 6);
    expect(dialArc(0, 78, 100, 78).x).toBeCloseTo(22, 6);
  });
});

describe("depthState", () => {
  it("tells a shop with no active published products apart from a stale report", () => {
    expect(depthState({ ...FIGURES })).toBe("ok");
    expect(depthState({ ...FIGURES, sampled: 0, none: 0, depth: [] })).toBe("no products");
    expect(depthState({ ...FIGURES, depth: [] })).toBe("predates");
  });
});

describe("readiness", () => {
  it("splits into ready, partly ready and nothing to read, summing to the total", () => {
    const r = readiness([0, 0, 1, 3, 4, 9]);
    expect(READY_FAMILIES).toBe(4);
    expect(r).toEqual({ total: 6, ready: 2, partly: 2, nothing: 2, percent: 33 });
    expect(r.ready + r.partly + r.nothing).toBe(r.total);
  });

  it("reports zero, not a division by zero, for an empty catalogue", () => {
    expect(readiness([])).toEqual({ total: 0, ready: 0, partly: 0, nothing: 0, percent: 0 });
  });
});

describe("detailSummary", () => {
  it("computes the average, over the products that stated something", () => {
    const s = detailSummary(FIGURES);
    expect(s.values).toBe(11);
    expect(s.describing).toBe(4);
    // The label on the screen says "on average" and this is the mean: 11 / 4.
    expect(s.average).toBe(2.8);
  });

  it("is the mean and not the median, which on this input differ", () => {
    const figures = {
      ...FIGURES,
      sampled: 3,
      none: 0,
      byAttr: [["Material", 30]] as [string, number][],
      depth: [1, 1, 28],
    };
    const s = detailSummary(figures);
    expect(s.average).toBe(10);
    const sorted = [...figures.depth].sort((a, b) => a - b);
    expect(sorted[1]).toBe(1);
  });
});

describe("depthHistogram", () => {
  it("keeps single values to five, with an exact edge at the ready threshold", () => {
    const buckets = depthHistogram([0, 0, 4, 5, 5]);
    expect(buckets.map((b) => b.label)).toEqual([
      "0", "1", "2", "3", "4", "5", "6-7", "8-9", "10-12", "13-15", "16-19", "20+",
    ]);
    expect(buckets[0]).toEqual({ label: "0", count: 2 });
    // READY_FAMILIES is 4 and the segmented bar splits there, so the histogram
    // has to split there too or the two panels disagree about the same product.
    expect(buckets[4]).toEqual({ label: "4", count: 1 });
    expect(buckets[5]).toEqual({ label: "5", count: 2 });
  });

  it("widens the tail so a rich catalogue is not one bar", () => {
    // Republica BIO, 189 real products with their own dictionary: the old
    // scheme put 169 of them in a single "10+" bar. These are the real depths.
    const rb: number[] = [];
    const tally: [number, number][] = [
      [1, 4], [2, 2], [5, 1], [7, 1], [8, 1], [9, 11], [10, 22], [11, 10],
      [12, 12], [13, 31], [14, 12], [15, 12], [16, 27], [17, 16], [18, 12],
      [19, 7], [20, 3], [21, 1], [22, 2], [23, 2],
    ];
    for (const [depth, n] of tally) for (let i = 0; i < n; i += 1) rb.push(depth);
    expect(rb).toHaveLength(189);

    const buckets = depthHistogram(rb);
    expect(Object.fromEntries(buckets.map((b) => [b.label, b.count]))).toEqual({
      "0": 0, "1": 4, "2": 2, "3": 0, "4": 0, "5": 1,
      "6-7": 1, "8-9": 12, "10-12": 44, "13-15": 55, "16-19": 62, "20+": 8,
    });
    // The tallest bar now holds a third of the catalogue, where one used to
    // hold 89 percent of it and the other ten bars carried nothing.
    expect(Math.max(...buckets.map((b) => b.count))).toBeLessThan(rb.length / 2);
    expect(buckets.filter((b) => b.count > 0)).toHaveLength(9);
  });

  it("puts every product in exactly one bucket, so the bars add up", () => {
    const depth = [0, 0, 4, 9, 10, 25, 6, 19, 20];
    const buckets = depthHistogram(depth);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(depth.length);
    expect(buckets[11]).toEqual({ label: "20+", count: 2 });
  });
});

describe("missingFamilies", () => {
  it("names only families this catalogue actually states", () => {
    expect(missingFamilies(["Material"], FIGURES.byAttr)).toEqual(["Dimensions", "Colour"]);
  });

  it("returns nothing when the product states every family there is", () => {
    expect(missingFamilies(["Material", "Dimensions", "Colour"], FIGURES.byAttr)).toEqual([]);
  });
});

describe("highlightSpans", () => {
  it("marks the values it can find and leaves the text otherwise intact", () => {
    const segments = highlightSpans("Solid oak table, 45 x 40 cm.", ["oak", "45 x 40 cm"]);
    expect(segments.map((s) => s.text).join("")).toBe("Solid oak table, 45 x 40 cm.");
    expect(segments.filter((s) => s.highlighted).map((s) => s.text)).toEqual([
      "oak",
      "45 x 40 cm",
    ]);
  });

  it("drops a value it cannot find rather than the row it belongs to", () => {
    const segments = highlightSpans("Solid oak table.", ["oak", "3 year warranty"]);
    expect(segments.filter((s) => s.highlighted)).toHaveLength(1);
  });

  it("never nests overlapping matches", () => {
    const segments = highlightSpans("natural white oak", ["natural white", "white"]);
    expect(segments.map((s) => s.text).join("")).toBe("natural white oak");
    expect(segments.filter((s) => s.highlighted).map((s) => s.text)).toEqual(["natural white"]);
  });
});

describe("crawlerRows", () => {
  it("says not checked rather than blocked when there is no check on record", () => {
    const rows = crawlerRows(["GPTBot", "ClaudeBot"], [{ bot: "GPTBot", count: 4 }], [
      { agent: "GPTBot", cause: "ok" },
    ]);
    expect(rows[0]).toMatchObject({ bot: "GPTBot", access: "yes", requests: 4 });
    expect(rows[1]).toMatchObject({ bot: "ClaudeBot", access: "not checked", requests: 0 });
  });

  it("reports a refused check as blocked, whatever the count says", () => {
    const rows = crawlerRows(["PerplexityBot"], [{ bot: "PerplexityBot", count: 9 }], [
      { agent: "PerplexityBot", cause: "bot_protection" },
    ]);
    expect(rows[0].access).toBe("blocked");
  });

  it("does not call the shop's own settings a block", () => {
    // robots_disallow is written on a check whose HTTP request SUCCEEDED: the
    // page came back in full and robots.txt separately names the crawler.
    // "The last check did not get the page" is a false sentence about it.
    const robots = crawlerRows(["GPTBot"], [], [{ agent: "GPTBot", cause: "robots_disallow" }]);
    expect(robots[0].access).toBe("no, your setting");
    expect(robots[0].accessDetail).not.toContain("did not get the page");
    expect(robots[0].accessDetail).toContain("robots.txt.liquid");

    // The password wall is a Shopify preference and every crawler sees it, so
    // the fix is not about one crawler and is not the host's to make.
    const password = crawlerRows(["GPTBot"], [], [{ agent: "GPTBot", cause: "password_page" }]);
    expect(password[0].access).toBe("no, your setting");
    expect(password[0].accessDetail).toContain("Online Store, Preferences");
    expect(password[0].accessDetail).toContain("not about one crawler");
  });

  it("prints the sentence for a cause, never the database enum", () => {
    // The row used to render cause.replace(/_/g, " "), so a merchant read
    // "bot protection" where crawler-info.ts already had a full sentence.
    const rows = crawlerRows(["GPTBot"], [], [{ agent: "GPTBot", cause: "bot_protection" }]);
    expect(rows[0].accessDetail).toBe(
      "The last check did not get the page. A bot-protection layer refused the request. This is usually a security app, or Cloudflare Bot Fight Mode on a custom domain.",
    );
    // Every cause the check can write renders the sentence crawler-info.ts
    // holds for it, from the one map both sides read.
    for (const cause of Object.keys(CAUSE_TEXT)) {
      if (cause === "ok") continue;
      const row = crawlerRows(["GPTBot"], [], [{ agent: "GPTBot", cause }])[0];
      if (isInconclusive(cause)) continue;
      expect(row.accessDetail).toContain(CAUSE_TEXT[cause as keyof typeof CAUSE_TEXT]);
    }
  });

  it("does not call a check that never got an answer a block", () => {
    // crawler-check.server.ts says it itself: "unreachable" is a timeout or a
    // DNS problem and "is not the same as being blocked".
    for (const cause of ["unreachable", "unknown"]) {
      const rows = crawlerRows(["GPTBot"], [], [{ agent: "GPTBot", cause }]);
      expect(rows[0].access).toBe("could not tell");
      expect(rows[0].accessDetail).toContain("nothing is concluded");
    }
  });
});

describe("buildFindings", () => {
  const base = { checks: [], nothingToRead: null, sampled: null, tokens: [], windowDays: 30 };

  it("fires the blocking rule only when one crawler was refused and another was served", () => {
    const both = buildFindings({
      ...base,
      checks: [
        { agent: "PerplexityBot", cause: "bot_protection" },
        { agent: "GPTBot", cause: "ok" },
      ],
    });
    expect(both.map((f) => f.key)).toEqual(["blocked-while-others-allowed"]);
    expect(both[0].severity).toBe("critical");
    expect(both[0].paste).toContain("PerplexityBot");

    const allBlocked = buildFindings({
      ...base,
      checks: [
        { agent: "PerplexityBot", cause: "bot_protection" },
        { agent: "GPTBot", cause: "bot_protection" },
      ],
    });
    expect(allBlocked).toEqual([]);

    const allFine = buildFindings({ ...base, checks: [{ agent: "GPTBot", cause: "ok" }] });
    expect(allFine).toEqual([]);
  });

  it("never sends a host a message about the shop's own settings", () => {
    // robots.txt naming one crawler and not another is not a comparison
    // between crawlers, and the page was served in full either way. A message
    // asking the host to stop returning an error asks for a fix to something
    // that did not happen.
    const robots = buildFindings({
      ...base,
      checks: [
        { agent: "GPTBot", cause: "robots_disallow" },
        { agent: "PerplexityBot", cause: "ok" },
      ],
    });
    expect(robots.map((f) => f.key)).toEqual(["own-setting-robots_disallow"]);
    expect(robots[0].severity).toBe("attention");
    expect(robots[0].paste).toBeNull();
    expect(robots[0].body).toContain("robots.txt.liquid");
    expect(robots[0].body).toContain("nothing refused the request");

    const password = buildFindings({
      ...base,
      checks: [
        { agent: "GPTBot", cause: "password_page" },
        { agent: "PerplexityBot", cause: "password_page" },
      ],
    });
    // One card, not one per crawler: every crawler sees the same wall.
    expect(password).toHaveLength(1);
    expect(password[0].key).toBe("own-setting-password_page");
    expect(password[0].paste).toBeNull();
    expect(password[0].body).toContain("Online Store, Preferences");
  });

  it("keeps a real block and an own setting apart in the same check", () => {
    const mixed = buildFindings({
      ...base,
      checks: [
        { agent: "ClaudeBot", cause: "cloudflare" },
        { agent: "GPTBot", cause: "robots_disallow" },
        { agent: "PerplexityBot", cause: "ok" },
      ],
    });
    expect(mixed.map((f) => f.key)).toEqual([
      "blocked-while-others-allowed",
      "own-setting-robots_disallow",
    ]);
    expect(mixed[0].paste).toContain("ClaudeBot");
    expect(mixed[0].paste).not.toContain("GPTBot");
  });

  it("does not fire the blocking rule on a check that reached no verdict", () => {
    // A timeout is not evidence to send to somebody's host.
    const inconclusive = buildFindings({
      ...base,
      checks: [
        { agent: "PerplexityBot", cause: "unreachable" },
        { agent: "ClaudeBot", cause: "unknown" },
        { agent: "GPTBot", cause: "ok" },
      ],
    });
    expect(inconclusive).toEqual([]);

    // A real refusal alongside an unreachable one still fires, and names only
    // the crawler that was actually turned away.
    const mixed = buildFindings({
      ...base,
      checks: [
        { agent: "PerplexityBot", cause: "unreachable" },
        { agent: "ClaudeBot", cause: "bot_protection" },
        { agent: "GPTBot", cause: "ok" },
      ],
    });
    expect(mixed).toHaveLength(1);
    expect(mixed[0].paste).toContain("ClaudeBot");
    expect(mixed[0].paste).not.toContain("PerplexityBot");
  });

  it("fires the empty-products rule only from a pass that ran", () => {
    expect(buildFindings({ ...base, nothingToRead: 47, sampled: 355 })[0]).toMatchObject({
      key: "products-without-attributes",
      severity: "attention",
    });
    expect(buildFindings({ ...base, nothingToRead: 0, sampled: 355 })).toEqual([]);
    expect(buildFindings({ ...base, nothingToRead: null, sampled: null })).toEqual([]);
  });

  it("fires the robots.txt token rule and keeps it informational", () => {
    const found = buildFindings({ ...base, tokens: [{ token: "Google-Extended", count: 4 }] });
    expect(found[0]).toMatchObject({ key: "non-crawler-tokens", severity: "info" });
    expect(buildFindings({ ...base, tokens: [] })).toEqual([]);
  });

  it("gives both control tokens one finding, not one each", () => {
    // One fact to learn, not two. Two cards saying the same sentence with a
    // different name in it reads as two problems.
    const found = buildFindings({
      ...base,
      tokens: [
        { token: "Google-Extended", count: 4 },
        { token: "Applebot-Extended", count: 2 },
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].title).toContain("6 requests");
    expect(found[0].body).toContain("Google-Extended (4)");
    expect(found[0].body).toContain("Applebot-Extended (2)");
  });

  it("orders critical before attention before info", () => {
    const all = buildFindings({
      checks: [
        { agent: "PerplexityBot", cause: "bot_protection" },
        { agent: "GPTBot", cause: "ok" },
      ],
      nothingToRead: 47,
      sampled: 355,
      tokens: [{ token: "Google-Extended", count: 4 }],
      windowDays: 30,
    });
    expect(all.map((f) => f.severity)).toEqual(["critical", "attention", "info"]);
  });
});

describe("csv", () => {
  it("writes one count column, because there is only one tally", () => {
    // "Values found" sat beside "Products stating it" and held the same number
    // in every row on every catalogue: the engine emits one Fact per family per
    // product, so the two arrays cannot differ. A duplicated column is a reader
    // working out which one to trust.
    expect(familiesCsv(FIGURES.byAttr, FIGURES.sampled, FIGURES.byAttrProducts)).toBe(
      [
        "Attribute family,Products stating it,Products read",
        "Material,4,5",
        "Dimensions,3,5",
        "Colour,2,5",
      ].join("\r\n"),
    );
  });

  it("reads byAttr under the same heading when the pass predates byAttrProducts", () => {
    expect(familiesCsv(FIGURES.byAttr, FIGURES.sampled)).toBe(
      [
        "Attribute family,Products stating it,Products read",
        "Material,5,5",
        "Dimensions,4,5",
        "Colour,2,5",
      ].join("\r\n"),
    );
  });

  it("quotes a product title containing a comma", () => {
    const csv = weakestCsv(
      [{ title: "Oslo sofa, grey", families: ["Material"] }],
      FIGURES.byAttr,
      3,
    );
    expect(csv).toContain('"Oslo sofa, grey",1,3,Dimensions; Colour');
  });
});
