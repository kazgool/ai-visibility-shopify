# QA round 1: the merchant SEO dashboard, its printable report and its spreadsheets

5 September 2026. An independent read of `app.seo_.dashboard.tsx`,
`app.seo_.dashboard_.print.tsx`, `app.seo_.dashboard.export.$table.tsx`,
`SeoDashboardScreen.tsx`, `SeoPrintReport.tsx`, `seo-readiness.ts`,
`seo-report.ts`, `seo-dashboard.server.ts`, `seo-findings.ts`,
`seo-aggregate.ts`, `seo-since.ts` and their tests, against CLAUDE.md,
`PRD-SEO-FULL-ONPAGE.md` sections 4.1 to 5, `mockup-seo-dashboard.html`
including the notes under the dashed line, and the Unreleased section of
`CHANGELOG.md`.

**How this was established.** The full suite was run first and last:
`67 test files, 1241 tests passed` both times, and the working tree is clean -
every probe below was written into a throwaway test file, run, and deleted.
Nothing here is reasoned from reading alone unless it says so; every BROKEN
item carries the output that produced it.

Counts: **7 BROKEN**, **3 BROKEN guards**, **9 HELD**, **4 UNVERIFIABLE**.

---

## 1. Figures that can be wrong

### 1.1 BROKEN - the clean line quotes one denominator for a set that has two

`app/services/seo-readiness.ts:1101` to `:1107`, in `columnAccount`:

```
if (mineClean.length > 0) {
  const of = mineClean[0].denominator;
  lines.push(`${mineClean.length} ${more}checks found nothing at all on ${of} ...`);
}
```

It takes the denominator of the **first** clean row and states it for all of
them. The B column has two denominators by design: every page check is counted
over `pagesRead`, and B5 alone over `pagesTried` (`seo-aggregate.ts:56` to
`:71`).

Probe: 50 products, 46 pages answered, 4 errored, nothing found anywhere.

```
bulkRead 50 pagesRead 46 pagesAttempted 50
B5: clean count 0 denominator 50
B column lines: [
  '28 checks found nothing at all on 46 pages, so there is nothing to show.',
  ...
]
clean denominators in B column: [ 46, 50 ]
cleanSentence (aggregate's own, grouped): 27 checks found nothing on 46 products; 11 checks found nothing on 50 products.
```

One of those 28 checks was measured over 50, not 46. `cleanSentence`
(`seo-aggregate.ts:497` to `:521`) solves exactly this by grouping, and its own
comment says why: "One sentence quoting one of those two numbers for all seven
would be false about the other four." `columnAccount` is the function the
merchant screen, the printed report and `findings.csv` actually render, and it
does not group.

This is a member of a class the Unreleased section says it closed - "**A row
counted against a different total, silently.** ... It now carries its own line
saying so, on the report and on the screen". That fix, `rowScopeNote`
(`seo-report.ts:427`), is applied only to rows in the `found` state
(`SeoPrintReport.tsx:397`). When B5 is clean it is collapsed into this line and
its denominator disappears. The class was closed for one state of the row and
left open for another.

**Cost:** `seo-readiness.ts` (group the clean rows by denominator, as
`cleanSentence` already does), plus the assertions in `seo-readiness.test.ts`
and `seo-report.test.ts`. 3 files. No migration.

### 1.2 BROKEN - "32 figures are unchanged" counts 21 rows the card never shows

`seo-since.ts:222` to `:227` builds `unchangedLine` over every row `buildRows`
produced - the twelve fixed figures **and** one row per finding code.
`SeoDashboardScreen.tsx:1177` renders that sentence directly, under a table
whose rows have been filtered by `ownerSinceRows` (`seo-since.ts:398`), which
drops every `finding:` row precisely because "a check code never appears on
that screen".

Probe: 50-product store, a snapshot recording 21 finding codes, one figure
moved.

```
unchangedLine: 32 figures are unchanged.
unchanged rows total: 32 | of which figure rows: 11 | finding rows: 21
ownerSinceRows shown: [ 'Titles for Google written by this app' ]
```

The rendered screen, verbatim:

```
Then and now  Products that have  Then  Now  Change
Titles for Google written by this app  0 of 50  7 of 50  +7
32 figures are unchanged.
```

