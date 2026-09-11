import { describe, expect, it } from "vitest";
import {
  JOB_STALE_AFTER_MS,
  STUCK_REASON,
  STUCK_STATUS,
  isStaleRunning,
  liveJobFilter,
  presentJob,
} from "../job-stale";
import { readPass } from "../report-metrics";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60 * 1000);

describe("isStaleRunning", () => {
  it("is thirty minutes, the figure the worker comment and the screens agree on", () => {
    expect(JOB_STALE_AFTER_MS).toBe(30 * 60 * 1000);
  });

  it("calls a running row stale when neither its start nor its last progress is within the window", () => {
    expect(isStaleRunning({ status: "running", startedAt: ago(31), updatedAt: ago(31) }, NOW)).toBe(true);
  });

  it("keeps a long pass that is still writing progress live, however old its start", () => {
    expect(isStaleRunning({ status: "running", startedAt: ago(240), updatedAt: ago(2) }, NOW)).toBe(false);
  });

  it("keeps a row inside the window live", () => {
    expect(isStaleRunning({ status: "running", startedAt: ago(29), updatedAt: ago(29) }, NOW)).toBe(false);
  });

  it("never calls queued, done or failed rows stale, and leaves a running row with no start alone", () => {
    for (const status of ["queued", "done", "failed", "refused"]) {
      expect(isStaleRunning({ status, startedAt: ago(600), updatedAt: ago(600) }, NOW)).toBe(false);
    }
    expect(isStaleRunning({ status: "running", startedAt: null, updatedAt: ago(600) }, NOW)).toBe(false);
  });

  it("reads the ISO strings a loader payload carries as well as Dates", () => {
    expect(
      isStaleRunning(
        { status: "running", startedAt: ago(45).toISOString(), updatedAt: ago(45).toISOString() },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("presentJob", () => {
  it("presents a stale row as stuck, with the reason where the screens read failures", () => {
    const shown = presentJob({ id: "j1", status: "running", startedAt: ago(90), updatedAt: ago(90), report: null }, NOW);
    expect(shown?.status).toBe(STUCK_STATUS);
    expect(shown?.report).toEqual({ reason: STUCK_REASON, error: STUCK_REASON });
    expect(shown?.id).toBe("j1");
  });

  it("returns every other row untouched, and null as null", () => {
    const live = { status: "running", startedAt: ago(5), updatedAt: ago(1), report: null };
    expect(presentJob(live, NOW)).toBe(live);
    expect(presentJob(null, NOW)).toBeNull();
  });

  it("turns a stuck pass into a failure that names itself on the report screen, never a running one", () => {
    const shown = presentJob(
      { status: "running", startedAt: ago(90), updatedAt: ago(90), finishedAt: null, report: null },
      NOW,
    )!;
    const pass = readPass({
      status: shown.status,
      report: shown.report,
      startedAt: shown.startedAt.toISOString(),
      finishedAt: null,
    });
    expect(pass.state).toBe("failed");
    expect(pass.state === "failed" && pass.reason).toContain("Stuck, released");
  });

  it("writes the reason in plain characters only", () => {
    expect(STUCK_REASON).not.toMatch(/[–—‘’“”…]|&#?\w+;/);
  });
});

describe("liveJobFilter", () => {
  it("counts queued rows, and running rows only when started or touched inside the window", () => {
    const filter = liveJobFilter(NOW);
    const cutoff = new Date(NOW - JOB_STALE_AFTER_MS);
    expect(filter).toEqual({
      OR: [
        { status: "queued" },
        { status: "running", startedAt: null },
        { status: "running", startedAt: { gte: cutoff } },
        { status: "running", updatedAt: { gte: cutoff } },
      ],
    });
  });
});
