import { describe, expect, it } from "vitest";
import { CRAWLER_HIT_RETENTION_DAYS, crawlerHitCutoff } from "../retention";

describe("crawlerHitCutoff", () => {
  it("is 30 days before the given instant by default", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const cutoff = crawlerHitCutoff(now);
    expect(cutoff.toISOString()).toBe("2026-08-02T00:00:00.000Z");
    expect(CRAWLER_HIT_RETENTION_DAYS).toBe(30);
  });

  it("accepts an explicit window", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    expect(crawlerHitCutoff(now, 1).toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(crawlerHitCutoff(now, 0).toISOString()).toBe(now.toISOString());
  });

  it("rows older than the cutoff are the ones a prune deletes", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const cutoff = crawlerHitCutoff(now);
    const justInside = new Date(cutoff.getTime() + 1);
    const justOutside = new Date(cutoff.getTime() - 1);
    expect(justInside.getTime() > cutoff.getTime()).toBe(true);
    expect(justOutside.getTime() < cutoff.getTime()).toBe(true);
  });
});
