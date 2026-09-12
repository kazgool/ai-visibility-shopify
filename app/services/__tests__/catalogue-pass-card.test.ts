import { describe, expect, it } from "vitest";

import { cataloguePassCard, elapsedWords, passProgress, wroteSentence } from "../catalogue-pass-card";
import { readPass } from "../report-metrics";

// The card the catalogue pass got of its own (SPEC-EXTRACTION-QUALITY, second
// module; batch 5 item 4). Until it existed, "Fill catalogue" was a button
// inside step four of the ladder, and a finished step collapses to one line -
// so a merchant who had finished the checklist could neither run the pass
// again nor watch it run.
//
// Five states, because those are the five a merchant can be looking at: never
// run, running, finished, failed, and blocked by another job.

const NOW = new Date("2026-09-12T10:30:00.000Z");

/** A finished write pass, as the worker stores it. */
const doneJob = (report: Record<string, unknown>) => ({
  status: "done",
  report,
  startedAt: "2026-09-11T22:00:00.000Z",
  finishedAt: "2026-09-11T22:41:00.000Z",
  kind: "bulk_extract",
});

const FIGURES = { sampled: 189, none: 12, byAttr: [], depth: [], wouldSkip: 4 };

const card = (over: Partial<Parameters<typeof cataloguePassCard>[0]> = {}) =>
  cataloguePassCard({
    pass: readPass(null),
    running: null,
    blockingKind: null,
    hasAccess: true,
    now: NOW,
    ...over,
  });

describe("a store where the pass has never run", () => {
  const c = card();

  it("is on the screen anyway, saying what the pass does", () => {
    expect(c.state).toBe("never");
    expect(c.what).toContain("reads the descriptions you already wrote");
    expect(c.when).toBeNull();
    expect(c.wrote).toBeNull();
    expect(c.problem).toBeNull();
  });

  it("offers both buttons, the pass primary and the preview beside it", () => {
    expect(c.run).toMatchObject({ label: "Fill catalogue", mode: "write", primary: true, disabled: false });
    expect(c.dry).toMatchObject({ label: "Preview changes", mode: "dry", disabled: false });
  });
});

describe("a pass that is running now", () => {
  const c = card({
    running: {
      status: "running",
      progress: 128,
      total: 189,
      startedAt: "2026-09-12T10:26:00.000Z",
    },
  });

  it("counts the product it is on, against the total", () => {
    expect(c.state).toBe("running");
    expect(c.progress).toMatchObject({ done: 128, total: 189, percent: 68, label: "Product 128 of 189" });
  });

  it("says how long it has been going", () => {
    expect(c.progress!.elapsed).toBe("4 minutes so far");
  });

  it("says so on the buttons rather than queueing a second pass", () => {
    expect(c.run.disabled).toBe(true);
    expect(c.run.disabledReason).toBe("This pass is running now.");
    expect(c.dry.disabled).toBe(true);
  });

  // A queued row, and the first moments of a running one, have no total. A bar
  // drawn from nothing sits at 0% and reads as stuck.
  it("does not draw a bar before it knows the total", () => {
    const queued = card({
      running: { status: "queued", progress: 0, total: null, startedAt: null },
    });
    expect(queued.progress).toMatchObject({ total: 0, percent: 0, label: "Starting up..." });
    expect(queued.progress!.elapsed).toBeNull();
  });
});

describe("a pass that finished", () => {
  const c = card({
    pass: readPass(
      doneJob({ ...FIGURES, wrote: { written: 140, unchanged: 45, protectedRows: 4, withdrawn: 2 } }),
    ),
  });

  it("says when, and what it wrote, with the denominator on every figure", () => {
    expect(c.state).toBe("done");
    expect(c.when).toBe("11 September 2026");
    expect(c.wrote).toBe(
      "Out of 189 products read: 140 products written, 45 already identical and left alone, " +
        "4 with values a person wrote, which were kept, " +
        "2 where a value we had written no longer applies and was withdrawn.",
    );
  });

  // Unchanged is the largest figure on a second pass and reads as failure if
  // it is not explained. It is also the rule that stops this app writing a
  // value it just wrote and feeding its own webhooks for ever.
  it("states the products it deliberately left alone rather than hiding them", () => {
    expect(c.wrote).toContain("already identical and left alone");
  });

  it("leaves nothing out and claims nothing when a person's rows were kept but none withdrawn", () => {
    const kept = wroteSentence(
      readPass(doneJob({ ...FIGURES, wrote: { written: 10, unchanged: 0, protectedRows: 3, withdrawn: 0 } })),
    );
    expect(kept).toContain("3 with values a person wrote, which were kept");
    expect(kept).not.toContain("withdrawn");
  });

  // A report written before this measurement existed. Zeros would read as "it
  // wrote nothing", which is a different statement from "it did not record".
  it("says a pass predating the measurement did not record what it wrote", () => {
    const older = card({ pass: readPass(doneJob(FIGURES)) });
    expect(older.wrote).toBe("That pass did not record what it wrote. The next one will.");
  });

  it("offers the pass again, with nothing blocking it", () => {
    expect(c.run.disabled).toBe(false);
    expect(c.run.primary).toBe(true);
    expect(c.problem).toBeNull();
  });
});

