# PRD: full on-page SEO for Shopify, and the report that shows it was done

4 September 2026. Written after Marius pointed out that the per-product scan
PRD had narrowed the SEO capability to one feature and dropped the rest of what
he asked for. This document is the rest, complete, in one place: the report
that proves the engagement did something, and every on-page check a full audit
expects. It builds on `PRD-SEO-PER-PRODUCT.md`, which shipped 4 September; it
does not replace it.

**Verified nothing yet.** Every figure below is a design figure. Section 0
names the reads that come first.

The rules that bind every line, from CLAUDE.md and from what shipped today:
nothing is generated, nothing is scored, no keyword data exists; every count
carries its denominator; a check that could not run says so rather than
reading zero; a finding is phrased as what the page has, never as advice about
rankings; the merchant's own words are never rewritten; and every screen must
read correctly on a 50-product fixture, a 20,000-product store and an empty one
with no per-store tuning.

---

## 0. The reads that come first

Three cheap reads, before any code, each needing Marius.

1. `npx tsx scripts/seo-fields-census.ts <domain>` on the paying client's
   store, once it is installed there. Decides nothing about the screen (every
   check is a row regardless) but tells us which rows will be loud.
2. The Business screen on that store: is delivery and return filled in. Two
   of today's four "not published" warnings are data, not code.
3. Whether the SEO key is already entered on the client's store. If it is,
   the before-snapshot in section 1 cannot be taken at unlock time and must be
   taken now, dated honestly.

---

## 1. The report that sells: before, and what changed since

This is the part `AUDIT-2026-09-02.md` section 1.1 marked blocking on 2
September and that is still open on 4 September: `grantSeoUnlock` in
`billing.server.ts:81` writes one Setting row and nothing else. There is no
record of what the store looked like when the engagement began, so no screen
can say what the engagement did. The SEO screen today shows state, "50 of 50
have a meta title", which is indistinguishable from "it was always so".

### 1.1 The snapshot

A new table `SeoSnapshot`, one row per shop, **written once and never
updated**. Taken inside `grantSeoUnlock`, before the key is stored, so no SEO
write can precede it.

```
shopId, takenAt, takenBy ("unlock" | "manual")
products               total in the catalogue read
metaTitleSet           products with a meta title, by classifyMetaField
metaTitleOurs          of those, written by this app (0 at unlock, by definition)
metaDescriptionSet, metaDescriptionOurs
withBarcode, withVendor, withSku, withImage
productNodeTheme       pages where the theme emits a Product node, from source B
productNodeNone        pages with no Product node at all
themeNodeTypes         the distinct JSON-LD types the theme emits, as a list
findingsByCode         the count per check code, from SeoScan, at that moment
pagesRead              how many SeoScan rows had a page read at snapshot time
```

Source: the same bulk read source A uses, plus the SeoScan rows as they stand.
If source B has not run yet, `pagesRead` is 0 and the page-derived fields are
null, never 0. The card says "not read at the time" for those.

### 1.1a What step 1 built, 4 September 2026

The table (`prisma/migrations/20260904120000_seo_snapshot`), its down path
(`prisma/down/20260904120000_seo_snapshot.down.sql`, written first), the write
inside `grantSeoUnlock`, the manual path, and a read-only script that prints one
shop's snapshot as counts. Every field of the 1.1 list is populated from the
same bulk read source A uses and from the SeoScan rows as they stand; nothing is
fetched from a storefront.

Three decisions the section above did not settle, taken here and stated rather
than buried:

- **A snapshot that cannot be taken means no key.** `takeSeoSnapshot` refuses a
  short catalogue read (parsed count below the count Shopify announced) and the
  throw is not caught in `grantSeoUnlock`, so the Setting row is never written
  and the plans screen tells the operator to enter the code again. A "before"
  built from a partial read understates every difference later computed against
  it, in the direction that flatters us, and it would do so silently and for
  ever. Section 1.1 said the snapshot is taken before the key; this is what
  "before" has to mean when the read fails.
- **`findingsByCode` is nullable, and null is not `{}`.** Null means the shop
  had no `SeoScan` rows at all at that moment - which is the state of every
  shop unlocked for the first time, since `computeSourceA` writes nothing
  without the key. `{}` means rows existed and none carried a finding. Storing
  `{}` for both would make the card unable to tell "clean" from "unmeasured",
  which is the same failure the page-derived nulls exist to prevent.
- **`pagesRead` is a real 0.** It counts rows, and "no row had a page read" is
  exactly what 0 says there. Only `productNodeTheme`, `productNodeNone` and
  `themeNodeTypes` are null in that state.

The unlock now runs a bulk operation inside one HTTP request. On a 20,000
product store that is minutes of polling in the plans screen's action, and it
uses `adminGraphql` rather than the raw Remix client so the token can refresh
underneath it. It is paid once per shop, by the operator, never by a merchant.
If it proves too slow in practice the fix belongs in step 2, and it must keep
the ordering guarantee: no key until the row exists.

One change outside the module. `sleep` moved from `admin.server.ts` to
`app/services/sleep.ts`, because `catalogue.server.ts` imported it and
`admin.server.ts` imports `shopify.server`, so reaching a catalogue read from
`billing.server.ts` dragged `PrismaSessionStorage` into every test that stubs
`db.server`. `admin.server.ts` re-exports it; no caller changed.

**A snapshot taken after the key was already in use is not a before.** For a
shop where the key predates this PRD, the operator takes it by hand with
`takenBy: "manual"` and the card says "since 5 September" with the date, not
"since the start". This is the Republica BIO case and it is stated rather than
hidden.

### 1.2 The card, at the top of the SEO screen

"Since this engagement began" with the snapshot date. One row per figure:
the value at the snapshot, the value today, and the difference. Rows ordered
by the size of the difference, so what moved is at the top. A row whose today
value has the same denominator as its snapshot value shows both denominators
when they differ (the catalogue grew or shrank), because a difference between
"30 of 50" and "45 of 60" is not 15.

Rows with no change collapse into one line: "N figures unchanged."

A second block on the same card, "Written by this app since then": meta
titles, meta descriptions, structured data nodes added per page type, alt
texts, buyer questions. Each counted from the `state` metafields, which record
`source: "auto"` with a timestamp, so the count is real and the timestamp
proves it postdates the snapshot.

### 1.2a What step 2 built, 5 September 2026, and the one amendment it needs

**The structural fix first.** The unlock no longer runs inside the plans
action. It creates a `seo_snapshot` JobRun, enqueues the task with a per-shop
jobKey and returns; the task calls `grantSeoUnlock`, which still takes the
snapshot before it writes the key. The rule of 1.1 is unchanged and still lives
in one function - only the wait moved, out of a request the embedded iframe
would have abandoned. The screen polls the JobRun; a failure shows its reason
and leaves the shop locked, so the operator retries by entering the code again.

**Where "today" comes from, which 1.2 did not say.** Figures like
`metaTitleOurs` and `withBarcode` can only be counted from a catalogue read, and
a catalogue read is a bulk operation that no screen load can pay for. So
`SeoSnapshot` gained a second row per shop, `takenBy: "current"`, rewritten by
every complete catalogue pass from the read that pass already holds. The unique
index moved from `shopId` to `(shopId, takenBy)`. One shape and one function for
both halves, deliberately: a difference between the before and the today cannot
then be an artefact of two different readings of one catalogue. Nothing is
written on a short read, for the same reason a snapshot is not.

**The amendment, and it needs Marius's approval before this section is closed.**
1.2 says the second block counts "meta titles, meta descriptions, structured
data nodes added per page type, alt texts, buyer questions... each counted from
the `state` metafields". Two of those five cannot be counted that way, and no
code change short of a new write path would make them countable:

- **Alt text** is written by `writeAltText` straight onto Shopify media through
  `productUpdateMedia`. It records no state entry, so there is no timestamp to
  compare against the snapshot. The `bulk_alt_text` JobRun reports do carry
  counts and dates, but they miss every alt text written from the product
  editor, so a figure built from them looks real and is wrong.
- **Structured data nodes** are not written at all. The Liquid block renders
  them at request time from the facts and summary metafields, so nothing is
  stamped when a node starts appearing on a page.

