# PRD: Read and cited by AI models

AI Visibility All-in-One, Shopify. 11 September 2026. Status: draft for Marius.

Companion to `PRD.md` (the product) and `PRD-SEO-FULL-ONPAGE.md` (the SEO
module). Supersedes the "served surfaces" reasoning in
`HANDOFF-2026-09-11.md` section 4 wherever the two disagree.

## 1. Problem statement

The app writes summaries, comparable attributes and buyer questions for every
published product (Republica BIO: 189 summaries, 189 question sets, 187
attribute sets) and publishes them in three places: JSON-LD in `<head>`, a
plain-text mirror under `/apps/ai-visibility/<handle>`, and `llms.txt`. None
of those three is read by the systems the merchant is paying to be read by:
the crawlers that build model training data (GPTBot, ClaudeBot,
Google-Extended), the crawlers that build AI search indexes (OAI-SearchBot,
Claude-SearchBot, PerplexityBot, Googlebot for AI Overviews and AI Mode),
and the fetchers that read a page when a user asks (ChatGPT-User,
Claude-User, Perplexity-User). All three families read rendered text. The
first two also decide, at crawl time, what a model will later say about the
store without any search at all.

Evidence, all primary or measured:

- Google, "AI features and your website": "You don't need to create new
  machine readable files, AI text files, or markup to appear in these
  features. There's also no special schema.org structured data that you need
  to add." What is needed: "Making sure that important content is available
  in textual form."
- Agents that fetch a page on a user's request read only the rendered text.
  searchVIU, 30 October 2025, 8 product variants across 5 systems: a price
  placed only in JSON-LD was found by 0 of 5. Gemini, asked by Marius on 11
  September 2026 to read a Republica BIO product page, extracted title, SKU,
  price, stock and ingredients from visible text, never saw our JSON-LD, and
  concluded a markdown version could only be "a local file".
- Ahrefs, 1,885 pages that gained JSON-LD against 4,000 matched controls,
  August 2025 to March 2026: "Adding schema produced no major uplift in
  citations on any platform."
- Ahrefs, 137,210 domains, May 2026: 97% of llms.txt files received zero
  requests; AI retrieval bots are 1.1% of the requests the rest received.
  Google's John Mueller, June 2025: "no AI system currently uses llms.txt."
- Shopping answers (ChatGPT Shopping, Perplexity Shopping, Copilot) are built
  from product feeds (Shopify Catalog, OpenAI's Agentic Commerce Protocol
  feed), not from crawling product pages. Nothing this app writes reaches a
  feed today; our facts live in `$app` metafields.

Cost of not solving it: the first paying customer (Standard plan, activated 8
September 2026) has every deliverable in place and no AI system reading any
of it. That is the gap between what is promised and what is delivered, and
it is the same gap on every store that installs.

## 2. Goals

0. Read and cited by AI models, not only by AI search: a model answering
   from what it learned in training, a model answering with a search index
   behind it, and a model reading the page live all see the same visible
   facts. One output serves all three, because all three read rendered text.
1. Every fact the app extracts is present as server-rendered visible text on
   the page it describes, on 100% of eligible product and collection pages,
   with no merchant action beyond one toggle.
2. Structured data on those pages describes only what is visible on them, so
   it complies with Google's structured data policy ("Don't mark up content
   that is not visible to readers of the page") and stops being a liability.
3. The store's JSON-LD carries exactly one Product node, one Organization
   node and one WebSite node per page, none of them ours twice.
4. A crawler or agent that reads any page of the store can reach the
   plain-text mirror and the index from visible body text, not only from
   `<head>`.
5. Nothing shipped under this PRD can take a live store down or change the
   look of a page the merchant did not opt into. Liquid only, zero
   JavaScript, every block renders nothing when it has nothing to say.

## 3. Non-goals

- Shopping feeds (Shopify Catalog mapping, ACP feed). Separate PRD, because
  eligibility for Romanian stores is not documented and the write target is
  a different system. Phase 2 below names the first step only.
- Writing to theme files from the app. `themeFilesUpsert` needs "write_themes
  and an exemption from Shopify to modify theme files" (form, no stated
  turnaround). Everything here ships through the theme app extension the app
  already has. The exemption is an open question, not a dependency.
- A per-page markdown mirror served at the product's own URL through
  `Accept: text/markdown` content negotiation. Shopify gives an app no route
  on `/products/`. The mirror stays where it is, under the proxy.
