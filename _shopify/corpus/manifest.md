# FAQ corpus manifest

Built 11 September 2026 for CC-PROMPT-AI-READABILITY-3 item 1, before any
rule of `app/engine/faq.ts` was written. The store data itself is gitignored
(`/_shopify/corpus/*`); only this manifest, the rubric and the reports are
committed.

## How it was read

- `npx tsx scripts/corpus-fetch.ts <domain> ... --out _shopify/corpus/stores`
- Only the public `/products.json?limit=250` endpoint: one page, so at most 250
  products per store and never more than one catalogue request per store.
- `robots.txt` read first; a store whose "*" group disallows the path is
  skipped (comenzi.bebetei.ro was, and is not in the corpus).
- One request per second across a run; a named user agent with a contact URL.
- Read only. Nothing was sent to any store but the GET requests.
- Profile below from `npx tsx scripts/corpus-report.ts _shopify/corpus/stores`.
  "Heading or bold start": an `<h2>` to `<h6>`, or `<strong>`/`<b>` opening a
  `<p>`, `<div>` or `<li>`. "Line ending in ?": any text line of the
  description whose last character is "?". Denominator: products with a
  non-empty description.

## Split

Written here before any rule. The hold-out stores were chosen from the
profile counts below only; not one of their product texts has been opened.
Rule 5 of the brief applies: if a hold-out product is opened to fix a rule,
that store moves to dev and a reserve store of the same language replaces it.

### Dev set (tune on it): 16 stores

| Store | Vertical | Language | Products | With description | Heading or bold start | Line ending in ? |
|---|---|---|---|---|---|---|
| republicabio.ro (catalogue 1) | food and supplements | ro | 189 | 189 | 100% (189/189) | 97% (184/189) |
| globalmobila fixture CSV (catalogue 2) | furniture | ro | 355 | 353 | 7% (23/353) | 0% (0/353) |
| secom.ro | food and supplements | ro | 250 | 244 | 0% (0/244) | 0% (1/244) |
| mobexpert.ro | furniture | ro | 250 | 250 | 0% (0/250) | 0% (0/250) |
| rusticart.ro | furniture and home | ro | 123 | 123 | 100% (123/123) | 3% (4/123) |
| aquaframe.ro | home (frames, prints) | ro | 122 | 84 | 4% (3/84) | 0% (0/84) |
| deathwishcoffee.com | food | en | 147 | 147 | 100% (147/147) | 5% (8/147) |
| greatjonesgoods.com | home (cookware) | en | 64 | 64 | 88% (56/64) | 0% (0/64) |
| colourpop.com | cosmetics | en | 250 | 250 | 10% (24/250) | 0% (0/250) |
| beardbrand.com | cosmetics (grooming) | en | 74 | 74 | 34% (25/74) | 0% (0/74) |
| taylorstitch.com | fashion | en | 250 | 250 | 0% (0/250) | 0% (0/250) |
| marialuciahohan.com | fashion | en | 250 | 249 | 0% (0/249) | 0% (0/249) |
| zeedog.com | pets | en | 250 | 250 | 1% (2/250) | 0% (0/250) |
| fablepets.com | pets and toys | en | 67 | 65 | 23% (15/65) | 0% (0/65) |
| twelvesouth.com | electronics | en | 45 | 45 | 38% (17/45) | 4% (2/45) |
| shokz.com | electronics | en | 59 | 38 | 5% (2/38) | 13% (5/38) |
| brightland.co | food (olive oil, vinegar) | en | 43 | 42 | 12% (5/42) | 0% (0/42) |
| feals.com | supplements | en | 7 | 7 | 0% (0/7) | 0% (0/7) |
| graza.co | food (olive oil) | en | 80 | 44 | 32% (14/44) | 0% (0/44) |
| meowmeowtweet.com | cosmetics | en | 55 | 55 | 0% (0/55) | 0% (0/55) |
| moleculesofyouth.com | supplements | en | 18 | 18 | 100% (18/18) | 39% (7/18) |
| toskovat.com | cosmetics | en | 26 | 25 | 16% (4/25) | 28% (7/25) |
| truff.com | food (sauces) | en | 40 | 39 | 3% (1/39) | 0% (0/39) |

The last seven were reserves and moved to dev on the same day, still before
any rule was written: the first sixteen dev stores held almost no English
usage, care or safety headings to derive keyword lists from. Dev is now 23
stores; the hold-out is unchanged.

### Hold-out set (never opened while writing rules): 6 stores

