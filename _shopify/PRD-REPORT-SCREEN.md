# PRD: the Report screen ("Reporting at a glance")

2 September 2026. The design is
`F:\AI Visibility SHOPIFY\mockup-dashboard-at-a-glance.html`; open it before
reading this. Its feasibility table, checked against the code on 2 September,
decides what is in scope.

## What this is, and where it lives

A single read-only screen that answers, in one look: how much of the shop is
readable, what the descriptions already say, who came to read the text pages,
and what to do next.

**New route `/app/report`, new nav item `Report`, placed second, after
Dashboard.** It does not replace the existing dashboard. The dashboard's own
problems are a separate wave; replacing it here would mix two changes and
make a revert expensive. If the Report screen earns its place, it becomes the
landing screen later, deliberately.

Gate: the same as Collections. Paid or comped. It reads across the whole
catalogue and is not part of the free tier.

## Non-goals

No score history. No verified-versus-unproven requests. No "Google AI Mode"
or Copilot line. No sorting by sales. No change to the existing dashboard, to
the extraction engine's rules, or to anything under `extensions/`.

---

## The rule that governs every panel

From EXPERIENCE-PRD section 2, and it is the reason this screen exists rather
than the competitors' version of it:

**No number renders without its denominator and its method, in the same card.**
If the method line cannot be written truthfully, the panel does not ship.

Three specific traps, all of which this codebase has fallen into before:

1. A failed job's report is `{ error }`, which is truthy. Treat a report as
   figures only when `status === "done"`. A failed pass renders as a named
   failure, never as a measurement of zero.
2. `CrawlerHit` rows are requests to the app's own text pages: the mirror,
   llms.txt, agents.md, the IndexNow key. They are never visits to the
   merchant's storefront, which Shopify serves directly and this app never
   sees. Every string says "requests to your text pages". Never "visits",
   never "read by AI".
3. Counts come from a self-declared user agent. Nothing on this screen may
   say "verified".

---

## Panels

### 1. How much of the shop AI can read

Source: the most recent `bulk_extract` or `dry_run` JobRun with
`status === "done"`.

- A dial, 0 to 100, of products that carry at least four attribute families.
- Under it, a segmented bar: ready / partly ready / nothing to read, with the
  three counts.
- Method line: "counted from the pass on <date>, over <N> products".
- Empty state: "No pass has run yet", with a link to the dashboard's Preview.
- Failed state: "The last pass failed on <date>", with the stored reason.

This needs a per-product distribution, which `coverage()` does not return
today. Extend it: add `depth: number[]`, one entry per product, the number of
distinct families that product produced. The engine stays pure; this is
arithmetic over data the function already walks. `DryRunReport` carries it
through unchanged.

### 2. Details published so far

Source: the same report.

- The total number of attribute values, and the number of products.
- "N per product on average". Compute the **average**, not the median. If the
  loader computes a median, the label must say median. The two are different
  numbers and the word must match the arithmetic.
- A histogram of `depth`, bucketed, with the axis labelled.
- Method line naming the pass and its date.

### 3. What actually changes on a product page

The before-and-after panel, full width. One real product from this shop:
its description on the left with the extracted spans highlighted, the written
fields on the right.

Source: `examples` already carried in `DryRunReport`, or one product read on
demand. Pick the product with the most families. If the highlight cannot be
located in the description, show the value without the highlight rather than
dropping the row: `Fact` is `{ k, v }` with no offset, so the highlight is
reconstructed by searching, and it can miss when the engine trimmed a phrase.

If no product has facts, the panel does not render.

### 4. What your descriptions already say

Source: `coverage().byAttr`, which is already the array behind the chart.

Horizontal bars, one per family, sorted by count, with the count on the right.
Show twelve, then "Show all N". Method line: "counted from your own
descriptions on <date>, over <N> products".

### 5. Requests to your AI-readable pages

