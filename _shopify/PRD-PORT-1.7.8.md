# PRD: porting WordPress 1.7.8 to the Shopify app - the "Now" set

2 September 2026. Refines `_shopify/PORT-1.7.8.md` into something an
implementer can build from without having seen the triage conversation.
Where this document and PORT-1.7.8.md disagree, this document wins, and
section G says why.

Binding on every item below:

- Every number renders with its denominator and its method in the same card
  (EXPERIENCE-PRD section 2). A method line that cannot be written truthfully
  means the panel does not ship.
- Plain characters only in every string: no em dash, no en dash, no curly
  quotes, no ellipsis character. Every published string goes through
  `cleanOutput()` (`app/engine/normalize.ts`).
- Product UI is English only.
- No new npm dependency. Section G and section H record the one that was
  considered (XLSX) and why it is not in this pass.
- Nothing reads orders, customers or payments. `shopify.app.toml` scopes stay
  `read_products, write_products, read_themes`.
- The three storefront blocks under `extensions/` keep zero JavaScript. The
  only Liquid change in this pass is in `ai-visibility.liquid` and it adds
  markup, not script.
- Every write path keeps its entitlement check. Nothing here adds a write
  that a free shop can reach, and the new Setting writes (the IndexNow
  switch, and the two eligibility toggles of section J) are gated like
  `app.business.tsx:51`. One thing is deliberately not gated, and section
  I.2 says why: deleting this app's own MirrorCache row for a product that
  is no longer published. That is a withdrawal, not a write to Shopify.
- `check.bat` green is not done. For every panel with state, the second
  render after the action is specified and must be pressed on the dev store.

## Reading order for the implementer

1. `CLAUDE.md` (repo root), then `_shopify/PORT-1.7.8.md`.
2. `app/routes/app.report.tsx` and `app/services/report-metrics.ts`: most of
   this pass extends those two files. Read them whole first.
3. `app/services/crawler-hits.server.ts`, `crawler-check.server.ts`,
   `crawler-info.ts`: the three files the registry (section B) replaces.
4. `app/engine/summary.ts`, `app/services/business.server.ts`,
   `app/routes/app.business.tsx`, `mirror.server.ts:134-161`,
   `llms-txt.server.ts:67-80`, `ai-visibility.liquid:100-119` and `:196-232`:
   the surfaces the delivery work (section E) touches.
5. `app/engine/citation.ts`, its test, and `app.products.$id.tsx:186-196`
   and `:789-837`: what section F removes.
6. `worker/tasks.ts:367-432` (`sweep_missing`), `extract.server.ts:153-197`
   and `:386-448`, `facts.server.ts:55-66`, `catalogue.server.ts:24-77` and
   `:193-295`, `llms-txt.server.ts:139-163`, `proxy.$.tsx:147-158`,
   `webhooks.products.update.tsx`, `webhooks.products.delete.tsx`,
   `collections.server.ts:37-59`: the surfaces sections I and J touch.

## Items in this pass

| # | Item | Section |
|---|---|---|
| 1 | Tier word on the readability dial (weighted score rejected) | C |
| 2 | Findings 2, 4, 5 (reworded), 6 (reworded) added to the eight-rule set | A.1 |
| 3 | The "How to fix" modal on every finding | D |
| 4 | Top-30 exact values under the families card | A.2 |
| 5 | Product picker and best-versus-weakest on the before-and-after panel | A.3 |
| 6 | "What is switched on" module card | A.4 |
| 7 | One crawler registry | B |
| 8 | robots.txt snippet with Copy | A.5 |
| 9 | Requests split by page kind (mirror, llms.txt, agents.md) | A.6 |
| 10 | Cutting `checkCitationReadiness` | F |
| 11 | Delivery as a composed sentence, typed fields, business type | E |
| 12 | A change stamp on the dictionary and the business record | A.7 |
| 13 | Withdrawal: a product that leaves the published state loses its public pages (verified bug) | I |
| 14 | Which product states are put in front of AI: two merchant toggles | J |

Items 13 and 14 were added on 2 September 2026 after the first draft. They
keep the letters I and J and sit between F and G so that every existing
reference to sections G and H stays valid.

Not in this pass: section H.

---

## A. The Report screen items

All of these live on `/app/report` (`app/routes/app.report.tsx`) with their
arithmetic in `app/services/report-metrics.ts`, following the existing split:
no database, no Shopify and no I/O in `report-metrics.ts`, so every figure can
be asserted on without a browser. The gate is unchanged: paid or comped
(`app.report.tsx:125-126`).

### A.1 Findings: the rule set after this pass

What a shop owner reads: "the list of things to fix, worst first, each with
a button that opens the fix."

The rule set becomes, in render order (severity first, then rule number):

| Rule | Key | Severity | Badge | Ships today | Section |
|---|---|---|---|---|---|
| 1 | `blocked-while-others-allowed` | critical | Blocking | yes (`report-metrics.ts:567-583`) | D.1 |
| 1b | `own-setting-robots_disallow`, `own-setting-password_page` | attention | Your setting | yes (`:594-621`) | D.2 |
| 2 | `no-live-check` | critical | Blocking | new | D.3 |
| 3 | `products-without-attributes` | attention | Needs you | yes (`:625-636`) | D.4 |
| 4 | `policies-unset` | attention | Needs you | new | D.5 |
| 5 | `text-pages-not-requested` | info | Worth knowing | new | D.6 |
| 6 | `stale-since-change` | attention | One click | new | D.7 |
| 7 | (unverified requests) | - | - | blocked, not built | H |
| 8 | (edge cache floor) | - | - | not a finding, see A.6 | - |
| 9 | `non-crawler-tokens` | info | Worth knowing | yes (`:643-656`) | D.8 |

`FindingsInput` (`report-metrics.ts:540-546`) grows by:

```ts
export type FindingsInput = {
  checks: CheckLike[];
  /** True when at least one CrawlerCheck row with a cause exists for this shop. */
  everChecked: boolean;
  nothingToRead: number | null;
  sampled: number | null;
  tokens: { token: string; count: number }[];
  windowDays: number;
  /** Section E: which of the three shop-wide answers are set. */
  policies: { delivery: boolean; returns: boolean; warranty: boolean } | null;
  /** Section A.6: successful requests in the window by kind of page. */
  byPage: { products: number; llms: number; agents: number; keyFile: number } | null;
  /** Section A.7: the last change stamp and the last finished write pass. */
  stamp: { at: string; reason: "dictionary" | "business" } | null;
  lastWritePassAt: string | null;
};
```

The `Finding` type (`:528-538`) grows by the modal fields in section D.
Existing fields keep their names so the current tests keep passing.

The empty-state sentence `nothingToActOn()` (`:671-684`) gains one clause per
new rule, each written only when the thing was measured, on the same pattern
as the three clauses there today:

- policies measured: "delivery, returns and warranty are all set" / not
  measured (record is null): "the business record has not been filled in, so
  delivery, returns and warranty are unknown" (that case fires rule 4, so
  the clause is only reachable when the record exists and is complete).
- byPage measured with products > 0: "product text pages have been requested".
- stamp older than the last write pass or absent: "nothing changed since the
  last pass".