| Store | Vertical | Language | Products | With description | Heading or bold start | Line ending in ? |
|---|---|---|---|---|---|---|
| animax.ro | pets | ro | 250 | 250 | 72% (181/250) | 1% (3/250) |
| istyle.ro | electronics | ro | 250 | 248 | 2% (5/248) | 0% (0/248) |
| thesill.com | home (plants) | en | 250 | 249 | 58% (145/249) | 0% (1/249) |
| jlab.com | electronics | en | 250 | 180 | 100% (180/180) | 0% (0/180) |
| cocokind.com | cosmetics | en | 80 | 80 | 24% (19/80) | 0% (0/80) |
| wildone.com | pets | en | 57 | 57 | 16% (9/57) | 0% (0/57) |

Hold-out: 2 Romanian, 4 English, 4 verticals (pets, electronics, home,
cosmetics), from almost no structure (istyle.ro) to full structure (jlab.com).

### Second split, 11 September 2026, after hold-out run holdout2

Run holdout2 (engine of commit 6603cc7, frozen before the run) missed the
bar: 105 errors in 1,087, 9.66%. The errors of animax.ro (2.56%), istyle.ro
(24.90%) and jlab.com (32.93%) were read to fix rules, so under rule 5 those
three stores moved to dev. The errors of thesill.com, cocokind.com and
wildone.com were not read; they stay in the hold-out.

Replacements, same language, chosen from `corpus-report.ts` counts and
product-type counts only (no description opened):

| Store | Replaces | Vertical | Language | Products | With description | Heading or bold start | Line ending in ? |
|---|---|---|---|---|---|---|---|
| terraissa.com | animax.ro | cosmetics | ro | 95 | 87 | 100% (87/87) | 1% (1/87) |
| e-ring.ro | istyle.ro | jewellery | ro | 250 | 250 | 10% (26/250) | 0% (0/250) |
| peakdesign.com (reserve) | jlab.com | electronics and gear | en | 241 | - | - | - |

A count-only run (holdout3, no verdict read) showed e-ring.ro at 39 Q&A and
peakdesign.com at 0, which would leave the bar on two stores. Three more
unopened stores were added the same day, again from counts only:

| Store | Vertical | Language | Products | With description | Heading or bold start | Line ending in ? |
|---|---|---|---|---|---|---|
| jolar.ro | fashion (leather goods) | ro | 58 | 58 | 100% (58/58) | 0% (0/58) |
| iarmaroc.com | designer marketplace | ro | 250 | 242 | 0% (0/242) | 1% (2/242) |
| vintageradar.com | fashion (watches) | en | 250 | 248 | 99% (246/248) | 0% (0/248) |

Where they came from: a search for Romanian brands on Shopify (e-ring.ro, a
Shopify case study; jolar.ro and terraissa.com, whose blog URLs have
Shopify's shape; iarmaroc.com, a Romanian designers' marketplace) and Store
Leads' Romania page (vintageradar.com). Each was read the same way as the
first corpus (robots.txt first, one `/products.json?limit=250` request).

Hold-out now: terraissa.com, e-ring.ro, jolar.ro, iarmaroc.com (ro);
thesill.com, cocokind.com, wildone.com, peakdesign.com, vintageradar.com
(en). Dev: the 23 stores above plus animax.ro, istyle.ro and jlab.com.

Q&A the engine produces on them (holdout3, counts only, before any verdict):
terraissa.com 378, thesill.com 283, iarmaroc.com 275, jolar.ro 58 (the four
the bar applies to, 994 Q&A); e-ring.ro 39, wildone.com 31, cocokind.com 10,
peakdesign.com 0, vintageradar.com 0 (their vendor is the shop itself and
their headings name no intent). Total 1,074.

### Third split, 11 September 2026, after hold-out run holdout3

Run holdout3 (engine of commit f92548f) missed the bar: 26 errors in 1,079,
2.41%; terraissa.com 5.53% (21/380), thesill.com 1.06% (3/284), iarmaroc.com
0% (0/275), jolar.ro 0% (0/58). The errors of terraissa.com, thesill.com and
wildone.com (6.06%, 2/33) were read to fix rules; all three moved to dev.
The errors of iarmaroc.com, jolar.ro, e-ring.ro, cocokind.com,
peakdesign.com and vintageradar.com were not read (they had none, or none
was listed); they stay.

Replacements, chosen from counts only (no description opened):

