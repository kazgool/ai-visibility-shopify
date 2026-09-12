# Batch 6 handover, 12 September 2026

The doubt-driven review of batch 5, from `CC-PROMPT-BATCH-6.md`. Seven items,
one commit each, on top of batch 5. **Nothing is pushed.** Nothing is
deployed. No decision in section D was taken.

---

## The run, after the last code commit

```
npx tsc --noEmit                 clean
npm test                         102 test files, 1969 tests, all passed
npm run build                    built in 1.01s, build/server/index.js 920.29 kB
node scripts/check-liquid.mjs    no literal braces inside output tags
node scripts/check-liquid-json.mjs
                                 8 nodes, 8472 combinations, every one parses
```

The test guard from CLAUDE.md, `.env` renamed away, which is what CI sees:
**102 test files, 1969 tests, all passed.** `.env` restored afterwards and
confirmed present.

`check.bat` itself was not used: it ends in `pause`, so it blocks a
non-interactive run. Its steps were run individually and are listed above in
its own order.

---

## One line per item

1. **Done.** Rule 1's bound pattern now requires a non-letter, non-digit or
   the start of the string in front of the bound, and `boundBefore` drops a
   half word left at the edge of its lookback. Corpus-derived tests added for
   the real instance and for both shapes the prompt named.
2. **Done.** Rule 4 takes truncation evidence and drops only when the sentence
   provably carries on past the figure. Tests updated for the signature and
   added for the two shapes.
3. **Done.** The decimal comma is normalised before `plus: 0` on the rating
   value, not on the count; `av_rating_count` gained the `.value.value`
   fallback. Both tested, both checked failing first.
4. **Done.** Ruled out: gift cards are not an uncovered path, settled by
   reading the live page.
5. **Done.** The three pages are the same three, one cause, table below.
6. **Done.** `sortKey: ID` explicit, on all five queries of that class rather
   than the one named.
7. **Done, with the honest half stated.** No general staleness signal exists;
   the page and the response headers were checked live and neither carries
   one. The specific signal that does exist, `ourLiquidError`, is now recorded
   by the theme scan and surfaced on the rescan result with both readings
   named. Nothing was invented in place of the general one.

And the one thing the prompt asked to be stated plainly:

**Which of items 1, 2 and 3 moved the measurement: none of them.** Item 1
changed 4 values in 5,998 corpus products (2 Size on animax.ro, 2 Strength on
moleculesofyouth.com); none on Republica BIO, none in the hold-out. Item 2
changed 0 values, because no capture in the corpus reaches the rule. Item 3 is
Liquid and cannot change a corpus figure. The whole abstention sweep was
re-run on the corrected engine and **every figure is identical to the value**,
at all four settings, on both the hold-out and Republica BIO. The three
decisions that read those numbers are unblocked and unchanged.

---

## Item 5, the reconciliation, page by page

Aggregate scan: `npx tsx scripts/read-node-gaps.ts republicabio.myshopify.com`,
rows written 12 September 03:51. Live read: each page fetched 12 September
08:03.

| Page | Aggregate scan | Live read | Same cause? |
|---|---|---|---|
| `miere-de-manuka-manuka-lab-mgo-300-...` | 200, app block present, ours=0 theirs=0, 2 nodes (Organization, BreadcrumbList) | our Liquid error, line 397 | yes, ours |
| `miere-de-manuka-manuka-lab-mgo-525-...` | 200, app block present, ours=0 theirs=0, 2 nodes (Organization, BreadcrumbList) | our Liquid error, line 397 | yes, ours |
| `card-cadou-republica-bio` | 200, app block present, ours=0 theirs=0, 2 nodes (Organization, BreadcrumbList) | our Liquid error, line 397 | yes, ours |

182 pages read, 3 with no Product node, and these are those 3. They are not a
different set and they do not have separate causes. The single-page theme scan
reads `card-cadou-republica-bio`, correctly saw no Product node of ours, and
wrote `ourProductNode: false` - one broken page switching `additionalProperty`
off for all 189 products.

On the gift card page specifically, the four JSON-LD scripts are: our
Organization (parses), our Product (does **not** parse - the error comment is
inside it, after `sku`), the theme's BreadcrumbList (parses), our FAQPage
(parses). So our block does render on a gift card product, it did emit a
Product node body, and `isOurNode()` never gets the chance to see it because
the JSON is destroyed before parsing. After the deploy it will parse and carry
our marker.

One correction to a reading that looked right and was not: `ourLiquidError` in
the stored scan rows is **absent**, not false. The detector shipped in batch 5,
which is not deployed, so no row the nightly scan wrote can carry it. The
first version of the new line in `read-node-gaps.ts` defaulted it to false and
printed "our block rendered cleanly" for all three pages. It now prints
absence as absence.

---

## What Marius does next, in order

1. Read section 4 of `DECISIONS-FOR-MARIUS-2026-09-12.md`. Nine decisions,
   nothing waiting on a measurement any more.
2. Say whether batch 5 and batch 6 are pushed. Nothing is pushed until then.
3. When pushed and deployed: `npx shopify app deploy`, then re-run the theme
   scan on the SEO screen, in that order. If the rescan still reports our own
   Liquid error, scan once more a minute later before treating it as a
   failure - the new finding says so on the screen.

`npx tsx scripts/queue-unstick.ts` was run before handing over, as the prompt
asks. Output, in full:

```
READ ONLY: jobs locked for more than 10 minutes

  locked jobs   0
  stale JobRun  0

Nothing is stuck.
```

---

## Not done, and deliberately

- **No decision in section D was taken.** Four are new, five carried.
- **The five symbolic bounds that can never fire** (`<`, `>`, the two
  inequality signs, `~`) are reported, not fixed: `normalize()` strips them
  before rule 1's pattern runs, so "greutate < 2 kg" still publishes "2 kg".
  Making them work would add values across the corpus that no judge has seen.
- **A version marker printed by the block** is the only thing that would give
  a general staleness guard, and it is a decision (4.6), not a patch.
- **`ourProductNode` still comes from one page.** Batch 6 pinned which page;
  it did not change where the number comes from, which is decision 4.4, as
  batch 5 item 12 instructed.