Source: `CrawlerCheck` for reachability, `summarizeHits()` over `CrawlerHit`
for counts. Window: 30 days. Retention is
`CRAWLER_HIT_RETENTION_DAYS = 30`, so 30 is the longest honest window and the
screen must not offer a longer one. `crawlerHitsForDashboard` already takes
the window as an argument.

Three groups, in this order, each a small table:

- **AI assistants**: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot,
  Claude-SearchBot, PerplexityBot, DeepSeekBot, Applebot.
- **Search engines**: Googlebot, bingbot, Storebot-Google, GoogleOther,
  Google-InspectionTool, Google-CloudVertexBot.
- **Names that cannot make requests**: Google-Extended, Applebot-Extended.

Columns: crawler, can it get in, requests, count. Status is a `Badge` with a
tone, not a coloured `Box`; colour is never the only signal.

Four names must be added to `KNOWN_BOTS` in `crawler-hits.server.ts`, in
specificity order so a looser name never absorbs a more specific one:
`bingbot`, `Storebot-Google`, `GoogleOther`, `Google-InspectionTool`.
Verified against Google's and Bing's own crawler documentation on
2 September 2026.

Google-Extended and Applebot-Extended are robots.txt control tokens with no
user agent of their own. They are not in `KNOWN_BOTS` and must not be added.
Their row is a separate query for that exact agent string, counted apart and
never added to any total, with one line saying what the name is.

Footnote under the card, verbatim in substance:

> These are requests to the plain text pages, llms.txt and agents.md that this
> app serves, not visits to your themed storefront, which Shopify serves
> directly and this app never sees.
>
> There is no "Google AI Mode" or "Copilot" line here because there cannot be
> one. Google states that AI Overviews and AI Mode crawl using the existing
> Google user agents, and that Google-Extended has no user agent of its own.
> Copilot reads the Bing index rather than crawling under its own name. A
> tool that shows an "AI Mode" number is showing a model, not a measurement.

### 6. What to do, worst first

Derived from panels 1 and 5, no new storage. Rules, in order:

1. A crawler blocked while another was allowed in the same check: critical.
   Include the paste-ready message to send the host.
2. Products that produced no attributes: attention. Link to the products list
   filtered to those.
3. Requests under a name that cannot make requests: informational.

If no rule fires, the card says so plainly rather than rendering empty.

### 7. Products worth ten minutes of writing

Source: the same report's per-product data. Fewest families first, ten rows,
each with a small bar, the count as "N of M families", and what is missing.
Never sorted by sales: that needs order data, and not touching orders,
customers or payments is one of the three promises.

### 8. Export

Print (a print stylesheet is enough), and CSV of the family table and the
weakest-products table. No XLSX in this pass. No "email me this weekly"
checkbox until a scheduled task exists behind it; a control that does nothing
is worse than no control.

---

## Layout

Two columns on wide screens, one below 880 px, matching the mockup. Polaris
components throughout: `Card`, `BlockStack`, `InlineStack`, `Badge`,
`DataTable` or `IndexTable`, `Text`. The bars and the dial are inline SVG,
which is allowed: they carry `role="img"` and an `aria-label` with the same
number the sighted user sees. No canvas, no chart library, no new dependency.

Product UI is English only.

---

## Tests

1. The `depth` addition to `coverage()`: a product with zero families, one
   with four, one with eighteen; the array's length equals the product count.
2. The report's derived figures: ready / partly / nothing given a `depth`
   array, and the average with the word "average" asserted in the label.
3. A failed JobRun renders the failure, not zero. This is the trap that
   already shipped once.
4. `normalizeBot` recognises `bingbot`, `Storebot-Google`, `GoogleOther`,
   `Google-InspectionTool`, and still returns `other` for `Google-Extended`.
5. The Google-Extended count is not included in any total.
6. Findings: each of the three rules fires when it should and not otherwise.

## Definition of done

- `check.bat` green, all existing tests still passing.
- The screen renders on the dev store with real data, and every number on it
  can be traced to the source it names.
- No string on the screen says "visits", "verified", "AI Mode", or a number
  without a denominator.
- `_shopify/CHANGELOG.md` updated under Unreleased.
