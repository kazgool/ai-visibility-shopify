# Porting WordPress 1.7.8 to Shopify: what carries, what changes, what cannot exist

2 September 2026. Triage of the 1.7.8 feature list against what this app can
actually observe. Written before any code, because three items in the list
depend on data a Shopify app does not receive, and building them would mean
publishing a number we cannot stand behind.

## The three structural differences

Everything below follows from these. They are not opinions about effort.

**1. The WordPress plugin runs inside the merchant's site. This app does not.**
The plugin sees every storefront request: the visitor's address, the Referer,
the query string, whether a full-page cache answered. This app sees only
requests to its own app-proxy paths: the plain-text mirror, `llms.txt`,
`agents.md` and the IndexNow key file. Shopify serves the themed storefront
directly and never tells the app about it. `crawler-hits.server.ts:10-15`
already carries this as a comment, and it is the reason every string on the
Report screen says "requests to your text pages" and never "visits".

**2. The client IP may not survive Shopify's edge and Fly.** WordPress has
`REMOTE_ADDR`. Here the request crosses two proxies. `CrawlerHit.forwarding`
was added on 22 August precisely to find out, and has been collecting since.
Nobody has read it. `scripts/read-forwarding.ts` reads it and prints a verdict.
Everything about verification waits on that one answer.

**3. This app does not read orders.** By choice, stated on the Plan screen and
in the listing. `shopify.app.toml` requests `read_products, write_products,
read_themes` and nothing else.

---

## The list, item by item

### 1. Report tab

| 1.7.8 element | Shopify | Note |
|---|---|---|
| Readable score 0-100, complete / partial / thin | **shipped today** | `/app/report`, readability card. Threshold is 4 families, same as WP. Ours is a fraction with its denominator printed, not a weighted 0-100; the WP weighting (1 / 0.5 / 0) is a better single number and is worth adopting - one line in `readiness()`. |
| Tier poor / fair / good / strong | **adopt** | Cheap, and it gives the dial a word a merchant reads before the number. Thresholds must be stated on screen, not implied. |
| Sparkline 30 days from daily snapshots, up to 180 | **new table** | `ReportSnapshot`: one row per shop per day. Cannot be backfilled: history starts the day it ships. WP's 180-day depth is only reachable after 180 days here too. |
| Marker at the last bulk pass | **free once snapshots exist** | The JobRun date is already stored. |
| Donut, 7 days: verified / unverified / unknown | **blocked on difference 2** | If no client address arrives, this donut can only ever be 100 percent unknown, which is worse than not showing it. |
| How many requests reached the mirror or llms.txt | **shipped, partly** | `CrawlerHit.path` distinguishes them today; the Report groups by bot, not by path. One `groupBy` away, and it is the attribution sentence from the module audit: pages that did not exist before install. |
| Crawler matrix: robots allowed/blocked, live check, requests, verified x of y, owner | **mostly shipped** | Built today, minus "verified x of y" (difference 2) and minus the robots.txt allowed/blocked column, which needs the robots parse the crawler check already does at `crawler-check.server.ts:186` to be surfaced per row rather than folded into one cause. |
| Tokens marked "not a crawler" | **shipped today** | `NON_CRAWLER_TOKENS`, own row group, never in a total. |
| Collapsible robots.txt snippet with Copy | **adopt** | Small. Must not claim the merchant's robots.txt is wrong when it is not: on Shopify the file is `robots.txt.liquid` in the theme, and most shops have never touched it. |

### 2. Findings, eight rules

| WP rule | Shopify | Note |
|---|---|---|
| 1. Firewall refuses some crawlers while others get 200 | **shipped today** | Including the fix that `robots_disallow` and `password_page` are the merchant's own settings, not a firewall, and get their own instruction rather than a message to the host. |
| 2. Live check never run | **adopt** | One line; the data is there. |
| 3. N products with no facts | **shipped today** | |
| 4. Delivery / returns / warranty not set | **adopt** | `businessFor()` already holds them; the rule is three null checks. |
| 5. Crawlers visit but never requested the text version | **cannot be built as written** | "Visit" means the themed storefront, which this app never sees. What is knowable: a crawler requested the mirror for some products and not others, or requested `llms.txt` and no product page. That is a narrower and still useful rule, and it must be worded as what it measures. |
| 6. N products not processed by the bulk pass | **adopt** | Comparing the pass's product set against the catalogue count; both stored. |
| 7. N unverified requests | **blocked on difference 2** | |
| 8. Full-page cache on, so the counter is a floor | **adopt, and it is already true here** | The proxy sets `Cache-Control: public, max-age=300` (`proxy.$.tsx:102`), so Shopify's edge can answer a repeat request inside five minutes and the app never sees it. The module audit raised this as an open question; the honest move is to say it on screen rather than leave the number looking exact. |

### 3. "How to fix" modal per finding

**Adopt, in full.** What it is, what we measured with the raw values, what to
do, and a button to the screen that does it. This is the single highest-value
item on the list for this app, because the Report screen currently diagnoses
and then leaves the merchant to work out the fix. Rule 1 already carries a
paste-ready message; every other finding should too, or a link.

### 4. Dictionary bars: families and exact values

**Adopt the second half.** The family bars shipped today. The top-30 exact
values did not, and they are the thing that makes a merchant trust the
dictionary, because they see their own words. Cheap: the values are in the
pass already.

### 5. "What an assistant can now answer": best product vs weakest, with the published sentence, plus a product picker

**Adopt.** The before-and-after panel shipped today with one product chosen
automatically. The picker and the explicit best-versus-weakest pairing are
better: a merchant who can choose the product believes the panel.

### 6. Unanswered questions, "Set once" versus "Per product", score per category, "since last pass" strip

