# C - JSON-LD Product @id prevalence on live Shopify storefronts

Date run: 2026-09-10. Empirical, no code changes.

## Method

1. Found real, live Shopify product URLs two ways:
   - For most stores, fetched `https://<domain>/products.json?limit=1` (a public
     Shopify storefront endpoint that lists products with their handle) and
     built `https://<domain>/products/<handle>` from the first handle returned.
     A 200 response with a `products` array is itself confirmation the store
     runs Shopify (this endpoint only exists on Shopify).
   - Domain list was assembled from memory of well-known Shopify-hosted D2C
     brands (apparel, beauty, food/beverage, home) plus a couple of guessed
     slugs that were later corrected via the `products.json` method above.
     No paid keyword or directory tool was used; this is a convenience sample,
     not a random one (see Limits).
2. Fetched each product page with `requests` (desktop Chrome user-agent,
   `allow_redirects=True`, 25s timeout) from a Linux shell inside the
   sandboxed workspace. Script: `/tmp/audit/fetch2.py` (ad hoc, not committed
   to the repo).
3. Confirmed Shopify by checking the string `cdn.shopify.com` in the raw HTML.
   Where present, also regex-matched the `Shopify.theme = {...}` JS object for
   `name` and `theme_store_id`.
4. Extracted every `<script type="application/ld+json">...</script>` block
   with regex, JSON-parsed each, and flattened any `@graph` arrays into a flat
   node list.
5. Kept nodes whose `@type` is `Product` or `ProductGroup` (string or array
   form). For each: recorded whether `@id` is present, and if present whether
   it starts with `/` (relative), `http` (absolute), or neither (`other`,
   e.g. a bare `#fragment`).
6. Flagged "Shopify filter shape" when a Product node's own `@context` is
   exactly `http://schema.org/` (note: `http`, not `https`, with the trailing
   slash) AND its `@id` ends in `#product` AND its `offers.@id` ends in
   `#offer` - this is the fingerprint of Shopify's native
   `{{ product | structured_data }}` Liquid filter.

Commands actually run (illustrative; full domain list is longer):
```
requests via python3 /tmp/audit/fetch2.py urls.txt out.json
GET https://<domain>/products.json?limit=1   (to discover a real handle)
GET https://<domain>/products/<handle>        (the page actually analysed)
```

