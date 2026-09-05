# QA round 2: the merchant SEO dashboard, its printed report and its spreadsheets

5 September 2026. Round 1 (`QA-SEO-DASHBOARD-R1.md`) was not read, by
instruction. This round did not read the components and reason about them; it
rendered them and read what came out.

## What was run

Two throwaway vitest files were placed under `app/components/__tests__/`,
run once each, and deleted. Nothing in `app/` was changed at the end of the
round; the two components that were mutated for the guard test were restored
byte for byte (md5 `a7f5b08e...` for `SeoPrintReport.tsx`, `bad1ab26...` for
`SeoDashboardScreen.tsx`, and `git status` clean on both).

Rendered, to `/tmp/qa-r2/` (110 files): `SeoDashboardScreen` and
`SeoPrintReport` as static markup and as flattened text, plus `findings`,
`shopwide`, `listing` and `products` CSVs (with the BOM and CRLF the route
adds) and the `keyFigures` list, for twelve stores:

| Store | Shape |
|---|---|
| 01-fifty | the 50-product fixture from `seo-readiness.test.ts` (A15+B25 on four products) |
| 02-189 | 189 products, B12 on all, before and today snapshots, business blank, app embed reason |
| 03-20k | 20,000 products, 500 pages read |
| 04-empty | empty store |
| 05-neverran | 120 catalogue rows, no page ever read |
| 06-everycode | the "every code at once" store from `SeoPrintReport.test.tsx` |
| 07-b5 | 46 pages answered, 4 did not (B5), today snapshot |
| 08-b6 | B6 on every page, theme read carries no reason |
| 09-robots | never-ran store with `blockedBy: "GPTBot"` |
| 10-one | one product, handle `=cmd\|' /C calc'!A0` |
| 11-coll | 50 products with a collections queue, blog posts, both snapshots |
| 12-domain | `Republica-BIO.myshopify.com` as the domain |

A second run mocked React `useState` so every boolean state starts `true`,
which is the only way `Polaris.Collapsible` puts its children into static
markup; that produced `*-screen-expanded.txt` and the operator's
`since`/`written` CSVs the fifth button downloads.

Note on the fixtures: `seo-readiness.test.ts` and `SeoPrintReport.test.tsx`
each define "the five fixture stores" and the two 50-product and 20,000-product
stores differ (the readiness one adds A15+B25 and B2 rows). The PRD table
"What each file holds" (26/12/8/4, 380/120/0/0) matches the print-test set
only. Every figure below is quoted from the store named, so the two sets are
not mixed.

Vitest needed 95 to 98 s of module collection per run inside the 170 s cap, so
each run was one file. `check.bat` was not run; nothing was changed that would
need it.

## The decisions in CHANGELOG "Unreleased" that bind this round

Quoted where a finding argues against one:

- D1: "The then-and-now comparison is the fifth and is **not** a new route -
  it already exports from `/app/seo/export/since`, from the same two snapshot
  rows, behind the same gate." and "The two older export routes keep their
  existing names; renaming files people already have is not worth the
  consistency."
- D2: "The findings file says where every check went. It has 40 rows against a
  vocabulary of 44, so it appends the screen's own `columnAccount` lines under
  'Where every check went'."
- D3: "`CHECK_LABEL` is untouched and stays the operator's vocabulary, still
  read by `/app/seo`, the CSV export and the weekly diff."
- D4: "A row counted against a different total, silently. [...] It now carries
  its own line saying so, on the report and on the screen."
- D5 (test comment, `seo-readiness.test.ts` 262-271): a one-product read set
  puts every finding in the shop-wide card and calls the product clean, "and it
  is asserted here rather than left to be discovered."

## Verdicts

Verdict rule: BROKEN carries the artefact, the producing file and line, and a
command run or two quoted artefacts that contradict. UNVERIFIABLE says what
would settle it. Costs are files touched; none of the fixes below needs a
migration.

