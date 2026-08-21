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
