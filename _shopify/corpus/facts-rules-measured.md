# The six mechanical rules, measured

Batch 5 item 6. Five of the six are enabled; rule 3 is implemented, tested and
switched off because it contradicts WordPress fixture C - see
app/engine/measurements.ts, and the batch 5 handover.

Baseline run `base5` is the engine as it stood at commit 7e52aa4, and joins
the existing verdicts exactly (0 values unjudged), which is what makes the
comparison sound. A value the engine still emits keeps the verdict it already
has; a value it no longer emits is counted as dropped, with its old verdict; a
value that is new is reported as unjudged and is NOT counted as correct.

Reproduce:

```
npx tsx scripts/faq-corpus-run.ts after6 --set all
npx tsx scripts/facts-measure.ts after6 --against base5
npx tsx scripts/facts-measure.ts after6 --set holdout --against base5
npx tsx scripts/facts-measure.ts after6 --store republicabio.ro --against base5
```

## Every set, every store


Products: 5998. Values emitted: 9812 (1.64 per product).
Of them judged: 9295. Errors: 3327 (35.8% (3327/9295)).
Emitted but never judged: 517 (5.3% (517/9812)). These are NOT counted as correct.

## Against base5

Values before: 10309. After: 9812. Dropped: 1014 (9.8% (1014/10309)).
Of the dropped: 764 were judged errors, 250 were judged correct, 0 had never been judged.
Correct values lost per error removed: 0.33

## By dictionary group, 30 or more values judged

| Group | Emitted | Judged | Errors | Error rate | Unjudged | Bar (1%) |
|---|---|---|---|---|---|---|
| Memory | 74 | 74 | 74 | 100.0% (74/74) | 0 | NOT met |
| Size range | 128 | 128 | 128 | 100.0% (128/128) | 0 | NOT met |
| Strength | 176 | 173 | 173 | 100.0% (173/173) | 3 | NOT met |
| Portie de referinta | 81 | 81 | 79 | 97.5% (79/81) | 0 | NOT met |
| Battery | 184 | 147 | 134 | 91.2% (134/147) | 37 | NOT met |
| Screen | 121 | 121 | 110 | 90.9% (110/121) | 0 | NOT met |
| Valori nutritionale | 74 | 64 | 52 | 81.3% (52/64) | 10 | NOT met |
| Finish | 512 | 512 | 367 | 71.7% (367/512) | 0 | NOT met |
| Compatibility | 486 | 261 | 180 | 69.0% (180/261) | 225 | NOT met |
| Concentratie | 71 | 67 | 46 | 68.7% (46/67) | 4 | NOT met |
| Weight | 56 | 53 | 35 | 66.0% (35/53) | 3 | NOT met |
| Ingredients | 176 | 143 | 94 | 65.7% (94/143) | 33 | NOT met |
| Forma | 168 | 168 | 105 | 62.5% (105/168) | 0 | NOT met |
| Key ingredients | 239 | 192 | 116 | 60.4% (116/192) | 47 | NOT met |
| Cantitate pachet | 96 | 91 | 50 | 54.9% (50/91) | 5 | NOT met |
| Size | 684 | 672 | 355 | 52.8% (355/672) | 12 | NOT met |
| Skin type | 78 | 78 | 38 | 48.7% (38/78) | 0 | NOT met |
| Procesare | 48 | 48 | 20 | 41.7% (20/48) | 0 | NOT met |
| Gramaj | 136 | 136 | 56 | 41.2% (56/136) | 0 | NOT met |
| Warranty | 56 | 33 | 13 | 39.4% (13/33) | 23 | NOT met |
| Dimensions | 350 | 350 | 136 | 38.9% (136/350) | 0 | NOT met |
| Gust si aroma | 51 | 51 | 19 | 37.3% (19/51) | 0 | NOT met |
| Utilizare | 32 | 32 | 11 | 34.4% (11/32) | 0 | NOT met |
| Format | 596 | 596 | 200 | 33.6% (200/596) | 0 | NOT met |
| Free from | 114 | 114 | 38 | 33.3% (38/114) | 0 | NOT met |
| Ingrediente | 136 | 88 | 27 | 30.7% (27/88) | 48 | NOT met |
| Avertismente de eticheta | 80 | 80 | 22 | 27.5% (22/80) | 0 | NOT met |
| Ambalaj | 183 | 183 | 48 | 26.2% (48/183) | 0 | NOT met |
| Volume | 297 | 276 | 65 | 23.6% (65/276) | 21 | NOT met |
| Ingredient principal | 166 | 166 | 38 | 22.9% (38/166) | 0 | NOT met |
| Origine geografica | 163 | 158 | 35 | 22.2% (35/158) | 5 | NOT met |
| Certificari | 177 | 177 | 38 | 21.5% (38/177) | 0 | NOT met |
| Material | 771 | 771 | 149 | 19.3% (149/771) | 0 | NOT met |
| Colour | 547 | 547 | 83 | 15.2% (83/547) | 0 | NOT met |
| Contine | 120 | 120 | 17 | 14.2% (17/120) | 0 | NOT met |
| Excipienti | 52 | 52 | 7 | 13.5% (7/52) | 0 | NOT met |
| Animal | 373 | 373 | 31 | 8.3% (31/373) | 0 | NOT met |
| Connectivity | 274 | 274 | 20 | 7.3% (20/274) | 0 | NOT met |
| Fara | 165 | 165 | 10 | 6.1% (10/165) | 0 | NOT met |
| Closure | 84 | 84 | 4 | 4.8% (4/84) | 0 | NOT met |
| Style | 273 | 273 | 12 | 4.4% (12/273) | 0 | NOT met |
| Notificare | 71 | 71 | 3 | 4.2% (3/71) | 0 | NOT met |
| Concern | 75 | 75 | 1 | 1.3% (1/75) | 0 | NOT met |
| Camera | 39 | 39 | 0 | 0.0% (0/39) | 0 | met |
| Care | 279 | 279 | 0 | 0.0% (0/279) | 0 | met |
| Sleeve | 34 | 34 | 0 | 0.0% (0/34) | 0 | met |
| Nume stiintific | 91 | 91 | 0 | 0.0% (0/91) | 0 | met |
| Pastrare | 164 | 164 | 0 | 0.0% (0/164) | 0 | met |
| Testare | 107 | 107 | 0 | 0.0% (0/107) | 0 | met |

