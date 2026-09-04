# Changelog - AI Visibility All-in-One for Shopify

The app was approved and published on the Shopify App Store on 7 August 2026,
listed as MRDigital AI Visibility AiO.

Server changes go live through CI on push to main. Extension changes require
`shopify app deploy` and create a new version number.

Headings follow the app version numbers Shopify lists in the Developer
Dashboard. Entries dated before 20 August 2026 use an earlier local numbering
that grouped several same-day deploys under one heading, so they do not match
Shopify one for one: the heading below called Version 5 is Shopify's version
8, and Version 4 covers Shopify's versions 3 to 7.

---

## Unreleased

### A Shopify internal error is no longer an Application Error (4 September 2026)

The SEO screen's Scan returned 500 twice, at 04:30:20 and 04:58:26. With the
new formatter the cause was legible at last: HTTP 200 carrying one top-level
GraphQL error, `[INTERNAL_SERVER_ERROR] Internal error. Looks like something
went wrong on our end. Request ID: 5887dbbc-...`. Shopify's own fault, shown to
the merchant as this app crashing.

**The formatter had a second defect, and it hid the answer.** `handleError`
passes the request as the operation, and `describeGraphqlError` read
`operation ?? tagged` - so any name attached by `named()` was silently
discarded, and the absent operation name could not even be used to rule the
wrapped calls out. It now prints both: the request as context and `op=<name>`
for the Admin operation that actually failed.

**Every Admin call the SEO action makes is now wrapped.** `FirstOnlineProductSeo`,
`PrimaryDomainSeo`, `MainThemeIdSeo`, `hasPaidAccess`, and `MainThemeSettings` -
that last one named inside `checkAppEmbed` rather than at the call site, so
every caller gets the name without knowing what the function sends. `ShopId` and
`SetShopThemeScan` were already wrapped.

**The action catches `INTERNAL_SERVER_ERROR` and only that.** It logs the line
with the operation name, writes nothing further, and returns a sentence the
screen already renders: that the failure was on Shopify's side, what survived,
and the Request ID to hand to Shopify support. Anything that is not
`INTERNAL_SERVER_ERROR` still throws, so a real bug here stays loud.

**A partial write is possible and is now said out loud rather than papered
over.** `recordThemeScan` commits its `ThemeScan` row before mirroring
`hasOrganizationLd` / `organizationId` to the shop metafield, so a failure in
the mirror leaves the scan saved and only the storefront mirror stale. It marks
the error it rethrows (`themeScanRowWasWritten`) and the screen gets the true
sentence of the two: "The scan itself was saved ... the next scan updates the
mirror", not "nothing was written".

**Tested.** 7 tests in `app/routes/__tests__/app.seo.internal-error.test.ts`:
the action returns a string rather than throwing, names the Request ID, writes
nothing further (no Setting, no ThemeScan, no JobRun, no enqueue, and no retry),
says the right one of the two sentences, catches the error from the first Admin
call on the path as well as the last, and still throws both a plain bug and a
`THROTTLED` GraphQL error. `npx tsc --noEmit` clean, 48 files and 678 tests
green, the build and the Liquid check green, and green again with `.env`
renamed away.

### A development runner for the nightly page scan (4 September 2026)

`scripts/run-seo-scan.ts` runs source B for one shop now instead of at 03:45
UTC, so the nightly pass can be watched on a real storefront before it is
trusted. Eight of the by-hand checks in `QA-SEO-PER-PRODUCT.md` were waiting on
a cron.

**It calls the task's own code, not a copy.** The per-shop body of
`seo_scan_products` is now `scanProductPagesForShop` in `worker/tasks.ts`, and
the task's loop and the script both call it. A runner with its own origin
resolution, its own entitlement order or its own JobRun would drift from the
task inside one wave, and then the thing being observed would not be the thing
that runs at night. The function throws rather than swallowing, so the task
keeps `markGoneIfSessionless` and the next shop while the script gets a stack
trace and a non-zero exit.

**`--limit N` is a ceiling and never a second budget.** `cappedBudget` in
`seo-page.server.ts` is a `Math.min` in one direction: an operator sets
`seo_scan_daily_budget`, and nothing on a developer's laptop may ask a
merchant's storefront for more pages in a day than that setting allows.
`--limit 5000` against a shop set to 500 runs 500. Six tests in
`seo-page.test.ts` cover lowering, refusing to raise, an absent flag, a value
that is not a number, a fraction, and a negative.

**It says what it writes, before it writes it.** Unlike
`scripts/seo-fields-census.ts`, this one is not read-only: it writes a
`SeoScan` row per page read, a `JobRun` of kind `seo_scan` (which is `running`
for the duration and so refuses every dashboard button, exactly as the nightly
pass does), the day's `seo_scan_spent` counter, and `seo_scan_robots_block`.
The header comment says so and so does the first line of output.

**It prints counts and statuses only** - scanned, password, failed, fromCache,
remaining, nightsToFinish, stopped, and the byCode table - and never a product
title, a handle, a URL or any page content. When robots.txt stopped the scan it
prints the matching rule and the user agent it was matched for. It refuses any
shop whose domain does not end in `myshopify.com`: a runner that can be pointed
at an arbitrary host is a scanner, and this one sends a storefront password. Its
`addJob` throws, because source B queues nothing and that is now asserted
rather than assumed. A mistyped flag prints one line and the usage, not a stack.

**Tested.** `npx tsc --noEmit` clean, 46 files and 660 tests green, the build
and the Liquid check green, and the suite green again with `.env` renamed away.
The script's refusals were exercised by hand: an unknown shop, a bad `--limit`,
an unknown flag. No scan was run against a live storefront from here.

### Per-product SEO scan, step 7 of 7: two QA rounds, adjudicated (3 September 2026)

Two independent rounds on deliberately different axes - one reading the code
against every acceptance row of PRD section 5, one tracing data end to end
through seven scenarios - then adjudicated, with every load-bearing claim
checked against source before it was accepted. Seven claims were rejected or
downgraded; they are named in `QA-SEO-PER-PRODUCT.md`, with the reason for
each. Four defects were found by the adjudication and by neither round.

Six blocking items, all fixed. Two of them were a screen contradicting itself:
**the pages-read sentence counted attempted pages as read**, so a
password-walled store read "355 of 355 pages read." four lines above "355 of
the 355 pages fetched could not be read"; and **B5 was counted over `pagesRead`,
which excludes exactly the pages B5 fires on**, so a store with 200 failures
read "200 of 300" and a store where every page failed read "not yet read" while
carrying the finding on every product. Checks now carry a denominator basis of
their own, and B5's is attempted pages excluding the password wall - excluding
rather than counting, because a password page stores no finding, and counting
it in would have claimed twelve clean pages on a store where nothing was read.

**The robots.txt block reached no screen.** It was written into the JobRun
report, which no route reads, so a shop whose own robots.txt disallows
`/products/` was promised "starting tonight" for a night the app had already
decided would fetch nothing. PRD section 5 says the Disallow "is reported as
B5"; reported into a log is not reported. It is now Setting
`seo_scan_robots_block`, written in both directions so the sentence goes away
the night the merchant fixes robots.txt.

**The two cards derived the Product-node count by different rules.** The page
reader merges two `@id`s that resolve to one address - the reason extend mode
is one node and not a conflict - and the aggregate re-derived it from the raw
strings, because the row does not store the page's final URL. A relative `@id`
beside an absolute one therefore made the Structured data card say "two or more
Product nodes" while the Findings card showed B1 clean and collapsed it, and
pointed the merchant at a row that was not on the screen. The count now comes
from the B1 finding the reader already stored, so the two cannot diverge. Two
fixtures had been building a row the writer cannot produce - two nodes and no
B1 finding - and now carry both.

**Diagnostics hid a real verdict behind a one-page banner.** Its
`passwordProtected` flag is about the single page the theme scan fetched; once
source B has read real pages with the stored password, that banner said
"nothing could be read" about a catalogue that had been read. On the dev store,
whose password cannot be turned off, that is the permanent state. The aggregate
now wins as soon as it rests on a page.

**The acceptance row for the editor's button had no test.** `app/routes/__tests__/`
held one file and it was the CSV export. Eight tests now cover the action - one
read behind the SEO key and no other gate, each refusal a sentence rather than
an exception - and the second render, asserted by answering `scanRowFor` with a
row the action never returned. That is the class CLAUDE.md was amended for on
the same day.

Seven wave fixes: `products/delete` now removes the `SeoScan` row, which was
inflating every denominator and making a list header disagree with its own
list; a deleted product answers 404 instead of crashing the editor route; the
storefront unlock can no longer fail a whole night or hand the merchant a 500;
the night's spend is counted one page at a time rather than once after the loop,
so a pass that dies does not hand its allowance back; `REDIRECT_LOOKUP_CAP` is
asserted for the first time; "the 1 pages read" pluralises; and
`readSeoAggregates` now folds each row and drops it, which is what its own
comment and PRD build step 4 already said it did - it was accumulating every
row, `nodes` JSON included, into one array first.

Six items are deliberately left with reasons, and three need a PRD amendment
rather than code: section 5's row 7 names five source A checks where there are
four and can only be four, section 4 and step 6 disagree on three versus four
column states, and section 3's promise to record the response `Age` has no
column behind it. Put for approval rather than explained away.

**Tested.** 17 new tests and one new test file. `npx tsc --noEmit` clean,
`npx vitest run` 46 files and 655 tests green, `npm run build` green, the Liquid
check green, and the suite run once more with `.env` renamed away - what CI has
- also 46 files and 655 tests green.

**Not verified by hand.** No browser was opened, and the step 2 migration has
still not been applied to any database, so every screen reads an empty table
until it is. The eight by-hand checks that wait on it are listed at the end of
`QA-SEO-PER-PRODUCT.md`.

Seven fixes from a deep audit of the SEO capability. This wave contains
extension changes (`ai-visibility.liquid`), so shipping it requires
`npx shopify app deploy`, not only a server deploy.

### Per-product SEO scan, steps 4, 5 and 6 of 7: the screens (3 September 2026)

The rows written by steps 2 and 3 now have screens behind them. Server only -
no extension file changed in this part of the wave. **The step 2 migration
has still not been applied to any database**, so every screen below reads an
empty table until it is, and an empty table is exactly the fourth shape they
were written and tested for: they say "not yet read", never "0".

**SEO screen: a new "Findings per product" card.** One row per check (A1-A5,
B1-B5), each showing `count of denominator` and a link to the products it
found. Rows are ordered by the count this store actually has, so nothing in
the code decides in advance which finding matters; the same card reads
correctly on a 50-product fixture, a 20,000-product store, an empty one and
one where the nightly page pass has never run. Checks that ran and found
nothing collapse into one line at the bottom, grouped by denominator, because
the catalogue denominator and the pages-read denominator are different
numbers and one sentence quoting one of them for both would be false about
half the checks. A check that could not run reads "Not yet read on N", never
zero. The pages-read sentence from PRD section 3 sits at the top, doing this
shop's own arithmetic from its own budget setting. There is no row for B6;
B6 is not built (PRD section 2.3).

**"Structured data" now reads the aggregate of B1, on both screens that show
it.** It recommends Full mode only when *no* scanned page has a theme node,
and says how many pages the verdict rests on. This replaces a verdict drawn
from one product page, which on 3 September reported "No Product node found"
as a finding about the theme when both pages it had read were the storefront
password form. The card on Diagnostics reads the same aggregate as the one on
the SEO screen, so the two screens cannot disagree about one catalogue; when
the SEO module is off for a shop, Diagnostics keeps its one-page verdict and
now says on the screen that it rests on one page.

**Product editor: "What a crawler sees on this page".** The row's findings in
plain sentences, the date the page was read, and a "Read this page now"
button. Every value is read off the row on each render, never from what the
action returned, so the second render shows what was actually written. The
button exists wherever the SEO key is present, including on the three
products a free-tier shop chose (PRD section 7, decision 2): it fetches one
public page and writes nothing to Shopify, so it is gated on the key alone
and not on a subscription.

**The daily budget is now a counter, and the button spends from it.** Setting
`seo_scan_spent`, `{day, pages}` in UTC. The nightly pass reads only what is
left of the budget and records what it spent; the button refuses when the
allowance is gone. Counting rows instead would have let a merchant press the
button ten thousand times on one product and have it count as one page,
because it moves one row's `scannedAt` each time.

**Products list: a "Page" column**, four states. Green when the last page
read found nothing, amber when it found something, grey when the page has
never been read, and its own state for a page that could not be read at all -
because green would claim a clean page and amber would blame the theme for
something nobody managed to look at. Each row of the SEO card links to
`/app/products?finding=<code>`, a list built from our own rows rather than
from a Shopify search, capped at 250 with the screen saying so when it is.

**Weekly watch gains a per-product mode.** `diffProductFindings` compares this
week's per-product findings against a snapshot in Setting `seo_watch_products`
and the Monday lines name the products that changed, by code, in both
directions. Products with no findings are left out of the snapshot, so a clean
catalogue of any size stores almost nothing. The first week reports nothing,
having nothing to compare against - the same rule the theme diff already kept.

**No sentence on any screen promises a rich result.** `grep -rn "rich result"
app/` returns two hits and neither is a promise: the link to Google's own
Rich Results Test, which reports what Google says rather than what we do, and
the comment recording this change. Check A1's label was
"Missing identifiers for rich results" and is now "Missing product
identifiers: GTIN, brand, SKU or image" - supplying a GTIN does not earn a
rich result, it removes one reason not to get one, and the label went onto a
merchant-facing screen in this step.

**Two modules were split for the client build, and one of the splits was
found by the build failing rather than by review.** `seo-scan.ts` imports
`classifyMetaField` from `seo.server`, so the moment its labels were rendered
in a browser the client build refused: `'./seo.server' imported by
'app/services/seo-scan.ts'`. The finding vocabulary - the codes, the `Finding`
shape, `CHECK_LABEL`, `findingsOf`, `isSourceAFinding` - is now
`app/services/seo-findings.ts`, with `seo-scan.ts` re-exporting all of it so
no caller or test changed. `isOurNodeId` moved from `theme-scan.server.ts` to
`conflicts.ts` for the same reason, also re-exported. Same rule that put
`meta-column.ts` and `conflicts.ts` where they are.

