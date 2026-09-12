# Facts errors, classified before any rule was written

Batch 5 item 5. Every facts verdict the judge has recorded, over every run in
`_shopify/corpus/verdicts/`, de-duplicated by pair id so a store re-judged
twice is not counted twice. Classes are matched on the judge's own words;
the vocabulary was read off the corpus first, not written from memory.

Reproduce:

```
npx tsx scripts/facts-error-classes.ts
npx tsx scripts/facts-error-classes.ts --set holdout
npx tsx scripts/facts-error-classes.ts --store republicabio.ro
npx tsx scripts/facts-error-classes.ts --show torn-fragment
```

## Every set, every store


Values judged: 10309. Errors: 4091 (39.7% (4091/10309)).

| Class | Errors | Share of errors | Share of all values judged |
|---|---|---|---|
| Several items' values merged into one | 309 | 7.6% (309/4091) | 3.0% (309/10309) |
| A negation read as an affirmation | 73 | 1.8% (73/4091) | 0.7% (73/10309) |
| A bound or an operator dropped | 127 | 3.1% (127/4091) | 1.2% (127/10309) |
| The unit's subject lost: a figure with nothing saying what it measures | 107 | 2.6% (107/4091) | 1.0% (107/10309) |
| A value cut before the words that carry its meaning | 944 | 23.1% (944/4091) | 9.2% (944/10309) |
| A value that is in the text, but is not what this label means | 1195 | 29.2% (1195/4091) | 11.6% (1195/10309) |
| A value taken from a neighbouring sentence about something else | 330 | 8.1% (330/4091) | 3.2% (330/10309) |
| A value the product's data does not state at all | 30 | 0.7% (30/4091) | 0.3% (30/10309) |
| Not matched by any class above | 976 | 23.9% (976/4091) | 9.5% (976/10309) |

## By dictionary group, groups with 30 or more values judged

| Group | Values judged | Errors | Error rate | Largest class |
|---|---|---|---|---|
| Compatibility | 513 | 420 | 81.9% (420/513) | A value cut before the words that carry its meaning (324) |
| Size | 794 | 393 | 49.5% (393/794) | unmatched (260) |
| Finish | 512 | 367 | 71.7% (367/512) | A value that is in the text, but is not what this label means (281) |
| Dimensions | 482 | 247 | 51.2% (247/482) | Several items' values merged into one (115) |
| Ingredients | 271 | 214 | 79.0% (214/271) | A value that is in the text, but is not what this label means (122) |
| Format | 596 | 200 | 33.6% (200/596) | A value that is in the text, but is not what this label means (107) |
| Strength | 198 | 198 | 100.0% (198/198) | A value that is in the text, but is not what this label means (158) |
| Key ingredients | 284 | 183 | 64.4% (183/284) | A value cut before the words that carry its meaning (97) |
| Battery | 184 | 157 | 85.3% (157/184) | Several items' values merged into one (105) |
| Material | 771 | 149 | 19.3% (149/771) | unmatched (91) |
| Size range | 128 | 128 | 100.0% (128/128) | A value cut before the words that carry its meaning (92) |
| Screen | 121 | 110 | 90.9% (110/121) | A bound or an operator dropped (92) |
| Forma | 168 | 105 | 62.5% (105/168) | A value taken from a neighbouring sentence about something else (51) |
| Volume | 323 | 90 | 27.9% (90/323) | Several items' values merged into one (36) |
| Colour | 547 | 83 | 15.2% (83/547) | unmatched (33) |
| Portie de referinta | 81 | 79 | 97.5% (79/81) | unmatched (47) |
| Memory | 74 | 74 | 100.0% (74/74) | A value cut before the words that carry its meaning (53) |
| Valori nutritionale | 75 | 63 | 84.0% (63/75) | A value cut before the words that carry its meaning (28) |
| Ingrediente | 147 | 57 | 38.8% (57/147) | A value cut before the words that carry its meaning (44) |
| Gramaj | 136 | 56 | 41.2% (56/136) | unmatched (46) |
| Cantitate pachet | 96 | 52 | 54.2% (52/96) | unmatched (26) |
| Concentratie | 71 | 50 | 70.4% (50/71) | unmatched (18) |
| Ambalaj | 183 | 48 | 26.2% (48/183) | A value taken from a neighbouring sentence about something else (21) |
| Warranty | 65 | 45 | 69.2% (45/65) | A value cut before the words that carry its meaning (39) |
| Weight | 70 | 39 | 55.7% (39/70) | A value taken from a neighbouring sentence about something else (16) |
| Alergeni | 54 | 39 | 72.2% (39/54) | A value cut before the words that carry its meaning (38) |
| Skin type | 78 | 38 | 48.7% (38/78) | A value that is in the text, but is not what this label means (13) |
| Free from | 114 | 38 | 33.3% (38/114) | A negation read as an affirmation (27) |
| Ingredient principal | 166 | 38 | 22.9% (38/166) | A value that is in the text, but is not what this label means (18) |
| Certificari | 177 | 38 | 21.5% (38/177) | unmatched (15) |
| Origine geografica | 167 | 38 | 22.8% (38/167) | A value cut before the words that carry its meaning (17) |
| Animal | 373 | 31 | 8.3% (31/373) | unmatched (19) |
| Avertismente de eticheta | 80 | 22 | 27.5% (22/80) | unmatched (15) |
| Procesare | 48 | 20 | 41.7% (20/48) | unmatched (8) |
| Connectivity | 274 | 20 | 7.3% (20/274) | unmatched (9) |
| Gust si aroma | 51 | 19 | 37.3% (19/51) | A value cut before the words that carry its meaning (15) |
| Contine | 120 | 17 | 14.2% (17/120) | unmatched (10) |
| Style | 273 | 12 | 4.4% (12/273) | A value taken from a neighbouring sentence about something else (6) |
| Utilizare | 32 | 11 | 34.4% (11/32) | A value cut before the words that carry its meaning (5) |
| Fara | 165 | 10 | 6.1% (10/165) | unmatched (8) |
| Excipienti | 52 | 7 | 13.5% (7/52) | unmatched (7) |
| Closure | 84 | 4 | 4.8% (4/84) | A value cut before the words that carry its meaning (3) |
| Notificare | 71 | 3 | 4.2% (3/71) | A value cut before the words that carry its meaning (3) |
| Concern | 75 | 1 | 1.3% (1/75) | unmatched (1) |
| Care | 279 | 0 | 0.0% (0/279) | - |
| Nume stiintific | 91 | 0 | 0.0% (0/91) | - |
| Pastrare | 164 | 0 | 0.0% (0/164) | - |
| Testare | 107 | 0 | 0.0% (0/107) | - |
| Sleeve | 34 | 0 | 0.0% (0/34) | - |
| Camera | 39 | 0 | 0.0% (0/39) | - |