### Class 1. Sentences written for the screen, printed where their referent is absent

Root cause: `columnAccount` (`seo-readiness.ts` 1119, 1139, 1145-1146),
`shopWideMethod` (`seo-readiness.ts` 713) and `listingMethod`
(`seo-readiness.ts` 994) fix their referent ("above", "the foot of this
screen", "the shop-wide card above") inside the service, and three renderers
with three different layouts print the same string. Every member enumerated:

**R2-01 BROKEN.** Paper, every store with figures (01, 02, 03, 07, 10):
"Nothing affects every product the same way, so there is nothing to do once
here. Anything found is against the products it was found on, above." is
printed inside "Where this shop stands today" (`SeoPrintReport.tsx` 150 via
`keyFigures`, string from `seo-readiness.ts` 713). On paper the groups it
points at come after it (`SeoPrintReport.tsx` 460-461: `Figures` then
`Groups`). Quoted from `01-fifty-print.txt` line 17; the first group heading
"Nothing to fix - 22 of 50" is line 21. On the screen the shop-wide card is
below the groups, so "above" is right there and wrong on paper.

**R2-02 BROKEN.** Same sentence on the screen for stores with no read set
(04-empty, 05-neverran, 09-robots): "Anything found is against the products it
was found on, above." while the groups are not rendered at all
(`SeoDashboardScreen.tsx` 673 renders the panels only when `readSet > 0`).
`04-empty-screen.txt`: the "How ready your shop is" card holds one sentence and
no group.

**R2-03 BROKEN.** `shopwide` CSV, 04-empty (`seo-report.ts` 384):
line 2 is the same sentence ending "above"; line 1 is the heading. Nothing is
above.

**R2-04 BROKEN.** Paper, every store: "2 checks count something and state no
verdict, so they are at the foot of this screen instead." and "1 check counts
your blog posts rather than your product pages, so it carries its own total
above." and "3 checks count your collections rather than your products, so they
carry their own total above." (`SeoPrintReport.tsx` 417-421, strings
`seo-readiness.ts` 1139-1146). The print report renders no theme-node card, no
blog row and no collection rows (`SeoPrintData` carries none of `themeNodes`,
`blogPosts`, `collections`). `02-189-print.txt` lines 137-141 carry all three
sentences; the document ends at "What has changed since we started".

**R2-05 BROKEN.** `findings` CSV, every store, under "Where every check went"
(`seo-report.ts` 345-352): the same three sentences, "at the foot of this
screen" and "own total above", in a file. D2 decided the accounting lines belong
in the file, and that is right: 40 rows against 44 codes needs the explanation.
The argument against D2 as shipped is only that the lines are the screen's
verbatim, and the screen's referents do not exist in a spreadsheet. Quoted from
`02-189-findings.csv`, last eight lines.

**R2-06 BROKEN.** Screen, stores where `blogPosts` is null or `read === 0`
(01, 02, 03, 04, 05): "1 check counts your blog posts rather than your product
pages, so it carries its own total above." (`seo-readiness.ts` 1146) while
`BlogRow` returns null (`SeoDashboardScreen.tsx` 989). `01-fifty-screen.txt`
line 77 carries the sentence; no blog line exists on the screen.
`blogPostReport` in `seo-page.server.ts` returns null before the first B30 run
(lines 476, 481), so this is the state every shop is in on day one. The
collections case does the opposite and prints "Your collections have not been
checked yet" (line 942-946), so the two are asymmetric on the same card.

**R2-07 BROKEN.** Screen, 05-neverran and 09-robots: the Google card's method
line says "so those 4 are in place on all 120 of your products and are counted
in the 4 of 10 above" (`seo-readiness.ts` 994). The KPI tiles that carry "4 of
10" render only when `readSet > 0` (`SeoDashboardScreen.tsx` 614). `grep "4 of
10" 05-neverran-screen.txt` returns exactly one line, the method sentence
itself (line 67).