**Tested.** 55 new unit tests: 31 in `seo-aggregate.test.ts` against the
aggregate function rather than any component, over the four store shapes the
PRD names plus a store whose pages all answered with the password form; 9 in
`seo-page.test.ts` for the shared allowance and the one-page read, including
that a refusal fetches nothing and that a failed fetch still moves
`scannedAt`; 6 in `seo-watch.test.ts` for the per-product diff. `check.bat`:
45 test files, 637 tests, typecheck, build and the Liquid check all green,
and the suite run once more with `.env` renamed away, which is what CI has.

**Not verified by hand.** No browser was opened: the migration has not been
applied, so there are no rows to render and pressing the button would find no
row. The by-hand rows in PRD section 5 that wait on a screen still wait.

### Per-product SEO scan, step 3 of 7: source B, the nightly page scan (3 September 2026)

Step 3 of the build order in `PRD-SEO-PER-PRODUCT.md`. Still nothing
merchant-facing: no screen reads these rows yet. Step 4 is not started, and
the step 2 migration has not been applied to any database, so nothing here
runs until it is.

- **New worker task `seo_scan_products`**, nightly at 03:45 UTC. It fetches
  each product's public page as a crawler would - our own user agent, no
  admin session - and records what came back: the JSON-LD nodes, the
  canonical, noindex, whether our block is on the page, the status, and the
  `Cache-Control` the response carried.
- **A per-shop daily budget**, Setting `seo_scan_daily_budget`, absent means
  500. Requests are made one at a time, 500 ms apart. The JobRun report says
  `scanned`, `remaining` and `nightsToFinish`, so a 20,000-product store reads
  "500 read, 39 nights for the rest" rather than a number with no denominator.
  A bad value in the setting falls back to 500 rather than silently scanning
  nothing.
- **The order is the cursor**: never scanned first, then oldest first. This
  corrected a wrong comment written in step 2 - Postgres sorts NULLs *last* on
  ASC, so the query asks for `nulls: "first"` explicitly. Left as written, a
  store would have rescanned the same pages every night and never reached a
  page it had never read.
- **The shop's own robots.txt is obeyed.** A `Disallow` covering `/products/`
  for our user agent stops the scan before a single page is fetched, and is
  itself reported as finding B5. A group naming this app beats the `*` group,
  a longer `Allow` wins over a `Disallow`, and a robots.txt that could not be
  fetched does not stop anything.
- **A page behind the password form is recorded as "could not be read"**, with
  no finding about the page at all - never as "no Product node". The
  storefront password is sent exactly as the existing scan sends it: the
  unlock is now one function used by both, and it is done once per shop rather
  than once per page.
- **`Cache-Control: no-cache` is sent, and what came back is recorded.** A
  page served from a cache is a finding about the cache, not about the theme,
  so the scan states what it received instead of assuming it was fresh.
- **The two sources share one `findings` column and no longer overwrite each
  other.** Source A owns the findings whose source is "A", source B owns the
  rest. Without this the next catalogue pass would have erased every page
  finding - and step 2's "has this row changed" comparison would have seen a
  changed row on every pass and rewritten the whole table each time, which is
  the rewrite storm that comparison exists to prevent.
- **A shop without the SEO key gets no `seo_scan` JobRun at all**, not a
  refused one, and the task asks Shopify nothing for it. A refused row would
  otherwise appear on every shop's dashboard every night for a job nobody
  pressed. The subscription check follows, and behaves like the weekly watch's.
- **Check B6 is deliberately not built** and the reason is written in PRD
  section 2.3: it needs the shop's mode, the embed state and the product's own
  facts, none of which a page read carries. It moves to step 5, where the
  product editor already has them.
- 44 new unit tests, plus two in the step 2 suite for the shared column.
  Verified: typecheck clean, 44 test files, 591 tests green, build clean,
  Liquid check clean. The suite was also run once with `.env` renamed away, as
  CI runs it: 591 green there too.

### Per-product SEO scan, step 2 of 7: the SeoScan table and source A (3 September 2026)

Step 2 of the build order in `PRD-SEO-PER-PRODUCT.md`. Still nothing
merchant-facing: no screen reads these rows yet, and no page is fetched.
Step 3 is not started.

- **New table `SeoScan`**, one row per shop and product, with a hand-written
  migration and a hand-written down path that was written first
  (`prisma/down/20260903120000_seo_scan.down.sql`). The down path names the
  `_prisma_migrations` delete that has to accompany the `DROP TABLE`, because
  without it the next `migrate deploy` believes the table is still there. The
  table holds nothing a merchant wrote: dropping it costs one rescan.
- **Checks A1, A3, A4 and A5 are computed at the end of every catalogue
  pass** - all five of them, listed by file in PRD section 2.2 so the class is
  closed rather than sampled. A1 names the identifiers that are absent; it
  does not score four equal checks, and which of them matters is left to the
  screen, which orders its rows by the counts the store actually has.
- **A check never reports a field that was not read.** A product whose
  variants did not arrive has its barcode and SKU reported as `notRead`, never
  as missing - the merchant is not sent to Shopify admin to fix a field that
  is already set. Same rule for a failed redirect lookup and for a page nobody
  has read yet.
- **A2's variant half is stored as `offer` on the row**, and its comparison is
  written and unit-tested in both directions against a stubbed page. It raises
  nothing until step 3 gives it a real page to compare against, because "not
  yet read" and "the offer agrees" are different sentences.
- **Two rules carried over from the writers.** A row whose content did not
  change is not rewritten - only its `bulkAt` moves, in one statement - and
  the comparison sorts JSON keys because Postgres does not preserve JSONB key
  order. A short catalogue read deletes no rows, the same flag
  `reconcileMirrors` obeys.
- **A shop without the SEO key gets no rows at all**, not empty ones. Turning
  the key on fills them at the next catalogue pass.
- **Source A can fail without taking its host down.** It was added to five
  passes that did their job without it, so a failure is caught, logged and
  reported on the JobRun rather than failing Fill catalogue, the weekly sweep
  or an alt-text run. A reported failure and "no SEO key" are deliberately
  different values, not both null.

Verified: typecheck clean, 42 test files and 545 tests green (42 of them new),
green again with `.env` renamed away as CI runs, build green, Liquid check
green. The migration has not been applied to any database.

### Per-product SEO scan, step 1 of 7: the catalogue read and its census (3 September 2026)

Step 1 of the build order in `PRD-SEO-PER-PRODUCT.md`. Nothing merchant-facing
changed: no screen, no write, no new table, no worker task. Steps 2 to 7 are
not started.

- **The catalogue read now carries three more variant fields**, `barcode`,
  `price` and `compareAtPrice`, on both read paths - the bulk export and the
  single-product query. They ride along on a read the catalogue pass already
  pays for, so no extra API call exists anywhere. The single-product path was
  changed too, though the PRD asked only for the bulk one: a field on one read
  path and not the other is how the same product comes to look different on
  the product editor and on the nightly row.
- **`VariantInput` gained the three fields as optional**, so no construction
  site had to change to compile. All 21 `ProductInput` and 5 `VariantInput`
  references were read anyway; the four sites that build the shape are listed
  by file and line in PRD section 2. The bulk parser's inline variant type is
  now `VariantInput & { metafields }` rather than a duplicate literal, so the
  two cannot drift apart again.
- **`scripts/seo-fields-census.ts`**, read-only, prints counts and no product
  data. It answers how many products carry a barcode, vendor, SKU, image and
  meta fields, and how many meta values collide. It was run; the output is
  pasted verbatim into PRD section 0.1.
- **What the run found is that the dev store is no longer the store the
  documents describe.** CLAUDE.md records 355 furniture products on
  `mrdigital-dev`; it holds 50, unfiltered, with zero barcodes, one featured
  image in fifty, and meta titles that this app wrote on all 50. So the census
  ran and is real, but it cannot settle which SEO checks deserve a card - PRD
  section 0.2 says so plainly rather than dressing 50 seeded products up as a
  measurement, and leaves that decision open for step 4.

Verified: typecheck clean, 41 test files and 503 tests green, build green,
Liquid check green.

### Fixed after two independent QA rounds on the withdrawal wave (3 September 2026)

The wave below was written on 2 September and handed over unrun. On 3
September it was run (41 test files, 502 tests, green with `.env` renamed
away), then reviewed by two independent readers on different axes and
adjudicated by a third; the report is `QA-WAVE-A-2026-09-03.md`. What that
found, and what changed:

- **The reconciliation could empty a shop's whole mirror on a read that parsed
  products but found none eligible.** `complete` counts products, not fields,
  so a `status` or `onlineStoreUrl` that stopped arriving in the bulk export
  would have deleted every row with a "done" report and nothing to re-queue.
  There is now a floor: products read and none eligible means nothing is
  deleted, said in the log and on the Report card. A root count of zero is
  still a legitimate wipe. Consequence to know: a small shop whose every
  product is legitimately out of the set (all sold out, toggle off) keeps its
  pages until one qualifies again. That is the safe direction.
- **Withdrawal was still gated on the weekly sweep and on the toggle job**,
  which contradicted the sentence in the entry below that says it is never
  gated, and the comment in `reconcile_mirrors` that said the sweep still
  takes pages down on any shop. Both now read the catalogue and reconcile for
  every installed shop; only the queueing of new pages is withheld without paid
  access, and the JobRun report says which half happened. Cost: one bulk
  export per lapsed shop per week.
- **The Report card counted a different set than llms.txt** (rows with a
  `productId` against every row), so on a shop with rows from before that
  column existed the card undercounted the public set until the first
  reconciliation adopted them. It now counts every row, which is what the
  proxy serves and llms.txt lists.
- **PRD I.3 was amended** to record that `complete` compares the root count
  only, with the reasoning, instead of arguing it here. Approved the same day.
- A collection whose members all left the store kept its old `table`
  metafield, links to 404s included; an auto-written table is now withdrawn
  when the pass produces none, the way an auto fact is.
- A deleted product on a paid shop kept its page until the weekly sweep while
  a shop without access lost it in a minute; `extractOneProduct` now withdraws
  the row when the product is gone, on both paths.
- The catalogue pass wrote a mirror row only for products with facts, so the
  reconciliation queued one `extract_product` per zero-facts product after
  every Fill catalogue; the row is now written for every eligible product.
- The toggle POST had no `jobKey` and no one-at-a-time guard: two saves ten
  seconds apart made two jobs and a bulk-operation collision. It now refuses
  while a job is queued or running, names which, and keys the job.
- The dashboard's already-running banner did not say what was running, and a
  queued setting change never triggered the stalled-job banner; both now name
  the job (`app/services/job-kinds.ts`).
- A failed or refused setting change rendered no sentence on the Report card;
  every terminal state now has one, and counts pluralise.
- A handle swapped between two renamed products left one product's page
  serving under the other's URL, reported as a clean pass; a row whose
  `productId` is not the product that owns its handle is now withdrawn and
  re-queued.
- The free-tier Products screen told an unlisted product's owner "Not
  published to the Online Store", which is the one cause it is not; it now
  names the toggle and the screen it is on.
- Tests for the rows that had none: the report action, `savePrefs`, the
  `products/delete` handler, and the mirror's availability line.