## Hold-out only


Values judged: 3954. Errors: 1936 (49.0% (1936/3954)).

| Class | Errors | Share of errors | Share of all values judged |
|---|---|---|---|
| Several items' values merged into one | 154 | 8.0% (154/1936) | 3.9% (154/3954) |
| A negation read as an affirmation | 5 | 0.3% (5/1936) | 0.1% (5/3954) |
| A bound or an operator dropped | 120 | 6.2% (120/1936) | 3.0% (120/3954) |
| The unit's subject lost: a figure with nothing saying what it measures | 5 | 0.3% (5/1936) | 0.1% (5/3954) |
| A value cut before the words that carry its meaning | 496 | 25.6% (496/1936) | 12.5% (496/3954) |
| A value that is in the text, but is not what this label means | 502 | 25.9% (502/1936) | 12.7% (502/3954) |
| A value taken from a neighbouring sentence about something else | 138 | 7.1% (138/1936) | 3.5% (138/3954) |
| A value the product's data does not state at all | 18 | 0.9% (18/1936) | 0.5% (18/3954) |
| Not matched by any class above | 498 | 25.7% (498/1936) | 12.6% (498/3954) |

## By dictionary group, groups with 30 or more values judged

| Group | Values judged | Errors | Error rate | Largest class |
|---|---|---|---|---|
| Compatibility | 468 | 393 | 84.0% (393/468) | A value cut before the words that carry its meaning (309) |
| Size | 734 | 367 | 50.0% (367/734) | unmatched (256) |
| Finish | 330 | 303 | 91.8% (303/330) | A value that is in the text, but is not what this label means (237) |
| Battery | 160 | 157 | 98.1% (157/160) | Several items' values merged into one (105) |
| Screen | 119 | 108 | 90.8% (108/119) | A bound or an operator dropped (92) |
| Volume | 302 | 90 | 29.8% (90/302) | Several items' values merged into one (36) |
| Format | 225 | 88 | 39.1% (88/225) | unmatched (56) |
| Memory | 74 | 74 | 100.0% (74/74) | A value cut before the words that carry its meaning (53) |
| Ingredients | 90 | 65 | 72.2% (65/90) | A value that is in the text, but is not what this label means (41) |
| Material | 285 | 52 | 18.2% (52/285) | unmatched (43) |
| Warranty | 65 | 45 | 69.2% (45/65) | A value cut before the words that carry its meaning (39) |
| Colour | 368 | 40 | 10.9% (40/368) | unmatched (20) |
| Weight | 48 | 36 | 75.0% (36/48) | A value taken from a neighbouring sentence about something else (16) |
| Size range | 34 | 34 | 100.0% (34/34) | A value taken from a neighbouring sentence about something else (33) |
| Key ingredients | 46 | 29 | 63.0% (29/46) | A value that is in the text, but is not what this label means (16) |
| Skin type | 44 | 20 | 45.5% (20/44) | A value the product's data does not state at all (9) |
| Connectivity | 255 | 16 | 6.3% (16/255) | A value taken from a neighbouring sentence about something else (7) |
| Animal | 132 | 10 | 7.6% (10/132) | unmatched (9) |
| Concern | 42 | 0 | 0.0% (0/42) | - |
| Camera | 39 | 0 | 0.0% (0/39) | - |

