// The ladder: one ordered path after install (audit of 2 September 2026,
// findings 1.6 and 1.7; EXPERIENCE-PRD section 3).
//
// What it replaces: eleven live controls on a fresh install, two of them
// carrying variant="primary" in different cards, a flat Setup checklist with
// no locked state, and the app embed - without which nothing whatsoever is
// published - as item five in the right-hand column, below the fold, behind a
// caution icon. A merchant could run a 400-product pass, see success
// everywhere, and publish nothing.
//
// The rules this file enforces, and the reason each is here:
//
//  - Five steps, fixed order. Each has one action, one done state and one
//    sentence saying what it is for.
//  - Exactly one primary button on the screen: the action of the first
//    unfinished step. Everything below it is visible but quiet - no primary,
//    no colour, its action disabled with the reason in words rather than
//    greyed out silently.
//  - A finished step collapses to one line carrying its result.
//  - A failed pass belongs to the step that queued it. A dry run that failed
//    is step three's problem and a catalogue pass that failed is step four's;
//    neither is ever reported against step one, which would tell the merchant
//    to go and re-run a crawler check that worked.
//  - Every done state is read from the loader - JobRun rows, metafields,
//    settings - and no new JobRun kind exists to serve it.
//
// Pure: no Shopify, no Prisma, no React. A route module cannot be imported in
// a test at all, so the whole ordering, locking and wording decision lives
// here where it can be asserted on directly, and the route only lays it out.

import { formatDay, type PassState } from "./report-metrics";
import { describeJobKind } from "./job-kinds";
import { passProblem } from "./dashboard-metrics";

export type StepKey = "reach" | "publish" | "right" | "everywhere" | "yours";

export type StepStatus =
  /** Finished. Collapses to one line with its result. */
  | "done"
  /** The first unfinished step. The only place a primary button exists. */
  | "current"
  /** Below the first unfinished step. Visible, quiet, action disabled. */
  | "locked"
  /** Does not apply to this shop, and saying "done" would be a lie. */
  | "not_needed";

export type StepAction = {
  label: string;
  /** How the route performs it: post a job, follow a link, leave the app, or
   *  simply re-read the loader (the embed's "Check again", which verifies
   *  against the published theme on every load). */
  kind: "job" | "link" | "external" | "revalidate";
  /** The action's `mode` field, for kind "job". */
  mode?: string;
  /** The route to follow, for kind "link". */
  to?: string;
  /** The URL to open, for kind "external". */
  url?: string;
  primary: boolean;
  disabled: boolean;
  /** Why it is disabled, in words a merchant can act on. Null when enabled. */
  disabledReason: string | null;
};

export type SubLine = { label: string; done: boolean; to: string; hint: string };

export type LadderStep = {
  key: StepKey;
  /** 1 to 5, and it is the number shown. */
  number: number;
  title: string;
  /** One sentence: what this step is for. Shown in every state. */
  purpose: string;
  status: StepStatus;
  /** The one line a done or not-needed step collapses to. */
  result: string | null;
  /** A failure or refusal that belongs to this step, named, with no figure
   *  in it. Never carried by any other step. */
  problem: string | null;
  action: StepAction | null;
  /** A second, always-secondary action: "Check again", "See why", the link a
   *  step needs to be completable at all. */
  extra: StepAction | null;
  subs: SubLine[];
};

export type Ladder = {
  steps: LadderStep[];
  /** The step carrying the only primary button, or null when all five are
   *  finished and the screen has no primary at all. */
  currentKey: StepKey | null;
};

export type EmbedLike = {
  active?: boolean;
  presentButDisabled?: boolean;
  staleReference?: boolean;
  unreadable?: boolean;
  themeName?: string | null;
} | null;

export type CrawlerVerdict = { agent: string; cause: string };

export type LadderInput = {
  /** The last crawler_check JobRun, any status. Done at any verdict: the
   *  verdict is the answer, not a pass mark. */
  crawlerJob: { status: string; report?: unknown; finishedAt?: string | null } | null;
  /** Latest verdict per crawler, as the loader already assembles it. */
  crawlers: CrawlerVerdict[];
  embed: EmbedLike;
  embedLink: string;
  hasAccess: boolean;
  freeProductsRemaining: number;
  /** The last dry run, through readPass. Step three's action queues it. */
  previewPass: PassState;
  /** The last catalogue pass, through readPass. Step four's action queues it. */
  fillPass: PassState;
  /** The last completed write, which is what "done everywhere" means. */
  lastWrite: { finishedAt: string | null } | null;
  hasDictionary: boolean;
  hasBusiness: boolean;
  collectionsBuilt: { at: string | null; withTable: number; total: number } | null;
  /** The kind of the job currently queued or running, from the same read the
   *  one-at-a-time guard uses. Every job action is disabled while one is, and
   *  the reason names it, as the banners on this screen already do. */
  blockingKind: string | null;
};

