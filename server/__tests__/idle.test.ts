import { describe, expect, it } from "vitest";
import { shouldStop, type IdleState } from "../idle";

const MIN = 60_000;
const base: IdleState = {
  now: 100 * MIN,
  bootedAt: 0,
  lastActivityAt: 90 * MIN,
  inFlight: 0,
  queueBusy: false,
  idleMs: 5 * MIN,
};

describe("shouldStop", () => {
  it("stops when nothing has happened for a whole window", () => {
    expect(shouldStop(base)).toBe(true);
  });

  it("stays up while a request is in hand, however old the last one", () => {
    expect(shouldStop({ ...base, inFlight: 1 })).toBe(false);
  });

  it("stays up while a job runs or is due soon", () => {
    expect(shouldStop({ ...base, queueBusy: true })).toBe(false);
  });

  it("stays up until a full window has passed since the last request", () => {
    expect(shouldStop({ ...base, lastActivityAt: base.now - 5 * MIN + 1 })).toBe(false);
    expect(shouldStop({ ...base, lastActivityAt: base.now - 5 * MIN })).toBe(true);
  });

  it("never stops within the first window after boot, even with no request at all", () => {
    expect(shouldStop({ ...base, bootedAt: base.now - MIN, lastActivityAt: base.now - MIN })).toBe(false);
  });
});
