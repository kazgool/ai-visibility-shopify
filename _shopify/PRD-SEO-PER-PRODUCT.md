# PRD: SEO scan and findings per product

3 September 2026. Decided by Marius the same day: the SEO capability is a
separately billed engagement, activated by the operator key that already
exists (`isSeoUnlocked`), independent of the annual licence. The first client
has paid 200 EUR for it. The scan runs per product, not on a sample, with a
budget of **500 page fetches per shop per day**.

**Verified 3 September 2026 for section 0 only.** The census below is a real
run and its output is pasted verbatim. Every figure in sections 2 to 5
remains a design figure, not a measurement. The header of the original draft
said "every count in section 3 is a placeholder"; the census section is
section 0, and section 3 is the budget - the pointer was wrong and is
corrected here rather than left to mislead the next reader.

## 0. The cheap read that comes first

Before the query in section 2 is changed and before any screen is built, the
bulk read with the three added fields is run once on the dev store and the
counts pasted here:

```
cd F:\ai-visibility-shopify
npx tsx scripts/seo-fields-census.ts mrdigital-dev.myshopify.com
```

The script is the first deliverable of this PRD, is read-only, prints no
product data, and answers: how many products have a barcode, a vendor, a SKU,
a featured image, a distinct meta title, a distinct meta description, and how
many meta titles collide. Those numbers decide which checks are worth a card
and which are worth a line. It takes the shop domain as an argument and
refuses to guess when more than one shop is installed.

### 0.1 The run, 3 September 2026

```
Shop: mrdigital-dev.myshopify.com
Filter: status:active AND published_status:published
Reading the catalogue (one bulk operation, no writes)...

Products read: 50 of 50 announced (complete)
Products in the shop, unfiltered: 50

Rich-result identifiers (check A1)
  has a barcode on some variant              0 of 50 (0%)
  has a barcode on every variant             0 of 50 (0%)
  has a vendor                              50 of 50 (100%)
  has a SKU on some variant                 50 of 50 (100%)
  has a SKU on every variant                50 of 50 (100%)
  has a featured image                       1 of 50 (2%)
  featured image has alt text                1 of 50 (2%)

Offer fields (check A2)
  has a variant price                       50 of 50 (100%)
  has a compare-at price                     0 of 50 (0%)
  has more than one variant                  0 of 50 (0%)
  variants read in total               50

Meta fields (checks A3 and A5)
  has a meta title                          50 of 50 (100%)
  has a meta description                    50 of 50 (100%)
  has both                                  50 of 50 (100%)
  has neither                                0 of 50 (0%)
  meta title written by a human here         0 of 50 (0%)
  meta title from outside this app           0 of 50 (0%)
  meta title written by this app            50 of 50 (100%)

Duplication (check A3)
  meta titles shared with another product     0 of 50 (0%)
  distinct colliding meta titles        0, largest group 0
  meta descriptions shared with another      0 of 50 (0%)
  distinct colliding descriptions       0, largest group 0
  product titles shared with another         0 of 50 (0%)
  distinct colliding product titles     0, largest group 0
```

The second installed shop, `picturax.myshopify.com`, was run too and holds
zero products. It contributes nothing.

### 0.2 What the run says, and what it does not

**The store is not the store this PRD was written against.** CLAUDE.md
records 355 real furniture products on `mrdigital-dev`; the shop now holds 50,
unfiltered - so this is not the eligibility filter hiding 305 products, it is
a different catalogue. Every "355" in this document, and the environment fact
in CLAUDE.md, is stale. Nothing below was decided on 355 products.

**The census cannot decide card-versus-line on this store, and the reason is
that the store is a fixture, not a catalogue.** Three of its rows are
degenerate:

- Meta title and description are present on 100% of products and *all 50 were
  written by this app*. Zero human, zero from outside. A3 (duplication) and A5
  (absent meta field) therefore measure this app's own output, not a
  merchant's. Zero collisions on a set the app deduplicates by construction is
  not evidence that collisions are rare in the wild.
- One product in fifty has a featured image. On a real furniture catalogue
  that would be the single loudest finding on the SEO screen; here it is an
  artefact of a seeded store.
- Zero barcodes, zero compare-at prices, one variant per product. A1's GTIN
  clause and A2's price comparison have nothing to bite on.

