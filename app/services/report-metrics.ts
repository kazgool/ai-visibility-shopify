// The arithmetic and the wording behind the Report screen
// (PRD-REPORT-SCREEN.md), kept out of the route so every figure on that
// screen can be checked without a browser, a database or a Shopify session.
//
// No ".server" suffix, for the same reason as seo-queue-metrics.ts: the
// screen's own component calls these, and a value import from a .server file
// that the client can see fails the build.
//
// The rule this file exists to enforce (EXPERIENCE-PRD §2, and the trap this
// codebase has already shipped once): a JobRun's report is figures only in
// status "done". A failed job's report is `{ error }`, which is truthy, so
// anything that reads `job.report` without checking the status renders a
// failure as a measured zero. `readPass` is the only door in.

// crawler-info.ts, not crawler-check.server.ts: this module is imported by the
// screen's own component, and a value import from a .server file the client can
// see fails the build. The cause taxonomy lives there for exactly that reason.
import {
  OWN_SETTING_CAUSES,
  OWN_SETTING_FIX,
  explainCause,
  isOwnSetting,
} from "./crawler-info";

export type PassJobLike = {
  status: string;
  report: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  kind?: string;
} | null | undefined;

export type PassFigures = {
  sampled: number;
  none: number;
  /**
   * One per extracted Fact.
   *
   * It was documented here as a count of VALUES that could exceed `sampled`,
   * and the screen printed method lines built on that. The engine cannot
   * produce it: `extract.ts` pushes exactly one Fact per family per product and
   * joins the readings it found with commas, so a product stating two sizes
   * contributes one. Measured on 189 and on 355 real products, `byAttr` and
   * `byAttrProducts` are identical entry for entry, and no product anywhere
   * produced two Facts with the same key.
   *
   * It is kept because other readers still use it: `detailSummary` totals it,
   * `missingFamilies` ranks by it, and the dashboard and the dictionary screen
   * both render it from reports this screen never sees. `byAttrProducts` is the
   * honest name for the same figure and is what this screen prefers.
   */
  byAttr: [string, number][];
  /** One per PRODUCT per family, so `sampled` is its denominator and
   * "Dimensions on 306 of 355" is true of it. Absent on any report written
   * before the field existed; `byAttr` is then read instead, which is the same
   * tally under an older name. */
  byAttrProducts?: [string, number][];
  depth: number[];
  wouldSkip: number;
  weakest?: WeakProductLike[];
};

export type WeakProductLike = { title: string; families: string[]; id?: string };

export type PassState =
  | { state: "none" }
  | { state: "running" }
  | { state: "failed"; when: string | null; reason: string }
  /** An entitlement decision, not a failure: the pass was never attempted
   * because the plan does not cover it. Saying "failed" here sends the
   * merchant looking for a fault that does not exist. */
  | { state: "refused"; when: string | null; reason: string }
  | { state: "done"; when: string | null; figures: PassFigures };

/** How many distinct attribute families a product needs before this screen
 * calls it ready. Four is the number the segmented bar and the dial both use,
 * and it is stated on the screen next to them rather than left implied. */
export const READY_FAMILIES = 4;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "31 August 2026", written out rather than left to toLocaleDateString.
 *
 * The locale of a server in Frankfurt is not the merchant's, so the same pass
 * would be dated "31.8.2026" or "8/31/2026" depending on where the container
 * happened to boot, and neither is the English this UI is written in. Written
 * in UTC for the same reason: the stored timestamp is UTC and shifting it into
 * whatever zone the container thinks it is in can move the date by a day.
 *
 * Null when there is no usable timestamp, so the caller leaves the date out of
 * the sentence instead of printing a placeholder where a date belongs.
 */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

/** How a method line names the pass it read. With no date on record the
 * clause simply does not carry one: the denominator, which is the part the
 * number cannot be read without, is unaffected. */
export function passOn(when: string | null): string {
  return when ? `the pass on ${when}` : "the last pass";
}

/** The same clause at the start of a sentence. */
export function PassOn(when: string | null): string {
  return when ? `The pass on ${when}` : "The last pass";
}

