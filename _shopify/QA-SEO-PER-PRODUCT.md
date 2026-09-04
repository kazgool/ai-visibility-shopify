# QA: the per-product SEO scan, two independent rounds, adjudicated

3 September 2026. The wave is build steps 1 to 6 of `PRD-SEO-PER-PRODUCT.md`:
source A on every catalogue pass, source B as the nightly `seo_scan_products`
task, and the four screens that read the `SeoScan` rows. Step 7 of that PRD is
this document.

## How this was produced

An overseer wrote two briefs on deliberately different axes so a defect one
reviewer misses is one the other catches, and neither round saw the other's
brief or output. Round 1 read the code against the specification: every row of
PRD section 5, the entitlement rules of section 3, the plain-character rule,
and the CHANGELOG's Unreleased section. Round 2 traced data end to end through
seven scenarios - one ordinary product from the nightly task to three screens,
a revoked SEO key, a password-walled storefront, a robots.txt that disallows
`/products/`, a catalogue larger than the budget across three nights, a shop
where source B has never run, and a product deleted between the scan and the
render.

The same overseer then adjudicated, and checked every load-bearing claim
against source before accepting it. Seven claims were checked by hand and
rejected or downgraded; they are in "Wrong or overstated" below. Four defects
in this document were found by the adjudication itself and by neither round -
the B5 denominator, the batched reader that was not batched, the missing
pluralisation, and the `products/delete` gap that round 2 found from the other
end.

## What QA found, and what it costs

Marius decides what is committed and when. This section states the findings and
their cost so that decision has the facts; it is not a verdict.

Six items were blocking. Two of them put a wrong number in front of a merchant
on a screen that contradicted itself four lines further down; two broke a
stated acceptance row of PRD section 5; one made the two screens that were
built to agree disagree; one was an acceptance row with no test at all.

| Item | If it had shipped as it stood |
|---|---|
| "N of M pages read" counted pages that could not be read | a password-walled store read "355 of 355 pages read." directly above "355 of the 355 pages fetched could not be read" |
| B5 counted over the pages it excludes | a store with 200 failures read "200 of 300"; a store where every page failed read "not yet read" while carrying the finding on every product |
| robots.txt block reached no screen | a shop that blocks `/products/` was promised "starting tonight" for a night the app had already decided would fetch nothing |
| the two cards re-derived the node count differently | Structured data said "two or more Product nodes" while Findings showed B1 clean, and pointed at a row that was not on the screen |
| Diagnostics' password banner outranked the aggregate | on the dev store - which cannot turn its password off - the screen said "nothing could be read" about a catalogue that had been read |
| no test on the editor's action or its second render | the acceptance row that names the exact class CLAUDE.md was amended for was unverified |

All six are fixed. Seven further items are fixed as wave fixes, six are
deliberately left with reasons, and one needs a PRD amendment rather than code.

## Blocking, all fixed

**1. The pages-read sentence counted attempted pages as read.**
`app/services/seo-aggregate.ts:245` returned
`` `${pagesAttempted} of ${products} pages read` ``. `pagesAttempted` includes
password pages, errors and non-200s, all of which the same card names as
unreadable four lines lower at `app/routes/app.seo.tsx:1335`. `pagesRead` was
already computed on the line above and unused by this sentence.
Fixed: the numerator is `pagesRead`, and the sentence names the failures
itself - "0 of 12 pages read; 12 more could not be read." Test:
`seo-aggregate.test.ts`, "never claims a page was read that answered with the
password form".

**2. B5's denominator excluded exactly the pages B5 fires on.**
`app/services/seo-aggregate.ts:154`: every B check took `pagesRead`, and
`pagesRead` counts only `status === "ok"`. B5 is raised on `status: "error"`
(`seo-page.server.ts:387`) and on a non-200 (`:406`) - rows that are not in
its own denominator. Two consequences, both wrong on a merchant screen: a
store where 200 of 500 products answered 404 read "200 of 300", a numerator
outside its denominator; and a store where every page failed had
`denominator === 0`, so the row read "not yet read" while carrying the finding
on every single product. Found by the adjudication; neither round raised it,
and no aggregate test covered a non-200 row carrying its B5.
Fixed: `CHECKS` now carries a `basis` per check
(`seo-aggregate.ts:80-93`). B5's basis is `pagesTried` - attempted pages
excluding the password wall. The password wall is excluded rather than counted
because a password page deliberately stores no finding (PRD section 3), so
counting it in would have made B5 read "0 of 12" on a store where nothing was
read - twelve clean pages claimed. Three tests in `seo-aggregate.test.ts`,
"B5 over pages that did not answer".