**What the run does establish**, and it is not nothing:

1. The three added fields come back through the bulk path and cost nothing
   extra: one bulk operation, complete, 50 of 50, 50 variants.
2. `vendor` and `sku` are populated on 100% of products, `barcode` on 0%. If
   that pattern holds on a real catalogue, A1's four identifiers are not four
   equal checks: barcode is the finding and the other three are usually
   satisfied. A1 should name the absent ones rather than score all four.
3. The classifier that the SEO screen uses (`classifyMetaField`) and the
   census agree by construction - the census calls it rather than
   reimplementing the rule - so A5 needs no new logic, only a row.

**Decision, Marius, 3 September 2026: there is no card-versus-line
question.** The screen is not designed around any one catalogue, this
store's or a client's. Every check is a row with its denominator on every
shop, always; the screen orders itself by the data it has (section 4). The
census is a development tool for reading a catalogue's shape, not a gate that
decides the screen, and no build step waits on running it against a
particular store.

## 1. What this replaces, and what it keeps

Today `scanStorefront` (`theme-scan.server.ts:421`) reads one product page
and the home page, and every verdict on the SEO and Diagnostics screens
("Theme emits a Product node", "Switch to Full mode", conflicts, canonical,
noindex) is drawn from that one product. A theme can use a different template
per product type, a product can carry a template override, and a page-level
app can inject a node on some pages and not others. One page cannot see any
of that. The 3 September dev-store scan also showed the sharper failure: both
pages returned identical content behind the storefront password, and the
screen reported "No Product node found" as a finding about the theme.

Kept as is: the meta title and description writer, its queue, revert and
human protection; the weekly watch; the JSON-LD emitters; robots.txt and
crawler checks; the storefront password field. This PRD adds a second layer
under them, per product, and rewires the existing verdict cards to read the
aggregate of that layer rather than one page.

## 2. Two sources, one row per product

Every finding has exactly one source, stated on the row. Mixing them is how
a number ends up without a denominator.

**Source A: the bulk read.** Already runs for every product in every pass.
Costs nothing extra per product. Three fields are added to
`productsBulkQuery`: `variants { barcode price compareAtPrice }`.

Done 3 September 2026. The grep the draft asked for, with the real counts
rather than the estimate it guessed at ("38 references across 10 files" was
never measured and is wrong):

| Symbol | Hits across `app`, `worker`, `scripts`, `extensions`, `__tests__`, after this change |
|---|---|
| `productsBulkQuery` | 6 in 3 files: `catalogue.server.ts` 2, `catalogue-read.test.ts` 3, `seo-fields-census.ts` 1 |
| `fetchAllProducts` | 23 in 8 files: `catalogue.server.ts` 1, `extract.server.ts` 2, `seo-bulk.server.ts` 2, `worker/tasks.ts` 4, `billing-gates.test.ts` 1, `catalogue-read.test.ts` 10, `withdrawal.test.ts` 1, `seo-fields-census.ts` 2 |
| `ProductInput` | 21 in 7 files |
| `VariantInput` | 5 in 2 files: `facts.server.ts` 3, `catalogue.server.ts` 2 |

The three fields went onto `VariantInput`, not `ProductInput`, and all three
are optional, so no construction site had to change to compile. Every site
was still read. The four that build the shape, and what each does:

- `catalogue.server.ts:178` `fetchProduct` - the single-product path. The
  three fields were added to `SINGLE_PRODUCT` too, though this PRD only asked
  for the bulk query: a field present on one read path and absent on the
  other is how check A1 comes to report a GTIN missing on the product editor
  and present on the nightly row.
- `catalogue.server.ts:~300` the bulk JSONL parser - variant rows now carry
  `barcode`, `price`, `compareAtPrice`. Its inline variant type was replaced
  by `VariantInput & { metafields: ... }` so the two cannot drift again.
- `__tests__/extract.server.test.ts:10` `product()` - builds a `ProductInput`
  literal with no variants. Unaffected.
- `__tests__/facts.server.test.ts:17` `productWithAutoFacts()` - same.
  Unaffected.

`catalogue-read.test.ts` builds variants as raw JSONL rows, not as typed
literals, so it did not need widening either; a new assertion there checks
the three fields are in the variant block of the query string, sliced from
`variants` onward so that `priceRangeV2` on the product cannot make the
`price` assertion pass on its own.

