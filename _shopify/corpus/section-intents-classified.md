# Section intents: why the source stays off

Batch 5 item 9. Judged verdicts read from `_shopify/corpus/verdicts/*.json`
for `"source": "section"`, de-duplicated by pair id.

## The number

4,088 section Q&A judged, 273 errors, **6.68%**.

The bar for this item is 1% per store with at least 50 Q&A, and on the
hold-out total. Per store, stores with 50 or more:

| Store | Judged | Errors | Rate | Bar |
|---|---|---|---|---|
| deathwishcoffee.com | 57 | 25 | 43.86% | NOT met |
| jlab.com | 64 | 27 | 42.19% | NOT met |
| herbaris.ro | 244 | 29 | 11.89% | NOT met |
| rusticart.ro | 410 | 40 | 9.76% | NOT met |
| miledy.ro | 191 | 18 | 9.42% | NOT met |
| colourpop.com | 75 | 7 | 9.33% | NOT met |
| globalmobila-fixture.csv | 139 | 7 | 5.04% | NOT met |
| republicabio.ro | 1663 | 82 | 4.93% | NOT met |
| animax.ro | 232 | 8 | 3.45% | NOT met |
| terraissa.com | 724 | 23 | 3.18% | NOT met |
| greatjonesgoods.com | 57 | 1 | 1.75% | NOT met |
| moleculesofyouth.com | 83 | 1 | 1.20% | NOT met |
| e-ring.ro | 52 | 0 | 0.00% | met |

One store of thirteen meets it. By intent, the worst are composition 18.50%
(79/427), contents 10.70% (35/327), safety 8.78% (51/581), dimensions 7.11%
(36/506); the best is storage 0.58% (2/345).

## The two classes the prompt names

> "Two error classes are known from the hold-out: a dropped `<` or `>` before
> a number, which turns an upper bound into a stated value, and a safety
> heading answered with text from an unrelated section."

Measured against all 273 errors:

| Class | Errors | Share of 273 | Share of 4,088 judged |
|---|---|---|---|
| a bound or operator dropped before a number | 4 | 1.5% | 0.10% |
| a safety heading answered with text from an unrelated section | **0** | **0.0%** | **0.00%** |
| the answer is cut so it no longer answers | 60 | 22.0% | 1.47% |
| a multi-item pack answered with one item's data | 48 | 17.6% | 1.17% |
| the section's text does not answer its own heading | 1 | 0.4% | 0.02% |
| unmatched | 160 | 58.6% | 3.91% |

The second class does not exist in this corpus. Not one of the 273 reasons
describes a safety heading answered from an unrelated section. The 51 safety
errors are cut answers and multi-item packs - the same two classes that
dominate everywhere else. The example the prompt has in mind may be real, but
it is not in the judged set, and writing a rule for it would be writing a rule
from memory, which the standing rules for this batch forbid.

The first class is real and it is four rows, all one store and one product
family. Read exactly:

- description: `5–15% surfactanți neionici, <5% surfactanți amfoterici, <5% săpun, <5% agenți chelatori`
- published answer: `5% surfactanți neionici, <5% agenți chelatori.`

The `<` signs that survive prove the bound is not being stripped: the outline
carries `<5%` through correctly (verified directly), and `cleanOutput` turns
`5–15%` into `5-15%` and leaves `<5%` alone (verified directly). What is lost
is `-15` from the range and two of the four list items, in the section
answer's unit assembly. That is a real defect and it is recorded here rather
than fixed, because it is 4 of 273 and the source it affects is off.

## Decision

`FAQ_SECTION_INTENTS_LIVE` stays `false`. Fixing both named classes perfectly
takes 6.68% to 6.58%. The bar is 1%.

Reproduce: read `_shopify/corpus/verdicts/*.json` for `"source": "section"`.