20 groups have fewer than 30 values judged and nothing is promised about them: Life stage (0/21), Diet (2/22), Origin (4/4), Form (2/16), Room (0/2), Power (0/13), Durability (0/12), Occasion (0/9), Pattern (1/22), Fit (4/15), Season (1/1), Features (0/1), Active ingredient (8/11), Suited to (18/18), Certification (3/4), Servings (9/14), Alergeni (13/28), Recoltare (3/14), Origine ingredient (7/23), Valabilitate (13/13)

## --set dev


Products: 4166. Values emitted: 7698 (1.85 per product).
Of them judged: 7377. Errors: 2514 (34.1% (2514/7377)).
Emitted but never judged: 321 (4.2% (321/7698)). These are NOT counted as correct.

## Against base5

Values before: 8132. After: 7698. Dropped: 755 (9.3% (755/8132)).
Of the dropped: 530 were judged errors, 225 were judged correct, 0 had never been judged.
Correct values lost per error removed: 0.42

## By dictionary group, 30 or more values judged

| Group | Emitted | Judged | Errors | Error rate | Unjudged | Bar (1%) |
|---|---|---|---|---|---|---|
| Memory | 74 | 74 | 74 | 100.0% (74/74) | 0 | NOT met |
| Size range | 94 | 94 | 94 | 100.0% (94/94) | 0 | NOT met |
| Strength | 176 | 173 | 173 | 100.0% (173/173) | 3 | NOT met |
| Portie de referinta | 81 | 81 | 79 | 97.5% (79/81) | 0 | NOT met |
| Battery | 175 | 138 | 126 | 91.3% (126/138) | 37 | NOT met |
| Screen | 121 | 121 | 110 | 90.9% (110/121) | 0 | NOT met |
| Valori nutritionale | 74 | 64 | 52 | 81.3% (52/64) | 10 | NOT met |
| Concentratie | 71 | 67 | 46 | 68.7% (46/67) | 4 | NOT met |
| Weight | 56 | 53 | 35 | 66.0% (35/53) | 3 | NOT met |
| Key ingredients | 203 | 166 | 105 | 63.3% (105/166) | 37 | NOT met |
| Forma | 168 | 168 | 105 | 62.5% (105/168) | 0 | NOT met |
| Ingredients | 155 | 127 | 78 | 61.4% (78/127) | 28 | NOT met |
| Size | 215 | 204 | 116 | 56.9% (116/204) | 11 | NOT met |
| Skin type | 39 | 39 | 22 | 56.4% (22/39) | 0 | NOT met |
| Cantitate pachet | 96 | 91 | 50 | 54.9% (50/91) | 5 | NOT met |
| Finish | 257 | 257 | 132 | 51.4% (132/257) | 0 | NOT met |
| Compatibility | 226 | 161 | 82 | 50.9% (82/161) | 65 | NOT met |
| Procesare | 48 | 48 | 20 | 41.7% (20/48) | 0 | NOT met |
| Gramaj | 136 | 136 | 56 | 41.2% (56/136) | 0 | NOT met |
| Dimensions | 350 | 350 | 136 | 38.9% (136/350) | 0 | NOT met |
| Warranty | 55 | 32 | 12 | 37.5% (12/32) | 23 | NOT met |
| Gust si aroma | 51 | 51 | 19 | 37.3% (19/51) | 0 | NOT met |
| Utilizare | 32 | 32 | 11 | 34.4% (11/32) | 0 | NOT met |
| Format | 452 | 452 | 149 | 33.0% (149/452) | 0 | NOT met |
| Free from | 110 | 110 | 34 | 30.9% (34/110) | 0 | NOT met |
| Ingrediente | 136 | 88 | 27 | 30.7% (27/88) | 48 | NOT met |
| Avertismente de eticheta | 80 | 80 | 22 | 27.5% (22/80) | 0 | NOT met |
| Ambalaj | 183 | 183 | 48 | 26.2% (48/183) | 0 | NOT met |
| Ingredient principal | 166 | 166 | 38 | 22.9% (38/166) | 0 | NOT met |
| Material | 509 | 509 | 114 | 22.4% (114/509) | 0 | NOT met |
| Origine geografica | 163 | 158 | 35 | 22.2% (35/158) | 5 | NOT met |
| Colour | 350 | 350 | 77 | 22.0% (77/350) | 0 | NOT met |
| Certificari | 177 | 177 | 38 | 21.5% (38/177) | 0 | NOT met |
| Volume | 98 | 97 | 19 | 19.6% (19/97) | 1 | NOT met |
| Contine | 120 | 120 | 17 | 14.2% (17/120) | 0 | NOT met |
| Excipienti | 52 | 52 | 7 | 13.5% (7/52) | 0 | NOT met |
| Animal | 295 | 295 | 22 | 7.5% (22/295) | 0 | NOT met |
| Connectivity | 271 | 271 | 20 | 7.4% (20/271) | 0 | NOT met |
| Fara | 165 | 165 | 10 | 6.1% (10/165) | 0 | NOT met |
| Style | 273 | 273 | 12 | 4.4% (12/273) | 0 | NOT met |
| Notificare | 71 | 71 | 3 | 4.2% (3/71) | 0 | NOT met |
| Concern | 33 | 33 | 1 | 3.0% (1/33) | 0 | NOT met |
| Camera | 39 | 39 | 0 | 0.0% (0/39) | 0 | met |
| Closure | 62 | 62 | 0 | 0.0% (0/62) | 0 | met |
| Care | 279 | 279 | 0 | 0.0% (0/279) | 0 | met |
| Nume stiintific | 91 | 91 | 0 | 0.0% (0/91) | 0 | met |
| Pastrare | 164 | 164 | 0 | 0.0% (0/164) | 0 | met |
| Testare | 107 | 107 | 0 | 0.0% (0/107) | 0 | met |