**Source B: one GET of the product's public page.** What a crawler receives:
the theme's JSON-LD as rendered for this product, canonical, noindex,
whether the app's own block is present, response status, and the
`Cache-Control` header. This is the part under the daily budget.

### 2.1 The checks

| # | Check | Source | What the row says |
|---|---|---|---|
| A1 | Missing identifiers for rich results: barcode (GTIN), vendor (brand), SKU, image | A | which of the four are absent; a gap in the merchant's data, repaired in Shopify admin |
| A2 | Offer consistency: schema `availability` against variants, schema price against live price | A + B | "page says InStock, every variant sold out" |
| A3 | Meta title and description duplicated across the catalogue | A | "shares its title with 39 products" |
| A4 | Handle renamed with no `urlRedirect` from the old handle | A + `urlRedirects` query | old handle, whether a redirect exists |
| A5 | Meta title/description absent, so Shopify falls back to a truncation | A | already computed by `classifyMetaField`; moves onto the row |
| B1 | Product node on this page: emitted by theme, by us, by both, by neither | B | the node count and each node's `@id`, so a second complete node is named where it appears |
| B2 | Canonical: self, or points elsewhere (root, a collection-prefixed URL, a `?variant=`) | B | the canonical URL as fetched |
| B3 | noindex on the page, from meta or `X-Robots-Tag` | B | present or absent |
| B4 | App block present on the page (the embed check per product, not per theme) | B | present, absent, or unreadable |
| B5 | Response: status, redirect chain, password page | B | 200, 301 to where, 404, password |
| B6 | Which of our expected nodes are absent on this page and why (`deriveMissingReasons`, per product) | B | the list, with reasons. **Not built in step 3, deliberately - see 2.3** |

Not in this table and not to be added under it: any score, any keyword, any
rewritten text. FAQPage rich results are restricted by Google since 2023 to
government and health sites; no sentence on any screen promises a rich
result from that node.

### 2.2 The row

New table `SeoScan`, one row per shop and product:

```
shopId, productId, handle
scannedAt            when source B last fetched the page, null if never
bulkAt               when source A last computed this row
findings             json: the checks above, each {code, detail, source}
offer                json: what the variants say about price and availability
nodes                json: every JSON-LD node on the page, as extractLdNodes returns it
status, canonical, noindex, appBlock, cacheControl
```

Findings carry a stable `code` so the weekly diff can say "B1 changed on
product X on Tuesday" rather than "the theme changed".

**Amendment, 3 September 2026, build step 2.** `offer` was not in the draft
and is added. A2 compares what the page states against what the variants say;
the page half arrives in step 3, months of catalogue passes after the variant
half was read. Without this column step 3 would have to re-read the whole
catalogue to answer a question step 2 already had the answer to. Shape:
`OfferFacts` in `app/services/seo-scan.ts` - `variantsRead`, `available`,
`minPrice`, `maxPrice`, `currency`. `available` is null, never false, when no
variant was read.

**What step 2 built, 3 September 2026.** The table, its migration
(`prisma/migrations/20260903120000_seo_scan`) and its down path
(`prisma/down/20260903120000_seo_scan.down.sql`, written first and quoting
the `_prisma_migrations` delete that has to accompany it). The checks are in
`app/services/seo-scan.ts`, pure, no database and no Admin API; the
persistence and A4's one Admin query are in `app/services/seo-scan.server.ts`.

Three rules the persistence keeps, and the reason for each:

- **A row whose content did not change is not rewritten.** Its `bulkAt` moves
  in one `updateMany` and nothing else. Five catalogue passes a week over
  20,000 products would otherwise be 100,000 pointless row versions. The
  comparison sorts JSON keys at every level, because Postgres does not
  preserve JSONB key order and a naive `JSON.stringify` comparison would
  report every row as changed on every pass - the rewrite storm, arrived at
  by the opposite route.
- **A short read never deletes.** Rows for products a read did not contain are
  deleted only when `complete` is true, the same flag `reconcileMirrors`
  obeys. On a short read they are kept, counted as `keptOnShortRead`, and
  said in the log.
