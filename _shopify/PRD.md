# AI Visibility for Shopify — Product Requirements

Version 0.2. Written 2 August 2026, revised same day after the competitive
scan (`COMPETITORS.md`) and a re-read of the WordPress 1.6.6 module.
Companion documents: `LAUNCH-PLAN.md`, `PHASE-0.md`, `COMPETITORS.md`.

## 0. Name and positioning note

Working name: **AI Visibility All-in-One**. Plain "AI Visibility" is taken
(Mento). "All-in-One" is a recognised suffix merchants trust (All in One
SEO) and honestly describes the feature set: extraction + schema + alt
text + crawler check + collections in one app, against competitors that
each do one slice. One caution: it invites "does it also track AI
mentions?" — the listing FAQ should answer that plainly (no, we make the
store readable; trackers measure, we fix).

The WordPress "works without WooCommerce / local business mode" split does
not carry over: every Shopify store is a store. Do not mention
ecomm/non-ecomm on the listing. The nearest useful echo is supporting
**pages and blog posts** with summaries later (v1.1), and the **local
business mode** (price range, in-store pickup, address) as a v1.1 toggle —
Shopify has many appointment/showroom merchants and no competitor serves
them.

This is a separate product from the WordPress plugin. It shares the idea and
the brand. It shares almost none of the code, and, as the research below
shows, it cannot ship the same feature list.

---

## 1. Why this is not a port

The WordPress plugin works because WordPress gives a plugin the run of the
site: filters on every output, arbitrary URL routes, direct database access,
and the ability to rewrite `robots.txt` at runtime.

Shopify gives an app none of that. An app is a guest. It reads and writes
through a public API, it renders inside an iframe in the admin, and it can
only touch the storefront through narrow, sanctioned openings.

Four consequences decide the whole product:

**One. No arbitrary routes on the storefront domain.** An app can serve custom
paths, but only under a proxy prefix such as `/apps/…` or `/tools/…`. There is
no way to publish `yourshop.com/product-handle/md/`.

**Two. Shopify now owns `/llms.txt` and `/agents.md`.** As of 2026 Shopify
serves these routes natively at platform level. Proxy and redirect workarounds
that apps used previously no longer work: the platform response wins. The
llms.txt feature, which is a checkbox item on the WordPress side, is not ours
to build here.

**Three. `robots.txt` is a theme file, not an app surface.** Merchants edit
`robots.txt.liquid` in the theme. An app cannot rewrite it at runtime. We can
generate the rules and ask the merchant to paste them, or write them into the
theme file with the merchant's permission, but we cannot own that file the way
the plugin does.

**Four. Structured data belongs to the theme.** Most themes already emit a
Product JSON-LD block. Ours has to merge conceptually rather than technically:
we render through a theme app extension app embed block, which the merchant
activates in the theme editor. It is not automatic on install, and merchants
routinely forget to switch it on. This is the single largest support burden on
this platform.

What survives intact is the part that matters most: reading a catalogue,
extracting comparable attributes, writing alt text, and proving whether AI
crawlers can reach the store.

---

## 2. Positioning

Same sentence as WordPress, different emphasis.

> Make your Shopify store readable by ChatGPT, Claude, Gemini and Perplexity.

On WordPress the hook is the crawler check, because self-hosted sites sit
behind firewalls that silently block bots. On Shopify, Shopify handles the
infrastructure, so blocks are rarer and the crawler check is a trust device
rather than the headline.

The headline on Shopify is **comparable attributes**. A Shopify catalogue is
usually rich in prose and poor in structured attributes, and the theme's own
JSON-LD carries almost nothing an assistant can compare. That gap is ours.

---

## 3. Target merchant

- Sells physical goods with meaningful specifications: furniture, fashion,
  equipment, food, cosmetics
- Between 50 and 5,000 products, so bulk editing has real value
- Already uses an SEO app, or none, and does not want a second one
- Non-technical. Will not edit Liquid, will not write JSON

Out of scope for v1: stores under 20 products, dropshippers with generic
supplier copy, anything requiring per-market localisation logic.

