# The merchant's own questions: why the source stays off

Batch 5 item 8. Judged verdicts read from `_shopify/corpus/verdicts/*.json`,
de-duplicated by pair id so a store judged in two runs is counted once.

## The number, corrected

The prompt for this batch states 2.19% combined and 2.41% on Republica BIO.
Those figures are the batch-3 measurement over 320 judged pairs (291 Republica
BIO from dev run 13, 29 hold-out from run 4), and they are what
`app/engine/faq.ts` still records in the comment above
`FAQ_MERCHANT_QUESTIONS_LIVE`.

Over every merchant Q&A judged since, the figure is worse:

| Set | Judged | Errors | Error rate |
|---|---|---|---|
| all stores | 900 | 71 | **7.89%** |
| republicabio.ro | 830 | 61 | **7.35%** |
| moleculesofyouth.com | 14 | 7 | 50.00% |
| herbaris.ro | 20 | 0 | 0.00% |
| rusticart.ro | 18 | 0 | 0.00% |
| iarmaroc.com | 7 | 0 | 0.00% |
| animax.ro | 3 | 0 | 0.00% |
| thesill.com | 2 | 0 | 0.00% |
| miledy.ro | 2 | 0 | 0.00% |
| twelvesouth.com | 2 | 1 | 50.00% |
| terraissa.com | 1 | 1 | 100.00% |
| toskovat.com | 1 | 1 | 100.00% |

The bar is 1% on the combined set and on Republica BIO. Neither is met, by a
factor of seven.

## The classes

| Class | Errors | Share of the 71 errors | Share of all 900 judged |
|---|---|---|---|
| the merchant's heading is not a well formed question in its language | 10 | 14.1% | 1.11% |
| a well formed question with no subject: it cannot be read away from the page | 29 | 40.8% | 3.22% |
| the answer points at a link the description no longer carries | 6 | 8.5% | 0.67% |
| a multi-item pack answered with one item's data | 12 | 16.9% | 1.33% |
| the same question already asked by another source | 6 | 8.5% | 0.67% |
| the answer is cut so it no longer answers | 4 | 5.6% | 0.44% |
| not matched by any class above | 4 | 5.6% | 0.44% |

The prompt says five of the seven errors are the merchant's garbled heading
published verbatim. That was true of the seven. It is not true of the
seventy-one: the garbled heading is 10 of them, and the largest class by far
is a heading that is perfectly well formed and has no subject - "Ce contine?",
"De ce sa alegi produsul?", "Cine ne intreaba de el?", "How does our product
stand out?". Those cannot be read away from the page, and a published Q&A is
read away from the page by definition.

Fixing the garbled class perfectly takes the combined rate from 7.89% to
6.78% and Republica BIO from 7.35% to 6.27%. The bar is 1%.

## Why the "well formed" test cannot be written per product

The prompt asks for the test to be derived from the corpus headings rather
than from memory. It was. Here is what the corpus says, from
`npx tsx scripts/corpus-headings.ts --min 1`:

| Heading | Products |
|---|---|
| ce contine? | 178 |
| de ce sa alegi produsul? | 168 |
| cine ne intreaba de el? | 26 |
| de ce sa alegi colagenul de la molecules of youth (moy)? | 18 |
| how does our product stand out? | 7 |
| **ce continua?** | **3** |
| **ce continua? (with diacritics)** | **2** |
| **de ce alege produsul sau? (with diacritics)** | **2** |
| **de ce alege produsul sau?** | **1** |

Every garbled heading in the corpus is a rare near-variant of a far commoner
heading in the SAME shop. "Ce continua?" is "Ce contine?" mistyped, on 5
products out of 189, beside 178 that carry the correct one. "De ce alege
produsul sau?" is "De ce sa alegi produsul?" mistranslated, on 3 beside 168.

That is a real, mechanical, corpus-derived test - and it is a SHOP-WIDE one.
It needs the heading counts of the whole catalogue, and `app/engine/faq.ts` is
pure and sees one product at a time. Nothing in one product's text separates
"Ce continua?" from "Ce contine?": both are well formed Romanian sentences,
and only the first is not what the merchant meant.

So the honest statement is: no per-product test for "well formed in its
language" is derivable from this corpus. Fixing the class needs a heading
census built by the catalogue pass and handed to buildFaq - a real feature,
not a rule - and it would still leave the source at 6.27% on Republica BIO.

## And it could not have been measured anyway

A verdict is keyed by store, product, question text and answer text. Any fix
to a merchant question changes the question text, so every row becomes
unjudged and `scripts/facts-measure.ts` can say nothing about it. Unlike the
facts rules of item 6, a change here cannot be measured against the verdicts
on disk; it needs a fresh judge run over all 900 pairs.

## Decision

`FAQ_MERCHANT_QUESTIONS_LIVE` stays `false`. Nothing was changed in the
engine for this item. The figure to beat, when it is next attempted, is
7.89% combined and 7.35% on Republica BIO, not 2.19% and 2.41%.

Reproduce:

```
npx tsx scripts/corpus-headings.ts --min 1
```

and read `_shopify/corpus/verdicts/*.json` for `"source": "merchant"`.
