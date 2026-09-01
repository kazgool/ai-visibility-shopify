# SEO-WORKSPACE-PRD - from a diagnostics screen to a place where work happens

Written 31 August 2026, replacing the first attempt at `app/routes/app.seo.tsx`,
which shipped the same day and was rejected for a precise reason: it scans,
counts and reports, and the merchant cannot act on anything it says. The Meta
fields tab listed products with "Empty / Empty" under the sentence "we never
write them". Marius: "pare ca nu am ce sa fac aici", and about his client,
"clientul o sa vada ca nu am facut nimic". A screen whose every finding ends in
a dead end is not a workspace; it is a bill for looking.

This document specifies the replacement. It does not restate what other specs
already settle: numbers carry denominators and methods (EXPERIENCE-PRD §2),
empty states explain the pipeline (§6), the three refusals stand (§9b, §9c),
and §10's refusal list is not reopened here. The `state` provenance mechanism
in `facts.server.ts` and the product editor is the foundation, not a pattern to
reinvent. CLAUDE.md's hard rules all apply; the ones that bite here are named
where they bite.

The commercial frame drives everything below. The SEO capability is switched
on per shop by an operator-held key during a paid setup engagement invoiced as
services, on top of the merchant's separate annual subscription. Two audiences:
the operator, who must find what is broken, fix it in bulk, and hand over a
before-and-after; and the merchant, who must afterwards see what was done,
change any single item he disagrees with, and keep it current as the catalogue
grows. The first attempt served neither. This spec serves both, in different
places, and says why the split is the right one.

---

## 1. The decision: fold merchant actions into the product screens, keep one operator workspace

The owner posed the question directly: fold into the existing AI screens, or
build a separate detailed workspace. The answer is some of each, split by
audience, and the split follows the interaction model rather than tidiness.

**Everything a merchant does per product folds into the screens the merchant
already has open.** The product editor (`app.products.$id.tsx`) is where this
app already lets a person review a generated value, edit on top of it, and
have the edit protected forever - summary, questions, attributes, alt text all
work this way, with a source badge and a reset. A merchant who disagrees with
one meta description will find that product the way he finds everything else:
Products list, row, editor. Sending him to a second screen with its own list
of the same products, to edit a different field of the same product, is the
confusing option, not the split. So the meta title and meta description become
one more card in the product editor, working exactly like the summary card,
and the Products index gains one column and one filter so the state of the
catalogue is visible where the catalogue already lives.

**Everything the operator does in bulk stays at `/app/seo`, rebuilt as a
workspace rather than a report.** The operator's job - review two hundred
generated meta descriptions, apply the acceptable ones in one pass, snapshot
before and after, produce the handover - has no home in the product screens
and would wreck them if forced in: the Products index is a per-product surface
paged 25 at a time, and a bulk review queue is a different interaction (scan,
approve, skip, apply) with a different unit of work (the batch, not the
product). The existing scan, conflicts, missing-node reasons and crawl checks
also live here, demoted from being the product to being the evidence (§6).

The split is not confusing because there is exactly one storage and one
provenance mechanism underneath both. A meta description applied from the
operator workspace and one saved in the product editor land in the same
Shopify field with the same state entry; each screen shows the same source
badge; a value edited by hand in the editor becomes invisible to the
workspace's bulk pass by the same `mayWrite` rule that already protects
summaries. Two doors, one room. The rule for what goes where is statable in
one sentence and appears on both screens: **act on one product where that
product lives; act on many products, and read the evidence, in the SEO
workspace.**

What does not happen: no fifth tab of read-only tables, no duplicate of the
Diagnostics crawler check (it stays on Diagnostics; the workspace links to its
stored verdict), no duplicate of the dashboard's coverage fractions.

## 2. The line on generation, drawn before anything else

The product publicly refuses to write blog posts or product copy
(EXPERIENCE-PRD §9b), and a meta description generator is the feature most
likely to become that by another name. So the line is drawn here, once, and
every generation rule in §3 is checked against it.