---

## 4. Feature set for v1

Ordered by how much they matter and how hard they are.

### 4.1 Attribute extraction — the core

Reads product descriptions and pulls out comparable attributes using a
merchant-editable dictionary, exactly like the WordPress engine, including the
`#size` measurement reader and the `* term` count reader, and the rule that a
term followed by a verb or a connector produces nothing.

**Storage.** Shopify metafields on the product, under our reserved namespace.
One metafield per attribute group plus one JSON metafield holding the whole
extraction for rendering.

**Why metafields and not our own database.** Metafields belong to the
merchant. They survive uninstalling our app, they can be used by the theme
directly, and they can be exported. A merchant who leaves keeps the work. That
is both the honest choice and a selling point.

Competitive note (see `COMPETITORS.md`): Attributify maps only
already-structured vendor fields and cannot read prose; the ChatGPT
metafield populators guess and hallucinate. Deterministic extraction from
prose is the unclaimed core of this market. The listing sells the failure
mode, not the mechanism: "apps that guess describe one product as
another; this one only writes what your description actually says."

### 4.2 Structured data output

A theme app extension with an app embed block that renders a JSON-LD
`Product` node built from the metafields, including `additionalProperty`,
`brand`, `gtin`, `mpn` and the offer.

**The duplication problem.** Most themes already emit Product JSON-LD. Two
Product nodes on one page is worse than one. We cannot filter the theme's
output the way we filter Yoast's.

Approach, in order of preference:

1. Detect the theme's existing Product block by fetching the rendered page from
   our backend and parsing it. If found, emit only the properties the theme
   omits, inside a node that references the theme's node by `@id`.
2. If the theme's node cannot be matched reliably, offer the merchant a clear
   choice with a preview of both outcomes, and remember the decision.
3. Never emit a second complete Product node silently.

This detection runs server side on install and on theme change, not on every
page view.

### 4.3 Image descriptions

Finds product media without alt text and writes short, specific descriptions,
then updates them through `productUpdateMedia`. Never overwrites alt text a
person wrote.

Carries over the lesson from WordPress 1.6.6: alt text belongs to the file, and
a file reused across products will inherit the first description written for
it. On Shopify the same media can be attached to several products, so the app
must record which product a description was generated from and flag reuse in
the interface rather than silently producing a wrong description.

### 4.4 Bulk pass

Runs the extraction, the alt text and the summaries across the whole catalogue
using bulk operations, with a progress view and a dry-run report that shows
what would change before anything is written.

Must survive being closed: the job runs on our backend, not in the browser.

### 4.5 Crawler reachability check

Requests the storefront as GPTBot, OAI-SearchBot, ChatGPT-User,
Claude-SearchBot and PerplexityBot and reports what came back.

On Shopify the likely causes of a block are the store password page, a
third-party bot-protection app, a redirect app, Cloudflare-level bot rules
(Shopify's storefront runs behind Cloudflare, and merchants who front it
with their own Cloudflare zone often have Bot Fight Mode silently blocking
GPTBot with a 403), or rules the merchant added to `robots.txt.liquid`.
The report should name the likely cause rather than only the status code.

The checks run **from our backend, from outside Shopify's network** — an
external request with the exact user agent strings is the only honest
test. Never inferred from robots.txt parsing alone: the file can allow a
bot that a security layer then blocks.

### 4.6 Markdown mirror

Serves a plain text version of each product through an app proxy at
`/apps/ai-visibility/<handle>`, and links to it from the product page through
the app embed block.

Lower value than on WordPress, because the URL sits under a proxy prefix rather
than next to the product, and because Shopify product pages are server
rendered and already readable. Ship it, but do not lead with it.

Technical requirements for the proxy response:

- `Content-Type: text/plain; charset=utf-8` set explicitly. App proxy
  responses default to Liquid processing; the app must return the correct
  content type or the mirror renders wrapped in the theme.
- A `Link: <storefront product URL>; rel="canonical"` header on the mirror,
  and the app embed block emits `<link rel="alternate" type="text/plain">`
  pointing at the mirror from the product page. The pair is what lets a
  crawler discover the mirror and attribute it to the product.
