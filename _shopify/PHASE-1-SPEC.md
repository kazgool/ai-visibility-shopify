# PHASE-1-SPEC — skeleton that installs and uninstalls cleanly

Build brief for Claude Code. Written 2 August 2026.
Read first: `PRD.md`, `ARCHITECTURE.md`. Do not re-derive decisions made
there; if something here conflicts with reality (CLI output, API
changes), stop and report rather than improvise.

Everything Shopify-facing already exists: app **AI Visibility All-in-One**
(Dev Dashboard org 229253428, app id 405463269377), dev store
**mrdigital-dev**, Fly.io account, Neon project `ai-visibility-shopify`
(Frankfurt, Postgres 17). Repo:
**github.com/kazgool/ai-visibility-shopify** — work there. Secrets (client ID/secret, DATABASE_URL) are
provided by Marius at deploy time via `fly secrets set` — never ask for
them, never commit them.

---

## 1. Deliverable

A Remix app scaffolded with `npm init @shopify/app@latest`, linked to the
existing app with `shopify app config link`, that:

1. installs on mrdigital-dev through OAuth, embedded via App Bridge;
2. answers the three GDPR webhooks correctly;
3. creates our metafield definitions on install;
4. cleans up on uninstall;
5. shows one Polaris page listing the first 50 products, and nothing else.

Language: TypeScript, strict. API: **GraphQL Admin API 2026-07 only** —
one REST call is a review rejection (PRD §5.1).

## 2. Structure

Follow the template's layout. Additions:

```
app/
  db.server.ts          — Neon pool (pooled URL), one pool per process
  models/               — shops, settings (ARCHITECTURE §4 tables)
  services/metafields.server.ts
  routes/webhooks.*.tsx — one route per webhook topic
worker/
  index.ts              — graphile-worker runner (empty task list for now)
migrations/             — SQL migrations, plain files, run by a script
fly.toml                — web (ams, iad) + worker (ams) process groups
.github/workflows/deploy.yml
```

Session storage: the Shopify-provided Postgres session adapter against
our `sessions` table, not SQLite (the template default).

## 3. Webhooks

Mandatory, App Store blockers (PRD §5.3):

- `customers/data_request` → we hold no customer data; respond 200 with
  an empty payload log entry.
- `customers/redact` → same, 200.
- `shop/redact` → delete the shop's rows from every table in
  ARCHITECTURE §4. Fires ~48h after uninstall.

Operational:

- `app/uninstalled` → mark shop uninstalled, revoke token record, keep
  rows until `shop/redact` (Shopify's ordering, not ours).
- `products/update`, `products/delete`, `themes/publish` → register now,
  handler bodies are `TODO(phase-2/3)` stubs that 200 and log.

All handlers verify HMAC (the template does this — keep it), respond
within 5s, and do no real work inline: anything slow goes to the queue.

## 4. Metafield definitions on install

On first authenticated load (idempotent — check before create), create
definitions per PRD §5.4 in the app-reserved namespace (`$app`):

| key | type | name shown to merchant |
|---|---|---|
| `summary` | multi_line_text_field | AI summary |
| `facts` | json | Comparable attributes |
| `questions` | json | Starter questions |
| `fit_for` | single_line_text_field | Who it suits |
| `state` | json | AI Visibility state |

Product-level now; variant-level and collection-level come in Phase 2/3.
Definitions get `access.storefront: PUBLIC_READ` so themes can render
them without us. Removal: only on explicit merchant request (a settings
action, Phase 4) — never on uninstall, the data belongs to the merchant
(PRD §4.1).

## 5. The one admin page

`/app` route: Polaris `Page` + `IndexTable`, first 50 products (GraphQL
`products(first: 50)` — title, status, featured image thumb). No
actions, no filters, no polish. It exists to prove embedded auth and
GraphQL work. Include the App Bridge `NavMenu` with this single item.

## 6. Deploy

- `fly.toml` per ARCHITECTURE §1: app in ams+iad (web), worker in ams,
  1GB shared-cpu-1x each, `/healthz` check that pings the DB.
- GitHub Actions: on push to main → migrate, `fly deploy`, then
  `shopify app deploy` (config + future extensions). Tokens via repo
  secrets (`FLY_API_TOKEN`, `SHOPIFY_CLI_PARTNERS_TOKEN`).
- `shopify.app.toml` carries: name, scopes `write_products,read_themes`,
  webhook subscriptions (2026-07), app proxy prefix `apps` subpath
  `ai-visibility` (URL can point at the Fly app already — the route
  returns 501 until Phase 3), embedded true.

## 7. Exit test (LAUNCH-PLAN Phase 1)

On mrdigital-dev: install → uninstall → wait for `shop/redact` (or
simulate) → reinstall. Assert:

- no orphaned rows for the shop after redact;
- metafield definitions exist after each install, created once;
- OAuth completes embedded, no full-page redirects out of admin;
- all six webhook subscriptions registered (verify via GraphQL
  `webhookSubscriptions` query);
- `/healthz` green in both regions;
- zero REST calls anywhere in the codebase (grep for `/admin/api/` REST
  paths in CI as a guard).

Write these as a checklist script where automatable; manual steps get a
`VERIFY.md` with exact click paths.