What was built instead: the six keys that do carry a dated `state` entry -
`seo_title`, `seo_description`, `questions`, `facts`, `summary`, `fit_for` -
each with its count, earliest and latest timestamp, counted only where
`source` is `auto` and the timestamp is after the snapshot. The card then
states the omission in a sentence of its own rather than leaving a reader to
assume the list is complete. If the figures matter, the way to get them is a
dated record at the point of writing, which is a change to the alt-text writer
and a new record for node emission - a wave of its own, not a line in this one.

**Two further things the section did not specify.**

- The card is on `/app/seo`, at the top, so it is visible before the dashboard
  of section 4 exists. Step 5 moves it; nothing in it is written for that
  position.
- Findings get one row each, out of the union of both sides' `findingsByCode`,
  so a code that appeared since the snapshot is not dropped and one that was
  cleared does not vanish. A code absent from a side whose `findingsByCode` is
  an object was measured at zero; a side whose `findingsByCode` is null was not
  measured at all and stays null.

### 1.3 Export

"Take this away" already exists on the Report screen. Add the same for this
card: one CSV with snapshot, today, difference, per figure, and one line at the
top with both dates. That file is what the operator attaches to the invoice.

---

## 2. Checks the first PRD proposed and dropped

From the 4 September audit's nine, four did not make it into the per-product
PRD. All four go in now.

| Code | Check | Source | Row says |
|---|---|---|---|
| A6 | Collection meta title and description absent, or the Shopify default | A, collections read | per collection; extends `classifyMetaField` to collections |
| B8 | Canonical points at a variant URL (`?variant=`) or a collection-prefixed URL (`/collections/x/products/y`) instead of `/products/y` | B | the canonical as fetched and what it should be |
| B9 | hreflang: the page declares `alternate` links for every market's locale, or declares none while Markets is on | B, plus one `markets` query per pass | present, absent, or not applicable when the shop has one market |
| A7 | Sitemap membership: a public product is absent from `sitemap.xml`, or a withdrawn one is still in it | A, plus one fetch of the sitemap index per pass | per product; Shopify owns the sitemap, so the row is a report, never a fix |

### 2a. What step 3 built, 5 September 2026

All four, plus the collections writer. What the section did not settle, decided
here:

- **A6 has its own denominator and is not in `CHECKS`.** The findings aggregate
  counts product rows; A6 counts collections. It is rendered as its own row on
  the card from the collections check's own report, so a count is never quoted
  under a denominator that is not its own.
- **A7 carries `source: "A+B"`, not `"A"`.** It is computed in source B's pass,
  from a fetch source A never makes, so source A must not own it or the next
  catalogue pass would erase a value it cannot recompute. Its denominator is
  therefore the pages read, like every other check the nightly pass raises.
- **The sitemap and the markets query are charged to the daily page budget.**
  One `sitemap.xml` plus one fetch per product sitemap, per pass. Section 3 of
  this PRD already sets that precedent for B16's link checks. A 500-page budget
  therefore reads 499 pages on a shop with one product sitemap; understating
  what this app asks of a storefront would make the budget a figure rather than
  a limit. The pass fetches nothing at all when the allowance is already spent,
  and nothing when the shop has no product rows to check a sitemap against.
- **A sitemap that cannot be read produces no finding.** Every development
  store is behind a storefront password and its sitemap answers with the
  password form; reading that as "no product is listed" would put A7 on the
  whole catalogue. Same rule as the password wall in PRD-SEO-PER-PRODUCT.
- **B9's "not applicable" is a new aggregate state**, not the absence of a
  finding. A check that produces nothing reads as "clean", which claims it ran
  and passed. The market count is a fact about the shop that no row can carry,
  so the pass records it per shop and the card reads it - the same mechanism
  `recordRobotsBlock` uses.
- **A single-page rescan carries A7 and B9 forward** rather than recomputing
  them. The "Read this page now" button does not refetch a shop's sitemaps, so
  without this it would silently clear a finding the nightly pass established -
  "not re-checked" reported as "no longer true".

**B9 is blocked on a scope.** The dev-store run answered `ACCESS_DENIED:
read_markets`. The failure is soft - logged, B9 left unchecked, the page scan
continues - but no shop can raise B9 until `read_markets` is added to
`access_scopes`, and that re-prompts every installed merchant. Marius's
decision; not taken here.

**One correction the run produced.** A collection with no description of its own
was offered its own title with a full stop as a meta description. The writer now
proposes a description only where there is text to condense; A6 still reports
the absent field.

**Meta writer on collections.** The condensation the product writer does,
applied to a collection's title and description, with the same review queue,
the same revert, the same human protection. Same engine function, different
length budget. It is the one item here that writes; everything else reads.

---

## 3. The on-page checks a full audit expects, and that were never listed

All source B. Each is a row on the SEO card with its denominator, a finding
on the product's SeoScan row, and a line in the product editor's "What a
crawler sees" section. Each has a stable code so the weekly diff can name it.

| Code | Check | What the row says | What it never says |
|---|---|---|---|
| B10 | Title tag length outside 30 to 60 characters, or absent | the length and the tag | anything about what the title should say |
| B11 | Meta description length outside 70 to 160 characters, or absent | the length | |
| B12 | H1: none, or more than one | the count and the texts | |
| B13 | Open Graph: `og:title`, `og:image`, `og:description` absent | which are absent | |
| B14 | Twitter card tags absent | which are absent | |
| B15 | Images on the page without alt text, and images whose alt is a filename or a UUID | count of denominator, the same heuristic `looksLikeMachineAlt` uses | |
| B16 | Internal links on the page that answer 4xx or 5xx | the URLs, up to 20 per page, each fetched once per pass with the same budget rules as pages | |
| B17 | Thin content: the description under 40 words, or the page's main text under 80 | the counts | that more words would help |
| B18 | Handle hygiene: uppercase, spaces, non-ASCII, or trailing punctuation in the handle | the handle | |
| B19 | Redirect chain: the product URL answers with more than one hop before 200, or with a loop | the chain | |
| B20 | Mixed content: `http://` resources on an `https://` page | the URLs | |
| B21 | Duplicate title across pages: the page's title tag equals another scanned page's | the other handle | |

**The length thresholds in B10 and B11 are stated as what Google truncates
at, with the source in the row's method line**, not as a rule of ours. If the
thresholds change, the method line changes and nothing else.

**B16 and the budget.** Link checks cost fetches. They count against the
same per-shop daily budget as pages, one fetch per distinct URL per pass, with
a cap of 20 links per page. A page with 200 links reports "20 of 200 checked"
and never silently checks 20 while saying it checked the page.

**No check in this table produces a score.** The SEO card has no number at
the top. It has rows.

---

## 4. The dedicated SEO dashboard, and the report

Decided by Marius, 4 September, four answers on the record:

1. **A new route.** `/app/seo` stays as it is, the operator's workspace. The
   dashboard lives at `/app/seo/dashboard` (the name is a proposal; one word
   to change). The shop owner has access to it, since the key is on their
   store. It is not a settings page with cards; it is the screen the 200 EUR
   buys.
2. **The report is a printable page plus CSV.** No server-side PDF, no new
   dependency.
3. **A static HTML mockup comes first, approved by Marius, before any code.**
   The mockup is the specification for build step 5; Claude Code builds what
   was approved, not what section 4.1 describes in prose. Section 4.1 is the
   brief for the mockup.
4. **Republica BIO already has the key entered**, so its snapshot is taken by
   the manual path in section 1.1, now, and its card says the date it was
   taken, not "since the start".

### 4.1 Layout, top to bottom, the brief for the mockup

Polaris throughout, one column at 1120px, two columns where two cards pair.
Every number has its denominator beside it. Nothing is a score.

1. **Header.** Shop domain, "since" date from the snapshot, pages read of
   pages total, last night's scan time. One pill: "Read this shop again
   tonight at 03:45 UTC".
2. **Since this engagement began.** The section 1.2 card, full width. Left: a
   table, one row per figure, snapshot value, today, difference, ordered by
   the size of the difference, unchanged rows collapsed. Right: "Written by
   this app since then", the counts from the `state` metafields, each with
   its earliest and latest timestamp. Below: the export buttons.
3. **How much of the catalogue is search-ready.** A half-circle dial like the
   Report screen's coverage dial, but the figure is products with zero
   findings of severity "attention" over products read, and the dial is
   labelled with that exact denominator. Beside it, a segmented bar: no
   findings, findings the merchant can fix in Shopify, findings that need the
   theme, findings this app fixes with review. Each segment names its count.
