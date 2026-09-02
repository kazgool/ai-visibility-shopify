# Module audit: the engine, what it publishes, and the pipeline that carries it

2 September 2026. This is about the module itself, not the admin screens
(those are in AUDIT-2026-09-02.md). It answers four questions: what works,
what to cut, what would work with a specific change, and what to add.

## How this was produced

Two independent readers, one on the engine and the published outputs
(`app/engine/*`, the three Liquid blocks, mirror, llms.txt, the meta writer),
one on the pipeline (worker, queue, webhooks, catalogue fetch, proxy, theme
scan, crawler check, IndexNow, billing, retention). Then I ran the real
engine, unmodified, against two real catalogues:

- Republica BIO, all 189 products fetched today from `republicabio.ro`,
  with the 26-family dictionary built for them yesterday;
- the dev store's furniture catalogue, 355 products, with the built-in
  default dictionary.

For each product the run produced facts, summary, buyer questions,
fit_for, alt text, meta title, meta description and the citation verdict,
plus the term-gap list over the whole catalogue. That run is the part of
this audit no code reader could have written, and it changed the verdict.

Every claim below has a file and line, or a product name and the exact
input that produced the output. Spot-checked against source: the negation
gap, the abbreviation gap, the decimal comma, the invented `@id`, the
whole-document `state` write, the alt-text 8-digit rule, the per-call
token fetch. All held.

Not done: nothing was executed against Shopify; no Rich Results Test was
run on a live page; real themes were not inspected for their Product
`@id`; GraphQL cost points are not logged anywhere so no real figure exists.

## The verdict

The extraction core is sound where the description states a fact plainly,
and the never-overwrite promise is kept in code. On the furniture catalogue
it was tuned for, it does what it says.

On the first paying client it does three things that would end the
engagement if the client saw them, and none of them is visible from the
admin, because the numbers there say "189 of 189 readable" and they are
true:

1. It publishes `contine gluten` on 21 products whose description says
   `nu contine gluten`. The engine has no notion of negation. On a
   supplements shop that is not a bug, it is a false allergen claim.
2. It mangles the regulatory notification number, the single most
   differentiating fact in that catalogue, on 39 of 71 products:
   `S.N.P.M.A.P.S. 1378/2023` becomes `notificat de s`.
3. It publishes wrong quantities wherever a number carries a Romanian
   decimal comma or a dot thousands separator: `29,7 g` becomes `7 g`,
   `40,5 g` becomes `5 g`, `7.000mg` becomes `0 mg`.

And the two generated fields that were meant to be the visible value, the
summary and the buyer questions, are hard-wired to furniture labels in
English. For Republica BIO every product gets exactly one question, "How
much does X cost?", in English, with the answer "212.31 RON.".

The pipeline is honest but expensive and has two races that can lose the
app its own provenance record. None of that is visible either.

---

## 1. What is genuinely good and must be protected

- The never-overwrite core. `mayWrite` treats any value it cannot account
  for as human (`facts.server.ts:101-110`); the withdrawal branch only
  retracts auto values (`:178-192`); `classifyMetaField` prefers the live
  value over a stale marker (`seo.server.ts:84`). Five lines that are the
  product's promise.
- The `unchanged` check, in four writers: `facts.server.ts:200`,
  `:283` (variants), `alt-text.server.ts:90`, `seo.server.ts:173`. This is
  what stops the self-feed loop. Load-bearing in every one of them.
- `prev` captured on first SEO write only (`seo.server.ts:186`), so revert
  means "as it was before this app".
- Appearance qualifiers (`extract.ts:98-106`): "faux leather", "aspect de
  marmura", "oak-look" are rejected. Real false facts, correctly refused,
  with tests (`units.test.ts:176-252`).
- Case-preserving measurements (`normalize.ts:96-105`,
  `measurements.ts:25`): `L 130` and `l 80` stay distinct. A real Romanian
  copy bug, fixed and tested.
- `cleanOutput` at every publication boundary (`normalize.ts:47-56`).
- Empty means publish nothing, everywhere: `comparison-table.liquid:21`,
  `llms-txt.server.ts:97`, `alt-text.ts:109`, `preferred-source.liquid:26`,
  `answer.ts:55`.
