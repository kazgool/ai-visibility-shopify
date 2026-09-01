import { describe, it, expect } from "vitest";
import {
  isQueueUsable,
  isQueueStale,
  seoFieldMetric,
  type SeoQueueJobLike,
} from "../seo-queue-metrics";

function queueJob(overrides: Partial<NonNullable<SeoQueueJobLike>> = {}): SeoQueueJobLike {
  return {
    status: "done",
    finishedAt: "2026-09-01T14:02:00.000Z",
    report: { checked: 50, missingTitle: 0, missingDescription: 0 },
    ...overrides,
  };
}

describe("isQueueUsable / isQueueStale", () => {
  it("is usable only in status done", () => {
    expect(isQueueUsable(queueJob({ status: "done" }))).toBe(true);
    for (const status of ["queued", "running", "failed", "refused", "stale"]) {
      expect(isQueueUsable(queueJob({ status }))).toBe(false);
    }
    expect(isQueueUsable(null)).toBe(false);
    expect(isQueueUsable(undefined)).toBe(false);
  });

  it("is stale only in status stale", () => {
    expect(isQueueStale(queueJob({ status: "stale" }))).toBe(true);
    expect(isQueueStale(queueJob({ status: "done" }))).toBe(false);
    expect(isQueueStale(null)).toBe(false);
  });
});

describe("seoFieldMetric", () => {
  it("reports the fraction, dated, when the queue is usable", () => {
    const job = queueJob({ report: { checked: 50, missingTitle: 8, missingDescription: 3 } });

    const title = seoFieldMetric(job, "title");
    expect(title.value).toBe("42 of 50");
    expect(title.hint).toContain("meta title");
    expect(title.hint).toContain("catalogue check");

    const description = seoFieldMetric(job, "description");
    expect(description.value).toBe("47 of 50");
    expect(description.hint).toContain("meta description");
  });

  it("this is the exact bug: a queue whose fields were all just written by an earlier apply must not read 0 of 50", () => {
    // The queue build ran before the apply, so its report still says nothing
    // is written - but the apply that consumed it has since run, so the
    // worker moved this JobRun to "stale". The tile must not print the
    // build-time fraction as if it were current.
    const job = queueJob({
      status: "stale",
      report: { checked: 50, missingTitle: 50, missingDescription: 50 },
    });

    const title = seoFieldMetric(job, "title");
    expect(title.value).not.toBe("0 of 50");
    expect(title.value).toBe("Recheck needed");
    expect(title.hint.toLowerCase()).toContain("out of date");
  });

  it("prompts to check when there is no queue yet", () => {
    const tile = seoFieldMetric(null, "title");
    expect(tile.value).toBe("Not checked yet");
  });

  it("does not present a fraction while the queue is still building or failed", () => {
    for (const status of ["queued", "running", "failed", "refused"]) {
      const tile = seoFieldMetric(queueJob({ status }), "description");
      expect(tile.value).toBe("Not checked yet");
    }
  });
});