Acceptance (add to `report-metrics.test.ts`; see D for each rule's own rows):

| Input | Expected |
|---|---|
| `everChecked: false`, `checks: []` | one finding, key `no-live-check`, severity critical |
| `everChecked: true`, `checks: [{GPTBot, ok}]` | no `no-live-check` finding |
| `policies: {delivery: false, returns: true, warranty: true}` | one `policies-unset` finding whose `measured` has three rows and whose title names only delivery |
| `policies: null` | one `policies-unset` finding, title "Delivery, returns and warranty are not set" |
| `byPage: {products: 0, llms: 12, agents: 0, keyFile: 0}` | one `text-pages-not-requested` finding, info |
| `byPage: {products: 3, llms: 12, ...}` | no `text-pages-not-requested` finding |
| `byPage: null` or all zero | no `text-pages-not-requested` finding |
| `stamp: {at: "2026-09-02T10:00Z", reason: "dictionary"}`, `lastWritePassAt: "2026-09-01T10:00Z"` | one `stale-since-change` finding |
| stamp older than the pass | none |
| stamp set, `lastWritePassAt: null` | none (rule 3 or the empty state already covers a shop with no pass) |
| findings order with every rule firing | critical rules first (1 then 2), then attention (1b, 3, 4, 6), then info (5, 9) |

### A.2 Top-30 exact values under the families card

What a shop owner reads: "the actual words the app found in my descriptions,
and how many products use each."

Source. A new tally in `coverage()` (`app/engine/index.ts:111-142`): for every
Fact, split `fact.v` on `", "` (the engine joins readings with a comma and a
space, `extract.ts`; `report-metrics.ts:41-45` documents this), and count
`(fact.k, reading)` pairs, one per product per pair. Return
`topValues: [family, value, products][]`, sorted by products desc then family
then value, cut to 30. `DryRunReport` (`extract.server.ts:235-250`) carries it
unchanged; `PassFigures` (`report-metrics.ts:33-61`) reads it as
`topValues?: [string, string, number][]`, undefined on reports written before
the field, like `byAttrProducts` (`:172`).

The engine stays pure: this is arithmetic over data `coverage()` already
walks. Storage cost: at most 30 rows of three short strings per JobRun.

Render. On the "What your descriptions already say" card
(`app.report.tsx:683-757`), below the family bars and above the method line, a
sub-heading and a two-column list:

```
Values your descriptions use most

Material      oak                   41 of 355 products
Dimensions    120 x 60 cm            9 of 355 products
...
```

Copy:

- Sub-heading: `Values your descriptions use most`
- Row: `{family}` | `{value}` | `{n} of {sampled} products`
- Method line (replaces the card's current one; one line for both lists):
  `Counted from your own descriptions in {passOn(when)}, over {sampled}
  products. Each product counts once for a kind of detail however many
  readings of it the description gives, so no figure here can exceed
  {sampled}. The values list shows the 30 most common readings, split where
  one product states several: "74 cm, 80 cm" counts once for each.`
- Predates state (pass has `topValues` undefined): the sub-heading and the
  line `{PassOn(when)} predates the values tally. Run it again and this list
  fills in.` The family bars above render as today.
- Empty state (pass has `topValues: []`, which means no fact anywhere): the
  card already handles `byAttr.length === 0` (`:698-701`); the values block
  is not rendered in that case.

CSV. `familiesCsv` gains no column. A third export table `values` at
`/app/report/export/values` with columns `Kind of detail, Value, Products
stating it, Products read` (`app.report.export.$table.tsx:25` adds `"values"`
to `TABLES`). Button text on the Take this away card: `Export the most common
values as CSV`.

Acceptance:

| Input | Expected |
|---|---|
| products: A "oak, 120 x 60 cm", B "oak", C nothing; dictionary with Material and Dimensions | `topValues` = `[["Material","oak",2],["Dimensions","120 x 60 cm",1]]` |
| one product whose Dimensions fact is "74 cm, 80 cm" | two rows, `["Dimensions","74 cm",1]` and `["Dimensions","80 cm",1]` |
| 40 distinct values | `topValues.length === 30` |
| report without `topValues` | screen shows the predates line, not an empty list |
| `valuesCsv([["Material","oak",2]], 355)` | header row then `Material,oak,2,355` |

### A.3 Product picker and best-versus-weakest on the before-and-after panel

What a shop owner reads: "pick any product of mine and see what the app read
out of its own description, next to the words it came from."

Source. Today the loader (`app.report.tsx:177-219`) reads the 25 most
recently updated active, published products, runs `extractProduct` on each and
shows the richest. Change:

1. The loader keeps the 25 and returns their `id`, `title`, `families`
   (distinct fact keys) as `candidates`, sorted richest first, plus `example`
   as today.
2. Query parameter `?example=<numeric product id>` selects the example. If
   the id is among the 25, no extra call. If it is not, one `product(id:)`
   query for `title`, `descriptionHtml`, `handle`, filtered on the same
   `status:active AND published_status:published` rule: a draft is refused
   with the sentence in the empty state below.
3. The weakest product is `pass.figures.weakest[0]` when the pass recorded
   ids (`report-metrics.ts:63`, `extract.server.ts:233`), otherwise the
   candidate with the fewest families.

Render, in the card at `app.report.tsx:610-681`:

- Above the two columns, one row: a Polaris `Select` labelled
  `Product shown` listing the 25 candidates as `{title} ({families} kinds of
  detail)`, richest first, and two plain buttons: `Show the richest` and
  `Show the weakest`. Changing the select navigates to `?example=<id>`
  (a form with `method="get"`, no client state, so the second render is the
  loader's and not a stale `useState`).
- The right column heading becomes `After: {n} readable value{s}` as today;
  when `n === 0`, the column shows the sentence `This description states
  nothing the dictionary recognises. Nothing is published for it, and
  nothing is invented to fill the gap.` and the card stays rendered. Today
  the card returns null on zero facts (`:611`); with a picker that must not
  happen, or choosing the weakest makes the card vanish.
- Method line: `{title}, read just now with today's dictionary. The list
  offers the 25 most recently updated products that are active and
  published; "weakest" is the product with the fewest kinds of detail in
  {passOn(when)}. The left column is its own description, the right column
  is what that description produced.` followed by the existing shortening
  and trimming sentences (`:676`).
- Refused state (`?example=` names a draft, an archived product, or a
  missing id): the card renders with the default example and one line above
  the select: `That product is not active and published, so it is not shown
  here: the pass never reads it and nothing is published for it.`

Acceptance:

| Input | Expected |
|---|---|
| no query parameter | richest of the 25 shown, select shows it selected |
| `?example=<id of candidate 7>` | candidate 7 shown, no extra GraphQL call (assert in a loader test with a counting `admin.graphql` stub) |
| `?example=<id not in 25, active>` | one `product(id:)` call, product shown |
| `?example=<id of a draft>` | refused line, default example shown |
| weakest product with 0 facts | card renders with the zero-facts sentence, no highlight |

### A.4 "What is switched on" module card

What a shop owner reads: "which parts of the app are on, and one real number
for each."

This is the one item where the WordPress shape does not carry. WordPress has
thirteen `mod_*` switches (`class-avw-settings.php:473`); this app has none.
The mirror, llms.txt, agents.md and the comparison tables are always on, and
turning them off would need a proxy gate plus a shop metafield the Liquid
blocks read, which is a separate change with its own risks. The only switch
that exists and has no caller is IndexNow (`indexnow.server.ts:152`, audit
2.15). So: cards with a state and one number each, and exactly one module
switch. Section J adds two eligibility toggles under the Plain text pages
row; they choose which products get a page, they do not switch the module
off, and the two are not the same thing.

Source per row, all read in the Report loader:

| Row | State source | Number source |
|---|---|---|
| Structured data on product pages (the app embed) | `checkAppEmbed()` (`embed-check.server.ts:63`): `active`, `presentButDisabled`, `staleReference`, `unreadable` | none |
| Plain text pages | always on | `db.mirrorCache.count({ where: { shopId, productId: { not: null } } })` |
| llms.txt and agents.md | always on | the same count (llms.txt lists every cached mirror, `llms-txt.server.ts:140-147`) |
| Comparison tables | always on | last JobRun `kind: "collections"`, `status: "done"`: `report.withTable` of `report.collections` (`worker/tasks.ts:731-737`) |
| Image descriptions | on demand | last JobRun `kind: "alt_text"`, `status: "done"`: `report.written` (`worker/tasks.ts:515`) |
| IndexNow | `isEnabled(shopId)` (`indexnow.server.ts:145`) | none: no ping log exists |
| SEO workspace | Setting `seo_unlocked` (`billing.server.ts:158`) | none |

Every JobRun read goes through `readPass`-style status filtering: a failed or
refused job never yields a number (`report-metrics.ts:9-13`).

Render. One card, `What is switched on`, one row per module: name, a
`Badge` (tone success for on, undefined for "on demand", warning for
"not active", undefined for unknown), the number as a sentence, and one
action.

Copy per row:

- Structured data
  - active: badge `On`; `Published on every product page by the theme
    block.` Action: none.
  - presentButDisabled / not active: badge `Not active`; `The block is in
    your theme but switched off, so nothing from this app reaches the
    product page. Two clicks in the theme editor turn it on.` Action:
    `Open theme editor` with the deep link the dashboard already builds
    (`app._index.tsx:778`).
  - staleReference: badge `Needs re-adding`; `Your theme references an
    older copy of the block. Remove it and add it again in the theme
    editor.`
  - unreadable: badge `Unknown`; `We could not read the theme settings, so
    whether the block is on is unknown. That is not the same as off.`
    (Audit 1.7: an unknown is rendered as unknown.)
- Plain text pages: badge `On`; `{n} product pages served. One per
  processed product, at /apps/ai-visibility/<handle>.` Action: `View one`
  linking to the most recently updated MirrorCache handle; when `n === 0`:
  `No product page yet. Pages appear as products are processed.` Below
  that sentence, the two toggles of section J.3, each with its effect
  sentence beside it, and the section J.5 line about what is never given a
  page.
- llms.txt and agents.md: badge `On`; `Lists the same {n} products. Built on
  request, never a stale file.` Action: `View llms.txt` (proxy URL on the
  primary domain).
- Comparison tables: badge `On`; done job: `{withTable} of {collections}
  collections carry a table. The rest do not vary enough to compare.`; no
  done job: `Not built yet.` Action: `Open collections`.
- Image descriptions: badge `On demand`; done job: `{written} descriptions
  written on {date}.`; none: `Nothing written yet.` Action: `Open products`.
- IndexNow: badge `On` or `Off`; `Tells Bing, Yandex and others that a page
  changed, the moment this app writes it. No count is kept of pings sent.`
  Action: a `Switch off` / `Switch on` submit button. The action handler in
  `app.report.tsx` calls `hasPaidAccess` exactly like `app.business.tsx:51`
  before `setEnabled`, and returns `{ indexnow: boolean }`; the screen
  re-renders from the loader, not from local state. Second render: the badge
  reads the new state after the POST, verified on the dev store.
  `pingProducts` and `pingCollections` (`indexnow.server.ts:113`, `:128`)
  must read `isEnabled` and return early when off; today nothing reads it.
- SEO workspace: badge `Enabled` or `Not enabled`; `Set up during a paid
  engagement, not a self-serve switch.` Action: none.

Method line: `States are read live from your theme settings, this app's own
tables and the last finished job of each kind. Nothing here is estimated.`

Acceptance:

| Input | Expected |
|---|---|
| embed `{unreadable: true}` | badge Unknown, the "not the same as off" sentence |
| mirror count 0 | the "No product page yet" sentence, no View link |
| collections job status failed | `Not built yet.`, never a number from `report.error` |
| POST `intent=indexnow&enabled=false` from a shop with no paid access | 200 with an error banner naming the subscription, Setting unchanged |
| POST from a paid shop | Setting `indexnow_enabled` = `"false"`, badge Off on the next render |
| IndexNow off, a product is written | `pingProducts` makes no outbound request (unit test with a fetch stub) |

### A.5 robots.txt snippet with Copy

What a shop owner reads: "if my own robots.txt names a crawler and turns it
away, here is exactly what to paste to give it the same rules as everyone
else."

Facts that bound this item, read today:

- Shopify's default robots.txt (read from `mrdigital-dev.myshopify.com/robots.txt`
  on 2 September 2026) has one `User-agent: *` group with allow and disallow
  rules for checkout, cart, account, filters and previews, plus a header of
  comments. It names no AI crawler. A shop that never touched
  `robots.txt.liquid` therefore never blocks a crawler by name, and the
  snippet has nothing to fix.
- `robots.txt.liquid` is not in a theme by default; the merchant creates it
  in Online Store, Themes, Edit code, Templates, and Shopify documents the
  loop over `robots.default_groups` as the way to keep the default rules
  (shopify.dev, robots.txt.liquid template page, read 2 September 2026).
- The check already parses the live file (`crawler-check.server.ts:128-150`)
  and records `robots_disallow` per agent (`:166-169`).

So the snippet ships in exactly one place: the modal of finding 1b for cause
`robots_disallow` (section D.2). Nowhere else, because everywhere else it
would be telling a merchant to edit a file that is already right.

Snippet content, with the affected names filled in, one group per crawler:

```
{%- comment -%} Added from AI Visibility: give {name} the same rules as every other crawler. {%- endcomment -%}
{%- for group in robots.default_groups -%}
  {%- if group.user_agent.value == '*' -%}
User-agent: {name}
    {%- for rule in group.rules %}
{{ rule }}
    {%- endfor %}
  {%- endif -%}
{%- endfor -%}
```

It copies the `*` group's rules under the crawler's own name. It never emits a
bare `Allow: /`: a group naming GPTBot with only `Allow: /` would override the
`*` group for GPTBot and let it into checkout and cart, which Shopify's
defaults keep it out of. The instruction beside the snippet says to delete
the merchant's own `User-agent: {name}` / `Disallow: /` lines first, since two
groups for one name is ambiguous.

The `robots_token` comes from the registry (section B), never from the label:
for every crawler in this pass the two are equal, and the field exists so
they can differ later without touching this code.

Copy button: a Polaris `Button` with `onClick` calling
`navigator.clipboard.writeText`, with a fallback `TextField` (read-only,
`selectTextOnFocus`) so the text can be selected by hand when the clipboard
API is unavailable in the embedded iframe. The label reads `Copy` and
changes to `Copied` for two seconds; no state survives a re-render.

Acceptance:

| Input | Expected |
|---|---|
| `robotsSnippet(["GPTBot", "ClaudeBot"])` | two groups, each with the Liquid loop, names in the given order |
| `robotsSnippet([])` | empty string, and the modal renders no snippet box |
| finding 1b with cause `password_page` | no snippet (the file is not the problem) |
| the snippet pasted into a dev-store `robots.txt.liquid` and `/robots.txt` fetched | the output contains `User-agent: GPTBot` followed by the same rules as the `*` group; verified by hand once on the dev store |

### A.6 Requests split by kind of page

What a shop owner reads: "how many of those requests were for a product page,
and how many for llms.txt."

This is the attribution sentence from AUDIT-2026-09-02 section 7.1, and it
needs no new table: `crawlerHitsForDashboard` already selects `path` and
`handle` for every row in the window (`crawler-hits.server.ts:114-117`).
PORT-1.7.8.md put it under "Next, one table each" by mistake; see section G.

Source. `summarizeHits` (`:82-99`) gains a pure sibling
`summarizeByPage(rows)` returning `{ products, llms, agents, keyFile }`,
successful requests only, recognised crawlers only (the same `normalizeBot`
filter, so the numbers agree with the tables). Classification:

- `handle === null` and `path` ends with `/llms.txt`: `llms`
- `handle === null` and `path` ends with `/agents.md`: `agents`
- `handle === null` and `path` matches `/indexnow-.*\.txt$`: `keyFile`
- `handle !== null`: `products`

`crawlerHitsForDashboard` returns it as `byPage`.

Render, on the "Requests to your AI-readable pages" card, directly under the
`Last {windowDays} days, successful reads only.` line (`app.report.tsx:868`):

`{products} requests for product pages, {llms} for llms.txt, {agents} for
agents.md, {keyFile} for the IndexNow key file. Every one of these addresses
exists only because this app is installed: none of them was on your shop
before.`

The second sentence is the attribution claim and it is true by construction:
the app proxy path did not exist before install (`proxy.$.tsx:7`).

The method line at `:946` gains one sentence, which is the whole of WordPress
finding 8 on this platform: `Repeat requests for the same page inside five
minutes may be answered by Shopify's edge cache and never reach this app, so
every count here is a floor, not an exact figure.` Source: `proxy.$.tsx:102`
sets `Cache-Control: public, max-age=300` on every response.

When `hits.total === 0` the split line is not rendered; the existing empty
sentence stands.

Acceptance:

| Input | Expected |
|---|---|
| rows: GPTBot 200 handle "chair"; GPTBot 200 handle null path ".../llms.txt"; curl 200 handle "chair"; GPTBot 404 handle "table" | `{products: 1, llms: 1, agents: 0, keyFile: 0}` |
| rows: only Google-Extended 200 handle "chair" | all zero (tokens never count) |
| `hits.total === 0` | the split line is absent |

### A.7 A change stamp on the dictionary and the business record

What a shop owner reads: "you changed the dictionary after the last pass, so
products still carry the old values until you run it again."

WordPress 1.7.8 item 13 is a global cache generation that invalidates every
per-post transient, and the mirror is then re-extracted on the next request.
This app pre-renders the mirror into `MirrorCache.body` at write time
(`mirror.server.ts:1-6`, `extract.server.ts:362`) and the proxy serves the
stored body (`proxy.$.tsx:147-158`). There is no render on request, so
"invalidate" would mean "404 until the next pass", which is worse than a
stale page. The honest port is a stamp and a finding, and the pass is the
re-render.

Source. A Setting row `key: "change_stamp"`, value
`{"n": <int>, "at": "<ISO>", "reason": "dictionary" | "business"}`. Written
by:

- `app.dictionary.tsx` action, after the dictionary Setting upsert (`:80-81`),
  only when the new text differs from the stored text (an identical save is
  not a change; same principle as the `unchanged` writers).
- `saveBusiness` (`business.server.ts:94-128`), only when the serialised
  record differs from the stored one.

`n` increments; it is there so a later cache key can use it, and nothing in
this pass reads it.

Read by the Report loader as `stamp`, alongside `lastWritePassAt`: the
`finishedAt` of the most recent JobRun `kind: "bulk_extract"`,
`status: "done"`. Dry runs do not count: they write nothing, so they cannot
have carried the change into the products.

Finding 6 (section D.7) fires when `stamp.at > lastWritePassAt`.

llms.txt reads the business record live on every request
(`llms-txt.server.ts:140-141`), so it is never stale and the finding says so.

Acceptance:

| Input | Expected |
|---|---|
| dictionary saved with the same text | no stamp write (Setting unchanged) |
| dictionary saved with different text | stamp `{n: 1, reason: "dictionary"}`; a second change gives `n: 2` |
| business saved with a changed record | stamp `reason: "business"` |
| stamp at 10:00, last done bulk_extract at 09:00, a dry_run at 11:00 | finding 6 fires (the dry run does not clear it) |
| a bulk_extract finishes at 12:00 | finding 6 gone on the next render (pressed on the dev store) |

---

## B. The crawler registry

### B.1 What it replaces

Today the same knowledge is in five structures across three files, and they
disagree:

| Structure | File | Names | Problem |
|---|---|---|---|
| `KNOWN_BOTS` | `crawler-hits.server.ts:32-47` | 14 | counts ClaudeBot; nothing else knows it |
| `AGENTS` | `crawler-check.server.ts:13-28` | 8 | checks Google-CloudVertexBot but not ClaudeBot; `app.diagnostics.tsx:300` says "Googlebot and Applebot, already checked above" and Googlebot is not on the list |
| `NON_CRAWLER_TOKENS` | `crawler-info.ts:136` | 2 | correct, stays as a derived view |
| `CRAWLER_INFO` | `crawler-info.ts:10-46` | 8 | no ClaudeBot, so the product screen shows no owner for it |
| `BOT_HINT`, `AI_ASSISTANT_BOTS`, `SEARCH_ENGINE_BOTS` | `report-metrics.ts:408-434` | 14 | a third copy of the grouping |
| `CAUSE_TEXT`, `OWN_SETTING_*` | `crawler-info.ts:59-126` | - | not crawler data; stays where it is |

Each of the five crawler lists is deleted and rebuilt as a derived view over
one array. The cause taxonomy is untouched.

### B.2 The file and its fields

New file `app/services/crawlers.ts`. No `.server` suffix: the Report and
Diagnostics components render names, owners and purposes, and a value import
from a `.server` module fails the client build (the reason `crawler-info.ts`
exists, `:1-4`). Plain data, no I/O.

```ts
export type CrawlerPurpose = "search" | "user" | "train" | "shopping" | "tooling";

export type Crawler = {
  /** What the merchant sees, and the key every count and check is stored under. */
  label: string;
  /** Lowercased substring that identifies it in a raw user agent. */
  fragment: string;
  /** The exact string for a robots.txt User-agent line. */
  robotsToken: string;
  operator: string;
  purpose: CrawlerPurpose;
  /** One sentence, shown beside the name. Only what the operator states. */
  note: string;
  /** True for a robots.txt control token: no request ever carries the name. */
  isToken: boolean;
  /** Reverse-DNS suffixes the operator publishes, or null. Informational in
   * this pass: verification is blocked (PORT-1.7.8 difference 2). */
  rdns: string[] | null;
  /** Published address-range document, or null. Informational in this pass. */
  rangesUrl: string | null;
  /** "assistant" rows are checked live and listed first; "engine" rows are
   * counted and never checked (the Report says why at app.report.tsx:895-901). */
  group: "assistant" | "engine";
  /** Full user agent string the reachability check sends. Null means never
   * checked: search engines, tokens, and fetchers that ignore robots.txt
   * anyway. */
  checkAgent: string | null;
  /** Where the row was verified and when. Not rendered; kept so the next
   * person can re-verify without this document. */
  verified: { url: string; on: string };
};

export const CRAWLERS: readonly Crawler[] = [ ... ];  // section B.3, in this order
```

Derived views, all exported from the same file and replacing the old names
at every call site:

```ts
export const FRAGMENTS: [fragment, label][]     // match order = array order
export const TOKENS: string[]                    // labels with isToken
export const CHECKED: Crawler[]                  // checkAgent !== null
export const ASSISTANTS: string[]                // group assistant, not token
export const ENGINES: string[]                   // group engine
export function crawlerByLabel(label: string): Crawler | undefined
export function normalizeBot(agent: string): string   // moved here from crawler-hits.server.ts:49-64, same semantics
```

Order rule, unchanged from today: more specific fragments first, so
`applebot-extended` precedes `applebot`, `oai-searchbot` precedes `gptbot`
(they do not overlap, but `chatgpt-user` and `gptbot` do not either; the rule
is stated so nobody sorts the array alphabetically), `google-extended` and
`googleother` and `google-inspectiontool` precede `googlebot`,
`perplexity-user` precedes `perplexitybot`, `claude-searchbot` and
`claude-user` precede `claudebot`, `amzn-searchbot` and `amzn-user` precede
`amazonbot`, `meta-webindexer` precedes `meta-externalagent` (no overlap;
listed for the same reason).

`normalizeBot` keeps its two-stage shape (`crawler-hits.server.ts:57-63`):
tokens first, returning `"other"`, then fragments in order.

### B.3 The rows

Every row below was read on the operator's own page on 2 September 2026.
The verification log in the return message carries the URLs; the `verified`
field on each row carries the same URL and date. Names not on this list are
not in the registry, and section B.4 says which were left out and why.

| label | fragment | operator | purpose | group | checked | rdns | rangesUrl | note (rendered) |
|---|---|---|---|---|---|---|---|---|
| OAI-SearchBot | oai-searchbot | OpenAI | search | assistant | yes | null | https://openai.com/searchbot.json | Builds the index behind ChatGPT search. |
| ChatGPT-User | chatgpt-user | OpenAI | user | assistant | yes | null | https://openai.com/chatgpt-user.json | Fetches a page because a person asked ChatGPT about it right then. Not an automatic crawler. |
| GPTBot | gptbot | OpenAI | train | assistant | yes | null | https://openai.com/gptbot.json | Collects pages that may train OpenAI models. |
| Claude-SearchBot | claude-searchbot | Anthropic | search | assistant | yes | null | https://claude.com/crawling/bots.json | Builds the index behind Claude's web search. |
| Claude-User | claude-user | Anthropic | user | assistant | yes | null | https://claude.com/crawling/bots.json | Fetches a page because a person asked Claude about it right then. |
| ClaudeBot | claudebot | Anthropic | train | assistant | yes | null | https://claude.com/crawling/bots.json | Collects pages that may train Claude. |
| Perplexity-User | perplexity-user | Perplexity | user | assistant | no (ignores robots.txt, so the check tells nothing) | null | https://www.perplexity.com/perplexity-user.json | Fetches a page because a person asked Perplexity about it right then. |
| PerplexityBot | perplexitybot | Perplexity | search | assistant | yes | null | https://www.perplexity.com/perplexitybot.json | Builds the index behind Perplexity's answers. Not used for training. |
| Applebot-Extended | applebot-extended | Apple | train | assistant | no | null | null | Not a crawler. A robots.txt rule that decides whether Apple may train on pages Applebot already fetched. (isToken) |
| Applebot | applebot | Apple | search | assistant | yes | ["applebot.apple.com"] | linked from support.apple.com/en-us/119829 as "Applebot IP CIDRs" (store the resolved URL when implementing) | Collects pages for Siri, Spotlight and Safari search, and for answers in Apple products. |
| Meta-WebIndexer | meta-webindexer | Meta | search | assistant | yes | null | null | Builds the index behind Meta AI's answers. |
| Meta-ExternalAgent | meta-externalagent | Meta | train | assistant | yes | null | null | Collects pages that may train Meta's models. |
| Amzn-SearchBot | amzn-searchbot | Amazon | search | assistant | yes | null | https://developer.amazon.com/amazonbot/searchbot-ip-addresses/ | Collects pages for search in Amazon products such as Alexa. Not used for training. |
| Amzn-User | amzn-user | Amazon | user | assistant | no (may not follow robots.txt) | null | https://developer.amazon.com/amazonbot/live-ip-addresses/ | Fetches a page because a person asked Alexa about it right then. |
| Amazonbot | amazonbot | Amazon | train | assistant | yes | null | https://developer.amazon.com/amazonbot/ip-addresses/ | Collects pages that may train Amazon models. |
| DuckAssistBot | duckassistbot | DuckDuckGo | user | assistant | yes | null | https://duckduckgo.com/duckassistbot.json | Fetches sources for DuckDuckGo's AI-assisted answers. Not used for training. |
| MistralAI-User | mistralai-user | Mistral | user | assistant | no (user-triggered) | null | https://mistral.ai/mistralai-user-ips.json | Fetches a page because a person asked Mistral's Vibe about it right then. |
| MistralAI-Index | mistralai-index | Mistral | search | assistant | yes | null | https://mistral.ai/mistralai-index-ips.json | Builds the index behind Mistral search. Not used for training. |
| MistralAI-Training | mistralai-training | Mistral | train | assistant | yes | null | null | Collects pages that may train Mistral models. |
| CCBot | ccbot | Common Crawl | train | assistant | yes | ["crawl.commoncrawl.org"] | https://index.commoncrawl.org/ccbot.json | Builds the open web archive many AI companies train on. |
| Google-Extended | google-extended | Google | train | engine | no | null | null | Not a crawler. A robots.txt rule that decides whether Google may use pages Googlebot already fetched for Gemini training and grounding. Does not affect Search, AI Overviews or AI Mode. (isToken) |
| Google-CloudVertexBot | google-cloudvertexbot | Google | tooling | engine | yes (kept: checked today) | ["googlebot.com", "geo.googlebot.com"] | common-crawlers.json linked from the Google page (store the resolved URL) | Fetches pages only when a site owner asks for it while building a Vertex AI agent. No effect on Search. |
| Google-InspectionTool | google-inspectiontool | Google | tooling | engine | no | ["googlebot.com", "geo.googlebot.com"] | same | Your own tests in Search Console and the Rich Results Test. |
| Storebot-Google | storebot-google | Google | shopping | engine | no | ["googlebot.com", "geo.googlebot.com"] | same | Google Shopping. |
| GoogleOther | googleother | Google | tooling | engine | no | ["googlebot.com", "geo.googlebot.com"] | same | Google product teams, not Search. |
| Googlebot | googlebot | Google | search | engine | no | ["googlebot.com", "geo.googlebot.com"] | same | Google Search, including AI Overviews and AI Mode, which use this same crawler. |
| bingbot | bingbot | Microsoft | search | engine | no | null (the Bing page points at a verification tool; the suffix was not read today) | null | Bing Search, which Copilot reads from. |

`checkAgent` strings for the checked rows, exactly as the operators publish
them (the version numbers move; the check sends the string as published on
the day of verification and the field carries the date):

- OAI-SearchBot: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot`
- ChatGPT-User: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot`
- GPTBot: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot`
- Claude-SearchBot, Claude-User, ClaudeBot: Anthropic's page names the bots
  and does not print a full user agent string. Keep the existing string
  shape for Claude-SearchBot (`crawler-check.server.ts:19-20`) and use
  `Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)` and
  `Mozilla/5.0 (compatible; Claude-User/1.0; +claudebot@anthropic.com)`,
  which is the token plus the contact address the page gives. What the
  check tests is the token, which is what a firewall rule matches on.
- PerplexityBot: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)`
- Applebot: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)`
- Meta-WebIndexer: `meta-webindexer/1.1 (+/documentation/sharing/webmasters/web-crawlers)`
- Meta-ExternalAgent: `meta-externalagent/1.1 (+/documentation/sharing/webmasters/web-crawlers)`
- Amzn-SearchBot: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-SearchBot/0.1) Chrome/120.0.0.0 Safari/537.36`
- Amazonbot: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1) Chrome/120.0.0.0 Safari/537.36`
- DuckAssistBot: `DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)`
- MistralAI-Index: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-Index/1.0; +https://docs.mistral.ai/robots)`
- MistralAI-Training: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-Training/1.0; +https://docs.mistral.ai/robots)`
- CCBot: `CCBot/2.0 (https://commoncrawl.org/faq/)`
- Google-CloudVertexBot: as today (`crawler-check.server.ts:26-27`).