/**
 * The only way this screen is allowed to look at a pass. Statuses other than
 * "done" never yield figures: a failure names itself and its stored reason, a
 * pass still in flight says so, and a shop that has never run one gets the
 * empty state instead of a row of zeros.
 */
export function readPass(job: PassJobLike): PassState {
  if (!job) return { state: "none" };
  if (job.status === "queued" || job.status === "running") return { state: "running" };

  // "refused" is written by the worker when a shop has no active subscription
  // (worker/tasks.ts). Nothing went wrong: the pass was declined before it
  // started. Folding it into "failed" tells the merchant to look for a fault,
  // and the only thing to look at is the plan.
  if (job.status === "refused") {
    const stored = (job.report ?? null) as { reason?: string } | null;
    return {
      state: "refused",
      when: formatDay(job.finishedAt ?? job.startedAt),
      reason:
        stored?.reason ??
        "This shop has no active subscription, so the catalogue pass was not run.",
    };
  }

  if (job.status !== "done") {
    const stored = (job.report ?? null) as { error?: string; reason?: string } | null;
    return {
      state: "failed",
      when: formatDay(job.finishedAt ?? job.startedAt),
      reason:
        stored?.reason ??
        stored?.error ??
        "No reason was recorded with the failure.",
    };
  }

  const raw = (job.report ?? null) as Partial<PassFigures> | null;
  if (!raw || typeof raw.sampled !== "number") {
    return {
      state: "failed",
      when: formatDay(job.finishedAt ?? job.startedAt),
      reason: "The pass finished but wrote no figures, so there is nothing to show from it.",
    };
  }

  return {
    state: "done",
    when: formatDay(job.finishedAt ?? job.startedAt),
    figures: {
      sampled: raw.sampled,
      none: raw.none ?? 0,
      byAttr: raw.byAttr ?? [],
      // Left undefined, not defaulted to an empty array: undefined means the
      // pass predates the per-product tally and the screen says so, whereas an
      // empty array would read as "no family was found anywhere".
      byAttrProducts: Array.isArray(raw.byAttrProducts) ? raw.byAttrProducts : undefined,
      // A report written before `depth` existed has none. An empty array is
      // honest here: every panel that needs it checks its length against
      // `sampled` and says the pass predates the measurement rather than
      // computing a readiness figure from nothing.
      depth: Array.isArray(raw.depth) ? raw.depth : [],
      wouldSkip: raw.wouldSkip ?? 0,
      weakest: Array.isArray(raw.weakest) ? raw.weakest : undefined,
    },
  };
}

/**
 * Why a per-product panel cannot draw, told apart so the screen never blames
 * the wrong thing.
 *
 * - "ok": there is a distribution, one entry per product.
 * - "no products": the pass ran and read nothing, because the shop has no
 *   product that is both active and published. That is a true statement about
 *   the catalogue, not a stale report, and telling the merchant to run the
 *   pass again would send them round a loop that cannot end differently.
 * - "predates": the pass is older than the per-product measurement.
 */
export type DepthState = "ok" | "no products" | "predates";

export function depthState(figures: PassFigures): DepthState {
  if (figures.sampled === 0) return "no products";
  return figures.depth.length === figures.sampled ? "ok" : "predates";
}

/** True when the pass carries a per-product distribution to work from. */
export function hasDepth(figures: PassFigures): boolean {
  return depthState(figures) === "ok";
}

export type Readiness = {
  total: number;
  ready: number;
  partly: number;
  nothing: number;
  percent: number;
};

/**
 * Ready / partly ready / nothing to read, over the products the pass read.
 * The three counts always sum to the total, so the segmented bar cannot show
 * a slice that belongs to nobody.
 */
export function readiness(depth: number[]): Readiness {
  let ready = 0;
  let nothing = 0;
  for (const d of depth) {
    if (d >= READY_FAMILIES) ready += 1;
    else if (d === 0) nothing += 1;
  }
  const total = depth.length;
  const partly = total - ready - nothing;
  return {
    total,
    ready,
    partly,
    nothing,
    percent: total > 0 ? Math.round((ready / total) * 100) : 0,
  };
}

export type DialArc = { x: number; y: number; large: 0; d: string };

