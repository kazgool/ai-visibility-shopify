import { describe, it, expect } from "vitest";

import { readPass } from "../report-metrics";
import { altProblem, coveragePercent, metricTiles, passProblem } from "../dashboard-metrics";

// Audit of 2 September 2026, finding 1.4: the dashboard picked the last
// dry_run or bulk_extract with no status filter and read its report as
// figures. A failed run's report is `{ error }` - truthy - so `sampled - none`
// was NaN, Coverage showed 0% with the hint "NaN produce attributes", and the
// summary line read "undefined products read". A merchant reads that as "the
// app found nothing in my catalogue", which is the opposite of what happened.
//
// The rule, copied from the Report screen: only status "done" is a
// measurement. The assertion that matters is not "coverage is correct" but
// "no digit reaches the screen from a pass that is not a measurement".

/** Every string the metric row and the pass sentence put in front of a
 *  merchant, minus the Products tile, which is a catalogue fact and not a
 *  measurement of any pass. */
function passDerivedStrings(input: Parameters<typeof metricTiles>[0]): string[] {
  const tiles = metricTiles(input);
  const strings: string[] = [];
  for (const t of tiles) {
    if (t.label === "Products") continue;
    strings.push(t.value, t.hint);
  }
  const p = passProblem(input.pass);
  if (p) strings.push(p);
  const a = altProblem(input.altFailed);
  if (a) strings.push(a);
  return strings;
}

const FAILED = readPass({
  status: "failed",
  report: { error: "Shopify returned INTERNAL_SERVER_ERROR" },
  startedAt: "2026-09-01T09:00:00.000Z",
  finishedAt: "2026-09-01T09:04:00.000Z",
});

const DONE = readPass({
  status: "done",
  report: { sampled: 355, none: 3, wouldSkip: 12, byAttr: [["Dimensions", 306]], depth: [] },
  startedAt: "2026-09-01T09:00:00.000Z",
  finishedAt: "2026-09-01T09:40:00.000Z",
});

describe("a failed pass is never a measurement", () => {
  it("puts no number anywhere it could be read as a figure", () => {
    const strings = passDerivedStrings({
      totalProducts: 355,
      pass: FAILED,
      alt: null,
      altFailed: null,
    });
    // The failure sentence carries a date, which is a number and belongs
    // there. Everything else must be digit-free.
    const tiles = metricTiles({ totalProducts: 355, pass: FAILED, alt: null, altFailed: null });
    for (const t of tiles) {
      if (t.label === "Products") continue;
      expect(t.value).toBe("-");
      expect(t.hint).not.toMatch(/\d/);
    }
    expect(strings.join(" ")).not.toMatch(/NaN|undefined|0%/);
  });

  it("names the failure and its stored reason instead", () => {
    expect(passProblem(FAILED)).toBe(
      "The pass on 1 September 2026 failed: Shopify returned INTERNAL_SERVER_ERROR Nothing here is a measurement of zero - it is a pass that did not finish.",
    );
  });

  it("has no coverage percent at all", () => {
    expect(coveragePercent(FAILED)).toBeNull();
  });
});

describe("a refused pass is an entitlement decision, not a fault", () => {
  const refused = readPass({
    status: "refused",
    report: { reason: "This shop has no active subscription, so the catalogue pass was not run." },
    startedAt: "2026-09-02T09:00:00.000Z",
    finishedAt: "2026-09-02T09:00:01.000Z",
  });

  it("says nothing failed", () => {
    const sentence = passProblem(refused);
    expect(sentence).toContain("did not run");
    expect(sentence).toContain("Nothing failed");
    expect(sentence).not.toContain("failed:");
  });

  it("shows no figures", () => {
    expect(coveragePercent(refused)).toBeNull();
    expect(metricTiles({ totalProducts: 12, pass: refused, alt: null, altFailed: null })[1].value).toBe("-");
  });
});

describe("a done pass is the only source of figures", () => {
  it("computes coverage from sampled and none", () => {
    expect(coveragePercent(DONE)).toBe(99);
  });

  it("fills the row", () => {
    const tiles = metricTiles({
      totalProducts: 355,
      pass: DONE,
      alt: { total: 355, written: 40, keptHuman: 5, shared: [] },
      altFailed: null,
    });
    expect(tiles.map((t) => t.value)).toEqual(["355", "99%", "12", "40"]);
    expect(tiles[1].hint).toBe("352 produce attributes");
    expect(tiles[1].tone).toBe("success");
    expect(passProblem(DONE)).toBeNull();
  });

  it("does not divide by zero when the pass read nothing", () => {
    const empty = readPass({
      status: "done",
      report: { sampled: 0, none: 0, wouldSkip: 0, byAttr: [], depth: [] },
      startedAt: null,
      finishedAt: "2026-09-02T09:00:00.000Z",
    });
    expect(coveragePercent(empty)).toBeNull();
    expect(metricTiles({ totalProducts: 0, pass: empty, alt: null, altFailed: null })[1].value).toBe("-");
  });
});

describe("a shop that has never run a pass", () => {
  it("is told to run one, and is shown no zeros", () => {
    const tiles = metricTiles({
      totalProducts: 355,
      pass: readPass(null),
      alt: null,
      altFailed: null,
    });
    expect(tiles[1].value).toBe("-");
    expect(tiles[1].hint).toBe("run a check to find out");
    expect(tiles[3].hint).toBe("not run yet");
  });
});

describe("the alt text pass", () => {
  it("shows no figure when it failed, and names it", () => {
    const tiles = metricTiles({
      totalProducts: 355,
      pass: DONE,
      alt: null,
      altFailed: { status: "failed", reason: "The image API timed out." },
    });
    expect(tiles[3].value).toBe("-");
    expect(tiles[3].hint).not.toMatch(/\d/);
    expect(altProblem({ status: "failed", reason: "The image API timed out." })).toContain(
      "The image API timed out.",
    );
  });

  it("distinguishes refused from failed", () => {
    expect(altProblem({ status: "refused", reason: "No subscription." })).toContain("Nothing failed");
  });

  it("shows a real zero when the pass finished and wrote nothing", () => {
    const tiles = metricTiles({
      totalProducts: 355,
      pass: DONE,
      alt: { total: 355, written: 0, keptHuman: 355, shared: [] },
      altFailed: null,
    });
    expect(tiles[3].value).toBe("0");
    expect(tiles[3].hint).toBe("355 left as written");
  });
});
