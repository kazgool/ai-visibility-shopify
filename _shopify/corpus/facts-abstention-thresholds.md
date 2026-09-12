# The abstention threshold, measured at every mechanical setting

Batch 5 item 7, and the table Marius asked for on 12 September 2026: for each
setting, the error rate per group and the values per product on Republica BIO.
**Nothing here is applied.** The app runs at setting 0 - the mechanical rules
of item 6 and nothing more - until he picks one.

## The settings

| Setting | What it abstains on |
|---|---|
| 0 | The mechanical rules of item 6 only. What is committed and running. |
| 1 | Also: a prefix capture truncated at a connector. A truncation is the engine guessing where the value ended. |
| 2 | Also: a prefix capture whose value still opens with a connector lead ("with x", "for y"), because it reads as prose. |
| 3 | Also: no prefix capture at all. Only the merchant's own plain terms, counts and measurements. |

Setting 3 is the strictest purely mechanical setting that exists. There is no
setting 4 without deciding whether a whole, correctly delimited value belongs
under its label, which is not a mechanical question.

## Headline

| Setting | Hold-out errors | Republica BIO errors | RB values per product |
|---|---|---|---|
| baseline (before item 6) | 49.0% (1067/2177) | 31.0% (795/2564) | 13.57 |
| 0 | 42.4% (813/1918) | 29.5% (719/2438) | 13.48 |
| 1 | 40.9% (753/1839) | 28.8% (658/2285) | 13.17 |
| 2 | 39.2% (700/1786) | 28.8% (657/2284) | 13.16 |
| 3 | 38.8% (688/1772) | 30.1% (598/1990) | 11.12 |

Read that last row twice. At the strictest mechanical setting Republica BIO's
error rate goes UP, from 29.5% to 30.1%, while it loses 2.36 values per
product. Setting 3 drops 377 values a judge called correct to remove 197 it
called wrong - 1.91 correct lost per error removed. It makes the store worse
on both counts at once.

The bar is 1% per group. The best mechanical setting is 38.8% on the hold-out.
**The bar is not met at any setting, and no mechanical setting reaches it.**

## Re-measured after batch 6 items 1 and 2, and unchanged

Batch 6 asked for this table to be reprinted after the two rule defects were
fixed, because three of the decisions it feeds read numbers those fixes could
move. The whole sweep was re-run on the corrected engine
(`batch6`, `b6abstain1`, `b6abstain2`, `b6abstain3`) and **every figure in the
headline table above is identical, to the value.** Not close - the same
numerators and the same denominators at all four settings, on the hold-out and
on Republica BIO alike.

That is the expected result once both fixes are measured rather than assumed:

- Item 1 changed 4 values in the whole corpus (2 Size on animax.ro, 2 Strength
  on moleculesofyouth.com), none of them on Republica BIO and none in the
  hold-out.
- Item 2 changed 0 values, because no capture in 5,998 products reaches the
  rule it corrects.

So the decision is to be taken on the numbers already printed here. They did
not move, and nothing is waiting on a re-measurement any more.

```
npx tsx scripts/faq-corpus-run.ts b6abstain1 --set all --abstain 1
npx tsx scripts/facts-measure.ts b6abstain1 --set holdout --against base5
npx tsx scripts/facts-measure.ts b6abstain1 --store republicabio.ro --against base5
```

## Reproduce

```
npx tsx scripts/faq-corpus-run.ts base5 --set all
npx tsx scripts/faq-corpus-run.ts after6 --set all
npx tsx scripts/faq-corpus-run.ts abstain1 --set all --abstain 1
npx tsx scripts/faq-corpus-run.ts abstain2 --set all --abstain 2
npx tsx scripts/faq-corpus-run.ts abstain3 --set all --abstain 3
npx tsx scripts/facts-measure.ts <run> --store republicabio.ro --against base5
```

## Setting 0, Republica BIO, per group

Products: 189. Values emitted: 2548 (13.48 per product).
Of them judged: 2438. Errors: 719 (29.5% (719/2438)).
Emitted but never judged: 110 (4.3% (110/2548)). These are NOT counted as correct.

## By dictionary group, 30 or more values judged

