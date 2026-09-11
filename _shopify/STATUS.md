# STATUS — where this project stands

Last updated 11 September 2026. Read this first in a new session, then
`HANDOFF-2026-09-11.md`, then `PRD-AI-READABILITY.md` and the Unreleased
section of `CHANGELOG.md`.

---

## Where things stand, 11 September 2026

The app is live on the App Store (approved 7 August) and has its first paying
store, Republica BIO (Standard plan, since 8 September, 189 published
products, Shella theme). Everything below section 0 was written on 3 August;
`CHANGELOG.md` carries the month between in detail, and
`HANDOFF-2026-09-11.md` carries the setup of that store.

**Committed on 11 September, not pushed, not deployed.** One batch built from
`PRD-AI-READABILITY.md`, for one deploy:

- Visible content. A new app embed, "AI Visibility content", prints the
  summary, key facts, who it suits and the buyer questions as text on
  product pages, and summary, criteria, questions and the comparison table
  on collection pages; a placeable block, "AI Visibility details", prints
  the same markup where a merchant puts it. One snippet holds the markup.
  Nothing renders when there is nothing to show.
- Structured data describes only what the page shows. FAQPage moved from
  the head into the body, next to the questions; the head's Product node
  takes the theme's description and no facts; extend mode adds nothing to a
  theme's own Product node and emits the complete node when the theme has
  none; our WebSite node goes out only when the theme has none.
- Measurement. B34 counts pages carrying the visible block ("Visible on the
  page: N of M eligible products", SEO screen, merchant SEO dashboard,
  Report screen). `scripts/read-ld-visible.ts` lists our JSON-LD strings
  that are not visible text. The crawler check reports three families
  (training, search index, user fetch) for robots.txt, the page's answer and
  the visible block.
- Operations. The worker releases its jobs on SIGTERM and SIGINT; a JobRun
  row left "running" for 30 minutes with no progress reads as stuck and
  stops blocking buttons.
- Documents. Uninstall paragraph in SUPPORT and PRIVACY; the refund answer
  no longer states a policy nobody decided.

**A second batch, same day, same deploy** (`CC-PROMPT-AI-READABILITY-2.md`):

- Content language. English or Romanian, chosen on the Business screen or
  read from the store's default language through `webPresences`
  (`read_markets`, no new scope). Summaries, questions, collection capsules,
  the meta description's connective and the mirror's headings come from one
  phrase table, `app/engine/phrases.ts`. Changing the language rewrites what
  the app wrote through the existing catalogue pass; anything a person wrote
  is kept.
- No price in generated text any more; questions from the merchant's own
  dictionary labels, six at most. Measured before and after on both
  catalogues: `audit-logs-2026-09-11/engine-before.md` and `engine-after.md`.
- Storefront strings of the visible block in the extension's locale files,
  English and Romanian.
- Dashboard step five, "Show this app's content on your product pages", with
  a deep link; embed-check now reads the content embed apart from the head
  embed, which it used to count as a second copy of it.
- A heartbeat on every long job, so a page read past 30 minutes no longer
  reads as stuck.
- The stray CSV capture and the audit tarball are out of the repo.

**A third batch, same day, same deploy** (`CC-PROMPT-AI-READABILITY-3.md`):

- A corpus of other stores' public `products.json` (38 stores by now, 11 of
  them Romanian), split into dev and hold-out before any rule
  (`_shopify/corpus/manifest.md`).
- `app/engine/faq.ts`: the questions a product's own description answers,
  plus the merchant's questions, the shop's mappings, options, maker and
  business. Judged by subagents against a seven-rule rubric. Dev 0.63%.
  **Hold-out bar (1%) not met** on three runs: 9.66%, 2.41%, 8.35%. Not
  wired into anything live; the Dictionary screen's question mappings and cap
  are stored and read by nothing live yet.
- On the live path, buildQuestions asks business questions only: the
  generic and the label-specific templates are gone (the judge found the
  label ones about 26% and 10% wrong). Republica BIO 1,124 questions to 567;
  the furniture CSV 676 to 0.
- Dictionary screen: "Buyer questions" (heading and group mappings, cap) and
  "On the product page" (a switch per group, mirrored to the shop metafield
  `$app.facts_display`).
- Visible facts measured, not changed: 37.4% wrong on dev, 48.1% on the
  hold-out.

Last full run: see the handover of 11 September and the CHANGELOG entries.

**Not yet observed on a store**, and each needs Marius: the App embeds toggle
for "AI Visibility content" on Republica BIO (step five on the dashboard
opens it), the Romanian strings on its product pages (no English and no
"translation missing"), the store language the app reads for it, the
rewrite job after a language change, the nightly page read that fills B34,
`npx tsx scripts/read-ld-visible.ts republicabio.myshopify.com 20`,
`npx tsx scripts/read-llms-txt.ts republicabio.myshopify.com`, and the Gemini
test in the PRD's success metrics.

