# AI Visibility for Shopify — build and launch plan

Companion to `PRD.md`. Written 2 August 2026.

---

## Phase 0 — Decisions before any code *(you, half a day)*

These block everything and only you can answer them.

1. **Partner account.** Create or confirm a Shopify Partner account under the
   same business entity as the Lemon Squeezy store. The App Store pays you
   directly, so the tax details have to match something real.
2. **Development store.** Create one, and seed it with a real catalogue of at
   least 100 products with prose descriptions. The furniture catalogue is the
   right shape. Without real data the extraction cannot be judged.
3. **Hosting.** Pick where the backend runs. It must answer in under 500 ms at
   p95 from both Europe and North America.
4. **Name.** `AI Visibility` may already exist on the App Store. Check before
   any branding work, because the handle appears in the app URL.

---

## Phase 1 — Skeleton that installs and uninstalls cleanly *(1 week)*

The unglamorous phase that decides whether review goes smoothly.

- Scaffold the Remix app with the Shopify CLI
- OAuth, session storage, embedded rendering through App Bridge
- The three mandatory GDPR webhooks, answering correctly and verifiably
- `app/uninstalled` cleaning up cleanly
- Metafield definitions created on install, removed on request
- A single admin page that lists products and does nothing else

**Exit test.** Install on a fresh development store, uninstall, reinstall. No
orphaned data, no errors, no manual steps.

---

## Phase 2 — The engine *(1 to 2 weeks)*

Port the parts of the WordPress plugin that carry over. The logic is proven and
covered by tests; only the input and output change.

- Dictionary parser, including `#size` and `* term`
- Extraction with the stopword rule, diacritic folding and the usable-phrase
  test
- Summary and starter questions
- Write to metafields, never overwriting a human value, recorded in `state`
- Port the smoke test suite to the new language and keep it green

**Exit test.** Run against the seeded store and compare the output, product by
product, with what the WordPress plugin produces on the same descriptions. Any
difference is a bug in the port.

---

## Phase 3 — Storefront output *(1 week)*

- Theme app extension with an app embed block
- JSON-LD rendered from metafields, static, no JavaScript
- Theme Product node detection running server side
- The merchant choice screen for the duplication case
- App proxy route serving the markdown mirror, cached

**Exit test.** Validate three different themes in the schema validator. Zero
errors, zero duplicate Product nodes, and Lighthouse showing no measurable
change with the block on versus off.

---

## Phase 4 — The admin experience *(1 to 2 weeks)*

- Onboarding that refuses to finish until the app embed block is active
- Dictionary editor with the trade presets
- Dry-run report before any bulk write
- Bulk pass on the backend with a progress view that survives a closed tab
- Crawler check with plain-language causes
- Billing screen and plan selection

**Exit test.** Someone who has never seen the app installs it and reaches a
filled catalogue in under ten minutes, without asking you anything. Watch them
do it and say nothing. That test has failed for every app that skipped it.

---

## Phase 5 — Listing and submission *(3 to 4 days)*

Everything below is required. Missing any of it means rejection.

**App listing**

- Name, tagline, and a description written for merchants, not developers
- Feature media: one video under 2 minutes and at least three screenshots at
  the required dimensions
- Pricing, stated per month, matching what the Billing API actually charges
- Support email that a person reads, and a stated response time
- Privacy policy URL and a data handling statement covering exactly what the
  app reads and writes

**Technical**

- GraphQL only. A single REST call is grounds for rejection for a new app.
- Embedded, using the current App Bridge, with the Save Bar API where forms
  exist
- No functionality that requires leaving the admin
- Test credentials and a screencast walkthrough for the reviewer, with the
  development store ready to inspect

**Review time.** Plan for two rounds. Almost nobody passes first time, and the
feedback is usually specific and fixable within a day.

---

## Phase 6 — After approval

**Built for Shopify** is a separate bar, reachable only after traction:

- At least 50 net installs from active shops on paid plans
- At least 5 reviews
- 1,000 backend requests in 28 days at p95 under 500 ms, failure rate under
  0.1%
- No more than a 10 point storefront performance impact

Nothing to do here except keep the numbers clean from day one, which the
architecture in the PRD already accounts for.

**First fifty installs.** Read every review within the hour. On the App Store a
single unanswered one star review costs more than a week of marketing.

---

## Total estimate

Five to seven weeks of focused work to a submitted app, assuming the extraction
engine ports cleanly and hosting is decided early. Add two weeks if the theme
JSON-LD detection turns out to need per-theme handling.

---

## What I need from you to start

1. Confirm the hosting decision, because it shapes the job queue
2. The development store URL once it exists, with the seeded catalogue
3. Whether the name is free on the App Store
4. Whether you want me building this directly, or a full specification handed
   to Claude Code with me reviewing the output

---

## Documents this project still needs

Written as we go, not upfront:

- `ARCHITECTURE.md` once hosting is chosen
- `DICTIONARY-PORT.md`, the exact behaviour the port must reproduce, taken from
  the WordPress test suite
- `LISTING.md`, the App Store copy, same treatment as the Lemon Squeezy listing
- `PRIVACY.md`, required by review, and stricter than the WordPress one because
  the app reads a merchant's catalogue through an API
- `SUPPORT-PLAYBOOK.md`, the five questions that will arrive in week one, with
  answers ready
- `LP.md`, the landing page and sub-pages (privacy, terms, support policy) —
  written from `PRD.md` sections 0, 4, 6 and 6.1. The terms page states the
  support commitment (email, one working day) and the sunset promise (your
  data lives in metafields and stays yours), both of which are already
  architecture decisions, not marketing claims