- **A4 costs a request only for a product whose handle changed.** Nothing else
  in source A costs a single Admin call. The lookup is capped at
  `REDIRECT_LOOKUP_CAP` (50) per pass so a handle-rewriting import cannot turn
  one catalogue pass into thousands of requests; the remainder are left
  unchecked, which A4 reads as "not checked" and never as "no redirect", and
  are picked up on the next pass.

**Where it runs.** Every catalogue pass, enumerated so the class is closed
rather than sampled - the five callers of `fetchAllProducts` that read a whole
catalogue:

| Pass | File | Runs source A |
|---|---|---|
| `runBulkExtract` (Fill catalogue) | `app/services/extract.server.ts` | Yes, and never on a dry run - a dry run writes nothing, and a row in our own database is still a write. The report carries `seoScan`. |
| `sweep_missing` (weekly) | `worker/tasks.ts` | Yes, placed before the subscription gate: source A is gated by the SEO key alone and writes nothing to Shopify |
| `reconcile_mirrors` (toggle change) | `worker/tasks.ts` | Yes, same placement and same reason |
| `bulk_alt_text` | `worker/tasks.ts` | Yes. Its destructured `const { products }` became the whole `CatalogueRead`, because the delete rule needs `complete` |
| `runSeoQueueBuild` | `app/services/seo-bulk.server.ts` | Yes; this pass only ever runs behind the SEO key anyway |

`extractOneProduct` (the products/update webhook path) is deliberately **not**
in the table: it reads one product, and A3 is a question about the whole
catalogue that one product cannot answer. A product edited between passes has
its row refreshed by the next pass. Revisit in step 3, where a single-product
refresh has a screen behind it.

**Entitlement.** `computeSourceA` returns null and writes nothing at all for a
shop without `isSeoUnlocked`, matching section 3's rule that such a shop gets
no `seo_scan` JobRun rather than a refused one. Turning the key on fills the
rows at the next catalogue pass - no backfill, no migration of old data, and
nothing to undo if the key is turned off again.

### 2.3 What step 3 built, 3 September 2026

Source B is `app/services/seo-page.server.ts` and the nightly worker task
`seo_scan_products`. The checks that read the page are pure functions in that
file (`readingOf`, `productsDisallow`, `extractSchemaOffer`), so every one of
them is asserted from a string of HTML with no network and no database - which
is the only way the interesting cases can be produced at all. The one store
available cannot have its storefront password turned off, so "the page
answered with the password form" is not a state anyone can arrange on demand.

**One column, two sources, and the rule that keeps them apart.** `findings`
holds both halves. Source A owns the entries whose `source` is `"A"`; source B
owns the rest (`"B"`, and `"A+B"` for A2, which is computed here from the
`offer` column step 2 stored). Each rewrites only its own half. Without this,
the next catalogue pass would erase every page finding, and - worse and less
visible - step 2's "did this row change" comparison would see a changed row on
every single pass and rewrite the whole table every time, which is exactly the
rewrite storm that comparison exists to prevent. `computeSourceA` was amended
in this step for that reason, with two tests of its own.

**A correction to step 2.** The `@@index([shopId, scannedAt])` comment written
in step 2 said Postgres sorts NULLs first on ASC. It sorts them **last**. The
ordering is the cursor, so left as written every night would have rescanned
the same pages and never reached a page that had never been read. The query
asks for `nulls: "first"` explicitly, and the test that proves it answers
`findMany` the way Postgres would, honouring the null placement the code asked
for - a test that sorted the rows itself would have passed either way.

**What B5 covers**, since it is one code for several sentences: a status that
is not 200, a request that could not be made at all, a product URL that
answered from a different address, and a `Disallow` in the shop's own
robots.txt that covers `/products/`. Each carries a `reason` in its detail. A
password page is deliberately **not** one of them: it is a `status` of
`"password"` with no source B finding at all, so the aggregate in step 4 can
only say "could not be read" and can never say "no Product node".

**B6 is not built, and this is the reason.** `deriveMissingReasons` needs the
shop's mode, whether the app embed is active, and whether *this product* has
facts or a summary. Source B reads a page; it reads none of those three. Two
of them are one Admin call per shop, but the third is per product and is not
in the catalogue read this pass has in hand. Building it from what a page
happens to show would produce a list of "missing nodes" that is really a list
of nodes the block correctly chose not to emit, on every product, for ever. It
belongs to step 5, where the product editor already has the product's facts on
the screen. Every other row of the table in 2.1 is built.