/**
 * The swept arc of the readiness dial, as an SVG path.
 *
 * The large-arc flag is 0 for every percentage there is. The dial is a
 * semicircle, so the sweep runs from 180 degrees to 0 and is never as much as
 * 180 degrees, let alone more; the short arc is always the one that matches
 * the number printed in the middle. The flag used to be set to 1 above 50
 * percent, which is what a full-circle gauge would want, and above half the
 * stroke went the long way round underneath - a 90 percent dial drew as a
 * near-empty one, contradicting the "90%" inside it.
 */
export function dialArc(percent: number, radius: number, cx: number, cy: number): DialArc {
  const clamped = Math.min(100, Math.max(0, percent));
  const angle = Math.PI * (1 - clamped / 100);
  const x = cx + radius * Math.cos(angle);
  const y = cy - radius * Math.sin(angle);
  const large = 0 as const;
  return {
    x,
    y,
    large,
    d: `M ${cx - radius} ${cy} A ${radius} ${radius} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}`,
  };
}

export type DetailSummary = {
  /** The number of Facts the pass produced: one per product per kind of
   * detail, each holding every reading of that kind the description gave. It
   * is therefore also the sum of `depth`. It is not a count of readings, and
   * the method line beside it must not say it is. */
  values: number;
  describing: number;
  sampled: number;
  /** The mean, to one decimal. Named "average" everywhere it is shown,
   * because it is one: a median would be a different number and the label
   * would then be a lie about the arithmetic. */
  average: number;
};

export function detailSummary(figures: PassFigures): DetailSummary {
  const values = figures.byAttr.reduce((sum, [, n]) => sum + n, 0);
  const describing = figures.sampled - figures.none;
  return {
    values,
    describing,
    sampled: figures.sampled,
    average: describing > 0 ? Math.round((values / describing) * 10) / 10 : 0,
  };
}

export type HistogramBucket = { label: string; count: number };

/**
 * The bucket edges, chosen from two real catalogues rather than guessed.
 *
 * Republica BIO, 189 products with their own dictionary: depths run 1 to 23,
 * with 169 of the 189 at 10 or more. Under the previous scheme - single values
 * 0 to 9 and one "10+" tail - that drew as one full bar and ten near-empty
 * ones, which is a shape that carries no information about a catalogue whose
 * whole story happens inside the tail.
 *
 * The furniture catalogue, 355 products on the default dictionary: depths run 0
 * to 4 and nothing above. Its entire story happens in the head, so the head
 * cannot be widened either.
 *
 * Single values to five keep the head readable and put an exact edge at
 * READY_FAMILIES, which is the threshold the dial and the segmented bar use.
 * The tail then widens as it goes out. Republica BIO now draws nine bars of
 * twelve - 4, 2, 1, 1, 12, 44, 55, 62, 8 - a rise to a broad middle and a fall,
 * with the tallest holding a third of the catalogue rather than 89 percent of
 * it. The furniture catalogue still draws its four bars where they are.
 */
const HISTOGRAM_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: "0", from: 0, to: 0 },
  { label: "1", from: 1, to: 1 },
  { label: "2", from: 2, to: 2 },
  { label: "3", from: 3, to: 3 },
  { label: "4", from: 4, to: 4 },
  { label: "5", from: 5, to: 5 },
  { label: "6-7", from: 6, to: 7 },
  { label: "8-9", from: 8, to: 9 },
  { label: "10-12", from: 10, to: 12 },
  { label: "13-15", from: 13, to: 15 },
  { label: "16-19", from: 16, to: 19 },
  { label: "20+", from: 20, to: Number.POSITIVE_INFINITY },
];

/** How many products produced how many distinct families. Every product lands
 * in exactly one bucket, so the counts always sum to the number of products
 * read. */
export function depthHistogram(depth: number[]): HistogramBucket[] {
  const buckets: HistogramBucket[] = HISTOGRAM_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const d of depth) {
    const at = HISTOGRAM_BUCKETS.findIndex((b) => d >= b.from && d <= b.to);
    // Below zero is not a depth this engine can produce; if one ever appears it
    // is counted in the first bucket rather than silently dropped, because a
    // histogram whose bars do not add up to the products read is worse than a
    // stray bar the merchant can see.
    buckets[at === -1 ? 0 : at].count += 1;
  }
  return buckets;
}