**R2-08 BROKEN.** Screen, 04-empty, 05-neverran, 09-robots: "The dial is drawn
against your whole catalogue, and a product joins one of the four groups only
once ..." (`SeoDashboardScreen.tsx` 699) prints under a card that renders no
dial (`HeroDial` is inside the same `readSet > 0` branch, line 675).

Fix cost for the class: give `columnAccount`, `shopWideMethod` and
`listingMethod` a `surface` argument (`"screen" | "paper" | "file"`) or have
them return the referent separately, and thread it from the three renderers:
`seo-readiness.ts`, `seo-report.ts`, `SeoPrintReport.tsx`,
`SeoDashboardScreen.tsx`, and the three tests that assert the strings
(`seo-readiness.test.ts`, `SeoPrintReport.test.tsx`,
`SeoDashboardScreen.test.tsx`). Seven files, no migration. R2-06 alone is one
line in `BlogRow` (return the not-yet sentence instead of null).

### Class 2. The paper's headline strip changes shape by store, and on two shapes says the wrong thing

Root cause: `keyFigures` appends the four group figures unconditionally
(`seo-report.ts` 186-194) and `Figures` prints `figures.slice(0, 4)`
(`SeoPrintReport.tsx` 145). When the read set is empty the strip is filled
with whatever comes next.

**R2-09 BROKEN.** Paper, 04-empty: "Where this shop stands today" is four
tiles reading "0 / Nothing to fix / of 0", "0 / You can fix these yourself,
no developer / of 0", "0 / These need a change to your theme / of 0", "0 / We
can fix these, once you have read them / of 0" (`04-empty-print.txt` lines
6-18), and the groups section repeats "Nothing to fix - 0 of 0" four more
times. The screen for the same store prints one sentence: "No product has been
fully checked yet, so there is nothing to group." (`SeoDashboardScreen.tsx`
664). Eight "0 of 0" on paper against one sentence on the screen is the "zero
instead of a sentence" rule the CHANGELOG cites twice, and it is the store the
acceptance table calls "an empty store, where nothing may divide by zero".

**R2-10 BROKEN.** Paper, 05-neverran: the strip is "4 of 10 details Google
asks for" followed by three of the four groups ("Nothing to fix 0 of 120", "You
can fix these yourself 0 of 120", "These need a change to your theme 0 of 120")
and the fourth group is cut by the slice (`05-neverran-print.txt` lines 6-18).
A four-way partition is presented with three parts. Each group is then headed
"Nothing to fix - 0 of 120 / No product is clear of everything yet."
(`seo-readiness.ts` 286): on a store where no page was read, "no product is
clear of everything" reads as "every product has something wrong", which is
the opposite of what the screen says for the same store ("nothing to group").

Fix cost: `keyFigures` emits the group figures only when `readSet > 0` and a
single sentence figure otherwise; `Figures` drops the slice. Two files
(`seo-report.ts`, `SeoPrintReport.tsx`) and the print test.

### Class 3. Numbers that do not add up on paper because the paper omits the fifth band

Root cause: the screen's `Segments` bar has a "Not checked yet" band and a
sentence in `ReadWarnings`; the paper has neither.

**R2-11 BROKEN.** Paper, 03-20k: "300 products with nothing of their own to
fix, of 20000" and "200 products needing something specific, of 20000"
(`03-20k-print.txt` lines 7-13). 300 + 200 = 500; the other 19,500 appear
nowhere on the page as a number. The heading "500 of 20000 products fully
checked" is the only clue, and the clean tile's method line explains the rule
without giving the count. Same on 07-b5: 26 + 20 = 46 of 50, and the 4 are
only recoverable from the B5 row three sections later. The screen prints "Not
checked yet 19500 of 20000" (`03-20k-screen.txt` line 25) and "19500 of 20000
products have been read from your catalogue but their live page has not been
opened yet" (line 4).

