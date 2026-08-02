# ARCHITECTURE — AI Visibility All-in-One

Decided 2 August 2026. Hosting confirmed by Marius: Fly.io + Neon.
Companion to `PRD.md` §5. This is the document Claude Code builds from.

---

## 1. Topology

```
                    ┌─ Fly.io region ams ─┐      ┌─ Fly.io region iad ─┐
  Shopify admin ───▶│  web (Remix)        │      │  web (Remix)        │
  App proxy    ───▶ │  shared-cpu-1x 1GB  │      │  shared-cpu-1x 1GB  │
                    └─────────┬───────────┘      └─────────┬───────────┘
                    ┌─ ams ───┴───────────┐                │
                    │  worker (graphile)  │                │
                    │  shared-cpu-1x 1GB  │                │
                    └─────────┬───────────┘                │
                              ▼                            ▼
                    Neon Postgres, AWS eu-central-1 (Frankfurt)
                    (pooled connection string, DATABASE_URL secret)
```

- **App**: one Fly app, two process groups in `fly.toml`:
  `web` (Remix server, 2 machines: ams + iad) and `worker`
  (graphile-worker, 1 machine, ams — next to the database).
- **Database**: Neon project `ai-visibility`, Postgres 17, Frankfurt,
  Free plan until real customers, then Launch (~$19/mo). Pooled
  connection string only.
- **Queue**: graphile-worker tables inside the same database. Jobs
  survive restarts and closed tabs by construction. No Redis anywhere.
- **Cost**: ~$10–20/month at launch, ~$40–70 at real traffic (PRD §5.1).

## 2. What runs where

| Path | Handled by | Data touched |
|---|---|---|
| Admin UI (embedded, Polaris) | web, nearest region | Postgres (settings, job status), Admin API |
| OAuth, webhooks | web | Postgres (sessions, shops) |
| App proxy `/apps/ai-visibility/*` | web | **Postgres cache only** — never the Admin API (PRD §5.2) |
| Extraction, bulk passes, alt text, IndexNow pings, theme JSON-LD detection | worker | Admin API (throttled per PRD §5.5), Postgres |
| Crawler reachability check | worker (outbound HTTP with bot user agents) | merchant storefront, from outside Shopify's network |

## 3. Latency budget (Built for Shopify: p95 ≤ 500 ms)

- EU merchant → ams web → Frankfurt DB: single-digit ms DB hops. Easy.
- US merchant → iad web → Frankfurt DB: ~90 ms per DB round trip.
  Rule: **at most one DB round trip on any admin request path** —
  session + shop settings load in one query; everything else is either
  cached in-process or deferred to the worker.
- Proxy route: responses pre-rendered into the `mirror_cache` table at
  extraction time; the request path is a single indexed read + static
  headers (`Content-Type: text/plain; charset=utf-8`, canonical `Link`).
- If US install share grows past ~40%, add a Neon read replica in
  us-east-1 and point iad reads at it. Not before.

## 4. Own database schema (merchant data lives in metafields, not here)

| Table | Holds |
|---|---|
| `shops` | shop domain, access token (encrypted), plan, install state |
| `sessions` | Shopify session storage (Remix adapter) |
| `settings` | dictionary text, stopword additions, module toggles per shop |
| `jobs` (graphile) | queue internals |
| `job_runs` | bulk pass progress, dry-run reports, per-product outcomes |
| `mirror_cache` | rendered markdown per product handle |
| `theme_scan` | detected theme JSON-LD state per shop, per theme |
| `crawler_checks` | check results, timestamps, diagnosed causes |
| `request_metrics` | p95 self-measurement, so BfS numbers are known before Shopify tells us |

Nothing merchant-authored is stored here. Uninstall (`app/uninstalled` +
`shop/redact`) deletes the shop's rows; metafields stay with the store —
the honest-exit promise from PRD §6.1 is enforced by this split.

## 4.1 Keeping the catalogue fresh — three layers

Webhook delivery is best-effort: Shopify retries, but a deploy, a timeout
or an endpoint hiccup can still lose one. A merchant must never discover
months later that a season of products was never processed. So freshness
is layered, each layer catching what the one before it missed:

| Layer | Trigger | Latency | Cost |
|---|---|---|---|
| 1. Webhooks | `products/create`, `products/update`, `products/delete` | seconds | negligible |
| 2. Incremental poll | cron, every 15 minutes: `updated_at:>last_polled_at` | ≤15 min | one paginated query per shop |
| 3. Reconciliation sweep | cron, weekly: bulk read, queue anything with no `facts` | ≤7 days | one bulk operation per shop |

Two properties make layering safe rather than wasteful:

- **Writes are idempotent.** The same description produces the same
  attributes, and the `state` metafield refuses to overwrite human values,
  so processing a product twice changes nothing.
- **`jobKey` deduplicates.** A product queued by both a webhook and the
  poll collapses into a single job.

The poll advances its cursor only on success: a failed run retries the
same window rather than skipping it. This is the one place where being
slightly wasteful is correct.

## 5. Secrets and config

- `DATABASE_URL` (Neon pooled), `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
  `ENCRYPTION_KEY` (token encryption at rest) — all via
  `fly secrets set`, never in the repo.
- App config is code: `shopify.app.toml` in the repo, deployed with
  `shopify app deploy`. The Dev Dashboard version form is never edited
  by hand (established 2 Aug — the CLI overwrites it).
- Scopes: `write_products`, `read_themes`. Add nothing until a feature
  demands it; every extra scope is a review question.

## 6. Deploy pipeline

1. GitHub repo: `github.com/kazgool/ai-visibility-shopify`.
2. `fly deploy` from GitHub Actions on main: build once, deploy to both
   regions; worker deploys with the same image, different process.
3. `shopify app deploy` in the same workflow releases config/extension
   versions (theme app extension ships as an extension in the repo).
4. Health checks on `/healthz` (DB ping included) gate the rollout;
   Fly rolls back on failure.
5. `request_metrics` dashboards from day one — BfS eligibility (§PRD 5.2)
   is a launch-week concern, not an afterthought.

## 7. Environments

- **Dev**: `shopify app dev` tunnels to the developer machine against
  the mrdigital-dev store (created 2 Aug). Neon branch `dev` — Neon
  branches are copy-on-write, so dev never touches production data.
- **Prod**: the Fly app. One environment; no staging until there are
  paying merchants to protect.