- Rewriting the extraction engine, the dictionary or the SEO module.
- Any UI in the merchant admin beyond the settings the new blocks need.
- Google rich results. FAQ rich results ended for every site on 7 May 2026;
  no string in this app may imply a SERP appearance.

## 4. User stories

Merchant (Republica BIO, and every store on the Standard plan):

- As a merchant, I want the summary, key facts and buyer questions the app
  wrote to be visible on my product page, so that a person or an AI reading
  the page sees them without me editing my theme.
- As a merchant, I want to switch the visible block on once and forget it,
  so that new products get it automatically.
- As a merchant, I want to be able to switch off any one part (summary,
  facts, questions, the plain-text link) without losing the others.
- As a merchant, I want the block to look like it belongs to my theme (its
  fonts, its colours), so that it does not look like an advert for an app.
- As a merchant, I want nothing to appear on a product where the app has
  nothing to say, so that my pages never show an empty box or a "0 facts"
  line.
- As a merchant on a theme that already shows a specs table or an FAQ, I
  want to be able to place the app's block myself where it fits, or hide it,
  so that the page does not repeat itself.

Reader (an AI system or a person):

- As an AI system reading the rendered page, I want the product's
  comparable attributes as labelled text, so that I can answer "which of
  these is gluten free and under 30 lei" without parsing a theme.
- As an AI system, I want the questions a buyer asks and their answers as
  visible text, so that I can quote them.
- As an AI system, I want a visible link to the plain-text version and to
  the store index, so that I can fetch a cleaner copy when I need one.
- As Google, I want the JSON-LD on the page to describe what is on the page,
  so that I do not have to treat the markup as spam.

Operator (Marius):

- As the operator, I want a per-shop count of pages carrying the visible
  block against pages eligible for it, so that "delivered" is a number, not
  a claim.
- As the operator, I want to prove the change to a client with a repeatable
  test (same prompt to the same agent, before and after), so that the
  invoice is backed by an observation.

## 5. Requirements

### P0, must ship

