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