Fix cost: one figure or one sentence in `keyFigures` when `notChecked > 0`
(`seo-report.ts`), which the screen would then also print from the same list.
One or two files.

### Class 4. The fifth spreadsheet is the operator's file, offered on the merchant's screen

Root cause: D1 reused `/app/seo/export/since` for the "Spreadsheet: then and
now" button (`SeoDashboardScreen.tsx` 1484-1488) without changing what that
route writes.

**R2-12 BROKEN.** The file the button downloads, rendered from the 06 store
(`06-everycode-since.csv`):

```
Snapshot taken,2026-08-15T08:00:00.000Z,by unlock,Today's figures from,2026-09-04T03:45:00.000Z
Figure,At the snapshot,Out of,Today,Out of,Difference
Pages where the theme emits a Product node,not read at the time,0,not read,0,Never read
A5: Meta title or description absent,not read at the time,189,3,189,No page had been read at the time
"B12: No H1 on the page, more than one, or an H1 that is the shop logo",...
Products with a barcode (GTIN),0,189,0,189,No change
Meta titles written by this app,0,189,0,189,No change
```

"Product node", "Meta title", "H1", "GTIN", check codes as row prefixes, and
"by unlock": every word the guard bans, plus the codes, in a file reached from
the merchant screen. `sinceCsv` (`seo-since.ts` 511-533) reads
`FIGURE_LABELS` (lines 66-91) and `CHECK_LABEL` (line 180), which D3 defines as
the operator's vocabulary. The mockup note reads "Check codes never appear on
this screen; they stay in the CSV and the operator view", written when there
was one CSV; there are now five and one of them is that CSV.

D1 is argued against only in part: reusing the route is sound; what the route
writes is not merchant output. The argument is D3's own: if `CHECK_LABEL` is
the operator's vocabulary, a button on the merchant dashboard cannot hand it
over.

**R2-13 BROKEN.** The caption under the five buttons: "Every file carries the
figures on this screen, from the same reads, with the shop and the date in its
name." (`SeoDashboardScreen.tsx` 1496-1497). The fifth file is
`ai-visibility-seo-since.csv` (`app.seo.export.$table.tsx` 81), no shop, no
date, by D1's own choice. The mockup note "Filenames carry the shop and the
date, so three of these on a desktop can be told apart" is stated for the five
buttons and true of four. The caption is on the screen only when the fifth
button is (both need `before`), so the two are never apart.

Fix cost, two routes: (a) a merchant `since` table in `seo-report.ts` using
`ownerSinceRows` (already exists, `seo-since.ts`) and `exportFilename`, added
to `EXPORT_TABLES` in `app.seo_.dashboard.export.$table.tsx`, and the button
repointed; three files. Or (b) keep D1 and change the caption to say which
file differs; one file. No migration either way.

### Class 5. Two guards that cannot fail on what they are for