- Served from cache; the Admin API is never queried on the request path
  (already required by the performance budget in 5.2).

### 4.7 Crawler rules

Generates the `robots.txt.liquid` rules with content signals and gives the
merchant a copy button and step-by-step instructions. Optionally, with explicit
permission, writes them into the theme file directly.

**Not automatic.** Writing to a merchant's live theme without an obvious,
reversible action is the kind of thing that fails app review and loses trust.

### 4.8 Collections — ported from WordPress, missing from v0.1

The WordPress module learned this on live sites: a listing page that is
only a grid of thumbnails has nothing an assistant can quote, yet it is
exactly the page that should answer "what kinds of X are there" and
"which one suits me."

For each Shopify collection: an editable capsule, choice criteria, Q&A,
and a generated comparison table built from the extracted product
attributes, stored in collection metafields and rendered by the app embed
block as `CollectionPage` with a real `ItemList`. The comparison table is
where attribute extraction becomes visible value — no competitor has
anything like it.

### 4.9 IndexNow — ported from WordPress, missing from v0.1

ChatGPT search runs on the Bing index, so fast Bing indexing is a direct
path into AI answers. On product/collection change, ping IndexNow with
the changed URLs. Needs the key file served — the app proxy can serve it
under `/apps/…`, and IndexNow accepts a key location parameter, so this
works without touching the theme. Nearly free to build, real value,
absent from every competitor scanned.

### 4.10 The editor pattern — carried over as a design rule

The WordPress fields UI got this right and it is the reason human edits
survive: **auto value shown as placeholder, override typed on top, reset
back to auto.** The Shopify admin page must reproduce this pattern per
product and per collection, backed by the `state` metafield. This is a
design requirement, not a feature.

### 4.11 Explicitly not in v1

- `llms.txt`. Shopify owns the route.
- `agents.md`. Same.
- Anything that requires editing the theme's Liquid beyond the app embed block.
- Multi-language extraction beyond what the dictionary already supports.
- AI mention tracking / query-rank monitoring. That is Mento's and
  Visibly's business; measuring is not fixing. Revisit only if merchants
  ask after launch.
- Pages and blog posts, and the local business mode. Both are v1.1
  candidates (see section 0).

---

## 5. Technical architecture

### 5.1 Stack

| Layer | Choice | Reason |
|---|---|---|
| App framework | Remix, Shopify app template | The supported path, and what the CLI scaffolds |
| Admin UI | Polaris, embedded via App Bridge | Required for App Store, and required for Built for Shopify |
| API | GraphQL Admin API only | Mandatory: all new public apps since 1 April 2025 must be GraphQL only |
| Storefront output | Theme app extension, app embed block | The only sanctioned way to add markup site-wide |
| Custom paths | App proxy | The only way to serve our own content on the shop domain |
| Data | Shopify metafields for merchant data, our own database only for jobs, settings and cache | Merchant keeps their work |
| Jobs | Backend queue (graphile-worker on Postgres), bulk operations for reads | Bulk passes must survive a closed tab; one datastore, no Redis |
| Hosting | Fly.io, two regions (ams + iad), web + worker process groups | Built for Shopify needs p95 under 500 ms from EU and NA |
| Database | Neon Postgres (serverless) | Fly Managed Postgres starts at $38/mo — oversized for launch |

**Hosting cost, monthly.** Launch configuration: two shared-cpu-1x web
machines 512MB–1GB (~$3–6 each), one worker machine (~$3–6), Neon
Postgres free tier, small egress. **~$10–20/month at launch.** At real
traffic (Growth-plan customers running bulk passes): larger machines,
Neon Launch plan (~$19), **~$40–70/month**. The first paying customer
covers hosting. Full sizing in `ARCHITECTURE.md` once confirmed.

### 5.2 Performance budget

Built for Shopify requires that the app does not reduce storefront performance
by more than 10 points, and that the backend answers at least 1,000 requests in
28 days with a p95 of 500 ms or better and a failure rate under 0.1%.