That is 16 checked rows against 8 today. `runCrawlerCheck`
(`crawler-check.server.ts:152-183`) stays sequential, so a check takes about
twice as long; the JobRun already reports progress. `robotsDisallows`
(`:128-150`) iterates `CHECKED` instead of `Object.keys(AGENTS)`.

### B.4 Left out, and why

| Name | Why not in the registry |
|---|---|
| DeepSeekBot | DeepSeek publishes no crawler documentation (searched 2 September 2026; every source is a third-party bot directory). The existing purpose text already admits this (`crawler-info.ts:31-35`). A row claims the request came from the operator, and there is no operator statement to stand on. Requests under this name fall to "other". Open decision 4 in the return message: the listing names DeepSeekBot. |
| Bytespider | ByteDance publishes no reachable documentation; the string's own reference link is inaccessible outside China. Same rule. |
| Gemini-Deep-Research | Not on Google's common-crawlers or user-triggered-fetchers pages as of their 14 July and 19 August 2026 updates. The WordPress registry carries it; not verified today, so not here. |
| Claude-Web | Not on Anthropic's page, which lists exactly three bots. |
| OAI-AdsBot, Meta-ExternalAds, Meta-ExternalFetcher, FacebookExternalHit, adidxbot, BingPreview, Google-Agent, Google-GeminiNotebook | Verified to exist, but they fetch ad landing pages, link previews or agent tasks, not a catalogue for an assistant to read. Adding them would put rows on the Report that say nothing about readability. Requests under these names fall to "other", which is the correct verdict for "a real program that is not what this screen measures". |

### B.5 Call sites that change

| File | Change |
|---|---|
| `crawler-hits.server.ts` | delete `KNOWN_BOTS` and `normalizeBot`; import from `crawlers.ts`; `nonCrawlerTokenHits` and `countTokens` use `TOKENS` |
| `crawler-check.server.ts` | delete `AGENTS`; iterate `CHECKED`; re-export nothing crawler-shaped (keep `Cause` re-exports) |
| `crawler-info.ts` | delete `CRAWLER_INFO` and `NON_CRAWLER_TOKENS`; keep `Cause`, `CAUSE_TEXT`, `explainCause`, `OWN_SETTING_*` |
| `report-metrics.ts` | delete `AI_ASSISTANT_BOTS`, `SEARCH_ENGINE_BOTS`, `BOT_HINT`; `crawlerRows` takes `Crawler[]` and reads `note` for the hint |
| `app.report.tsx:841-842` | `crawlerRows(ASSISTANTS ...)`, `crawlerRows(ENGINES ...)` |
| `app.report.tsx:895-901` | the "we do not test search engines" paragraph stays; it is now true by the `checkAgent: null` rule rather than by accident |
| `app.diagnostics.tsx:278-291` | `crawlerByLabel(r.agent)` for operator and note; `:297-305` the Google-Extended paragraph is corrected: Googlebot is not checked, so it reads `Applebot, checked above, and Googlebot, which we do not test` |
| `app.products.$id.tsx:168-175` | unchanged; it reads CrawlerCheck rows by agent label, which are the registry labels |
| `app._index.tsx` crawler tiles | read `CHECKED` for the list; no other change in this pass |
| tests: `crawler-hits` tests, `report-metrics.test.ts` rules 4 and 5 of PRD-REPORT-SCREEN | update imports; add: every `CHECKED` label is in `FRAGMENTS`; every `TOKENS` label has `checkAgent: null`; no fragment is a substring of a fragment that comes later in the array (the ordering rule, asserted) |

CrawlerCheck rows already stored under the eight old labels keep their
labels; every one of those labels is still a registry label, so nothing is
orphaned.

---

## C. The weighted score and its tiers

### C.1 Decision: no weighted score. Tier word on the fraction.

WordPress computes `round(100 * (complete + 0.5 * partial) / total)`
(`class-avw-report.php:369`) and maps it to poor / fair / good / strong at
40 / 70 / 90 (`:387-399`). PORT-1.7.8.md called the blend "a better single
number and worth adopting".

It is not adopted, for three reasons that are each sufficient:

1. EXPERIENCE-PRD section 5 is explicit: "We do not ship a 0-100 score" and
   verdicts are "never blended into one number". The blend is a blend.
2. The 0.5 weight is a claim. "Partly ready" on this screen is one to three
   families (`report-metrics.ts:220-236`). Saying a one-family product is
   half as readable as a four-family one is not something any measurement
   here supports; it is a coefficient someone liked.
3. The screen already shows a 0-100 figure that is a plain fraction:
   `ready / total` as a percentage on the dial (`app.report.tsx:252-292`),
   with both numbers printed under it. A merchant can verify it by counting.
   A second, different 0-100 number beside it would need a paragraph to
   explain why they differ.

What is adopted is the word. A tier word gives the dial something a merchant
reads before the number, and it costs nothing in honesty as long as the
threshold is printed and the word is attached to the fraction the dial
already shows.

### C.2 Definition

```ts
export type Tier = "poor" | "fair" | "good" | "strong";
export const TIER_THRESHOLDS = { fair: 40, good: 70, strong: 90 } as const;
export function tier(percentReady: number): Tier
```