The card offers twelve figures. One moved. The merchant is told thirty-two did
not. The true number for what this card counts is eleven, and the other
twenty-one are a set the merchant is deliberately never shown.

The printed report does not print this line at all (`SeoPrintReport.tsx:302` to
`:337` renders `ownerSinceRows` and nothing else), so screen and paper also
disagree about whether the sentence exists.

**Cost:** `seo-since.ts` (compute the line from the filtered rows, or return an
owner-scoped table), `SeoDashboardScreen.tsx`, `seo-since.test.ts`. 3 files. No
migration.

### 1.3 BROKEN - the screen's Google method line points at a figure the screen does not print

`listingMethod` (`seo-readiness.ts:955` to `:963`) ends "...are counted in the
`{inPlace}` of `{total}` above." The screen prints that figure only in the KPI
strip, which `SeoDashboardScreen.tsx:594` renders **only when
`readiness.readSet > 0`**. The listing card itself renders whenever
`catalogueRead > 0`. Those are not the same condition: a shop whose catalogue
has been read and whose pages have not - the fifth fixture store of section
4.2, and every real shop between unlock and the first nightly page read - has
`readSet === 0` and `catalogueRead > 0`.

Probe on that shape, 120 products, catalogue read, no page read:

```
readSet 0 catalogueRead 120 unmeasured false inPlace 6
keyFigures: [ 'listing=6 of 10 | ', 'group-clean=0 | of 120', ... ]
  "counted in the" screen=true report=true
SCREEN CTX: ... so those 4 are in place on all 120 of your products and are
counted in the 6 of 10 above. ...
```

There is no "6 of 10" above on that screen. On paper there is - the report
prints the headline tile "6 of 10 details Google asks for, in place" - so one
sentence is true on one surface and false on the other.

**Cost:** `SeoDashboardScreen.tsx` (render the listing KPI whenever the listing
card renders), or `seo-readiness.ts` (drop the word "above"). 1 to 2 files plus
a render assertion. No migration.

### 1.4 HELD - the PRD's five-store table is what the code computes

Run, not read, on the five fixtures of section 4.2 built as literals:

| Store | heading | groups | headline | findings | shopwide | listing | products |
|---|---|---|---|---|---|---|---|
| 50 | `50 of 50 products fully checked` | 26, 12, 8, 4 of 50 | 26 / 24 / 0 / 4 of 10 | 40 rows + 7 accounting | 0 | 10 | 32 |
| 189 | `189 of 189 products fully checked` | 126, 38, 14, 11 of 189 | 126 / 63 / 2 / 5 of 10 | 40 + 8 | 2 | 10 | 275 |
| 20,000 | `500 of 20000 products fully checked` | 380, 120, 0, 0 of 20000 | 380 / 120 / 0 / 4 of 10 | 40 + 7 | 0 | 10 | 19620 |
| empty | `0 products in the catalogue` | 0, 0, 0, 0 of 0 | no headline figure | 40 + 6 | 0 | 10 | 0 |
| pages never read | `120 products in the catalogue` | 0, 0, 0, 0 of 120 | `listing=4 of 10` only | 40 + 6 | 0 | 10 | 120 |

Every figure in the PRD's section 4.3 table matches. That document describes
what the code computes.

### 1.5 HELD - the column arithmetic balances by construction

`columnAccount.total` counts codes in `FINDING_OWNER` whose `codeSource` is
that column; every such code is either in `CHECKS` (40) or in
`OFF_TABLE_SOURCE` (4). Probe:

```
vocab 44 CHECKS 40
in vocab not in CHECKS: [ 'A6', 'A10', 'A11', 'B30' ]
in CHECKS not in vocab: []
A col total 13   B col total 31
```

13 + 31 = 44. `balanced` cannot be false unless a code is added to
`FINDING_OWNER` and to neither table, which `codeSource`'s `?? "A"` fallback
would then silently put in the wrong column. Latent, not broken.

### 1.6 HELD - `rowScopeNote`'s hard-coded reason is currently reachable only by B5