**On the honest side:** a meta title and meta description condensed from the
product's own title, description and extracted facts, by the same
deterministic engine that already builds the summary (`app/engine/summary.ts`
- `buildSummary` is literally this operation with a different length budget).
Every word either appears in what the merchant wrote or is a structural
connective ("Key details:", price formatting). Nothing is invented, no model
is called, and the same input always produces the same output. The argument
that makes writing these fields consistent with the product's ethics, adopted
from the owner: Shopify's own fallback for an empty meta description is a
crude truncation of the body, so the alternative to our condensation is not
purity, it is a worse condensation done by nobody.

**On the dishonest side, and refused:** a meta description written to target
a keyword the merchant never mentioned; a title rewritten "for CTR"; any
template that inserts benefit language ("Best", "Top quality", "Buy now")
that the merchant did not write; anything produced by a model call. If a word
in the output cannot be pointed to in the merchant's own text or in a fact
the dictionary extracted from it, the generator is broken and the fix is to
remove the word, not to defend it. This is the same rule the summary already
lives under ("no model, no invention" - summary.ts header) and the generator
must live in `app/engine/` precisely so the fixture-style tests can enforce
it: pure function, product text in, string out, no I/O (CLAUDE.md engine
rule).

One consequence stated plainly: our meta descriptions will sometimes be
duller than a copywriter's. That is the product working. The operator selling
the engagement sells "your own words, condensed and placed where engines read
them", not "we write your marketing".

## 3. Meta title and meta description - generate, review, write, protect, revert

### 3.1 Where the value lives, and the mechanism gap that creates

Unlike every field this app has written so far, `Product.seo.title` and
`Product.seo.description` are Shopify's own fields, not `$app` metafields.
They are written with the `productUpdate` mutation's `seo` input (GraphQL
only, as always). Two consequences, both load-bearing:

- **Provenance still lives in our `state` metafield**, under two new keys,
  `seo_title` and `seo_description`, with the exact `FieldState` shape
  facts.server.ts already defines. `mayWrite` semantics carry over unchanged
  and give us the human-protection rule for free: an entry with
  `source: "human"` blocks writing, and - the clause that matters most here -
  **a non-empty value with no state entry is treated as human**, because it
  came from somewhere else (the merchant, a previous SEO app, an import).
  On a catalogue where products already have meta fields set, the bulk pass
  therefore touches none of them unless the operator explicitly overrides per
  product. This is not new mechanism; it is the existing rule meeting a new
  key, which is the whole point of reusing it.
- **Revert needs its own support, and this is a new decision.** For `$app`
  metafields, "revert" means delete ours and Shopify falls back to nothing,
  which is the pre-install state. For `Product.seo` there is a prior value we
  may be replacing (usually empty, but not always, when the operator
  overrides). So: before the first write this app ever makes to a product's
  seo fields, the prior values are recorded in the state entry itself -
  `state.seo_title = { source: "auto", at, engine, prev: <old value or ""> }`.
  Revert writes `prev` back via the same mutation and deletes the state
  entry. `prev` is captured only on the first write and never updated by
  subsequent regenerations, so revert always means "as it was before this app
  touched it". Reason for putting `prev` in state rather than a new metafield:
  it survives our uninstall with the rest of the merchant's data (CLAUDE.md:
  merchant data lives in Shopify metafields), and it keeps one JSON blob per
  product instead of two.

Uncertainty, named: the exact `productUpdate` input shape for seo
(`ProductInput.seo` / `SEOInput`) and its behaviour when only one of the two
subfields is passed must be checked against the current Admin API docs before
this is promised in code - APIs moved fast and the safe assumption is that
both subfields should always be sent together, reading the untouched one
first.

### 3.2 The webhook trap, named where it bites