| Group | Emitted | Judged | Errors | Error rate | Unjudged | Bar (1%) |
|---|---|---|---|---|---|---|
| Portie de referinta | 81 | 81 | 79 | 97.5% (79/81) | 0 | NOT met |
| Valori nutritionale | 74 | 64 | 52 | 81.3% (52/64) | 10 | NOT met |
| Concentratie | 71 | 67 | 46 | 68.7% (46/67) | 4 | NOT met |
| Forma | 168 | 168 | 105 | 62.5% (105/168) | 0 | NOT met |
| Cantitate pachet | 96 | 91 | 50 | 54.9% (50/91) | 5 | NOT met |
| Procesare | 48 | 48 | 20 | 41.7% (20/48) | 0 | NOT met |
| Gramaj | 136 | 136 | 56 | 41.2% (56/136) | 0 | NOT met |
| Gust si aroma | 51 | 51 | 19 | 37.3% (19/51) | 0 | NOT met |
| Utilizare | 32 | 32 | 11 | 34.4% (11/32) | 0 | NOT met |
| Ingrediente | 136 | 88 | 27 | 30.7% (27/88) | 48 | NOT met |
| Avertismente de eticheta | 80 | 80 | 22 | 27.5% (22/80) | 0 | NOT met |
| Ambalaj | 183 | 183 | 48 | 26.2% (48/183) | 0 | NOT met |
| Ingredient principal | 166 | 166 | 38 | 22.9% (38/166) | 0 | NOT met |
| Origine geografica | 163 | 158 | 35 | 22.2% (35/158) | 5 | NOT met |
| Certificari | 177 | 177 | 38 | 21.5% (38/177) | 0 | NOT met |
| Contine | 120 | 120 | 17 | 14.2% (17/120) | 0 | NOT met |
| Excipienti | 52 | 52 | 7 | 13.5% (7/52) | 0 | NOT met |
| Fara | 165 | 165 | 10 | 6.1% (10/165) | 0 | NOT met |
| Notificare | 71 | 71 | 3 | 4.2% (3/71) | 0 | NOT met |
| Nume stiintific | 91 | 91 | 0 | 0.0% (0/91) | 0 | met |
| Pastrare | 164 | 164 | 0 | 0.0% (0/164) | 0 | met |
| Testare | 107 | 107 | 0 | 0.0% (0/107) | 0 | met |

4 groups have fewer than 30 values judged and nothing is promised about them: Alergeni (13/28), Recoltare (3/14), Origine ingredient (7/23), Valabilitate (13/13)

## Setting 1, Republica BIO, per group

Products: 189. Values emitted: 2489 (13.17 per product).
Of them judged: 2285. Errors: 658 (28.8% (658/2285)).
Emitted but never judged: 204 (8.2% (204/2489)). These are NOT counted as correct.

## By dictionary group, 30 or more values judged

| Group | Emitted | Judged | Errors | Error rate | Unjudged | Bar (1%) |
|---|---|---|---|---|---|---|
| Portie de referinta | 81 | 81 | 79 | 97.5% (79/81) | 0 | NOT met |
| Valori nutritionale | 69 | 37 | 30 | 81.1% (30/37) | 32 | NOT met |
| Concentratie | 71 | 67 | 46 | 68.7% (46/67) | 4 | NOT met |
| Forma | 168 | 168 | 105 | 62.5% (105/168) | 0 | NOT met |
| Cantitate pachet | 96 | 91 | 50 | 54.9% (50/91) | 5 | NOT met |
| Procesare | 48 | 48 | 20 | 41.7% (20/48) | 0 | NOT met |
| Gramaj | 136 | 136 | 56 | 41.2% (56/136) | 0 | NOT met |
| Gust si aroma | 51 | 51 | 19 | 37.3% (19/51) | 0 | NOT met |
| Utilizare | 32 | 32 | 11 | 34.4% (11/32) | 0 | NOT met |
| Avertismente de eticheta | 80 | 80 | 22 | 27.5% (22/80) | 0 | NOT met |
| Ambalaj | 183 | 183 | 48 | 26.2% (48/183) | 0 | NOT met |
| Ingrediente | 135 | 73 | 18 | 24.7% (18/73) | 62 | NOT met |
| Ingredient principal | 166 | 166 | 38 | 22.9% (38/166) | 0 | NOT met |
| Certificari | 177 | 177 | 38 | 21.5% (38/177) | 0 | NOT met |
| Contine | 120 | 120 | 17 | 14.2% (17/120) | 0 | NOT met |
| Excipienti | 52 | 52 | 7 | 13.5% (7/52) | 0 | NOT met |
| Origine geografica | 110 | 67 | 5 | 7.5% (5/67) | 43 | NOT met |
| Fara | 165 | 165 | 10 | 6.1% (10/165) | 0 | NOT met |
| Notificare | 71 | 71 | 3 | 4.2% (3/71) | 0 | NOT met |
| Nume stiintific | 91 | 91 | 0 | 0.0% (0/91) | 0 | met |
| Pastrare | 164 | 164 | 0 | 0.0% (0/164) | 0 | met |
| Testare | 107 | 92 | 0 | 0.0% (0/92) | 15 | met |

4 groups have fewer than 30 values judged and nothing is promised about them: Alergeni (13/28), Recoltare (3/9), Origine ingredient (7/23), Valabilitate (13/13)

## Setting 2, Republica BIO, per group

Products: 189. Values emitted: 2488 (13.16 per product).
Of them judged: 2284. Errors: 657 (28.8% (657/2284)).
Emitted but never judged: 204 (8.2% (204/2488)). These are NOT counted as correct.

## By dictionary group, 30 or more values judged

