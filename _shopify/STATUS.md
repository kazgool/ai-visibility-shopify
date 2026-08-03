# STATUS — where this project stands

Last updated 3 August 2026. Read this first in a new session, then
`PRD.md` for what we are building and `ARCHITECTURE.md` for how.

---

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
