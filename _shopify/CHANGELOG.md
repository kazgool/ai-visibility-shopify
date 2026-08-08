# Changelog - AI Visibility All-in-One for Shopify

The app was approved and published on the Shopify App Store on 7 August 2026,
listed as MRDigital AI Visibility AiO.

Server changes go live through CI on push to main. Extension changes require
`shopify app deploy` and create a new version number.

---

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