- The mirror's `Link: rel="canonical"` header pointing at the primary
  domain (`proxy.$.tsx:169-171`). This is what keeps the mirror from being
  duplicate content, and it works without the app embed.
- Variant contradiction withdrawal (`variants.ts:81-90`): a product-level
  claim true for one variant in five is withdrawn rather than published.
- Bulk export as the only catalogue read path, filtered to
  `status:active AND published_status:published`
  (`catalogue.server.ts:39`). Drafts never reach the public mirror.
- `markGoneIfSessionless` (`tasks.ts:231-248`) unregisters a shop only on
  "No offline session", never on a 429 or a network error.
- Zero JavaScript in all three storefront blocks. Read, not assumed.
- Refusal as a status distinct from failure (`"refused"`, `tasks.ts:628`).

---

## 2. What the real run found: the engine on Republica BIO

189 of 189 products produced facts; median 14, maximum 23, 2,587 values.
26 families. The extraction is broad. It is also wrong in specific,
repeatable ways.

### 2.1 Negation is invisible, and it inverts allergen claims

Real output, five of twenty-one cases:

| product | description says | engine published |
|---|---|---|
| Performance Elite | "nu contine gluten, lactoza sau organisme..." | `Alergeni: contine gluten` and `Fara: fara gluten` |
| SKIN GLOW | "nu contine gluten sau organisme modificate" | `Alergeni: contine gluten` |
| HEALTHY HAIR | "nu contine gluten sau organisme modificate" | `Alergeni: contine gluten` and `Fara: fara gluten` |
| Discovery Pack Colagen | "nu contine gluten sau organisme modificate" | `Alergeni: nu contine alergeni, contine gluten` |
| Discovery Pack Latte | "produsul nu contine gluten, lactoza, soia" | `Alergeni: contine gluten` and `Fara: fara gluten` |

Cause: `extract.ts:153-170` matches the term `contine gluten` as a whole
word with no look-behind for `nu`, `fara`, `no`, `without`, `free of`.
There is no negation handling anywhere in the engine (grep for `nu `,
`not `, `negat` in `extract.ts` finds only comments). The dictionary term
was mine, so the dictionary shares the blame, but a merchant's own
dictionary will contain "contains X" terms too, and the engine must not
publish them under a negation.

Severity: blocking. This is published into `additionalProperty`, the
mirror, llms.txt and the FAQ. On a supplements shop it is a false
allergen claim with the merchant's name on it.

Fix: a negation window. If the 3 tokens before a match contain a negator
(`nu`, `fara`, `no`, `not`, `without`, `free`, `sans`, `ohne`, `sin`), the
match is dropped for plain terms and prefix terms. Add a `negators` line
to the dictionary format so a merchant can extend the list in their
language. Test with the five products above.

### 2.2 Abbreviations with dots break prefix capture

`notificat de S.N.P.M.A.P.S. 1378/2023` produces `Notificare: notificat de s`
on 39 products, and `notificat de m` (from `M.S.`) on 9. The prefix capture
at `extract.ts:56-88` takes one to three words after the base; `prepareText`
turns dots into token boundaries, so the first word is `s`, and
`isUsablePhrase` accepts a single letter.

For Republica BIO this is the fact that proves the product is legally
notified in Romania. It is the thing they would show a customer.

Fix: before tokenising, collapse dotted abbreviations (`[A-Z]\.` runs of
two or more) into one token; and reject single-character captures in
`isUsablePhrase` (`phrase.ts:66`). Then `notificat de s.n.p.m.a.p.s. 1378/2023`
captures as intended.

### 2.3 Numbers with Romanian separators are cut

`counts.ts:7` matches `\b(\d+)\s+unit`, so:

| input | published |
|---|---|
| `60 capsule (29,7 g)` | `Gramaj: 7 g` |
| `90 tablete, 40,5 g` | `Gramaj: 5 g` |
| `7.000mg tip I` | `Concentratie: 0 mg` |
| `5.000mg` | `Concentratie: 0 mg` |

