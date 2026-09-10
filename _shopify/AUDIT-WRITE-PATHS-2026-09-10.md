# Audit: every write path and public surface, gated or not

10 September 2026. Prompted by the collections pass writing to 2,491
collections on Republica BIO's first day, including unpublished and empty
ones: collections were gated on their members and never on themselves, while
products had carried every gate for weeks. The question here is whether the
same shape of gap exists anywhere else.

## Method

Two delegates, blind to each other, different framings, raw logs kept:

- `audit-logs-2026-09-10/A-inventory.md`: enumerate every write site and
  public surface, and for each say which of five gates stands in front of
  it, with file:line. 23 rows.
- `audit-logs-2026-09-10/B-adversarial.md`: for five invariants the app
  promises, try to find a path that breaks each one. 24 logged attempts,
  failed attempts included, since those are what prove an invariant holds.

Every claim below was then checked against the source by the main session,
not taken from either log. Where a delegate could not determine something,
it was traced here and is marked closed or left open.

The five gates: G1 eligibility of the object itself (`eligibility()`,
`app/services/eligibility.ts:68`); G2 human text never overwritten
(`mayWrite` `facts.server.ts:115`, `mayWriteSeo` `seo.server.ts:71`, the
`state` metafield); G3 entitlement (`hasPaidAccess`, `isFreeProduct`,
`isComped`, `isSeoUnlocked` in `billing.server.ts`); G4 never write an
identical value; G5 withdraw a stale auto value when a pass produces nothing.

## Findings, verified, ranked by damage to a live store

### 1. llms.txt loads every product's whole mirror body on the request path

`app/services/llms-txt.server.ts:213`: `mirrorCache.findMany` with no limit,
selecting `body`, for every product, on every uncached request to
`/apps/ai-visibility/llms.txt` and `agents.md`. Only two front-matter lines
are read from each body. `MirrorCache` has no title column, so the body is
the only place the title lives.

Confirmed. Today: 189 bodies per uncached request, one request per five
minutes at most (the route sets `Cache-Control: public, max-age=300`). On a
20,000-product store, the plan's upper tier, it is 20,000 bodies. This is the
public storefront path and it scales with the exact number the product is
sold on. Not a failure today; a certainty later.

Fix without a migration: read the front matter with a raw query that takes
the first kilobyte of each body, `substring(body from 1 for 1024)`, which is
where the front matter sits. Ten to thirty times less data. The clean fix is
`title` and `url` columns on `MirrorCache`, written where the body is, and
that is a migration with a down path to think through first.

### 2. Alt text: a description that looks like a filename is replaced, whoever wrote it

`app/services/alt-text.server.ts:112`: an existing alt is kept only when
`!looksLikeMachineAlt(existing)`. Alt text lives on the media object, not in
a metafield, so there is no `state` entry for it; the text's shape is the
only guard. A merchant who typed `DSC_4471` or a bare SKU as alt text will
have it replaced, and nothing records what was there.