`percentReady` is `Readiness.percent` (`report-metrics.ts:234`):
`round(100 * ready / total)`, where ready means at least `READY_FAMILIES`
(4) distinct families. Thresholds: below 40 poor; 40 to 69 fair; 70 to 89
good; 90 and above strong. The values match the WordPress words at the same
percentage so the two products never disagree about what "good" means, even
though WordPress feeds a different number in.

`total === 0` has no tier: `readiness` is never called in that state
(`PassNotReady` handles it, `app.report.tsx:472-478`).

### C.3 What renders

On the readability card (`app.report.tsx:486-546`), between the dial row and
the segmented bar:

- A `Badge` with the tier word capitalised (`Poor`, `Fair`, `Good`,
  `Strong`), tone critical / warning / success / success, and beside it in
  `bodySm`: `{ready} of {total} products ready, {percent}%.`
- Directly under it, the threshold line, always rendered, never a tooltip:
  `Poor below 40%, fair from 40%, good from 70%, strong from 90%. The word
  follows the percentage above and nothing else: no weighting, no blend.`

The existing method line stays. The dial's `aria-label` gains the word:
`{percent} percent of products are ready: {ready} of {total}, {tier}`.

### C.4 Acceptance

| Input (`depth`) | percent | tier |
|---|---|---|
| `[4, 4, 4, 4, 0]` | 80 | good |
| `[4, 1, 1, 1, 1]` | 20 | poor |
| `[4, 4, 1, 1, 1]` | 40 | fair (boundary inclusive) |
| `[4, 4, 4, 4, 4, 4, 4, 1, 1, 1]` | 70 | good |
| `[4, 4, 4, 4, 4, 4, 4, 4, 4, 1]` | 90 | strong |
| `[5, 12, 23]` | 100 | strong |
| screen with a done pass | the threshold line is present in the rendered card (assert on the string "Poor below 40%") |

---

## D. The "How to fix" modal

### D.1 Shape, one for every finding

A Polaris `Modal` opened from a `How to fix` button on each finding card
(`app.report.tsx:1001-1038`). It has the same four blocks for every rule, in
this order, and no rule may skip one:

1. **What this is.** One paragraph, plain words. Field `what`.
2. **What we measured.** A two-column list of label and raw value, the
   values exactly as stored, never a JSON blob and never a rounded figure.
   Field `measured: [label, value][]`.
3. **What to do.** One paragraph, imperative. Field `todo`.
4. **The action.** Either a button to the screen where the fix happens
   (`linkHref`, `linkText`, both already on `Finding`), or the sentence
   `Nothing to change.` when there is none. Field: the existing two.

Plus one optional block between 3 and 4: **Text to send or paste**, with a
Copy button (section A.5), when the fix is a message to a person or a
snippet for a file. Field `paste` (exists) and new `pasteLabel` (`Send this
to whoever runs your server` / `Paste this into robots.txt.liquid`).

The `Finding` type therefore becomes:

```ts
export type Finding = {
  key: string;
  severity: FindingSeverity;
  badge: string;
  title: string;
  body: string;            // the one-line card text, as today
  what: string;
  measured: [string, string][];
  todo: string;
  linkHref: string | null;
  linkText: string | null;
  paste: string | null;
  pasteLabel: string | null;
};
```

Every string is English, plain characters, and comes from
`report-metrics.ts`, so every modal can be asserted on without a browser.
The modal's open state is `?fix=<key>` in the URL, not `useState`: the
modal survives a loader revalidation and a copied link opens the same modal.
Closing navigates to the URL without the parameter.

### D.2 Content per rule

Where a value is not measured the row is not printed; the modal never shows
a placeholder where a measurement belongs.

**Rule 1: `blocked-while-others-allowed`** (exists; `paste` exists)

- what: `Something in front of your storefront, usually a bot-protection
  layer or a firewall rule, answers some crawlers with an error while
  serving the same page to others. Those assistants never see your
  products, whatever robots.txt says.`
- measured: one row per checked crawler, label the crawler, value the cause
  sentence from `explainCause` plus the HTTP status when recorded
  (`CrawlerCheck.status`), for example `GPTBot` / `403, A bot-protection
  layer refused the request.`; last row `Checked` / the check date from
  `CrawlerCheck.checkedAt` formatted by `formatDay`.
- todo: `Send the message below to whoever runs your storefront's security
  layer (your host, your Cloudflare account, or the security app), then run
  the check again on Diagnostics.`
- paste: the existing message (`:581`), pasteLabel `Send this to whoever
  runs your server`.
- action: `See the full check` to `/app/diagnostics` (exists).

**Rule 1b: `own-setting-robots_disallow`**

- what: `Your own robots.txt names this crawler and tells it not to read the
  page. Nothing refused the request: the check was served the page in full.
  This is a rule of yours, not a block by anyone else.`
- measured: `Crawlers named in your robots.txt` / the affected labels joined
  by `, `; `Page served to them in the check` / `yes`; `Checked` / date.
- todo: `Open Online Store, Themes, Edit code, Templates, robots.txt.liquid.
  Delete the lines "User-agent: {name}" and "Disallow: /" you added for each
  of these crawlers, then paste the block below at the end of the file so
  they follow the same rules as every other crawler. Shopify's default file
  names no AI crawler, so if you never edited this file, someone did it for
  you.`
- paste: the snippet from A.5 for the affected labels; pasteLabel `Paste this
  into robots.txt.liquid`.
- action: `See the full check` to `/app/diagnostics`.

**Rule 1b: `own-setting-password_page`**

- what: `Your storefront is password protected, so every crawler and every
  visitor without the password sees the same page. No crawler is singled
  out and none can be let through on its own. On a store that has not
  opened yet this is deliberate.`
- measured: `Crawlers that saw the password page` / count `of` checked;
  `Checked` / date.
- todo: `If the store is open, remove the password in Online Store,
  Preferences. If it is not open yet, nothing to change now; run the check
  again on launch day.`
- paste: null.
- action: `See the full check` to `/app/diagnostics`.

**Rule 2: `no-live-check`** (new; fires when `everChecked === false`)

- title: `No live crawler check has run yet`
- body: `Robots.txt states an intention. Only a real request as each crawler
  shows what your storefront actually does.`
- what: `Until a check runs, nothing on this screen knows whether an
  assistant can read your store. The check requests one product page once
  per crawler, with that crawler's own user agent, from outside Shopify.`
- measured: `Live check` / `never run`.
- todo: `Run it once on Diagnostics. It takes under a minute and writes
  nothing.`
- paste: null.
- action: `Run the check` to `/app/diagnostics`.

Source: `everChecked` is `checkRows.length > 0` in the loader
(`app.report.tsx:153-159`). Distinct from `checks.length === 0` after the
cause filter, so a shop whose only rows have no cause still reads "never
run", which is the honest verdict about what is known.

**Rule 3: `products-without-attributes`** (exists)

- what: `For these products the description states nothing the dictionary
  recognises: no material, no size, no capacity, no colour, no delivery time.
  Nothing is published for them and nothing is invented to fill the gap, so
  an assistant asked about them gets no detail.`
- measured: `Products stating nothing` / `{none}`; `Partly ready` /
  `{partly}`; `Ready` / `{ready}`; `Products read` / `{sampled}`;
  `Pass` / date. The three readiness counts come from `readiness(depth)`
  when the pass has depth, else only the first and last rows print.
- todo: `Open the list, and for each product add one or two plain sentences
  to the description that name the detail and its value: "Made of solid
  oak, 120 x 60 cm". Then run Fill catalogue. Nothing is invented from what
  is not written.`
- paste: null.
- action: `See the {none} products` to `/app/products?filter=no_attributes`
  (exists; audit 2.8 notes the filter is per page, which is a products-list
  fix outside this pass).

**Rule 4: `policies-unset`** (new; section E supplies the fields)

Fires when `policies` is null, or any of the three is false.

- title: `Delivery, returns or warranty is not set` when more than one is
  missing; `{Delivery|Returns|Warranty} is not set` when exactly one.
- body: `These are one answer each, set once for the whole shop, and they
  are the questions buyers ask on every product.`
- what: `Delivery time, return window and warranty are published on every
  product as buyer questions, in the plain text pages and in structured data.
  A field left empty publishes nothing: no placeholder, no guessed policy.`
- measured: `Delivery` / `set` or `not set`; `Returns` / same; `Warranty` /
  same. Delivery counts as set when `deliveryDaysFrom > 0` or
  `deliveryVaries` is ticked (the merchant answered; "it varies" is an
  answer). Returns when `returnDays > 0`. Warranty when non-empty.
- todo: `Fill in the empty ones on the Business screen. They apply to every
  product at once; existing products carry them after the next pass, and
  llms.txt carries them immediately.`
- paste: null.
- action: `Open Business` to `/app/business`.

**Rule 5: `text-pages-not-requested`** (reworded from WordPress rule 5)

WordPress rule 5 compares storefront visits against text-surface requests.
This app never sees storefront visits (PORT-1.7.8 difference 1). What it can
compare is llms.txt requests against product page requests, both on its own
proxy. Fires when `byPage.llms + byPage.agents > 0` and
`byPage.products === 0` in the window.

- title: `Crawlers read your llms.txt but no product page yet`
- body: `{llms + agents} requests for llms.txt and agents.md in the last
  {windowDays} days, none for a product text page. Crawlers follow the list
  on their own schedule; nothing here is broken.`
- what: `llms.txt is the index; the product text pages are what it points
  to. A crawler that has read the index and not yet followed a link is
  normal in the first weeks. This measures requests to this app's own pages
  only, never visits to your themed storefront, which this app cannot see.`
- measured: `Requests for llms.txt` / n; `Requests for agents.md` / n;
  `Requests for product text pages` / `0`; `Window` / `{windowDays} days`;
  `Product text pages available` / the MirrorCache count from A.4.
- todo: `Nothing to change. If the product page count above is 0, run Fill
  catalogue so there are pages to follow.`
- paste: null.
- action: `View llms.txt` to the proxy URL on the primary domain (exists in
  the loader via `primaryDomain`; pass it through as `llmsUrl`).

**Rule 6: `stale-since-change`** (reworded from WordPress rule 6; section A.7)

WordPress counts products never touched by a bulk pass. Here every product is
processed on creation by the `products/create` webhook (`extract.server.ts:386`),
so "never processed" is not the gap. The gap is a dictionary or business
change after the last write pass.

- title: `Your {dictionary|business info} changed after the last pass`
- body: `Changed on {stamp date}; the last pass that wrote to products
  finished on {pass date}. Until a pass runs, products carry the values from
  before the change.`
- what: `The pass is what reads every description with the current
  dictionary and writes the details, the buyer questions and the plain text
  page. A change to the dictionary or the business answers reaches products
  only when a pass runs. llms.txt is built on request and already reflects
  the change.`
- measured: `Changed` / `{stamp date}` and `{reason}`; `Last write pass` /
  `{date}`; `Products read by it` / `{sampled}` from that pass's report when
  its status is done.
- todo: `Run Fill catalogue once. Values a person edited by hand are left
  alone, as always.`
- paste: null.
- action: `Open the dashboard` to `/app`.

**Rule 9: `non-crawler-tokens`** (exists)

- what: `Google-Extended and Applebot-Extended are lines in robots.txt that
  tell Google and Apple what they may do with pages their real crawlers
  already fetched. No request is ever made under either name. A request
  carrying one is something else borrowing it, usually a scanner.`
- measured: one row per token, label the token, value the count; `Window` /
  `{windowDays} days`.
- todo: `Nothing to change. These are counted on their own lines and never
  added to any total.`
- paste: null.
- action: none (`Nothing to change.`).

### D.3 Acceptance

| Input | Expected |
|---|---|
| every finding built by `buildFindings` on any input | `what`, `todo` non-empty; `measured.length >= 1`; every `measured` value is a string with no `{` or `}` |
| rule 1 with GPTBot 403 bot_protection, ClaudeBot 200 ok | `measured` contains `["GPTBot", "403, A bot-protection layer refused the request. ..."]` and `["ClaudeBot", "200, Reachable. The page was served in full."]` |
| rule 1b robots with `["GPTBot"]` | `paste` contains `User-agent: GPTBot` and `robots.default_groups`; `pasteLabel` is the robots label |
| rule 1b password | `paste === null` |
| rule 4 with only warranty missing | title `Warranty is not set`; measured rows `Delivery / set`, `Returns / set`, `Warranty / not set` |
| rule 5 with llms 12, agents 0, products 0 | measured `Requests for product text pages / 0` |
| rule 6 reason business | title contains `business info` |
| `?fix=policies-unset` on the screen | the modal is open on first render (assert in a route test that the loader data plus the search param yields an open Modal); `?fix=unknown` opens nothing |
| Copy pressed (dev store, by hand) | clipboard holds the paste text; the label reads Copied |

---

## E. Delivery as a composed sentence, typed fields, business type

### E.1 What changes and why

Today `BusinessInfo` (`summary.ts:32-47`) holds `deliveryTime` and
`deliveryCost` as free text. The consequences, all in shipped code:

- `mirror.server.ts:141` and `llms-txt.server.ts:71` publish `Varies by
  product, stated on each product page` when `deliveryVaries` is ticked.
  On a product page that states nothing, that sentence is false. This is
  the exact phrase WordPress 1.7.8 item E4 forbids, and the one place the
  app contradicts "nothing is invented".
- `ai-visibility.liquid:220` emits `transitTimeLabel`, which is not a
  property of `ShippingDeliveryTime` (schema.org page read 2 September
  2026: the properties are `businessDays`, `cutoffTime`, `handlingTime`,
  `transitTime`). Validators ignore the node.
- The FAQ answer (`summary.ts:212-221`) is `{deliveryTime}. Delivery costs
  {cost}.` with whatever the merchant typed; "Instant" or "fast" publishes
  as a delivery time.
- The Organization node (`liquid:104`) is always `Organization`; the
  merchant cannot say what kind of shop it is.

### E.2 The record

`BusinessInfo` becomes:

```ts
export type BusinessInfo = {
  /** Delivery time as two whole-day figures. 0 or absent means not set. */
  deliveryDaysFrom?: number;
  deliveryDaysTo?: number;
  /** Bulky and small items ship differently; the shop-wide figures are not
   * published, and a product's own stated delivery value is used when it
   * has one. */
  deliveryVaries?: boolean;
  /** Free-text destination for the sentence: "Romania", "the EU". */
  deliveryArea?: string;
  /** ISO 3166-1 alpha-2 code for structured data only, e.g. "RO". */
  deliveryCountry?: string;
  deliveryCostFree?: boolean;
  /** Decimal as a string, dot separator, e.g. "25" or "19.90". */
  deliveryCostAmount?: string;
  /** ISO 4217 code read from the shop at save time, e.g. "RON". */
  deliveryCurrency?: string;
  deliveryCostIsFrom?: boolean;
  returnDays?: number;
  warranty?: string;
  paymentMethods?: string;
  /** One of BUSINESS_TYPES, or absent. */
  businessType?: BusinessType;
  /** Kept only so an unparsed old value can be shown back in the field
   * help. Never published. */
  legacyDeliveryTime?: string;
  legacyDeliveryCost?: string;
};
```

`deliveryTime` and `deliveryCost` are removed from the type. Every reader
changes (section E.7).

### E.3 The composed sentence

New pure module `app/engine/delivery.ts`:

```ts
export function deliveryTimeText(from?: number, to?: number): string
export function deliveryCostText(b: BusinessInfo): string
export function deliverySentence(b: BusinessInfo | null, productDelivery?: string | null): string
export function deliveryDays(text: string): [number, number] | null
export const DELIVERY_LABELS: readonly string[]
export function productDeliveryValue(facts: Fact[]): string | null
```

Rules, ported from `class-avw-commerce.php:354-473` with one change noted:

- `deliveryTimeText`: both below 1 gives `""`; one missing copies the other;
  swapped figures are swapped back; equal gives `{n} working day` or
  `{n} working days`; different gives `{from}-{to} working days`.
- `deliveryCostText`: `deliveryCostFree` gives `free`; else amount missing
  gives `""`; else `{amount} {currency}`, with `from ` in front when
  `deliveryCostIsFrom`. Amount without a currency gives `""`: the WordPress
  sanitiser refuses to store an amount without a currency (`:279-284`) for
  the reason that "Delivery is 25." is not a sentence a buyer can use. Here
  the currency is read at save time, so this branch is defensive.
- `deliverySentence`:
  - time = `deliveryTimeText`; when `deliveryVaries`, time =
    `productDelivery ?? ""` and if that is empty return `""`.
  - area = `deliveryArea` trimmed; cost = `deliveryCostText`.
  - time and area and cost: `Delivery takes {time} to {area}, {cost}.`
  - time and area: `Delivery takes {time} to {area}.`
  - time and cost: `Delivery takes {time}, {cost}.`
  - time only: `Delivery takes {time}.`
  - area and cost: `Delivered to {area}, {cost}.`
  - area only: `Delivered to {area}.`
  - cost only: `Delivery is {cost}.`
  - nothing: `""`.
  - The phrase "stated on each product page" never appears.
  - Every output passes through `cleanOutput`.
- `deliveryDays(text)`: `(\d+)\s*-\s*(\d+)` gives the pair; else the first
  `\d+` gives `[n, n]`; else null. Used by the migration and by the schema
  node for a product's own value.
- `DELIVERY_LABELS`: `["delivery", "livrare", "shipping", "lieferung",
  "livraison", "envio", "spedizione"]`, matched case-insensitively against
  `fact.k` after `normalize()`. `productDeliveryValue` returns the first
  matching fact's `v` or null. Section 10.1 check: this is an inclusion
  list, so a label not on it loses nothing; a merchant whose dictionary
  calls the family "Termen" gets no per-product delivery sentence and the
  shop-wide one is not published either when varies is ticked, which is the
  safe direction. Adding a label is one string.

### E.4 The business types

`BUSINESS_TYPES` in `app/services/business-types.ts` (plain module, the
form renders it), 18 entries. Every one is a live schema.org type, read on
schema.org on 2 September 2026:

| Value | Label shown | schema.org parent |
|---|---|---|
| OnlineStore | Online store (no physical shop) | Organization > OnlineBusiness |
| Store | Shop (general) | LocalBusiness > Store |
| LocalBusiness | Local business (not a shop) | LocalBusiness |
| FurnitureStore | Furniture shop | LocalBusiness > Store |
| ClothingStore | Clothing shop | LocalBusiness > Store |
| JewelryStore | Jewellery shop | LocalBusiness > Store |
| ElectronicsStore | Electronics shop | LocalBusiness > Store |
| ComputerStore | Computer shop | LocalBusiness > Store |
| AutoPartsStore | Auto parts shop | LocalBusiness > Store, AutomotiveBusiness |
| HealthAndBeautyBusiness | Health and beauty | LocalBusiness |
| Florist | Florist | LocalBusiness > Store |
| HomeGoodsStore | Home goods shop | LocalBusiness > Store |
| SportingGoodsStore | Sporting goods shop | LocalBusiness > Store |
| ToyStore | Toy shop | LocalBusiness > Store |
| BookStore | Book shop | LocalBusiness > Store |
| GroceryStore | Grocery shop | LocalBusiness > Store |
| HardwareStore | Hardware shop | LocalBusiness > Store |
| PetStore | Pet shop | LocalBusiness > Store |

WordPress has 19. The nineteenth, `ProfessionalService`, is dropped: its
schema.org page reads that the type "was deprecated due to confusion with
Service". Publishing a deprecated type is publishing a claim schema.org has
withdrawn. Section G records this.

The select is grouped, because every type except `OnlineStore` descends
from `LocalBusiness`, which is also a `Place`: choosing "Furniture shop" for
a shop with no premises claims a physical location. Group one: `Online only`
with `OnlineStore`. Group two: `Has a physical shop or office` with the
other seventeen. Help text under the select: `Everything under "Has a
physical shop" tells assistants you have premises customers can visit. Pick
Online store if you do not.` Default: nothing selected, which publishes
`Organization` exactly as today.

The sanitiser accepts only a value in the list; anything else is stored as
absent. Never `Store` as a fallback: a fallback is a guess, and here the
absence has a meaning (`Organization`) that is always true.

### E.5 The form (`app.business.tsx`)

Delivery card becomes:

- `Delivery time, from` and `to` (two `TextField type="number"`, min 0, max
  365, `suffix="days"`), help: `Whole days. "2" and "4" publishes as "2-4
  working days"; the same number twice publishes as "3 working days".`
  Disabled when varies is ticked. When the legacy string could not be
  parsed on migration, the help text ends: `You had written "{legacy}";
  enter it as days.`
- `Delivery time varies by product` checkbox, help: `Tick if bulky and
  small items ship differently. No shop-wide time is published. A product
  whose description states its own delivery time still gets that time.`
- `Delivered to` text, placeholder `Romania, or: the EU`, help: `Published
  in the delivery sentence exactly as written. Leave empty to say nothing
  about where.`
- `Delivery country code` text, 2 letters, prefilled from
  `shop { billingAddress { countryCodeV2 } }` on first save only, help: `Two
  letters, for structured data only: RO, DE, GB. Prefilled from your shop
  address; change it if you deliver elsewhere. Leave empty if you deliver to
  many countries.` Validation: `/^[A-Z]{2}$/` after uppercasing, else error
  `Country code must be two letters, like RO.`
- `Delivery is free` checkbox.
- `Delivery cost` `TextField type="number"`, `step 0.01`, disabled when free,
  `suffix={currency}` where the currency is read from `shop { currencyCode }`
  in the loader and stored on save. Help: `A number; the currency is your
  shop's. "25" publishes as "25 RON".` When the legacy string could not be
  parsed: `You had written "{legacy}"; enter it as a number, or tick free.`
- `This is a starting price` checkbox, unchanged.
- New card `Kind of business` with the grouped `Select` from E.4.

Under the form, a live preview line: `Published as: {deliverySentence}` or
`Published as: nothing yet about delivery.` computed in the component from
the current field values with the same pure function, so what the merchant
sees is what the engine will write. This is client-side React state, which
is fine on an admin screen; the storefront rule is about the blocks.

The action validates: days integers 0 to 365, `to >= from` after swap,
amount `^\d+(\.\d{1,2})?$` with a comma accepted and converted, country
code as above. On any error it returns `{ error }` and writes nothing.

Migration, at load and at save, never guessing (`class-avw-settings.php:242-287`
ported): if the stored record has `deliveryTime` and no `deliveryDaysFrom`,
parse with `deliveryDays` only when the text contains a day word
(`/\b(days?|zile?|zi|working)\b/i`); if it parses, fill the two figures;
if not, keep the original in `legacyDeliveryTime`. If it has `deliveryCost`
and neither `deliveryCostFree` nor `deliveryCostAmount`: `/\bfree\b|\bgratuit/i`
sets free; else a leading number sets the amount; else `legacyDeliveryCost`.
The migrated record is written back only when the merchant presses Save, so
loading the screen writes nothing.

### E.6 What publishes