The `#size` rule in `measurements.ts` does handle `1,5 l`. The count rule
does not, and it is the rule every `* unit` dictionary line uses. Wrong
weights and wrong doses are published on a supplements shop.

Fix: `(\d+(?:[.,]\d+)?)` in `counts.ts:7`, and normalise the published
value's separator to the merchant's locale.

### 2.4 Package count, dosage and serving are the same pattern

`* capsule` catches `60 capsule` (package) and `2 capsule` (dose) in the
same product; both are published under `Cantitate pachet`. `* g` catches
the package weight and the per-serving weight. The engine has no way to
say "the number after `contine` is per serving, the number after `capsule (`
is the package". Real output: `Cantitate pachet: 60 capsule, 2 capsule` on
24 products; `Gramaj: 390 g, 7 g, 100 g, 05 g` on one.

This is a dictionary format limit, not a bug: there is no way to anchor a
numeric pattern to a preceding label. See section 5.

### 2.5 Over-capture past the value

`produs in Franta per portie` (9 products): the prefix capture takes three
words and there is no stop at a preposition or a second label. `Origine
geografica` is also where `origine animala`, `origine bovina`, `origine
marina` landed, because `origine *` was a prefix in that family; the engine
cannot tell geography from biology and neither could my dictionary.

### 2.6 Buyer questions and summary are furniture-only and English-only

`summary.ts:136-200`: the question templates are keyed to
`material`, `dimensions`, `seats`, `includes`, `capacity`, `room`, `price`,
`delivery`. A custom dictionary with other labels produces nothing except
the price question. Real output for every Republica BIO product:

    Q: How much does MACA FORTE COMPLETE PROTOCOL, pachet promotional,
       cura completa pentru 3 luni, BIO, VEGAN cost?
    A: 212.31 RON.

One question, in English, on a Romanian store, with a decimal point. The
FAQ block, the thing described in every listing as a headline feature,
is empty for the first paying client.

The summary (`summary.ts:96-134`) is the first 30 or so words of the
description, then `Key details: forma: capsule, pulbere; cantitate pachet:
60 capsule, 2 capsule; ...`, then `Priced at 212.31 RON from Republica BIO.`
English connectives around Romanian values, and it carries every wrong
value from 2.3 and 2.4 into `schema:description`.

Fix: questions must be generated from the dictionary's own labels, with
one generic template per label type (plain, count, measurement) in the
shop's language, and a merchant-editable question text per family in the
dictionary itself. The summary needs the same: no English scaffolding
around a Romanian catalogue. This is the largest single piece of work in
this document and it is the one that makes the FAQ block real outside
furniture.

### 2.7 Term-gap lists the merchant's own section headings

Top of the list for Republica BIO: `cum`, `cheie`, `produsul`, `beneficii
cheie`, `sa alegi`, `cum sa-l folosesti`, `ideal pentru`, `la temperatura
camerei`. These are the headings of their description template, present
in 176 to 185 of 189 products. On the furniture catalogue: `cm`,
`dimensiuni`, `setul`, `set de`, `perfect`, `orice`, `acest`.

Cause: `term-gap.ts:48-55` has a minimum word length of 2, no numeric or
unit filter, and no notion of a term being boilerplate. A term present in
more than, say, 60 percent of products is template, not gap.

Fix: drop tokens starting with a digit, drop a unit list, raise the
minimum length to 3, and exclude any term whose document frequency exceeds
a threshold. Also exclude the dictionary's own family labels.

### 2.8 Meta title cuts mid-phrase

`MACA FORTE COMPLETE PROTOCOL, pachet promotional, cura` and `Blood Sugar
Balance, pachet promotional (Scortisoara Ceylon` are what `buildMetaTitle`
(`meta.ts:77`) produces at the 60-character target. It stops at a word
boundary but not at a phrase boundary, so titles end in a dangling word or
an open bracket.

Fix: prefer cutting at the last comma, dash or bracket before the limit;
fall back to the word boundary only if that leaves fewer than 30
characters.

### 2.9 The citation verdict is meaningless on long titles