**Two more things the step keeps.** A page that was attempted has its
`scannedAt` moved even when the request failed, or the ordering would hand the
same broken product back every night and the rest of the catalogue would never
be reached. And the storefront is unlocked once per shop, not once per page:
500 unlock requests a night would be a worse citizen than the scan itself.

## 3. The budget and the scheduler

**500 page fetches per shop per day.** Set by Marius, 3 September. Applies to
source B only; source A is unmetered because it is already paid for by the
catalogue pass.

**Built 3 September 2026**, every bullet below. The task runs nightly at
03:45 UTC (`worker/index.ts`), which is after the Monday 03:30 sweep starts
and before the 04:00 weekly watch.

- A new worker task `seo_scan_products`, run nightly after `sweep_missing`
  (03:30 UTC), one JobRun per shop per night, kind `seo_scan`.
- Order: products never scanned first, then oldest `scannedAt` first. A
  cursor is not needed; the ordering is the cursor.
- Stops at 500 or at the end of the catalogue, whichever comes first, and
  writes `scanned`, `remaining`, `nightsToFinish` (ceil of remaining / 500)
  into the JobRun report. The SEO screen shows that sentence: "212 of 355
  pages read; the rest by tomorrow night." On a 20,000-product store it reads
  "500 of 20,000 pages read; the rest over the next 39 nights", which is the
  true sentence and the reason the cap is a per-shop setting an operator can
  raise for a client who pays for it.
- Rate: one request at a time per shop, 500 ms apart. 500 pages is about four
  minutes. Two shops in parallel at most, the worker's concurrency.
- Respects the shop's own robots.txt for the app's user agent; a Disallow
  that covers `/products/` stops the scan and is itself finding B5.
- Sends the storefront password when the shop has entered one, exactly as
  `scanPage` does today. On `mrdigital-dev` that password is `massive`
  (Marius, 3 September 2026); a dev store cannot have it turned off, so every
  source B run against the dev store goes through it and a source B that
  cannot handle it can only ever be tested against a paying client's live
  store. It refuses to record a row for a page that
  answered with the password form: `status: "password"`, no findings, and
  the aggregate says "N pages could not be read" rather than "N pages have
  no Product node".
- Sends `Cache-Control: no-cache` and records the response's `Cache-Control`
  and `Age`, because the app's own proxy answers with `max-age=300` and a
  cached page is a finding about the cache, not about the theme.

**Entitlement.** `isSeoUnlocked(shopId)` and `mayProcessAutomatically`, both,
checked inside the try at the top of the task, same shape as `seo_watch`.
A shop without the SEO key gets no `seo_scan` JobRun at all, not a refused
one. The per-product row on the product editor renders only behind the same
key.

## 4. Screens

Nothing new is invented; the existing cards change what they read. The
design rule for every screen here: it must read correctly on a 50-product
fixture, a 355-product furniture export, a 20,000-product store and an
empty one, with no per-store tuning. That is achieved by never hard-coding
which finding matters: the data decides.

- **SEO screen.** One card, "Findings per product", with one row per check
  (A1-A5, B1-B6), each row showing `count of denominator` and a link to the
  list of products. Rows are ordered by count descending, so whatever is
  wrong on this store is at the top without anyone deciding in advance what
  is usually wrong. Rows with a count of zero collapse into one line at the
  bottom, "N checks found nothing on M products", so a clean store reads as
  clean rather than as a wall of zeros. A row whose check could not run
  (source B not yet scanned, or the pages answered with the password form)
  reads "not yet read" with its own count, never zero. The "pages read"
  sentence from section 3 sits at the top of the card.
  The "Structured data" card reads the aggregate of B1 over every scanned
  product: "Product node from the theme on 340 of 355 pages; none on 12;
  two on 3", with the three listed. The Extend/Full advice is drawn from
  that: it recommends Full only when *no* scanned page has a theme node, and
  says how many pages that verdict rests on.
