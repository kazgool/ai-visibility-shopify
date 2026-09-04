import { describe, it, expect } from "vitest";

import { readPass } from "../report-metrics";
import {
  crawlerVerdict,
  embedState,
  primaryCount,
  resolveLadder,
  type Ladder,
  type LadderInput,
  type StepKey,
} from "../dashboard-steps";

// Audit of 2 September 2026, findings 1.6 and 1.7. On a fresh install the
// dashboard showed eleven live controls, two of them primary in different
// cards, a flat checklist with no locked state, and the app embed - without
// which nothing at all is published - fifth in the right-hand column below the
// fold. The shapes below are the five the ladder has to get right, and every
// one of them is a store that exists: a store that has just installed, one
// whose pass fell over, one whose theme embed is off, one whose theme settings
// could not be parsed, and one that finished.

const NONE = readPass(null);

const FAILED_DRY = readPass({
  status: "failed",
  report: { error: "Shopify returned INTERNAL_SERVER_ERROR" },
  startedAt: "2026-09-01T09:00:00.000Z",
  finishedAt: "2026-09-01T09:04:00.000Z",
});

const FAILED_BULK = readPass({
  status: "failed",
  report: { error: "The catalogue read timed out" },
  startedAt: "2026-09-01T10:00:00.000Z",
  finishedAt: "2026-09-01T10:20:00.000Z",
});

const EIGHT_BLOCKED = Array.from({ length: 8 }, (_, i) => ({
  agent: `Bot${i + 1}`,
  cause: "password_page",
}));

function input(over: Partial<LadderInput> = {}): LadderInput {
  return {
    crawlerJob: null,
    crawlers: [],
    embed: { active: false },
    embedLink: "https://example.myshopify.com/admin/themes/1/editor",
    hasAccess: false,
    freeProductsRemaining: 3,
    previewPass: NONE,
    fillPass: NONE,
    lastWrite: null,
    hasDictionary: false,
    hasBusiness: false,
    collectionsBuilt: null,
    blockingKind: null,
    ...over,
  };
}

function step(ladder: Ladder, key: StepKey) {
  const s = ladder.steps.find((x) => x.key === key);
  if (!s) throw new Error(`no step ${key}`);
  return s;
}

/** Every sentence the ladder puts on the screen, as one string. */
function allText(ladder: Ladder): string {
  const parts: string[] = [];
  for (const s of ladder.steps) {
    parts.push(s.title, s.purpose, s.result ?? "", s.problem ?? "");
    if (s.action) parts.push(s.action.label, s.action.disabledReason ?? "");
    if (s.extra) parts.push(s.extra.label, s.extra.disabledReason ?? "");
    for (const sub of s.subs) parts.push(sub.label, sub.hint);
  }
  return parts.join(" ");
}