## Republica BIO only


Values judged: 2564. Errors: 795 (31.0% (795/2564)).

| Class | Errors | Share of errors | Share of all values judged |
|---|---|---|---|
| Several items' values merged into one | 10 | 1.3% (10/795) | 0.4% (10/2564) |
| A negation read as an affirmation | 27 | 3.4% (27/795) | 1.1% (27/2564) |
| A bound or an operator dropped | 2 | 0.3% (2/795) | 0.1% (2/2564) |
| The unit's subject lost: a figure with nothing saying what it measures | 17 | 2.1% (17/795) | 0.7% (17/2564) |
| A value cut before the words that carry its meaning | 200 | 25.2% (200/795) | 7.8% (200/2564) |
| A value that is in the text, but is not what this label means | 161 | 20.3% (161/795) | 6.3% (161/2564) |
| A value taken from a neighbouring sentence about something else | 107 | 13.5% (107/795) | 4.2% (107/2564) |
| A value the product's data does not state at all | 6 | 0.8% (6/795) | 0.2% (6/2564) |
| Not matched by any class above | 265 | 33.3% (265/795) | 10.3% (265/2564) |

## By dictionary group, groups with 30 or more values judged

| Group | Values judged | Errors | Error rate | Largest class |
|---|---|---|---|---|
| Forma | 168 | 105 | 62.5% (105/168) | A value taken from a neighbouring sentence about something else (51) |
| Portie de referinta | 81 | 79 | 97.5% (79/81) | unmatched (47) |
| Valori nutritionale | 75 | 63 | 84.0% (63/75) | A value cut before the words that carry its meaning (28) |
| Ingrediente | 147 | 57 | 38.8% (57/147) | A value cut before the words that carry its meaning (44) |
| Gramaj | 136 | 56 | 41.2% (56/136) | unmatched (46) |
| Cantitate pachet | 96 | 52 | 54.2% (52/96) | unmatched (26) |
| Concentratie | 71 | 50 | 70.4% (50/71) | unmatched (18) |
| Ambalaj | 183 | 48 | 26.2% (48/183) | A value taken from a neighbouring sentence about something else (21) |
| Alergeni | 54 | 39 | 72.2% (39/54) | A value cut before the words that carry its meaning (38) |
| Ingredient principal | 166 | 38 | 22.9% (38/166) | A value that is in the text, but is not what this label means (18) |
| Certificari | 177 | 38 | 21.5% (38/177) | unmatched (15) |
| Origine geografica | 167 | 38 | 22.8% (38/167) | A value cut before the words that carry its meaning (17) |
| Avertismente de eticheta | 80 | 22 | 27.5% (22/80) | unmatched (15) |
| Procesare | 48 | 20 | 41.7% (20/48) | unmatched (8) |
| Gust si aroma | 51 | 19 | 37.3% (19/51) | A value cut before the words that carry its meaning (15) |
| Contine | 120 | 17 | 14.2% (17/120) | unmatched (10) |
| Utilizare | 32 | 11 | 34.4% (11/32) | A value cut before the words that carry its meaning (5) |
| Fara | 165 | 10 | 6.1% (10/165) | unmatched (8) |
| Excipienti | 52 | 7 | 13.5% (7/52) | unmatched (7) |
| Notificare | 71 | 3 | 4.2% (3/71) | A value cut before the words that carry its meaning (3) |
| Nume stiintific | 91 | 0 | 0.0% (0/91) | - |
| Pastrare | 164 | 0 | 0.0% (0/164) | - |
| Testare | 107 | 0 | 0.0% (0/107) | - |