`m34 PRO Colagen hidrolizat bovin premium, dovedit clinic, articulatii,
7.000mg tip I, II si III, aroma capsuni si lime, 30 portii, 390 g,
Molecules of Youth, natural` scores `good`. It is 160 characters of
keywords. `citation.ts:99` scores overlap between question words and title
words, and a title that contains everything overlaps everything. The
reader also found the opposite failure: interrogatives (`what`, `how`,
`many`) are not stopwords, so a short, good title cannot reach `good`.

Fix: score against fact values, not question words; penalise titles over
a length; or drop the verdict and keep only the descriptive-handle check,
which is the part with a real signal.

### 2.10 The furniture baseline with the default dictionary

355 products, default dictionary: median 2 facts, 16 products with none,
five labels only (Dimensions 306, Style 160, Material 118, Colour 90,
Room 2). The default dictionary is English (`gold`, `black`, `MDF`,
`modern`), the catalogue is Romanian, so most of what it finds is
dimensions. `Style: modern` on 116 products is the word "modern" appearing
anywhere. `74cm` and `74 cm` are published as two different values.

The dashboard on the dev store shows "Coverage 100%" because that shop has
a tuned dictionary in Settings. A merchant who installs and presses
Preview without touching the dictionary sees the default. For a Romanian
merchant that is a thin first impression; for the App Store it is fine
only in English-language trades the presets cover.

---

## 3. What the readers found in the engine and outputs

Worst first. Findings the real run already covered are not repeated.

### 3.1 Extend mode invents the Product `@id` [blocking, pending one check]

`ai-visibility.liquid:245` emits `"@id": shop.url + product.url + '#product'`.
The comment says it references the theme's node by id; nothing reads the
theme's Product id. `theme-scan.server.ts:680, 692` persist only
`organizationId`. On any theme whose Product node has no `@id`, or a
different one, the block emits a second Product node with `description`,
`audience` and `additionalProperty` and no `name` or `offers`. Rich
Results reads that as a Product missing required fields.

This is the one finding whose severity depends on a fact not in the repo:
what Dawn and the top themes actually emit. Check one live page source
before deciding. If they emit no `@id`, the fallback must be full mode or
nothing.

### 3.2 Alt text overwrites a human description that contains an 8-digit number [blocking]

`alt-text.ts:78`: `if (/\d{8,}/.test(token)) return true;` and
`alt-text.server.ts:66` treats that as permission to overwrite. A merchant
who typed `Masa extensibila, cod 20260527, stejar natural` gets it
replaced. This is the one promise the product is sold on.

Fix: require two junk signals, or never overwrite non-empty alt text and
only report it.

### 3.3 Two shipped presets discard the number [needs-fix]

`dictionary.ts:104` `Memory: RAM *, storage *, GB, TB, ...` and `:108`
`Warranty: warranty *, years, months`. `GB`, `TB`, `years`, `months` are
plain terms, so `256 GB, 2 years warranty` publishes `Memory: GB, TB` and
`Warranty: years, months`. Change to `* GB`, `* years`, as the retail
preset already does at `:163`.

### 3.4 `IP*` in the industrial preset can never match [needs-fix]

`dictionary.ts:350`. Parsed as a prefix with base `IP`, which requires
whitespace after it. `IP65` never matches. The preset advertises a
capability the format does not have. Either add a suffix pattern or remove
the entry.

### 3.5 fit_for turns activities into `audienceType` [needs-fix]

`summary.ts:263` falls back to `use` and `occasion`; published at
`ai-visibility.liquid:250`. Footwear preset `Use: running, hiking` becomes
`audienceType: "running, hiking"`; supplements `Suited to: pregnancy`
becomes `audienceType: "pregnancy"`. Rooms were a deliberate decision;
verbs were not. Keep `room`, move `use` and `occasion` to
`additionalProperty`, or drop the `audience` node.

### 3.6 The same term in two dictionary groups publishes a claim never made [needs-fix]

`dictionary.ts:54` and `:61` both list `oak`, `walnut`, `natural`.
"solid oak dining table" publishes `Material: oak` and `Colour: oak`.

### 3.7 Plurals and inflections are invisible [needs-fix]