`productUpdate` fires `products/update`, which this app subscribes to, which
queues extraction. This is the self-feed storm shape (CLAUDE.md rule 3) on a
new path. Two guards, both required: the writer never writes an identical
value (same `unchanged` check as `writeFacts`, reimplemented for the seo
writer since the value is read from `Product.seo`, not metafields); and the
extraction the webhook queues does not itself write seo fields on the
automatic path (§3.5), so even a triggered cycle terminates after one
no-op pass. New writers follow the load-bearing principle, verbatim from
CLAUDE.md: never write an identical value.

### 3.3 Generation, in the engine

Two new pure functions in `app/engine/` (suggested module `meta.ts`), taking
the same `CapsuleInput`-style shape the summary takes, returning strings that
have passed through `cleanOutput` (plain characters rule - imported
catalogues are full of entities, and a meta description with `&#8211;` in a
search result is the exact failure the rule exists for):

- **Meta title**: the cleaned product title, with the vendor or shop name
  appended when it fits the budget (that is condensation of existing data,
  not invention: both strings are the merchant's). Target length around 50 to
  60 characters; when the title alone exceeds it, the title is truncated at a
  word boundary, never mid-word, never with an ellipsis character. The exact
  cutoffs are pixel-based at Google and character counts are a proxy; the
  method line on screen says "aiming for under 60 characters" and states the
  actual length, it does not claim a guarantee about display.
- **Meta description**: `buildSummary` with a tighter word budget is the
  starting point, but not a blind reuse - the summary is tuned to be quoted
  by an assistant and includes price, which goes stale in a meta description
  cached by search engines. New decision: the meta description variant
  excludes price and availability and is built from the description's opening
  sentence plus up to three ordered facts, targeting roughly 140 to 160
  characters, truncated at a sentence or clause boundary. Same ingredients,
  different dish; both deterministic.

Both functions get tests including the three-fixture catalogue texts where
applicable, and both are the single source of the value everywhere - editor
preview, bulk queue, and any future path. Generation logic in the engine,
everything else out of it.

### 3.4 Per-product: the card in the product editor

A new card in `app.products.$id.tsx`, "Search listing (meta title and
description)", modelled line for line on the summary card:

- Two text fields, prefilled with the current live `Product.seo` values.
- A source badge per field using the existing `SourceBadge` semantics:
  "Edited by you" (human state), "Automatic" (our auto state), and - the new
  case - "Set outside this app" for a non-empty value with no state entry,
  plus "Not set" for empty. "Not set" is never a bare dash: the line under it
  says what Shopify does with an empty field ("Search engines currently see a
  truncated copy of the description") and that Generate fills it - the §6
  empty-state rule applied to this screen.
- A "Generate" button per field that fills the text field with the engine's
  output **without writing anything** - the merchant or operator reads it,
  optionally edits it, and presses Save. Save writes via §3.1 and marks the
  state `human` if the text differs from the engine output, `auto` if it is
  the untouched generated value. This mirrors how the alt-text "Use this"
  suggestion already works and is the review-before-write step: on this
  surface, nothing reaches Shopify unseen.
- A "Revert to before the app" action, shown only when a `prev` exists,
  doing §3.1's revert. Distinct from the reset-to-automatic action, which
  clears the human flag so the next pass may regenerate.
- Character counts live under each field, stated as counts, not verdicts.

This card appears for every shop where `seo_unlocked` is on, and the loader
and action both check the entitlement (§7) - the card is per-product
regeneration, which the owner asked for explicitly, living where the product
lives.

### 3.5 Bulk: the review-and-apply queue in the workspace

The operator's tool, and the heart of the rebuilt `/app/seo`. Not a table of
findings; a queue with an exit.

- **Coverage first, honestly counted.** The audit runs over the whole
  catalogue via the existing bulk operation (`fetchAllProducts` already
  fetches `seo { title description }` - the data is in hand today and
  discarded). The first attempt checked 50 of 355 with a paged query; the
  bulk export removes the cap without rate-limit cost. Headline line:
  "212 of 355 products have no meta description. 41 have one written outside
  this app; those are never touched." Denominator, method, and the protection
  rule in one glance.
- **Generate previews for every product where `mayWrite` allows it.** The
  queue shows one row per product: title, current value (or the honest empty
  state), proposed value, character count. Rows where the value is protected
  (human or unattributed) appear in a separate collapsed section labelled
  with the reason, not silently dropped - a filter that hides value silently
  is the DICTIONARY-PORT §10.1 failure in UI form.
- **Review is per-batch with per-row exclusion.** The operator scans the
  page, unticks any row whose proposal reads badly, and presses "Apply to N
  products". Each applied row writes value plus state (`source: "auto"`,
  `prev` captured) through the same writer as the editor. There is no
  "apply all without showing them" path: the proposals are always on screen
  before the button, which is the bulk form of review-before-write. For 300
  products this is a few pages of scanning; that is the paid setup work, and
  the tool's job is to make it fast, not to make it blind.