/** Short verdict labels for the crawler tiles. Shared with the route, which
 *  renders the tiles inside step one. */
export const CAUSE_SHORT: Record<string, string> = {
  password_page: "Sees the password page",
  bot_protection: "Blocked by bot protection",
  cloudflare: "Blocked by Cloudflare",
  redirect_loop: "Lost in redirects",
  robots_disallow: "Disallowed in robots.txt",
  server_error: "Store returned an error",
  unreachable: "No response - not the same as blocked",
  unknown: "Unclear response",
};

/**
 * The crawler check's verdict as one sentence with its denominator, which is
 * the whole point of the check: "2 of 8 crawlers received a product page" is
 * checkable, "crawler access: poor" is not.
 */
export function crawlerVerdict(crawlers: CrawlerVerdict[]): string {
  if (crawlers.length === 0) {
    return "The check ran but recorded no crawler, so there is no verdict to show. Run it again.";
  }
  const ok = crawlers.filter((c) => c.cause === "ok").length;
  const head = `${ok} of ${crawlers.length} crawlers received a product page.`;
  if (ok === crawlers.length) return head;

  // Name the reason the largest group was turned away rather than eight
  // separate ones: the tiles below carry every crawler individually.
  const counts = new Map<string, number>();
  for (const c of crawlers) {
    if (c.cause === "ok") continue;
    counts.set(c.cause, (counts.get(c.cause) ?? 0) + 1);
  }
  let top = "unknown";
  let topN = 0;
  for (const [cause, n] of counts) {
    if (n > topN) {
      top = cause;
      topN = n;
    }
  }
  const label = (CAUSE_SHORT[top] ?? top).toLowerCase();
  return `${head} ${crawlers.length - ok} did not: ${label}.`;
}

/**
 * The embed has three states, not two. `unreadable` means the published
 * theme's settings file could not be parsed, and until 4 September 2026 every
 * screen rendered that as "the embed is off" - an unknown asserted as a fact,
 * and the fact happened to be the one that makes the merchant go and change
 * something that may already be correct (audit finding 1.7).
 */
export function embedState(embed: EmbedLike): "active" | "off" | "unknown" {
  if (!embed) return "unknown";
  if (embed.active) return "active";
  if (embed.unreadable) return "unknown";
  return "off";
}

function embedSentence(embed: EmbedLike): string {
  const state = embedState(embed);
  if (state === "active") {
    return `Verified in ${embed?.themeName || "your published theme"}. The storefront output is live.`;
  }
  if (state === "unknown") {
    return "We could not read your theme settings, so we do not know whether the embed is on. That is an unknown, not an off - open the theme editor and check, and nothing here says you did anything wrong.";
  }
  if (embed?.staleReference) {
    return "Enabled, but pointing at an old development version, so it renders nothing. Open the theme editor, switch AI Visibility off and on again, and save.";
  }
  if (embed?.presentButDisabled) {
    return 'Added but switched off. Open the theme editor, turn on "AI Visibility" and save.';
  }
  return 'Turn on "AI Visibility" under App embeds. Nothing is published until you do, however much the app has written.';
}

/** What a locked step says instead of a button. Never a greyed-out control
 *  with no explanation: the merchant has to be able to read why. */
function lockedBecause(blockerTitle: string | undefined, blockerNumber: number): string {
  return blockerTitle
    ? `Step ${blockerNumber}, ${blockerTitle.toLowerCase()}, comes first.`
    : "An earlier step comes first.";
}