`extract.ts:154` requires `(?![\p{L}\p{N}])` after the term, so `velvet`
does not match `velvets`, `capsula` does not match `capsule` unless both
are listed. Romanian inflects everything. The dictionary carries both
forms today by hand (`testat`, `testata`, `testate`); the engine should
accept a trailing inflection of up to two letters for plain terms, with a
test that `tul` still does not match `tulpina`.

### 3.8 `maxValues = 4` drops the fifth value silently [improve]

`extract.ts:116, :189`. Fixture C's own dimensions produce five named
values; the fifth is gone with no record. And `dropSubsumed` (`:46-54`)
is a raw substring test, so `6 scaune` is dropped when `16 scaune` exists.
Surface "N more not published" in the editor; require a word boundary in
subsumption.

### 3.9 Zero-fact summary publishes a tautology [improve]

`summary.ts:106-107`: with no description and no facts, the summary is
`Widget X is a product.`, written to the `summary` metafield and emitted
as `schema:description`. Return empty; the writer already withdraws
empties.

### 3.10 Price is in the stored capsule but excluded from meta by policy [improve]

`summary.ts:117-123, :189-196` versus `meta.ts:6-8` ("a stale price is
worse than none"). The FAQ answers "How much does X cost? 1899 RON" until
the next extraction, even after a price change. Apply one policy.

### 3.11 The mirror breaks on a pipe in a value [improve]

`mirror.server.ts:104` builds `| k | v |` and `cleanOutput` does not
escape `|`. Replace with `/`.

### 3.12 The comparison table does not escape values [improve]

`comparison-table.liquid:70` and four siblings use `{{ cell }}` without
`| escape`. A value `< 5 kg` renders as a broken tag.

### 3.13 `looksLikeIdentifier` rejects real part numbers [improve]

`phrase.ts:54`: hyphens are stripped before the 16-character alphanumeric
test, so `1K0-615-301-AA-2024` becomes a 16-character string and is
dropped, in exactly the automotive trade the preset targets. Do not strip
hyphens before that test.

---

## 4. What the readers found in the published structured data

| node | issue | line | severity |
|---|---|---|---|
| Product extend | invented `@id`, second node on mismatch | `liquid:245` | blocking, see 3.1 |
| Offer `shippingDetails` | `transitTimeLabel` is not a `ShippingDeliveryTime` property; no `shippingRate`, no destination, so validators ignore the node | `liquid:218-221` | needs-fix: use `transitTime` as `QuantitativeValue` with `minValue`, `maxValue`, `unitCode DAY`, or cut the node |
| Product `gtin` | populated from Shopify `barcode`, which merchants fill with internal codes | `liquid:175` | needs-fix: emit `gtin` only for 8, 12, 13 or 14 digits, else `mpn` |
| FAQPage | emitted in `<head>` with no visible FAQ on the page; Google's guideline requires marked-up content to be visible, independent of FAQ rich results having been retired in May 2026 | `liquid:283-297`, target `head` at `:420` | needs-fix: ship a visible questions block and emit FAQPage only when it is placed, or keep questions in mirror and llms.txt only |
| `audience.audienceType` | activities as audience | `liquid:250` | needs-fix, see 3.5 |
| `priceValidUntil`, `WebSite`, `BreadcrumbList` | gated behind the operator-only `seo_unlocked` flag, so off for every self-serve merchant | `liquid:40`, `:127`, `:203`, `:214`, `:300` | decide: `priceValidUntil` is conventional and Google recommends it; breadcrumbs are safe. Turn them on for everyone or delete the branches |
| CollectionPage `additionalProperty` | every entry named "How to choose" | `liquid:368` | improve: an `ItemList` carries the same content with real names |
| `hasMerchantReturnPolicy` | correct pair, but Google also wants `applicableCountry` and `returnMethod` | `liquid:224-228` | improve |
| Organization, `additionalProperty`, `aggregateRating`, `Offer` | correct | | protect |

The mirror and llms.txt: structure is fine, canonical is right. llms.txt
has a scale problem, in section 6.

---

## 5. What would work with a change to the dictionary format

The format today: plain term, prefix `term *`, count `* unit`, measurement
`#size`. What the real run shows it cannot express, in order of how often
it hurt:

1. **Negators.** A `negators:` line per dictionary. Without it, section
   2.1.
2. **Label-anchored numbers.** `proteine: * g` meaning "the number and
   unit that follow the word proteine". Today `proteine *` grabs
   `proteine vegetale` and `proteine ajuta`, and `* g` grabs every gram in
   the text. This one pattern fixes nutrition values, dosage versus
   package, and per-serving versus total, because it binds the number to
   its label. It is the single most valuable addition to the format.
3. **Decimal and thousands separators** in count patterns, section 2.3.
4. **Dotted abbreviations**, section 2.2.
5. **Inflections**, section 3.7.
6. **A stop list per prefix.** `produs in *` should stop at `per`, `cu`,
   `si`, `,`. Today it takes three words regardless.
7. **Suffix patterns** (`IP*`), section 3.4, or remove the preset line.
8. **Question text per family.** `Notificare: notificat de * | Q: Este
   notificat in Romania?` so the FAQ block is generated from the
   merchant's own labels in their language. Section 2.6.

Each of these is a change to `extract.ts`, `counts.ts`, `phrase.ts` and
the dictionary parser, with a fixture. None touches Shopify. The three
WordPress fixtures stay green because they do not use any of these
patterns; the port contract is not affected.

---

## 6. What the readers found in the pipeline

Worst first.

### 6.1 Two writers race on one `state` document [blocking]

`facts.server.ts:218` and `seo.server.ts:209-217` each read the whole
`state` JSON, mutate their own keys, and write the whole document back.
An `extract_product` and a `seo_apply` on one product in the same minute
lose the earlier writer's entries. A non-empty field with no state entry
is then treated as human for ever (`facts.server.ts:106-108`), so the app
locks itself out of a field it wrote, and `revertSeo` loses its `prev`.

Also: batched `metafieldsSet` in slices of 24 (`facts.server.ts:230-237`)
can put a product's values in one slice and its `state` in the next; if
the second call fails, the value exists with no provenance.

Fix: one metafield key per provenance entry, or read `state` immediately
before each product's mutation and put value and state in the same call.

### 6.2 Theme scan trusts any response body and has no timeout [blocking]

`theme-scan.server.ts:341`: `fetch` with `redirect: "follow"`, then
`res.text()`. No `res.ok`, no `AbortController`. A Cloudflare challenge or
a 503 is parsed as the theme: zero nodes, no password field, recorded as a
real scan. `seo_watch` then reports every node type as gone
(`seo-watch.ts:54-57`). And `themes/publish` runs this inline with no
timeout. `crawler-check.server.ts:93-99` already does both checks; copy
them.

### 6.3 llms.txt loads every mirror body per public request [blocking at scale]

`llms-txt.server.ts:142-147` selects `body` for every `MirrorCache` row to
regex two front-matter lines out of each. At 20,000 products that is the
whole mirror cache out of Neon per request on an unauthenticated URL.
Store `title` and `url` as columns; select only those; cache the rendered
file per shop and invalidate on write.

### 6.4 One session-storage read per Admin call [needs-fix]

`admin.server.ts:54` fetches the token inside the retry loop, per GraphQL
request. A `seo_apply` over 20,000 products is 40,000 Admin calls and
40,000 extra Neon queries. STATUS names Neon compute as the live cost;
this outweighs the 15-minute poll. Cache per shop in-process with an
expiry short of 60 minutes; the 401 branch at `:65` already handles a
miss.

### 6.5 The proxy makes four sequential DB round trips [needs-fix]

`proxy.$.tsx:93, :130, :147, :157` plus the insert at `:29`.
ARCHITECTURE promises one. From iad to Frankfurt that is roughly 360 ms
before rendering, on the surface crawlers time out on. One query keyed on
`(domain, handle)`.

### 6.6 A JobRun can stay `running` for ever and blocks every button [needs-fix]

Status transitions live only inside the task's try/catch
(`tasks.ts:55, 73, 82`). A worker killed mid-job never reaches either. No
code deletes or times out JobRun rows. `app._index.tsx:200-204` refuses
every action while one exists. Treat `running` older than the lock window
as stale; add a reaper that fails it with a reason.

### 6.7 `extractOneProduct` re-fetches shop info per webhook [needs-fix]

`extract.server.ts:370-371`. Shop name and primary domain, re-fetched from
the Admin API and re-upserted per product. A 5,000-product CSV import is
5,000 extra calls and 5,000 identical writes. `runBulkExtract` already does
it once per pass (`:244`). Read the persisted Setting; refresh daily.

### 6.8 IndexNow truncates at 10,000 and pings for invisible changes [needs-fix]

`indexnow.server.ts:77` `urlList: unique.slice(0, 10000)` under a comment
saying "Batched". One request, truncated silently. And it fires whenever a
metafield was written (`extract.server.ts:342, :403-405`), including on
shops where the embed is off and the rendered page did not change. Loop
in chunks; suppress when `checkAppEmbed` says inactive. Also
`setEnabled` (`:152`) has no caller: the merchant cannot turn it off.

### 6.9 `sweep_missing` deletes on a possibly truncated read [needs-fix]

`tasks.ts:365-368` deletes every NULL-productId mirror row whose handle is
not in `liveHandles`. A truncated bulk download means a short list and an
unrecoverable delete. `catalogue.server.ts:27` already selects
`objectCount` and discards it. Compare, and skip the cleanup on mismatch.

### 6.10 `seo_queue_build` stores the whole queue in one JobRun row [needs-fix]

`tasks.ts:781`. One JSON value with current and proposed title and
description per product, read in full by the SEO loader per render, never
pruned. Cap stored rows as `bulk_collections` does (`:682`); page the rest.

### 6.11 The five-minute cache header undercounts crawler hits [needs-fix]

`proxy.$.tsx:102` `Cache-Control: public, max-age=300`. Repeat fetches
inside five minutes may be served by the edge and never logged.
CRAWLER-HITS-SPEC section 3 lists this as open; it still is. Decide it:
`no-store`, or say on screen that counts are per five-minute window.

### 6.12 Hard-coded extension uid [needs-fix]

`embed-check.server.ts:40`. If Shopify assigns a new released uid, every
install flips to `staleReference` at once and onboarding refuses to
complete for everyone. Environment variable; treat "right handle, unknown
uid" as unreadable, not stale.

### 6.13 A challenge served with HTTP 200 reads as `ok` [improve]

`crawler-check.server.ts:75-79`. A Cloudflare interstitial answering 200
is reported as fully reachable. Require a product signal in the body.

### 6.14 `bulk_alt_text` is one Admin query per product [improve]

`alt-text.server.ts:53` after a bulk export that does not include media.
Add `media(first: 20) { alt }` to `PRODUCTS_QUERY`.

### 6.15 The poll writes a Setting per shop every 15 minutes even when idle [improve]

`tasks.ts:308` upserts the cursor unconditionally; `:278` asks Shopify for
the subscription state per shop per run. This, not the read, is what keeps
Neon from idling. Skip the upsert when zero products came back; cache the
subscription answer for an hour (`app_subscriptions/update` already
invalidates it). Keep the poll: webhooks lose deliveries across deploys.

### 6.16 Our own bulk writes fire a wave of webhooks [improve]

`advancePollCursor` (`tasks.ts:38-46`) stops the poll from re-queueing
what we just wrote, but not the `products/update` webhooks our writes
generate. A 20,000-product pass produces 20,000 `extract_product` jobs
whose only defence is the `unchanged` check, each costing a `SINGLE_PRODUCT`
read and a shop-info read (6.7). A per-shop "bulk in progress" marker read
by `extract_product` absorbs it.

---

## 7. What to cut

- **`RequestMetric`** (`schema.prisma:160-169`). Declared, indexed, never
  written. ARCHITECTURE promises dashboards from it. Cut it or write to it;
  a half-present table is a claim with no code, the same shape as the
  WordPress auto-update claim.
- **`CrawlerHit.ip` and `CrawlerHit.forwarding`** (`schema.prisma:145,
  :154`). Personal data collected for a verification that does not exist,
  named in PRIVACY.md. Read the answer off the rows already collected (does
  a real client address ever arrive?), then drop both columns until
  forward-confirmed reverse DNS is actually built.
- **`Shop.freeProductsUsed`** (`schema.prisma:52`, `billing.server.ts:453`).
  Written on every reservation, read by nothing, can drift from the
  authoritative set. Drop it.
- **The `seo_unlocked` branches in the Liquid block for `priceValidUntil`,
  `WebSite` and `BreadcrumbList`** (section 4). Either on for everyone or
  gone. A permanently-off branch in one of the two files a reviewer reads
  is dead weight.
- **`fit_for` from `use` and `occasion`** (3.5). Keep rooms only.
- **The citation verdict** (2.9), unless rescored. Today it says `good` to
  a 160-character keyword title and cannot say `good` to a short honest
  one. A verdict that is wrong in both directions is worse than no
  verdict.
- **Price inside the stored questions and summary** (3.10), or the meta
  policy, one of the two.
- **`Memory` and `Warranty` preset lines as written** (3.3), and `IP*`
  (3.4). Presets that publish `GB, TB` or never match are worse than no
  preset.
- **`RequestMetric`-style promises in ARCHITECTURE**: `ENCRYPTION_KEY`
  "token encryption at rest" (`ARCHITECTURE.md:104`) has no code behind
  it. `Session.accessToken` and the storefront password
  (`app.seo.tsx:183`) are plaintext in Neon. Either implement it or delete
  the sentence; a false security claim in the architecture document is the
  worst kind.

---

## 8. What to add

Pipeline and engine only. Each with the data it needs and whether it
exists.

1. **Negation, label-anchored numbers, separators, abbreviations** (section
   5, items 1 to 4). Data: none new. This is the work that makes the
   engine safe outside furniture. It comes before anything else in this
   list, because until it lands the engine can publish a false allergen
   claim.
2. **Questions from the merchant's own labels in their language** (2.6,
   5.8). Data: the dictionary. This is what makes the FAQ block exist for
   a non-furniture shop.