**3. The robots.txt block was reported into a log and nowhere else.**
`app/services/seo-page.server.ts:608-623` builds a B5 finding with
`reason: "robots"` and puts it on `report.robots`, which lives in the JobRun
report; no route reads `kind: "seo_scan"`. No `SeoScan` row is written, so the
SEO card showed every page row as "Waiting for the nightly page read" and
`pagesReadSentence` promised "The nightly pass reads up to 500 a night,
starting tonight." for a shop whose own robots.txt had already turned the scan
away. PRD section 5's acceptance row says the Disallow "is reported as B5";
reported into a log is not reported. Found independently by both rounds.
Fixed: `recordRobotsBlock` / `robotsBlock` write and read Setting
`seo_scan_robots_block` (`seo-page.server.ts:174-200`), written on every
nightly pass in both directions so the sentence goes away the night the
merchant fixes robots.txt. `app.seo.tsx` reads it in the loader and
`pagesReadSentence` says why nothing is read instead of promising a night.
Tests: two in `seo-page.test.ts` (recorded, and cleared), two in
`seo-aggregate.test.ts` (the sentence, and its absence).

**4. The two cards derived the Product-node count by different rules.**
`readingOf` merges two `@id`s that resolve to the same address, through
`canonicalNodeId(node.id, page.finalUrl)` at `seo-page.server.ts:429` - which
is what makes extend mode one node rather than a conflict. `productNodesOf` in
`seo-aggregate.ts:279-286` re-derived the same count from the **raw** id
strings, because the row stores the nodes as found and does not store
`finalUrl`. A theme emitting a relative `@id` beside an absolute one therefore
counted as one node for B1 and two for the Structured data card: Findings
showed B1 clean and collapsed it into `cleanSentence`, while Structured data
said "two or more Product nodes on N pages" and `app.seo.tsx:1387` told the
merchant those pages "are listed under the ... row above" - a row not on the
screen. This is precisely the "the two screens cannot disagree about one
catalogue" promise of build step 4.
Fixed: the count comes from the B1 finding the page reader already stored. B1
fires whenever `distinct !== 1`, so no B1 finding means exactly one node, and
the two surfaces cannot diverge by construction. `ours`/`theirs` still come
from the nodes, with the same `isOurNodeId` predicate both sides use. Two
fixtures were building a row the writer cannot produce - two nodes and no B1
finding - and now carry both, which is the point. New test: "does not
re-derive a second node from a relative @id the page reader merged".

**5. Diagnostics hid a real verdict behind a one-page password banner.**
`app/routes/app.diagnostics.tsx:441` put `theme.passwordProtected` ahead of the
aggregate in the chain. That flag is about the single page the theme scan
fetched. Once source B has read real pages using the stored password, the
banner says "The storefront answered with the password page, so nothing could
be read" about a catalogue that has been read, while the SEO screen shows the
verdict. On `mrdigital-dev`, whose password cannot be turned off, that is the
permanent state and the one a reviewer would most likely see.
Fixed: the aggregate wins as soon as it rests on at least one page.

**6. Acceptance row 18 had no test.**
"The product editor's button runs one fetch and the second render shows the new
`scannedAt` - unit on the action." `app/routes/__tests__/` held one file and it
was the CSV export. `seo-page.test.ts` covers `scanOneProductPage`, which is
the service, not the action and not the render. This is the exact class
CLAUDE.md's Workflow section was amended for on 3 September.
Fixed: `app/routes/__tests__/app.products.scan.test.ts`, 8 tests. The action
runs one read behind the SEO key and no other gate (decision 2 of section 7,
asserted with `hasPaidAccess` false), each refusal is a sentence rather than an
exception, and the second render is asserted by answering `scanRowFor` with a
row the action never returned.

## Fixed in this wave, not blocking

