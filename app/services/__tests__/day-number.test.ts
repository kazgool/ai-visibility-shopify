import { describe, expect, it } from "vitest";
import { calendarDayNumber } from "../seo-since";

// CC-PROMPT-AI-READABILITY-3 addendum, item 13: "day N" counts calendar days in
// the shop's timezone from the snapshot's date, not 24-hour blocks.
// Europe/Bucharest is UTC+3 in September.

describe("calendarDayNumber", () => {
  it("turns to day 2 at the shop's midnight, not 24 hours after the snapshot", () => {
    // Snapshot 23:00 on 10 September in Bucharest.
    const snapshot = "2026-09-10T20:00:00.000Z";
    // 23:59 the same evening: still day 1.
    expect(calendarDayNumber(snapshot, new Date("2026-09-10T20:59:00.000Z"), "Europe/Bucharest")).toBe(1);
    // 00:30 on 11 September, ninety minutes later: day 2. Whole 24-hour blocks said 1.
    expect(calendarDayNumber(snapshot, new Date("2026-09-10T21:30:00.000Z"), "Europe/Bucharest")).toBe(2);
  });

  it("stays on day 1 all of the snapshot's own day, even more than 12 hours on", () => {
    // Snapshot 00:30 on 11 September in Bucharest, read at 23:30 the same day.
    expect(
      calendarDayNumber("2026-09-10T21:30:00.000Z", new Date("2026-09-11T20:30:00.000Z"), "Europe/Bucharest"),
    ).toBe(1);
  });

  it("depends on the shop's timezone: the same two instants are one day apart in Bucharest and the same day in UTC", () => {
    const snapshot = "2026-09-10T20:00:00.000Z";
    const now = new Date("2026-09-10T22:00:00.000Z");
    expect(calendarDayNumber(snapshot, now, "Europe/Bucharest")).toBe(2);
    expect(calendarDayNumber(snapshot, now, "UTC")).toBe(1);
  });

  it("counts in UTC when the timezone is unknown or not a timezone, and never below 1", () => {
    const snapshot = "2026-09-10T08:00:00.000Z";
    expect(calendarDayNumber(snapshot, new Date("2026-09-12T08:00:00.000Z"), null)).toBe(3);
    expect(calendarDayNumber(snapshot, new Date("2026-09-12T08:00:00.000Z"), "Not/AZone")).toBe(3);
    expect(calendarDayNumber(snapshot, new Date("2026-09-09T08:00:00.000Z"), "UTC")).toBe(1);
  });
});