3. **A dead-job reaper** (6.6). Data: `startedAt`, `updatedAt`, already on
   the row.
4. **`objectCount` reconciliation on every bulk read** (6.9). Data: already
   selected and discarded.
5. **A bulk-in-progress marker** (6.16). Data: one Setting key.
6. **A daily `CrawlerHitDaily` rollup** per CRAWLER-HITS-SPEC. The daily
   prune destroys history at 30 days; the WordPress sibling shows 180. The
   rollup is the only missing piece, and it is what makes the at-a-glance
   trend line honest.
7. **Crawler verification by forward-confirmed reverse DNS**, storing only
   the verdict. Prerequisite: answer from the `forwarding` column whether a
   real client IP ever reaches the app behind Fly and Shopify's edge. If it
   does not, verification cannot be built here and the counter must say so
   on screen.
8. **A `collections/update` webhook.** Membership changes silently
   invalidate every comparison table. `bulk_collections` exists; it needs a
   single-collection variant.
9. **An embed-active gate on IndexNow** (6.8). `checkAppEmbed` computes
   the answer; nothing consumes it.
10. **A read-back test for empty string versus never set on `productUpdate`
    seo fields**, recorded next to `revertSeo`. SEO-WORKSPACE-PRD said this
    before the bulk queue shipped; it shipped.
11. **Cost logging.** `admin.server.ts:90` reads `throttleStatus` and never
    logs the points. One line, and the app finally knows what a pass costs.

---

## 9. Order

Before Republica BIO is processed: 2.1 negation, 2.2 abbreviations, 2.3
separators, 6.1 state race, 3.2 alt-text overwrite. Then re-run the engine
on the 189 products and read the value inventory again. The run script is saved as
`scripts/audit-engine-run.ts`; it takes a products JSON and a dictionary
file and prints the family counts, the value inventory per label, the
term-gap list, and six full samples. Seconds to run.

Then: 2.6 questions and summary from the merchant's labels, 5.2
label-anchored numbers, 2.7 term-gap, 6.2 theme scan, 6.3 llms.txt.

Then the rest of section 6, section 7's cuts, and section 4's schema
corrections, with one live page source check for 3.1 first.

The at-a-glance screen and the attribution sentence from the other audit
sit after all of this. A dashboard over an engine that publishes
`contine gluten` on a gluten-free product is a dashboard over a liability.
