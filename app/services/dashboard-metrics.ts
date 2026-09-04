// The four figures at the top of the dashboard, and the sentence a pass that
// is not a measurement gets instead of them.
//
// Pure and outside the route for the reason report-metrics.ts is: a route
// module imports `authenticate` from shopify.server and cannot be loaded in a
// test at all, so arithmetic assembled inside its JSX can only ever be checked
// in a browser. The bug this file exists to close was exactly that shape - a
// failed pass rendering as coverage 0% with the hint "NaN produce attributes"
// and the line "undefined products read" (audit of 2 September 2026, finding
// 1.4). Every figure below comes from `readPass`, which yields figures only in
// status "done"; nothing here ever reads a JobRun report directly.

import { PassOn, type PassState } from "./report-metrics";

/** The alt text pass as the loader hands it over: figures only when done. */
export type AltFigures = {
  total?: number | null;
  written?: number;
  keptHuman?: number;
  shared?: unknown[];
} | null;

/** An alt text pass that ended in something other than a measurement. */
export type AltProblem = { status: string; reason: string } | null;

export type MetricTile = {
  label: string;
  /** "-" whenever there is no measurement. Never "0", never "NaN". */
  value: string;
  hint: string;
  tone?: "success";
};

/**
 * The one sentence a failed or refused catalogue pass gets. Null for a pass
 * that is a measurement, one that is still running, and a shop that has never
 * run one - those three have their own states elsewhere on the screen and
 * none of them is a problem to report.
 */
export function passProblem(pass: PassState): string | null {
  if (pass.state === "failed") {
    return `${PassOn(pass.when)} failed: ${pass.reason} Nothing here is a measurement of zero - it is a pass that did not finish.`;
  }
  if (pass.state === "refused") {
    return `${PassOn(pass.when)} did not run: ${pass.reason} Nothing failed and nothing is wrong with your catalogue.`;
  }
  return null;
}

/** The same for the alt text pass, which has no `sampled` for readPass to
 *  judge, so its status is read directly. */
export function altProblem(alt: AltProblem): string | null {
  if (!alt) return null;
  return alt.status === "refused"
    ? `The last alt text pass did not run: ${alt.reason} Nothing failed.`
    : `The last alt text pass failed: ${alt.reason} No images were counted, so there is no figure to show from it.`;
}

/** Coverage as a whole percent, or null when there is nothing to divide. */
export function coveragePercent(pass: PassState): number | null {
  if (pass.state !== "done") return null;
  const { sampled, none } = pass.figures;
  if (sampled <= 0) return null;
  return Math.round(((sampled - none) / sampled) * 100);
}

/**
 * The metric row, in order. `totalProducts` is a catalogue fact and is shown
 * whatever the last pass did; the other three are measurements and are shown
 * only when one exists.
 */
export function metricTiles(input: {
  totalProducts: number;
  pass: PassState;
  alt: AltFigures;
  altFailed: AltProblem;
}): MetricTile[] {
  const { totalProducts, pass, alt, altFailed } = input;
  const figures = pass.state === "done" ? pass.figures : null;
  const percent = coveragePercent(pass);
  const problem = passProblem(pass);

  return [
    { label: "Products", value: String(totalProducts), hint: "in this catalogue" },
    {
      label: "Coverage",
      value: percent === null ? "-" : `${percent}%`,
      hint:
        figures && percent !== null
          ? `${figures.sampled - figures.none} produce attributes`
          : problem
            ? "the last pass is not a measurement"
            : pass.state === "running"
              ? "a pass is reading your catalogue now"
              : "run a check to find out",
      tone: percent !== null && percent >= 80 ? "success" : undefined,
    },
    {
      label: "Protected",
      value: figures ? String(figures.wouldSkip ?? 0) : "-",
      hint: "written by a person, never overwritten",
    },
    {
      label: "Alt text",
      value: alt && typeof alt.written === "number" ? String(alt.written) : "-",
      hint:
        alt && typeof alt.written === "number"
          ? `${alt.keptHuman ?? 0} left as written`
          : altFailed
            ? "the last pass is not a measurement"
            : "not run yet",
    },
  ];
}