19 groups have fewer than 30 values judged and nothing is promised about them: Life stage (0/21), Diet (2/22), Origin (4/4), Form (2/16), Room (0/2), Durability (0/12), Pattern (1/17), Fit (4/8), Season (1/1), Features (0/1), Active ingredient (8/11), Suited to (18/18), Certification (3/4), Servings (9/14), Alergeni (13/28), Recoltare (3/14), Origine ingredient (7/23), Valabilitate (13/13), Sleeve (0/29)

## --set holdout


Products: 1832. Values emitted: 2114 (1.15 per product).
Of them judged: 1918. Errors: 813 (42.4% (813/1918)).
Emitted but never judged: 196 (9.3% (196/2114)). These are NOT counted as correct.

## Against base5

Values before: 2177. After: 2114. Dropped: 259 (11.9% (259/2177)).
Of the dropped: 234 were judged errors, 25 were judged correct, 0 had never been judged.
Correct values lost per error removed: 0.11

## By dictionary group, 30 or more values judged

| Group | Emitted | Judged | Errors | Error rate | Unjudged | Bar (1%) |
|---|---|---|---|---|---|---|
| Size range | 34 | 34 | 34 | 100.0% (34/34) | 0 | NOT met |
| Compatibility | 260 | 100 | 98 | 98.0% (98/100) | 160 | NOT met |
| Finish | 255 | 255 | 235 | 92.2% (235/255) | 0 | NOT met |
| Size | 469 | 468 | 239 | 51.1% (239/468) | 1 | NOT met |
| Skin type | 39 | 39 | 16 | 41.0% (16/39) | 0 | NOT met |
| Format | 144 | 144 | 51 | 35.4% (51/144) | 0 | NOT met |
| Volume | 199 | 179 | 46 | 25.7% (46/179) | 20 | NOT met |
| Material | 262 | 262 | 35 | 13.4% (35/262) | 0 | NOT met |
| Animal | 78 | 78 | 9 | 11.5% (9/78) | 0 | NOT met |
| Colour | 197 | 197 | 6 | 3.0% (6/197) | 0 | NOT met |
| Concern | 42 | 42 | 0 | 0.0% (0/42) | 0 | met |

12 groups have fewer than 30 values judged and nothing is promised about them: Key ingredients (11/26), Free from (4/4), Ingredients (16/16), Power (0/13), Occasion (0/9), Fit (0/7), Closure (4/22), Sleeve (0/5), Pattern (0/5), Battery (8/9), Connectivity (0/3), Warranty (1/1)

## --store republicabio.ro


Products: 189. Values emitted: 2548 (13.48 per product).
Of them judged: 2438. Errors: 719 (29.5% (719/2438)).
Emitted but never judged: 110 (4.3% (110/2548)). These are NOT counted as correct.

## Against base5

Values before: 2564. After: 2548. Dropped: 126 (4.9% (126/2564)).
Of the dropped: 76 were judged errors, 50 were judged correct, 0 had never been judged.
Correct values lost per error removed: 0.66

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