**R2-14 BROKEN.** The screen half of the vocabulary guard
(`SeoPrintReport.test.tsx` 371-377) never sees the group steps.
`Polaris.Collapsible` with `open={false}` renders no children, so
`renderToStaticMarkup` of `SeoDashboardScreen` contains no `row.what`,
`row.where` or the bold step line. Measured: `01-fifty-screen.txt` is 127
lines, the same store with `useState` forced true is 142 lines and the
difference is the steps ("1. 12 of 50: products with very little text on the
page. Anything you add ...").

Mutation run: `SeoDashboardScreen.tsx` 519 changed to print `${row.code}`
inside the step line, a check code in the merchant's face once the group is
opened. All six "keeps the screen free of it on ..." tests passed. The print
half of the same guard, mutated at the same time by reintroducing `row.label`
at `SeoPrintReport.tsx` 399, failed on five of six stores as the CHANGELOG
says. So the paper guard holds and the screen guard is blind to everything
behind "What to do".

Fix cost: render the screen in the guard with the groups open (a prop
`defaultOpen` on `GroupPanel`, or the `useState` mock this round used);
`SeoDashboardScreen.tsx` and `SeoPrintReport.test.tsx`.

**R2-15 BROKEN.** The cross-render guard (`SeoPrintReport.test.tsx` 195-211)
asserts `expect(paper).toContain(figure.value)` on flattened text. A value of
one or two digits is contained by almost any page: "5" is in "50 of 50", "22"
is in "Nothing to fix - 22 of 50" even when the KPI tile says something else.
Mutation run: `SeoPrintReport.tsx` 147 changed to print "5" for the clean KPI
(true values 22, 126, 300 on the three populated stores). All five "prints the
same headline figures on ..." tests passed. The `of` string is asserted on
paper only (lines 207-209), never on the screen, so a divergent denominator on
the screen is not caught either. The CHANGELOG's sentence "the promise is
structural rather than intended, because neither page computes a figure" is
true of the code; it is not true of the test, which is presented in the
acceptance table as the thing that proves it.

Fix cost: assert on the figure block (`value` adjacent to `label`, e.g.
`${value} ${label}` in the flattened text) rather than on the bare value, and
assert `of` on both renders; one test file.

### Class 6. The screen contradicts itself on pages that answered with an error

**R2-16 BROKEN.** Screen, 07-b5, two consecutive sentences in `ReadWarnings`
(`SeoDashboardScreen.tsx` 924-933): "46 of 50 pages read; 4 more could not be
read; every page is up to date." then "4 of 50 products have been read from
your catalogue but their live page has not been opened yet, so they are counted
in none of the four groups below." The four pages were opened and answered
with an error (`status: "error"`); `awaitingPage` counts every catalogue row
outside the read set (`seo-readiness.ts` 155), so an error page is reported as
never opened. Then a third sentence says "4 of the pages we asked for did not
answer". Three sentences, one fact, two of them true.

Fix cost: split `awaitingPage` into never-opened and could-not-be-read in
`foldReadinessRow`, or word the sentence as "not yet fully checked";
`seo-readiness.ts`, `SeoDashboardScreen.tsx`, `seo-readiness.test.ts`.

### Class 7. The CHANGELOG describes a screen line that does not exist

**R2-17 BROKEN.** D4: "It now carries its own line saying so, on the report and
on the screen." `rowScopeNote` is imported and rendered by
`SeoPrintReport.tsx` (49, 410) and by nothing else: `grep rowScopeNote
app/components/SeoDashboardScreen.tsx` is empty. `07-b5-fourunread-screen.txt`
lines 61-67: "Found on the live page - 46 pages opened ... Pages that could
not be read the way a search engine reads them / 4 of 50" with no line
explaining the 50 in a 46 column. The paper has the line ("is counted out of
50, not 46", `07-b5-fourunread-print.txt` line 110). The PRD acceptance row
tests it "on a store with 46 pages read" through the report only. Finding
against the CHANGELOG, or a one-line omission in the screen: `FindingsCard`'s
B column, plus the screen test.

### Class 8. Words a shop owner would have to look up, on merchant surfaces

Each is an instance; they share no producer.

**R2-18 BROKEN.** Screen and paper, every store without a before snapshot (01,
03, 04, 05, 07, 08, 09, 10, 12): "No before snapshot exists for this shop: the
setup code was applied before this app recorded one. Until an operator takes
one, this card can say what the store looks like today but not what changed."
`NO_SNAPSHOT_SENTENCE`, `seo-since.ts` 277-279, rendered `SeoPrintReport.tsx`
299 and the screen's `SinceCard`. "Snapshot", "setup code", "operator": a
merchant does not know what an operator is, or that they cannot take one. On
paper it is also "this card".

**R2-19 BROKEN.** Screen, 09-robots: "Your robots.txt disallows GPTBot, so no
product page is fetched and none of the page checks below can run. robots.txt
lives in your theme as robots.txt.liquid." `pagesReadSentence`,
`seo-aggregate.ts` 550-555, rendered `SeoDashboardScreen.tsx` 924. "robots.txt",
"disallows", "robots.txt.liquid", and no instruction a merchant can act on.
The paper for the same store says only "No product page has been read yet."
(`SeoPrintReport.tsx` 450) and carries no cause, so the document a merchant
hands to a developer omits the one fact the developer needs.

**R2-20 BROKEN.** Screen, 04-empty: "No products have been read into this
table yet, so there are no pages to fetch and none of the checks below can
run. Run Fill catalogue on the dashboard first; the nightly page read starts
the night after that." `seo-aggregate.ts` 539-544. "This table" on a screen
with no table; "the dashboard" from a screen titled SEO dashboard (the button
is on `/app`, `dashboard-steps.ts`). The sentence was written for the operator
workspace and is reused unchanged.

**R2-21 BROKEN.** Screen, group steps once opened (`SeoDashboardScreen.tsx`
519, `row.label.toLowerCase()`): "products with no title or description for
google", "products that show no preview card on x", "extra details on the page
that google no longer shows" (`06-everycode-screen-expanded.txt` lines 39, 88,
94). Lower-casing a label lower-cases the proper nouns in it.

**R2-22 BROKEN.** Paper and screen steps, B2: "Same file, same visit. The
report names the exact line." `OWNER_STEPS.B2.where`, `seo-findings.ts` 602.
In the mockup this line followed the B25 step and "same file" meant that one;
on the built screen rows are ordered by count, so on 01-fifty B2 (8) precedes
B25 (4) (`01-fifty-print.txt` lines 46-48) and "same file" precedes the file.
"The report names the exact line": this report names no line for any product;
the printed report lists no products at all (see R2-25).

**R2-23 BROKEN.** `findings` CSV, a shop-wide row: State reads "Found on some
products - on every product we read, so it is one fix for the whole shop"
(`seo-report.ts` 250 and 334-336). "Some" and "every" in one cell.
`02-189-findings.csv` row 1 (B12).

**R2-24 BROKEN.** Paper 10-one: "1 products with nothing of their own to fix",
"flagged all 1 of the products", "on all 1 of your products"
(`seo-report.ts` 148, `seo-readiness.ts` shopWideMethod and 994). D5 binds the
substance (a one-product read set is all shop-wide) and is not argued against;
the grammar is the finding.

Fix cost: R2-18 to R2-20 are one sentence each in `seo-since.ts` and
`seo-aggregate.ts` (the aggregate ones would need a merchant variant, since
`/app/seo` also prints them); R2-21 one line; R2-22 one string; R2-23 one
conditional; R2-24 a plural helper in two files.

### Class 9. Documents asserting properties that were not built

**R2-25 BROKEN.** `mockup-seo-dashboard.html` 300 and 325: "The printable
report lists every affected product by name, so you can work through it
without coming back to this screen." and "send them the printable report: it
names the change for each one". The printed report names no product on any of
the twelve stores (`grep -c "p-0" *-print.txt` is 0 everywhere); products are
only in the `products` CSV, by handle, never by name (`seo-report.ts` 496-501
says so and why). The built screen's foot says "each line above names the
change and where it is made" instead, which is true; the mockup was not
updated for that line.

**R2-26 BROKEN.** Mockup note: "The expandable steps use a native disclosure
element, not JavaScript state, so the screen still works if hydration fails."
Built: `useState(false)` plus `Polaris.Collapsible` (`SeoDashboardScreen.tsx`
455, 509), which is JavaScript state, and the closed children are absent from
the server markup, so without hydration "What to do" is a button that does
nothing and the steps do not exist on the page. This is also why R2-14 is
possible. The same note continues "In Polaris this is Collapsible with a
button", which contradicts its own first clause; the built code followed the
second clause.

**R2-27 BROKEN.** CHANGELOG (4 September): "on a 20,000-product store the
screen reads '500 of 20,000 products fully checked'". Screen and paper read
"500 of 20000" (`03-20k-screen.txt` line 2, `03-20k-print.txt` line 2). No
figure anywhere on the three surfaces carries a thousands separator. Against
the document, or a `toLocaleString` at the three header sites.

**R2-28 BROKEN.** CHANGELOG: "On the store whose pages were never read, all 31
page checks export 'Not checked yet'". `05-neverran-findings.csv` has 30 such
rows; B30 is not in `CHECKS` and is not a row (`grep -c "Found by reading your
pages" ` = 30). The PRD table says "the 31 page checks each" too. Against the
documents; the file is right.

### Class 10. The paper omits things the screen states, without saying so

**R2-29 BROKEN.** Paper 02-189 and 11-coll, the since table: the screen prints
"9 figures are unchanged." (`seo-since.ts` 235) under a three-row table; the
paper prints the same three rows and nothing about the other nine
(`SeoPrintReport.tsx` 303 uses `ownerSinceRows(sinceTable(...))`, which drops
`unchanged` and `unchangedLine`). A reader of the paper cannot tell whether
the barcode row is the only figure or the only one that moved. The screen's
"Written by this app since then" block is absent from the paper as well.
`02-189-screen.txt` line 77 against `02-189-print.txt` lines 152-169.

Fix cost: one line in `Since` on the print page.

### HELD

- H1. Every number that appears on more than one artefact for the same store
  agrees: heading, KPI values, group counts, listing counts, shop-wide rows and
  their `appliesTo`, the four CSV first lines. Checked by reading, on all
  twelve stores.
- H2. The four groups sum to the read set and, with `notChecked`, to the
  catalogue, on every store rendered (22+16+8+4=50; 126+38+14+11=189;
  300+120+80+0+19500=20000; 26+20+0+0+4=50).
- H3. `findings` CSV: 40 data rows on every store (csv-parsed, not line
  counted: one B12 cell holds a comma-quoted string that made a naive `wc`
  read 39). 04-empty: every count and denominator is a sentence. 05-neverran:
  every page-check row is "Not checked yet / No product page has been read
  yet".
- H4. `products` CSV row counts match the sum of finding counts (275 on
  02-189, 2 on 10-one), and the second line states the count in words.
- H5. Formula guard: handle `=cmd|' /C calc'!A0` exports as
  `'=cmd|' /C calc'!A0` in the first column; the path column begins with `/`.
- H6. Encoding: every file starts with EF BB BF, every line ends CRLF, header
  says `text/csv; charset=utf-8`.
- H7. Filenames for the four new tables: `ai-visibility-seo-republicabio-ro-
  findings-2026-09-05.csv` etc.; `Republica-BIO.myshopify.com` becomes
  `republica-bio`; four tables on one desktop are distinguishable by table and
  by date.
- H8. Paper prints `BASIS_WORD` words, never `byConstruction` etc.
- H9. Paper: no `aria-expanded`, no "Polaris", `break-inside: avoid`,
  `@page`, `.noprint` hidden; the Print frame note is present.
- H10. The B5 line "is counted out of 50, not 46" is on paper (07).
- H11. Shop-wide rows: A1 reads "at least one of" and names "Already on every
  product: a brand" with per-detail counts; B25 reads "One change to the
  theme"; the delivery row "Filled in once, on one screen".
- H12. The `row.label` guard on paper fails on five of six stores when the
  defect is reintroduced (run, see R2-14).
- H13. The listing figure is omitted from `keyFigures` when unmeasured, and
  paper and screen print `LISTING_UNMEASURED_SENTENCE` (04).
- H14. Paper for the unlocked-false case prints one sentence and no figure.
- H15. B6 with no recorded reason says "We cannot say ... The next nightly page
  read settles it" on both surfaces (08); with a reason, names it once (02
  screen, print test).