1. **`products/delete` left the `SeoScan` row behind.**
   `webhooks.products.delete.tsx` removed the mirror row only. Nothing else
   deletes a row except source A on a **complete** catalogue read, so a store
   taking short reads never corrected. The stale row inflated every denominator
   on the SEO card and the "N products carry finding B3" heading on the
   Products list, while the list under that heading dropped the product - a
   header disagreeing with its own list. Fixed, with a test.
2. **A deleted product crashed the editor route.**
   `app.products.$id.tsx` dereferenced `product.handle` with no null guard.
   Pre-existing, but this wave adds two new ways to arrive there (the Page
   column and `/app/products?finding=`). Now a 404 response.
3. **The storefront unlock could take the whole night down.**
   `storefrontCookie` was called unguarded in both source B paths. A storefront
   whose `/password` refuses the connection failed the JobRun with zero pages
   every night, and in the editor gave the merchant a 500 instead of one of the
   four refusal sentences that path was written for. Now `unlockQuietly`: the
   pages answer with the password form, which every screen already reads as
   "could not be read", which is the honest outcome.
4. **The night's spend was recorded once, after the loop.**
   `spendPages(shopId, report.scanned)` ran only if all iterations completed, so
   a throw or the worker machine going away discarded the accounting for every
   page already fetched - the counter read zero and the button would hand out
   the whole allowance again. It also lost a merchant's click during the pass
   to the pass's single final write. Now spent one page at a time, before the
   row is written. The test's setting stub had to be made to accumulate, which
   is what makes it a test.
5. **`REDIRECT_LOOKUP_CAP` was asserted nowhere.** It is the only thing between
   a handle-rewriting import and thousands of Admin requests in one pass. Test
   added, including that the products past the cap are silent rather than
   accused of having no redirect.
6. **"the 1 pages read".** `themeNodeSentence` and `themeNodeAdvice` did not
   pluralise, while every other sentence in the module does. Fixed.
7. **The batched reader was not batched.** `readSeoAggregates` reads in pages of
   1,000 and its own comment, and PRD build step 4, say a 20,000-product store
   "folds into counters rather than into memory". It pushed every row, `nodes`
   JSON included, into one array and aggregated at the end, so the batching
   bought nothing. Both aggregates are now split into a fold and a build, and
   the reader folds each row and drops it; `aggregateFindings` and
   `themeNodeAggregate` are that fold over an array, so every caller and every
   existing test keeps the function it had.

## Deliberately left, with the reason

- **A cookie that expires mid-run marks the rest of the night "password".**
  Every remaining page then takes the password branch, gets `findings: []`, and
  has `scannedAt` moved - which is the cursor, so those products go to the back
  of the queue and are not retried for a full cycle. Round 2 is right that
  nothing detects the transition. Left because the fix is a policy decision, not
  a repair: re-unlocking on the first password answer risks 500 unlock requests
  a night, which PRD section 3 explicitly refuses, and abandoning the night on N
  consecutive password answers needs a threshold nobody has evidence for. The
  `password` count is in the JobRun report; the honest next step is to render it
  (see the next item) and then decide.
- **The `SourceBReport` is rendered nowhere.** `password`, `failed`, `fromCache`,
  `nightsToFinish` and `stopped` are written into the JobRun and no route reads
  `kind: "seo_scan"`. The screen's pages-read sentence is re-derived from the
  rows rather than read from the report, so PRD section 3's "The SEO screen
  shows that sentence" is met by an equivalent sentence and not by that one.
  Left because it is a screen this PRD did not specify; it belongs with the
  password-drift signal above, in one addition rather than two.
- **The nightly pass holds a `running` JobRun and the dashboard refuses every
  button while it does.** About four minutes per shop at 03:45 UTC. Left because
  PRD section 3 specifies one JobRun per shop per night, the lockout is
  kind-agnostic by design, the banner names it ("The page scan") through
  `job-kinds.ts`, and the stall detector already covers every kind - that class
  was closed by wave A's fix 5 and this is not a new instance of it. A worker
  that dies mid-scan leaves the row `running` for ever, but that is true of
  every kind and has no reaper for any of them; a reaper is its own change.
- **`isPasswordPage` requires the absence of `ld+json` anywhere in the
  document.** Shared deliberately with `theme-scan.server.ts` so the two cannot
  drift. A Shopify password page carries no JSON-LD, so the conjunction fails
  safe; changing it would change the one-page scan too.
