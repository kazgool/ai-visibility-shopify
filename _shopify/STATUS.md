# STATUS — where this project stands

Last updated 3 August 2026. Read this first in a new session, then
`PRD.md` for what we are building and `ARCHITECTURE.md` for how.

---

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

## 7. Next three things

1. Activate the app embed in the dev store's theme and confirm the JSON-LD
   and the mirror link appear on a product page.
2. Implement billing per `BILLING-SPEC.md`.
3. Onboarding that will not show success until the embed is live.