- H16. The `since` button and its caption are absent when there is no before
  snapshot (01, 03, 04, 05, 07, 08, 09, 10, 12).
- H17. The route's 404 and 402 sentences are plain text with the right status
  (read, not run).
- H18. D5 (one-product store): behaves as recorded. Not argued against.

### UNVERIFIABLE

- U1. Page count of the printed report, and whether `window.print()` opens a
  dialog inside the Shopify admin frame. Needs a browser in the admin.
- U2. Whether a real store can show the Google card's brand/barcode counts
  disagreeing with the A1 row (the 02 fixture has `withBarcode: 4 of 189` in
  the snapshot and A1 clean on every product, which the app's own reads may
  never produce). Would be settled by `npx tsx scripts/audit-engine-run.ts` or
  the dev store with both passes run the same night.
- U3. Whether the rolling `today` snapshot can lag the scan table so the
  header says "189 of 189 products fully checked" while the since table says
  pages "not read" (02 paper lines 2 and 160-169; the fixture forced it).
  Settled by reading `readCurrentFacts` timing against the nightly order.
- U4. Excel on Windows opening the files with Romanian text intact: BOM is
  present; the by-hand row in the PRD is still open.
- U5. Layout at 375 px and the collapsible groups being operable there: no
  browser.
- U6. The 06 "every code at once" store places A6, A10, A11 and B30 on product
  rows and the readiness groups then print "5 of 12: collections with little or
  no description" as a product count. `seo-page.server.ts` gives B30 no product
  row and the collection codes are computed in `seo-collections.server.ts`, so
  this looks like a fixture-only shape; whether a scan row can ever carry one
  of those four codes would settle whether `groupsOn` needs to exclude them.

