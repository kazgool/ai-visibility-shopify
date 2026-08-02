# Phase 0 — research findings and decisions

Written 2 August 2026. Answers to the four blocking questions from
`LAUNCH-PLAN.md`, researched where possible, left to Marius where not.

---

## 1. Name: "AI Visibility" is effectively taken

The App Store already carries an app titled **"AI Visibility ‑ ChatGPT
Gemini"** (by Mento, handle `mento-boost-your-ai-presence`), plus a crowded
field: "AIO – AI SEO Visibility Engine", "Agentic Shopper: AI Visibility",
"Visibly", "CitationCore". Shopify review rejects names likely to be confused
with existing apps, and plain "AI Visibility" would be.

Options, in order of preference:

1. **Keep the brand, add a distinguisher** — e.g. "AI Visibility: Comparable
   Facts" or "AI Visibility by MR Digital". Keeps continuity with the
   WordPress product and landing page.
2. A new name for Shopify only, positioned on the actual headline feature
   (comparable attributes), e.g. "Product Facts for AI".

The handle in the URL is derived from the listing name and must be unique;
whatever is chosen, register it early in the Partner dashboard.

**Decision needed from Marius.**

## 2. Hosting: Fly.io recommended

The bar is p95 under 500 ms from both EU and NA, plus a job queue that
survives closed tabs.

- **Fly.io** — the fit. Multi-region (deploy the same app in `ams` + `iad`),
  separate worker process groups for the job queue, Fly Postgres or managed
  upstream DB. Sub-200 ms typical latency per region. Most operational
  knobs, slightly more setup.
- **Railway** — fastest to deploy, good DX, but single-region per service;
  meeting p95 from both continents means fronting with a CDN or accepting
  transatlantic hops on half the traffic.
- **Render** — simple, has cron and background workers, but multi-region
  requires paid tiers and is less mature than Fly.

Recommendation: **Fly.io, two regions (ams + iad), web + worker process
groups, Postgres with the queue in-database (e.g. BullMQ needs Redis —
prefer a Postgres-backed queue like graphile-worker to keep one datastore).**
Details go into `ARCHITECTURE.md` once confirmed.

**Decision needed from Marius (confirm or veto).**

## 3. Development store: only Marius can do this

Create via the Partner dashboard, then seed the furniture catalogue
(100+ products with prose descriptions). A CSV export from the live
WooCommerce furniture site, converted to Shopify's product CSV format, is
the fastest seed path — I can write the converter once given the export.

**Blocked on Marius: Partner account + store URL + catalogue export.**

## 4. Build model: decided

Specs written here, Claude Code builds, output reviewed. First spec to
write is `DICTIONARY-PORT.md`, taken from
`plugin/ai-visibility/includes/class-avw-attributes.php` and the 96
assertions in `tests/smoke-test.php` in the WordPress folder. This is not
blocked by anything above and is the next piece of work.

---

## PRD fact-check (verified 2 Aug 2026)

- **Shopify owns `/llms.txt` and `/agents.md`** — confirmed. Since May 2026
  Shopify serves `agents.md` natively as the canonical AI discovery file;
  `llms.txt` and `llms-full.txt` redirect to it. One nuance the PRD missed:
  merchants can customise the content via theme templates
  (`agents.md.liquid`, `llms.txt.liquid`). That is a theme file, not an app
  surface — same category as `robots.txt.liquid`. A "copy these rules"
  helper could cover both files in feature 4.7.
- **GraphQL-only for new public apps since 1 April 2025** — confirmed. A
  single REST call is grounds for rejection.
- **Built for Shopify: p95 ≤ 500 ms, ≥1,000 requests/28 days, failure rate
  <0.1%, ≤10-point storefront performance impact** — confirmed, current.
- Shopify also shipped `.well-known/ucp` and an MCP endpoint
  (`/api/ucp/mcp`) per store in May 2026 — reinforces the PRD's rule:
  build nothing whose only value is a route Shopify could claim.

---

## What unblocks Phase 1

1. Name decision (Marius)
2. Hosting confirmation (Marius — Fly.io proposed)
3. Partner account + development store + seeded catalogue (Marius)
4. `DICTIONARY-PORT.md` (me — can start now)
