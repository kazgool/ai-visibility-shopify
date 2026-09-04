import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";

// The ladder as a merchant reads it. dashboard-steps.test.ts proves the
// resolver returns the right statuses and sentences; only rendering proves
// they reach the screen in the right places - that a locked step's reason is
// printed rather than the button merely being grey, that exactly one button
// carries the primary variant, and that eight red crawler tiles are not the
// first thing on the page.
//
// The counts here are assembled in JSX, which is the class of bug this whole
// wave exists to close, so they are asserted on the markup rather than on the
// functions behind it. No jsdom and no testing-library: renderToStaticMarkup
// needs neither, and Polaris renders under it with an AppProvider and an empty
// i18n. The component takes its actions as callbacks and its links as an
// optional wrapper precisely so this file can render it at all.

import { DashboardLadder } from "../DashboardLadder";
import { readPass } from "../../services/report-metrics";
import { resolveLadder, type LadderInput } from "../../services/dashboard-steps";

const NONE = readPass(null);

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

function markup(over: Partial<LadderInput> = {}, crawlers: { agent: string; cause: string }[] = []) {
  return renderToStaticMarkup(
    <AppProvider i18n={{}}>
      <DashboardLadder
        ladder={resolveLadder(input({ crawlers, ...over }))}
        crawlers={crawlers}
        crawlerRunning={false}
        busy={false}
        onJob={() => {}}
        onRevalidate={() => {}}
      />
    </AppProvider>,
  );
}

/** The markup as plain text, so a sentence split across elements is still one
 *  sentence to assert on. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** How many rendered buttons carry Polaris's primary variant. */
function primaryButtons(html: string): number {
  return (html.match(/Polaris-Button--variantPrimary/g) ?? []).length;
}

const EIGHT_BLOCKED = Array.from({ length: 8 }, (_, i) => ({
  agent: `Bot${i + 1}`,
  cause: "password_page",
}));