4. **Findings per product.** The card from `PRD-SEO-PER-PRODUCT.md` section
   4, now with all 48 codes. Two columns of rows: left A1 to A16 "from the
   catalogue", right B1 to B32 "from the page". Each row: code, plain name,
   count of denominator, a horizontal bar sized to the share, a link to the
   product list filtered by that code. Ordered by count within each column.
   Zeros collapse into one line per column. A check that could not run says
   "not yet read" or "not applicable" with its own count.
5. **Structured data.** The card as today: theme node on N of M pages, the
   Extend or Full advice, the source of every node on a sample page.
6. **Merchant listing readiness.** A8 rendered as its own card, because it is
   the one composite a merchant understands: the Google-required and
   Google-recommended properties down the side, products satisfying each
   across, with the Google documentation linked in the method line.
7. **Search listings.** The meta writer as today, with a Collections tab.
8. **What to do, worst first.** Ten findings ordered by severity then count,
   each with the product or collection, the evidence, and the one action,
   phrased as what to change in Shopify, in the theme, or in this app.
   Nothing here that the merchant cannot act on (Break The Web's rule).
9. **What your descriptions already say.** Term gap as today.
10. **Scripts and embeds on the product page.** B32, at the bottom, counts by
    origin, no verdict.
11. **Full scan detail.** Collapsed. Every node, every header, robots.txt,
    canonical, the weekly watch history.

#### Amendments to 4.1, approved by Marius 4 September 2026

The approved mockup, `_shopify/mockup-seo-dashboard.html`, is the
specification for build step 5 and wins over the prose above wherever the two
disagree. Two amendments to this section were approved with it, and are
written here rather than applied silently.

**Amendment 1, 4 September 2026: a finding that flags the whole read set is
not counted against individual products.** A finding whose count is exactly
100 percent of the read set is removed from the per-product grouping entirely
and appears once, in the "fixes that cover the whole shop" card. The threshold
is exactly 100 percent, so it is a fact and not a judgement, and the method
line on the screen says so. The reason: without it the readiness figure is
zero on almost every real shop, because one theme-level problem flags every
product at once, and a dial pinned at zero tells the merchant nothing.

**Amendment 2, 4 September 2026: item 8, "What to do, worst first", is no
longer a separate card.** Its content lives in the two places the merchant is
already looking - the shop-wide card, ordered, and the expandable steps inside
each readiness group. A third copy of the same advice was the only
alternative.

**Consequence for item 3, stated here so it is not inferred.** The four groups
(nothing to fix, yours to fix, your theme, ours to fix) must partition the
read set exactly, so group assignment is a total function: every finding code
declares one owner - `merchant`, `app` or `theme` - and a product goes in the
group of its most immediate owner, in that order. The four numbers sum to the
denominator, and a test asserts that on all five fixture stores.

#### Second amendment to 4.1, approved by Marius 4 September 2026

Written after the built screen was read on the dev store, and amending three
things the mockup specified. The mockup was updated at the same time, so the
two do not disagree.

**Amendment 3: no circular gauge except the hero dial.** Every other gauge is
a horizontal bullet bar with the raw count beside it and the full range as its
track. Nielsen Norman Group's dashboard research states that gauges mimicking
a car dashboard "consume a lot of precious space on a dashboard and are also
harder to interpret than linear graphs", that donut charts are "notoriously
poor at most information-communication tasks", and that the named replacement
for a value on a range is the bullet chart - adding that most bullet charts
wrongly hide the overall range, which is why ours always draws the
denominator. One circle is kept, because the screen needs one anchor.

**Amendment 4: the layout is chosen against the admin iframe.** Built for
Shopify requirement 4.1.2 fails a two-column layout that does not stack and a
section that is collapsed with no way to expand it. The app renders inside an
iframe roughly 250 to 300 px narrower than the browser window, so two-column
blocks arrive at `lg` and not at `md`, and no element on the screen declares a
width that cannot shrink.

**Amendment 5: colour reinforces and never carries.** Up to 8 percent of men
have some form of colour blindness. Every bar prints its group in words as
well as in hue, and a test asserts that every rendered row carries it.

**Consequence for the headline, stated here so it is not inferred.** The
readiness dial is drawn against the catalogue and not against the read set.
On a 50-product shop with 12 pages read, a dial denominated in the read set
reads "12 of 12" and "100 percent" - true arithmetic that says the shop is
finished. The four groups plus the products nobody has fully checked partition
the catalogue exactly, and a second test asserts that partition beside the
four-way one, on all five fixture stores.

**Consequence for the findings card.** Every code in the vocabulary is
accounted for in its column, in a bar or in a sentence, and each column prints
its own arithmetic. A column that showed some bars and one clean line
accounted for 38 of 44 codes and said nothing about the other six.

### 4.2 Design rules, taken from the Report screen and held here

Tabular figures everywhere. Bars in one neutral colour with a second only
for "attention". No traffic-light colouring of the whole screen; a red badge
is a finding, not a mood. Method line under every card, in the subdued
style, quoting the source where the source is Google or Shopify. Empty
states are sentences, not zeros: "No page has been read yet; the first scan
runs tonight" rather than "0 of 50". The screen must read correctly on a
50-product fixture, a 20,000-product store, an empty store and a store where
source B never ran; the four shapes are in the acceptance table.

### 4.3 The report

Two outputs, both from the same figures as the screen, both dated:

- **Printable report.** A route `/app/seo/dashboard/print` that renders sections 2, 3,
  4, 6 and 8 as a print-styled page: shop name, both dates, the since-table,
  the dial figure as a number, the findings table, the top ten. No Polaris
  chrome, no navigation, black on white, A4. The browser's print to PDF is
  the PDF; no library is added. This is what goes on the invoice.
- **CSV.** One file per table on the screen, as the Report screen already
  does, through the existing export route pattern.

#### Amendments to 4.3, approved by Marius 5 September 2026

**Amendment 6: the printable report is an embedded route, not a new tab.** The
mockup's two buttons implied a document that opens on its own. It does not, and
the reason is in the code rather than in a preference: `app.tsx`'s loader keeps
the query string on its own redirect because "embedded requests carry
shop/host/embedded there, and dropping them sends the next request to the login
page". A `/app` route reached in a fresh top-level tab carries none of them. A
CSV survives that badly but visibly; a report would render a login screen and
look as though the report had failed. `/app/seo/dashboard/print` is therefore a
child of `app.tsx`, reached by an ordinary in-app link, on the same
authenticated path the dashboard itself uses, and printed with `window.print()`
from inside the frame.

That call is a convenience and never the mechanism. Inside the admin the app is
a cross-origin iframe, and two things are true that cannot be checked without a
browser: `window.print()` in a frame prints that frame's document in Chrome,
Edge and Firefox, which is what the browsers' own "Print frame" item does; and
a sandboxed frame needs `allow-modals` or Chrome ignores the call and logs
"Ignored call to 'print()'". Shopify's sandbox attribute is not ours and is not
readable from inside the frame. So the page itself is the report - print-styled,
every group already open, no control that only makes sense on a screen - and a
line under the button names the browser's own path for the case where nothing
happens. No sentence in the app claims a print behaviour that was not observed.

**Amendment 7: four spreadsheets, not one.** "Download as a spreadsheet" is four
buttons. The screen shows four tables with four different denominators, and one
file holding all of them would either merge four shapes into one sheet or ship a
zip, both harder to open than four named files:
`findings` (every check, with its count and its denominator), `products` (one
row per product per finding), `shopwide` (the fixes that are one decision) and
`listing` (what Google asks for). The then-and-now comparison is the fifth and
is **not** a new route: it already exports from `/app/seo/export/since`, from
the same two snapshot rows, behind the same gate. The button appears only when a
before snapshot exists, because that route answers a request without one with a
409, and a button that can only fail is not a button. The mockup was updated to
match rather than left disagreeing.

**Amendment 8: filenames carry the shop and the date.** `exportFilename` gives
`ai-visibility-seo-<shop>-<table>-<YYYY-MM-DD>.csv`. The two older export routes
keep their existing names; renaming files people already have is not worth the
consistency, and this paragraph is the record that the difference is deliberate.

**Consequence: one read behind four routes.** `readSeoDashboardSource` in
`app/services/seo-dashboard.server.ts` is the dashboard loader's old body, moved
so the screen, the report and the exports cannot assemble the same figures
differently. `dashboardDerived` and `keyFigures` in `app/services/seo-report.ts`
are the only derived values on either page, and the acceptance test walks
`keyFigures` on all five stores asserting each string appears in both renders.
The rule is structural: neither page computes a figure.

**Consequence: a fabricated zero was caught on paper, not on the screen.** That
render test found the report printing "0 of 10 details Google asks for" on a
shop nothing had read, where the screen shows a sentence. `keyFigures` now omits
the Google figure when the card is unmeasured, and both pages print
`LISTING_UNMEASURED_SENTENCE` from one constant.

**Consequence: a defect in shipped code.** Neither `app.report.export.$table` nor
`app.seo.export.$table` neutralised a cell beginning `=`, `+`, `-` or `@`, so a
product title a merchant typed could run as a formula when they opened the file.
`csvCell` in `report-metrics.ts` now guards it for every export in the app, and
`seo-since.ts` imports that copy instead of keeping its own. Plain numbers are
exempt, because `differenceLabel` emits "-3" and "+3" and neutralising those
would turn every fall in every comparison file into text.

#### What each file holds on the five fixture stores

Run, not described: `findingsCsv`, `shopWideCsv`, `listingCsv` and
`productFindingsCsv` over the five shapes of 4.2, counting data rows. An empty
table with only its headings is a correct answer; a fabricated zero row is not.

| Store | Report heading | findings | shopwide | listing | products |
|---|---|---|---|---|---|
| 50 products, every page read | `50 of 50 products fully checked` | 40 rows | 0 rows, "Nothing affects every product the same way" | 10 rows | 32 rows |
| 189 products | `189 of 189 products fully checked` | 40 rows | 2 rows, each with its own scope | 10 rows | 275 rows |
| 20,000 products | `500 of 20000 products fully checked` | 40 rows | 0 rows | 10 rows | 19,620 rows |
| Empty store | `0 products in the catalogue` | 40 rows, every one "Not checked yet" with a sentence for its denominator | 0 rows | 10 rows, every figure a sentence | 0 rows, "No product carries a finding, so this file has no rows. That is the answer, not a failure." |
| Pages never read | `120 products in the catalogue` | 40 rows: the 13 catalogue checks counted, the 31 page checks each "Not checked yet / No product page has been read yet" | 0 rows | 10 rows | 120 rows |

Three things this table is the evidence for. The empty store's `findings` file
is 40 sentences and not 40 zeros. The pages-never-read store's page checks are
sentences on both the count and the denominator, so nobody sorts the file and
concludes the pages are clean. And `findings` is 40 rows against a vocabulary of
44, so the file appends the screen's own column accounting under "Where every
check went" - A6, A10 and A11 count collections and B30 counts blog posts, each
with its own denominator, and none of the four is a row with the products
denominator over it.

The headline figures on the same five, from `keyFigures`, are what both the
screen and the report print: 50 products `clean=26, needSomething=24,
shopWide=0, listing=4 of 10`; 189 products `126, 63, 2, 5 of 10`; 20,000
`380, 120, 0, 4 of 10`; empty store, no headline figure at all beyond the four
group counts, all zero; pages never read, `listing=4 of 10` and four zero group
counts, with the report heading saying the catalogue size rather than a share
of it.

#### Every route that reaches this data, and its gate

Step 5 enumerated these in prose. As a table, so a route added later has a row
to be missing from:

| Route | Kind | Gate, in its own loader |
|---|---|---|
| `/app/seo/dashboard` | screen | `isSeoUnlocked`, plus `app.tsx`'s subscription gate |
| `/app/seo/dashboard/print` | screen | `isSeoUnlocked`, plus `app.tsx`'s subscription gate |
| `/app/seo/dashboard/export/findings` | resource | `isSeoUnlocked`, 402 otherwise |
| `/app/seo/dashboard/export/products` | resource | `isSeoUnlocked`, 402 otherwise |
| `/app/seo/dashboard/export/shopwide` | resource | `isSeoUnlocked`, 402 otherwise |
| `/app/seo/dashboard/export/listing` | resource | `isSeoUnlocked`, 402 otherwise |
| `/app/seo/export/since`, `/written` | resource | `isSeoUnlocked`, 402 otherwise (unchanged) |
| `/app/seo` | screen | `isSeoUnlocked` (unchanged) |

A resource route repeats the gate rather than inheriting it: Remix runs such a
route's loader alone, so `app.tsx` does not run on that request and a gate
enforced only by a parent is not enforced at all on that path.

---

### 4.4 Where each part renders

- **SEO screen**, in this order: the "since this engagement began" card;
  the "pages read" sentence; "Findings per product" with every code from A1
  to A7 and B1 to B21 as a row, ordered by count, zeros collapsed, could-not-
  run stated; the Structured data card as today; the meta writer, now with a
  collections tab; term gap; storefront password; "What we found to fix".
- **Product editor**, "What a crawler sees on this page": every finding on
  the row, by code, with the evidence (the length, the URL, the count), and
  the Read-this-page-now button as today.
- **Collections screen**: a "Search listing" section per collection, mirroring
  the product editor's, for A6 and the collections meta writer.
- **Products list**: the "Page" column as today; no change.
- **Weekly watch**: per product, by code, as today; the new codes join the
  vocabulary and nothing else changes.

---

## 5. Acceptance

Every row has a unit test. By-hand checks are listed with who and where; six
of today's ten are still undone because they need a client store without a
storefront password, and the same will be true of most of these.

| Criterion | Unit | By hand |
|---|---|---|
| `grantSeoUnlock` writes the snapshot before the key, once; a second call does not overwrite it | counting Prisma stub, two calls | Marius, plans screen, second dev store |
| A snapshot with source B unrun stores null for page fields and the card says "not read at the time", never 0 | unit | - |
| A manual snapshot carries `takenBy: "manual"` and the card shows its date, not "since the start" | unit | Marius, client store |
| The since-card orders rows by difference, shows both denominators when they differ, collapses unchanged rows | unit on four shapes: no change, catalogue grew, catalogue shrank, everything moved | - |
| "Written by this app since then" counts only `state` entries with `source: "auto"` and a timestamp after the snapshot | unit | - |
| A6 classifies a collection meta field the same way `classifyMetaField` does a product's | unit, all three states | - |
| The collections meta writer never touches a human-written field and never writes an identical value | unit, both guards | Marius, one collection |
| B8 flags `?variant=` and `/collections/x/products/y`, and not `/products/y` | unit, three URLs | - |
| B9 reads "not applicable" on a single-market shop | unit | - |
| A7 reports a withdrawn product still in the sitemap and a public one absent, and nothing on a matching set | unit on a sitemap fixture | Marius, after a withdrawal, next night |
| B10 and B11 report the length and absence, with the threshold source in the method line | unit | - |
| B12 counts H1s and reports the texts | unit on 0, 1, 3 | - |
| B13 and B14 name the absent tags | unit | - |
| B15 uses `looksLikeMachineAlt` and reports count of denominator | unit | - |
| B16 checks at most 20 links per page, counts them against the budget, and reports "20 of N checked" | unit with a counting fetch stub and a 200-link page | - |
| B17 reports word counts, never advice | unit | - |
| B18 flags each hygiene case and passes a clean handle | unit, five handles | - |
| B19 reports a two-hop chain and a loop, passes a single 200 | unit with a fetch stub | - |
| B20 lists `http://` resources on an `https://` page | unit | - |
| B21 names the other handle sharing the title | unit, two pages | - |
| Every new code is in the vocabulary the weekly diff reads | unit: the list of codes equals the list the diff knows | - |
| No new string on any screen contains "rank", "score", "keyword", "boost", "optimise" or a rich-result promise | grep | - |
| The SEO card renders correctly on an empty shop, a 50-product fixture, a 20,000-product store and a shop where source B never ran | unit on the aggregate, four shapes | - |
| Every count on the card is asserted on the rendered string, not only on the aggregate | component test; this is the row the per-product QA declined and the reason was right | - |
| A figure on the print page and the same figure on the screen cannot diverge | component test walking `keyFigures` on all five stores, asserting each value in both renders | - |
| The report carries no Polaris chrome, no disclosure control, and asks the printer not to split a card | component test on the markup: no `aria-expanded`, no `Polaris`, `break-inside: avoid` and `@page` present | Marius: press the button in the admin and say whether a dialog appears |
| Every CSV opens in Excel with Romanian text intact | `CSV_BOM` on every response, asserted on the route pattern the two existing exports already use | Marius, one file on a Windows machine |
| No CSV cell can run as a formula, in the new exports or the two shipped ones | unit on `csvCell`: `=`, `+`, `-`, `@` neutralised, plain numbers and `-3` left alone | - |
| A check that could not run never exports as a zero | unit on the store whose pages were never read: every page check is a sentence in both count and denominator | - |
| An empty store exports headings and a sentence, never a fabricated row | unit on the empty store and the no-findings store, per file | - |
| Filenames carry the shop and the date and cannot break the header they sit in | unit on `exportFilename`, including a domain containing a quote | - |
| Every new route carries `isSeoUnlocked` in its own loader | the table in 4.3, and the gate is read in each route file | Marius: type a print URL on a shop without the key |

---

## 5a. What the research changed, 4 September 2026

Two delegated reads, verified by hand where they bear weight: Google Search
Central and Shopify's own documentation for what on-page SEO consists of, and
the nine leading Shopify SEO apps' own listings for what they do and charge.

### Two facts that change positioning, not only this module

**FAQ rich results are gone.** Google added a deprecation notice on 7 May 2026:
FAQ rich results no longer appear in Search for any site; the Search Console
report and the Rich Results Test support were removed in June. Confirmed by
Search Engine Journal and the Search Central updates log. `FAQPage` remains
valid schema.org and assistants still read it, so the app keeps emitting it,
but no sentence anywhere may imply a Google search feature from it. The SEO
screen's "FAQ" node row, if any, is reworded to "read by assistants, not shown
by Google".

**Google states llms.txt is not used by Google Search.** June 2026, in the AI
optimization guide: "You don't need to create new machine readable files, AI
text files, markup, or Markdown to appear in Google Search (including its
generative AI capabilities), as Google Search itself doesn't use them." Google
adds that sites are free to keep such files for other systems. Confirmed by
SEJ and SERoundtable. This is a fact for the listing, the ads and the landing
page: llms.txt is for assistants that read it, and no copy may connect it to
Google. The product never claimed that, but the search ad on `[llms txt]` and
the listing name carry the term, and a merchant may assume Google. Recorded
in `shared/GTM.md` on the sales side for Marius's decision.

### Corrections to sections 2 and 3

- **B10 and B11 are reworded.** Google's own wording: "there's no limit on how
  long a title element can be, the title link is truncated as needed,
  typically to fit the device width." Same for descriptions. The 60 and 160
  figures are industry estimates of pixel truncation. The row therefore says
  "longer than typically fits on a mobile result, by Google's description" and
  the method line quotes Google, never "over the limit".
- **B8 absorbs the collection-duplicate case.** Shopify's `within` filter
  produces `/collections/x/products/y` as a second URL for every product in
  every collection. The canonical is theme-owned, not automatic. B8 reports
  the canonical as fetched and whether it points at `/products/y`.
- **B9 is narrowed.** Shopify Markets adds hreflang and canonical automatically
  through `content_for_header` unless the merchant turned it off. B9 reports
  present, absent, or "not applicable, single market", and when absent on a
  multi-market shop it says the platform setting is off rather than that the
  theme is wrong.
- **A7 is a report only.** Shopify owns `sitemap.xml`, updates it on content
  changes, and offers no editing. The row can only say "absent" or "still
  listed"; the fix is always a product setting, never a file.

### Checks added from the research

| Code | Check | Source | Why it earns its row |
|---|---|---|---|
| A8 | Merchant listing readiness: the product carries everything Google's merchant-listing documentation marks required (name, image, Offer with price greater than zero and priceCurrency) and recommended (availability, itemCondition, shippingDetails, hasMerchantReturnPolicy) | A + the Business screen | It is the one composite a merchant understands: "eligible for Google's free product listings or not", per property, with the Google page linked |
| A9 | Price and availability consistency: what the page's structured data says against what the variants say | A + B | Google disapproves a product whose page price differs from its data; today this is A2 in part, and A9 is the full rule with both directions |
| B22 | Deprecated structured data on the page: `FAQPage`, `HowTo`, or any type Search Central lists as no longer shown, emitted by the theme or an app | B | Says plainly that the node costs nothing and earns nothing in Google; never says to remove it |
| B23 | `robots.txt` review: the default disallows, any custom line, and whether anything blocks `/products/` or `/collections/` | one fetch per pass | Shopify calls editing it an unsupported customisation that "can result in loss of all traffic"; a merchant who touched it should see what they did |
| B24 | Meta keywords tag present | B | Google: "not used by Google Search, no effect on indexing and ranking at all". The row says exactly that, so the merchant stops maintaining it |

### 5b. The practice layer: what Shopify SEO consultants check that the documentation does not say

Third delegated read, 4 September, on named practitioners: Ilana Davis,
Matthew Edgar, Jason Berkowitz (Break The Web), Glenn Davidson (Tomango),
Ahrefs Help Center, Craftshift. LinkedIn would not load and nothing was
invented from it. Items whose only source was search aggregation across
unnamed guides are marked "medium" and go in only where the check is
mechanical enough that the source does not matter.

Every one of these is measurable from the page or the Admin API. None of
them writes anything: the fix is the merchant's, and the row says what the
page has. Where a practitioner's remedy is "rewrite the description", the row
stops at the finding, because rewriting is the line this product does not
cross.

| Code | Check | Source | Confidence | Row says |
|---|---|---|---|---|
| A10 | Collection description empty or under 50 words | Craftshift; Charle | named | word count per collection |
| A11 | Collection with zero or one product | Craftshift | named | count, per collection |
| A12 | Product descriptions duplicated inside the catalogue: two or more products sharing the same description text | Skalum, and the mechanism is Google's own duplicate clustering | medium on source, certain on mechanism | the group of handles; never says to rewrite |
| A13 | A URL redirect whose target is the home page | Matthew Edgar quoting John Mueller: mass home-page redirects are treated as soft 404s | named | the old path and the target |
| A14 | Automatic geo or currency redirection switched on under Markets | Ilana Davis: Google crawls from US addresses and sees only the US version, breaking rich results and Merchant Center for every other market | named | on or off, from the Markets settings; the row quotes the consequence |
| A15 | Image filenames that are camera or upload defaults (`IMG_`, `DSC_`, a UUID) | medium | medium | count of denominator per product |
| A16 | Orphan products: in no collection and linked from no menu | Ahrefs Help, Break The Web | named | the list |
| B25 | Collection grid links to `/collections/x/products/y` rather than `/products/y`, so the canonical URL has no internal link pointing at it | Ahrefs Help Center, on why Shopify stores show "orphan" canonicals; Break The Web | named | per collection page read: how many product links are the long form |
| B26 | `noindex` on a product that is only out of stock | Matthew Edgar, Tomango: noindex behaves like a soft 404 and the page loses what it had | named | the product; the row states both practitioners' reasoning |
| B27 | Two Product nodes on the page from two different sources, typically the theme and a review app, each with its own `AggregateRating` | Ilana Davis | named | this is B1 with the sources named; B1's row gains the origin of each node |
| B28 | Click depth: a product more than three clicks from the home page through menus and collections | Break The Web | named | computed from the menu tree and collection membership, no crawl needed; depth per product |
| B29 | Internal links on the product page, by kind: breadcrumb, related products, collection, in-description | medium | medium | the counts; no target number is stated, because no named source states one |
| B30 | Blog posts with no link to any product or collection | medium | medium | per post, one fetch each, under the daily budget |
| B31 | The first image on the product page is lazy-loaded | medium, but mechanically certain: a lazy-loaded LCP element delays LCP | medium | the attribute as found |
| B32 | Script tags on the product page by origin domain, and app embed blocks present in the theme | Break The Web on ghost code; the count is a fact, the judgement is the merchant's | named for the practice | the table; never says which to remove |
| B12a | The H1 wraps the logo | Break The Web | named | added to B12's row as a named case |

Not added, and why: Search Console statuses ("discovered, currently not
indexed") need Search Console; backlink value needs a backlink tool; "crawler
signature access" is a workflow step for Screaming Frog, not a merchant
screen. All three stay in section 6.

One practitioner rule adopted for the screen itself, from Break The Web: do
not report what the merchant cannot act on. B32 therefore sits at the bottom
of the card with the counts and no verdict, and nothing about Shopify's own
server times appears anywhere.

### What the 200 EUR has to exceed, from the competitor listings

Nine apps, 9 to 99 USD a month; median entry plan 27.50 USD a month, so a
year of the median app is about 330 USD. All nine claim rankings or traffic in
their listing copy. Six of nine require the "edit theme" scope and reviews on
two describe theme damage. All nine generate text with a model. None states a
never-overwrite guarantee, none names its crawler counts, none extends the
theme's node by `@id`, none says zero JavaScript.

So the 200 EUR buys, and the SEO screen must show: every check above as a row
with its denominator; the before-and-after card from section 1; a meta writer
that condenses the merchant's own words and nothing else; no theme edit, no
script, no model; and one CSV that goes on the invoice. The pitch is not more
features than a 39 USD app. It is that every number on the screen is real and
every write is reversible, which none of the nine can say.

## 6. Out of scope, said so it is not assumed

Page speed and Core Web Vitals: a different tool. Search Console: the AI
report is not in any API. Backlinks: not on-page, and no data source. Any
keyword, any volume, any ranking. Rewriting a title or a description: the
writer condenses the merchant's own words and nothing else, and that line
was drawn in `SEO-WORKSPACE-PRD.md` section 2 before any of this existed.

---

## 7. Build order

Each step ends with `check.bat` and the suite with `.env` renamed away, and
its handover carries the last lines. Each step is one Claude Code session.

1. **Section 1.1, the snapshot.** Table, migration with its down path, the
   write inside `grantSeoUnlock`, the manual path for a shop already
   unlocked, a read-only script that prints one shop's snapshot as counts.
   Half a day. The first deliverable, because every day without it is a day
   the client's before is lost.
2. **Section 1.2 and 1.3, the card and the export.** Half a day.
3. **Section 2**: A6 and the collections writer, then B8, B9, A7. One day.
4. **Section 3 and 5a**: B10 to B24, in that order, each with its test before
   the next starts. Two days. B16 last among them, because it spends budget.
4a. **Section 5b, data half**: A10 to A16, all from the Admin API, no page
   fetch. Half a day.
4b. **Section 5b, page half**: B25 to B32. B30 spends budget on blog posts
   and goes last. One day.
5. **Section 4.1 and 4.2, the dashboard, from the approved mockup.** The
   mockup is written by the assistant, not by Claude Code, and approved by
   Marius before this step starts. Then `/app/seo/dashboard` is built to
   match it, reading every code that exists by then; a code not yet built
   renders as "not yet checked", never as zero. One day.
6. **Section 4.3, the report.** The printable route and the CSVs. Half a day.
7. Two independent QA rounds on different axes, adjudicated, with a
   "Wrong or overstated" section, before any of it is called done. Then
   CHANGELOG, commit, deploy, tag.

Six days. Step 1 alone is worth shipping on its own if the rest slips: it is
the difference between "we did work" and "here is what changed".

Final count: 16 data checks (A1 to A16) and 32 page checks (B1 to B32), every
one a row with a denominator, none a score.

---

## 8. Build step 4 as built, 4 September 2026: B10 to B24

Every deviation from sections 3 and 5a is named here rather than left for the
next reader to find. Where this document and the code disagreed, the document
is corrected and the correction is said out loud.

### 8.1 What was built

All fifteen checks, in the order the step asked for, each with its test before
the next started, and B16 last because it spends budget. Every one is a source
B row on `SeoScan`, a row on the findings card with its own denominator
(`CHECKS` in `seo-aggregate.ts`, all fifteen `basis: "pagesRead"`), and a line
in the product editor's "What a crawler sees" section. The pure checks are in
`app/services/seo-onpage.ts`, which imports nothing with a `.server` suffix, so
each is asserted from a string of HTML.

`read_markets` was added to `access_scopes` (Marius, 4 September 2026). B9 now
runs for real; its "not applicable" state for a single-market shop and its
"could not be read" state for a refusal are both still reachable and both still
tested.

### 8.2 Deviations from sections 3 and 5a

1. **B17 asks about the product description, not "the description" in general.**
   Section 3 says "the description under 40 words". Taking that from the meta
   description makes B11 and B17 contradict each other on every product in every
   catalogue: B11 reports a meta description over about 160 characters, and 160
   characters cannot hold 40 words. B17 reads the description from the page's
   own Product node and reports null - "could not be asked" - when the page
   states none.
2. **B12 absorbs B12a rather than giving the logo case its own code**, as
   section 5b's own table proposes ("added to B12's row as a named case"). One
   H1 that is the logo is a finding with `logoInH1: true` and the signals that
   were seen; the count is separately correct and the row says so.
3. **B16's cap is per page and its cache is per pass.** Section 3 says "one
   fetch per distinct URL per pass, with a cap of 20 links per page", and that
   is what is built - a storefront links to the same collection from the
   breadcrumb, the menu and the footer of every page, so the second page's links
   usually cost nothing. What the section did not say, and what is now explicit
   in the tests, is the arithmetic across the whole pass: pages and links come
   out of one allowance, and `stopped` is computed from what is left of it
   rather than from pages read. Counting pages alone would have reported a night
   that spent its budget on links as finished, with pages still waiting.
4. **B16 does not run on the "Read this page now" button.** The button is
   guarded by one page of budget; checking links there would let one click spend
   twenty-one requests. The previous B16 finding is carried forward untouched,
   the same rule A7 and B9 already follow: not re-checked is never rendered as
   no longer true. B21 is carried forward for the same reason - its comparison
   is a query over the whole table, made once per pass.
5. **B19 is asked before the response branches, and it changed how a page is
   fetched.** `readProductPage` follows redirects by hand (`redirect: "manual"`,
   five hops maximum) instead of with `redirect: "follow"`. Identical HTTP
   traffic; the difference is that the chain is visible at all. A loop never
   reaches a 200, so a chain check that ran only on pages that answered would be
   silent on exactly the case it exists for.
6. **B21 needed a column.** `SeoScan.pageTitle`, migration
   `20260906090000_seo_scan_page_title`, down path written first. Not in this
   document, and unavoidable: at 500 pages a night the two products sharing a
   title are read on different nights.
7. **B22's type list is two entries, and the sitelinks search box is
   deliberately not one of them.** It is a property on a `WebSite` node, not a
   type, and this app emits a `WebSite` node itself; a check by type would have
   reported our own correct output as deprecated.
8. **B23 is written onto every page row of the pass rather than being a
   per-shop row.** The file applies to every page, so its denominator is the
   pages read and "500 of 500" is the honest reading of one edited line. A shop
   whose robots.txt turns the scan away reads zero pages, so B23 shows "not yet
   read" there and the card's existing robots sentence carries the Disallow -
   which is the sentence that screen already had.
9. **B24 states Google's position without the word it cannot use.** The PRD
   asks for "Google's sentence that it has no effect", and Google's own sentence
   names indexing and ranking. Section 5's grep forbids "rank" on any screen.
   The row says Google does not use the tag and that it has no effect on
   indexing, which is the same fact with the forbidden half left out rather than
   the rule quietly broken. A test asserts both.
10. **A method line exists, and it is a new thing.** Section 3 asks for the
    threshold source "in the row's method line" without saying where such a line
    lives. `CHECK_METHOD` in `seo-findings.ts`, rendered under the label on the
    SEO card and under the finding in the product editor. Ten of the fifteen
    have one; the other five quote nothing and carry none.

### 8.3 Two things a live read corrected, and what they say about writing from memory

`scripts/read-onpage-checks.ts` (new, read-only: no database, no Admin call, and
it does not touch the shop's daily budget) fetches a store's product sitemap and
runs every check against real pages. Run against `mrdigital-dev` before this
step was called done, it found two defects that no unit test could have:

- **The list of Shopify's own robots.txt Disallow lines was written from
  memory** and matched 25 of the dev store's 40, so B23 reported 15 unrecognised
  lines on a store nobody had touched. Shopify's file has changed shape - it now
  carries an Allow block and agent instructions in comments. Read off the live
  file it matches all 40. The row's wording was already the careful one ("not
  part of the file Shopify ships as this app knows it") and that is what saved
  it from being a false accusation rather than a wrong number.
- **`seo-onpage.ts` had its own six-entry entity table.** A dev store title came
  back as "Aarhus Round Dining Set & 4 Chairs - Nordwood &ndash; MRDigital-dev":
  `ndash` was not in it, so B10 would have printed an entity at a merchant and
  counted it as seven characters instead of one. Entity handling now comes from
  the engine, where every other text this app shows already got it.

### 8.4 What the checks find on the dev store, 4 September 2026

Twenty product pages, read through the storefront password, nothing written:

```
robots.txt: read, 40 lines Shopify ships, 0 it does not recognise,
            blocking neither /products/ nor /collections/
Sitemap: 50 product URLs, reading 20.
Pages read as a crawler sees them: 20. Could not be read: 0.

  B13   20 of 20  Open Graph tags absent            (og:image, on every page)
  B14   20 of 20  Twitter card tags absent          (twitter:image)
  B22   20 of 20  Structured data Google no longer shows   (FAQPage)
  B17   15 of 20  Short description, or little text  (36 words, from the Product node)
  B10    1 of 20  Title length                       (61 characters)

Raised nothing on these pages: B11, B12, B15, B16, B18, B19, B20, B21, B23, B24
```

B16 raised nothing because this script does not fetch links, and that is stated
rather than counted as a pass. The other nine are genuine silences on this
store.

**The B22 result is this app's own output**, and it is the reason the two
`FAQPage` nodes in the block gained the emitter marker the four other nodes
already carried: without it the row named a node of ours without saying it was
ours. Extension change, so it ships with the deploy.

### 8.5 One defect found next door and not fixed here

**Closed 4 September 2026 as the first item of step 4a - see section 9.0.**


On a shop with a storefront password, A7 reports nothing at all: the nightly
pass unlocks the storefront and then calls `fetchSitemap` with the plain fetch,
so the sitemap answers with the password form. Found while writing
`read-onpage-checks.ts`, which passes the cookie and reads the file. Not fixed
in this step - A7 belongs to the step that built it, and a fix that arrives
inside an unrelated wave is how a class of defect comes to be half closed.

---

## 9. Build step 4a as built, 4 September 2026: A10 to A16

### 9.0 The A7 defect from step 4, closed

Section 8.5 recorded it and deliberately left it: on a shop with a storefront
password the pass unlocked the storefront for the pages and then called
`fetchSitemap` with the plain fetch, so the file answered 200 with the password
form and A7 reported nothing. `fetchSitemap` now takes a `cookie` option and the
pass passes the one it already holds. Two tests, in both directions: with the
password the fetch carries the cookie and A7 fires on the one product the file
omits; without one the read still fails and A7 still stays silent, because a
sitemap that could not be fetched is not a sitemap that omits every product.

### 9.1 What was built

A10 to A16 except A14, all computed at the end of the catalogue pass where
source A already runs, all from the Admin API, and not one of them fetches a
page. The pure checks are in `app/services/seo-catalogue.ts`.

A10 and A11 carry the collection denominator and live on `CollectionSeoQueue`,
exactly where A6 lives and for the same reason: their denominator is the
collections that check read and never the catalogue. A12, A13, A15 and A16 carry
the product denominator, are in `CHECKS` with `basis: "catalogue"`, and appear
on the findings card, in the product editor and in the weekly diff's vocabulary
like every other code.

### 9.2 A14 is not built, and this is a failed acceptance criterion, not a rewording

Section 5b's table asks for "automatic geo or currency redirection switched on
under Markets: on or off from the Markets settings". **The setting is not
exposed by the Admin API.** Established by listing every field of the relevant
types against a live shop on 4 September 2026, with this app's own token, rather
than from memory:

```
Market fields:      assignedCustomization, catalogs, catalogsCount, conditions,
                    currencySettings, delivery, discounts, discountsCount,
                    handle, id, metafield, metafields, name, priceInclusions,
                    status, type, webPresences
MarketWebPresence:  alternateLocales, defaultLocale, domain, id, markets,
                    rootUrls, subfolderSuffix
Shop, fields matching redirect/geo/localise/currency/market:
                    currencyCode, currencyFormats, currencySettings,
                    marketingSmsConsentEnabledAtCheckout
```

None of them is the redirect preference. A check that could only ever answer
"could not be determined" is a promise rather than a finding - the same argument
this document's own section 2.3 made about B6 before B6 turned out to be
computable, and here it holds. So `A14` is not a code, not a label and not a row;
`seo-catalogue.ts` and `seo-findings.ts` both say why at the point where it would
have been, and a test asserts the absence is deliberate.

**The criterion is recorded as unmet.** What would meet it, for Marius to
decide: read the storefront's own behaviour - request a product page with a
non-local `Accept-Language` and see whether it answers with a redirect. That is
a page fetch, so it belongs to a B code and to the page budget, not to step 4a.

### 9.3 Two Admin scopes are missing, and one has been missing since A4 was written

Verified against `mrdigital-dev` on 4 September 2026 with this app's own token:

| Query | Answer |
|---|---|
| `urlRedirects` | `Access denied for urlRedirects field.` |
| `menus` | `Access denied for menus field.` |
| `markets` | `Access denied ... Required access: read_markets` |

Three things follow, and the first is the one worth stopping on:

1. **A4 has never been able to check a redirect on this store.** `lookupRedirect`
   queries `urlRedirects`, catches the failure and returns null, and A4 reads
   null as "not checked". That is the correct behaviour and it is why nobody
   noticed: the check has been honest about not knowing, for as long as it has
   existed, and no screen said the reason.
2. **`read_markets` is in the toml and not yet in the session.** The scope was
   added earlier today; the dev store's stored token still carries the old set,
   so B9 reads "could not be read" there until the app is re-authorised on that
   store.
3. **One scope would unlock three checks.** `urlRedirects` and `menus` both sit
   under Online Store - Navigation in the Shopify admin, so
   `read_online_store_navigation` covers A4, A13 and A16 together. **Not added:
   the scope decision is Marius's.** A13 and A16 are built to start working the
   moment it lands, with no further code.

### 9.4 Deviations from section 5b

1. **A13 has two halves, and only one of them can be a row.** A redirect to the
   home page from `/collections/old-range` or `/pages/about-us-2019` names no
   product, and on a migrated store those are the majority. The half whose path
   names a product in this catalogue is a finding on that product's row; the rest
   is recorded per shop in Setting `seo_home_redirects` and stated as a line
   under the row. This is exactly the shape A7's withdrawn-product half already
   has, and it is the only way to give A13 the product denominator section 5b
   asks for without dropping most of what it finds.
2. **A15's denominator is the images the read carries, which today is the
   featured image alone.** The bulk query asks for `featuredImage` and no other
   media, and section 5b says "from the media URLs already in the bulk read". So
   the row reads "1 of 1" on most products, and it says so rather than implying
   it looked at a gallery. Widening the bulk read to `media(first: N)` is a
   separate decision with a cost on every pass.
3. **A15's predicate is deliberately narrower than "contains IMG".** A filename
   with any word in it passes, including `chair-img-2.jpg`. A filter that removes
   noise and value together is worse than the noise, and the value it would
   remove here is a merchant's own naming (`DICTIONARY-PORT` section 10.1).
4. **A16 answers from the Admin API, not from a crawl.** "Linked from no menu"
   is read from the shop's menus, three levels deep, by `resourceId` and by the
   `/products/<handle>` in a hand-typed `url`. A product linked only from a body
   of text on a page is an orphan by this check and is not one to a crawler. The
   method line says so.
5. **A new card state, `couldNotRun`.** Not in this document at all, and
   unavoidable: A13 and A16 have a full product denominator and a count of zero
   whenever their Admin read is refused, which is the exact shape of a check that
   ran and passed. The state, its Setting (`seo_checks_unavailable`) and the
   reason printed on the row are what keep the two apart.
6. **A12 compares after `cleanOutput`.** Two descriptions that differ only in
   how an imported catalogue encoded an ampersand are one description to Google's
   duplicate clustering, and now to this check.

### 9.5 What these checks find on the dev store, 4 September 2026

`npx tsx scripts/read-catalogue-checks.ts mrdigital-dev.myshopify.com`
(read-only: one bulk export, one collections read, the two Admin queries, and no
write of any kind):

```
Products read: 50 of 50 announced (complete)
Collections read: 2

URL redirects: COULD NOT BE READ - the Admin API refused the query
Menus:         COULD NOT BE READ - the Admin API refused the query

Collection checks, count of collections read:
  A10     2 of 2     Collection description empty or under 50 words
  A11     0 of 2     Collection holding no products, or one
       A10 example: sofas has 0 words

Product checks, count of products read:
  A12     0 of 50    Description shared word for word with another product
  A13   could not be checked
  A15     1 of 50    Image filename is a camera or upload default
       example (oslo-dining-set-and-6-chairs):
       {"count":1,"images":1,"names":["F4DA3683-12A0-46C5-8C19-A90FABB3DB2D.png"]}
  A16   could not be checked
```

A15's one hit is a real UUID filename on a real product, which is the only
evidence worth having that the predicate fires on what it was written for. A12's
zero is a genuine zero on a seeded fixture whose descriptions are all distinct;
it says nothing about a real catalogue. A13 and A16 print "could not be checked"
and not a zero, which is the whole of 9.4 item 5 working.

### 9.6 One thing left undone on purpose

With `read_online_store_navigation` present, every pass would read the whole
redirect list for A13 **and** make up to 50 single-redirect lookups for A4, for
data the list already holds. Folding A4 into the list is a change to A4's
semantics and to its tests, and a wave that reaches into a neighbouring check
while nobody is looking is how a class of defect ends up half closed. Recorded
here rather than done.

---

## 10. Build step 4b as built, 4 September 2026: B25 to B32

### 10.0 The scope decision section 9.3 left to Marius, taken

`read_online_store_navigation` is in `access_scopes`, on the same reasoning as
`read_markets`: there are no merchant installs beyond the dev store, so the
re-authorisation every merchant would be re-prompted for costs nothing today.
One scope covers `urlRedirects` and `menus`, and therefore four checks - A4,
A13, A16 and now B28 - of which A4 has been answering "not checked" on every
renamed product since the day it was written.

**It does not take effect until `npx shopify app deploy` runs and the dev store
re-authorises.** The stored token still carries the old set, which is why
section 10.5 below shows A13, A16 and B28 printing "could not be checked" from a
run made after the toml changed. That is the refusal state working, not a
regression, and it is the reason the state was kept rather than deleted the
moment the scope was added: a refusal is still possible on an older token, and a
check that was refused must never render as one that ran and passed.

Section 9.6 stays undone and stays deliberate: A4 still makes its own
single-redirect lookups rather than reading the list A13 now fetches. Folding
one into the other changes A4's semantics and its tests, and this wave has
already reached far enough.

### 10.1 What was built

B25, B26, B28, B29, B30, B31, B32 - seven codes for eight rows of section 5b,
because B27 is not a code (10.2). The pure checks are in `seo-onpage.ts` beside
B10 to B24, except B28, which is in `seo-catalogue.ts` because it fetches no
page.

Five are ordinary source B rows on `SeoScan`, counted over the pages read, on
the findings card and in the product editor: B25, B26, B29, B31, B32. Two are
not, and each says why on its own row:

| Code | Denominator | Where it is rendered from |
|---|---|---|
| B28 | the catalogue | `CHECKS` with `basis: "catalogue"`, source A |
| B30 | the blog posts a pass read | the per-shop record, like A10 and A11 |

### 10.2 B27 is not a code, and this is not A14's kind of absence

Section 5b's own row says what B27 is: "this is B1 with the sources named; B1's
row gains the origin of each node". So it does. `B1.detail` now carries
`origins` - for each Product node on the page, whether it came from the theme or
from an app, its `@id`, and whether it carries its own `aggregateRating` - and
`aggregateRatings`, the count of those that do. `LdNode.hasAggregateRating` was
already read by `extractLdNodes`, because on this platform AggregateRating is
never a top-level node.

A14 could not be built: the Admin API does not expose the setting. B27 was built
and put where section 5b said to put it. The two absences are recorded in the
same place - the `FindingCode` union - and the note there says which is which,
so a later reader does not conclude that one of them was forgotten.

### 10.3 The card gained a fifth state, and a place at the bottom

`CheckState` now has `counted`, and `CHECKS` entries carry `reports?: boolean`.
Two checks use it, B29 and B32, and the reason is one sentence: no named source
states a target for the internal links on a product page or for the scripts it
loads, so this app states none. Rendered as "found" they would invent a verdict;
rendered as "clean" they would invent the opposite. They sit last in
`aggregate.rows` and last on the card, under the heading "Counted, not judged",
which is Break The Web's own rule for an audit applied to the screen.

`reports` is not a sixth `CheckBasis` and not a `source`. Those two say where a
number came from; this one says what the number means.

A `reports` check whose read has not happened is still `notYetRead`. A count of
nothing measured is not a count of zero, and that rule does not stop applying to
a row because the row states no verdict.

### 10.4 Deviations from section 5b, and what each one cost

1. **B25 is a row on a product, and section 5b describes a row on a collection
   page.** Both exist. The finding sits on the product whose canonical nothing
   links to, which is the defect Ahrefs actually describes and which needs the
   product denominator; the per-collection-page counts are recorded per shop
   and stated as a line under the row. This is A13's shape, taken deliberately
   and for the same reason: a fact with no product row is stated beside the
   rows rather than dropped.
2. **B25 costs up to 20 page fetches per pass, before any product page.**
   Before, because a product row is written once per pass and a B25 computed
   after the loop would have no row left to sit on. Out of the same allowance,
   because a collection page is a request to the merchant's storefront like any
   other. The consequence is stated rather than hidden: a shop with 20
   collections reads 20 fewer product pages tonight, and `SourceBReport.collections`
   says so.
3. **B25's predicate is "every link this pass saw", not "every link there is".**
   A product linked plainly from a page nobody fetched still reads as unlinked.
   The method line says the row is read from the collection pages the pass
   fetched, and a product that appeared on none of them produces nothing at all
   rather than a clean result.
4. **B28 is a B-numbered check counted over the catalogue.** A7 is the
   mirror-image trade and has been since section 2. The rule both obey: a count
   carries the denominator it was measured over, whatever the code's letter.
5. **B28 is not a crawl and does not claim to be.** A product reachable in two
   clicks through a link in a page's body text is counted at whatever its menu
   route costs. Same caveat as A16, same reason, and it is on the method line.
6. **B29's four kinds overlap and are not a partition**, and a link's kind is
   read from the markup it sits in. A theme that names its containers unusually
   is counted unusually. Stated on the method line rather than presented as a
   measurement.
7. **B30 is not in `CHECKS`.** Its denominator is neither the catalogue nor the
   pages read, and a row must never borrow a denominator that is not its own.
8. **B31 reads the first image in the body, not the LCP element.** What paints
   largest depends on the viewport and this app fetches HTML with no browser.
   On many themes the first image is the shop logo, which is a smaller fact
   than a lazy hero, and the method line says so.
9. **Every page that answers now carries two findings.** B29 and B32 fire on
   every page, because they are counts. `readingOf` no longer returns an empty
   `findings` array on a clean page, and the two tests that asserted that now
   assert `["B29", "B32"]` with the reason written beside them. This is worth
   knowing before reading any row's JSON.

### 10.5 What these checks find on the dev store, 4 September 2026

`npx tsx scripts/read-onpage-checks.ts https://mrdigital-dev.myshopify.com
--limit 10 --password massive` (read-only, spends no budget):

```
Collection pages: 2 in the sitemap, 2 read; 0 collection-prefixed product links, 80 plain.
Pages read as a crawler sees them: 10. Could not be read: 0.

  B29   10 of 10  Internal links on the product page, by kind
       0 in a breadcrumb, 0 in a related block, 4 pointing at a collection,
       0 inside the description, 9 distinct internal addresses in all
  B32   10 of 10  Scripts the product page loads, by origin
       97 script tags from 3 origins: the shop (53), inline (40), cdn.shopify.com (4)

B30   no blog post was read (0 in the sitemap), so nothing is reported about the blog
Silent on these pages: B25, B26, B28, B31
```

`npx tsx scripts/read-catalogue-checks.ts mrdigital-dev.myshopify.com`:

```
  B28   could not be checked   More than three clicks from the home page
```

B25's zero is the interesting one and it is a real zero: this theme's collection
grid links the plain `/products/` form, 80 times across two pages, and not once
the long form. That is the check reading the right markup and finding nothing
wrong, which is the only evidence worth having short of a store that has the
defect. B26 and B31 are silent because no product on this store is noindexed and
no first image is lazy. B30 says it read no post rather than that no post lacks
a link, on a store whose sitemap names no blog. B28 says "could not be checked"
until the scope of 10.0 is deployed and the store re-authorised.

### 10.6 The count after step 4b

16 data checks (A1 to A16, of which A14 does not exist) and 31 page checks (B1
to B32, of which B27 is not a code). Every one a row with a denominator, and two
of them - B29 and B32 - rows with numbers and no verdict at all. None is a
score.