Design consequences:

- The app embed block emits **static markup only**. No fetch from the
  storefront, no JavaScript, no external requests. Everything it needs is
  already in the metafields at render time.
- Anything expensive happens in the admin or in a background job.
- The proxy route is cached aggressively and never queries the Admin API on
  the request path.

### 5.3 Required webhooks

Mandatory for App Store approval:

- `customers/data_request`
- `customers/redact`
- `shop/redact`

Plus, for correctness:

- `app/uninstalled`
- `products/update`, `products/delete`
- `themes/publish`, to re-run theme detection

### 5.4 Metafield namespace and definitions

One reserved namespace. Definitions created on install so the merchant sees
them in the admin with proper names and types, and can use them in the theme
without our app.

| Key | Type | Holds |
|---|---|---|
| `summary` | multi_line_text | The answer capsule |
| `facts` | json | Extracted attributes, label and value pairs |
| `questions` | json | Starter questions and answers |
| `fit_for` | single_line_text | Who it suits |
| `state` | json | What was generated, when, and from which source |

`state` is what makes the app honest: it records whether a value was written by
us or by a person, so the app never overwrites a human edit.

**Variant-level metafields.** Attributes that differ per variant (size,
colour, material on configurable products) are stored on the `Variant`,
not duplicated on the `Product`. The extraction decides the level: a value
found in the shared description goes on the product; a value that maps to
an option goes on the variant. Everything is then natively available to
Liquid, the Storefront API and GraphQL without our app in the read path.

### 5.5 Rate limits and the queue

The GraphQL Admin API is rate limited (calculated query cost against a
leaky bucket). Design rules:

- **Reads at scale go through Bulk Operations**, never paginated loops.
  One bulk query exports the catalogue as JSONL regardless of size.
- **Writes are queued and throttled.** The worker consumes the queue at a
  pace derived from the cost feedback in each response
  (`throttleStatus`), so a 10,000-product store never trips the limit.
  Mutations batch where the API allows (`metafieldsSet` accepts 25 per
  call).
- **Webhooks drive freshness**: `products/update` re-queues extraction
  for the changed product only. A full pass is only ever run explicitly
  by the merchant.
- The queue is graphile-worker on Postgres (one datastore, jobs survive
  restarts); no Redis dependency.

---

## 6. Billing

Shopify takes its cut and handles the payment. Use the Billing API with
recurring application charges, monthly, with a 7 day trial.

Pricing has to be restated per month, because that is how the App Store works
and how merchants compare.

| Plan | Price | Products | Notes |
|---|---|---|---|
| Standard | $99 / year | up to 20,000 | Everything the app does |
| High volume | $149 / year | above 20,000 | Same features, priority support |

**Annual, not monthly, and no trial (decided 2 Aug 2026).** The value is
front-loaded: one pass does most of the work a catalogue will ever need,
and the app then maintains it quietly. A monthly plan invites paying once
and cancelling; a trial invites extracting everything and cancelling on day
two, since the metafields are genuinely the merchant's to keep. Annual
matches the shape of the value, mirrors the WordPress product merchants
already understand, and reads cheap while earning more — $99 a year is
about $8 a month against Mento at $19 and Attributify at $49 per month.

The cost is honest and accepted: nothing is visible before paying, so the
App Store listing must do the demonstrating. See `BILLING-SPEC.md`.

**Why two plans and not three (decided 2 Aug 2026).** Over 99% of Shopify
stores hold fewer than 20,000 products, so in practice every customer sees
one price and makes no decision. The second plan is a fair-use valve for
the rare large catalogue, not a growth lever. Three tiers would have cost
days of enforcement code — counting, blocking, upgrade and downgrade
flows — and produced a permanent stream of "why am I limited" tickets.