| Surface | Today | After |
|---|---|---|
| FAQ answer (`summary.ts:212-221`) | `{time}. Delivery costs {cost}.` | `deliverySentence(b, productDeliveryValue(facts))`; the question is omitted when the sentence is `""` |
| Mirror "Buying it" (`mirror.server.ts:139-148`) | two rows, one false | one row `Delivery` / the sentence without its trailing full stop, or no row |
| llms.txt (`llms-txt.server.ts:70-78`) | two rows, one false | one row `- Delivery: {sentence}` or none. llms.txt has no product, so `productDelivery` is null and varies gives nothing |
| Liquid Offer (`liquid:217-222`) | `transitTimeLabel` | `shippingDetails` only when all three exist: days (shop-wide, or the product's own via a new `delivery_days` metafield written by the pass as `[from, to]` when varies is on and the product's value parses), a cost (free gives `shippingRate: { "@type": "MonetaryAmount", "value": 0, "currency": cur }`, else the amount), and `deliveryCountry`. Node: `{"@type": "OfferShippingDetails", "shippingRate": {...}, "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "RO"}, "deliveryTime": {"@type": "ShippingDeliveryTime", "transitTime": {"@type": "QuantitativeValue", "minValue": 2, "maxValue": 4, "unitCode": "DAY"}}}`. Any of the three missing: no node at all. `unitCode` `DAY` is the UN/CEFACT code; schema.org's page says `d`; Google's own documentation uses `DAY`. Use `DAY`. |
| Liquid Organization (`liquid:100-119`) | emitted only with profiles, always `Organization` | emitted when profiles exist or `businessType` is set. Full node: `@type` = `businessType` or `Organization`. Extend by `@id`: add `"@type": businessType` only when set (JSON-LD readers union the types with the theme's `Organization`, and every type here is a subtype of it) |
| `app.seo.tsx:325 hasDeliveryTime` | reads `deliveryTime` | `deliveryTimeText(from, to) !== ""` |
| `app._index.tsx:165-166` | reads `deliveryTime`, `deliveryCost` | reads the typed fields via one helper `policiesSet(b)` shared with finding 4 |
| `summary.ts` seat/price questions | unchanged | unchanged |

The `delivery_days` product metafield: `$app` namespace, key `delivery_days`,
type `json`, value `[from, to]`, written by `capsuleFields`
(`extract.server.ts:344`) only when `deliveryVaries` is on and
`productDeliveryValue` parses; withdrawn (same withdrawal branch as every
auto value) when it no longer does. It is an auto value under `state` like
every other, so a human-edited one is never overwritten. Liquid reads it
as `product.metafields['$app'].delivery_days.value`.

### E.7 Acceptance

| Input | Expected |
|---|---|
| `deliveryTimeText(2, 4)` | `2-4 working days` |
| `deliveryTimeText(3, 3)` | `3 working days` |
| `deliveryTimeText(1, 0)` | `1 working day` |
| `deliveryTimeText(4, 2)` | `2-4 working days` |
| `deliveryTimeText(0, 0)` | `""` |
| `deliveryCostText({deliveryCostFree: true})` | `free` |
| `deliveryCostText({deliveryCostAmount: "25", deliveryCurrency: "RON", deliveryCostIsFrom: true})` | `from 25 RON` |
| `deliveryCostText({deliveryCostAmount: "25"})` | `""` |
| sentence, all three | `Delivery takes 2-4 working days to Romania, free.` |
| sentence, time only | `Delivery takes 2-4 working days.` |
| sentence, area and cost | `Delivered to the EU, from 25 RON.` |
| sentence, cost only | `Delivery is free.` |
| sentence, varies, product value `"3-5 zile"` | `Delivery takes 3-5 zile.` (the product's own words, unchanged) |
| sentence, varies, no product value | `""` and `buildQuestions` emits no delivery question |
| sentence, nothing set | `""` |
| any output | never contains `stated on each product page` (assert with a regex over every branch) |
| `deliveryDays("2-4 zile")` | `[2, 4]`; `"up to 5 working days"` gives `[5, 5]`; `"instant"` gives null |
| migration of `{deliveryTime: "2-4 working days"}` | `{deliveryDaysFrom: 2, deliveryDaysTo: 4}` |
| migration of `{deliveryTime: "Instant"}` | `{legacyDeliveryTime: "Instant"}`, days absent; the form's help text shows `You had written "Instant"` |
| migration of `{deliveryCost: "Free over 500"}` | `deliveryCostFree: true` |
| migration of `{deliveryCost: "25 RON"}` | `deliveryCostAmount: "25"`; currency from the shop, not from the string |
| sanitiser `businessType: "SuperStore"` | absent |
| sanitiser `businessType: "ProfessionalService"` | absent (not in the list) |
| sanitiser `deliveryCountry: "ro"` | `"RO"`; `"Romania"` gives the error, nothing written |
| mirror with varies on and no product value | no `Delivery` row in Buying it |
| Liquid, days 2-4, free, country RO | the node above, exactly; validated once on the dev store with Google's Rich Results Test (by hand, recorded in the CHANGELOG) |
| Liquid, days set, no country | no `shippingDetails` key |
| Liquid, `businessType: "FurnitureStore"`, no profiles, no theme org id | one Organization script with `"@type": "FurnitureStore"`, name and url |
| Liquid, no type, no profiles | no Organization script (as today) |
| the three WordPress fixtures (`fixtures.test.ts`) | untouched and green: they do not read business info |

---

## F. Cutting `checkCitationReadiness`

### F.1 Why

`citation.ts:99` scores the title against words drawn from questions that
were generated from the same title (`summary.ts:147`, `:157`, `:166`, and so
on: every question template embeds `input.title`). AUDIT-MODULE section 2.9
ran it on real products: a 160-character keyword title scores `good`, and
because interrogatives are not stopwords, a short honest title cannot.
WordPress 1.7.8 item E7 removed its equivalent for the same reason. A
verdict wrong in both directions is worse than none.

`isDescriptiveHandle` (`citation.ts:57-70`) has a real signal (a bare number
or an opaque identifier as a handle) and stays.

### F.2 Every call site and test

| Where | Change |
|---|---|
| `app/engine/citation.ts` | delete `checkCitationReadiness`, `CitationCheck`, `CitationVerdict`, `distinctWords`, `overlapScore`, the `STOPWORDS` constant and the `normalize`, `stopwordSet`, `QA` imports; keep `isDescriptiveHandle`. Replace the file's header comment (`:1-12`) with: the 1.4-million-prompt study rationale is gone with the check; this file holds the handle test only. |
| `app/engine/index.ts:60-64` | export only `isDescriptiveHandle` |
| `app/routes/app.products.$id.tsx:22`, `:27` | drop the two imports |
| `:186-196` | delete the `summaryOpening` and `citation` computation |
| `:245` | drop `citation` from the loader return; `:564`, `:575` from the component's typing |
| `:789-837` | replace the Readability card (section F.3) |
| `scripts/audit-engine-run.ts:5`, `:55` | drop the import and the `citation:` field from the sample row |
| `app/engine/__tests__/citation.test.ts:4-98` | delete the `checkCitationReadiness` describe block; keep `isDescriptiveHandle` (`:100-120`) |
| `_shopify/EXPERIENCE-PRD.md:124-125` and `:146-147` | append a dated note that the citation verdict was removed on this date and why; the two bullets stay as history |
| `_shopify/CHANGELOG.md` | under Unreleased: removed, with the reason and the audit reference |

### F.3 What replaces it on screen

The card at `app.products.$id.tsx:789-837` is retitled `Web address` (the
audit's rename list, section 5, asked for "Title wording"; with the title
check gone the only remaining content is the handle) and shows:

- Handle descriptive: `The web address ends in "{handle}", which reads as
  words. Nothing to change.`
- Handle not descriptive: the existing sentence at `:831` unchanged: `The
  URL handle ("{handle}") reads as an identifier rather than natural
  language. Changing it now would break every existing link to this product
  ... Worth considering when naming new products.`
- No method line about a study. The unattributed 1.4 million figure
  (audit 2.13) goes with the check.

Acceptance:

| Input | Expected |
|---|---|
| `grep -r checkCitationReadiness app scripts` | no matches |
| product with handle `solid-oak-table` | the "reads as words" sentence |
| product with handle `142857` | the identifier sentence |
| `citation.test.ts` | five tests, all on `isDescriptiveHandle`, green |
| `npm run typecheck` | clean, including `scripts/audit-engine-run.ts` |

---

## I. Withdrawal: a product that leaves the published state loses its public pages

### I.1 The bug, verified against the code on 2 September 2026

What a shop owner would say if they found it: "I took that product off the
store in June and ChatGPT is still quoting a page for it."

One table is the whole public set. The proxy serves any `MirrorCache` row by
handle (`proxy.$.tsx:147-158`), and llms.txt and agents.md list every row
the shop has (`llms-txt.server.ts:142-146`). A row that should not exist is
therefore two leaks at once: a product text page, and an index entry
pointing at it. Nothing on the request path checks the product's state,
by design (no Admin API on the request path, PRD section 5.2), so the row
has to be removed at the moment the state changes, or by a later sweep.

What removes a row today, read in full:

| Path | Where | Removes | Runs when |
|---|---|---|---|
| `products/delete` webhook | `webhooks.products.delete.tsx:20-24` | rows with this `productId` | every shop, if the webhook arrives |
| `dropStaleMirror` | `extract.server.ts:162-197`, called at `:404` | the row for this `productId` when the product is no longer active and published, or when its handle changed | only inside `extractOneProduct`, which only runs from the `extract_product` task, which returns at `tasks.ts:145-150` on a shop without paid access, before this line is reached |
| `sweep_missing` orphan cleanup | `tasks.ts:396-399` | rows with `productId: null` whose handle is not in the catalogue | weekly, paid shops only (`tasks.ts:377`) |
| bulk pass | `catalogue.server.ts:39` filters to `status:active AND published_status:published` | nothing; it never creates an ineligible row (correct) | on demand |

The holes, each with a concrete case:

1. **Paid shop, `products/update` lost.** The merchant sets a product to
   draft during a deploy window, an outage, or a Shopify delivery failure.
   The row has a `productId`, so the sweep's `productId: null` clause
   never matches it (`tasks.ts:398`). `dropStaleMirror` runs only on that
   product's next update, and a product taken off sale is often never
   edited again. The page and the llms.txt entry serve indefinitely.
   `poll_changes` (`tasks.ts:287-354`) would catch it within fifteen minutes
   if the unpublish moved `updatedAt`, but only on a paid shop, and only if
   the poll itself did not fail that window. The brief's reading of this
   case is correct.
2. **Any shop without paid access, webhook delivered.** This is the larger
   hole and it is not a lost webhook. The free tier processes three
   merchant-chosen products and writes their mirror rows. When one of them
   is unpublished, `products/update` arrives, `extract_product` is queued,
   and `mayProcessAutomaticallyCached` returns false (`billing.server.ts:296-303`:
   plan `none`, not comped), so the task returns before `extractOneProduct`
   and `dropStaleMirror` never runs. The same applies to every row a
   lapsed shop wrote while it was paid: FREE-TIER-SPEC says nothing is
   taken away, and that is right for metafields, but a public page for a
   product the store no longer sells is not a benefit kept, it is a claim
   that has become false. `poll_changes` and `sweep_missing` skip these
   shops too (`tasks.ts:309`, `:377`). On such a shop the only thing that
   ever removes a row is `products/delete`.
3. **Renamed product, webhook lost.** The old-handle row keeps serving
   (proxy answers 200 with a canonical `Link` to `/products/<old-handle>`,
   which Shopify redirects only if the merchant set a URL redirect). The
   sweep does not delete it for the same `productId: null` reason. A new
   row for the new handle appears only on the next update or pass.
4. **Deleted product, `products/delete` lost.** Same as case 1: the row has
   a `productId`, so the weekly cleanup never touches it.

Checked and not a hole: the bulk read filter (`catalogue.server.ts:39`); the
`products/delete` handler; `dropStaleMirror` itself, whose logic is right
whenever it is reached; the rename case when the job runs (`:194` compares
handles and deletes).

### I.2 The rule

**Withdrawal is never gated.** The entitlement gate exists so a shop
without paid access does not get its catalogue processed for free
(FREE-TIER-SPEC section 3, `tasks.ts:125-137`). Deleting this app's own
`MirrorCache` row for a product the merchant hid is not processing: it
writes nothing to Shopify, costs no pass, and is the minimum "nothing is
invented" requires. The gate stays exactly where it is for every write to
Shopify. It moves off the one branch that only deletes our row.

### I.3 Changes

**1. `fetchAllProducts` reports whether the download was complete.**

`POLL_BULK` (`catalogue.server.ts:24-30`) adds `rootObjectCount`. Both
counts are already on `BulkOperation`, read on shopify.dev on 2 September
2026: `objectCount` "counts both products and variants" (every JSONL line);
`rootObjectCount` "only counts products" (the root of the query). Both are
`UnsignedInt64`, which arrives as a string and is parsed with `Number()`.

The function returns a record instead of a bare array:

```ts
export type CatalogueRead = {
  products: ProductInput[];
  /** True only when both counts below match what was parsed. */
  complete: boolean;
  expected: { root: number; objects: number };  // from the bulk operation
  read: { root: number; objects: number };      // products parsed, non-empty lines parsed
};
export async function fetchAllProducts(graphql: GraphqlFn, query?: string): Promise<CatalogueRead>
```

`complete` is `expected.root === read.root && expected.objects === read.objects`.

> **Amendment, 3 September 2026, approved by Marius the same day.** `complete`
> is `expected.root === read.root` only. The object count does not vote.
> Reason: the only decision `complete` protects is a delete, and a delete is
> made from the set of product handles; a short download always shows as fewer
> root products parsed than `rootObjectCount` announced. `objectCount` is a
> different measure - Shopify counts child rows, this parser counts non-empty
> JSONL lines - and if the two definitions ever differ by one, requiring both
> would make `complete` false on every shop and the withdrawal inert while
> appearing to ship. The object comparison is kept as `objectsMatch: boolean`
> on `CatalogueRead`, written into the JobRun report and the log line, and read
> by nobody as a veto. The type is therefore
> `{ products, complete, objectsMatch, expected, read }`. Approving this
> amendment accepts that a download truncated in a way that keeps the root
> count intact (none is known) would not be caught by this flag; the
> eligible-set floor in `reconcileMirrors` (added the same day, see I.3 change
> 3) is the second guard.

The optional `query` argument is section J.4's filter; absent, today's
string. Every caller (`extract.server.ts:269`, `tasks.ts:386`, `:477`,
`seo-bulk.server.ts:37`) reads `.products`. Only the sweep and the
reconciliation below read `complete`; the pass keeps writing on an
incomplete read as it does today, because a write is idempotent and a
missed product is caught later, whereas a delete is not. `runBulkExtract`
records `complete` and the two count pairs in the `DryRunReport` so the
Report can say when a pass was short (`{read.root} of {expected.root}
products downloaded`), and that is the whole of audit item 6.9 on the pass
side.

**2. The bulk query carries `status`.** `PRODUCTS_QUERY` adds `status` to
the product node so `ProductInput.status` is set on both fetch paths. The
`status === undefined` branch of `isEligibleForMirror`
(`facts.server.ts:63-66`) exists only because the bulk path left it unset;
with the field present the special case goes, and a product's eligibility
is decided from its fields on every path. Section J.2 replaces the
function.

**3. One reconciliation, three callers.** New function in
`app/services/mirror-reconcile.server.ts`:

```ts
export type Reconciliation = {
  skipped: boolean;            // true when the read was incomplete: nothing deleted
  expected: number; read: number;   // root counts, for the log and the JobRun report
  deleted: number;             // rows removed
  adopted: number;             // NULL-productId rows given their productId
  queued: number;              // eligible products with no row, sent to extract_product
};
export async function reconcileMirrors(
  shop: { id: string; domain: string },
  read: CatalogueRead,
  prefs: PublishPrefs,          // section J.2
  addJob: (productGid: string) => Promise<void>,
): Promise<Reconciliation>
```

Steps, in order:

- If `!read.complete`: return `{ skipped: true, deleted: 0, ... }` and log
  `reconcile {domain}: bulk download short ({read.root} of {expected.root}
  products, {read.objects} of {expected.objects} objects), nothing deleted`.
  A truncated download would otherwise empty the mirror, which is the
  audit's 6.9 case; skipping costs one week.
- `eligible` = the products for which `eligibility(product, prefs)` is
  `"eligible"` (section J.2). `eligibleByHandle` and `eligibleById` are
  built from it.
- Adopt: for every row with `productId: null` whose handle is in
  `eligibleByHandle`, set `productId`. This is `dropStaleMirror`'s adoption
  (`extract.server.ts:181-191`) done in bulk, so the A.4 count
  (`productId: { not: null }`) stops undercounting old rows.
- Delete: `db.mirrorCache.deleteMany({ where: { shopId, handle: { notIn: [...eligibleByHandle.keys()] } } })`.
  No `productId` clause. A row is kept only because a product that is
  eligible right now has that handle. This covers unpublished, drafted,
  archived, deleted, renamed (old handle), excluded by a section J toggle,
  and rows from before the `productId` column, in one statement.
- Queue: for every eligible product with no row for its handle, call
  `addJob(product.id)` with the sweep's job key `extract:{id}`, so a
  renamed product whose webhook was lost gets its new-handle page, and a
  product newly eligible after a toggle change gets its first page.
  `extract_product` is gated as today, so on a shop without paid access
  this queue is a no-op; that is correct, because adding a page is
  processing.
- An empty catalogue is not a special case: `expected.root === 0`,
  `read.root === 0`, `complete` true, every row deleted, nothing queued.
  A shop that legitimately has no published product has no pages, and
  llms.txt renders its existing `Nothing processed yet.` line
  (`llms-txt.server.ts:98`).

Callers:

- `sweep_missing` replaces `tasks.ts:388-402` with one call, passing the
  `CatalogueRead` it already has and `helpers.addJob`. The "missing
  attributes" half (`:404-425`) is unchanged.
- `runBulkExtract`, after the final flush and before `pingProducts`
  (`extract.server.ts:371-381`), not on dry runs: the pass has the read in
  hand, so a merchant who presses Fill catalogue gets the reconciliation
  immediately rather than next Monday. Its result goes on the
  `DryRunReport` as `reconciled: Reconciliation`.
- The section J.6 job, when a toggle changes.

**4. The webhook path withdraws on every shop.** In `extract_product`
(`tasks.ts:139-157`), the gate becomes:

```ts
if (!(await mayProcessAutomaticallyCached(shop))) {
  await withdrawIfIneligible(shopId, productGid);   // new, extract.server.ts
  helpers.logger.info(`extract_product ${shop.domain}: skipped, no active subscription or comp`);
  return;
}
```

`withdrawIfIneligible` first checks `db.mirrorCache.findFirst({ where: { shopId, productId } })`.
No row: return, zero Admin API calls, which is the common case on a free
shop (at most three rows exist). Row present: one `fetchProduct` call,
`eligibility(product, prefs)`, and if the verdict is not `"eligible"` or the
handle differs, delete the row. It never writes a metafield, never renders
a mirror, never pings IndexNow. On a paid shop nothing changes: the
existing `extractOneProduct` path runs `dropStaleMirror` as today, now
reading `eligibility()` instead of `isEligibleForMirror()`.

The cost is one Admin call per `products/update` for a mirrored product on
a shop without paid access. That is the price of honouring the unpublish,
and it is bounded by the number of rows such a shop has.

**5. `dropStaleMirror` is unchanged in shape** and its comment at
`extract.server.ts:173-180` ("Rows whose product died before the migration
are caught by the weekly cleanup") becomes true for every row, not only the
NULL ones.

### I.4 What the merchant sees

Nothing new to press. On the A.4 Plain text pages row the count drops when a
page is withdrawn, and llms.txt lists the same count, because both read the
same table. The method line under the A.4 card gains one sentence: `A page
is withdrawn the moment its product stops being active and published, and
again by a weekly check that reads the whole catalogue; that check deletes
nothing when Shopify's download was short, and says so in the job log.`

The sweep's JobRun (it has none today; it logs only) is not added in this
pass. The reconciliation result is logged, and on the pass it is on the
`DryRunReport`, which the Report screen already reads.

### I.5 Other public surfaces, checked for the same leak

| Surface | Verdict | Evidence |
|---|---|---|
| llms.txt and agents.md | same leak, same fix: both are a projection of `MirrorCache` (`llms-txt.server.ts:142-146` selects every row for the shop). No second table to clean. | read 2 September 2026 |
| Collection comparison tables | a leak of a different shape. `fetchCollections` reads `collection.products(first: 60)` with no status or publication filter (`collections.server.ts:48-56`); the Admin API returns the collection's members regardless of status, and the table row carries the member's handle (`engine/collection.ts:153`), which `comparison-table.liquid:58-59` renders as a link to `/products/{handle}`. A draft, archived or unpublished member therefore appears in the table with a link to a 404, and an unlisted member appears in the one place Shopify says it does not (`ProductStatus.UNLISTED`: "doesn't show up in search, collections, or product recommendations", read 2 September 2026). This is written into the `table` metafield, so it persists until the next collections pass. Fix in section J.4: the collections query reads `status` and `onlineStoreUrl` per member, and `buildForCollection` drops members whose `eligibility()` verdict is not `"eligible"`, with the out-of-stock toggle ignored there (Shopify's own collection page lists sold-out products, and the table follows the page). To confirm on the dev store before building: set one member to draft, re-run collections, read the metafield. |
| Storefront block (`ai-visibility.liquid`) | no leak. It renders inside the product page, which Shopify serves only for a product that is active (or unlisted, by direct link) and published to the Online Store. A draft has no page to render into. | `ai-visibility.liquid:420` target `head` on the product template |
| Preferred Sources block | no leak, same reason. | `preferred-source.liquid:83` |
| IndexNow | no leak of a page, but a stale ping: `pingProducts` is called after a write (`extract.server.ts:381`, `:443`), never on a withdrawal. A withdrawn page is not re-announced; the engines find the 404 on their own. Announcing a removal is out of scope (IndexNow has no delete verb). | - |

### I.6 Acceptance

Every row below is pressed on the dev store, and every row ends the same
way: `GET https://<primary domain>/apps/ai-visibility/<handle>` answers
`404` and `GET .../llms.txt` does not contain the product's title. The
first two columns are the unit tests; the last is the by-hand check.

| Case | Unit test (Prisma and Admin stubs) | By hand |
|---|---|---|
| Unpublished, webhook delivered, paid shop | `extractOneProduct` on a product whose `fetchProduct` returns `status: "ACTIVE", onlineStoreUrl: null`: the row for its `productId` is deleted, no `cacheMirror` call | set a mirrored product's Online Store availability to unpublished; within a minute the two fetches |
| Unpublished, webhook delivered, shop without paid access | `extract_product` with `plan: "none"`, no comp, a row present: exactly one `product(id:)` call, row deleted, no `metafieldsSet`; with no row present: zero Admin calls | on a fresh dev store on the free tier, unpublish one of the three processed products; the two fetches |
| Unpublished, webhook lost | `reconcileMirrors` with a complete read that omits handle `x` and a row `{handle: "x", productId: "gid://shopify/Product/1"}`: deleted 1 | unpublish a product while the worker is stopped, drop the queued job, start the worker, run the sweep by hand (`npx tsx` the task); the two fetches |
| Renamed product | `reconcileMirrors` with the product present under handle `y` and a row under `x` with its id: deleted 1, queued 1 (the job key `extract:<id>`); then `extractOneProduct` writes a row for `y` | rename a product's handle with the worker stopped, run the sweep: old URL 404, new URL 200 after the queued job, llms.txt carries the new URL only |
| Truncated bulk download | `fetchAllProducts` stub with `rootObjectCount: "355"` and a body of 354 product lines: `complete === false`; `reconcileMirrors` returns `skipped: true, deleted: 0` and the rows are untouched; the log line names both figures | cannot be forced on Shopify; the unit test is the evidence, recorded as such in the CHANGELOG |
| Deleted outright | `products/delete` handler with `{id: 1}`: `deleteMany` by `gid://shopify/Product/1` (exists); and `reconcileMirrors` with the product absent from the read: deleted 1 | delete a mirrored product; the two fetches; then repeat with the worker stopped and the sweep run by hand |
| Legitimately empty catalogue | read with `expected.root: 0, read.root: 0, complete: true` and three rows: deleted 3, queued 0 | on a dev store with every product unpublished, run the sweep: A.4 reads `No product page yet`, llms.txt reads `Nothing processed yet.` |
| NULL-productId row whose product is live | read containing handle `x` with id 7, row `{handle: "x", productId: null}`: adopted 1, deleted 0 | - |
| Second render | after any of the above, the A.4 Plain text pages count equals `SELECT count(*) FROM "MirrorCache" WHERE "shopId" = ...` | read the card, run the count in Neon |

---

## J. Which product states are put in front of AI: the merchant's toggles

### J.1 Shopify's product model, as documented, not as assumed

Read on shopify.dev on 2 September 2026, API version 2026-07, which is the
version this app runs (`shopify.app.toml:14`, `shopify.server.ts:12`):

- `ProductStatus` has **four** values, not three: `ACTIVE`, `DRAFT`,
  `ARCHIVED`, and `UNLISTED`. `UNLISTED`: "The product is active but you
  need a direct link to view it. The product doesn't show up in search,
  collections, or product recommendations. It will be returned in
  Storefront API and Liquid only when referenced individually by handle,
  id, or metafield reference. This status is only visible from 2025-10 and
  up, is translated to active in older versions."
  (shopify.dev/docs/api/admin-graphql/latest/enums/ProductStatus)
- The `products` query filter `status` takes `active` (default),
  `archived`, `draft`, `unlisted` as separate values, so this app's
  `status:active` excludes unlisted products today, silently.
  (shopify.dev/docs/api/admin-graphql/latest/queries/products, filter list)
- Publication is per sales channel. `published_status:published` (alias
  `visible`) "Returns resources that are published to the online store";
  `unpublished` the opposite; `unavailable` "not published to any
  channel". So `published_status:published` is Online Store specific, and
  the comment at `catalogue.server.ts:35-36` ("not published to any sales
  channel") describes a different filter (`unavailable`); the code is
  right, the comment is not.
- `Product.onlineStoreUrl`: "If null, then the product isn't published to
  the online store sales channel."
  (shopify.dev/docs/api/admin-graphql/latest/objects/Product)
- `Product.totalInventory`: "The quantity of inventory that's in stock";
  `Product.tracksInventory`: whether tracking is enabled;
  `ProductVariant.availableForSale`: "Whether the product variant is
  available for sale"; `ProductVariant.inventoryPolicy`: "Whether
  customers are allowed to place an order for the product variant when
  it's out of stock".
  (shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant)

So the brief's model needs two corrections:

1. **There is a "visible but hidden from search" state.** It is
   `UNLISTED`, it is exactly WooCommerce's catalog visibility "hidden",
   and it has existed in the API since 2025-10. It gets a toggle.
2. **"Out of stock" is not what this app measures today.** `available` is
   `totalInventory > 0` (`catalogue.server.ts:177`, `:238`). A product
   with inventory tracking off, or with a variant whose policy is to
   continue selling at zero, reads "out of stock" in the mirror while
   Shopify sells it. A toggle built on that figure would withdraw pages for
   made-to-order and dropshipped products. The method changes (J.2) before
   the toggle exists.

Not a state and not a toggle: a product published to the Online Store with
a future publish date (scheduled). Its `onlineStoreUrl` and
`published_status` behaviour was not verified today; section "could not
check" in the return message, and one acceptance row below reads it on the
dev store. Also not in scope: publication per market or per B2B company
location (`publishedInContext`), which this app does not read.

### J.2 One decision function

New pure module `app/services/eligibility.ts` (no `.server` suffix: the A.4
card renders the refusal sentences from the same constants). It replaces
`isEligibleForMirror` (`facts.server.ts:63-66`), which is deleted with its
test file `facts.server.eligibility.test.ts` rewritten against the new
function.

```ts
export type PublishPrefs = {
  /** Default true. */
  includeOutOfStock: boolean;
  /** Default false. */
  includeUnlisted: boolean;
};
export const DEFAULT_PREFS: PublishPrefs = { includeOutOfStock: true, includeUnlisted: false };

export type Verdict =
  | "eligible"
  | "not-active"         // DRAFT or ARCHIVED
  | "not-on-online-store" // ACTIVE or UNLISTED but onlineStoreUrl null
  | "unlisted-excluded"  // UNLISTED and includeUnlisted false
  | "out-of-stock-excluded"; // available === false and includeOutOfStock false

export function eligibility(
  p: { status?: string; onlineStoreUrl?: string | null; available?: boolean },
  prefs: PublishPrefs,
): Verdict
```

Order of checks is the order of the union, and the first that applies is
the verdict. `status` undefined is no longer treated as eligible: after
section I.3 change 2 both fetch paths carry it, and an undefined status
returns `"not-active"`, the safe direction (a page not created can be
created by the next pass; a page created for a draft is a false claim
until someone notices).

`available` becomes `variants.some((v) => v.availableForSale)` on both
fetch paths, with `availableForSale` added to the variant node in
`PRODUCTS_QUERY` and `SINGLE_PRODUCT`. When the product has no variant rows
in hand (the single-product path caps at 100 variants and a product cannot
have zero), `available` is `undefined` and the mirror prints no
availability line, as today (`mirror.server.ts:79-81`). This is the same
value the mirror's `availability:` line, the summary's "currently out of
stock" clause (`summary.ts:120`, `:193`) and the toggle all read, so the
three cannot disagree. Its meaning, stated on the card: "out of stock means
no variant can be ordered right now, which is Shopify's own rule and
includes products that continue selling at zero."

### J.3 The two toggles, their sentences, and their defaults

Both live on the A.4 card under the Plain text pages row, as two Polaris
`Checkbox` controls in one form, `method="post"`, `intent=publish_prefs`.
Each checkbox has its effect sentence as its `helpText`, so the effect is
beside the control and not in a tooltip.

**Toggle 1.** Label: `Include products that are out of stock`. Default:
on. Help text: `Sold-out products keep their text page and their llms.txt
entry. The page states availability as of its last update, so an
assistant reading it is told the product is out of stock; it is not hidden.
Turn this off to withdraw those pages until stock returns.`

The last sentence is literal: with the toggle off, a product that comes
back into stock gets its page again on its next update or pass, because
`eligibility()` returns `"eligible"` again and `extractOneProduct` writes
the row.

**Toggle 2.** Label: `Include unlisted products`. Default: off. Help text:
`Unlisted products are ones you hid from search, collections and
recommendations in Shopify; only a direct link reaches them. Off keeps them
out of the text pages and llms.txt as well. On gives them a text page and
an llms.txt entry, which makes them findable by assistants. Off also means
they are not read by the catalogue pass.`

Why the defaults sit where they do: out of stock is a public, temporary
state the store itself shows, so hiding it would be this app deciding
something the merchant did not; unlisted is the merchant's own decision to
hide, so publishing it by default would undo that decision.

Under both, the method line: `Both apply to the text pages and to llms.txt
and agents.md, which list the same pages. Structured data on the product
page follows the page: it renders wherever Shopify renders the product.
Changing either setting withdraws pages that no longer qualify within the
next minute and adds newly qualifying pages after the next catalogue pass.`

### J.4 What each toggle writes, and which read paths consume it

Writes: two `Setting` rows, `key: "publish_out_of_stock"` and
`key: "publish_unlisted"`, value `"true"` or `"false"`. An absent row means
the default. `prefsFor(shopId): Promise<PublishPrefs>` in
`eligibility.server.ts` (this half needs the database, so it is a `.server`
module) reads both in one `findMany`.

The action in `app.report.tsx` calls `hasPaidAccess` exactly like the
IndexNow switch (A.4), upserts the two rows only when a value changed
(same principle as the `unchanged` writers), and when either changed,
enqueues the section J.6 job. It returns `{ prefs }` and the screen
re-renders from the loader.

Read paths, every one:

| Reader | Today | After |
|---|---|---|
| `PRODUCTS_QUERY` (`catalogue.server.ts:37-39`) | `status:active AND published_status:published`, fixed | `catalogueQuery(prefs)` in `eligibility.ts`: `status:active,unlisted` when `includeUnlisted`, else `status:active`; always `AND published_status:published`. Out of stock is never in the query: the bulk read must return sold-out products so their rows can be withdrawn when the toggle is off, and so their metafields keep being maintained either way |
| `app.report.tsx:76` (A.3 candidates and `?example=`) | same fixed string | `catalogueQuery(prefs)`; the refused-state sentence in A.3 gains "or unlisted while unlisted products are excluded" |
| `extractOneProduct` (`extract.server.ts:403`) | `isEligibleForMirror` | `eligibility(product, await prefsFor(shopId)) === "eligible"`; the metafield write is unchanged and happens on every verdict, as today for drafts (`:397-402`), because the product's own page still renders them |
| `runBulkExtract` (`extract.server.ts:358-362`) | writes a mirror for every product read, relying on the query filter | `cacheMirror` only when the verdict is `"eligible"`; otherwise no row, and the reconciliation at the end removes an old one. Metafields written as today |
| `reconcileMirrors` (section I.3) | - | `eligible` set built with the same function and prefs |
| `withdrawIfIneligible` (section I.3) | - | same |
| `sweep_missing` "missing attributes" half | reads the fixed query | reads `catalogueQuery(prefs)` through the same `fetchAllProducts` call |
| `fetchCollections` (`collections.server.ts:48-56`) | members with no state read | member node adds `status onlineStoreUrl`; `buildForCollection` keeps members whose verdict with `{ ...prefs, includeOutOfStock: true }` is `"eligible"`. Out of stock is forced on for the table because Shopify's own collection page lists sold-out members and the table follows the page (I.5). `productsCount` stays the real count |
| `bulk_alt_text`, `seo_queue_build` | the fixed query | `catalogueQuery(prefs)`: alt text and SEO fields for an unlisted product are written only when the merchant included unlisted products, which is consistent with "not read by the catalogue pass" in the help text |
| `llms-txt.server.ts`, `proxy.$.tsx` | read `MirrorCache` | unchanged: they are projections of the table the writers above maintain, and adding a state check there would put an Admin call on the request path |

### J.5 What is refused, on the card

Rendered once under the toggles, as plain text, so nobody asks for the
third toggle:

`Never given a page: drafts, archived products, and products that are
active but not published to the Online Store. None of them has a public
address, so a text page for them would point at nothing.`

Reason, for the record: `onlineStoreUrl` is null for all three (Product
object documentation, J.1), and the mirror's `url:` line, its canonical
`Link` header (`proxy.$.tsx:169-171`) and its llms.txt entry are all built
from that address. A page whose canonical is a 404 is worse than no page.
This is a refusal with a reason, not a toggle set to off.

### J.6 Turning a toggle off removes pages that are already published

The mechanism is section I.3's `reconcileMirrors`, run as a job so the
merchant's POST returns at once and the screen can show the second
render honestly:

- The action enqueues `reconcile_mirrors` with a `JobRun`
  `kind: "reconcile"`, so the dashboard's existing "a job is running"
  handling (`JobRun` rows are the source of truth, CLAUDE.md) applies.
- The task: entitlement check as in `bulk_collections` (refused status
  with a reason when access is gone between POST and run); `fetchAllProducts(graphql, catalogueQuery(prefs))`;
  `reconcileMirrors(shop, read, prefs, addJob)`; report `Reconciliation`
  on the JobRun.
- On the A.4 card, while the job runs: `Applying your setting: pages that
  no longer qualify are being withdrawn.`; when done: `{deleted} pages
  withdrawn, {queued} products queued for a page, on {date}.`; when
  skipped: `Shopify's catalogue download was short ({read} of {expected}
  products), so nothing was withdrawn. It will be tried again on the next
  pass or the weekly check.` The three sentences come from the JobRun
  report, never from local state.
- Turning a toggle on adds nothing by itself: `reconcileMirrors` queues
  `extract_product` for every eligible product without a row, and those
  jobs write the pages. The help text says "after the next catalogue pass",
  which is the conservative phrasing; the queued jobs usually land first.

### J.7 Acceptance

| Input | Expected |
|---|---|
| `eligibility({status: "ACTIVE", onlineStoreUrl: "https://x/products/a", available: true}, DEFAULT_PREFS)` | `"eligible"` |
| `status: "DRAFT"`, any prefs | `"not-active"` |
| `status: "ARCHIVED"`, any prefs | `"not-active"` |
| `status: "ACTIVE", onlineStoreUrl: null` | `"not-on-online-store"`, with both toggles in every combination (four cases) |
| `status: "UNLISTED", onlineStoreUrl: "..."`, `includeUnlisted: false` | `"unlisted-excluded"` |
| `status: "UNLISTED", onlineStoreUrl: "..."`, `includeUnlisted: true` | `"eligible"` |
| `status: "UNLISTED", onlineStoreUrl: null`, `includeUnlisted: true` | `"not-on-online-store"` (unlisted never overrides publication) |
| `available: false`, `includeOutOfStock: false` | `"out-of-stock-excluded"` |
| `available: false`, `includeOutOfStock: true` | `"eligible"` |
| `available: undefined`, `includeOutOfStock: false` | `"eligible"` (unknown is not out of stock) |
| `status: undefined` | `"not-active"` |
| `catalogueQuery({includeUnlisted: false, ...})` | `status:active AND published_status:published` (the existing test at `facts.server.eligibility.test.ts:37-39` moves here and asserts this string) |
| `catalogueQuery({includeUnlisted: true, ...})` | `status:active,unlisted AND published_status:published` |
| bulk row with variants `[{availableForSale: false}, {availableForSale: true}]` | `available === true` |
| bulk row with variants all `availableForSale: false` | `available === false`; the mirror carries `availability: out of stock` |
| POST `intent=publish_prefs` from a shop without paid access | 200 with the subscription banner, no Setting row, no job |
| POST from a paid shop with unchanged values | no upsert, no job (assert with a counting Prisma stub) |
| POST from a paid shop turning out of stock off | rows written, one `reconcile_mirrors` job with a `JobRun` `kind: "reconcile"`; on the next render the checkbox is off and the "Applying your setting" sentence shows |
| `reconcile_mirrors` on a read with 5 products, 2 sold out, toggle off, 5 rows | deleted 2, the two handles are the sold-out ones; llms.txt lists 3 |
| the same, toggle back on | deleted 0, queued 2 with job keys `extract:<id>`; after the jobs, 5 rows and llms.txt lists 5 |
| unlisted toggle on, a product set to Unlisted on the dev store | the bulk read returns it (by hand: `products(query: "status:unlisted")` returns it and `status:active` does not; recorded in the CHANGELOG), the pass writes its row, its text page answers 200, its own product page still renders the app embed |
| unlisted toggle off, the same product | `withdrawIfIneligible` or `dropStaleMirror` deletes its row on the next `products/update`; the reconcile job deletes it immediately; llms.txt does not list it |
| a made-to-order product (inventory tracking off, quantity 0) on the dev store | `available === true`; with the out-of-stock toggle off its page stays; before this change it read `availability: out of stock` (record the before and after in the CHANGELOG as the reason for the method change) |
| a product scheduled to publish tomorrow, on the dev store | read `onlineStoreUrl` and `published_status:published` membership by hand today; whichever way it answers, the verdict follows `onlineStoreUrl`, and the result is written into J.1 so the next reader does not have to look |
| collection with one draft member and one unlisted member, toggles at default, collections pass run | the `table` metafield has no row for either; `productsCount` unchanged; the storefront table renders no link to a 404 |
| the A.4 card, any state | every number on the card has its denominator and the method line; the refusal sentence of J.5 is present (assert on the string `Never given a page`) |

---

## G. What was re-triaged, and the evidence

| Item | PORT-1.7.8 said | This document says | Evidence |
|---|---|---|---|
| Weighted 0-100 score | adopt, "one line in `readiness()`" | rejected; tier word attached to the existing ready fraction | `EXPERIENCE-PRD.md:117-118` ("We do not ship a 0-100 score"), `:124-125` ("never blended into one number"); `report-metrics.ts:220-236` shows "partly" spans 1 to 3 families, so 0.5 is a coefficient, not a measurement |
| Mirror-versus-llms.txt split | "Next, one table each" | Now, no table | `crawler-hits.server.ts:114-117` already selects `path` and `handle` for every row in the window; the split is a pure function over rows already in memory |
| Finding 8 (cache floor) | adopt as a finding | a permanent sentence in the crawler card's method line, not a finding | `proxy.$.tsx:102` sets `max-age=300` on every response, so the condition is always true on every shop; a finding that never clears is not a finding, it is a footnote |
| Finding 6 (never processed) | adopt, "comparing the pass's product set against the catalogue count" | reworded: dictionary or business changed after the last write pass | `extract.server.ts:386-387`: every created product is processed by the `products/create` webhook, so "never processed" is empty on a subscribed shop; what does go stale is a dictionary or business change, and nothing today records when either changed (`Setting` has no `updatedAt`, `schema.prisma:61-68`) |
| Item 13, global cache generation | adopt, invalidate every cached mirror | a change stamp and finding 6; the pass is the re-render | `mirror.server.ts:1-6` and `proxy.$.tsx:147-158`: the mirror is a stored body served as-is, not rendered on request, so invalidation would be a 404 until the next pass |
| Module cards with on/off | adopt | cards with state and one number; one module switch (IndexNow); two eligibility toggles (section J) | the app has no module switches (`Setting` keys enumerated on 2 September: dictionary, stopwords, business, shopInfo, seo_unlocked, storefront_password, indexnow_enabled); turning the mirror or llms.txt off needs a proxy gate and a shop metafield the Liquid reads, which is its own change. `indexnow.server.ts:152` `setEnabled` exists with no caller (audit 2.15). The toggles are different: they narrow the set of products that get a page, and the only mechanism they need (delete our own rows, queue our own jobs) already exists |
| Item 13, per-product cache invalidated on edit | "mostly exists" | exists on paid shops with a delivered webhook only; section I | `tasks.ts:145-150` returns before `dropStaleMirror` on a shop without paid access; `tasks.ts:397-399` cleans NULL-productId rows only, so a lost `products/update` leaves a page up for ever |
| XLSX export | adopt, "one library, no new service" | not in this pass | `xlsx` on npm is 0.18.5 with two high advisories (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS) and no fixed version on npm; fixed builds are only on the vendor's own CDN (osv.dev GHSA-4r6h-8v6p-xvw6, snyk, read 2 September 2026). `exceljs` is the alternative and is a large dependency for two sheets. The CSV already ships with a BOM (`report-metrics.ts:722-729`) and opens in Excel with Romanian text intact. Open decision 3 |
| DeepSeekBot | in every list today; PORT kept it | out of the registry; requests fall to "other" | no operator documentation exists (section B.4); the app's own purpose text says so (`crawler-info.ts:31-35`) |
| Business type whitelist of 19 | adopt in full | 18 | schema.org/ProfessionalService reads "deprecated due to confusion with Service" (read 2 September 2026) |
| Crawler check coverage | mostly shipped | 16 checked crawlers, up from 8 | `crawler-check.server.ts:13-28` versus the operator pages read today; ClaudeBot in particular is counted (`crawler-hits.server.ts:37`) and never checked |
| robots.txt snippet | adopt, "must not claim the merchant's robots.txt is wrong when it is not" | ships only inside finding 1b for `robots_disallow`; the snippet copies the `*` group's rules rather than emitting `Allow: /` | Shopify's default file read on the dev store today names no AI crawler; a bare `Allow: /` group would override the default disallows for that crawler |
| Finding 4 | "three null checks" | needs section E first: "delivery set" has no single truthful test on free text | `summary.ts:33-40`; "Instant" is a set field and not a delivery time |

Not re-triaged, and confirmed against the code: referrals cannot exist
(`proxy.$.tsx:7-11`); the verified donut, "verified x of y" and finding 7
stay blocked on `scripts/read-forwarding.ts`; sorting by sales stays refused
(`app.report.tsx:1057-1059` already says why on screen).

Two things noticed along the way, outside this pass, recorded so they are
not lost:

- Shopify's default robots.txt (read on the dev store today) carries a
  header pointing agents at `https://<shop>/agents.md` and at UCP/MCP
  endpoints. Whether Shopify now serves an `agents.md` at the domain root
  could not be checked because the dev store is password protected. If it
  does, this app's `/apps/ai-visibility/agents.md` is a second file with the
  same name, and the listing copy should say which is which. Check on a
  store without a password.
- `AUDIT-2026-09-02.md:60` says `app.business.tsx:42` has no entitlement
  check. The file read today has one at `:48-57`. The audit predates a fix;
  nothing to do, noted so the implementer does not add a second gate.

---

## H. Do not build in this pass

- Anything that needs a client IP: verification, the verified / unverified
  / unknown donut, "verified x of y", finding 7, IP-range fetching, reverse
  DNS. Blocked until `npx tsx scripts/read-forwarding.ts` has been run and
  read. The `rdns` and `rangesUrl` registry fields are data only; nothing
  reads them.
- Referrals by utm_source or Referer. Cannot exist here.
- The Monday digest email. No provider, no sending domain, no suppression
  list, no privacy-policy line.
- Sorting the weakest products by sales, or any read of orders, customers
  or payments.
- The 500 / 5000 chunking. The bulk operation is the documented way around
  the pagination it was built for.
- `ReportSnapshot`, the sparkline and the last-pass marker. Next pass, one
  table.
- Switches that turn the mirror, llms.txt, agents.md or the comparison tables
  off. The only module switch in this pass is IndexNow. Section J's two
  toggles are not module switches: with both at their defaults the app
  publishes exactly what it publishes today.
- A toggle for products that are active but not published to the Online
  Store, or for drafts or archived products. Section J.5 says why: no
  public URL, so a text page would point at nothing.
- A second free quantity or any other change to the free tier. Section I
  removes pages on free shops; it never adds one.
- XLSX export, and any new npm dependency.
- The weighted 0-100 score.
- Buyer questions generated from the merchant's own dictionary labels
  (AUDIT-MODULE 2.6). It is the largest piece of engine work in the module
  audit and it is not on the WordPress 1.7.8 list. PORT item 6's "Set once
  versus Per product" split waits on it.
- A `shippingDestination` built from Shopify shipping zones. That needs
  `read_shipping`, a scope the listing says the app does not ask for. The
  merchant types the country code.
- Any change to the storefront blocks beyond the Organization `@type`, the
  corrected `shippingDetails` node and the `delivery_days` metafield read,
  all in `ai-visibility.liquid`. No script, no fetch.
- Any change to the dashboard (`app._index.tsx`) beyond reading `CHECKED`
  and the `policiesSet` helper. The dashboard's ladder is Wave 2 of the
  audit and a separate change.
- Any JSON-LD change gated on `seo_unlocked`. Those branches are a separate
  decision (AUDIT-MODULE section 4).

## Definition of done

- `check.bat` green; every acceptance row above is a test or a recorded
  by-hand check on the dev store.
- Pressed on the dev store, second render recorded in the CHANGELOG entry:
  the IndexNow switch, the product picker, the `?fix=` modal, finding 6
  clearing after a pass, the business form round trip with a migrated
  record, the six withdrawal rows of section I.6 and the toggle rows of
  section J.7 (each one ends with a fetch of the proxy URL that must answer
  404, and a fetch of llms.txt that must not list the product).
- `grep` for `checkCitationReadiness`, `KNOWN_BOTS`, `AGENTS`,
  `NON_CRAWLER_TOKENS`, `CRAWLER_INFO`, `BOT_HINT`, `deliveryTime`,
  `deliveryCost`, `transitTimeLabel`, `stated on each product page`,
  `isEligibleForMirror`, `productId: null, handle: { notIn` across
  `app`, `worker`, `scripts`, `extensions`: no matches except in tests
  asserting absence and in CHANGELOG history.
- No string on any screen says "visits", "verified", "AI Mode", or a number
  without a denominator.
- `_shopify/CHANGELOG.md` updated under Unreleased, then
  `npx shopify app deploy` and an annotated tag, as CLAUDE.md requires for
  every delivery.