One finding from the rounds was wrong and is recorded as such in the QA
report: `status:active,unlisted` is documented Shopify syntax ("Filter by a
comma-separated list of statuses", example `status:active,draft`).

### Fixed (a product taken off the store kept its public pages, 2 September 2026)

What a merchant would have seen before this: a product unpublished in June,
still answering at `/apps/ai-visibility/<handle>` in September, still listed in
llms.txt and agents.md, and quotable by an assistant as something the shop
sells. On a shop with no active subscription the page never came down at all
unless the product was deleted outright.

One table, `MirrorCache`, is the whole public set: the proxy serves any row by
handle, and llms.txt and agents.md list every row a shop has. Nothing on the
request path checks the product's state, by design - no Admin API call on a
public request - so the row has to be removed when the state changes, or by a
later check. Four ways it was not:

- **A lost `products/update` on a paid shop.** The weekly cleanup only matched
  rows with a NULL `productId`, which is the shape of rows written before that
  column existed. A row with a `productId` was never touched, and a product
  taken off sale is often never edited again, so the page served indefinitely.
- **Any shop without paid access.** The entitlement gate in `extract_product`
  returned before the withdrawal branch was ever reached. Withdrawal is now
  never gated (true of every path since 3 September; on 2 September the sweep
  and the toggle job were still gated, see the entry above): deleting this
  app's own row writes nothing to Shopify and costs no pass, and a public page
  for a product the store no longer sells is not a benefit kept, it is a claim
  that has become false. The cost is one product
  read per update of a product that has a page, and zero Admin calls when it
  has none.
- **A renamed product.** The old-handle row kept answering 200 with a canonical
  link to a URL Shopify only redirects if the merchant set a redirect.
- **A lost `products/delete`.** Same NULL-only cleanup, same result.

All four now fall out of one rule, in `mirror-reconcile.server.ts`: a row is
kept only because a product that is eligible right now has that handle. It runs
at the end of every catalogue pass, in the weekly sweep, and when a merchant
changes a publishing setting.

- **It refuses to delete anything when Shopify's catalogue download was
  short** (audit 6.9). `fetchAllProducts` now returns `complete`, comparing the
  bulk operation's own `rootObjectCount` against the number of products
  parsed. The object count is reported beside it as `objectsMatch` and has no
  vote: Shopify counts child rows, this parser counts JSONL lines, and if
  those two definitions ever disagree by one, requiring both to match would
  make `complete` false on every shop and the withdrawal would be silently
  inert while appearing to ship. A truncated download otherwise looks exactly
  like a catalogue that shrank, and acting on the difference would empty the
  mirror for a shop whose products are all still on sale. Skipping costs a
  week; deleting wrongly costs every page. This case cannot be forced on
  Shopify, so the evidence is the
  unit test in `catalogue-read.test.ts`, and it is recorded here as such.
- **Comparison tables leaked the same way, in a different shape.** The Admin
  API returns a collection's members whatever their status, and every table row
  links to `/products/{handle}`, so a draft, archived or unpublished member was
  written into the collection's `table` metafield with a link to a 404, and an
  unlisted member appeared in the one place Shopify says it does not. Members
  are now filtered before the table is built. Sold-out members are kept: the
  shop's own collection page lists them, and the table follows the page.

### Added (two settings for which product states are put in front of AI, 2 September 2026)

On the Report screen, a "What is switched on" card with the Plain text pages
row and two checkboxes, each stating its effect in a sentence beside it.
Turning one off removes pages that are already published, within a minute, not
merely stops adding new ones.

- **Include products that are out of stock**, default on. A sold-out product's
  page states its availability, so an assistant reading it is told; hiding it
  would be this app deciding something the merchant did not.
- **Include unlisted products**, default off. `UNLISTED` is a real fourth
  Shopify product status since API version 2025-10, not a synonym for draft:
  the product is active but only a direct link reaches it, and Shopify keeps it
  out of search, collections and recommendations. Publishing it by default
  would undo the merchant's own decision to hide it. Off also keeps it out of
  the catalogue pass, the alt-text pass and the SEO queue.

With both at their defaults the app publishes exactly what it published
before. Never given a page, and no toggle offered for them: drafts, archived
products, and products active but not published to the Online Store. None has
a public address, so a page for them would point at nothing.

- **"Out of stock" was measured wrongly and is now asked of the variants.** It
  read `totalInventory > 0`, so a made-to-order product with inventory tracking
  off, or one whose variant policy is to keep selling at zero, printed
  `availability: out of stock` in its mirror while Shopify was selling it. It
  now reads Shopify's own `availableForSale` across the variants, which is the
  same value the mirror line, the summary's out-of-stock clause and the toggle
  all read, so the three cannot disagree. Unknown stays unknown: a product
  whose variants were not read prints no availability line rather than a guess.

### Added (the Report screen, 2 September 2026)

A new read-only screen at `/app/report`, "Reporting at a glance"
(`PRD-REPORT-SCREEN.md`), and a nav item second after Dashboard. It starts no
job and writes nothing. The existing dashboard is untouched: replacing it here
would mix two changes and make a revert expensive. Paid or comped, the same
gate as Collections, enforced in the loader as well as at the route entrance.

- **Eight panels, each naming its own source in the same card as its number.**
  How much of the shop is readable, as a dial and a ready / partly ready /
  nothing-to-read bar; the attribute values published and how they are spread
  across the catalogue; one real product with its own description beside the
  values that description produced; what the descriptions already say, family
  by family; requests to the app's text pages, grouped into AI assistants,
  search engines, and names that cannot make requests; what to do, worst
  first; the ten products producing the fewest kinds of detail; print and two
  CSV exports. The charts are inline SVG, each carrying an `aria-label`
  stating the same figure the sighted reader sees. No new dependency.
- **A failed pass renders as a named failure, never as a measurement of
  zero.** A failed JobRun's report is `{ error }`, which is truthy, and this
  screen only ever reads a report through `readPass()` in
  `report-metrics.ts`, which yields figures in status "done" and in no other.
  Never run, still running, failed, and finished-without-figures are four
  different states and each says which one it is.
- **`coverage()` now returns `depth`**, one entry per product: how many
  distinct attribute families that product produced. It is arithmetic over
  data the function already walked, the engine stays pure, and `DryRunReport`
  carries it through. The bulk pass also records the ten weakest products by
  the same measure. Reports written before these fields say so rather than
  rendering an empty list as a finding. The weakest list carries each product's
  id, so a row opens the product instead of naming one the merchant then has to
  go and find.
- **`coverage()` also returns `byAttrProducts`**, one entry per product per
  family. It is the tally whose denominator is the product count, so
  "Dimensions on 306 of 355" is true of it (`EXPERIENCE-PRD` section 5). It was
  introduced against a `byAttr` believed to count values and to be able to
  exceed the product count; it cannot. `extract.ts` emits one Fact per family
  per product and joins the readings it found inside it, so the two arrays are
  identical entry for entry - measured on 189 and on 355 real products, with no
  product anywhere producing two values under one name. The screen therefore
  reads `byAttrProducts` where it has it and the same figure under `byAttr`
  where the pass predates the field, instead of relabelling one as the other.
  `byAttr` is kept because the dashboard, the dictionary screen,
  `detailSummary` and `missingFamilies` all still read it.
- **Two method lines and one UI branch that described arithmetic this engine
  does not do are gone.** The details card said "This is a count of values, not
  of products: one product stating two sizes contributes two"; it contributes
  one. The families card carried a "(N values)" bracket that only rendered when
  the two tallies differed, so it could never render, and the CSV carried a
  "Values found" column holding the same number as "Products stating it" in
  every row. The bracket and the column are removed and both method lines now
  say what the figure is. The engine is unchanged: making it emit one Fact per
  value is a separate decision with its own blast radius.
- **The CSV export is a resource route**, `/app/report/export/:table`, with no
  default export. A loader on a route that renders a component cannot return a
  file: Remix hands whatever it returns to that component as loader data. The
  paid gate is repeated in that route, because Remix serves a resource route by
  running that route's loader alone and nothing above it in the tree runs.
- **A crawler the check could not reach is not called blocked.** The causes
  `unreachable` and `unknown` are the check reaching no verdict, which
  `crawler-check.server.ts` says in its own comment; they render as "could not
  tell" and are excluded from the blocked-while-others-allowed finding, so the
  app no longer hands a merchant a message to send their host about a timeout
  of ours. Each row shows the reason under its badge.
- **The shop's own settings are not called a block either.** `robots_disallow`
  is written on a check whose request succeeded - the page came back in full
  and robots.txt separately names the crawler - and `password_page` is a
  Shopify preference every crawler and every logged-out visitor meets. Both
  used to render as "blocked", under the sentence "The last check did not get
  the page", with a paste asking the host to stop returning an error. They now
  read "no, your setting", say where to change it (`robots.txt.liquid` in the
  theme code editor; Online Store, Preferences), and carry no paste, because
  there is nobody to send one to. They are excluded from the critical
  blocked-while-others-allowed finding, which is not a comparison between
  crawlers when robots.txt simply names one of them, and get their own
  "Your setting" finding instead so a password-walled shop is not told there is
  nothing to act on. `bot_protection`, `cloudflare`, `redirect_loop` and
  `server_error` are the causes imposed by something in front of the store and
  are the only ones that keep the host paste.
- **The row detail is the sentence, not the database enum.** It rendered
  `cause.replace(/_/g, " ")`, so a merchant read "password page" and "bot
  protection" while `crawler-check.server.ts` already held a written sentence
  for each cause. That map moves to `crawler-info.ts`, which is not a `.server`
  module and which both the check and the screen import, so there is one source
  of truth rather than two copies to drift.
- **The crawler card no longer draws fourteen zero rows.** Its empty guard also
  required that no robots.txt control token had been seen, so a shop whose only
  logged requests carried `Google-Extended` got both tables rendered with every
  row reading "0 in 30 days". The guard is now the request total alone, and the
  token block renders under the explanatory sentence when there are tokens.
- **A catalogue where nothing extracts gets sentences, not zero denominators.**
  Reachable on a real shop whose descriptions are images. The weakest-products
  table used to print "0 of 0" in every row with a bare dash for what is
  missing; it is a sentence now. A pass that read no product at all sends the
  families card to the same "read no active, published products" wording the
  readability card already had, instead of "found no kind of detail anywhere in
  0 descriptions".
- **The histogram carries its shape and its numbers.** Single values to nine
  and one "10+" tail put 169 of Republica BIO's 189 products in one bar and
  left ten empty. Buckets are now single values to five - keeping an exact edge
  at the four-family readiness threshold - then 6-7, 8-9, 10-12, 13-15, 16-19
  and 20+, chosen from that catalogue and from a 355-product furniture
  catalogue whose depths all fall between 0 and 4. The counts are printed above
  the bars as well as stated in the `aria-label`, where they used to be only.
- **Both CSV exports start with a UTF-8 byte order mark.** Family names come
  from the merchant's own dictionary and product titles from their own
  catalogue, so Romanian diacritics are the normal case; without the mark Excel
  on Windows opens the file in the system code page and mangles them. The
  content type is unchanged.
- **The reachability check covers AI crawlers only, and the card says so.**
  The six search-engine names in the table are not in `AGENTS`, so their "Can
  it get in" column would have read "not checked" for ever with nothing to
  explain it. They are listed for their request counts, and the card states
  that Search Console and Bing Webmaster Tools answer the reachability
  question from the inside with better evidence than one request of ours.
  `AGENTS` is unchanged, so the check still makes 8 outbound requests and the
  job's duration is unchanged.
- **Every crawler figure carries its window in its own label** ("61 in 30
  days"), and the method line says the dashboard's card uses 7 days. The two
  screens legitimately show different numbers for the same crawler and nothing
  used to say why. The dashboard itself is untouched.
- **A pass refused for want of a subscription is not a failure.** The worker
  writes status "refused" with a reason; the screen gives it its own wording
  and a link to the plans, rather than "The last pass failed".
- **Dates are written out in English in UTC** ("31 August 2026") instead of
  `toLocaleDateString()`, whose output depends on the locale of whichever
  container happened to boot. With no usable timestamp the sentence names no
  date at all rather than printing "an unknown date".
- **Four search-engine crawlers added to `KNOWN_BOTS`**: `bingbot`,
  `Storebot-Google`, `GoogleOther`, `Google-InspectionTool`, in specificity
  order so a looser name never absorbs a more specific one. Checked against
  Google Search Central's crawler list and Bing's own documentation on
  2 September 2026, not from memory. Until now every one of them was grouped
  as "other" and dropped.
- **Robots.txt control tokens are counted apart and never inside a total.**
  `Google-Extended` and `Applebot-Extended` have no user agent of their own,
  so a request carrying one is something else borrowing the name.
  `normalizeBot` now returns "other" for both before the crawler list is
  consulted, which also stops `Applebot-Extended` being counted as a real
  Applebot read, and `nonCrawlerTokenHits()` asks for them separately.
- **The window is 30 days everywhere on the screen**, because
  `CRAWLER_HIT_RETENTION_DAYS` is 30 and a longer one would show deletion as a
  fall in traffic. No control offers a longer one.
- No score history, no verified-versus-unproven split, no "Google AI Mode" or
  "Copilot" line, and no sorting by sales. The crawler card says in as many
  words why the first three cannot be built honestly today, and the last one
  needs order data this app does not ask for.

### Fixed (engine safety wave, 2 September 2026)

Everything in this section is engine or gate work (`PRD-FIX-WAVE-1.md`),
provable without Shopify and measured against the 189 real Republica BIO
products with their own dictionary.

- **A denial was published as a claim.** A plain or prefix term matched with
  no look-behind, so `nu contine gluten` published `Alergeni: contine
  gluten` on 21 of 189 products - the merchant's own text saying the
  opposite of ours. A match is now dropped when a negator stands in the
  three tokens before it, read from the start of the clause. The negator
  list (`nu`, `fara`, `no`, `without`, `free`, and the rest) is per shop: a
  `negators:` line in the dictionary replaces it, `negators+:` adds to it,
  and a keyword line is never read as an attribute family. Two traps had to
  be handled to avoid trading one silent loss for another: a term that opens
  with a negator is not suppressed by its own wording (`fara gluten`), nor
  by the one before it in a list (`fara coloranti, fara arome`), and the
  window ends at the clause, so `ovaz fara gluten, Bio (Avena sativa)` still
  publishes the species.
- **Dotted abbreviations lost everything but the first letter.**
  `notificat de S.N.P.M.A.P.S. 1378/2023` published `notificat de s` on 39
  products and `notificat de m` on 9. A run of single letters each followed
  by a dot is now collapsed into one word before matching (`M.S.` becomes
  `ms`), decimals and domains untouched, and a capture that is nothing but a
  single character is rejected.
- **Decimal and thousands separators were cut out of quantities.** The count
  pattern read only the digits after the separator, so `60 capsule (29,7 g)`
  published `Gramaj: 7 g` and `7.000mg` published `Concentratie: 0 mg`. The
  number now carries its separators exactly as the merchant wrote them, and
  a match can no longer start in the middle of a number.
- **A prefix capture ran past the end of its value.** `produs in Franta per
  portie` was published as one origin on 9 products. The capture now stops
  at a connector once a word has been captured, keeping the part that is a
  value and dropping the part that is prose (DICTIONARY-PORT section 10.1)
  instead of discarding the phrase whole. What survives the truncation has to
  be a value: when one word is left, it is not itself a term, and a plain
  term of the same family stands immediately in front of the label word, the
  capture is dropped. That is the `square neckline finished with delicate
  lace` shape, where the value is written before the label and the rest is
  the sentence carrying on; publishing `neckline finished` would be prose
  where the old code published nothing.
- **One junk signal was enough to overwrite a human alt text.** Any run of
  eight digits counted as machine output, so `Masa extensibila, cod
  20260527, stejar natural` was replaced. A digit run now needs a second
  signal - nothing else in the value that reads as a word. Filenames, UUIDs
  and HTML entities still count on their own; they never appear in a
  sentence a person typed.
- **Two write actions had no entitlement check.** Business info
  (`app.business.tsx`) and the dictionary (`app.dictionary.tsx`) wrote
  without asking whether the shop has access; hiding a screen is not a gate,
  because the form can be posted directly. Both now refuse with the same
  banner the collections screen uses, and nothing already written is
  touched.
- **Two worker tasks had no entitlement check at execution.**
  `bulk_extract` and `bulk_alt_text` trusted the check made where the job
  was enqueued, so a job queued while a shop was paid ran after access was
  gone. Both now check before the catalogue read and record the job as
  `refused`, exactly as `bulk_collections` does: inside the task's `try`,
  after the row is marked `running`, so a throwing Admin call ends as
  `failed` rather than stranding the row.
- **A product's values and its state could land in different calls.**
  Metafield writes were sliced every 24 entries with no regard to product
  boundaries; a failure between the two calls left a value with no
  provenance, which every later pass reads as human and never corrects.
  Slices are now built per product (`sliceByOwner`). A product with more
  fields than one call holds - which no dictionary produces today - is
  chunked rather than emitted as an oversized slice the API would reject,
  and its `state` entry rides in the first chunk. State without its value is
  recomputed on the next pass; a value without its state never is.

Five defects found reviewing the wave, fixed before it shipped:

- **A capture whose first word was one character was discarded.** The rule
  was written for the `S.N.P.M.A.P.S.` remnant, which the dot collapse
  already removes at source, and what it actually deleted was every value a
  letter carries: `vitamina C 1000`, `marime M`, grades. Only a capture that
  is nothing but that one character is rejected now.
- **A family whose label ended in `+` was silently deleted.** The `+` was
  read as proof of a directive on its own, so `Extras+: gift box, engraving`
  vanished from the dictionary without a word. A label is a directive only
  when the keyword before the `+` is one we know; `negators+` still is.
- **A value can carry a comma, and two consumers split on a bare one.**
  Extraction joins values with `", "`, but the comparison table and alt text
  split on `","`, so `Gramaj: 29,7 g, 390 g` became `29`, `7 g` and `390 g`.
  A label then looked like it varied when every product said the same thing,
  the collection summary a crawler reads printed the halves, and alt text
  took `29` as a descriptor. Both consumers now split on the joiner.
- **A negator inside a neighbouring term suppressed the next one.** English
  writes a free-from claim backwards, so in `dairy free and gluten free` the
  first `free` filled the window and only `dairy free` was published. A
  negator that is the tail of a term this dictionary carries belongs to that
  term. `free of gluten` and `nu contine gluten` are unaffected: `produsul
  nu` is no term.
- **Truncation published a prose fragment.** See the prefix capture entry
  above.

Corpus check, the same 189 products before and after:

| | before | after |
|---|---|---|
| products publishing `Alergeni: contine gluten` | 21 | 0 |
| shortest `Notificare` value | `notificat de s` | `notificat de ms` |
| `Gramaj` or `Concentratie` values starting with `0 ` | 3 | 3 |
| total facts | 2587 | 2576 |
| median facts per product | 14 | 13 |

Every remaining `0 ` value is the merchant's own `din care sodiu 0 mg`, not
the `7.000mg` artefact, which is gone. The eleven net facts lost are false
ones: 21 gluten claims the text denies, 21 `de origine animala` on products
that say `fara ingrediente de origine animala`, 8 `prajite` on products that
say `coapte, nu prajite`, and 10 `zaharuri adaugate` on products that say
`fara zaharuri adaugate`. Against them, 31 origins that used to be dropped
whole are now published, and quantities like `29,7 g` and `46,75 g` are
right for the first time. One loss is worth a second opinion: 40 products no
longer publish `Ambalaj: doza` and 15 no longer publish `Portie de
referinta: doza zilnica recomandata`, because their only occurrence sits in
`a nu se depasi doza zilnica recomandata` - a negated instruction, correctly
detected, whose value was arguably worth keeping.

The five corrections above leave every one of those numbers where it was:
2576 facts, median 13, no gluten claim, shortest `Notificare` still
`notificat de ms`, and every label count identical, `Origine geografica`
included. That is the intended result. Four of the five are shapes this
catalogue does not contain - it is Romanian, and it carries no single-letter
values, no `+` label and no postfix free-from claim - and the fifth is
consumer-side, so it never reaches the fact count. Getting there took two
attempts on the truncation rule: keyed on any family it deleted `produs in
italia` on twelve products, because `ecologic` stands before it, and keyed
on wildcard terms it deleted ten more, because the merchant writes `origine
produs in Spania`.

Three further defects, found by re-running the wave and fixed before it
shipped. The corpus numbers above are the state after all three: 2576 facts,
median 13, no gluten claim, `Gramaj`/`Concentratie` values starting with
`0 ` still 3 and still only the merchant's own `din care sodiu 0 mg`,
shortest `Notificare` still `notificat de ms`, and every label count
identical on both catalogues - the 189 Republica BIO products and the 355
furniture products with the default dictionary.

- **A negator that opened the window dropped the next attribute.** The tail
  test started its look-back inside the three-token window, so a negator
  standing first had nothing in front of it and could never be recognised as
  part of a phrase. `Free shipping and email support` published no support
  at all, and every English `Free returns and ...` lost the same way. The
  tail test now reads the whole clause, the window for accepting a negator
  stays at three tokens, and a negator stops reaching forward at a
  coordinator that follows a word belonging to no term of this dictionary -
  the point where the sentence has moved on to a second thing the merchant
  offers. `fara ingrediente de origine animala` and `fara gluten si lactoza`
  are unaffected, because every word between the negator and the match is a
  term word.
- **Truncation revived the connector-led form of a value.** With the capture
  stopping at a connector, `with retinol` came back as a hit, and being
  longer than `retinol` it subsumed it: `Key ingredients: with retinol,
  ceramides` where the clean value had been `retinol, ceramides`. Same shape
  for `contains salmon` over `salmon` and `compatible with ios` over `iOS`,
  which also lost the term's capitals. Two hits differing by nothing but a
  leading connector now resolve to the shorter one.
- **A worker entitlement check could strand its job at `queued`.** The two
  new checks in `bulk_extract` and `bulk_alt_text` ran before the row was
  marked `running` and outside the `try`, and both call the Admin API. An
  expired token, an uninstall, a 429 or a network blip threw there, so once
  graphile-worker gave up retrying the row stayed `queued` for ever - and
  the dashboard refuses every button while a queued row exists, locking the
  merchant out with no explanation. Both checks moved inside the `try`,
  after the `running` update, matching `bulk_collections`.

### Fixed (adversarial QA wave, 1 September 2026)

- **The free-tier product editor was unreachable.** The subscription gate in
  `app.tsx` matched free routes exactly, so `/app/products/:id` redirected a
  free shop to Plans and the gated editor never rendered. `/app/products` is
  now matched as a prefix; the editor's own action keeps enforcing the
  per-product free-tier rules, so the gate widening changes reachability,
  not entitlement (FREE-TIER-SPEC section 5).
- **Diagnostics and theme publishes erased the SEO screen's scan.** Both
  wrote a narrow, product-page-only scan over the ThemeScan detail the SEO
  screen's rich scan owns - permanently deleting the home-page scan, robots
  findings, missingReasons and the weekly watch history, and the webhook
  additionally wrote under a numeric theme id, a second row the SEO loader's
  most-recent read then surfaced. Now: theme ids are normalised to one row
  key (`themeRowKey`), narrow scans merge into the existing detail
  (`mergeNarrowScanIntoDetail`, updating only what they measured), a
  password-walled narrow scan writes nothing, and the SEO and Diagnostics
  loaders pin to the published theme's own row instead of "most recent of
  anything".
- **Pre-migration mirror rows (NULL productId) could leak forever.**
  products/update now adopts a NULL-productId row matching the product's
  current handle (sets productId, so delete and staleness checks work from
  then on), and the weekly sweep deletes NULL-productId rows whose handle no
  longer exists in the catalogue it already reads.
- **The mirror's describedby links pointed at a 404.** The proxy's Link
  header and the storefront block's rel="describedby" both pointed at
  `/llms.txt`; the app serves llms.txt at `/apps/ai-visibility/llms.txt`.
  Both now point there. (Extension change - needs `npx shopify app deploy`.)
- **Bulk withdrawal missed the all-variant-facts case.** A product whose
  facts all moved to variant level (productFacts empty, facts nonempty)
  skipped writeFacts in the bulk pass, so stale product-level auto values
  were never withdrawn while the mirror was refreshed and diverged. The
  write branch now also enters when withdrawable auto values exist.
- Cleanup: the dashboard's product query fetches 10 metafields instead of 5
  (the namespace has more than 5 keys, so `state` could fall off and rows
  misreported); crawler_check derives JobRun total/progress from the agent
  list instead of a hardcoded 5 (there are 8 agents); the sweep's queued
  jobs carry the same `extract:{gid}` jobKey the poll uses, and its comment
  says weekly, matching the cron; the weekly seo_watch resyncs the
  theme_scan shop metafield the storefront block reads; Diagnostics shows
  the latest persisted crawler check on load, so a refresh no longer loses
  the result; refusals are surfaced - Collections shows a refused JobRun
  and the already-running case, the dashboard shows already-running and
  needs-subscription outcomes, the products list explains a full free cap
  and a write that found nothing; the products list no longer says "runs
  when processed" on a processed-but-unpublished product, saying instead
  that it is not published to the Online Store;
  `billing.server.ts`'s counter comment now states the free-product set is
  the sole authority (FREE-TIER-SPEC carries a dated note).
- **CI red on the audit commit: the new test needed environment variables.**
  `extract.server.test.ts` imported `hasWithdrawableAutoValues` from
  `extract.server.ts`, which pulls in `admin.server.ts`, which calls
  `shopifyApp()` at module load and throws on an empty `appUrl`. Locally
  `.env` supplies it and the suite is green; CI has no `.env` and the whole
  file failed to collect. The function moved to `facts.server.ts`, next to
  the state semantics it reads and importable without the Shopify runtime;
  `extract.server.ts` re-exports it, so no call site changed. Verified by
  running the full suite with `.env` removed: 323 tests, 27 files, green.

### Fixed (SEO audit wave, 1 September 2026)

- **The Organization detection oscillated against our own output.** Our own
  Organization node now carries an `@id` ending `#organization`,
  `isOurNodeId` recognises it, and the theme scan excludes our nodes when
  computing `hasOrganizationLd` - the flag now means "the theme emits one".
  Previously scan 1 found no theme node and the block emitted ours, scan 2
  read our node back as the theme's and the block suppressed itself, scan 3
  found none again: weekly flapping, with the seo_watch history filling with
  changes the loop itself produced.
- **The sameAs suppression is reversed (Marius's decision, 1 Sep 2026).**
  When the theme has an id-less Organization node, our node with the
  merchant's official profiles is now published alongside it instead of
  being suppressed to keep the conflict counter at zero. The SEO screen
  reports that pair as informational (never warning or critical), with copy
  explaining the theme's node has no identifier we can attach to and that
  adding an @id to it would merge the two.
- **`itemCondition: NewCondition` was published unconditionally** under
  seo_unlocked - a false factual claim on shops selling refurbished or
  second-hand goods. Removed; there is no merchant-stated condition field to
  derive it from. `priceValidUntil` stays, with a comment recording that it
  is a synthetic, computed date and why that is accepted.
- **writeSeo/revertSeo used the deprecated `productUpdate(input:)` form.**
  Migrated to the documented `productUpdate(product: ProductUpdateInput!)`
  (verified against shopify.dev). Behaviour unchanged: both seo subfields
  are still always sent together, same return handling.
- **WebSite/SearchAction and BreadcrumbList were reported "emitted" purely
  because seo_unlocked was true**, without reading the scanned nodes.
  deriveMissingReasons now reads them from what the scan actually found on
  the home and product pages, with "could not be determined" when the page
  was unreadable - the same pattern hasRating already used.
- **The password unlock could mangle the session cookie.** `set-cookie` was
  read with `headers.get`, which comma-joins multiple cookies; the scan now
  uses `getSetCookie()` and selects the `storefront_digest` cookie
  explicitly, with the old form only as a fallback.
- **Products list read `metafields(first: 6)`** while every other reader
  uses 10 - one more key written by anyone would push `state` out of the
  window and make the Meta column read "Outside app" over our own writes.
  Aligned to 10. The product editor also now renders `actionData.error` as a
  critical banner; refusal errors from its action were previously invisible.

Previous unreleased notes follow.

Six data-integrity and privacy fixes from an audit of the mirror, the
webhooks and the retention promise. All verified against the code and, where
testable without a live store, covered by unit tests.

### Fixed

- **Draft and unpublished products were published to the public mirror and
  llms.txt.** The bulk fetch now filters to `status:active AND
  published_status:published`; the single-product fetch path (webhooks) now
  checks `status` and `onlineStoreUrl` before caching a mirror row or
  indexing the product. Facts and the capsule fields are still written to
  metafields either way - they render nowhere on a draft and are harmless
  there. `isEligibleForMirror` in `facts.server.ts` is the shared decision.
- **Deleted products kept a live public mirror forever.** The products/delete
  webhook read `payload.handle`, which that payload never carries (it carries
  only the numeric `id`). MirrorCache gained a `productId` column
  (hand-written migration `20260901120000_mirror_cache_product_id`); deletion
  now matches on the product GID built from that id.
- **A product's mirror row was never dropped on rename.** If a cached row's
  handle no longer matches the product's current handle, or the product left
  the published state, it is deleted on the next products/update pass
  (`dropStaleMirror` in `extract.server.ts`).
- **The webhook extraction path never withdrew stale output.** It returned
  before calling `writeFacts` whenever a re-extraction came back empty, so a
  description edited down to nothing kept its old facts, summary, questions
  and mirror live indefinitely. It now always calls `writeFacts`, which
  withdraws previously auto-written values and leaves human-written ones
  untouched.
- **Bulk alt text rewrote every unchanged image on every run.** `writeAltText`
  now skips the update when the generated alt text equals the existing value,
  matching the same self-feed guard the metafield writer already has.
- **CrawlerHit rows were never pruned.** PRIVACY.md promises 30 days; a daily
  worker task (`prune_crawler_hits`) now deletes rows past that cutoff. The
  cutoff arithmetic lives in `retention.ts`, pure and unit tested.
- **`shop/redact` did not delete CrawlerHit.** It is keyed by the shop domain
  string with no foreign key to `Shop`, so the cascade never reached it; the
  handler now deletes it explicitly, and its comment no longer claims
  coverage it did not have.
- **The proxy's canonical and describedby links, and IndexNow submissions,
  used the myshopify.com domain.** Both now use the store's primary domain,
  read from the persisted `shopInfo` Setting row, with `session.shop` as the
  fallback when no row exists yet.

Six further entitlement and pipeline fixes, from the same standing rule as
above: a limit checked only where a route starts is not enforced, because a
Remix action or a worker task can be reached without its parent loader ever
running.

- **Collections had no billing gate at all.** `app.collections.tsx`'s action
  enqueued `bulk_collections` for any authenticated shop; the worker task had
  no check either. Both now require `hasPaidAccess` / `mayProcessAutomatically`
  - the action before enqueueing, the task again before it starts (queued
  jobs from before a shop's access changed are refused too). Nothing already
  built is touched by the refusal.
- **Only the SEO intents were gated on the product editor.** `capsule`,
  `capsule_reset`, `reset`, `alt` and the facts save in
  `app.products.$id.tsx` wrote for any authenticated shop regardless of
  subscription. FREE-TIER-SPEC §2 calls the three free products "the real
  write," fully editable, so the new gate allows these intents when the shop
  has paid access or the product is one of the shop's (at most three) free
  products, and refuses everything else. `app.business.tsx` and
  `app.dictionary.tsx` were checked and left ungated on purpose - they are
  configuration, not processing volume.
- **A cancelled shop kept webhook extraction forever.**
  `mayProcessAutomaticallyCached` reads `Shop.plan`, refreshed only when a
  merchant opens the app; a shop that cancels and never returns kept its last
  cached plan indefinitely, so every `products/update` webhook still ran a
  full paid extraction. A new `app_subscriptions/update` webhook handler
  (topic verified against shopify.dev, 2026-07 API version) now records the
  plan change - `none` on anything but `ACTIVE`, a fresh live read on
  `ACTIVE` - as soon as Shopify reports it. Requires `npx shopify app deploy`
  to take effect (new webhook subscription in `shopify.app.toml`).
- **The free-tier cap counted writes, not products, and could race.** Two
  overlapping submissions could both pass a check-then-increment counter, and
  reprocessing one of the three chosen products consumed a second slot. The
  counter is replaced by a Setting row holding the chosen product GIDs (no
  migration needed); membership is what is free, the set's size is the cap,
  and adding to it runs inside a serializable transaction so two overlapping
  submissions cannot land four products. `Shop.freeProductsUsed` is kept in
  sync for the existing dashboard display but is no longer the authority.
- **A full re-run over an emptied-out product skipped withdrawal in the bulk
  pass.** `runBulkExtract` guarded its write branch with `facts.length > 0`,
  so the same bug just fixed on the webhook path was still live on the bulk
  pass: a description edited down to nothing kept its stale facts, summary,
  questions and fit_for. It now also enters when the product has previously
  written auto values to withdraw, checked from metafields already fetched
  in the bulk export (no new Admin API reads).
- **Webhook-enqueued extraction jobs had no jobKey.** `products/create` and
  `products/update` now pass the same `extract:${productGid}` jobKey
  `poll_changes` already used, so a burst of updates to one product collapses
  to one queued job instead of duplicating.

## Version 20 - 1 September 2026

Released as `ai-visibility-all-in-one-20`. The whole of the SEO capability
landed across 31 August and 1 September: the operator unlock, the workspace,
the meta title and description writer with its bulk review-and-apply queue,
the product editor card, the extra structured data, and the fixes from a
two-reviewer audit of all of it. Versions 15 to 19 were same-day deploys of
the work described here; this heading covers them.

This entry includes extension changes (three fixes to
`extensions/ai-visibility/blocks/ai-visibility.liquid` and
`app/engine/meta.ts`, see below) and therefore requires
`npx shopify app deploy` in addition to the usual server-side push to main.
Everything above this note in the section is server-only, as before.

### Added
- New `/app/seo` screen, gated on the existing `seo_unlocked` Setting flag
  (same mechanism as the operator-only structured-data properties in the
  storefront block). Gated at every path that reaches it: the loader refuses
  and shows an unlocked state, the action refuses independently so a posted
  form cannot bypass the loader, the nav link only renders when unlocked, and
  the scheduled weekly job checks the same flag before it runs. A shop
  without the flag never reaches a scan, an audit query, or a job.
- `theme-scan.server.ts` now scans both a published product page and the home
  page and reports every JSON-LD node found, `@graph` nesting flattened,
  instead of only detecting a Product node. Reports repeated top-level types
  on one page as a conflict, naming our own block as a source when one of the
  repeated nodes carries the `#product` or `#collection` id we set, and
  saying "unknown" rather than guessing when the other source cannot be
  identified.
- `deriveMissingReasons` (`theme-scan.server.ts`): for every node type the
  extension can emit, says whether it is emitted and, when not, the real
  reason read from the Liquid conditions - embed inactive, extend mode with
  nothing to add, no return window on Business, no review app's rating
  metafields, no collection questions yet - each pointing at the screen
  where it is fixed.
- `seo-watch.ts`: pure diff between this week's and last week's theme scan,
  reporting node types that were present and are now gone, with a dated
  line. New `seo_watch` worker task (worker/tasks.ts, worker/index.ts),
  scheduled weekly, gated on `seo_unlocked` and on the same
  `mayProcessAutomatically` check `poll_changes` and `sweep_missing` already
  use - an unpaid shop is not scanned. Reuses the existing `ThemeScan` table
  (its `detail` Json column already fits the wider scan shape); no migration.
- Fixed a false negative: `deriveMissingReasons` was called with `hasRating`
  and `hasCollectionQuestions` hardcoded to `false`, so a merchant with real
  reviews saw AggregateRating reported as missing. AggregateRating is nested
  inside the Product node rather than a top-level node on this platform, so
  `extractLdNodes` now flags `hasAggregateRating` on a Product node when its
  own `aggregateRating` property is present, and `scanThemeForProductLd` /
  `scanStorefront` surface that as `hasAggregateRating` / `hasFAQPage` on the
  scan result - read from what the page actually renders, not guessed. When
  the page could not be read at all (password wall), the reason is now
  "could not be determined" rather than a false claim of absence.
- `/app/seo` restructured into one nav entry with five tabs (Overview,
  Published schema, Conflicts, Meta fields, Crawl), addressed by a `?tab=`
  query parameter on the same route rather than nested route files - every
  tab reads the same persisted `ThemeScan` row and the same meta-field audit
  query, so a nested route per tab would duplicate both without adding a
  distinct URL segment worth the extra entitlement surface. The action now
  redirects back to the same tab after a scan instead of returning
  `actionData`, so every tab reflects the fresh scan through the loader
  rather than only the tab the form was submitted from.
- New Crawl tab: robots.txt as served by the storefront, whether either
  scanned page's Disallow rules would block it, whether each scanned page
  carries a canonical tag and what it points to, and whether either page
  carries a `noindex` robots meta tag (stated first, as a critical banner,
  when found). Read-only, same pattern as Diagnostics: no app can rewrite
  robots.txt.liquid. `theme-scan.server.ts` gained `extractCanonical`,
  `extractNoindex` and `fetchRobotsCheck`; all three run during the scan
  already in progress, so the tab costs one extra request (robots.txt) per
  scan, not a new fetch per page view.
- Server changes only in this entry too - no extension changes.
  Nothing is auto-fixed and nothing is written to the store.
- `catalogue.server.ts`: added `seo { title description }` to both the
  single-product and bulk product queries, and to `ProductInput`
  (`facts.server.ts`). Read-only - confirmed the bulk export flattens `seo`
  inline on the product row, the same as `priceRangeV2`, since it is a plain
  object field rather than a connection. Backs the SEO screen's meta title
  and meta description audit table; the app never writes these fields.
- SEO-WORKSPACE-PRD build order steps 1-2: `app/engine/meta.ts`
  (`buildMetaTitle`, `buildMetaDescription`), pure and tested, condensing the
  product's own title/description/facts the same way `buildSummary` does;
  price and availability excluded on purpose since a meta description is
  cached by search engines. New `app/services/seo.server.ts` writer for
  `Product.seo.title` / `Product.seo.description` (Shopify's own fields, not
  `$app` metafields): provenance under two new `state` keys, `seo_title` and
  `seo_description`, reusing the existing human-protection rule
  (`mayWriteSeo`); a `prev` field captured only on the first write supports
  an exact revert (`revertSeo`), distinct from resetting to automatic; the
  `productUpdate` mutation always sends both `seo.title` and `seo.description`
  together, filling the untouched one with its current live value, because
  the single-subfield behaviour is undocumented (§3.1, §9). New "Search
  listing (meta title and description)" card in `app.products.$id.tsx`,
  mirroring the existing summary card: Generate (fills the field without
  writing), Save (marks human when edited, auto when untouched), Revert to
  before the app (shown only when a prior value was captured), character
  counts. Gated on `seo_unlocked` in both the loader and the action - a
  posted form cannot bypass a hidden card. Bulk queue, full-catalogue audit,
  Products index column and handover export are PRD steps 3-6 and are not
  built yet.
- SEO-WORKSPACE-PRD §3.5: the review-and-apply bulk queue on `/app/seo`,
  replacing the old read-only "Meta fields" tab (deleted per §5 - its "we
  never write them" sentence was no longer true). `buildSeoQueue`
  (`app/services/seo.server.ts`) is a pure function: given the catalogue and
  the shop name, it proposes a meta title and/or description only for a
  field that is both empty and not protected (`mayWriteSeo`), using the same
  `buildMetaTitle`/`buildMetaDescription` the product editor card calls, so
  the two surfaces never disagree. A product already carrying an earlier
  automatic value is left out of the queue entirely - regenerating it is the
  product editor's own "Generate" button, not a silent bulk rewrite. Fields
  left empty on purpose (state says human) surface in a separate collapsed
  "protected" list with the reason, never silently dropped; a non-empty
  field with no state entry ("set outside this app") is counted in the
  coverage line and never proposed.

  New `app/services/seo-bulk.server.ts` (I/O): `runSeoQueueBuild` reads the
  whole catalogue through the existing `fetchAllProducts` bulk export and
  calls `buildSeoQueue`, writing nothing; `runSeoApply` re-reads each
  approved product immediately before writing (`fetchProduct`, one Admin
  API call per product) because the queue snapshot can be minutes old and
  the write-time `mayWrite`/unchanged check must win, then writes through
  the existing `writeSeo`. New worker tasks `seo_queue_build` and
  `seo_apply` (`worker/tasks.ts`, registered in `worker/index.ts`), following
  `bulk_extract`'s JobRun progress pattern; `seo_apply` advances the poll
  cursor after a run that wrote anything, the same self-feed guard
  `bulk_extract` and `bulk_alt_text` already use. No scheduled job ever
  calls `seo_apply` - it only runs from an explicit operator "Apply"
  submission, never automatically.

  Sequential single mutations, not `bulkOperationRunMutation`: `productUpdate`
  has no bulk form for distinct per-product values, the write-time re-check
  needs a synchronous read immediately before each write (which a staged
  bulk mutation cannot do), and only one bulk operation may run per shop at a
  time, which would otherwise serialize against the read-side bulk export
  this same feature depends on. The existing throttled admin client
  (`admin.server.ts`) already paces every call off Shopify's returned cost
  budget - the same protection every other bulk writer in this app relies
  on, not a new mechanism.

  ENTITLEMENT: `seo_unlocked` is checked in the `/app/seo` loader (existing),
  the action (existing, now covers the two new intents since the check runs
  before intent dispatch), `seo_queue_build` (refuses before the bulk export
  starts), and `runSeoApply` inside `seo_apply` (refuses before its first
  read or write) - a job queued while unlocked but executed after the key is
  removed touches nothing and the JobRun report says why (`status: "refused"`).
  New pure-function tests in `app/services/__tests__/seo-queue.server.test.ts`.
- `/app/seo` rebuilt a fourth time, replacing the five-tab structure recorded
  above: three earlier attempts read as a diagnostics report with nothing to
  press ("pare ca nu am ce sa fac aici"). The screen now mirrors
  `app._index.tsx` - a metric row, then action cards - and `Tabs` is gone from
  the file entirely.
  - Metric row: products with a meta description, products with a meta
    title (both from the last "Write the missing search listings" preview),
    distinct schema node types published and conflict count (both from the
    last scan). A count never prints as a bare zero: an un-previewed catalogue
    says "Not checked yet", an un-scanned or password-walled storefront says
    "Not scanned yet" / "Could not be read" instead of 0.
  - "Write the missing search listings" card: the existing bulk queue
    (`seo-bulk.server.ts`, unchanged) reshaped into the dashboard's
    preview/primary button pair - Preview builds the queue read-only, the
    primary button is labelled with the real selected count ("Write N
    listings") and stays disabled until a preview has produced rows to
    review. The per-row checkboxes, select all/clear all, pagination and the
    protected-fields disclosure are unchanged from the prior build.
  - New "What your descriptions say that your titles do not" card:
    `app/engine/term-gap.ts` (`computeTermGap`, pure, tested), terms found in
    a product's description that appear in no product title and no meta
    field anywhere in the catalogue. Supports two-word phrases as well as
    single words (bounded to adjacent-pair bigrams, one candidate per text
    position, no combinatorial expansion) because a preposition often carries
    the meaning in this catalogue's language ("fara gluten"); a bigram is
    kept unless both words are stopwords, so "fara gluten" survives even
    though "fara" alone is a stopword. Not a keyword tool: no search volume,
    no ranking data, no recommendation - every row states only what was
    counted ("used in N descriptions, in no title and no meta field").
    Computed inside `buildSeoQueue` from the same catalogue read the listings
    queue already does, so it costs no second bulk fetch; `SeoQueue` gained a
    `termGap` field and `buildSeoQueue` now takes a `stopwords` argument.
  - "What we found to fix" card: the existing scan, conflicts and
    missing-reasons findings recomposed into one severity-ordered list
    (critical: noindex, robots.txt disallow; warning: node-type conflicts,
    real gaps; info: gaps that could not be determined because the scan
    failed) instead of separate tabs, each line naming where it is fixed and
    linking there. "Scan now" moved into this card's header, matching the AI
    dashboard's crawler-check card. A failed or absent scan shows no
    findings and says why, rather than an empty list reading as "nothing
    wrong".
  - The former Overview/Published schema/Conflicts/Crawl tabs are now one
    "Full scan detail" disclosure (Polaris `Collapsible`, closed by default)
    at the bottom of the screen - the fuller detail stays reachable, but is
    no longer the page's primary structure.
  - New tests: `app/engine/__tests__/term-gap.test.ts` (a term in
    descriptions only, a term already in a title, a term only in a meta
    field, a stopword that must never appear, an empty catalogue, phrase
    survival, and ranking by product count).
- Storefront password: `scanStorefront`/`scanPage` already knew how to sign
  in through a store's password page, but nothing ever wrote the `Setting`
  row they read it from, so every scan on a password-protected store reported
  the password wall. `/app/seo` now has a "Storefront password" card - a
  password-type field with no default value (never renders a saved value
  back, only whether one is saved), a save action and a clear action, both
  writing the same `storefront_password` Setting row the readers already
  used. Diagnostics does not get its own field; when its last scan hit the
  password wall it links to the SEO screen instead, so the credential has one
  writer. Gated behind `seo_unlocked` because the field lives on the
  entitlement-gated `/app/seo` route.
- Products list: a "Meta" column, gated on `seo_unlocked` (absent from the
  headings and the row cells entirely when off, and the loader does not fetch
  `Product.seo` for a locked shop either - two separate query strings,
  chosen before the request is made). States: Auto (written by this app),
  Yours (written by a person, protected), Outside app (a non-empty value
  with no state entry - set by the merchant, an import, or another app), and
  Missing (empty, with what has to happen to fix it, never a bare dash). When
  title and description disagree - a human title with an empty description,
  the case that must never collapse into one label - the cell reports each
  field separately instead of picking one. New filter, "Missing meta fields".
  Classification (`classifyMetaField`, `metaColumnState`) lives in
  `seo.server.ts` next to `mayWriteSeo`, which it reuses the same state read
  from; the labels, the disagreement rule and the filter predicate
  (`metaColumnLabel`, `metaColumnMissing`, `META_FIELD_LABEL`) were split into
  a new `app/services/meta-column.ts` with no `.server` suffix, because the
  products list component needs them too and a value import from a `.server`
  module used outside loader/action fails the client build (the fourth time
  this exact failure has hit this repo - see CLAUDE.md). New tests in
  `seo.server.test.ts`: both fields auto, both empty, a human title with an
  empty description, and a value set outside the app.
- Three fixes found reading a live storefront's page source, 31 Aug 2026.
  **Extension change - requires `shopify app deploy`.**
  - Product pages now emit `FAQPage` from the product's own `questions`
    metafield (the app's headline output - already reaching the plain text
    mirror and llms.txt, never structured data until now), same shape and
    escaping as the existing collection `FAQPage`, nothing published when
    there are no questions. Google removed FAQ rich results for every site
    on 7 May 2026; this is read by assistants, not for a search-result
    appearance, and no user-facing string may imply one.
  - `buildMetaTitle` (`app/engine/meta.ts`) no longer appends the vendor or
    the shop name. It used to append " - Vendor" whenever the combined
    length fit; Shopify themes then append the shop name to whatever
    `seo.title` is written, unconditionally and undetectably from the
    engine, so the two together doubled the brand in the rendered title
    ("Viborg Bathroom Shelf with Mirror - Nordwood - MRDigital-dev").
    Shortening the suffix or skipping it only when the vendor already
    appears in the title were both considered and rejected - neither would
    have prevented the observed case. `buildMetaTitle` now returns only the
    condensed, truncated product title. New tests cover a vendor already
    present in the title and a vendor that would have exceeded the length
    target - the vendor is not appended in either case, or any other.
    **Migration**: about fifty meta titles were already written to a live
    store under the old rule. This change does not touch them and no
    migration runs automatically. To bring an already-written auto title in
    line with the new rule, the operator regenerates it: on `/app/seo`,
    "Write the missing search listings" only proposes titles that are empty,
    so it will not touch these; a title carrying an old-rule `- Vendor` tail
    is not "missing", it is a live value with a `state` entry marked `auto`.
    It has to be cleared first (Revert, or manually blank the field) before
    the queue will offer a fresh one, or regenerated one at a time from the
    product editor's own "Generate" button, which always overwrites an
    `auto` value. Titles a human already edited (`state` marked `human`) are
    never touched by either path, per the existing protection rule.
  - The storefront block's Organization node no longer duplicates a theme's
    own Organization node when that theme node has no `@id` for us to
    extend (name and url present, no id - seen on a live storefront, 31 Aug
    2026). `theme-scan.server.ts` already mirrors `hasOrganizationLd` to a
    shop metafield the block can read at render time; the block now checks
    it and, in exactly this case, publishes nothing rather than a second
    top-level node of `@type` `Organization` - the same conflict the SEO
    screen's own scan flags. A `sameAs`-only node (no name, no url) was
    considered and rejected: it is still a second node of the same `@type`,
    so the conflict count is unchanged. Cost: on a shop whose theme emits an
    unreferenceable Organization node, the merchant's `sameAs` social
    profile URLs do not appear in this page's structured data at all, until
    the theme's own node gets an `@id`. No option here was clean; this is
    the least-bad one, not a fix that removes the cost.

### Fixed
- The `/app/seo` review-and-apply queue kept showing pre-write proposals
  after an apply had already written them, caught on the live screen 1 Sep
  2026 (not by any test): the apply result correctly read "Written: 0, left
  alone (protected): 0, already matched: 100" on a store where every field
  was in fact written, but the review table below still listed all 50
  products with both fields ticked and labelled "Meta title - not set", and
  the four dashboard tiles still read "Meta titles 0 of 50" - both read
  straight off the `seo_queue` JobRun's report from when the queue was
  built, with nothing to say a completed apply had since made it false.
  Root cause: the tiles and the row table both trusted a queue's report as
  current for as long as its status stayed "done", and nothing ever moved a
  queue off "done" once an apply consumed it.
  Fix: `worker/tasks.ts`'s `seo_apply` task now marks the exact `seo_queue`
  JobRun it was reviewed against (its id travels with the apply form as
  `queueJobId`) as `status: "stale"` the moment the apply finishes without
  being refused - on success and on failure, since `writeSeo` runs one
  product at a time and a thrown error can follow partial writes; not on
  refusal, since a refused run touches nothing and the queue's numbers still
  hold. `app/services/seo-queue-metrics.ts` (new, pure, no ".server" suffix
  so the client component can import it) is now the one place that decides
  whether a queue's report may be shown as current: only `status: "done"`
  qualifies. A stale queue shows no rows (so nothing offers to rewrite an
  already-written field) and its tiles read "Recheck needed" with the date
  of the last valid check, instead of a number known to be wrong. The
  `seo_apply` action route also refuses to run against a `queueJobId` that
  is not `status: "done"`, closing the same-tab-race case where a click
  lands between an earlier apply's write and this page's next revalidation.
  Considered and rejected: rebuilding the queue automatically after every
  apply, which would re-read the whole catalogue and is not free on a large
  shop - marking the JobRun stale costs nothing and the operator chooses
  when to pay for a fresh read by pressing Preview again.
  Added `app/services/__tests__/seo-queue-metrics.test.ts` covering the
  derivation of the tile figures and the usable/stale predicates as pure
  functions, including the exact regression case (a stale queue reporting
  0 of 50 must not render as "0 of 50").
- Seven findings from two independent audits of the SEO capability, 1 Sep 2026.
  - **Conflict detection counted a merging node as a conflict.** `detectConflicts`
    (`theme-scan.server.ts`) grouped JSON-LD nodes by `@type` alone, so Extend
    mode - which deliberately emits a Product node sharing the theme's own
    `@id` so the two merge into one node - fired a false conflict on
    essentially every processed product on any theme that emits its own
    Product node, and the screen told the merchant to switch to Extend mode
    while already in it. Fix: nodes that resolve to the same `@id` now merge
    into one entity before counting; an id-less node never merges with
    anything, including another id-less node of the same type, since two
    unidentifiable nodes cannot be proven the same. New `canonicalNodeId`
    resolves a relative `@id` (the theme's own form, e.g. `/products/x#product`)
    against the absolute form of the same address (ours) using the scanned
    page's own URL, per IRI resolution rules - both call sites now pass the
    product/home page URL through. Without a known page URL a relative id is
    left unresolved rather than guessed at, so two differently-shaped ids that
    might be the same node are reported as a possible conflict instead of
    silently merged - an unearned merge would hide a real duplicate, the worse
    failure of the two. New tests in `theme-scan.server.test.ts` cover all five
    id shapes: same absolute id, relative-vs-absolute (merges), no pageUrl
    known (does not merge), both nodes id-less, one id-less, and two different
    ids.
  - **Subscription was not checked on the SEO write paths.** The parent
    loader's subscription gate (`app.tsx`) does not run before a child route's
    action in Remix, so `app.seo.tsx`'s action and `app.products.$id.tsx`'s
    seo intents, plus the `seo_queue_build` and `seo_apply` worker tasks, only
    ever checked `seo_unlocked` - a shop that was unlocked but had no active
    subscription could still run the bulk pass and the per-product write.
    Marius's ruling: both entitlements must hold. Added `hasPaidAccess`
    (already existing, live-checked) alongside `isSeoUnlocked` on every write
    path: `app.seo.tsx`'s action for the `seo_build_queue` and `seo_apply`
    intents, `app.products.$id.tsx`'s action for the `seo`/`seo_revert`/
    `seo_reset` intents (both routes already had `admin.graphql` at hand), and
    `mayProcessAutomatically` in the `seo_queue_build` and `seo_apply` worker
    tasks (mirroring `poll_changes`/`sweep_missing`'s shape) plus inside
    `runSeoApply` itself, which already re-checks `isSeoUnlocked` at execution
    time. `SeoApplyReport` gained a `reason` field so a refusal states its
    actual cause (module off vs. no subscription) instead of a hardcoded
    string. Read paths (loaders, the scan) are unchanged.
  - **`seo_unlocked` could be granted but never revoked.** New
    `revokeSeoUnlock` (`billing.server.ts`), same shape as `grantSeoUnlock` -
    deletes the `Setting` row rather than writing a falsy value. New
    `seo_revoke` intent on `/app/plans`, same discreet spot as the grant form:
    when unlocked, the screen now shows "Setup code applied." with a plain
    "Revoke" button instead of the code entry field. Both grant and revoke
    call `syncSeoUnlockMetafield` afterwards, so its doc comment no longer
    claims to have only one caller.
  - **"Set outside this app" folded in the merchant's own edits.**
    `buildSeoQueue` counted any non-empty, unwritable field as `outsideApp`,
    conflating a value with no state entry (genuinely set elsewhere) with a
    value the merchant edited by hand inside this app's own editor (labelled
    "Edited by you" everywhere else). Split into `outsideApp` and a new
    `editedByYou` count, both reusing `classifyMetaField` instead of a second
    classification. The workspace sentence now reads "N fields set outside
    this app; M fields edited by you here; neither is ever touched by a bulk
    pass." New tests in `seo-queue.server.test.ts`.
  - **The product editor's source badge could lie.** `seoSource`
    (`app.products.$id.tsx`) returned the state entry's source without
    checking whether the live value was actually present, so a field this app
    once wrote that was later cleared outside it (Shopify's native
    search-listing editor, an import) still showed "Edited by you" or
    "Automatic" over a blank, and (for a stale "human" entry) a disabled
    field, with the empty-field guidance never showing because it was gated on
    a "missing" state the stale entry never returned. Fix: the badge now uses
    `classifyMetaField`, reordered to check the live value before the state
    entry (a live empty value now reads "missing" regardless of what the state
    entry says - covered by new `classifyMetaField` tests in
    `seo.server.test.ts`). `titleCanWrite`/`descriptionCanWrite` in the loader
    now also allow writing whenever the live field is empty, on top of
    `mayWriteSeo`'s stricter bulk-pass rule, so Generate is reachable in the
    per-product editor regardless of a stale marker; the action applies the
    matching change with `clearSeoHumanFlag` (drops the human flag, keeps
    `prev`) before writing, so Save actually succeeds rather than silently
    skipping, and a genuine pre-app value still survives for revert. This
    widening is scoped to the per-product editor only - `mayWriteSeo` itself,
    and therefore the bulk queue's "left blank on purpose" protection, is
    unchanged.
  - **A second, newer queue could be shown as current after an apply.**
    `invalidateQueue` (`worker/tasks.ts`) marked only the exact `seo_queue`
    JobRun named by the apply's `queueJobId` as stale. Applying against an
    older queue left a newer queue - built before the same write, from a
    second "Preview" or an earlier unsubmitted re-preview - still `status:
    "done"`, and the loader always reads the shop's most-recently-created
    queue, so that newer-but-still-wrong queue was rendered as current: the
    exact "0 of 50 with rows offering to rewrite already-written fields" bug
    this table's own staleness mechanism exists to prevent. Fix:
    `invalidateQueue` now marks every `status: "done"` `seo_queue` JobRun for
    the shop stale, not only the reviewed one - deliberately over-invalidating
    (an extra "Press Preview again") rather than under-invalidating (a number
    known to be wrong shown as current).
  - Four plain-character fixes (ellipsis character, curly quotes): two in
    `app._index.tsx`, one in `app.dictionary.tsx`, one in
    `app.products.$id.tsx`; a fifth found by a repo-wide grep in
    `crawler-check.server.ts`'s "unreachable" cause text (em dash).

## Version 14 - 31 August 2026

Released as `ai-visibility-all-in-one-14`. Server changes in this entry went
live earlier the same day through CI; the extension changes required
`shopify app deploy`, which is what created this version.

### Tooling
- `scripts/check-liquid.mjs`, wired into `check.bat` after the build. Extension
  Liquid is parsed nowhere but `shopify app deploy`, so a syntax error there
  surfaces at release time with typecheck, tests and build all green. The
  first release of the SEO additions failed exactly that way: a literal brace
  inside a `{{ ... }}` output tag ends the tag early in Liquid's lexer, and
  Shopify rejected the bundle with "not properly terminated". Theme check does
  not catch it - run against the offending file it reports no offenses, which
  was verified rather than assumed. The script checks that one thing and says
  so; it is not a Liquid parser.

### Fixed
- The free-tier cap (FREE-TIER-SPEC §3-4: three merchant-chosen products,
  automatic freshness excluded) was enforced only at the `/app` route
  entrance, never in the background pipeline. `poll_changes` (every 15
  minutes), `sweep_missing` (daily) and the `products/create`/`products/update`
  webhooks all queued `extract_product` for every changed or missing product
  on every installed shop regardless of plan, so an unsubscribed shop's whole
  catalogue was processed automatically within a day or two, and a shop that
  cancelled but stayed installed kept being refreshed forever for free.
  Fixed with one authority in `billing.server.ts`, in two forms because the
  cost differs by orders of magnitude: `mayProcessAutomatically(shop,
  graphql)` is the authoritative, Shopify-backed check (comped or an active
  subscription), called once per shop per pass in `poll_changes` and
  `sweep_missing` before any job is queued - an unsubscribed shop is skipped
  before the catalogue is even read, and the poll cursor is left unadvanced
  so the window is picked back up correctly if the shop later subscribes.
  `mayProcessAutomaticallyCached(shop)` is the cheap backstop (the `comped`
  Setting row plus the cached `Shop.plan` column, no Admin API call), run
  inside `extract_product` itself - the single choke point every automatic
  path funnels through - to catch the webhook path (which has no loop to
  gate) and anything already queued before a shop's access changed. Skips
  are logged once per shop per pass, naming the shop and the reason. Nothing
  written by a prior pass is touched or withdrawn; the shop simply stops
  receiving new automatic writes. The explicit "process this product" action
  on the Products screen (the free tier itself) calls `extractOneProduct`
  directly from the route action, never through the job queue, so it is
  unaffected. `bulk_extract` and `bulk_alt_text` were checked separately and
  were already gated correctly: their route action (`app._index.tsx`) calls
  `hasPaidAccess` before enqueueing either job.
  Tests added in `app/services/__tests__/billing.server.test.ts`.
- `llms.txt` and `agents.md` now publish the official profile URLs from the
  Business screen, matching the per-product mirror's `## Store` section -
  previously the same information was published inconsistently across the
  two. `renderLlmsTxt`'s `business` field is now typed as `BusinessRecord`
  (which carries `socialProfiles`) instead of `BusinessInfo`, so the profiles
  flow through without a cast.
- The shop name in `llms.txt`/`agents.md` no longer depends on a mirror
  happening to carry a `## Store` section first - it silently fell back to
  the domain slug (e.g. `mrdigital-dev`) for any shop whose mirrors predated
  that section. `fetchShopInfo()`'s result is now persisted to a `Setting`
  row (`shopInfo`, same per-shop key/value pattern as `business.server.ts`)
  every time extraction runs (`catalogue.server.ts` `saveShopInfo`), and
  `llmsTxtBody` reads that row instead of parsing `MirrorCache.body`.
  `storeNameFromBody` is removed. The Admin API is still never called on the
  request path. `llms-txt.server.ts` reads the row itself rather than
  importing `catalogue.server.ts`'s read helper: that module value-imports
  `admin.server.ts` for the bulk-export helpers, which loads
  `shopify.server.ts` and constructs a real `PrismaSessionStorage` at import
  time - too heavy to drag into a request-path module that is unit tested
  directly, so the "shopInfo" key is duplicated the same way
  `business.server.ts` keeps its own private key rather than sharing one. The
  mirror's own `## Store` section keeps using the `ShopInfo` already fetched
  for the current extraction pass rather than reading the Setting row back -
  it is the same value being persisted, so re-reading it inside the same pass
  would be redundant.
- Product mirrors now publish which collections a product belongs to - the
  relationship the merchant already declared, not a recommendation.
  `collections(first: 5)` (handle, title) added to both the single-product
  and bulk catalogue queries (`catalogue.server.ts`); the bulk query flattens
  it into its own JSONL rows the same way it already does for variants,
  joined back to the parent product by `__parentId`. Rendered as a
  `## Part of` section linking each collection's title to its storefront
  page (`https://<shop-domain>/collections/<handle>`) - collections have no
  mirror of their own, so nothing links to a mirror URL that does not exist.
  Publishes nothing when the product is in no collection.

Tests extended in `app/services/__tests__/mirror.server.test.ts` and
`app/services/__tests__/llms-txt.server.test.ts`.

### Added
- Crawler hits surfaced (`CRAWLER-HITS-SPEC.md` Phase 2, `EXPERIENCE-PRD.md`
  §2, §6, §7): the `CrawlerHit` table has been logging real app-proxy
  requests for three weeks with nothing to show for it. `crawler-hits.server.ts`
  adds two read-only aggregations - a 7-day per-bot count for the dashboard,
  and a fuller 50-row table for Diagnostics - both querying `CrawlerHit` by
  the shop *domain* string, which is what `shopId` holds on that table, not
  `Shop.id`. Both screens state explicitly that these are requests to the
  plain text mirror and llms.txt through our proxy, never visits to the
  themed storefront, which Shopify serves directly and we do not see. A miss
  (non-200) never inflates the dashboard count; Diagnostics shows every
  status. The Diagnostics crawler access card and the new hits table now
  distinguish "can read" from "did read" in one sentence. No new table, no
  new column, no change to logging. Tests in
  `app/services/__tests__/crawler-hits.server.test.ts`.
- `llms.txt` and `agents.md` (`EXPERIENCE-PRD.md` §8), served through the app
  proxy alongside the mirror. Both generated per request from `MirrorCache`
  and the Business setting - shop name, storefront URL, the commercial facts
  where filled, and an index of every processed product's title and mirror
  URL - never written to a file on a schedule, unlike every competitor in
  `BATTLECARDS.md`. No Admin API call on this path: the shop name and each
  product's title and URL are read back out of `MirrorCache.body`'s own front
  matter and Store section. Both paths serve identical content; the
  community conventions for the two filenames describe the same kind of
  plain-text index and neither specifies a divergent structure, so one
  renderer (`llms-txt.server.ts`) backs both rather than inventing a
  difference that does not exist. Linked from a new Diagnostics card. Tests
  in `app/services/__tests__/llms-txt.server.test.ts`.
- SEO unlock (`BILLING-SPEC.md` §5.2): a second, unrelated access-code switch
  on the plans screen, `SEO_UNLOCK_KEY` compared in constant time exactly like
  `MASTER_KEY`/`checkMasterKey`, entered by the operator during a paid setup
  engagement, never a merchant-facing feature (no badge, no upgrade copy).
  `checkSeoUnlockKey`, `grantSeoUnlock` and `isSeoUnlocked` in
  `billing.server.ts` follow the existing comp pattern (`Setting("seo_unlocked")`).
  `syncSeoUnlockMetafield` mirrors that flag to the `seo_unlocked` shop
  metafield (new definition in `metafields.server.ts`, `PUBLIC_READ`), the
  same way `business.server.ts` and `theme-scan.server.ts` hand a database
  value to Liquid. **Extension change**: the theme block reads
  `shop.metafields['$app'].seo_unlocked.value` and, only when it is true,
  now also emits four schema.org pieces that a real-store audit found
  missing, computed at render time from live data (no job, no new
  metafield): `BreadcrumbList` on product pages (home page plus the
  collection the visitor arrived through, or the product's first collection
  as a fallback); `WebSite` + `SearchAction` on the home page only
  (`template.name == 'index'`); `priceValidUntil` (today plus one year,
  computed on every render so it can never be a stored date in the past)
  and `itemCondition` (`https://schema.org/NewCondition`) on every `Offer`
  and `AggregateOffer`. None of the four existed in any form before, and
  extend mode still never emits a second Product node. Requires
  `npx shopify app deploy` to take effect - this entry is not server-only.
  Tests in `app/services/__tests__/billing.server.test.ts`
  (`checkSeoUnlockKey`: correct key, wrong key, empty candidate, unset env).

### Changed
- "Plain text" column and links renamed to "What AI reads" on the products
  list and the product editor (`EXPERIENCE-PRD.md` §7) - same URL, same
  behaviour. Empty states on both screens now say what has to happen before
  the page exists, instead of a bare dash.
- The three refusals (`EXPERIENCE-PRD.md` §9b, §9c) - no prompt sampling sold
  as visibility, no generated content published under the merchant's name, no
  access to orders or customers - now appear as a card on the Plans screen,
  where a merchant decides whether to pay.

### Added
- Plain text mirror carries what it was missing: the variant SKU, the featured
  image and its alt text, the product type and Shopify's standard product
  category, all requested in the same catalogue query
  (`catalogue.server.ts`) and published as front matter, each omitted when
  empty. A new `## Store` section, above the source line, carries the shop
  name, the storefront URL and the official profile URLs the merchant filled
  in on the Business screen. Those profiles were already published on the
  themed page as an `Organization` node with `sameAs`, but the mirror exists
  for the reader that cannot parse the themed page - which is the same reader
  that would never see that node. The section publishes nothing when there is
  nothing under it. Tests in `app/services/__tests__/mirror.server.test.ts`.

### Fixed
- Prices published with Shopify's raw trailing zero: the Admin API returns
  `1190.0`, which read as a broken import rather than a price, in the mirror
  front matter, in the generated summary sentence and in the generated "How
  much does X cost?" answer. A new `price.server.ts` formats the amount once
  at the services boundary - two decimals when it is not a whole number, none
  when it is - before the value reaches any engine function, so all three
  outputs agree and the engine stays pure. A test pins `1190.0` so it cannot
  come back.
- The Business screen named a currency in its own help text, so a merchant
  outside Romania read an example in RON. The delivery cost placeholder and
  both help strings now name no currency; the field is free text and the
  merchant writes their own.

### Added (free tier)
- Free tier (`FREE-TIER-SPEC.md`, decided 28 Aug 2026): before subscribing, a
  merchant gets the crawler check and the coverage score unlimited, plus
  three products of their choosing fully processed. `Shop.freeProductsUsed`
  (migration `20260829120000_free_products_used`) counts only successful
  writes and lives on the `Shop` row so it survives uninstall and reinstall.
  The dashboard (`app._index`), diagnostics, and the products list now load
  without a subscription - an explicit allowlist in `app/routes/app.tsx`
  names the three routes and points at this spec. The products list gained a
  per-row "Process this product" action, reusing `extractOneProduct`, shown
  only to shops without a subscription and only while fewer than three free
  products have been used; once used up the action is replaced by a line
  pointing at the plans screen. Both screens state plainly what is free, what
  is not, and that anything written stays written and in the merchant's own
  metafields whether they subscribe or not. Not a trial: no time limit, no
  second free quantity, no discount.
- Readability check (`app/engine/citation.ts`, ported from the WordPress
  plugin): a word overlap ratio, not a similarity model. It compares the
  product title, and as a fallback the opening sentence of the summary,
  against the words used in that product's generated buyer questions, after
  normalising and stripping stopwords. Grounded in a published analysis of
  1.4 million ChatGPT prompts finding that assistants rewrite a prompt into
  narrower sub-questions and search those, so a title that shares wording
  with those sub-questions is more likely to surface. Verdicts: `good`
  (title score >= 0.4 and the handle is descriptive), `partial` (title
  score >= 0.2, or opening score >= 0.4), `weak` otherwise, and `null` when
  the product has no generated questions to compare against. Also flags an
  opaque (non-hyphenated, identifier-looking) handle, but never rewrites
  one or offers to - changing a handle breaks existing links unless a
  redirect is created explicitly, so the screen says the change is worth
  considering for new products, not existing ones. Surfaced in a new
  Readability card on the product editor (`app/routes/app.products.$id.tsx`)
  with the source and its limits stated on screen. Pure, read-only: no new
  metafield, no new table, nothing published. Tests in
  `app/engine/__tests__/citation.test.ts`.
- Crawler check taxonomy: three crawlers added to `crawler-check.server.ts`
  alongside the existing five - `DeepSeekBot`, `Applebot` (Apple's real
  crawler), and `Google-CloudVertexBot` - each with its documented user
  agent string. A new `CRAWLER_INFO` map records, for every crawler tested,
  which company runs it and what it is for (training, search indexing, or
  answering a live user question), surfaced as one line next to each
  verdict on the Diagnostics screen. Also documented and shown on that
  screen: `Google-Extended` and `Applebot-Extended` are not crawlers but
  robots.txt-only tokens controlling what Google and Apple's real crawlers
  may do with pages already fetched, so no request ever arrives carrying
  either name and they are deliberately not tested - a request claiming to
  be one of them is something else, usually a scanner. Verified against
  Google Search Central and Apple's Applebot documentation on 22 August
  2026. Additive only: no change to check timing, retries, or verdict
  logic.
- Diagnostic-only `CrawlerHit.forwarding` column: records the raw values of
  candidate client-address headers (`x-forwarded-for`, `fly-client-ip`,
  `cf-connecting-ip`, `true-client-ip`, `x-real-ip`, `forwarded`) as a JSON
  object, to determine whether a real client IP is available behind Fly and
  Shopify's edge (CRAWLER-HITS-SPEC §2, §10.2). The existing `ip` column and
  its derivation are unchanged. Same 30-day retention as the rest of
  `CrawlerHit`; noted in `PRIVACY.md`.
- Way back: drop the `forwarding` column (migration
  `20260822090000_crawler_hit_forwarding`) and revert the
  `forwardingHeaders()` addition in `app/routes/proxy.$.tsx`.
- Plain text mirror link on the Products list and the product editor: a
  "Plain text" column on `app/routes/app.products._index.tsx` links to
  `https://<shop-domain>/apps/ai-visibility/<handle>` for any product with a
  `MirrorCache` row, and shows "Not readable yet" otherwise so the link never
  404s. The Readability card on `app/routes/app.products.$id.tsx` links to
  the same address for that product, or states plainly that nothing is
  published yet. One extra `mirrorCache.findMany` query per Products page
  load (batched over the page's handles); one extra `mirrorCache.findUnique`
  on the product editor. No change to what is published or how.

### Added (extension)
- **Preferred source deeplink block** (`PREFERRED-SOURCES-SPEC.md`). A new
  optional theme app block, `preferred-source.liquid`, renders a single
  anchor that lets a shopper add this storefront as a preferred source in
  Google Search, AI Mode and AI Overviews. Off by default; the merchant
  places it wherever they choose and sets a label, alignment, and
  optionally an uploaded badge image in place of the text label. Ships no
  JavaScript: Google's own recommended implementation loads a third-party
  script and SDK on every page, which the spec rejects (§4) as
  incompatible with the storefront block's zero-JavaScript rule, so this
  uses the plain deeplink instead, at the cost of the shopper landing on
  Google's tool rather than being returned automatically to the page. The
  href uses `shop.domain`, the shop's primary storefront domain, never
  `shop.permanent_domain` (the `*.myshopify.com` address), which would
  point the shopper at the wrong site. `app/routes/app.diagnostics.tsx`
  gains an informational card linking to
  `https://www.google.com/preferences/source` so the merchant can check
  by hand whether their domain is eligible; no automated check exists, and
  none was added, because there is no API for it. When no image is
  uploaded, the block now renders a styled button (a new `theme` setting,
  light or dark) rather than bare text - modest padding, rounded corners,
  a small coloured dot before the label - and ships no Google logo or
  Google-styled asset of any kind, matching the call the WordPress plugin
  reached the same day: shipping or imitating Google's badge raises a
  trademark question neither product is answering. Diagnostics now also
  records the manual eligibility check as a fact with a date rather than
  only linking to Google's tool (`app/services/preferred-source.server.ts`,
  a `Setting` row keyed `preferred_source_eligibility` per shop, following
  the same table `business.server.ts` uses): two buttons let the merchant
  record what they saw ("It appears" / "It does not appear"), and the
  screen then states "Recorded on DD Month YYYY: the domain appears/does
  not appear in Google's source preferences tool," or says plainly that
  nothing is recorded yet and why it cannot be checked automatically. No
  automated fetch of Google's tool, and no count of people who added the
  site, per spec §6. The diagnostics card (renamed "Preferred source", was
  "Preferred source eligibility") now also gives the merchant the deeplink
  itself rather than relying on a shopper to browse past the storefront
  block: a line telling them to tap it once with their own Google account
  first, a readOnly `TextField` with the same prefilled URL the card
  already builds from the primary domain, and a second readOnly multiline
  `TextField` holding a prewritten message with the URL in it, for the
  merchant to send by WhatsApp, email, or newsletter. Admin-only, no
  extension release needed. States only the per-person effect Google
  documents (the person who taps it sees this store favoured in their own
  Search, AI Mode and AI Overviews results, and may click through) - no
  claim of a ranking or aggregate signal, no count. Way back: delete
  `extensions/ai-visibility/blocks/preferred-source.liquid`,
  `app/services/preferred-source.server.ts`, revert the diagnostics card
  in `app.diagnostics.tsx`, and drop the `Setting` rows keyed
  `preferred_source_eligibility`.

## Version 10 - 21 August 2026

### Fixed (engine)

- **Length is no longer published as width.** `prepareText` lowercases the
  text every pattern runs against, and `measurements()` was reading that copy.
  Its pattern distinguishes L from l on purpose - Romanian furniture copy
  writes "L 130, l 80" and means length 130, width 80 - but after lowercasing
  there was nothing left to distinguish, so a table 130 cm long was published
  as 130 cm wide. Wrong data stated as fact, which is worse than a missing
  value. `measurements()` now receives a copy that kept its capitals, through
  a new `casedText` option that defaults to the old behaviour so nothing else
  changed. The move to cased text would have silently lost "130 X 80 CM" and
  "Lungime 130", which matched only because everything had been lowercased
  first; the patterns are now case-insensitive except for the single letters,
  where the case carries the meaning. Same defect fixed in WordPress 1.7.0.

### Added

- **Official store profiles, published as schema.org `sameAs`.** The
  Business info screen gains an optional Facebook / Instagram / TikTok /
  YouTube / LinkedIn / X / Pinterest URL list, stored in the same shop
  metafield as the rest of business info. Only absolute `https` URLs are
  accepted; anything else is dropped silently, and no profile is ever
  verified to exist. The theme scan (`app/services/theme-scan.server.ts`)
  now also detects an existing `Organization` node the same way it already
  detects `Product`, including the real `@id` it uses if any, and mirrors
  both to a new `theme_scan` shop metafield (public read, like `business`)
  so the storefront block can decide without a fetch. The app embed block
  extends the theme's own `Organization` node by that exact `@id` only
  when one was actually found - never an invented identifier - and
  otherwise emits a complete minimal node of its own (`@type`, `name`,
  `url`, `sameAs`); nothing is emitted when the merchant has filled in no
  profiles. See PRD §4.2 for the full rule. Way back: revert
  `app/services/business.server.ts`, `app/routes/app.business.tsx`,
  `app/services/theme-scan.server.ts`, `app/routes/webhooks.themes.publish.tsx`,
  `app/routes/app.diagnostics.tsx` and the block; drop the `theme_scan`
  shop metafield if it was already written.

### Added (server)

- **Phase 0 of crawler-hit logging** (`CRAWLER-HITS-SPEC.md`). The app proxy
  route (`app/routes/proxy.$.tsx`) now writes one raw row per request - shop
  domain, user agent as sent, client IP if present, path, product handle,
  response status, timestamp - to the new `CrawlerHit` table. The insert is
  fire-and-forget and swallows its own errors, so a database problem can
  never fail or slow down the mirror response; no second read was added.
  Purpose: confirm with real traffic whether Shopify's proxy forwards the
  original user agent and a usable IP, and whether the edge caches the
  response (`Cache-Control` on this route is unchanged pending that answer).
  No dashboard, no aggregation, no merchant-facing wording - by design, per
  spec §3. Way back: drop the `CrawlerHit` table and revert the route change;
  nothing else in the app reads this table yet.

### Fixed (server)

- **A stuck job now says so, on the first load.** Whether a job is stalled is
  decided on the server from the row's own timestamp instead of a counter in
  the browser. The counter restarted on every page refresh, so the warning
  needed three uninterrupted minutes on one tab and in practice never
  appeared - including during the outage of 20 August, which is how it was
  found. The banner also states how many minutes it has been stuck.
- **The Fly worker restarts itself.** It has no health check and no request
  path, so nothing noticed when it died during that outage; Fly exhausted its
  retries and jobs sat queued until the machine was started by hand. The
  worker process now carries a restart policy of `always`.

### Fixed (worker)

- **A shop with no obtainable session is marked uninstalled** instead of
  being polled forever. The review store from the August approval had
  uninstalled without the webhook reaching us and was retried every 15
  minutes, waking the database each time - paid compute on the new Neon plan.
  Only the two definitive signals trigger this (the Shopify library throwing
  a bare Response, or our "No offline session" error); transient failures
  never unregister a shop, and reauthentication revives one in any case.
- **Worker errors name the failure.** A thrown `Response` was logged as
  "[object Response]"; it now logs the status. The same applied to any future
  real failure at a paying shop, which would have been just as unreadable.

### Changed (database)

- `JobRun` gains `createdAt` and `updatedAt`. A queued job previously carried
  no timestamp at all, which is why staleness could not be computed on the
  server. Additive migration; the way back is
  `ALTER TABLE "JobRun" DROP COLUMN "createdAt", DROP COLUMN "updatedAt";`
  together with reverting the code that reads them.

## Version 9 - 20 August 2026

Points every product page and the plain text mirror at the llms.txt Shopify
publishes for the store, using the link relation the proposal names for it.

### Added (extension)

- **A `describedby` link to the store's llms.txt** on product pages, behind a
  new "Point crawlers at your llms.txt" setting, on by default. The llms.txt
  proposal (v2, revised 10 August 2026) names `rel="describedby"` as the way a
  page points at the llms.txt covering it. Shopify owns the `/llms.txt` route
  for the store, so this links to the file the platform already publishes
  rather than competing for the route.

### Added (server, live since 20 August 2026, ahead of the extension)

- The plain text mirror now answers with a `describedby` Link header to the
  store's llms.txt alongside the existing canonical one. The same proposal
  names the Link header as the mechanism for non-HTML resources, which is what
  the mirror is.

## Version 5 - 8 August 2026

The first release after approval. It carries the admin work built between
submission and approval (already live on the server since 3 August) plus the
extension changes that were held back so as not to disturb the review.

### Added (extension)

- The product panel lists every published buyer question rather than the
  first one with a count.

### Changed (extension)

- App name is now MRDigital AI Visibility AiO.

### Added (server, live since 3 August 2026)

- **Products screen.** One row per product showing what the app has published
  for it: number of attributes, number of buyer questions, whether a summary
  exists, how many images carry descriptions, whether a person has edited any
  field, and whether an assistant has anything to read. Search by title, SKU
  or vendor and filter by collection, both executed as Shopify product
  queries so they cover the whole catalogue rather than the loaded page.
  Three state filters: without attributes, edited by hand, missing image
  descriptions.
- **Readability card in the product editor.** States what is published for
  that product, plus the crawler verdicts. The crawler line is labelled as a
  store-wide check with the date of the check, because crawler access is a
  property of the store and not of an individual product.
- **Answer preview in the product editor.** Shows a buyer question, the
  answer the app can support built only from values already written to
  metafields (with those values named), and the same question answered from
  the theme's bare product markup. No model call and no simulation of any
  assistant's output.
- **Setup card extended.** Two further steps (collection pages built,
  business info) and an informational line reporting how many products state
  nothing extractable, with a link to that filtered list.

### Changed (server, live since 3 August 2026)

- Setup steps that are genuinely optional show a neutral dot instead of a
  caution icon, and state that leaving them empty is a complete setup.
- The answer preview skips a buyer question whose answer the summary already
  states, so no value is repeated.
- Navigation: the home entry is labelled Dashboard. It had been labelled
  Products while not being a product list.

---

## Version 4 - 3 August 2026 (submitted for review, approved 7 August)

Extension release containing the theme app extension and the admin product
panel.

### Added

- **Admin product panel** (`ui_extension`, target
  `admin.product-details.block.render`). A card inside Shopify's product page
  showing the attributes, summary and buyer questions published for that
  product, with a badge per field for automatic or merchant-edited, and a
  link into the app's editor. Read only.
- **Business info screen.** Delivery time and cost (with a starting-price
  option), return window, warranty, payment methods. Stored in a shop
  metafield with public read access, published as buyer questions on every
  product and, in full structured-data mode, as `shippingDetails` and
  `hasMerchantReturnPolicy`.
- **Collections.** Summary, choice criteria, buyer questions and a comparison
  table per collection, built only from attributes that vary across that
  collection. Published as `CollectionPage` with `ItemList` and `FAQPage`,
  plus an optional theme app block that renders the table with no JavaScript.
- **Variant-level attributes.** Option values are written as facts on each
  variant; a product-level attribute that the variants contradict is
  withdrawn from the product.
- **IndexNow.** Changed product and collection pages are submitted to
  IndexNow. The ownership key is served through the app proxy, so no theme
  change is required. On by default, with a per-shop setting to disable.
- **Full-mode structured data additions.** `aggregateRating` when a review
  app has written real review metafields, and `AggregateOffer` with the real
  price span for products with variants.
- **Capsule editor.** Summary, buyer questions and who-it-suits are editable
  per field, each with its own provenance record.

### Changed

- **Billing gate.** Every page under `/app` verifies the subscription with
  Shopify on load. Comped access is granted by a single master key entered on
  the plans screen. A second bypass mechanism (an allowlist of shop domains)
  was removed, so testing the paid flow cannot be invalidated by a forgotten
  setting.
- **Worker authentication.** Offline access tokens are obtained through
  `unauthenticated.admin` on each request rather than read from the session
  table. Offline tokens expire after 60 minutes, so background jobs (poll,
  weekly sweep, webhook-driven extraction) previously failed with 401 about
  an hour after the merchant last opened the app.
- **App embed verification.** The dashboard reads
  `config/settings_data.json` from the published theme and compares the block
  reference against the released extension uid. An embed enabled against a
  development preview references a uid that no longer exists, renders
  nothing, and previously verified as active.
- **Gate redirects preserve the embedded query string.** Dropping `shop` and
  `host` sent merchants to the login page.
- **Prisma migrations use a direct database connection** (`directUrl`)
  instead of the connection pooler, which holds advisory locks past process
  exit.

### Fixed

- **Appearance qualifiers.** A material term preceded or followed by an
  appearance qualifier is no longer claimed as the material. "Aspect de
  marmura", "tip marmura", "faux leather" and "marble effect" describe
  appearance, not composition. Both word orders are covered and pinned by
  tests.
- **Stale values are withdrawn.** When a recomputed field comes back empty,
  the previously written value is deleted rather than left in place.
- **Machine-written alt text is treated as replaceable.** Alt text containing
  an embedded filename, HTML entities or a UUID is not a person's writing and
  is rewritten. It had been protected as if a merchant had typed it.
- **HTML entities in generated text.** Product titles are cleaned before
  entering summaries and buyer questions, so a question no longer reads
  "What is Set Masa &amp; 6 Scaune made of?".
- **Multiplication sign** in dimensions is normalised to a plain "x".
- **Composite attribute values** are split before being listed in collection
  prose, so "textil, burete" and "burete" no longer read as a duplicate.
- **Self-feeding write loop.** An identical value is never rewritten. Writing
  a metafield marks the product as updated, which triggers the app's own
  webhook, which queued another extraction.

---

## Versions 1 to 3 - 2 August 2026

Development builds before the first submission. Not distributed.