describe("a fresh store", () => {
  const html = markup();
  const t = text(html);

  it("renders exactly one primary button", () => {
    expect(primaryButtons(html)).toBe(1);
  });

  it("makes that button step one's action", () => {
    const primary = html.slice(0, html.indexOf("Polaris-Button--variantPrimary"));
    expect(primary).toContain("1. Can they reach you");
    expect(primary).not.toContain("2. Can you publish at all");
  });

  it("shows all five steps, numbered, in order", () => {
    const positions = [
      "1. Can they reach you",
      "2. Can you publish at all",
      "3. Is it right",
      "4. Do it everywhere",
      "5. Make it yours",
    ].map((s) => t.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("prints the reason each locked step is locked, in words", () => {
    expect(t).toContain("Step 1, can they reach you, comes first.");
  });

  it("says what every step is for", () => {
    expect(t).toContain("before anything we write can be read");
    expect(t).toContain("until it is on in your published theme, nothing at all is published");
  });

  it("puts no number on the screen that could be read as a measurement", () => {
    expect(t).not.toMatch(/NaN|undefined/);
    expect(t).not.toContain("0%");
  });
});

describe("a failed pass", () => {
  const failed = readPass({
    status: "failed",
    report: { error: "Shopify returned INTERNAL_SERVER_ERROR" },
    startedAt: "2026-09-01T09:00:00.000Z",
    finishedAt: "2026-09-01T09:04:00.000Z",
  });

  it("is named on the step that queued it, and nowhere else", () => {
    const html = markup(
      {
        crawlerJob: { status: "done" },
        embed: { active: true, themeName: "Dawn" },
        previewPass: failed,
      },
      [{ agent: "GPTBot", cause: "ok" }],
    );
    const t = text(html);
    const onStepThree = t.slice(t.indexOf("3. Is it right"), t.indexOf("4. Do it everywhere"));
    expect(onStepThree).toContain("INTERNAL_SERVER_ERROR");
    const onStepOne = t.slice(t.indexOf("1. Can they reach you"), t.indexOf("2. Can you publish"));
    expect(onStepOne).not.toContain("INTERNAL_SERVER_ERROR");
  });

  it("renders no coverage figure with it", () => {
    const t = text(markup({ previewPass: failed }));
    expect(t).toContain("did not finish");
    expect(t).not.toMatch(/\d+%/);
  });
});

describe("the app embed", () => {
  it("cannot be skipped: step three's primary is unreachable while it is off", () => {
    const html = markup({ crawlerJob: { status: "done" }, embed: { active: false } }, [
      { agent: "GPTBot", cause: "ok" },
    ]);
    const t = text(html);
    expect(primaryButtons(html)).toBe(1);
    const primary = html.slice(0, html.indexOf("Polaris-Button--variantPrimary"));
    expect(primary).toContain("2. Can you publish at all");
    expect(t).toContain("Step 2, can you publish at all, comes first.");
  });

  it("renders the unreadable state as an unknown, not as an off", () => {
    const t = text(
      markup({ crawlerJob: { status: "done" }, embed: { active: false, unreadable: true } }, [
        { agent: "GPTBot", cause: "ok" },
      ]),
    );
    expect(t).toContain("we do not know whether the embed is on");
    expect(t).toContain("an unknown, not an off");
    expect(t).not.toContain("Added but switched off");
    expect(t).toContain("Open theme editor");
  });
});

describe("the crawler tiles", () => {
  it("are not on the first fold: the verdict line is, the eight tiles are behind a disclosure", () => {
    const html = markup({ crawlerJob: { status: "done" } }, EIGHT_BLOCKED);
    const t = text(html);
    expect(t).toContain("0 of 8 crawlers received a product page. 8 did not: sees the password page.");
    expect(t).toContain("Show each crawler (8)");
    // A closed Polaris Collapsible renders none of its children at all, so the
    // eight tiles are not merely visually below the fold - they are not on the
    // first paint. That is the finding: eight red tiles were the first thing a
    // password-protected pre-launch store showed, and every one was expected.
    expect(html).toContain('id="ladder-crawler-tiles"');
    expect(t).not.toContain("Bot1");
    expect(t).not.toContain("Sees the password page");
  });
});

describe("a paid store with everything done", () => {
  const html = markup({
    crawlerJob: { status: "done" },
    embed: { active: true, themeName: "Dawn" },
    hasAccess: true,
    lastWrite: { finishedAt: "2026-09-01T10:00:00.000Z" },
    hasDictionary: true,
    hasBusiness: true,
    collectionsBuilt: { at: "2026-09-01T11:00:00.000Z", withTable: 6, total: 9 },
  }, [{ agent: "GPTBot", cause: "ok" }]);
  const t = text(html);

  it("has no primary button anywhere", () => {
    expect(primaryButtons(html)).toBe(0);
  });

  it("collapses each step to its result and drops the purpose sentence", () => {
    expect(t).toContain("1 of 1 crawlers received a product page.");
    expect(t).toContain("Verified in Dawn");
    expect(t).toContain("Not needed");
    expect(t).toContain("Written 1 September 2026");
    expect(t).toContain("All three are set");
    expect(t).not.toContain("before anything we write can be read");
  });

  it("says the path is finished", () => {
    expect(t).toContain("All five steps are finished");
  });

  it("keeps the paid shop's preview reachable even though the step is not needed", () => {
    expect(t).toContain("Preview changes");
  });
});

describe("everything else", () => {
  it("is rendered behind one disclosure at the bottom, below step five", () => {
    const html = renderToStaticMarkup(
      <AppProvider i18n={{}}>
        <DashboardLadder
          ladder={resolveLadder(input())}
          crawlers={[]}
          crawlerRunning={false}
          busy={false}
          onJob={() => {}}
          onRevalidate={() => {}}
          everythingElse={<p>Write missing alt text</p>}
        />
      </AppProvider>,
    );
    expect(text(html)).toContain("Everything else");
    expect(html.indexOf("Everything else")).toBeGreaterThan(html.indexOf("5. Make it yours"));
    // Closed, so its contents are not rendered; the disclosure is what is on
    // the screen. Nothing is removed - it is one click away.
    expect(html).toContain('id="ladder-everything-else"');
    expect(text(html)).not.toContain("Write missing alt text");
  });
});