- **Progress lives in a JobRun row**, like every other bulk pass, because
  applying hundreds of `productUpdate` calls takes real time and the browser
  is not the record. The apply enqueues a `seo_apply` job carrying the
  approved product ids and field values; the worker performs the writes with
  the `unchanged` and `mayWrite` guards re-checked at write time (§7 - the
  queue snapshot may be minutes old and a merchant may have edited a product
  meanwhile; the write-time check wins).
- **Regeneration over time**: the same queue, re-entered, naturally shows
  only what is writable - new products, and products still on `auto`. This is
  how the merchant "keeps it current as the catalogue grows": open the
  workspace, the queue shows the twelve new products, review, apply. No
  timers, no auto-publishing; a scheduled fully-automatic apply is refused
  because it removes the review step that keeps §2's line bright. (New
  decision; if recurring hands-off maintenance is ever wanted, it comes back
  through this document, not through a worker flag.)

## 4. Per-product visibility

Beyond the editor card (§3.4), the Products index (`app.products._index.tsx`)
gains, only when `seo_unlocked` is on:

- One column, "Meta", showing the state per row: "Auto", "Yours",
  "Outside app", or "Missing" - reading `Product.seo` presence plus the two
  state keys, which the index's existing metafields fetch already returns.
  Missing is rendered with tone, not a bare dash.
- One filter, "Missing meta fields", joining the existing filter row, so
  "show me what still needs doing" is one click on the screen where the
  doing happens.

This is deliberately thin: the index locates, the editor acts, the workspace
acts in bulk. No counts appear here that the workspace states with a proper
denominator.

## 5. What the workspace screen actually contains

`/app/seo`, one route, entitlement-gated in loader and action as today, three
areas in order of use during an engagement:

1. **Work** - the §3.5 queue. The primary action on the screen. This area is
   first because the screen's purpose is action; a visitor who reads nothing
   else sees work to approve, not findings to admire.
2. **Evidence** - the existing scan, reframed (§6). Scan now button, the
   stored `ThemeScanResult`, conflicts, missing-node reasons with their Fix
   it links (which already point at the screens where fixes live - that part
   of the first attempt was right), robots/canonical/noindex findings, and
   the weekly watch history. One area, not four tabs of equal weight: the
   tab structure of the first attempt presented evidence as the product.
3. **Handover** - §8's snapshot list and export.

The first attempt's Meta fields tab is deleted, replaced by the queue. Its
"we never write them" sentence is replaced everywhere by the true sentence:
"Generated by condensing this product's own text; nothing is written until
you approve it, and anything a person wrote is never overwritten."

## 6. The audit findings as evidence, and zero versus unknown

The scan machinery (`theme-scan.server.ts`) is good and stays. Its role
changes from headline to evidence: it is what the operator runs before the
first apply and after the last one, and what the weekly watch keeps honest in
between. Three defects of the first attempt are fixed by rule:

- **Zero is not unknown, anywhere it can arise.** `ThemeScanResult` already
  carries `passwordProtected`, and `deriveMissingReasons` already models
  "could not be determined" with `null`; the Overview simply ignored both and
  printed "0 distinct node types published" off an unreadable page. The rule,
  binding on every count derived from a scan: a count is only rendered when
  the page it counts was actually read. When `passwordProtected` (or any
  future fetch failure) is set, every derived number on every tab renders as
  "Could not be read - the storefront answered with the password page" with
  the fix path, never as a numeral. This is EXPERIENCE-PRD §2's "if we did
  not fetch it, we do not say" applied to zeros as well as greens: an
  unearned 0 is as invented as an unearned 100.
- **Numbers that cannot be co-known are not co-shown.** "3 gaps" next to
  "0 published" from one failed scan asserted knowledge and ignorance of the
  same page at once. Gap counts (missing reasons with `emitted: false`) are
  computed from app state and are partially knowable without a page read, but
  the rating and FAQ entries depend on the scan; when the scan failed, the
  gap line states its reduced denominator: "4 of 6 checkable without reading
  the page; 2 unknown until the scan succeeds."
- **Full denominators.** The field audit runs over the bulk export (§3.5),
  so "N of 355" replaces "50 checked" everywhere. If a future catalogue makes
  even the bulk export slow enough to matter, the number shown still names
  what was checked of what exists; a silent cap never returns.

Nothing from Diagnostics is duplicated: the crawler check verdict, if shown
here at all, is a one-line reference to the stored result with its date and a
link, exactly as the product editor already does.

## 7. Entitlement enforcement, on every path

`seo_unlocked` (operator-held key, existing `isSeoUnlocked`) is checked:

- in the `/app/seo` loader and action (already done, keep);
- in the product editor's loader (to decide whether the card renders) **and
  in its action for the seo intent** - the card being hidden does not stop a
  posted form;
- in the Products index loader for the column and filter;
- **in the worker task that performs `seo_apply`**, re-read from the database
  at execution time, not carried in the job payload. This is the clause the
  day's own lesson wrote: a cap enforced only at the route entrance was
  bypassed by three background jobs in this codebase today. A job queued
  while unlocked but executed after the key is removed must refuse, log why
  in the JobRun report, and touch nothing.

Additionally, the write-time `mayWrite` re-check (§3.5) is itself an
enforcement rule of the same kind: the protection promise is enforced where
the write happens, never only where the UI happened to check.

## 8. The handover artefact

What the operator gives the client at the end of the engagement, produced by
the app, because a hand-assembled document is exactly the "clientul o sa vada
ca nu am facut nimic" risk in reverse - unverifiable.

- **Snapshots.** A "Save snapshot" action in the workspace records, as one
  dated JSON row (new table, `SeoSnapshot`): the full-catalogue field audit
  counts, the latest scan result summary (node types, conflicts, gap list,
  robots/noindex findings - or "not readable" with the reason), the crawler
  check verdicts by date, and the counts of seo values by source (auto /
  human / outside / missing). The operator saves one at the start and one at
  the end; the workspace also saves one automatically before the first
  `seo_apply` ever runs for the shop, so the "before" exists even if nobody
  pressed the button.
- **The report.** "Export handover" picks two snapshots and renders a
  plain-character document (HTML for print; PDF generation is a dependency
  decision deferred until the HTML exists) with three sections: what was
  found (the before snapshot, every number with its denominator and date);
  what was done (writes by field from JobRun reports: "Meta descriptions
  written: 198. Left alone because a person wrote them: 41. Reverted on
  request: 2." - counts of real writes, never counts of checks run, per
  EXPERIENCE-PRD §2's activity-is-not-outcome rule); what changed (before and
  after, side by side, only for pairs where both sides were actually
  measured). It states the protection rule and the revert path in the
  client's copy, because "you can undo any of this in the app" is part of
  what was sold.