- **Product editor.** A new "What a crawler sees on this page" section: the
  row's findings, `scannedAt`, and a "Read this page now" button that runs
  source B for this one product outside the nightly budget, counted against
  it (so a merchant cannot spend 10,000 fetches by clicking). Second render:
  after the button, the section shows the new `scannedAt` and the new
  findings, read from the row.
- **Products list.** One column, "Page", with a dot: green when the last
  scan found no finding, amber when it found any, grey when never scanned.
- **Weekly watch.** `diffThemeScans` gains a per-product mode: the Monday
  line lists products whose findings changed, by code.

## 5. Acceptance criteria

Every row has a unit test and, where marked, a by-hand check on the dev
store. A row without both is not done.

| Criterion | Unit | By hand |
|---|---|---|
| The bulk query carries `barcode`, `price`, `compareAtPrice`; every `ProductInput` construction site compiles | `catalogue-read.test.ts` asserts the query string; `tsc` | - |
| A1 names exactly the absent identifiers for a product with barcode and vendor and no SKU | `seo-scan.test.ts` - **done** | one product on the dev store, row matches admin - not done |
| A2 flags a page whose JSON-LD says InStock while every variant is sold out, and not one with a variant in stock | unit, both directions - **done** | set one product to sold out, next scan flags it - waits for step 3 |
| A3 counts collisions per title and never counts a title once | unit with 3 sharing, 1 alone - **done** | - |
| A4 lists a renamed product with no redirect and not one with a redirect | unit with `urlRedirects` stub - **done** | rename a product without ticking the redirect box; next night's row - not done |
| A5 names an absent meta title or description, and calls an empty field missing whatever a stale state entry claims | `seo-scan.test.ts` - **done** | - |
| Every source A check answers correctly on a product with every field present, one with every field absent, and one whose variants were not read | `seo-scan.test.ts`, all three shapes through all five checks - **done** | - |
| A row whose content did not change is not rewritten; a short read deletes nothing | `seo-scan.test.ts` - **done** | - |
| A source A failure is reported and does not fail the catalogue pass it runs in, and does not look like "no SEO key" | `seo-scan.test.ts` - **done** | - |
| B1 distinguishes theme node, our node, both, neither, by `@id` | `seo-page.test.ts` - **done**, including extend mode reusing the theme's id, which is one node and not a conflict | dev store product page in Extend and in Full - not done |
| B5 records `password` and writes no findings for a page that answered with the password form, and the aggregate says "could not be read" | `seo-page.test.ts` - **done**; the row keeps source A's findings and gains no source B one | dev store without the password entered - waits for step 4's screen |
| The nightly task stops at the budget and reports `remaining` and `nightsToFinish` | `seo-page.test.ts` - **done**, with a counting fetch stub; also that it paces one request at a time, 500 ms apart | - |
| A shop without the SEO key gets no `seo_scan` JobRun | `seo-scan-task.test.ts` - **done**; it asks Shopify nothing either | second dev store - not done |
| A `Disallow` covering `/products/` stops the scan, is reported as B5, and no page is fetched | `seo-page.test.ts` - **done**; a group naming this app beats the `*` group, a longer `Allow` wins, and an unreachable robots.txt does not stop anything | - |
| The order is never-scanned first, then oldest first, and the query's null placement is what produces it | `seo-page.test.ts` - **done**, against a findMany that answers the way Postgres would | - |
| Source A and source B never erase each other's findings, and neither rewrites a row because the other wrote one | `seo-scan.test.ts` - **done** | - |
| `Cache-Control: no-cache` is sent and what came back is recorded | `seo-page.test.ts` - **done** | a page served from the app proxy, which answers max-age=300 - not done |
| The product editor's button runs one fetch and the second render shows the new `scannedAt` | unit on the action | press it, reload |
| Every count on the SEO card has its denominator and the "pages read" sentence | assert on the rendered strings | - |
| No sentence on any screen promises a rich result | grep for "rich result" in `app/` returns only the negative sentence in this PRD's card copy | - |

## 6. Out of scope, said so it is not assumed

Search Console: the AI report is not in any API (STATUS 6b). A score. Any
keyword. Any text generation beyond the existing condensation. Page speed
and Core Web Vitals: a different discipline and a different tool. hreflang
and Markets: a later PRD, after this one has counts. Sitemap membership: a
later addition to source B once the budget's real cost is known.