**Open decisions for Marius**: the refund policy text (SUPPORT.md promises
only an answer); the phrase table, en and ro, as client-facing wording,
with the FAQ additions; whether the FAQ loop goes on (a fourth hold-out
run needs herbaris.ro's and miledy.ro's errors read and new unopened
Romanian stores) or the bar is amended; whether live questions should stay
business-only until then (one revert brings the label templates back); and
whether the head embed's deep link should move to the documented client_id
form. The cap of six and the "Ce fara are X?" wording no longer arise: the
templates that produced them are gone. The three PRD
amendments were approved on 11 September. The new embed does not ship on for
existing installs: app embeds are off until the merchant switches them on.

**Still open from the handoff**: the four-context table in `extract.ts`,
the llms.txt request path reading every mirror body, alt-text provenance,
post-lapse webhooks, and the sales-folder payout correction.

---

## 0. Addendum, 3 August 2026 (evening) - production day

Everything below section 1 predates today. Today the app went fully live
on production infrastructure and is feature-complete for v1:

- **Billing works end to end**: annual subscription (test charge verified),
  entry gate, master key comp (code in fly secrets/.env), FREE_SHOPS
  allowlist. Public distribution selected (required by the Billing API).
- **Worker auth survives expiring offline tokens** (mandatory since Apr
  2026): tokens come per-request via unauthenticated.admin, 401 mid-run
  refetches. The old read-from-Prisma path died silently after 60 minutes.
- **Collections (PRD 4.8)**: capsules, choice criteria, Q&A, comparison
  tables from attributes that actually vary; CollectionPage + FAQPage +
  ItemList in the embed; zero-JS visible table as a theme app block.
- **Variant-level attributes (PRD 5.4)**: option pairs become variant
  facts; product facts the variants contradict are withdrawn.
- **IndexNow (PRD 4.9)**: pings on real changes, key served via app proxy.
- **Business info (WP 1.6.7/1.6.9 port)**: delivery/returns/warranty/
  payment screen, commercial buyer questions, shipping + return schema and
  review-app ratings in full mode, price span for variable products.
- **Admin product panel** (ui_extension, admin.product-details.block.render):
  the WP metabox equivalent - attributes, summary, questions, provenance
  badges, link to our editor. Merchant pins it once, order is platform-fixed.
- **Capsule editor**: summary, questions, fit-for editable per field with
  human/auto provenance; only changed fields become human.
- **Honesty fixes with tests**: appearance qualifiers both word orders
  ("aspect de marmura", "marble effect" are not materials); machine alt
  text (entities/UUIDs/filenames) is replaceable, not protected; stale
  auto values are withdrawn when recomputation is empty ("Suits: 6 scaune"
  bug); multiplication sign normalised to x.
- **CI**: GitHub Actions runs fly deploy on push to main (laptop network
  out of the release path). Deploy tags deploy-2026-08-03-1..3; push with
  --follow-tags.
- **Gotchas that cost hours, do not rediscover**: Prisma migrations must
  use DIRECT_URL (Neon pooler holds advisory locks); trycloudflare DNS
  needs 1.1.1.1; the released extension uid (019fc7c8-03b7-7553-a37b-84b873e7cb96)
  differs from the toml uid AND from dev-preview uids - the embed check
  compares released uid; gate redirects must preserve the query string;
  `shopify app dev clean` after dev sessions or the storefront serves a
  dead dev bundle.

