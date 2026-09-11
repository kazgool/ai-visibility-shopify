# Intent keywords and their corpus counts

Counted by `npx tsx scripts/corpus-keywords.ts` over the 29 dev stores (4166 products),
reading each description exactly as `app/engine/faq.ts` does. Products: dev products with at
least one heading containing the keyword. The hold-out stores are not read.

| Intent | Language | Keyword | Dev products | Dev stores | Most frequent heading (products) |
|---|---|---|---|---|---|
| safety | en | warning* | 18 | 1 | warnings (18) |
| safety | en | precaution* | 11 | 1 | precautions (11) |
| safety | en | safety | 3 | 1 | important safety information (3) |
| safety | ro | atentionar* | 101 | 2 | atentionari (90) |
| safety | ro | atentie | 4 | 3 | atentie (3) |
| safety | ro | alergen* | 30 | 1 | alergeni (30) |
| safety | ro | precauti* | 24 | 2 | precautii (13) |
| usage | en | use | 20 | 2 | indications of use (17) |
| usage | ro | folosest* | 182 | 2 | cum sa-l folosesti (178) |
| usage | ro | utilizare | 182 | 3 | mod de utilizare (105) |
| composition | en | ingredient* | 279 | 6 | ingrediente (101) |
| composition | ro | ce contine | 181 | 2 | ce contine (179) |
| composition | ro | ingrediente | 258 | 3 | ingrediente (101) |
| materials | en | (none: no dev heading) | 0 | 0 | - |
| materials | ro | material* | 37 | 3 | material (24) |
| storage | en | storage | 18 | 1 | storage (18) |
| storage | ro | pastrare | 160 | 2 | mod de pastrare (79) |
| care | en | (none: no dev heading) | 0 | 0 | - |
| care | ro | (none: no dev heading) | 0 | 0 | - |
| dimensions | en | (none: no dev heading) | 0 | 0 | - |
| dimensions | ro | dimensiun* | 132 | 3 | dimensiuni exterioare (86) |
| dimensions | ro | lungime* | 19 | 2 | lungime masa (11) |
| dimensions | ro | latime | 13 | 2 | latime masa (11) |
| dimensions | ro | inaltime | 20 | 2 | inaltime masa (11) |
| dimensions | ro | suprafata de dormit | 5 | 1 | suprafata de dormit (5) |
| contents | en | includes | 97 | 3 | set includes (48) |
| contents | en | included | 7 | 3 | what s included (4) |
| contents | ro | continut pachet | 72 | 1 | continut pachet (72) |
| contents | ro | continut set | 1 | 1 | continut set (1) |
| contents | ro | componenta set | 1 | 1 | componenta set (1) |
| compatibility | en | compatible | 1 | 1 | is bookarc compatible with the new 15-inch macbook air (1) |
| compatibility | en | fits | 2 | 2 | fits (1) |
| compatibility | ro | (none: no dev heading) | 0 | 0 | - |
| suitability | en | (none: no dev heading) | 0 | 0 | - |
| suitability | ro | ideal pentru | 164 | 1 | ideal pentru (164) |
| suitability | ro | potrivit pentru | 71 | 3 | potrivit pentru (68) |
| suitability | ro | cine | 27 | 2 | cine ne intreaba de el (26) |
| benefits | en | benefit* | 7 | 2 | key benefits (6) |
| benefits | en | special | 57 | 1 | why it s special (57) |
| benefits | en | stand out | 7 | 1 | how does our product stand out (7) |
| benefits | ro | benefici* | 284 | 3 | beneficii cheie (182) |
| benefits | ro | de ce sa alegi | 180 | 1 | de ce sa alegi produsul (168) |