- No rankings, no traffic projections, no "expected impact" - the report
  contains what was measured and what was written, full stop. If the client
  asks what it will do to traffic, the honest answer is in the operator's
  mouth, not in a number we invented.

## 9. Open questions, named

Researched 31 August 2026, against shopify.dev and corroborating community
reports. Three of the questions below are now answered; two are not, and the
unanswered ones are the ones that can damage a store.

**Answered: the single-subfield behaviour is real and dangerous.** Sending
`seo` with only `title` sets `description` to null, and the reverse. Two
independent community reports, the more recent from 22 September 2025 and
still unresolved; shopify.dev documents neither the behaviour nor a fix.
So `writeSeo` always sends both fields, filling the untouched one with its
current live value. This is not a precaution, it is the only safe form.

**Answered: nothing identifies our own webhook.** Shopify sends no header
and no payload field marking a change as caused by the app that made it,
and the community treats this as a known gap with no platform fix. The
"never write an identical value" check is therefore the whole defence
against the self-feed loop, and it is load bearing here exactly as it is in
`facts.server.ts`.

**Answered: the empty-field fallback is the theme's, not the platform's.**
shopify.dev's theme SEO metadata guide shows `page_description` rendered
under `{% if page_description %}`, so a theme may emit a truncated body, may
emit nothing, or may omit the tag. No screen may state that search engines
"currently see a truncated description" as though it were a platform
guarantee.

**Unresolved: empty string versus never set.** Whether writing `""` back is
equivalent to a field that was never touched, or is a distinct empty
override, is documented nowhere. It decides whether revert is a true undo
for a field that started empty. Resolvable in minutes on a development
store - write, read back, and compare the rendered `<meta name="description">`
against an untouched product - and that test should happen before the bulk
queue ships, since one product reverted by hand is recoverable and eight
hundred are not.

**Deferred by decision, 31 August 2026: multi-language stores.** Translations
live in a separate layer, and each translation stores a `digest` of the
source value, so writing a primary-locale `seo` field marks any existing
translation of that field as outdated. Detecting whether a shop has other
locales needs `read_locales` or `read_translations`, neither of which this
app requests, and adding a scope forces every existing install to
reauthorise. Marius's call: not a concern for the shops in front of us, so
no scope is added and no detection is built. This paragraph exists so the
risk is deferred on the record rather than forgotten: before this feature is
offered to a shop using Shopify Markets, either the scope is added or the
behaviour is tested on a Markets-enabled development store.

- The `productUpdate` seo input shape and single-subfield behaviour (§3.1)
  need checking against current Shopify docs before build. RESOLVED above.
- Whether `products/update` webhooks triggered by our own seo writes can be
  cheaply recognised (the write marker pattern used elsewhere) or whether the
  §3.2 termination argument suffices alone - decide during build of the
  writer, with a test that simulates the cycle.
- Meta title and description length targets are conventions, not API limits;
  the numbers in §3.3 are defensible defaults, but the on-screen wording must
  keep calling them aims, and if Shopify enforces its own hard limits on the
  fields, those win and get stated.
- Whether the handover export ships as HTML-for-print only in v1. Assumed
  yes; PDF tooling is not worth a dependency before the content is right.

## 9d. The two-axis screen, and the snapshot it depends on

Decided in a working session with Marius, 31 August 2026, after the fourth
version of this screen was rejected. It supersedes the screen layout in §5.

**The problem was misdiagnosed.** Every earlier attempt treated "the client
will think he paid for two clicks" as a density problem and answered it with
more panels. It is not. Nobody complains that a dishwasher has one button.
The client complains when he cannot tell what changed - and this app cannot
tell him, because it only ever knows *now*. Nothing captures the state of the
store before the engagement, so a month later a correct store looks like a
store that was always correct.

**The deliverable is the app itself, not a report.** Marius's call: the client
gets a link, not a PDF. That raises the bar rather than lowering it. A
document has to convince once; a link has to survive being opened in month
three, on a day when nothing has changed for weeks. A screen that only says
"100 fields written on 31 August" reads like a museum by October.

