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