Confirmed, and narrow. The heuristic is deliberate and its reasoning is
sound: `DSC_4471` is not a description whoever typed it, and a screen reader
spelling it out is the failure the writer exists to prevent. It is still the
one place where "nothing a person wrote is overwritten" is decided by the
text rather than by provenance. Decision for Marius: keep the heuristic and
record the replaced value so it can be restored and shown ("we replaced
DSC_4471 on image 2"), or tighten the heuristic. Not urgent; the shape it
fires on is rarely something a person meant.

### 3. SEO apply writes to a product that went draft after the queue was built

`app/services/seo-bulk.server.ts:178-184`: `runSeoApply` re-fetches each
product immediately before writing, so `mayWriteSeo` and the identical guard
see the current state, but it never calls `eligibility()` on the fresh read.
A product drafted between "Preview" and "Write" still receives its meta
title and description. Same in `runCollectionSeoApply`.

Confirmed, low. The fields sit on the Product object; a draft page does not
render, so nothing false reaches a reader, and the value is right if the
product is republished. It is an untidy write to something the merchant just
took off the shelf. Fix: `eligibility(fresh, prefs)` in that loop, skip and
count as skipped.

### 4. The theme-publish webhook writes a shop metafield with no entitlement check

`app/routes/webhooks.themes.publish.tsx` writes `theme_scan` on every theme
publish, where the scheduled `seo_watch` doing the same write checks
`mayProcessAutomatically` first. Confirmed, low: a diagnostic metafield,
once per theme publish, never merchant-visible content. Fix: the same check
at the top of the handler.

### 5. Webhook-driven extraction after a subscription lapses

`billing.server.ts` documents that a shop whose subscription lapsed and was
never reopened keeps receiving webhook-driven `extract_product` runs. The
code says this is intended. B raised it as an ambiguity against the free-tier
promise, not as a bug. Decision for Marius: does "nothing is taken away" mean
maintenance continues after lapse, or does lapse end automatic runs? The
code currently says the former.

### Noted, not gaps

- `app.products.$id.tsx` per-product saves have no whole-form no-op skip
  (A2): one human click, one write, no loop. Note only.
- `app.business.tsx` saves business facts without an entitlement check (A3):
  the facts feed writes that are themselves gated. Correct as is.
- The storefront Liquid block reads `product.metafields['$app'].*` with no
  status check (A5): correct, Shopify does not render a draft product page.
  Read here: `extensions/ai-visibility/blocks/ai-visibility.liquid` carries
  one `<script type="application/ld+json">` and no executable script, no
  fetch. `extensions/product-panel` is an admin UI extension
  (`admin.product-details.block.render`), not storefront.

## Invariants that hold, with what proved them

- I2, no draft product reaches an AI surface: the only path that creates a
  `MirrorCache` row is `extract.server.ts:150` (`cacheMirror`), reached at
  `:461` only when `eligibility(product, prefs) === "eligible"`. The other
  two writers, `extract.server.ts:192` and `mirror-reconcile.server.ts:133`,
  are updates on a rename and the withdrawal sweep. `withdrawIfIneligible`
  (`:221`) deletes on a lost verdict. Closes B's I2.4.
- I3, free tier: the per-product route checks `hasPaidAccess` then
  `isFreeProduct` (`app.products.$id.tsx:433-435`); every bulk task refuses a
  free shop before reading, which the worker log shows for picturax and
  gilded-lily today (`bulk_collections ... refused, no active subscription or
  comp`). Closes B's I3.5 and I3.6.
- I4, no self-feed: every bulk writer compares to the fetched current value
  and pushes `unchanged`; `state` is written only when `touched`. One item
  left open below.
- G1 on collections, the gap that started this: closed today in
  `collections.server.ts` (`published_status:published` in the query, every
  field empty and withdrawn at `members === 0`, test in
  `collections.eligibility.test.ts`).

## Open, not determined

- Whether the `ProductInput` snapshot handed to `writeFacts` can be stale
  against the live metafield when one fetch serves several products' writes
  (B's I4.2). `extract.server.ts` was grepped, not read end to end. If it
  can, the identical guard compares against the wrong value and one extra
  write happens; it would not loop, because the next pass compares against
  the fresh value.

## Can a deploy take the store down

Asked directly today. No, and here is why rather than a reassurance.

The store's own pages never touch this server at request time: the theme
block is Liquid reading metafields, with JSON-LD as data and no script and
no fetch. A deploy cannot change what those pages render. What a deploy can
affect is only the app proxy paths, `/apps/ai-visibility/*`: the mirror
pages, llms.txt, agents.md. `fly.toml` runs two web machines (ams, iad) with
`min_machines_running = 2`, `auto_stop_machines = false`, a `/healthz` check
every 30 seconds with a 20-second grace, and no `strategy` override, so
deploys roll one machine at a time; today's logs show iad and ams replaced 40
seconds apart. One machine always serves.

The one real deploy hazard is the worker, and it is the opposite of a crash:
a job in flight when the machine restarts keeps its lock for four hours and
disables the dashboard. Covered in the changelog entry of the same day;
`scripts/queue-unstick.ts` read-only is run before every push until the
signal handling ships.

## Order of work

1. Now, with the next deploy: 3 (eligibility in SEO apply) and 4
   (entitlement in the theme webhook). Small, tested, no migration.
2. Next wave: 1, the llms.txt read, as the raw-substring form first, columns
   when a migration is planned; the worker signal handling and
   `maxJobExpiry`; the honest "job is stuck" message.
3. Marius decides: 2 (alt-text provenance) and 5 (post-lapse webhooks).