38 store pages were fetched in total; 30 of them emitted at least one
Product/ProductGroup JSON-LD node and form the basis for the @id question.
The other 8 returned 200, were confirmed Shopify by `cdn.shopify.com`, but
carried zero `application/ld+json` blocks in the server-rendered HTML at all
(see Limits - they are listed in the table with 0 product nodes and excluded
from the @id percentages, per the brief's own framing of "stores that emitted
a Product node").

## Table

`Domain | Theme (name, store id) | Product nodes | Has @id | Relative or absolute | Shopify filter shape`

| Domain | Theme (name, store id) | Product nodes | Has @id | Rel/Abs | Shopify filter shape |
|---|---|---|---|---|---|
| gymshark.com | Hydra 1.15.0 \| Store 1.39.0 (BF backup) | 0 | n/a | n/a | no |
| colourpop.com | [ED - Jay] Main (store id unknown) | 2 | yes | relative | yes |
| brooklinen.com | Site Ops Release: Post Labor Day Sale | 0 | n/a | n/a | no |
| gfuel.com | gfuel-theme/dev | 1 | no | n/a | no |
| deathwishcoffee.com | sept 1, 2026 | 1 | yes | absolute | no |
| taylorstitch.com | Master | 1 | yes | absolute | no |
| tentree.com | Production Candidate US - Locally | 0 | n/a | n/a | no |
| manitobah.ca | [LIVE] MB CA \| 26-09-11 FW26 | 0 | n/a | n/a | no |
| rothys.com | rothys/production | 1 | no | n/a | no |
| kyliecosmetics.com | SYNC \| SEPT 8 REFRESH \| DO NOT DELETE | 1 | no | n/a | no |
| jenis.com | BYOC Production 3.10 (August ADA) | 1 | no | n/a | no |
| skinnydiplondon.com | Skinnydip by BAO \| Release 07.09.26 | 0 | n/a | n/a | no |
| bombtechgolf.com | Copy of Rebrand (store id 868) | 1 | yes | relative | yes |
| hollandcooper.com | Friday 4th Sept \| BAO \| Coming soon fix | 0 | n/a | n/a | no |
| thesill.com | The Sill v4.0.0 - Main Website | 1 | no | n/a | no |
| beardbrand.com | Split v1.0.3.7.8 [klaviyo BIS setup] (store id 842) | 1 | no | n/a | no |
| nativecos.com | [PRD] Wonderfall + 3173 | 1 | yes | absolute | no |
| greatjonesgoods.com | 2025 BFCM THEME: Great Jones 4.2 \| Edgemesh | 1 | no | n/a | no |
| staud.clothing | PRODUCTION (store id 2698) | 1 | yes | absolute | no |
| pact.com | Concept--WPD_BDR (store id 2412) | 1 | yes | relative | no |
| meowmeowtweet.com | [LIVE] MMT - ADA RC 10/20 [accessibility] (store id 868) | 1 | no | n/a | no |
| hauslabs.com | Copy of haus-v2/MAIN 3 - 9.2.26 | 1 | no | n/a | no |
| fentybeauty.com | 9/7-9/11 20% off HV with purchase of PFFF | 1 | no | n/a | no |
| marinelayer.com | Fall 2 + September Catalog HP Flip 2026 | 1 | yes | absolute | no |
| knixteen.com | SuperPlus Launch \| 09.03.26 \| Release/1.10.0 | 2 | yes (mixed - see note) | relative | no |
| pinklily.com | Halloween Launch - 9.10 | 2 | no | n/a | no |
| dollskill.com | 9.8 HALLOWEEN LAUNCH | 1 | yes | absolute | no |
| brightland.co | brightland/steph/cozyseason/round1 | 2 | yes | relative | yes |
| graza.co | baggy - production | 2 | yes (mixed - see note) | absolute | no |
| cocokind.com | cocokind-vbt/main | 1 | no | n/a | no |
| summersalt.com | unknown (theme object not found) | 0 | n/a | n/a | no |
| truff.com | unknown (theme object not found) | 1 | no | n/a | no |
| liquiddeath.com | liquiddeath/main | 1 | yes | absolute | no |
| feals.com | 9/4/2026 - Gorgias ADA Fix | 1 | no | n/a | no |
| jackhenry.co | LIVE 4.16.26 (Top Nav Fix) - Marina (store id 910) | 1 | no | n/a | no |
| naadam.co | Release 8.31 - naadam/MAIN | 0 | n/a | n/a | no |
| outdoorvoices.com | August OV Outdoors_Kindred | 1 | no | n/a | no |
| allbirds.com | [DNAM Theme July 2026] | 1 | yes | other (bare `#slug` fragment, not a real path) | no |

Notes on "mixed" rows: `knixteen.com` and `graza.co` each emit two separate
Product JSON-LD blocks on the same page (one from the theme, one that looks
like it comes from a separate reviews/SEO app). On both stores one block
carries an `@id` and the other does not - counted as "has @id" for the
per-store roll-up below because at least one Product node on the page is
addressable, but a second, un-anchored Product node still sits on the same
page next to it.

## Counts

Of the 38 store pages fetched, 30 emitted at least one Product/ProductGroup
JSON-LD node. All percentages below are out of that N=30.

- **@id present on at least one Product node: 14 of 30 (47%).**
- **@id absent from every Product node: 16 of 30 (53%).**
- Of the 14 with an @id: 5 relative (`/products/...#product` or similar), 8
  absolute (`https://...`), 1 "other" (a bare `#fragment`, not a usable
  reference - allbirds.com).
- **Shopify's own filter shape (`http://schema.org/` + `#product` + `#offer`):
  3 of 30 (10%)** - colourpop.com, bombtechgolf.com, brightland.co. The other
  27 of 30 (90%) either have no @id or have hand-built JSON-LD that does not
  match the native filter's fingerprint, even when it happens to carry some
  @id (e.g. deathwishcoffee.com and taylorstitch.com have an absolute @id but
  wrong @context/no #offer pattern - clearly hand-written, not the Liquid
  filter output).
- Separately, of the 38 pages fetched, 8 (21%) returned 200, were confirmed
  Shopify, but had zero `application/ld+json` blocks anywhere in the
  server-rendered HTML: gymshark.com, brooklinen.com, tentree.com,
  manitobah.ca, skinnydiplondon.com, hollandcooper.com, summersalt.com,
  naadam.co. These are excluded from the @id percentages above (there is no
  Product node to have or lack an @id), but they matter for the same
  underlying problem: on these pages there is currently nothing a third-party
  app could anchor to via @id at all, because the theme is not emitting a
  Product node server-side in the first place (most likely injected
  client-side by JS on a heavily customized/headless build, though this was
  not independently confirmed by re-crawling with a JS-executing browser).

## Themes with no @id

Theme "name" strings as they actually appear in each store's live
`Shopify.theme` JS object - most are merchant-edited deploy/branch labels,
not the theme's marketplace name (see Limits):

- gfuel.com - `gfuel-theme/dev`
- rothys.com - `rothys/production`
- kyliecosmetics.com - `SYNC | SEPT 8 REFRESH | DO NOT DELETE`
- jenis.com - `BYOC Production 3.10 (August ADA)`
- thesill.com - `The Sill v4.0.0 - Main Website`
- beardbrand.com - `Split v1.0.3.7.8 [klaviyo BIS setup]` (Theme Store id 842)
- greatjonesgoods.com - `2025 BFCM THEME: Great Jones 4.2 | Edgemesh`
- meowmeowtweet.com - `[LIVE] MMT - ADA RC 10/20 [accessibility]` (Theme Store id 868)
- hauslabs.com - `Copy of haus-v2/MAIN 3 - 9.2.26`
- fentybeauty.com - `9/7-9/11 20% off HV with purchase of PFFF`
- pinklily.com - `Halloween Launch - 9.10`
- cocokind.com - `cocokind-vbt/main`
- truff.com - unknown (no `Shopify.theme` object found in HTML)
- feals.com - `9/4/2026 - Gorgias ADA Fix`
- jackhenry.co - `LIVE 4.16.26 (Top Nav Fix) - Marina` (Theme Store id 910)
- outdoorvoices.com - `August OV Outdoors_Kindred`

Most notable: **beardbrand.com and meowmeowtweet.com share Theme Store id
868, and jackhenry.co is id 910** - all three still no @id despite being
built on a Theme Store base rather than a bespoke build, which suggests the
missing @id is coming from theme customization/apps layered on top rather
than the base theme itself (their sibling on the same base theme id 868,
bombtechgolf.com, *does* have a relative @id and the full Shopify filter
shape, so the same base theme produces both outcomes depending on how the
merchant/dev set up the product template).

## Limits

- **This is a convenience sample of 38 pages, not a random or representative
  sample of the roughly 4-5 million live Shopify stores.** It skews toward
  well-known, high-traffic D2C brands (the kind of store visible from memory
  and from public brand recognition), which are disproportionately likely to
  run heavily customized or fully custom themes rather than an unmodified
  Theme Store theme. A theme fresh from the Shopify Theme Store, unmodified,
  would very likely show the native `{{ product | structured_data }}` output
  (i.e. carry an @id) far more often than this sample shows - this sample is
  closer to "what large, well-funded brands with dev teams ship" than to
  "what an average small merchant on an off-the-shelf theme ships."
  - No dedicated Theme Store demo-store previews were reached; several were
    tried by guessing but time did not permit chasing down the current
    preview-URL scheme for free/paid Theme Store demos, so the sample
    contains zero theme-vendor demo stores, which the brief specifically
    flagged as ideal.
  - No small/long-tail merchant stores are in the sample; every domain is a
    recognizable brand.
- **The "theme name" field is merchant-editable free text**, used here mostly
  as a deploy-branch label ("Copy of Rebrand", "9.8 HALLOWEEN LAUNCH",
  "sept 1, 2026"). It is not a reliable proxy for "which Theme Store theme
  this store runs" in most rows - only the numeric `theme_store_id`, when
  present, reliably ties a store to a marketplace theme, and most of this
  sample's stores (23 of 30 with a Product node) had no `theme_store_id` at
  all, meaning a fully custom or heavily forked/renamed theme with no current
  link back to a marketplace listing.
- **Pages were fetched once, unauthenticated, with a plain HTTP GET** (no
  headless browser, no JS execution). Any JSON-LD injected by client-side
  JavaScript after page load would not appear in this data. This is the most
  likely explanation for the 8 stores with zero JSON-LD blocks found at all
  (gymshark.com, brooklinen.com, tentree.com, manitobah.ca,
  skinnydiplondon.com, hollandcooper.com, summersalt.com, naadam.co) - it was
  not independently re-verified with a JS-executing fetch, so it is reported
  as "no JSON-LD found server-side," not "no JSON-LD exists."
- One store (allbirds.com) was first sampled on a degenerate "product" that
  turned out to be a returns-protection add-on with a null name and a literal
  `"@id": "#"` placeholder - not representative of a real catalog product -
  and was re-sampled on an actual shoe listing for the table above.
- "Shopify filter shape" is a heuristic fingerprint (exact `@context` string
  plus `#product`/`#offer` suffixes), not a guarantee. A theme could in
  principle hand-write JSON-LD that happens to match all three markers
  without using the real Liquid filter; this was not separately ruled out per
  store.
