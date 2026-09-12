// The catalogue pass, as a card of its own on the dashboard.
//
// Why it exists (SPEC-EXTRACTION-QUALITY, second module; batch 5 item 4).
// "Fill catalogue" lived only inside step four of the ladder, and a finished
// step collapses to one line. So a merchant who had completed the checklist -
// which is every merchant, eventually - had no obvious way to run the pass
// again and no way at all to watch it run. The card is always present,
// outside the ladder, and the dry run sits beside it rather than behind a
// disclosure.
//
// One action, two entry points. The step's button and this card's button both
// post `mode=write` to the same route action, and the one-job-at-a-time guard
// there is untouched: this file decides only what the two say while a job
// holds the queue.
//
// Pure - no React, no Prisma, no Shopify - for the same reason
// dashboard-steps.ts is: a route module cannot be imported in a test, so
// wording and arithmetic assembled inside JSX can only be checked in a
// browser. Every state below has a test.

import { PassOn, type PassState } from "./report-metrics";
import { describeJobKind } from "./job-kinds";

/** The JobRun row behind a running pass, as the loader hands it over. */
export type RunningPass = {
  status: string;
  progress: number | null;
  total: number | null;
  startedAt: string | null;
} | null;

export type CardButton = {
  label: string;
  /** The `mode` field posted to the dashboard's action. */
  mode: string;
  primary: boolean;
  disabled: boolean;
  /** Why, in words. Null when the button works. */
  disabledReason: string | null;
};

export type PassProgress = {
  done: number;
  total: number;
  /** 0 to 100, whole. */
  percent: number;
  /** "Product 128 of 189", or the honest thing to say before the total is known. */
  label: string;
  /** "4 minutes so far", or null when the row carries no start time. */
  elapsed: string | null;
};

export type CataloguePassCard = {
  /** What the pass does. One sentence, shown in every state. */
  what: string;
  state: "never" | "running" | "done" | "failed" | "refused";
  /** When it last ran, in the merchant's words. Null while it has never run. */
  when: string | null;
  /** Live progress, only while it is running. */
  progress: PassProgress | null;
  /** What it wrote. Null in every state but a finished write pass. */
  wrote: string | null;
  /** What went wrong and what to do. Null unless something did. */
  problem: string | null;
  run: CardButton;
  dry: CardButton;
};

const WHAT =
  "One pass over every published product: it reads the descriptions you already wrote, " +
  "pulls out the comparable attributes, and writes them into your own Shopify metafields.";

/** "4 minutes", "1 hour 5 minutes". Seconds below a minute, because a pass that
 *  has just started should not read "0 minutes". */
export function elapsedWords(startedAt: string | null, now: Date): string | null {
  if (!startedAt) return null;
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return null;
  const seconds = Math.floor((now.getTime() - started.getTime()) / 1000);
  // A clock skew between the worker and this container can put the start in
  // the future. "0 seconds so far" is better than a negative number.
  if (seconds < 60) return `${Math.max(0, seconds)} seconds so far`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} so far`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? `${h} so far` : `${h} ${rest} minute${rest === 1 ? "" : "s"} so far`;
}

/**
 * What the pass wrote, counted in products. A pass whose report predates this
 * measurement says so; a dry run never reaches here at all, because it writes
 * nothing and its own figures are the coverage score.
 *
 * "Unchanged" is stated rather than hidden. It is the largest number on a
 * second pass, it looks like failure if it is not explained, and it is the
 * rule that stops this app writing a value it just wrote and feeding its own
 * webhooks for ever.
 */
export function wroteSentence(pass: PassState): string | null {
  if (pass.state !== "done") return null;
  const wrote = pass.figures.wrote;
  if (!wrote) {
    return "That pass did not record what it wrote. The next one will.";
  }
  const parts = [
    `${wrote.written} product${wrote.written === 1 ? "" : "s"} written`,
    `${wrote.unchanged} already identical and left alone`,
  ];
  if (wrote.protectedRows > 0) {
    parts.push(
      `${wrote.protectedRows} with values a person wrote, which were kept`,
    );
  }
  if (wrote.withdrawn > 0) {
    parts.push(`${wrote.withdrawn} where a value we had written no longer applies and was withdrawn`);
  }
  return `Out of ${pass.figures.sampled} products read: ${parts.join(", ")}.`;
}

/** The progress a running row can honestly show. */
export function passProgress(row: RunningPass, now: Date): PassProgress | null {
  if (!row) return null;
  if (row.status !== "running" && row.status !== "queued") return null;
  const total = row.total ?? 0;
  const done = row.progress ?? 0;
  const elapsed = elapsedWords(row.startedAt, now);
  // A queued job, and the first moments of a running one, have no total yet.
  // A bar drawn from nothing would sit at 0% and read as stuck.
  if (total <= 0) {
    return { done: 0, total: 0, percent: 0, label: "Starting up...", elapsed };
  }
  return {
    done,
    total,
    percent: Math.min(100, Math.round((done / total) * 100)),
    label: `Product ${done} of ${total}`,
    elapsed,
  };
}

export function cataloguePassCard(input: {
  pass: PassState;
  running: RunningPass;
  /** The kind of job holding the queue, when it is not this one. */
  blockingKind: string | null;
  /** False on a shop with no subscription: the whole-catalogue pass is paid. */
  hasAccess: boolean;
  now: Date;
}): CataloguePassCard {
  const { pass, running, blockingKind, hasAccess, now } = input;
  const progress = passProgress(running, now);
  const isRunning = progress !== null;

  // The same sentence the ladder's buttons carry, from the same helper, so the
  // two entry points cannot drift into saying different things about one
  // queue.
  const blocked = blockingKind
    ? `${describeJobKind(blockingKind)} is running. One job at a time, so this waits for it.`
    : null;
  const selfRunning = isRunning ? "This pass is running now." : null;
  const reason = selfRunning ?? blocked;

  const state: CataloguePassCard["state"] = isRunning
    ? "running"
    : pass.state === "none"
      ? "never"
      : pass.state === "running"
        ? "running"
        : pass.state;

  const problem =
    state === "failed" && pass.state === "failed"
      ? `${PassOn(pass.when)} failed: ${pass.reason} Nothing was half-written - a product is written whole or not at all. Press Fill catalogue to run it again; if it fails twice, write to us with the date above.`
      : state === "refused" && pass.state === "refused"
        ? `${PassOn(pass.when)} did not run: ${pass.reason} Nothing failed and nothing is wrong with your catalogue.`
        : null;

  return {
    what: WHAT,
    state,
    when: pass.state === "none" ? null : ((pass as { when?: string | null }).when ?? null),
    progress,
    wrote: state === "done" ? wroteSentence(pass) : null,
    problem,
    run: hasAccess
      ? {
          label: "Fill catalogue",
          mode: "write",
          primary: !reason,
          disabled: Boolean(reason),
          disabledReason: reason,
        }
      : {
          label: "Subscribe to fill the catalogue",
          mode: "write",
          primary: false,
          disabled: true,
          disabledReason:
            "The whole-catalogue pass needs a subscription. The coverage score below is free, and so are the three products you choose on the Products screen.",
        },
    dry: {
      label: "Preview changes",
      mode: "dry",
      primary: false,
      disabled: Boolean(reason),
      disabledReason: reason,
    },
  };
}