| Store | Replaces | Vertical | Language | Products | With description | Heading or bold start | Line ending in ? |
|---|---|---|---|---|---|---|---|
| herbaris.ro | terraissa.com | cosmetics and household | ro | 198 | 198 | 75% (148/198) | 7% (13/198) |
| miledy.ro | (added) | cosmetics | ro | 121 | 121 | 93% (113/121) | 1% (1/121) |
| gunner.com (reserve) | thesill.com | pets | en | 134 | 133 | 0% (0/133) | 0% (0/133) |
| outdoorvoices.com (reserve) | wildone.com | fashion | en | 250 | 250 | 0% (0/250) | 0% (0/250) |

Where they came from: a search for Romanian natural-cosmetics shops, each
checked for a Shopify `/products.json` (biospot.ro, crisnatur.ro,
sabiocosmetics.ro, laterre.ro and narjecosmetics.ro returned 404; herbaris.ro
and miledy.ro answered). gunner.com and outdoorvoices.com are the last two
English reserves.

Q&A the engine produces on the hold-out now (holdout4, counts only, before
any verdict): outdoorvoices.com 302, iarmaroc.com 275, herbaris.ro 264,
miledy.ro 202, gunner.com 84, jolar.ro 58 (the six the bar applies to: four
Romanian, two English); e-ring.ro 39, cocokind.com 10, peakdesign.com 0,
vintageradar.com 0. Dev is now 29 stores: the 23 above plus animax.ro,
istyle.ro, jlab.com, terraissa.com, thesill.com and wildone.com.

### Counts against the brief

- Further stores beyond the two catalogues: 20 (at least 12 required).
- Of them Romanian: 6 (secom.ro, mobexpert.ro, rusticart.ro, aquaframe.ro,
  animax.ro, istyle.ro; at least 4 required). English: 14 (at least 6).
- Verticals: food or supplements (republicabio.ro, secom.ro,
  deathwishcoffee.com); cosmetics (colourpop.com, beardbrand.com,
  cocokind.com); fashion (taylorstitch.com, marialuciahohan.com); furniture
  or home (globalmobila, mobexpert.ro, rusticart.ro, aquaframe.ro,
  greatjonesgoods.com, thesill.com); electronics or tools (twelvesouth.com,
  shokz.com, istyle.ro, jlab.com); pets or toys (zeedog.com, fablepets.com,
  animax.ro, wildone.com). Six of six.
- Language column: set by reading each dev store's descriptions and, for
  hold-out stores, from the word count only (`corpus-report.ts`, Romanian and
  English function words and Romanian diacritics). marialuciahohan.com is a
  Bucharest store that writes in English; it is counted as English. The
  globalmobila fixture's descriptions are Romanian (8,902 Romanian words to 82
  English); the earlier audits ran it with `--lang en`, this corpus runs it in
  Romanian, the language it is written in.

## Reserves (in `_shopify/corpus/reserve/`, not part of either set)

Read the same way, kept to replace a hold-out store that moves to dev:
brightland.co, feals.com (7 products), graza.co, gunner.com, meowmeowtweet.com,
moleculesofyouth.com (18), outdoorvoices.com, peakdesign.com, toskovat.com (26),
truff.com. English only: every Romanian Shopify store found by search is in
the corpus already, so a Romanian hold-out store that moves to dev needs a new
search. Not usable: marinelayer.com (250 products, no descriptions),
bran-castle.com (1 product).

## Where the stores came from

- `_shopify/audit-logs-2026-09-10/C-jsonld-prevalence.md`: deathwishcoffee.com,
  colourpop.com, cocokind.com, beardbrand.com, taylorstitch.com,
  greatjonesgoods.com, thesill.com (and the reserves brightland.co, graza.co,
  truff.com, feals.com, meowmeowtweet.com, outdoorvoices.com, marinelayer.com).
- Search, Store Leads' public Romania and Bucharest pages: mobexpert.ro,
  marialuciahohan.com, secom.ro, istyle.ro (and toskovat.com, bran-castle.com).
- Search, Shopify Romania's blog on Romanian stores: aquaframe.ro, rusticart.ro.
- Search, Romanian pet shops, each checked for a Shopify `/products.json`:
  animax.ro (petmax.ro, zoopoint.ro, petromania.ro, megapet.ro returned 404).
- Search, Shopify pet and electronics store lists: zeedog.com, fablepets.com,
  wildone.com, twelvesouth.com, shokz.com, jlab.com (and gunner.com,
  peakdesign.com; nomadgoods.com returned HTML, not JSON).
- Republica BIO: its products.json read of 11 September 2026, the same file
  the earlier engine audits used.