export function resolveLadder(input: LadderInput): Ladder {
  const {
    crawlerJob,
    crawlers,
    embed,
    embedLink,
    hasAccess,
    freeProductsRemaining,
    previewPass,
    fillPass,
    lastWrite,
    hasDictionary,
    hasBusiness,
    collectionsBuilt,
    blockingKind,
  } = input;

  // Step one. Done at any verdict: the check is the measurement, and a
  // password-protected pre-launch store answering "password page" on all eight
  // is a complete, correct answer, not a failure to progress past.
  const crawlerDone = crawlerJob?.status === "done";
  const crawlerProblem =
    crawlerJob && crawlerJob.status !== "done" && crawlerJob.status !== "queued" && crawlerJob.status !== "running"
      ? `The crawler check ${crawlerJob.status === "refused" ? "did not run" : "failed"}${
          formatDay(crawlerJob.finishedAt ?? null) ? ` on ${formatDay(crawlerJob.finishedAt ?? null)}` : ""
        }: ${
          ((crawlerJob.report ?? null) as { reason?: string; error?: string } | null)?.reason ??
          ((crawlerJob.report ?? null) as { reason?: string; error?: string } | null)?.error ??
          "No reason was recorded with it."
        } No verdict was recorded, so nothing here is a verdict.`
      : null;

  const embedStatus = embedState(embed);

  // Step three is the free tier: the coverage score and three products the
  // merchant chooses, so the output can be judged on their own catalogue
  // before any money moves. A paid shop was never held to it.
  const rightNotNeeded = hasAccess;
  const rightDone = !hasAccess && freeProductsRemaining === 0;

  const everywhereDone = Boolean(lastWrite);

  const yoursDone = hasDictionary && hasBusiness && Boolean(collectionsBuilt);

  const statuses: Record<StepKey, "done" | "open" | "not_needed"> = {
    reach: crawlerDone ? "done" : "open",
    publish: embedStatus === "active" ? "done" : "open",
    right: rightNotNeeded ? "not_needed" : rightDone ? "done" : "open",
    everywhere: everywhereDone ? "done" : "open",
    yours: yoursDone ? "done" : "open",
  };

  const order: StepKey[] = ["reach", "publish", "right", "everywhere", "yours"];
  const currentKey = order.find((k) => statuses[k] === "open") ?? null;
  const currentIndex = currentKey ? order.indexOf(currentKey) : order.length;

  const titles: Record<StepKey, string> = {
    reach: "Can they reach you",
    publish: "Can you publish at all",
    right: "Is it right",
    everywhere: "Do it everywhere",
    yours: "Make it yours",
  };

  const purposes: Record<StepKey, string> = {
    reach:
      "An assistant has to be able to fetch a product page before anything we write can be read, so we ask each one, with its own user agent, from outside Shopify.",
    publish:
      "The app embed is the only way what we write reaches your storefront; until it is on in your published theme, nothing at all is published.",
    right:
      "See the coverage score and three products of your choosing fully processed, on your own catalogue, before any money moves.",
    everywhere:
      "One pass over the whole catalogue, writing the attributes into your own Shopify metafields, where they stay whatever happens to us.",
    yours:
      "Three settings that make the output match your trade, your terms and your collection pages. Every one of them is optional.",
  };

  const blockedReason = blockingKind
    ? `${describeJobKind(blockingKind)} is running. One job at a time, so this waits for it.`
    : null;

  function jobAction(
    key: StepKey,
    label: string,
    mode: string,
    index: number,
  ): StepAction {
    const locked = index > currentIndex;
    return {
      label,
      kind: "job",
      mode,
      primary: key === currentKey && !blockedReason,
      disabled: locked || Boolean(blockedReason),
      disabledReason: locked
        ? lockedBecause(titles[order[currentIndex]], currentIndex + 1)
        : blockedReason,
    };
  }

  function linkAction(
    key: StepKey,
    label: string,
    to: string,
    index: number,
  ): StepAction {
    const locked = index > currentIndex;
    return {
      label,
      kind: "link",
      to,
      primary: key === currentKey,
      disabled: locked,
      disabledReason: locked ? lockedBecause(titles[order[currentIndex]], currentIndex + 1) : null,
    };
  }

  const steps: LadderStep[] = order.map((key, index) => {
    const status: StepStatus =
      statuses[key] === "done"
        ? "done"
        : statuses[key] === "not_needed"
          ? "not_needed"
          : key === currentKey
            ? "current"
            : "locked";

    const base = {
      key,
      number: index + 1,
      title: titles[key],
      purpose: purposes[key],
      status,
      result: null as string | null,
      problem: null as string | null,
      action: null as StepAction | null,
      extra: null as StepAction | null,
      subs: [] as SubLine[],
    };

    if (key === "reach") {
      const running = crawlerJob?.status === "queued" || crawlerJob?.status === "running";
      return {
        ...base,
        result: crawlerDone ? crawlerVerdict(crawlers) : null,
        problem: crawlerProblem,
        action: {
          ...jobAction(key, crawlers.length ? "Check again" : "Check now", "crawlers", index),
          disabled: running || Boolean(blockedReason),
          disabledReason: running ? "The check is running now." : blockedReason,
          primary: key === currentKey && !running && !blockedReason,
        },
        extra:
          crawlers.some((c) => c.cause !== "ok")
            ? {
                label: "See why",
                kind: "link",
                to: "/app/diagnostics",
                primary: false,
                disabled: false,
                disabledReason: null,
              }
            : null,
      };
    }

    if (key === "publish") {
      const locked = index > currentIndex;
      return {
        ...base,
        result: embedSentence(embed),
        action:
          embedStatus === "active"
            ? null
            : {
                label: "Open theme editor",
                kind: "external",
                url: embedLink,
                primary: key === currentKey,
                disabled: locked,
                disabledReason: locked
                  ? lockedBecause(titles[order[currentIndex]], currentIndex + 1)
                  : null,
              },
        extra:
          embedStatus === "active"
            ? null
            : {
                label: "Check again",
                kind: "revalidate",
                primary: false,
                disabled: false,
                disabledReason: null,
              },
      };
    }

    if (key === "right") {
      const result = rightNotNeeded
        ? "Not needed: your plan already covers every product, so there is nothing to hold back and nothing to sample."
        : rightDone
          ? "All three of your free products are processed. What was written stays written, subscription or not."
          : null;
      return {
        ...base,
        result,
        problem: passProblem(previewPass),
        action: rightNotNeeded
          ? {
              label: "Preview changes",
              kind: "job",
              mode: "dry",
              primary: false,
              disabled: Boolean(blockedReason),
              disabledReason: blockedReason,
            }
          : jobAction(key, "Preview changes", "dry", index),
        extra: rightNotNeeded
          ? null
          : {
              label:
                freeProductsRemaining === 3
                  ? "Choose your three products"
                  : `Choose ${freeProductsRemaining} more`,
              kind: "link",
              to: "/app/products",
              primary: false,
              disabled: index > currentIndex,
              disabledReason:
                index > currentIndex
                  ? lockedBecause(titles[order[currentIndex]], currentIndex + 1)
                  : null,
            },
      };
    }

    if (key === "everywhere") {
      return {
        ...base,
        result: everywhereDone
          ? `Written ${formatDay(lastWrite?.finishedAt ?? null) ?? "already"}. New and edited products are picked up automatically from here on.`
          : null,
        problem: passProblem(fillPass),
        action: hasAccess
          ? jobAction(key, "Fill catalogue", "write", index)
          : linkAction(key, "Subscribe", "/app/plans", index),
      };
    }

    // "Make it yours": three sub-lines, each with its own done state, and the
    // step is done when all three are. They are separate because they are
    // separate decisions - a shop with no delivery promise to state is not
    // half-configured, and the dictionary is the only one that changes what
    // the engine reads.
    const subs: SubLine[] = [
      {
        label: "Dictionary for your trade",
        done: hasDictionary,
        to: "/app/dictionary",
        hint: hasDictionary
          ? "Saved. Edit it whenever your catalogue changes."
          : "Pick a preset and translate the terms into the language your descriptions use.",
      },
      {
        label: "Delivery, returns and warranty",
        done: hasBusiness,
        to: "/app/business",
        hint: hasBusiness
          ? "Stated once and published as buyer questions on every product."
          : "State them once and every product answers them; leave them empty and nothing about them is published.",
      },
      {
        label: "Collection pages",
        done: Boolean(collectionsBuilt),
        to: "/app/collections",
        hint: collectionsBuilt
          ? `${collectionsBuilt.withTable} of ${collectionsBuilt.total} collections carry a comparison table. The rest have nothing that varies enough to compare, which is a fact about the products, not a fault.`
          : "Collections can carry a summary and a comparison table built from the same attributes.",
      },
    ];
    const firstOpen = subs.find((s) => !s.done);
    return {
      ...base,
      result: yoursDone ? "All three are set. Change any of them whenever you like." : null,
      subs,
      action: firstOpen
        ? linkAction(key, `Open ${firstOpen.label.toLowerCase()}`, firstOpen.to, index)
        : null,
    };
  });

  return { steps, currentKey };
}

/** How many primary buttons the ladder puts on the screen. The answer is 1
 *  while any step is open and 0 once every step is finished, and the test
 *  asserts it rather than trusting the branches above. */
export function primaryCount(ladder: Ladder): number {
  let n = 0;
  for (const s of ladder.steps) {
    if (s.action?.primary) n += 1;
    if (s.extra?.primary) n += 1;
  }
  return n;
}