**Adopt, and it is overdue.** The module audit found that the buyer questions
are hard-wired to furniture labels in English, so on a non-furniture shop the
FAQ block is one price question. Fixing the questions to come from the
merchant's own dictionary labels, in their language, is the prerequisite for
this whole item; "Set once" versus "Per product" is exactly the right split
once the questions exist.

### 7. Modules: card per module with on/off and one real number; weakest products top 10

**Adopt the module cards. Change the sort on weakest products.**
Sorting by sales needs order data. Sort by families found, which is what
shipped today, and say so.

### 8. Export XLSX/CSV 11 columns, print to PDF, Monday digest email

CSV and print shipped today. **XLSX: adopt**, one library, no new service.
**Monday digest: not now.** It needs an email provider, a sending domain, a
suppression list and a GDPR line in the privacy policy. That is a service
dependency and a monthly bill for a feature no merchant has asked for yet.
Shopify can send it from a Flow if a merchant wants it. Revisit when a
merchant asks.

### 9. Build bounded: chunks of 500, ceiling 5000 most recently edited

**Not applicable in that shape.** WordPress pages through `WP_Query`. This app
uses a Shopify bulk operation, which returns the whole catalogue as one JSONL
download and is the documented way to avoid exactly the pagination WP is
capping. The equivalent risks here are different and both already known: the
`objectCount` reconciliation the module audit asked for, and the per-product
Admin call in `bulk_alt_text`. Fix those instead.

### 10. Verification by published IP ranges, refreshed daily with a 1 hour back-off, own CIDR matcher

**Correct approach, and better than reverse DNS alone.** OpenAI and Perplexity
publish JSON range files; a CIDR match is cheaper and faster than a DNS round
trip, and reverse DNS remains the fallback for Google and Bing, who publish
verification by rDNS rather than by list.

Blocked on difference 2. **Run `scripts/read-forwarding.ts` first.** If no
public client address arrives, none of this can be built here at any price,
and the honest response is the opposite move: drop `CrawlerHit.ip` and
`CrawlerHit.forwarding` as personal data collected for a feature that cannot
exist, and keep saying on screen that the user agent is self-declared.

### 11. Referrals by utm_source and Referer

**Cannot exist in this app.** A referral lands on the merchant's themed
storefront, which Shopify serves and this app never sees. There is no request
for the app to inspect, no header, no query string. The only ways to see it
are a storefront script, which breaks the rule that the block ships zero
JavaScript and would put the Built for Shopify performance budget at risk, or
Shopify's own analytics, which we do not have and which would mean asking for
scopes we tell every merchant we do not ask for.

This is the largest single capability the WordPress plugin has and this one
cannot. It is worth saying plainly in the listing rather than leaving a
merchant to discover it: on Shopify we measure what asks for the machine-
readable pages, not what arrives on the storefront. GA4's own AI Assistant
channel is where a Shopify merchant sees referrals, and pointing them there
is more useful than a number we would have to model.

### 12. Delivery as a composed sentence; publish nothing when it varies per product and the product says nothing; business type whitelist of 19 schema.org types; delivery time as two figures in days; cost as free or a figure with a currency

**Adopt in full.** All of it is engine and business-record work, no Shopify
surface involved, and the "publish nothing when it varies and the product is
silent" rule is the §10.1 principle applied to the one field most likely to be
wrong on a per-product basis. The schema.org business-type whitelist also
fixes a real gap: `businessFor()` accepts free text today.

### 13. Per-product cache invalidated on edit, transient plus a global generation

**Mostly exists.** `MirrorCache` is upserted on every `products/update` and
deleted on `products/delete`, so the per-product half is done. The global
generation counter is worth adding for the case WP built it for: a change to
the dictionary or the business record should invalidate every cached mirror
at once, and today it does not - the mirrors only refresh on the next pass.

### 14. One crawler registry: label, fragment, operator, purpose, is_token, rdns, ranges_url, robots_token; any counted crawler can be allowed or blocked

**Adopt.** Today the same knowledge is spread across `KNOWN_BOTS`,
`AGENTS`, `NON_CRAWLER_TOKENS`, `BOT_HINT` and `CAUSE_TEXT` in three files,
and QA found the consequence: six crawlers appear in the Report with a
reachability column that can never be filled, because they are in one list and
not the other. One registry fixes that by construction.

### 15. Title Match removed, circular comparison

**Agreed, and remove it here too.** The Shopify equivalent is
`checkCitationReadiness` in `app/engine/citation.ts`. The module audit found
it independently: it scores the merchant's title against words drawn from
questions generated from the same title, so a 160-character keyword title
scores `good` and a short honest one cannot. Two people reaching the same
conclusion from two codebases is enough. Cut it, keep the descriptive-handle
check, which has a real signal.

---

## Order

**Now, nothing blocked, all adopt:**
the weighted 0-100 score with tiers; the "How to fix" modal on every finding;
findings 2, 4, 6 and 8; top-30 dictionary values; the product picker on the
before-and-after panel; the module cards; the crawler registry; the robots
snippet with Copy; cutting the citation verdict; delivery as a composed
sentence with the business-type whitelist; the global cache generation; XLSX
export.

**Next, one table each:**
`ReportSnapshot` for the sparkline; the mirror-versus-llms.txt split of
requests, which is the attribution sentence.

**Blocked until `scripts/read-forwarding.ts` answers:**
the verified donut, "verified x of y", finding 7, IP-range verification.

**Not building:**
referrals; the Monday digest; sorting by sales; the 500/5000 chunking.

**Rewording rather than building:**
finding 5, which must say what it measures.

## The one thing to run first

    cd F:\ai-visibility-shopify
    npx tsx scripts/read-forwarding.ts

Read-only. It prints no full addresses. Its verdict decides whether a quarter
of this list is engineering or is a sentence in the listing.