So the screen carries two axes of time.

**Axis one, the anchor: since setup.** Stated as before-and-after pairs, never
as lone numbers - a single figure explains nothing, a pair explains itself.
Products with a search listing 0 to 50. Schema types published 6 to 9.
Conflicts on the page 2 to 0. A pair also stays honest: a number that did not
move is visibly a number that did not move. Beneath it, one control: see a
product's Google result before and after. That preview needs no new storage -
the pre-app value is already captured in the `prev` field of the `state`
entry (§3.1), kept there so revert can be exact. It is rendering, not data.

**Axis two, the pulse: is it still true.** The weekly watch, already built.
Date of the last check, and one line. This band is meant to be boring almost
always, and that is the argument for it: what an annual maintenance fee buys
is not a feature, it is a dull health line read once a month - and the one day
the merchant changes theme and loses the app embed, this band is the only
thing in the whole store that tells him before a traffic drop tells him three
months later.

**Third band: what is left, and who fixes it.** Permanent, and specifically
including the things this app will not do. Because the client has a link, he
will see them anyway: products with no image, the theme's Organization node
with no `@id`, an empty returns window. Written as a division of labour rather
than an excuse, each line naming where it is fixed, this is the part that
makes the app look like it is still working for him a year later.

**The machinery goes below all three.** The audience order inverts the day the
engagement ends: during setup the operator wants Preview and Write at the top;
afterwards the client wants evidence at the top. One screen, two audiences,
and the client opens it a hundred times to the operator's three. Order it for
the client; the operator can scroll.

### The snapshot, and the way it fails silently

Everything above rests on one record: **the state of the store frozen at the
moment `seo_unlocked` is set, before any write.**

- Taken automatically as part of granting the unlock, not as a separate button
  somebody can forget.
- Never overwritten. A second unlock, a re-scan, a re-run of the queue: none of
  them touch it. It is the only row in this feature that is written once.
- Captures at minimum: products with a meta title, products with a meta
  description, the JSON-LD node types found on a product page and the home
  page, the conflicts found, and the date.

**The failure mode is silence.** Snapshot after the first write and every pair
reads 50 to 50 - no error, no warning, just a screen that says nothing
happened. There is no second chance at a first state, and for the first client
(republicabio, app not yet installed as of 31 August 2026) it will be taken
exactly once. Whatever else is loosely tested here, this is tested.

## 10. Build order, smallest useful increment first

1. **Engine: `meta.ts` with tests.** Pure, no UI, no writes; everything else
   consumes it. It also forces the §2 line to be settled in code review
   before any screen exists.
2. **The seo writer service** (state keys, `prev` capture, `unchanged` guard,
   revert) plus the product editor card. This is the smallest shippable
   answer to the rejection: one screen where a person sees a proposal,
   approves it, and something is genuinely done - per-product visibility and
   regeneration included. If the engagement started tomorrow, the operator
   could already do the whole job with this, slowly.
3. **Full-catalogue audit via bulk export**, replacing the 50-of-355 pager,
   plus the zero-versus-unknown rendering rules on the existing evidence
   tabs. Honest numbers before bulk writes, because the before-snapshot must
   be right before anything changes it.
4. **The bulk queue and `seo_apply` worker task**, with write-time
   entitlement and `mayWrite` re-checks. This turns step 2's slow path into
   the operator's fast path.
5. **Products index column and filter.** Cheap, but only useful once values
   exist to have states.
6. **Snapshots and the handover export.** Last because it consumes
   everything above, and because an engagement that started earlier still has
   its before-snapshot: step 4 auto-saves one before the first apply.

Each step lands under the standing rules: check.bat green, CHANGELOG under
Unreleased, GraphQL only, engine pure, plain characters in every published
string, and no `npx shopify app deploy` while any submission is under review.