**Why a flat price is safe here.** Our marginal cost per merchant is close
to zero: the extraction engine is deterministic regex with **no model
calls**, and Shopify does not charge per API call. A 10,000-product
catalogue costs one worker machine roughly fifteen minutes of CPU once,
then incremental webhooks, plus about 20 MB of cached text. Competitors
that call an LLM per product pay a real per-product cost and must impose
hard limits (10 products free, 500 on their entry plan). We can offer
effectively unlimited products at a flat price, and they cannot copy that
without rewriting their product.

The real scaling risk is **concurrency**, not catalogue size: many shops
running a full pass at once. That is solved in code — queue concurrency
limits and a cap on full passes per shop per day — not in pricing.

**No hard cut-off.** A store that grows past 20,000 products sees a banner
asking it to move to High volume, with a grace period. Silently breaking a
growing merchant costs a one-star review, which is worth more than the
difference in price.

Rationale: the WordPress product sells a licence to a self-hosted site once a
year. The Shopify product sells continuous work on a hosted catalogue, and
merchants there are used to monthly. Do not try to make the two price lists
match.

A free tier is worth considering only after the paid funnel works, because free
installs are the main source of one star reviews.

*Pricing history: $29/$79/$299, $19/$39/$79 and a two-plan monthly
structure were all considered before settling on annual billing at
$99/$149. Revisit after the first 50 installs with real renewal data.*

### 6.1 Platform terms, obligations and exit (researched 2 Aug 2026)

**Revenue.** One-time $19 registration per Partner account. 0% revenue
share on the first $1M USD annual gross app revenue, 15% above. Shopify
bills the merchant and pays out to the Partner account's bank details —
which must match the same business entity as the Lemon Squeezy store for
tax purposes.

**Support.** No contractual SLA. The listing must state a support email
and a response time we set ourselves: email, one working day. Chronic
unresponsiveness or unresolved complaints leads to delisting by Shopify.
The obligation is honesty and responsiveness, not 24/7 chat.

**Exit paths.** No lock-in period. Two clean exits, decided in advance:

1. *Sunset* (documented Shopify procedure): unpublish the listing, notify
   active merchants at least twice, cancel all subscriptions via
   `appSubscriptionCancel`, give a shutdown date. Because all merchant
   data lives in metafields, merchants keep every extracted attribute
   after shutdown — the honest sunset is a feature of the architecture
   and belongs in the marketing copy.
2. *Sell*: Shopify apps trade at roughly 2–4x annual profit on
   Acquire.com/Flippa; the published-app transfer between Partner
   accounts goes through Shopify support. An app with reviews and a
   WordPress sibling product is a sellable asset.

**The real exit risk is reputational**: an abandoned app with angry
reviews damages the AI Visibility brand the WordPress product trades on.
Rule: if it stops being worth running, sunset properly or sell — never
let it rot.

**Agreement note.** The Partner Program Agreement was updated effective
27 Feb 2026 (data protection, retention and deletion practices). Read it
once before submission; `PRIVACY.md` must reflect its retention and
deletion requirements.

---

## 7. Success criteria for v1

- Passes App Store review on the first or second submission
- Install to first bulk pass completed in under ten minutes, unassisted
- No support ticket caused by the app embed block being off, because the
  onboarding refuses to continue until it is on
- Zero duplicate Product nodes across the first fifty installs
- p95 backend latency under 500 ms from week one, so Built for Shopify stays
  reachable

---

## 8. Risks

**The app embed block.** Merchants install the app, never open the theme
editor, and conclude the app does nothing. Mitigation: the onboarding checks
whether the block is active by fetching the storefront and refuses to show a
success state until it is.

**Theme JSON-LD duplication.** Themes vary enormously. Mitigation: detection
plus an explicit merchant choice, and a warning banner when a theme changes.

**Shopify moving the goalposts.** Shopify took `/llms.txt` from apps within a
year of it existing. Any feature that lives on a platform route can be removed
by the platform. Mitigation: build nothing whose only value is a route
Shopify could claim.

**Review rejection.** Common causes are missing GDPR webhooks, non-embedded
flows, REST usage, and onboarding that requires leaving the admin.

**Support load.** Shopify merchants expect chat-speed replies. A one person
operation should say plainly on the listing that support is by email within one
working day.