- **New products can sort ahead of older never-scanned ones**, because the
  tiebreak is `productId: "asc"` and GIDs sort lexicographically. The whole
  never-scanned set drains within one cycle either way.
- **`canonical` is stored unresolved and shown raw in the editor**, while B2
  resolves it against `finalUrl` before judging. A theme emitting a relative
  canonical shows "Canonical: /products/x". Cosmetic; no count depends on it.

## Needs an amendment, not code

**PRD section 5, row 7** reads: "Every source A check answers correctly on a
product with every field present, one with every field absent, and one whose
variants were not read - all three shapes through all five checks." Source A
has four checks: `sourceAFindings` (`seo-scan.ts:313`) runs A1, A3, A4, A5, and
A2 is not there and cannot be, because A2 needs the page and is raised by
source B. The row is unmeetable as written. The three-shape test also passes
`previousHandle` equal to the handle in all three cases, so A4 is exercised only
in its no-op branch there - it has its own tests at `seo-scan.test.ts:301`.

**PRD section 4 and section 8 step 6 disagree** on the Products list column:
section 4 specifies three states, step 6 says "in four states rather than
three" and gives the reason. The code does four and is right. Section 4 was
never edited, so the specification says both.

**PRD section 3** says source B "records the response's `Cache-Control` and
`Age`". `readingOf` computes `age` (`seo-page.server.ts:518`), `SeoScan` has no
column for it, and the update does not write it; it survives only as
`report.fromCache`, which nothing renders. A page served stale with
`max-age=300, Age: 290` is indistinguishable from a fresh one on the editor.
This needs either a column and a migration, or the sentence amended - and the
step 2 migration has still not been applied to any database, so a second
migration would land in the same unapplied pile. Not decided here.

Per CLAUDE.md, an acceptance criterion that is not met is a failed wave until
the PRD is amended and the amendment approved. These three are put for
approval rather than explained away.

## Wrong or overstated in the two rounds

Recorded because two adversarial rounds that produce nothing wrong have not
been read critically.

- **Round 2: "the running JobRun locks every dashboard button, and the stall
  banner does not unblock it" as a wave defect.** Downgraded. The class was
  closed by wave A's fix 5: the action's guard and the stall detector read the
  same kind-agnostic set, and `seo_scan` is in `job-kinds.ts` so the banner
  names it. The four-minute nightly lockout is the specified design (PRD
  section 3), not a regression.
- **Round 2: "`handle: ""` fetches `/products/` and yields findings about a
  listing page."** The filter is `handle: { not: null }`, so an empty string
  would pass it - but `handle` is written from `product.handle`, and Shopify
  does not issue an empty handle. A defect that requires an impossible input.
- **Round 2: "a password page carrying JSON-LD is misclassified as ok."**
  Correct about the predicate, speculative about the shape: Shopify's password
  page carries no JSON-LD, and the predicate is shared with the one-page scan
  on purpose. Moved to deliberately left.
- **Round 2: "the `age` column is a `FIX-IN-WAVE` data loss."** The behaviour is
  real and is above, but it is an unmet PRD sentence needing a decision about a
  migration, not a fix to apply quietly. Reclassified.
- **Round 2: "the deleted-product editor crash is BLOCKING."** Real and fixed,
  but round 2 itself notes it is pre-existing; it is not a defect of this wave
  and does not block it.
- **Round 1: "the CHANGELOG's rich-result grep claim is BLOCKING."** The
  discrepancy is real - `grep -rn "rich result" app/` returns the two comment
  lines in `seo-findings.ts` and not the capitalised "Rich Results Test" link
  the entry describes - but this is a delivery note quoting its own grep
  loosely, not a defect in the code, and the acceptance row's substance is met:
  no sentence on any screen promises a rich result. Noted, not blocking.
- **Round 1: "`bulk_alt_text` calls `computeSourceA` after the subscription
  refusal, unlike the other two passes."** True and correctly labelled
  not-a-defect by round 1 itself. The PRD's table promises that source A runs in
  that pass, not where in it. Recorded so the next reader does not re-find it:
  on a lapsed shop with the SEO key, `sweep_missing` refreshes source A and
  `bulk_alt_text` does not, which is harmless because `sweep_missing` runs
  weekly and `bulk_alt_text` is merchant-initiated.
