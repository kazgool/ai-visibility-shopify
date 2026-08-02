# PHASE-2-SPEC — the extraction engine

Build brief. Written 2 August 2026, after Phase 1 shipped (app installs
on mrdigital-dev, 355 real furniture products loaded, 5 metafield
definitions created).

Read first: `DICTIONARY-PORT.md` (the contract), `PRD.md` §4.1 and §5.4,
`ARCHITECTURE.md` §4–5. `DICTIONARY-PORT.md` wins over this document on
any behavioural question.

---

## 1. Deliverable

The WordPress extraction engine, ported to TypeScript, wired to Shopify:

1. `app/engine/` — pure functions, zero Shopify imports, fully unit tested
2. `app/services/extract.server.ts` — engine output → metafield writes,
   with `state` provenance and human-edit protection
3. `worker/tasks/` — bulk pass and single-product re-extraction, queued
4. A dry-run report the merchant sees before anything is written
5. Test suite green, including the three fixtures from DICTIONARY-PORT §12

Nothing merchant-facing beyond a minimal trigger button; the real admin
UI is Phase 4.

## 2. Engine module layout

```
app/engine/
  dictionary.ts   — parse() per DICTIONARY-PORT §2, presets, default list
  normalize.ts    — normalize(), diacriticPattern() per §8
  stopwords.ts    — the verbatim list from §11, plus merchant additions
  measurements.ts — #size reader per §6
  counts.ts       — * term reader per §7
  phrase.ts       — trimPhrase(), isUsablePhrase() per §5.1–5.2
  extract.ts      — the assembly loop per §3–§5, §9
  index.ts        — public API: extract(text, dictionary, options)
```

Rules:

- **No Shopify, no Prisma, no I/O inside `app/engine/`.** Input is a
  string plus a parsed dictionary; output is `{ k, v }[]`. This is what
  makes the port testable against the WordPress original.
- Every regex carries the `u` flag. Every comparison against stopwords
  goes through `normalize()`.
- Keep the WordPress comments that explain *why* a rule exists. They are
  the memory of real failures; a future reader will otherwise "simplify"
  the stopword gate and reintroduce "masa are blatul".

## 3. Input on Shopify

Prepared text per DICTIONARY-PORT §8:

```
title + ". " + stripHtml(descriptionHtml)
```

whitespace collapsed, trimmed, lowercased Unicode-aware, diacritics kept.
No excerpt field exists on Shopify — the WooCommerce short description
was merged into the body at import time.

## 4. Writing results

Target metafields (namespace `$app`, product owner):

| key | content |
|---|---|
| `facts` | JSON array of `{ k, v }` exactly as the engine returned |
| `summary` | Phase 2b (answer capsule) — leave untouched for now |
| `questions`, `fit_for` | Phase 2b |
| `state` | provenance, see below |

`state` shape:

```json
{
  "facts": { "source": "auto", "at": "2026-08-02T18:00:00Z", "engine": "1.0.0" },
  "summary": { "source": "human", "at": "..." }
}
```

Rules, non-negotiable (PRD §4.1, DICTIONARY-PORT §10):

- Before writing key K, read `state.K`. If `source == "human"`, **skip**
  and record the skip in the job report. Never overwrite.
- After writing, set `state.K.source = "auto"` with timestamp and engine
  version.
- A merchant edit (Phase 4 UI, or any value changed outside our writes)
  sets `source: "human"`. Until the UI exists, treat any existing
  metafield value with no `state` entry as **human** — the safe default.

Writes go through `metafieldsSet` (25 per call). Never `productUpdate`
for metafields.

## 5. Reading the catalogue

- **Bulk pass**: one `bulkOperationRunQuery` over
  `products { id title descriptionHtml metafields(namespace: "$app") }`,
  poll `currentBulkOperation`, stream the JSONL result. Never paginate a
  10,000-product catalogue by hand.
- **Single product** (`products/update` webhook): plain query by id.
- Throttle writes off `extensions.cost.throttleStatus` from each
  response; back off when `currentlyAvailable` drops below the next
  mutation's cost. PRD §5.5.

## 6. Jobs

graphile-worker tasks:

| task | payload | does |
|---|---|---|
| `bulk_extract` | `{ shopId, dryRun }` | full catalogue pass; writes `JobRun.progress/total/report` |
| `extract_product` | `{ shopId, productId }` | one product, queued by webhook |

Both are resumable: a killed worker re-runs the job from `JobRun` state
without duplicating writes (writes are idempotent — same input, same
output, and `state` guards human values).

## 7. The dry run

`bulk_extract` with `dryRun: true` writes nothing and produces:

- coverage per DICTIONARY-PORT §9: products sampled, products with zero
  facts, hit count per label sorted descending;
- 20 example products with their would-be facts, so the merchant can see
  the dictionary's quality before committing;
- count of products that would be skipped because a human value exists.

This report is what makes the bulk pass safe to offer. It is also the
Phase 4 onboarding's centrepiece.

## 8. Tests — the actual acceptance gate

`app/engine/__tests__/` with vitest:

1. **The three fixtures** from DICTIONARY-PORT §12, byte-for-byte. These
   are the contract with the WordPress engine. Fixture C in particular:
   `130` present, `6 scaune` present, `piele ecologica` once, and none of
   `are blatul` / `cat si` / `se gasesc` / `aflat sub` / `se face`.
2. **Unit tests per module**: dictionary parse (including `| default:`),
   normalize, diacritic matching both directions, measurement patterns 1
   to 3 including the "third only if first two empty" rule, count reader,
   phrase trim and the stricter usable-phrase test, subsumption, the
   4-value cap.
3. **Provenance tests**: human value never overwritten; missing `state`
   treated as human; auto value refreshed correctly.
4. **A real-catalogue smoke run**: point the engine at 20 exported
   descriptions from the 355 furniture products (fixture file in the
   repo, no network) and assert no output value contains a stopword.

CI runs these on every push. A failing fixture blocks the merge — the
port has no value if it drifts from the proven behaviour.

## 9. Exit test (LAUNCH-PLAN Phase 2)

Run the engine against mrdigital-dev's 355 products and compare, product
by product, with what the WordPress plugin produces on the same
descriptions. The furniture catalogue is the same one the WordPress rules
were derived from, so any difference is a bug in the port. Record the
comparison as a checked-in report.

## 10. Out of scope here

Summary, starter questions and `fit_for` generation (Phase 2b), any
storefront rendering (Phase 3), the dictionary editor UI, presets picker
and progress view (Phase 4). Build the engine, prove it matches, stop.
