# Intent keywords and their corpus counts

Counted by `npx tsx scripts/corpus-keywords.ts` over the 23 dev stores (3014 products),
reading each description exactly as `app/engine/faq.ts` does. Products: dev products with at
least one heading containing the keyword. The hold-out stores are not read.

| Intent | Language | Keyword | Dev products | Dev stores | Most frequent heading (products) |
|---|---|---|---|---|---|
| safety | en | warning* | 18 | 1 | warnings (18) |
| safety | en | precaution* | 11 | 1 | precautions (11) |
| safety | en | safety | 3 | 1 | important safety information (3) |
| safety | ro | atentionar* | 98 | 1 | atentionari (89) |
| usage | en | use | 18 | 2 | indications of use (17) |
| usage | ro | folosest* | 179 | 1 | cum sa-l folosesti (178) |
| usage | ro | utilizare | 94 | 1 | mod de utilizare (93) |
| usage | ro | doza | 32 | 1 | doza zilnica recomandata (20) |
| composition | en | ingredient* | 191 | 3 | ingrediente (96) |
| composition | en | nutrition* | 142 | 2 | valori nutritionale per 100g (71) |
| composition | en | content | 57 | 1 | caffeine content (57) |
| composition | ro | ce contine | 181 | 2 | ce contine (179) |
| composition | ro | ingrediente | 171 | 1 | ingrediente (96) |
| composition | ro | valori nutritionale | 93 | 1 | valori nutritionale per 100g (71) |
| composition | ro | declaratie nutritionala | 31 | 1 | declaratie nutritionala per 100g (18) |
| materials | en | (none: no dev heading) | 0 | 0 | - |
| materials | ro | material* | 38 | 2 | material (23) |
| materials | ro | finisaj | 28 | 1 | finisaj (28) |
| storage | en | storage | 18 | 1 | storage (18) |
| storage | ro | pastrare | 81 | 1 | conditii de pastrare (65) |
| care | en | (none: no dev heading) | 0 | 0 | - |
| care | ro | (none: no dev heading) | 0 | 0 | - |
| dimensions | en | (none: no dev heading) | 0 | 0 | - |
| dimensions | ro | dimensiun* | 139 | 2 | dimensiuni exterioare (86) |
| dimensions | ro | lungime* | 19 | 2 | lungime masa (11) |
| dimensions | ro | latime | 13 | 2 | latime masa (11) |
| dimensions | ro | inaltime | 20 | 2 | inaltime masa (11) |
| dimensions | ro | suprafata de dormit | 5 | 1 | suprafata de dormit (5) |
| contents | en | includes | 62 | 2 | set includes (48) |
| contents | en | included | 3 | 2 | shades included (2) |
| contents | ro | continut pachet | 72 | 1 | continut pachet (72) |
| contents | ro | continut set | 1 | 1 | continut set (1) |
| contents | ro | componenta set | 1 | 1 | componenta set (1) |
| compatibility | en | compatible | 1 | 1 | is bookarc compatible with the new 15-inch macbook air (1) |
| compatibility | en | fits | 1 | 1 | fits (1) |
| compatibility | ro | (none: no dev heading) | 0 | 0 | - |
| suitability | en | (none: no dev heading) | 0 | 0 | - |
| suitability | ro | ideal pentru | 164 | 1 | ideal pentru (164) |
| suitability | ro | potrivit pentru | 4 | 2 | este potrivit pentru exterior (2) |
| benefits | en | benefit* | 6 | 1 | key benefits (6) |
| benefits | en | special | 57 | 1 | why it s special (57) |
| benefits | en | love | 13 | 2 | why you your pup will love it (1) |
| benefits | en | stand out | 7 | 1 | how does our product stand out (7) |
| benefits | ro | benefici* | 182 | 1 | beneficii cheie (182) |
| benefits | ro | de ce sa alegi | 180 | 1 | de ce sa alegi produsul (168) |
| benefits | ro | caracteristic* | 11 | 3 | dimensiuni exacte si caracteristici tehnice (6) |