**P0.1 Visible product block, automatic.** A new app embed block in
`extensions/ai-visibility/blocks/`, `target: "body"`, rendering on
`template.name == 'product'` only. Content, in this order, each part behind
its own setting, all on by default: a heading (setting, default "About this
product"); the summary (`$app.summary`); the comparable attributes
(`$app.facts`) as a two-column definition list, label and value, in the
merchant's language as stored; who it suits (`$app.fit_for`); buyer
questions (`$app.questions`) as visible question and answer pairs; one line
"Plain-text version of this page" linking to the mirror and one line "All
products as plain text" linking to `/apps/ai-visibility/llms.txt`.

Acceptance:
- Given a product with a summary and three facts, when the embed is on,
  then the rendered HTML body contains the summary text and the three
  label:value pairs as text nodes, with no JavaScript on the page from us.
- Given a product with no summary, no facts, no fit_for and no questions,
  then the block renders nothing at all: no wrapper, no heading, no
  whitespace beyond a Liquid comment.
- Given the merchant switches off "questions" in the block settings, then
  the questions are absent from the body and the FAQPage node is absent from
  the head on the same request (P0.3).
- Given `template.name != 'product'`, then the block renders nothing.
- Given the theme's own product template already contains the app's
  placeable block (P1.1), then the embed renders nothing on that page.
- Every string passes through the same escaping the mirror uses; a value
  containing `<` or `&` renders as text, never as markup.
- The block carries a single CSS class prefix `ai-visibility-` and inline
  styles limited to spacing and a max-width; it inherits font and colour from
  the theme, sets none of its own.
- Rendering cost: the block reads four metafields already fetched by the
  head block; no additional Liquid loops beyond the facts and questions
  arrays. Measured with `shopify theme check` and a Lighthouse run on the
  dev store: no new request, no layout shift above 0.

**P0.2 Visible collection block, automatic.** Same mechanism for
`template.name == 'collection'`: the collection summary, the choice criteria
as a list, the buyer questions, and the comparison table when the merchant
has not placed the existing `comparison-table` app block. Same empty rule,
same settings pattern, same retraction when the placeable block is present.

**P0.3 Structured data mirrors visible content only.** In
`ai-visibility.liquid`: FAQPage is emitted only when the questions are
visible on the page (P0.1 questions setting on, or P1.1 block present with
questions on). The Product node's `description` uses the summary only when
the summary is visible. `additionalProperty` values are emitted only when
the facts are visible.

Acceptance:
- For every product on the dev store, a script (`scripts/read-ld-visible.ts`,
  read only) fetches the page, extracts every string in our JSON-LD nodes
  and asserts each appears in the rendered body text. 0 misses, or the
  misses listed with the reason.

**P0.4 One WebSite node.** Our WebSite node in `ai-visibility.liquid:137` is
emitted only when the theme scan found no WebSite node in the theme
(`theme_scan` gains `hasWebSiteLd`, same shape as `hasOrganizationLd`).
The "unknown source" text in the conflicts card is replaced by the true
source when the duplicate is ours.

Acceptance: on Republica BIO after the next scan, the home page carries one
WebSite node, the report's WebSite conflict is gone, and the scan test
covers a theme with and without its own WebSite node.

**P0.5 Extend mode falls back to full when the theme has no Product node.**
`theme_scan` persists `hasProductLd`; in Liquid, extend mode holds back only
when the theme has a Product node without `@id`; when the theme has none, it
emits the complete node. Removes the manual "switch to Full after the
developer's change" step recorded on 11 September 2026.

Acceptance: three Liquid fixtures (theme node with `@id`, theme node without
`@id`, no theme node) rendered through liquidjs in
`check-liquid-json.mjs`-style tests, each asserting the node count and the
`@id` used.

**P0.6 Delivery counter.** The SEO screen and the Report screen show
"Visible on the page: N of M eligible products" from the nightly page scan
(a new page check, B34, "our visible block is present"), with the existing
denominator rules. Not a finding; counted, not judged.

**P0.7 llms.txt shape.** Already implemented on 11 September, unverified
until `check.bat` runs: blockquote after the H1, Products before Optional
(collections), per the llms.txt proposal. Kept because it costs nothing and
some agents (Claude Code, GPTBot at 4.5% of fetches in the Ahrefs sample) do
read it; not promised to merchants as a discovery mechanism.

**P0.8 Discovery link shop-wide.** Already implemented on 11 September:
`rel="describedby"` to llms.txt on every template. Same status as P0.7.

**P0.9 Training and search crawlers are not turned away.** The crawler check
already tests 5 agents against robots.txt and the live page. Extend it to
the three families by name, with the vendor's documented purpose for each:
training (GPTBot, ClaudeBot, Google-Extended, CCBot), search index
(OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot, Bingbot), user
fetch (ChatGPT-User, Claude-User, Perplexity-User). Report per family:
allowed by robots.txt, page returns 200 to that user agent, our visible
block present in the response. A merchant who blocks a training crawler is
told, in one sentence, that the model will not learn their products; the
choice stays theirs. Shopify's default robots.txt blocks none of them
(verified on republicabio.ro, 11 September 2026).

### P1, next

**P1.1 Placeable product block.** The same content as P0.1 as an app block
(`target: "section"`) the merchant can place anywhere on the product
template. When present, the automatic embed retracts on that page
(detection: the app block sets a flag the embed reads; both are Liquid, same
request, so a `capture` in the block and a check in the embed suffice, or
the embed checks `section.blocks` of the product template). Documented in
SUPPORT.md as "move it where you want it".

**P1.2 Theme-fit settings.** Heading level (h2 or h3), compact or full
layout, hide the plain-text links, per block.

**P1.3 Uninstall paragraph.** SUPPORT.md and PRIVACY.md: what stays
(metafields, SEO fields, alt text), what stops (visible blocks, JSON-LD,
mirrors, llms.txt, agents.md). Open item 11 of the handoff, now with the
visible block added to the "stops" list.

**P1.4 Theme file templates for merchants who accept them.** Ready-to-paste
`templates/agents.md.liquid` (pointer to the proxy llms.txt plus the UCP
fields from the `agents` object) and a `robots.txt.liquid` fragment adding
`Sitemap:` for nothing (Shopify's own sitemap is already there) and no
AI-bot disallows. Offered in the app as copy-paste text with a "your
developer pastes this" note, never written by the app. Behind the operator
key until the exemption question (section 7) is answered.

### P2, design for, do not build

**P2.1 Shopify Catalog mapping.** When eligibility for Romania and `$app`
metafields as a mapping source are confirmed live, a settings card that
tells the merchant exactly which of our metafields to map to which Catalog
field, with a deep link to Sales channels > Agentic > Sources. Design now:
facts already carry stable labels; keep them stable.

**P2.2 Theme file writes through `themeFilesUpsert`**, if Shopify grants the
exemption: `agents.md.liquid` and `llms.txt.liquid` written by the app on
install, removed on uninstall, with a copy of any pre-existing file kept in
a Setting row for restore. Not before the exemption.

**P2.3 Per-product visible "sources" line.** Where a fact came from (the
merchant's own description, sentence quoted). The Buzzbox study (August
2026, 195 calls) found that what moves repeat citation is "extractable
facts with sources", not FAQ markup. Cheap once P0.1 exists.

## 6. Success metrics

Leading, measured from the app's own data, weekly:

- Visible block present on 100% of eligible product pages on Republica BIO
  within one nightly scan of the toggle being switched on (P0.6). Stretch:
  the same on every Standard-plan store without a support ticket.
- JSON-LD to visible text mismatch: 0 strings in our nodes absent from the
  body, on every page the nightly scan reads (P0.3 script).
- Node counts on Republica BIO after the developer's theme change: 1
  Product, 1 Organization, 1 WebSite on the product page; the same minus
  Product on the home page.
- Agent test, repeatable: the Gemini prompt Marius used on 11 September
  2026 ("ia un url de produs si vezi ce poti extrage usor de acolo") on the
  same Ashwagandha URL, run 5 times before and 5 times after. Pass when at
  least 4 of 5 after-runs list our summary or at least three of our facts,
  and at least 1 of 5 names the plain-text URL unprompted. Before-runs are
  the baseline; today's single run found none of ours.

Lagging, 30 and 90 days, from the crawler hit log and the merchant:

- CrawlerHit rows on Republica BIO per crawler family (training, search
  index, user fetch) on product pages and on the mirror, week over week.
  Today: 66 rows, one GPTBot test fetch, none from a search-index bot.
- Model recall without search, repeatable: the same 10 questions about
  Republica BIO products ("what does Republica BIO's ashwagandha contain",
  "is their cocoa powder vegan") asked with browsing off to ChatGPT, Claude
  and Gemini, monthly, answers stored dated. Training data lags months;
  the metric exists to show the trend, not to claim a result at 30 days.
- The merchant's own observation of their products in AI answers, asked at
  30 and 90 days in writing, kept as a dated note. No claim in sales
  material is made from fewer than three stores.

## 7. Open questions

Blocking for P1.4 and P2.2, Marius: apply for the Shopify theme-file
exemption for this app? It changes what the App Store listing can promise
and what the reviewer will test. Recommendation: apply now, ship nothing
that depends on it.

Blocking for P2.1, needs live testing in the Republica BIO admin (2
minutes): does Sales channels > Agentic exist for a Romanian store, and does
the Sources mapping list `$app` metafields? Until answered, no sales
material mentions ChatGPT Shopping.

Non-blocking, engineering: does the embed detect the placeable block
reliably on every theme (P1.1)? Verify on Dawn and on Shella before
promising it.

Non-blocking, Marius: default heading text and whether the block ships
"on" on existing installs or only on new ones. Recommendation: on for new
installs, off for existing ones with a dashboard step, because a visible
change on a live store the merchant did not ask for is the one thing this
PRD must not do.

## 8. Timeline and phasing

Phase 1 (this batch, one deploy): P0.7 and P0.8 verified by `check.bat`, then
P0.1, P0.3, P0.5 together, because P0.3 changes what the head block emits and
must ship with the visible block it depends on. Then P0.4, P0.6. Republica
BIO: toggle on in App embeds, nightly scan, the Gemini test, the counter.

Phase 2: P1.1, P1.2, P1.3, and P0.2 if it did not fit in phase 1.

Phase 3: P1.4 and the two open questions, then P2 as they resolve.

Hard constraints on every phase: one deploy per batch, `queue-unstick`
before every push, no deploy while a merchant is mid-setup, every change
behind a setting whose default cannot alter a live page the merchant did not
opt into.

## Sources

- Google, AI features and your website:
  https://developers.google.com/search/docs/appearance/ai-features
- Google, structured data policies:
  https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- searchVIU, Schema markup and AI, test of 30 October 2025:
  https://www.searchviu.com/en/schema-markup-and-ai-in-2025-what-chatgpt-claude-perplexity-gemini-really-see/
- Ahrefs, llms.txt study, May 2026: https://ahrefs.com/blog/llmstxt-study/
- Ahrefs, schema and AI citations: https://ahrefs.com/blog/schema-ai-citations/
- Search Engine Roundtable, Mueller on llms.txt, June 2025:
  https://www.seroundtable.com/google-ai-llms-txt-39607.html
- Buzzbox Media, 195-call citation study, August 2026:
  https://www.buzzboxmedia.com/research/ai-answer-engine-citation/
- OpenAI, Agentic Commerce Protocol key concepts:
  https://developers.openai.com/commerce/guides/key-concepts
- Shopify, Catalog and agentic storefronts:
  https://help.shopify.com/en/manual/online-sales-channels/agentic-storefronts/products
- Shopify, Catalog mapping:
  https://help.shopify.com/en/manual/promoting-marketing/seo/shopify-catalog/default-listing
- Shopify, theme app extension configuration (embed targets):
  https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
- Shopify, themeFilesUpsert (exemption):
  https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeFilesUpsert
- Shopify, agents.md and llms.txt templates:
  https://shopify.dev/changelog/customize-llmstxt-llms-fulltxt-and-agentsmd
- llms.txt proposal: https://llmstxt.org/
- Cloudflare, Markdown for Agents, February 2026:
  https://developers.cloudflare.com/changelog/post/2026-02-12-markdown-for-agents/
- Competitor scan, 9 App Store listings, 11 September 2026: recorded in
  `_shopify/audit-logs-2026-09-11/competitors-storefront.md`

## Amendments from the build of 11 September 2026 (approved by Marius, 11 September 2026)

Three places where the build could not meet the text as written. Each is
stated here rather than explained away in the delivery note. All three were
approved by Marius on 11 September 2026, in the brief for the second batch
(`CC-PROMPT-AI-READABILITY-2.md`).

1. **Job expiry.** The brief asked for graphile-worker's `maxJobExpiry` at
   30 minutes. graphile-worker 0.16.6 has no such option: the four-hour
   expiry is written into its own SQL (`get_job`, `resetLockedAt`). Built
   instead: the worker fails its jobs back to the queue on SIGTERM and SIGINT
   after a 25 s graceful wait, which clears the lock at once, and Fly's
   `kill_timeout` is 30 s so the wait is not cut short. The 30-minute figure
   is the screens' rule for a row left "running" (`job-stale.ts`). Every
   instance of the class, each fixed: the one-job-at-a-time guards in
   `app._index.tsx` (action), `app.collections.tsx` (action),
   `app.report.tsx` (publish_prefs), `app.seo.tsx` (seo_scan_pages,
   seo_build_queue, seo_collection_preview, seo_apply); the loaders that show
   a JobRun in `app._index.tsx` (dry run, catalogue pass, alt text, crawler
   check, active-job banner), `app.collections.tsx`, `app.plans.tsx`
   (snapshot), `app.report.tsx` (pass, reconcile),
   `app.report.export.$table.tsx`, `app.seo.tsx` (five jobs) and
   `seo-dashboard.server.ts`. Left deliberately: `scripts/read-ladder.ts`,
   a read-only operator script that reports rows as stored.

2. **P1.1 detection.** P1.1 says the embed retracts when the placeable block
   is present, by a flag or by reading `section.blocks`. Liquid variables do
   not cross block boundaries and Shopify documents no way for an app embed
   to see an app block of the same extension, so nothing detects it. Built
   instead: a setting on the embed, "I placed the content block myself; hide
   the automatic one", documented in SUPPORT.md. The acceptance line "Given
   the theme's own product template already contains the app's placeable
   block, then the embed renders nothing on that page" holds only when the
   merchant ticks it.

3. **P0.3 scope.** P0.3 names FAQPage, the summary as description and
   `additionalProperty`. The build also removed `audience` (who it suits)
   from extend mode and the criteria from the CollectionPage node, under the
   same rule: the head block cannot know whether the body shows them. That
   left extend mode's fragment with nothing to say, so on a theme with its
   own Product node this app now adds nothing to it; the extracted facts
   reach readers as visible text and the mirror. P0.5's case "theme node with
   @id: extend it" therefore reads "leave it alone". The P0.3 acceptance
   (0 misses in `read-ld-visible.ts`, or the misses listed with the reason)
   is not yet run on a store; values this app does not extract - the
   delivery time and return window from the Business screen, the currency
   code, a barcode the theme does not print - are expected among the misses
   and are not covered by this batch.