## 7. Decisions, closed 3 September 2026

1. **The budget is a per-shop Setting row with a default of 500.** Key
   `seo_scan_daily_budget`, read by the nightly task, absent means 500. Set
   by the operator, not exposed to the merchant. General by construction: a
   store of any size gets the default, and any single engagement can be
   raised or lowered without code.
2. **The "Read this page now" button exists wherever the SEO key is
   present**, including on a free-tier shop's three products. The key is what
   is paid for; the annual licence is a separate product.
3. **Every screen is general.** Nothing in this PRD is tuned to a named
   store or client. Where an example uses a number, it is an illustration,
   not a design input.

## 8. Build order

1. **Done, 3 September 2026.** `scripts/seo-fields-census.ts`, run against
   `mrdigital-dev`, output pasted into section 0.1 with what it does and does
   not settle in 0.2; the three variant fields on both read paths; the grep
   in section 2. Typecheck, 503 tests, build and the Liquid check all green.
   Steps 2 to 7 have not been started.
2. **Done, 3 September 2026.** `SeoScan` table, its migration and its
   hand-written down path (written first); checks A1, A3, A4 and A5 computed
   at the end of all five catalogue passes; A2's variant half stored as
   `offer` and its comparison written and unit-tested against a stubbed page,
   because the page it compares against arrives in step 3. 42 new unit tests
   over three shapes of product. The migration has **not been applied to any
   database** - see the handover. Step 3 has not been started.
3. **Done, 3 September 2026.** Source B as `seo_scan_products`: the nightly
   task, the per-shop budget setting, the robots.txt rule, the password rule,
   the cache rule, and checks B1 to B5 plus A2's page half. 44 new unit tests
   in `seo-page.test.ts` and `seo-scan-task.test.ts`, two more in
   `seo-scan.test.ts` for the shared `findings` column. B6 is deliberately
   deferred to step 5 with the reason in section 2.3. No screen was touched.
   The migration from step 2 has still **not been applied to any database**,
   so nothing runs until it is.
4. **Done, 3 September 2026.** The SEO screen's "Findings per product" card
   and the Structured data verdict from the B1 aggregate. The aggregate is
   `app/services/seo-aggregate.ts`, pure, with `seo-aggregate.server.ts`
   reading the rows in batches of 1,000 so a 20,000-product store folds into
   counters rather than into memory. The Diagnostics "Structured data" card
   reads the same aggregate, so the two screens cannot disagree about one
   catalogue; with the SEO module off it keeps its one-page verdict and now
   says on the screen that it rests on one page.
5. **Done, 3 September 2026.** The product editor's "What a crawler sees on
   this page" section and its button (`scanOneProductPage`). Every value on
   the section is read off the row on each render, so the second render shows
   what was written and not what the action returned. B6 is still not built:
   this step was the screen it was deferred to, and building it needs the
   shop's mode and embed state as well as the product's facts - three reads
   this section does not make. Deferred again rather than guessed at, and the
   card carries no row for it.
6. **Done, 3 September 2026.** The Products list "Page" column, in four
   states rather than three, and `/app/products?finding=<code>` behind every
   row of the card. The weekly watch gained `diffProductFindings` over a
   snapshot in Setting `seo_watch_products`.

   **Amendment, 3 September 2026.** Section 4 says the button is "counted
   against" the budget but section 3 specified no counter, and the budget as
   built was a `take` on one query. Pressing the button ten thousand times on
   one product moves one row's `scannedAt` ten thousand times, so anything
   counted from the rows would read that as one page. Added: Setting
   `seo_scan_spent`, `{day, pages}` in UTC, written by the nightly pass and
   by the button, read by both before either fetches. The nightly pass now
   takes what is left of the budget rather than the whole of it.

   **Amendment, 3 September 2026.** The A1 label in section 2.1 reads
   "Missing identifiers for rich results". It is now on a merchant-facing
   screen, and the last acceptance row of section 5 says no sentence on any
   screen promises a rich result. `CHECK_LABEL.A1` is
   "Missing product identifiers: GTIN, brand, SKU or image". The finding, its
   code and its detail are unchanged.
7. Two independent QA rounds on a different axis each, adjudicated, before
   any of it is called done. Then `check.bat`, CHANGELOG, deploy, tag.