/**
 * The families a weak product does not state, drawn from the families the
 * rest of this catalogue does state. Nothing is suggested that no product
 * here has ever produced - a "missing" list built from the dictionary would
 * name families this shop's trade has no use for.
 */
export function missingFamilies(
  families: string[],
  byAttr: [string, number][],
  limit = 3,
): string[] {
  const has = new Set(families.map((f) => f.toLowerCase()));
  return byAttr
    .filter(([name]) => !has.has(name.toLowerCase()))
    .slice(0, limit)
    .map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Before and after (PRD-REPORT-SCREEN §3).

export type Segment = { text: string; highlighted: boolean };

/**
 * Rebuild the highlights over a product's own description.
 *
 * `Fact` is `{ k, v }` and carries no offset, so where a value came from has
 * to be found again by searching - and the search can miss, because the
 * engine trims and normalises phrases on the way out. A miss loses the
 * highlight, never the row: the value is still shown beside its label on the
 * other side of the panel. Overlapping matches are dropped rather than nested,
 * so the rendered text is always the original text, once.
 */
export function highlightSpans(text: string, values: string[]): Segment[] {
  const lower = text.toLowerCase();
  const found: { start: number; end: number }[] = [];

  for (const value of values) {
    const needle = value.trim().toLowerCase();
    if (needle.length < 2) continue;
    const at = lower.indexOf(needle);
    if (at === -1) continue;
    const end = at + needle.length;
    if (found.some((f) => at < f.end && end > f.start)) continue;
    found.push({ start: at, end });
  }

  found.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const f of found) {
    if (f.start > cursor) segments.push({ text: text.slice(cursor, f.start), highlighted: false });
    segments.push({ text: text.slice(f.start, f.end), highlighted: true });
    cursor = f.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}

// ---------------------------------------------------------------------------
// Crawler grouping (PRD-REPORT-SCREEN §5). The order inside each group is the
// PRD's order and is not sorted by count: a merchant looking for one name
// finds it in the same place every time.

export const AI_ASSISTANT_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "DeepSeekBot",
  "Applebot",
] as const;

export const SEARCH_ENGINE_BOTS = [
  "Googlebot",
  "bingbot",
  "Storebot-Google",
  "GoogleOther",
  "Google-InspectionTool",
  "Google-CloudVertexBot",
] as const;

/** A one-line note beside a name whose purpose is not obvious from it. */
export const BOT_HINT: Record<string, string> = {
  "Storebot-Google": "Google Shopping",
  "Google-InspectionTool": "your own tests in Search Console",
  GoogleOther: "Google product teams, not Search",
  "Google-CloudVertexBot": "only when a site owner asks for it",
};

/**
 * Causes that mean the check produced no verdict at all.
 *
 * crawler-check.server.ts says it in its own words: "unreachable" is a timeout
 * or a DNS problem and "is not the same as being blocked", and "unknown" is a
 * response it could not classify. Calling either one blocked turns our own
 * inability to reach the store into an accusation against the merchant's host,
 * and rule 1 of the findings would then hand them a message to send about a
 * block that may not exist. They get their own state instead.
 */
export const INCONCLUSIVE_CAUSES: readonly string[] = ["unreachable", "unknown"];

export function isInconclusive(cause: string | undefined): boolean {
  return cause !== undefined && INCONCLUSIVE_CAUSES.includes(cause);
}

export type CrawlerAccess =
  | "yes"
  | "blocked"
  | "no, your setting"
  | "could not tell"
  | "not checked";

export type CrawlerRow = {
  bot: string;
  hint: string | null;
  /** "yes" when the last reachability check served the page, "blocked" when
   * something in front of the store refused it, "no, your setting" when the
   * shop's own robots.txt or password wall is what keeps the crawler out,
   * "could not tell" when the check itself never got an answer it could read,
   * and "not checked" when this crawler has no check on record. The count is
   * never used to answer this: a crawler that made no request is not thereby
   * blocked. */
  access: CrawlerAccess;
  accessDetail: string;
  requests: number;
};