describe("the order is fixed and there is exactly one primary", () => {
  it("has five steps in the specified order, always", () => {
    for (const over of [
      {},
      { crawlerJob: { status: "done" } },
      { hasAccess: true, lastWrite: { finishedAt: "2026-09-01T10:00:00.000Z" } },
    ]) {
      const ladder = resolveLadder(input(over as Partial<LadderInput>));
      expect(ladder.steps.map((s) => s.key)).toEqual([
        "reach",
        "publish",
        "right",
        "everywhere",
        "yours",
      ]);
      expect(ladder.steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("gives the primary to the first unfinished step and to nothing else", () => {
    const ladder = resolveLadder(input());
    expect(ladder.currentKey).toBe("reach");
    expect(primaryCount(ladder)).toBe(1);
    expect(step(ladder, "reach").action?.primary).toBe(true);
  });

  it("moves the primary down as steps finish", () => {
    const ladder = resolveLadder(input({ crawlerJob: { status: "done" }, crawlers: EIGHT_BLOCKED }));
    expect(ladder.currentKey).toBe("publish");
    expect(primaryCount(ladder)).toBe(1);
    expect(step(ladder, "reach").status).toBe("done");
    expect(step(ladder, "publish").action?.primary).toBe(true);
  });
});

describe("a fresh store with no runs", () => {
  const ladder = resolveLadder(input());

  it("opens on step one and locks everything below it", () => {
    expect(step(ladder, "reach").status).toBe("current");
    expect(step(ladder, "publish").status).toBe("locked");
    expect(step(ladder, "right").status).toBe("locked");
    expect(step(ladder, "everywhere").status).toBe("locked");
    expect(step(ladder, "yours").status).toBe("locked");
  });

  it("disables every locked action and says why in words", () => {
    for (const key of ["publish", "right", "everywhere", "yours"] as StepKey[]) {
      const s = step(ladder, key);
      expect(s.action?.disabled).toBe(true);
      expect(s.action?.disabledReason).toBe("Step 1, can they reach you, comes first.");
      expect(s.action?.primary).toBe(false);
    }
  });

  it("shows no NaN, no undefined and no zero anywhere", () => {
    const text = allText(ladder);
    expect(text).not.toMatch(/NaN|undefined|null/);
    // A fresh store has measured nothing, so no figure of any kind belongs on
    // the ladder yet. The step numbers are the only digits allowed.
    expect(text.replace(/Step \d/g, "")).not.toMatch(/\d/);
  });

  it("still names what every step is for, locked or not", () => {
    for (const s of ladder.steps) expect(s.purpose.length).toBeGreaterThan(20);
  });
});

describe("a failed pass belongs to the step that queued it", () => {
  const ladder = resolveLadder(
    input({
      crawlerJob: { status: "done" },
      crawlers: EIGHT_BLOCKED,
      embed: { active: true, themeName: "Dawn" },
      previewPass: FAILED_DRY,
      fillPass: FAILED_BULK,
    }),
  );

  it("puts the failed preview on step three and never on step one", () => {
    expect(step(ladder, "right").problem).toContain("INTERNAL_SERVER_ERROR");
    expect(step(ladder, "reach").problem).toBeNull();
    expect(step(ladder, "reach").result).toContain("0 of 8 crawlers received a product page");
  });

  it("puts the failed catalogue pass on step four", () => {
    expect(step(ladder, "everywhere").problem).toContain("timed out");
    expect(step(ladder, "right").problem).not.toContain("timed out");
  });

  it("shows no coverage figure with either failure", () => {
    const problems = ladder.steps.map((s) => s.problem).filter(Boolean).join(" ");
    expect(problems).toContain("did not finish");
    expect(problems).not.toMatch(/NaN|0%|coverage/i);
  });

  it("reports a failed crawler check on step one, with no verdict", () => {
    const withFailedCheck = resolveLadder(
      input({
        crawlerJob: {
          status: "failed",
          report: { error: "The request timed out." },
          finishedAt: "2026-09-01T09:00:00.000Z",
        },
      }),
    );
    const s = step(withFailedCheck, "reach");
    expect(s.status).toBe("current");
    expect(s.problem).toContain("The request timed out.");
    expect(s.problem).toContain("nothing here is a verdict");
    expect(s.result).toBeNull();
  });
});

describe("step one is done at any verdict", () => {
  it("counts a password-walled store as a completed check", () => {
    const ladder = resolveLadder(
      input({ crawlerJob: { status: "done" }, crawlers: EIGHT_BLOCKED }),
    );
    expect(step(ladder, "reach").status).toBe("done");
    expect(step(ladder, "reach").result).toBe(
      "0 of 8 crawlers received a product page. 8 did not: sees the password page.",
    );
    expect(step(ladder, "reach").extra?.label).toBe("See why");
  });

  it("says so plainly when every crawler got the page", () => {
    expect(crawlerVerdict([{ agent: "GPTBot", cause: "ok" }])).toBe(
      "1 of 1 crawlers received a product page.",
    );
  });
});

describe("the app embed has three states, not two", () => {
  it("is active when the released uid is enabled in the published theme", () => {
    expect(embedState({ active: true })).toBe("active");
    const ladder = resolveLadder(
      input({ crawlerJob: { status: "done" }, embed: { active: true, themeName: "Dawn" } }),
    );
    expect(step(ladder, "publish").status).toBe("done");
    expect(step(ladder, "publish").result).toContain("Verified in Dawn");
  });

  it("is off, and the merchant cannot reach step three's primary", () => {
    const ladder = resolveLadder(
      input({ crawlerJob: { status: "done" }, embed: { active: false, presentButDisabled: true } }),
    );
    expect(embedState({ active: false, presentButDisabled: true })).toBe("off");
    expect(ladder.currentKey).toBe("publish");
    const right = step(ladder, "right");
    expect(right.status).toBe("locked");
    expect(right.action?.primary).toBe(false);
    expect(right.action?.disabled).toBe(true);
    expect(right.action?.disabledReason).toBe("Step 2, can you publish at all, comes first.");
    expect(primaryCount(ladder)).toBe(1);
  });

  it("is unknown when the theme settings could not be read, and says so without claiming it is missing", () => {
    const ladder = resolveLadder(
      input({ crawlerJob: { status: "done" }, embed: { active: false, unreadable: true } }),
    );
    expect(embedState({ active: false, unreadable: true })).toBe("unknown");
    const publish = step(ladder, "publish");
    expect(publish.status).toBe("current");
    expect(publish.result).toContain("we do not know whether the embed is on");
    expect(publish.result).toContain("an unknown, not an off");
    expect(publish.result).not.toContain("switched off");
    expect(publish.result).not.toContain("Turn on");
    // The theme editor is still offered: the merchant can go and look.
    expect(publish.action?.kind).toBe("external");
    expect(publish.action?.disabled).toBe(false);
  });
});

describe("step three is the free tier and only the free tier", () => {
  it("collapses as not needed on a paid shop, with its action still reachable", () => {
    const ladder = resolveLadder(
      input({ crawlerJob: { status: "done" }, embed: { active: true }, hasAccess: true }),
    );
    const right = step(ladder, "right");
    expect(right.status).toBe("not_needed");
    expect(right.result).toContain("Not needed");
    expect(right.action?.label).toBe("Preview changes");
    expect(right.action?.primary).toBe(false);
    expect(ladder.currentKey).toBe("everywhere");
  });

  it("is done on a free shop when all three products are used", () => {
    const ladder = resolveLadder(
      input({
        crawlerJob: { status: "done" },
        embed: { active: true },
        freeProductsRemaining: 0,
      }),
    );
    expect(step(ladder, "right").status).toBe("done");
    expect(step(ladder, "right").result).toContain("stays written");
  });

  it("offers the products screen so the step can actually be finished", () => {
    const ladder = resolveLadder(input({ crawlerJob: { status: "done" }, embed: { active: true } }));
    expect(step(ladder, "right").extra?.to).toBe("/app/products");
    expect(step(ladder, "right").extra?.label).toBe("Choose your three products");
  });
});

describe("step four asks for money before it asks for a pass", () => {
  it("offers Subscribe with no access", () => {
    const ladder = resolveLadder(
      input({ crawlerJob: { status: "done" }, embed: { active: true }, freeProductsRemaining: 0 }),
    );
    expect(ladder.currentKey).toBe("everywhere");
    expect(step(ladder, "everywhere").action?.label).toBe("Subscribe");
    expect(step(ladder, "everywhere").action?.to).toBe("/app/plans");
  });

  it("offers Fill catalogue with access", () => {
    const ladder = resolveLadder(
      input({ crawlerJob: { status: "done" }, embed: { active: true }, hasAccess: true }),
    );
    expect(step(ladder, "everywhere").action?.label).toBe("Fill catalogue");
    expect(step(ladder, "everywhere").action?.mode).toBe("write");
  });
});

describe("a paid store with everything done", () => {
  const ladder = resolveLadder(
    input({
      crawlerJob: { status: "done" },
      crawlers: [{ agent: "GPTBot", cause: "ok" }],
      embed: { active: true, themeName: "Dawn" },
      hasAccess: true,
      lastWrite: { finishedAt: "2026-09-01T10:00:00.000Z" },
      hasDictionary: true,
      hasBusiness: true,
      collectionsBuilt: { at: "2026-09-01T11:00:00.000Z", withTable: 6, total: 9 },
      previewPass: readPass({
        status: "done",
        report: { sampled: 355, none: 3, wouldSkip: 12, byAttr: [], depth: [] },
        startedAt: "2026-09-01T09:00:00.000Z",
        finishedAt: "2026-09-01T09:40:00.000Z",
      }),
    }),
  );

  it("has no current step and no primary button at all", () => {
    expect(ladder.currentKey).toBeNull();
    expect(primaryCount(ladder)).toBe(0);
  });

  it("collapses all five to a result line", () => {
    for (const s of ladder.steps) {
      expect(["done", "not_needed"]).toContain(s.status);
      expect(s.result).toBeTruthy();
    }
    expect(step(ladder, "everywhere").result).toContain("Written 1 September 2026");
    expect(step(ladder, "yours").result).toContain("All three are set");
  });

  it("locks nothing, so no disabled reason is shown anywhere", () => {
    const reasons = ladder.steps
      .flatMap((s) => [s.action?.disabledReason, s.extra?.disabledReason])
      .filter(Boolean);
    expect(reasons).toEqual([]);
  });
});

describe("the one-at-a-time guard is kind-agnostic and names the job", () => {
  it("disables the current step's job action while any job is queued", () => {
    const ladder = resolveLadder(input({ blockingKind: "reconcile" }));
    const reach = step(ladder, "reach");
    expect(reach.action?.disabled).toBe(true);
    expect(reach.action?.disabledReason).toBe(
      "A setting change is running. One job at a time, so this waits for it.",
    );
    // Nothing is primary while nothing can be pressed.
    expect(primaryCount(ladder)).toBe(0);
  });

  it("names a collections pass by its own name, not as 'a job'", () => {
    const ladder = resolveLadder(input({ blockingKind: "collections" }));
    expect(step(ladder, "reach").action?.disabledReason).toContain("The collections pass");
  });
});

describe("step five is three separate decisions", () => {
  it("carries one sub-line per setting, each with its own done state", () => {
    const ladder = resolveLadder(
      input({
        crawlerJob: { status: "done" },
        embed: { active: true },
        hasAccess: true,
        lastWrite: { finishedAt: "2026-09-01T10:00:00.000Z" },
        hasDictionary: true,
      }),
    );
    const yours = step(ladder, "yours");
    expect(yours.status).toBe("current");
    expect(yours.subs.map((s) => s.done)).toEqual([true, false, false]);
    expect(yours.subs.map((s) => s.to)).toEqual([
      "/app/dictionary",
      "/app/business",
      "/app/collections",
    ]);
    // The action opens the first one that is not done, not the first one.
    expect(yours.action?.to).toBe("/app/business");
  });
});