**Remaining to submission** (about a day): publish PRIVACY/SUPPORT pages
on mrdigital.ro, 6 listing screenshots per LISTING.md, app icon, fresh
install QA, LCP re-check from Fly, fill the listing form, submit. The LP
on mrdigital.ro is deliberately post-publish (Marius's call).

## 1. What exists and works

Built and verified against a real catalogue (355 furniture products
imported into the development store):

| Piece | State |
|---|---|
| Remix app, embedded, OAuth, GDPR webhooks | working, install/uninstall/reinstall clean |
| Metafield definitions (5, storefront-readable) | created on install, repaired on every auth |
| Extraction engine, ported from WordPress 1.6.6 | 60/60 tests green, incl. the three WordPress fixtures |
| Dictionary editor, 20 trade presets, live coverage test | working |
| Per-product editor: auto value, manual override, reset | working, protection verified ("1 protected") |
| Summary, starter questions, who-it-suits | written for 352 / 352 / 240 products |
| Alt text writer (125 char cap, shared-media guard) | built, last test in progress |
| Crawler check, 5 agents, plain-language causes | working — correctly reports the password page behind HTTP 200 |
| Theme JSON-LD scan | built |
| Theme app extension (JSON-LD, mirror link, max-snippet) | built, not yet activated in a theme |
| Markdown mirror via app proxy | built, cached at extraction time |
| Dashboard (metrics, actions, setup checklist, AI visibility card) | working |
| Three-layer freshness: webhooks + 15-min poll + weekly sweep | built, cron wired |
| Deployed on Fly (ams + iad + worker), Neon Postgres | live at ai-visibility-all-in-one.fly.dev |

Coverage on the real catalogue: **352 of 355 products produce attributes**
with a Romanian furniture dictionary. Dimensions 306, Material 273,
Colour 215, Capacity 197, Style 170.

## 2. What is not done

- App embed never activated in a theme, so nothing reaches the storefront
  yet. This is the next test.
- Billing: specified in `BILLING-SPEC.md`, not implemented.
- Onboarding flow that refuses to finish until the embed is active.
- Collections with generated comparison tables (PRD §4.8).
- IndexNow (PRD §4.9).
- Variant-level attributes (PRD §5.4).
- App Store listing, privacy policy, support playbook.

## 3. Decisions that are settled

- **Name**: AI Visibility All-in-One. Plain "AI Visibility" is taken.
- **Pricing**: $99/year up to 20,000 products, $149/year above. Annual,
  **no trial, no free tier**. Reasoning in `BILLING-SPEC.md` §1 and §4.
- **Hosting**: Fly.io two regions + Neon Frankfurt + graphile-worker on
  Postgres. No Redis.
- **Product language**: English everywhere. Only dictionary *terms* are in
  the merchant's language.
- **Never overwrite human work**: enforced by the `state` metafield; a
  value with no state entry is treated as human.
- **Merchant keeps the data**: everything lives in their metafields and
  survives uninstall. This is both the honest choice and the sales line.

## 4. Coordinates

- Repo: `github.com/kazgool/ai-visibility-shopify`, branch `main`
- Shopify app: AI Visibility All-in-One, org 229253428, app id 405463269377
- Dev store: `mrdigital-dev.myshopify.com` (storefront password: dev stores
  cannot disable it)
- Fly app: `ai-visibility-all-in-one`
- Neon project: `ai-visibility-shopify`, Frankfurt
- Secrets live in `.env` locally and `fly secrets` in production. Never in
  the repo.

## 5. How to run it

```
check.bat     install, prisma generate, typecheck, tests
dev.bat       shopify app dev (keep open; q to stop)
shell.bat     PowerShell as admin, already in the project folder
npm run worker   run the job worker locally instead of deploying
fly deploy    push web + worker to production
```

The Fly worker and a local worker both read the same Neon database, so a
job queued from a local dev session is picked up by whichever worker is
running.

## 6. Documents

| File | What it holds |
|---|---|
| `PRD.md` | what we are building and why, feature by feature |
| `ARCHITECTURE.md` | topology, database, freshness layers, deploy |
| `DICTIONARY-PORT.md` | the exact behaviour the engine must reproduce |
| `BILLING-SPEC.md` | plans, enforcement, what not to build |
| `DESIGN-BRIEF.md` | UI direction, tone, screens, billing screen brief |
| `COMPETITORS.md` | the scan that justified building this at all |
| `IDEAS-FROM-WORDPRESS.md` | rules paid for by real failures on the WP module |
| `PHASE-0.md`, `PHASE-1-SPEC.md`, `PHASE-2-SPEC.md` | build briefs, mostly executed |
| `LAUNCH-PLAN.md` | the phase plan, still the roadmap |

## 6b. Two facts to check before promising anything built on them

Both came from the WordPress side, 28 August 2026, and both are the kind of
thing that gets promised in a settings screen before anyone checks.

**Search Console's Generative AI report is not in any API.** It exists, it was
fully rolled out to every property on 11 August 2026, and it can only be
exported by hand. So connecting Search Console brings the ordinary search data,
not the AI figures a merchant would connect it for. If a connection card is
ever built, that sentence belongs on it before the button.

**If external connections are built, use a service account, not OAuth.** Google
requires a client secret for a refresh token, so OAuth would mean running an
authentication service holding every merchant's credentials. With a service
account the merchant creates the credential and the requests go from them to
Google. On Shopify the key must live in the app's own encrypted storage and
never in a metafield, because metafields are readable by the merchant's other
apps.

## 7. Next three things

1. Activate the app embed in the dev store's theme and confirm the JSON-LD
   and the mirror link appear on a product page.
2. Implement billing per `BILLING-SPEC.md`.
3. Onboarding that will not show success until the embed is live.