## Counts

BROKEN 29 (R2-01 to R2-29), HELD 18, UNVERIFIABLE 6.

## Where I might be wrong

- R2-01/R2-02/R2-05: "above" may be read as "earlier in the process" rather
  than "earlier on the page". If Marius reads it that way, these are wording
  preferences and not referent errors. The screen's own `shopWideCrossReference`
  takes a `"below" | "above"` argument, which suggests the author meant
  position, and R2-04 ("the foot of this screen") cannot be read any other way.
- R2-09/R2-10: the acceptance table says "Empty store ... 0, 0, 0, 0, each of
  0" for the group headings and calls that correct. If "0 of 0" in a group
  heading is accepted there, the KPI strip repeating it may be accepted too;
  the finding then reduces to the strip showing three groups of four on 05.
- R2-12: D1 may have been taken knowing the file is the operator's, with the
  merchant expected to tolerate it until a rewrite. The CHANGELOG does not say
  so, and the mockup note says the opposite, which is why it is listed.
- R2-14: a reviewer may hold that the record-level guard in
  `seo-readiness.test.ts` covers the steps. It covers `OWNER_STEPS`; it does
  not cover what the component prints beside them (the mutation used
  `row.code`, which is not in any record), so the two guards together still let
  the mutation through.
- R2-15: the guard was described as proving the wiring, not as catching a
  divergent figure. Under that reading it holds. The acceptance row it backs
  reads "cannot diverge", which is the reading used here.
- R2-16: on a shop where every non-read page really is unopened, the two
  sentences agree; the contradiction needs at least one error page, which the
  dev store has had ("could not be read" states exist in the aggregate). If
  error pages are rare in practice, the cost of the finding is low.
- R2-26: "native disclosure element" may have been overtaken by amendment 4
  (Built for Shopify on Polaris components) without the note being struck. It
  is still in the mockup as a requirement, so it is listed against the
  document.
- R2-27/R2-28: document nits. Listed because the brief says a document that
  describes something other than what shipped is a finding, not because they
  cost anything.
- The fixtures: the two "five fixture stores" differ, and some findings (the
  22/28 split) quote the readiness set. Every quote names its store, and no
  finding depends on which set was used.