export type CheckLike = { agent: string; cause: string };

export function crawlerRows(
  names: readonly string[],
  byBot: { bot: string; count: number }[],
  checks: CheckLike[],
): CrawlerRow[] {
  const counts = new Map(byBot.map((b) => [b.bot, b.count]));
  const causes = new Map(checks.map((c) => [c.agent, c.cause]));
  return names.map((bot) => {
    const cause = causes.get(bot);
    const access: CrawlerAccess =
      cause === undefined
        ? "not checked"
        : cause === "ok"
          ? "yes"
          : isInconclusive(cause)
            ? "could not tell"
            : isOwnSetting(cause)
              ? "no, your setting"
              : "blocked";
    return {
      bot,
      hint: BOT_HINT[bot] ?? null,
      access,
      accessDetail:
        access === "not checked"
          ? "No reachability check has run for this crawler, so there is nothing to report either way."
          : access === "yes"
            ? "The last check served this crawler the page in full."
            : access === "could not tell"
              ? cause === "unreachable"
                ? "The last check never got an answer - a timeout or a DNS problem. That is not the same as being turned away, so nothing is concluded from it."
                : "The last check got a response it could not classify, so nothing is concluded from it."
              : // The sentence for the cause, written once in crawler-info.ts
                // and read by the check and by this screen alike. The enum with
                // its underscores swapped for spaces used to be printed here,
                // so a merchant read "password page" where a full sentence was
                // already available. An own setting adds where to change it.
                access === "no, your setting"
                ? `${explainCause(cause)} ${OWN_SETTING_FIX[cause!]}`
                : `The last check did not get the page. ${explainCause(cause)}`,
      requests: counts.get(bot) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Findings (PRD-REPORT-SCREEN §6). Rules over the two panels above, in order.
// Nothing here reads storage of its own, and nothing fires on data that was
// never measured.

export type FindingSeverity = "critical" | "attention" | "info";

export type Finding = {
  key: string;
  severity: FindingSeverity;
  badge: string;
  title: string;
  body: string;
  linkHref: string | null;
  linkText: string | null;
  /** Text the merchant can paste to whoever runs the server. */
  paste: string | null;
};

export type FindingsInput = {
  checks: CheckLike[];
  nothingToRead: number | null;
  sampled: number | null;
  tokens: { token: string; count: number }[];
  windowDays: number;
};

export function buildFindings(input: FindingsInput): Finding[] {
  const findings: Finding[] = [];

  // 1. One crawler turned away while another was let in. Both halves matter:
  // a check where every crawler failed is a store-wide condition (a password
  // wall, an outage), not one crawler being singled out, and saying "blocked"
  // about it would point the merchant at the wrong thing.
  //
  // "unreachable" and "unknown" are excluded from `blocked` on purpose: they
  // are the check failing to reach a verdict, not the store turning a crawler
  // away, and this finding hands the merchant a message to send their host. A
  // timeout is not evidence to send anybody.
  //
  // `robots_disallow` and `password_page` are excluded for a different reason.
  // They are the shop's own settings, so there is nothing for a host to allow,
  // and in the robots.txt case the page was served in full - the comparison
  // this finding is built on ("one was turned away, another was let in") is not
  // a comparison at all when robots.txt simply names one crawler and not the
  // other. They get rule 1b below.
  const blocked = input.checks
    .filter((c) => c.cause !== "ok" && !isInconclusive(c.cause) && !isOwnSetting(c.cause))
    .map((c) => c.agent);
  const allowed = input.checks.filter((c) => c.cause === "ok").map((c) => c.agent);
  if (blocked.length > 0 && allowed.length > 0) {
    const names = blocked.join(", ");
    findings.push({
      key: "blocked-while-others-allowed",
      severity: "critical",
      badge: "Blocking",
      title: `${names} did not get the page, while ${allowed[0]} did`,
      body: `The last reachability check requested the same page once per crawler, with each crawler's own user agent. ${names} ${blocked.length === 1 ? "was" : "were"} turned away and ${allowed[0]} was served, so this is a rule somewhere in front of the store rather than something about the page itself.`,
      linkHref: "/app/diagnostics",
      linkText: "See the full check",
      paste: `Please allow these crawlers through to our storefront: ${names}. They are published crawlers with documented user agents and IP ranges, and they are currently receiving an error while other crawlers receive the page normally. We are not asking to relax any other rule.`,
    });
  }

  // 1b. The same crawlers kept out by the shop's own settings. Separate from
  // rule 1 and deliberately not critical: nobody refused anything, the fix is
  // in the merchant's own admin, and it may well be intentional - a store that
  // is not open yet is password protected on purpose. There is no paste,
  // because there is nobody to send it to.
  //
  // Without this rule a password-walled shop reads "Nothing to act on" while
  // every crawler row says it cannot get in, which is the empty-state failure
  // EXPERIENCE-PRD section 6 is about.
  const ownSetting = input.checks.filter((c) => isOwnSetting(c.cause));
  if (ownSetting.length > 0) {
    // Grouped by cause: robots.txt and the password wall are two different
    // places to go, and one card naming both would send the merchant to the
    // wrong one first.
    for (const cause of OWN_SETTING_CAUSES) {
      const affected = ownSetting.filter((c) => c.cause === cause).map((c) => c.agent);
      if (affected.length === 0) continue;
      const names = affected.join(", ");
      findings.push({
        key: `own-setting-${cause}`,
        severity: "attention",
        badge: "Your setting",
        title:
          cause === "password_page"
            ? "Your storefront is password protected, so no crawler can read it"
            : `Your own robots.txt tells ${names} not to read the page`,
        body: `${explainCause(cause)} ${OWN_SETTING_FIX[cause]}${
          cause === "robots_disallow"
            ? ` The check itself was served the page in full for ${affected.length === 1 ? "this crawler" : "these crawlers"}, so nothing refused the request.`
            : ""
        }`,
        linkHref: "/app/diagnostics",
        linkText: "See the full check",
        paste: null,
      });
    }
  }

  // 2. Products whose own descriptions state nothing extractable. Only from a
  // pass that actually ran - never as a zero standing in for "not measured".
  if (input.nothingToRead !== null && input.sampled !== null && input.nothingToRead > 0) {
    findings.push({
      key: "products-without-attributes",
      severity: "attention",
      badge: "Needs you",
      title: `${input.nothingToRead} of ${input.sampled} products state nothing we can use`,
      body: "No material, no size, no delivery time anywhere in the description. Nothing is published for them, and nothing is invented to fill the gap. One honest line in each description changes it.",
      linkHref: "/app/products?filter=no_attributes",
      linkText: `See the ${input.nothingToRead} products`,
      paste: null,
    });
  }

  // 3. Requests that named a robots.txt token as their user agent. One
  // finding, whatever the number of tokens: a shop hit under both
  // Google-Extended and Applebot-Extended has one fact to learn, not two, and
  // two cards saying the same sentence with a different name in it reads as
  // two problems.
  if (input.tokens.length > 0) {
    const total = input.tokens.reduce((sum, t) => sum + t.count, 0);
    const names = input.tokens.map((t) => `${t.token} (${t.count})`).join(", ");
    findings.push({
      key: "non-crawler-tokens",
      severity: "info",
      badge: "Worth knowing",
      title: `${total} request${total === 1 ? "" : "s"} in the last ${input.windowDays} days used a name that makes no requests`,
      body: `${names}. These are robots.txt control tokens rather than programs. No request is ever made under one of these names, so each is something else borrowing it. Counted on their own lines and never added to any total here.`,
      linkHref: null,
      linkText: null,
      paste: null,
    });
  }

  return findings;
}

/**
 * What the findings card says when no rule fired.
 *
 * Each clause is written only when the thing it describes was actually
 * measured. The single sentence this replaced claimed "every product read
 * stated something" on a shop that had never run a pass, and on one whose pass
 * read nothing - in the first case nobody read anything, in the second the
 * claim is true of an empty set and reads as a result. Neither is a finding of
 * ours to report.
 */
export function nothingToActOn(checked: boolean, passDone: boolean, sampled: number): string {
  const clauses = [
    checked
      ? "no crawler was turned away while another was let in"
      : "no crawler check has run yet, so nothing is known either way",
    passDone
      ? sampled > 0
        ? "every product the last pass read stated something"
        : "the last pass read no active, published products, so none could state anything"
      : "no finished pass has been read for products that state nothing",
    "no request arrived under a name that makes none",
  ];
  return `Nothing to act on: ${clauses.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// CSV (PRD-REPORT-SCREEN §8). Two tables, the same two the screen shows.

/**
 * A cell that begins with =, +, -, @, a tab or a carriage return is a formula
 * to Excel, LibreOffice and Google Sheets: "=1+1" computes, and the DDE forms
 * of the same trick can ask the spreadsheet to run a command. Every string in
 * these files comes from a merchant's own catalogue - product titles, family
 * names, handles - so the content is not ours to trust, and a title that
 * begins with a dash is ordinary in a furniture catalogue.
 *
 * The mitigation is the documented one: prefix the value with an apostrophe,
 * which every spreadsheet reads as "this cell is text". The apostrophe is
 * visible in Excel, and that is the price of the fix, paid on the handful of
 * titles that trigger it.
 *
 * Numbers are exempt, and the exemption is load-bearing rather than a
 * shortcut. differenceLabel in seo-since.ts emits "-3" and "+3" for a figure
 * that moved, and neutralising those would turn every fall in every comparison
 * file into text that will not add up. A cell whose whole content is a signed
 * decimal number is not a formula in any spreadsheet, so it is let through.
 */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

export function csvCell(value: string | number): string {
  const raw = String(value);
  const s =
    raw !== "" && !PLAIN_NUMBER.test(raw) && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRows(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/**
 * A count with a thousands separator: 20000 reads "20,000".
 *
 * For the merchant surfaces - the dashboard, the printed report and the
 * sentence cells of the spreadsheets. The numeric cells of a spreadsheet stay
 * plain, because "20,000" in a count column is text to Excel and will not sort
 * or sum. Hand-rolled rather than toLocaleString so the output does not depend
 * on the locale of the machine that rendered it: a merchant document must read
 * the same from the server and from the browser (5 September 2026).
 */
export function formatCount(value: number): string {
  const sign = value < 0 ? "-" : "";
  const [whole, fraction] = Math.abs(value).toString().split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${fraction !== undefined ? `.${fraction}` : ""}`;
}

/**
 * The family table.
 *
 * It carried a "Values found" column beside "Products stating it", on the
 * belief that the two were different tallies. They are not: the engine emits
 * one Fact per family per product, so the two columns held the same number in
 * every row on every catalogue, and a duplicated column in an export is a
 * reader working out which one to trust. One column, named after what it
 * counts. `byAttrProducts` is preferred; a report written before that field
 * existed has the same figure under `byAttr`.
 */
export function familiesCsv(
  byAttr: [string, number][],
  sampled: number,
  byAttrProducts?: [string, number][],
): string {
  const source = byAttrProducts ?? byAttr;
  return csvRows([
    ["Attribute family", "Products stating it", "Products read"],
    ...source.map(([name, count]) => [name, count, sampled] as (string | number)[]),
  ]);
}

/**
 * Excel on Windows opens a UTF-8 CSV with no byte order mark in the system code
 * page, so "Dimensiuni" survives and "Măsuri" does not. Family names come from
 * the merchant's own dictionary and product titles from their own catalogue,
 * both of which are Romanian here, so this is the normal case rather than the
 * edge one. The mark is three bytes at the front of the file and does not
 * change the content type, which stays text/csv; charset=utf-8.
 */
export const CSV_BOM = "\uFEFF";

export function weakestCsv(
  weakest: WeakProductLike[],
  byAttr: [string, number][],
  familyTotal: number,
): string {
  return csvRows([
    ["Product", "Families found", "Families in this catalogue", "Missing"],
    ...weakest.map(
      (w) =>
        [
          w.title,
          w.families.length,
          familyTotal,
          missingFamilies(w.families, byAttr).join("; "),
        ] as (string | number)[],
    ),
  ]);
}