describe("a pass that failed", () => {
  const c = card({
    pass: readPass({
      status: "failed",
      report: { error: "Shopify returned 502 on the bulk download." },
      startedAt: "2026-09-11T22:00:00.000Z",
      finishedAt: "2026-09-11T22:03:00.000Z",
      kind: "bulk_extract",
    }),
  });

  it("says what failed and what to do about it", () => {
    expect(c.state).toBe("failed");
    expect(c.problem).toContain("Shopify returned 502 on the bulk download.");
    expect(c.problem).toContain("Press Fill catalogue to run it again");
    expect(c.wrote).toBeNull();
  });

  it("leaves the button working, because running it again is the answer", () => {
    expect(c.run.disabled).toBe(false);
  });

  // An entitlement decision is not a failure, and calling it one sends the
  // merchant looking for a fault that does not exist.
  it("tells a refused pass apart from a failed one", () => {
    const refused = card({
      pass: readPass({
        status: "refused",
        report: { reason: "This shop has no active subscription, so the catalogue pass was not run." },
        startedAt: null,
        finishedAt: "2026-09-11T22:00:00.000Z",
        kind: "bulk_extract",
      }),
    });
    expect(refused.state).toBe("refused");
    expect(refused.problem).toContain("Nothing failed and nothing is wrong with your catalogue.");
  });
});

describe("the one-job-at-a-time guard", () => {
  // Unchanged from the ladder's: the same helper produces the same sentence,
  // so the card and step four cannot drift into disagreeing about one queue.
  const c = card({ blockingKind: "alt_text" });

  it("says which job holds the queue, on both buttons", () => {
    expect(c.run.disabled).toBe(true);
    expect(c.dry.disabled).toBe(true);
    expect(c.run.disabledReason).toContain("One job at a time, so this waits for it.");
    expect(c.run.disabledReason).toBe(c.dry.disabledReason);
  });

  it("never says the app is waiting on itself", () => {
    const own = card({
      blockingKind: null,
      running: { status: "running", progress: 3, total: 9, startedAt: null },
    });
    expect(own.run.disabledReason).toBe("This pass is running now.");
  });
});

describe("a store with no subscription", () => {
  const c = card({ hasAccess: false });

  it("does not pretend the whole-catalogue pass is available", () => {
    expect(c.run.label).toBe("Subscribe to fill the catalogue");
    expect(c.run.disabled).toBe(true);
    expect(c.run.disabledReason).toContain("The coverage score below is free");
  });

  // The preview IS free (FREE-TIER-SPEC section 2), and hiding it behind the
  // same lock would withdraw something already given.
  it("leaves the free preview working", () => {
    expect(c.dry.disabled).toBe(false);
  });
});

describe("elapsed time", () => {
  it("counts seconds before the first minute, so a fresh pass is not '0 minutes'", () => {
    expect(elapsedWords("2026-09-12T10:29:43.000Z", NOW)).toBe("17 seconds so far");
  });

  it("counts minutes, then hours and minutes", () => {
    expect(elapsedWords("2026-09-12T10:29:00.000Z", NOW)).toBe("1 minute so far");
    expect(elapsedWords("2026-09-12T09:30:00.000Z", NOW)).toBe("1 hour so far");
    expect(elapsedWords("2026-09-12T08:25:00.000Z", NOW)).toBe("2 hours 5 minutes so far");
  });

  // The worker's clock and this container's are not the same clock.
  it("never prints a negative age", () => {
    expect(elapsedWords("2026-09-12T10:31:00.000Z", NOW)).toBe("0 seconds so far");
  });

  it("says nothing at all when the row carries no start time", () => {
    expect(elapsedWords(null, NOW)).toBeNull();
    expect(elapsedWords("not a date", NOW)).toBeNull();
  });
});

describe("progress is read from the row, never from the browser", () => {
  it("is null for a row that is not live, whatever its stored progress says", () => {
    expect(passProgress({ status: "done", progress: 189, total: 189, startedAt: null }, NOW)).toBeNull();
    expect(passProgress(null, NOW)).toBeNull();
  });

  it("never reports more than 100 per cent when a row overran its total", () => {
    expect(passProgress({ status: "running", progress: 200, total: 189, startedAt: null }, NOW)!.percent).toBe(100);
  });
});