| Group | Emitted | Judged | Errors | Error rate | Unjudged | Bar (1%) |
|---|---|---|---|---|---|---|
| Portie de referinta | 81 | 81 | 79 | 97.5% (79/81) | 0 | NOT met |
| Valori nutritionale | 68 | 36 | 29 | 80.6% (29/36) | 32 | NOT met |
| Concentratie | 71 | 67 | 46 | 68.7% (46/67) | 4 | NOT met |
| Forma | 168 | 168 | 105 | 62.5% (105/168) | 0 | NOT met |
| Cantitate pachet | 96 | 91 | 50 | 54.9% (50/91) | 5 | NOT met |
| Procesare | 48 | 48 | 20 | 41.7% (20/48) | 0 | NOT met |
| Gramaj | 136 | 136 | 56 | 41.2% (56/136) | 0 | NOT met |
| Gust si aroma | 51 | 51 | 19 | 37.3% (19/51) | 0 | NOT met |
| Utilizare | 32 | 32 | 11 | 34.4% (11/32) | 0 | NOT met |
| Avertismente de eticheta | 80 | 80 | 22 | 27.5% (22/80) | 0 | NOT met |
| Ambalaj | 183 | 183 | 48 | 26.2% (48/183) | 0 | NOT met |
| Ingrediente | 135 | 73 | 18 | 24.7% (18/73) | 62 | NOT met |
| Ingredient principal | 166 | 166 | 38 | 22.9% (38/166) | 0 | NOT met |
| Certificari | 177 | 177 | 38 | 21.5% (38/177) | 0 | NOT met |
| Contine | 120 | 120 | 17 | 14.2% (17/120) | 0 | NOT met |
| Excipienti | 52 | 52 | 7 | 13.5% (7/52) | 0 | NOT met |
| Origine geografica | 110 | 67 | 5 | 7.5% (5/67) | 43 | NOT met |
| Fara | 165 | 165 | 10 | 6.1% (10/165) | 0 | NOT met |
| Notificare | 71 | 71 | 3 | 4.2% (3/71) | 0 | NOT met |
| Nume stiintific | 91 | 91 | 0 | 0.0% (0/91) | 0 | met |
| Pastrare | 164 | 164 | 0 | 0.0% (0/164) | 0 | met |
| Testare | 107 | 92 | 0 | 0.0% (0/92) | 15 | met |

4 groups have fewer than 30 values judged and nothing is promised about them: Alergeni (13/28), Recoltare (3/9), Origine ingredient (7/23), Valabilitate (13/13)

## Setting 3, Republica BIO, per group

Products: 189. Values emitted: 2102 (11.12 per product).
Of them judged: 1990. Errors: 598 (30.1% (598/1990)).
Emitted but never judged: 112 (5.3% (112/2102)). These are NOT counted as correct.

## By dictionary group, 30 or more values judged

| Group | Emitted | Judged | Errors | Error rate | Unjudged | Bar (1%) |
|---|---|---|---|---|---|---|
| Portie de referinta | 81 | 81 | 79 | 97.5% (79/81) | 0 | NOT met |
| Concentratie | 69 | 65 | 44 | 67.7% (44/65) | 4 | NOT met |
| Forma | 168 | 168 | 105 | 62.5% (105/168) | 0 | NOT met |
| Cantitate pachet | 96 | 91 | 50 | 54.9% (50/91) | 5 | NOT met |
| Procesare | 48 | 48 | 20 | 41.7% (20/48) | 0 | NOT met |
| Gramaj | 136 | 136 | 56 | 41.2% (56/136) | 0 | NOT met |
| Gust si aroma | 51 | 51 | 19 | 37.3% (19/51) | 0 | NOT met |
| Utilizare | 32 | 32 | 11 | 34.4% (11/32) | 0 | NOT met |
| Avertismente de eticheta | 80 | 80 | 22 | 27.5% (22/80) | 0 | NOT met |
| Ambalaj | 183 | 183 | 48 | 26.2% (48/183) | 0 | NOT met |
| Certificari | 177 | 154 | 36 | 23.4% (36/154) | 23 | NOT met |
| Ingredient principal | 166 | 166 | 38 | 22.9% (38/166) | 0 | NOT met |
| Contine | 120 | 120 | 17 | 14.2% (17/120) | 0 | NOT met |
| Excipienti | 52 | 52 | 7 | 13.5% (7/52) | 0 | NOT met |
| Fara | 165 | 165 | 10 | 6.1% (10/165) | 0 | NOT met |
| Nume stiintific | 91 | 91 | 0 | 0.0% (0/91) | 0 | met |
| Pastrare | 164 | 164 | 0 | 0.0% (0/164) | 0 | met |
| Testare | 107 | 70 | 0 | 0.0% (0/70) | 37 | met |

4 groups have fewer than 30 values judged and nothing is promised about them: Alergeni (13/28), Recoltare (3/9), Origine ingredient (7/23), Valabilitate (13/13)