- **Round 1: "row 19's assertions are on the aggregate, not on rendered
  strings."** True, and the CHANGELOG already says so. Not counted as a finding
  because the same entry argues the case - the four store shapes are a property
  of the aggregate - and CLAUDE.md binds an audit to a decision recorded in the
  CHANGELOG unless it quotes and argues against it. Round 1 did not.

## Verified clean, and worth saying

Both rounds and the adjudication agree, and each was checked against source:

- **Entitlement.** `isSeoUnlocked` then `mayProcessAutomatically`, both inside
  the try, `continue` with no JobRun for a shop without the key
  (`worker/tasks.ts:933-947`, JobRun created at `:966`). `computeSourceA`
  returns null before any database call at all five catalogue passes. The
  button is behind the key alone, per decision 2, and the editor section
  renders only behind the same key. A revoked key reads no stale row on any of
  the four screens and deletes nothing, so turning it back on loses nothing.
- **The A/B split of the `findings` column** cannot drop either half on any of
  the three write paths, including the early returns for a password page and an
  error.
- **The three persistence rules**: the sorted-key comparison, the short read
  that never deletes, and A4's cap reading as "not checked" rather than "no
  redirect".
- **The nightly ordering.** Night 3 provably reaches products nights 1 and 2 did
  not: failed pages have `scannedAt` moved so they sort to the back rather than
  blocking the cursor, and `nulls: "first"` is what puts the never-scanned set
  ahead of everything.
- **The plain-character rule.** No em dash, en dash, curly quote, ellipsis
  character or HTML entity in any string this wave added. The one non-ASCII byte
  in the whole diff is `utf8: "✓"`, a required field of Shopify's own storefront
  password form.
- **No sentence on any screen promises a rich result.**

## The run

Not `check.bat` itself - it ends in `pause` - but its steps, in order:

```
=== typescript ===   npx tsc --noEmit          clean, no output
=== tests ===        npx vitest run
                     Test Files  46 passed (46)
                     Tests       655 passed (655)
=== build ===        npm run build             built in 4.92s / 728ms
=== liquid ===       node scripts/check-liquid.mjs
                     check-liquid: no literal braces inside output tags.
```

And once more with `.env` renamed away, which is what CI has:

```
Test Files  46 passed (46)
Tests       655 passed (655)
```

`.env` was restored afterwards and is back on disk. 638 tests before this
document, 655 after: 17 added, and one test file
(`app/routes/__tests__/app.products.scan.test.ts`) that did not exist.

Nothing is committed.

## Still to be observed on a running store

Only what a code review cannot settle. **Every one of these needs Marius**, and
every one of them waits on the same thing: the step 2 migration has still not
been applied to any database, so there are no rows to render.

1. Apply the migration - `npx prisma migrate deploy` - then run Fill catalogue
   on the dev store; the SEO card's "Findings per product" fills and the
   pages-read sentence reads "0 of N pages read". Marius.
2. Run the worker with `seo_scan_products` by hand on the dev store, whose
   password cannot be turned off: every page must record `status: "password"`,
   the card must read "0 of N pages read; N more could not be read", and no row
   may say "no Product node". Marius.
3. Press "Read this page now" on one product and reload: the section shows a new
   `scannedAt` and the budget counter goes up by exactly one. Marius.
4. Add `Disallow: /products/` to the dev theme's `robots.txt.liquid`, run the
   nightly task, and check the SEO card names robots.txt instead of promising
   tonight; remove it, run again, and check the sentence goes away. Marius.
5. On a shop with the storefront password entered on the SEO screen, confirm
   source B reads real pages and that Diagnostics then shows the aggregate
   verdict rather than the password banner. Needs a store whose password the app
   can actually pass; the dev store is the test for the banner, a client store
   for the verdict. Marius.
6. Rename one product's handle without ticking the redirect box, run a catalogue
   pass, and confirm A4 appears on that product and on no other. Marius.
7. Delete a product that carries a finding and confirm it leaves the SEO card's
   denominators and the `?finding=` list in the same minute. Marius.
8. A page served through the app proxy, which answers `max-age=300`: confirm the
   editor shows the `Cache-Control` - and decide whether `Age` gets a column
   (see "Needs an amendment"). Marius.