`seo-report.ts:427` fires on any row whose denominator differs from its
column's, then prints B5's specific explanation ("it is the check about pages
that did not answer"). Enumerated: every A-column row is `basis: "catalogue"`
and the column denominator is `bulkRead`; every B-column row is
`basis: "pagesRead"` except B5 (`pagesTried`), and `pagesRead` is the column
denominator. So only B5 can trigger it and the sentence is true. A third
`CheckBasis`, or a second `pagesTried` check, would print a false reason on a
row it does not describe. Fragile, not broken.

---

## 2. Promises the app cannot keep

### 2.1 BROKEN - four sentences on paper and in a spreadsheet point at content that is only on the screen

`columnAccount`'s lines are written in the screen's deixis and are printed
verbatim by `SeoPrintReport.tsx:412` and appended to `findings.csv` by
`seo-report.ts:333`. The report renders neither `CollectionRows` nor `BlogRow`
nor `CountedCard`; the CSV renders none of the cards at all.

Probe, printed report, 50 products carrying B17, B29 and B32:

```
"their own total above": true
   CTX: ... 3 checks count your collections rather than your products, so they carry their own total above.
"its own total above": true
   CTX: ... 1 check counts your blog posts rather than your product pages, so it carries its own total above.
"at the foot of this screen": true
   CTX: ... 2 checks count something and state no verdict, so they are at the foot of this screen instead.
report mentions collections anywhere: true   (only inside that sentence)
report mentions blog anywhere: true          (only inside that sentence)
```

Every member of the class, by line and by surface:

| Line in `seo-readiness.ts` | Screen | Printed report | `findings.csv` |
|---|---|---|---|
| clean, `:1103` | true | true | true |
| shop-wide, "in the shop-wide card **above**", `:1109` | true | true (ShopWide is above Checks) | **false** - that card is a different file |
| not-yet-read, `:1114` | true | true | true |
| could-not-run, `:1119` | true | true | true |
| not-applicable, `:1124` | true | true | true |
| counted, "at the foot of **this screen**", `:1129` | true | **false** | **false** |
| off-table collections, "carries its own total **above**", `:1134` | true | **false** | **false** |
| off-table blog posts, same line | true | **false** | **false** |
| total, "N shown above", `:1141` | true | true | true |

Four false instances, none deliberate. The CHANGELOG describes appending these
lines to the CSV as the fix for "40 rows against a vocabulary of 44" and does
not record that their deixis was checked against the new surfaces.

**Cost:** `seo-readiness.ts` (take the surface as an argument, or return the
parts and let each renderer word them), `SeoDashboardScreen.tsx`,
`SeoPrintReport.tsx`, `seo-report.ts`, plus `seo-readiness.test.ts` and
`seo-report.test.ts`. 6 files. No migration.

### 2.2 BROKEN - "Every file ... with the shop and the date in its name" is false for one of the six buttons under it

`SeoDashboardScreen.tsx:1494`:

> Every file carries the figures on this screen, from the same reads, with the
> shop and the date in its name.

The sixth button on that card, `:1489`, points at `/app/seo/export/since`,
whose header is fixed at `app.seo.export.$table.tsx:80`:

```
`attachment; filename="ai-visibility-seo-${table}.csv"`
```

No shop, no date. This is not an objection to Amendment 8, which is correct and
binding and says the two older routes keep their names deliberately. The defect
is the sentence: it was written for the four new files and printed over six.

**Cost:** `SeoDashboardScreen.tsx`, one sentence, plus a render assertion.
1 to 2 files. No migration.

### 2.3 BROKEN - unvetted theme-scan sentences reach the merchant screen, the report and `shopwide.csv`

`whyNothingIsArriving` (`seo-readiness.ts:618` to `:637`) joins the raw
`reason` strings recorded by `deriveMissingReasons`
(`theme-scan.server.ts:549` onward) into the B6 shop-wide row's `why`. That
field is rendered on the merchant dashboard (shop-wide card,
`SeoDashboardScreen.tsx:770` region), in the printed report
(`SeoPrintReport.tsx:216`) and in `shopwide.csv` (`seo-report.ts:377`). Those
strings are the operator's, and nothing checks them.

Probe: B6 on all 12 read products, `publishedReasons` produced by calling the
real `deriveMissingReasons` for an embed-active shop whose page read found no
WebSite node and no rating, matched against the guard's own FORBIDDEN list:

```
B6 why: What is missing: Your business, Your shop and its search box, Where the
page sits, Star rating. The reasons we recorded: No store social profile URLs
are filled in on the Business screen. The SEO module is enabled but the last
scan did not find this node on the page - check that the app embed is active in
the current theme. The last scan found no rating on this product's page - no
review app has written rating metafields for it yet.

HIT node: screen=node report=node csv=node
```

"node" is item four on the mockup's own banned list, and "metafields" is in the
same sentence. The guard passes only because its fixture supplies the one safe
reason string, `"The app embed is not active in the theme."`; every other
branch of `deriveMissingReasons` is unreached by any merchant-vocabulary test.

Reachable in production: `embedActive: true`, `seoUnlocked: true`,
`hasWebSiteNode: false` is what a scan records whenever the page read found no
WebSite node, and B6 becomes shop-wide as soon as one detail is missing on
every product - which the Organization branch alone produces on any shop with
no social profile URLs on the Business screen.

**Cost:** a merchant-worded record over the reason set in
`theme-scan.server.ts`, or a translation table in `seo-readiness.ts` returning
null for anything it does not know (the pattern `ownerFigureLabel` already
uses). 2 to 3 files plus tests. No migration.

### 2.4 BROKEN - the spreadsheet the merchant dashboard offers as "then and now" is the operator's file

`SeoDashboardScreen.tsx:1488` puts a button labelled "Spreadsheet: then and
now" on the merchant dashboard, pointing at `/app/seo/export/since`. PRD
section 4.3 Amendment 7 makes this "the fifth" of the merchant spreadsheets on
purpose. What the route returns, run:

```
Figure,At the snapshot,Out of,Today,Out of,Difference
Meta titles written by this app,0,50,9,50,+9
"B17: Short description, or a page with little text",12,12,8,12,-4
Products with a barcode (GTIN),0,50,0,50,No change
Pages where the theme emits a Product node,10,12,10,12,No change
"A1: Missing product identifiers: GTIN, brand, SKU or image",50,50,50,50,No change
"B15: Images on the page with no alt text, or an alt that reads as a filename",4,12,4,12,No change
--- check codes present: true [ 'B17', 'A1', 'B15' ]
  JARGON: GTIN
  JARGON: node
  JARGON: Meta
```

and `written.csv` from the same route prints `WRITTEN_LABEL` ("Meta titles")
and the omission sentence "Alt texts and structured data nodes are not counted
here."

Two artefacts in the repository contradict each other. `seo-since.ts:322`:

> Operator vocabulary, read by `/app/seo` and the CSV export. It keeps
> `Record<string, string>` and its `??` fallback below, because the keys come
> from a JSON column and an operator is better served by a raw key than by a
> dropped row. **The merchant equivalents are `OWNER_WRITTEN_LABEL`**, which
> are typed and never fall back.

`SeoDashboardScreen.tsx` puts a merchant button on that CSV export. The
Unreleased section records the merchant-side label work for the *screen*
("`ownerSinceRows` returns rows that carry a plain label, so no renderer has a
null to decide about") and says nothing about the file; Amendment 7's stated
reason for reusing the route is the gate and the two snapshot rows, not the
vocabulary.

Also on that file: both dates are raw ISO strings (`datesLine`,
`seo-since.ts:500`) on a document section 4.3 calls the thing that goes on the
invoice, while `formatDay` sits two hundred lines above it.

**Cost:** owner variants of `sinceCsv`/`writtenCsv` in `seo-since.ts` reading
`OWNER_FIGURE_LABEL` and `OWNER_WRITTEN_LABEL` and dropping the `finding:`
rows the way `ownerSinceRows` does, plus either a `since` table on the
dashboard export route or a flag on the existing one. If a route is added, the
section 4.3 route table gains a row. 3 to 4 files plus tests. No migration.

### 2.5 BROKEN - the mockup says the steps survive a hydration failure; without JavaScript they do not exist

`mockup-seo-dashboard.html`, in the notes under the dashed line:

> The expandable steps use a native disclosure element, **not JavaScript
> state**, so the screen still works if hydration fails. In Polaris this is
> Collapsible with a button; the closed state must already carry the count and
> a one-line summary, because a merchant who never opens it still has to know
> what the group is.

`SeoDashboardScreen.tsx:453` is `const [open, setOpen] = useState(false)`, and
Polaris `Collapsible` with `open={false}` renders **no children at all** in the
server markup. Probe, on the "every code at once" store:

```
group row codes: 42
group step sentences not in markup: 41 of 42
```

The closed state does carry the count and the summary, which is the second half
of the note. The first half is not met: with no JavaScript there is no way to
reach the steps, which is also the condition Amendment 4 quotes Built for
Shopify 4.1.2 as failing ("a section that is collapsed with no way to expand
it").

**Cost:** `SeoDashboardScreen.tsx` (`<details>`/`<summary>`, or Collapsible
with children rendered and hidden by CSS), plus the render assertions that
currently cannot see that region. 2 to 3 files. No migration.

---

## 3. Entitlement

Every path that reaches SEO data, and how each was established. Behavioural
evidence for the five new routes: a throwaway
`app/routes/__tests__/zz-qa-probe.test.ts` mocking `authenticate`, `db` and
`isSeoUnlocked`, run and deleted - **8 tests, all passing**.

| Path | Kind | Gate | How established |
|---|---|---|---|
| `/app/seo/dashboard` | screen | `isSeoUnlocked` in its own loader, `:52` | ran the loader with the gate false: returns `{unlocked:false}` and `readSeoDashboardSource` is never called |
| `/app/seo/dashboard/print` | screen | `isSeoUnlocked`, `:38` | same, ran |
| `.../export/findings` | resource | 402, `:60` | ran: 402, no default export, source never read |
| `.../export/products` | resource | 402 | ran |
| `.../export/shopwide` | resource | 402 | ran |
| `.../export/listing` | resource | 402 | ran |
| any of the four with no `shop` row | resource | 402 | ran |
| `/app/seo/export/{since,written}` | resource | 402, `app.seo.export.$table.tsx:50` | read, plus the existing route test |
| `/app/seo` | screen + action | `:130`, `:300` | read |
| `/app/products` | screen | `:171`, and `finding=` forced to `""` when locked, `:177` | read |
| `/app/products/$id` | screen + action | `:122`, `:361`, `:405` | read |
| `/app/diagnostics` | screen | `:141` | read |
| `/app/plans` | screen | `:78` | read |
| worker `seo_watch` | task | `tasks.ts:860` | read |
| worker `seo_scan_products` | task | `tasks.ts:1040` | read |
| worker `seo_collection_queue` | task | `tasks.ts:1127` | read |
| worker `seo_collection_apply` | task | `seo-bulk.server.ts:268`, re-checked at execution time | read |
| worker `seo_queue_build` | task | `tasks.ts:1449` | read |
| worker `seo_apply` | task | `seo-bulk.server.ts:141` | read |
| worker `seo_snapshot` | task | none of its own - it *is* the grant path, calling `grantSeoUnlock`; gated where it is enqueued, `app.plans.tsx` | read |
| `webhooks/products/delete` | webhook | Shopify HMAC via `authenticate.webhook`; deletes `SeoScan` rows only | read |
| `scripts/read-seo-rows.ts`, `read-catalogue-checks.ts`, `run-seo-scan.ts`, `seo-snapshot-show.ts`, `seo-snapshot-take.ts` | operator CLI | none, by design - they take a domain argument and run on a machine that already holds the production database URL | read |

**HELD.** One note, not a hole: the dashboard export route answers an unknown
table name with 404 (`:52` to `:58`) **before** the entitlement check, so a
shop without the key can tell "no such table" from "no module". No data
crosses.

---

## 4. Merchant vocabulary, and what the guards do not cover

The three defects in 2.3, 2.4 and 2.5 are all vocabulary-adjacent. What
follows is what the guards themselves can and cannot catch. I tried to make
each one fail.

### 4.1 BROKEN guard - the screen half of the render guard cannot fail on the group steps

`SeoPrintReport.test.tsx:346` to `:378` renders both components on six stores
and matches FORBIDDEN against the text. On the report that is real: `Groups`
(`SeoPrintReport.tsx:157`) renders every row open. On the screen it is not:
`GroupPanel`'s `Collapsible` is closed at render, so **41 of the 42 group step
sentences are absent from the markup the guard reads** (probe in 2.5). The
group panels are where the merchant reads "What to do" - the most
content-heavy merchant-facing region on the screen - and no assertion over it
can fail.

The CHANGELOG's claim for this guard is accurate as far as it goes
("Reintroducing `row.label` fails it on five of the six"): `row.label` was
reintroduced in the report's `Checks` table, which does render. The screen half
adds much less than it appears to.

### 4.2 BROKEN guard - the CSV vocabulary guard covers one of five merchant files

`seo-report.test.ts:295` to `:326` scans `findingsCsv` only. Not scanned:
`shopWideCsv` (leaks, 2.3), `listingCsv`, `productFindingsCsv`, and the two
routes the dashboard links to, `sinceCsv` and `writtenCsv` (leak, 2.4).

### 4.3 BROKEN guard - "the same figure on both pages" passes on an incidental substring

`SeoPrintReport.test.tsx:205` to `:209`:

```
expect(paper).toContain(figure.value);
expect(screen).toContain(figure.value);
if (figure.of !== null) expect(paper).toContain(figure.of);
```

Two weaknesses, both live. `figure.of` is never asserted on the screen, so a
denominator can be on paper and absent from the screen unchallenged. And
`toContain` over a whole-page string is satisfied by any occurrence: on the
"pages never read" store the listing figure `"6 of 10"` is on the screen only
inside `listingMethod`'s "counted in the 6 of 10 above" - the very sentence
that is false there (1.3). The criterion reads "a figure on the print page and
the same figure on the screen cannot diverge"; what the test proves is that the
two strings each occur somewhere.

**Cost for 4.1 to 4.3:** test files only - `SeoPrintReport.test.tsx`,
`seo-report.test.ts` - plus whatever component change 4.1 forces. No migration.

### 4.4 HELD - the record-level guards, and the control characters

`seo-readiness.test.ts:634` to `:712` covers `OWNER_LABEL`, `SHOP_WIDE_LABEL`,
`OWNER_STEPS` and every sentence `shopWideItems`, `shopWideMethod`,
`shopWideCrossReference`, `listingMethod` and `columnAccount` assemble, on all
44 codes. Those do fail when broken.

The Unreleased section says two literal backspace characters had killed an
assertion and that "every touched file is now scanned for control characters as
part of this pass". Re-scanned code point by code point: all seven test files in
scope and the eleven source files. The only non-ASCII are the deliberate
smart-quote character classes at `seo-readiness.test.ts:710` and
`seo-report.test.ts:450`, plus CRLF line endings. No stray control characters.
The repair holds.

### 4.5 HELD - plain characters in every in-scope source file

Every code point of the eleven files was scanned. The only non-ASCII in the set
is in `report-metrics.ts`: five section marks in comments and one Romanian word
in a comment. Nothing an app string can reach.

---

## 5. The usual correctness

- **HELD - no write anywhere on this path.** The dashboard, the report and the
  four exports are read-only. Grepped for `mutation`, `create`, `update`,
  `delete` and `fetch(` across all eleven files; the only hits are
  `createReadinessCounters`, one `orderBy: { createdAt: "desc" }` and a comment.
  Rendering this screen cannot re-trigger a webhook and cannot touch anything a
  human wrote.
- **HELD - no REST.** One Admin call on the whole path,
  `seo-dashboard.server.ts:20`, GraphQL, falling back to the myshopify domain
  on failure rather than breaking the screen.
- **HELD - CSV formula injection.** `csvCell` (`report-metrics.ts:710` to
  `:715`) neutralises `=`, `+`, `-`, `@`, tab and CR, exempts plain numbers so
  `differenceLabel`'s `-3` survives, and is the single copy all five export
  writers use. Asserted, including the DDE form.
- **HELD - the byte order mark** is on both the new and the old export
  responses.
- **HELD - no filter that discards value silently, with one caveat.**
  `groupsOn` and `productFindingsCsv`'s `if (!label) continue` both drop a code
  the build does not know. Enumerated: `FINDING_OWNER` covers all 44 codes and
  no code has ever been removed from the vocabulary (A8, A9, A14 and B27 were
  never written), so neither can fire today. `productFindingsCsv` is the one
  that would lose rows with no accounting line if it ever did - `findingsCsv`
  has "Where every check went" and the products file has nothing equivalent.
- **HELD - memory.** `allScanRows` (`seo-aggregate.server.ts:246` to `:254`)
  reads in batches and accumulates handle and findings only, dropping `nodes`.
  The route's comment ("never holds its scan table twice") is accurate; it does
  hold the findings once, which at 20,000 rows is the intended cost of the
  products file.

---

## 6. UNVERIFIABLE

1. **Whether `window.print()` opens a dialog inside Shopify's admin iframe.**
   The code and the fallback sentence are correct for either outcome, and the
   PRD already lists this as Marius's by-hand check. *Settled by:* pressing the
   button in the admin on Chrome and on Firefox and saying what happened.
2. **The printed page count, and whether any card splits.** `break-inside:
   avoid`, `@page { margin: 12mm }`, `break-after: avoid` on headings and
   `orphans`/`widows: 2` are all present in the markup, which is what the
   acceptance row tests; whether the result is three pages or six needs a
   browser. *Settled by:* printing it and counting.
3. **Whether the `deriveMissingReasons` branches in 2.3 have actually been
   recorded on the client store.** The leak is proved from a call to the real
   function; whether Republica BIO's own last scan carries one of those reasons
   today is a database read. *Settled by:* selecting
   `detail->'missingReasons'` from the newest `ThemeScan` row for that shop.
4. **`WRITTEN_KEYS` and `OwnerWrittenKey` are two hand-maintained lists with no
   compile-time link.** They agree today - six keys, identical. A seventh added
   at `seo-snapshot.server.ts:215` would be dropped from the merchant card by
   `ownerWrittenLabel`'s null, with no count line to make the absence visible,
   and nothing would fail. *Settled by:* deciding whether that drop is
   intended. If it is, this is not a finding, and the two lists should say so in
   one place.

---

## Where I might be wrong

- **1.2, the unchanged line.** I am confident about the arithmetic. I am less
  confident that eleven is the number a merchant should read, or that the line
  belongs on that card at all. If the intended reading is "thirty-two things we
  track, none of which moved", the fix is a wording change and not an
  arithmetic one. *Overturned by:* a record that the line was deliberately
  scoped to every row `sinceTable` produces.
- **2.1, the deixis of `columnAccount`.** A reader might argue "above" and
  "this screen" are close enough on paper, since the CSV's own heading is
  "Where every check went". I think a printed report saying a figure is "above"
  when it is nowhere in the document is the class this repo keeps fixing, but
  it is the softest of the seven. *Overturned by:* a decision on record that
  the accounting lines are copied verbatim by design.
- **2.4, the since spreadsheet.** The finding most likely to be answered with
  "the button is new, the file is old, and Amendment 7 said so". My reading is
  that Amendment 7 justified reusing the *route* on grounds of the gate and the
  snapshot rows and never addressed the vocabulary - but it is a reading.
  *Overturned by:* a line in the PRD or the CHANGELOG saying the operator
  wording in that file is acceptable on a merchant path.
- **2.5, the disclosure element.** I proved Polaris `Collapsible` renders no
  children when closed under `renderToStaticMarkup`. I did **not** prove the
  screen is unusable in a real browser with hydration failed - that is an
  inference from the markup, and in practice Remix hydration rarely fails. The
  mockup note is unambiguous, which is why I filed it; the practical severity
  may be low, and the guard consequence in 4.1 may be the more important half.
  *Overturned by:* loading the screen with JavaScript disabled and finding the
  steps reachable.
- **4.3, the divergence guard.** I claim the assertion is satisfied by an
  incidental substring, and demonstrate it for one figure on one store. I did
  not construct a case where the two pages print genuinely *different* numbers,
  and I do not believe one exists today: the no-derivation structure is real.
  This is a finding about the guard, not about a live divergence, and should be
  costed as test hardening.
- **1.5 and 1.6** are called fragile rather than broken. If the standard is
  that a total function with a `?? "A"` fallback and a single-instance
  hard-coded reason are defects in themselves, both move up.
