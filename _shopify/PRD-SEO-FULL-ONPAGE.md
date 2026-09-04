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
