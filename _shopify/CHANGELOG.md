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
