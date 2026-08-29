# CRAWLER-HITS-SPEC — proof that AI crawlers read the mirror

Build brief. Written 18 August 2026. Not started; waiting for go.

Read first: `PRD.md` §4.6 and §5.2 (the proxy path budget), `PRIVACY.md`,
`ARCHITECTURE.md` §6. Those win over this document on any conflict.

---

## 1. Why

The app's core problem is that it sells something invisible. A merchant pays
$99 a year and sees no change on their storefront, by design. The only proof
today is our own dry-run report, which is a claim about what we wrote, not
evidence that anything read it.

The app proxy gives us evidence nobody else in the category has: every mirror
request passes through our server, so we see who asked, for what, and when.
`CrawlerCheck` already answers "can the bots reach this store". This feature
answers the question after it: "did they come, and what did they read".

Secondary value, equally real: a bot that stops appearing is a diagnostic
signal (app embed off, mirror empty, store password on) that we can surface
before the merchant notices anything is wrong.

## 2. The unknown that decides whether this is buildable

**Does Shopify's app proxy forward the original User-Agent, or replace it
with its own?**

If it replaces it, we cannot tell a crawler from a human and the feature is
dead. Nothing else in this spec matters until that is answered with real
data, not documentation.

Phase 0 exists solely to answer it, and costs one migration.

## 2b. The second unknown: our own cache header

`proxy.$.tsx` currently answers with `Cache-Control: public, max-age=300`.

If Shopify's edge honours that and serves the mirror from its own cache, the
second and later requests never reach us and the count is silently wrong -
undercounting, which is the failure mode we would never notice.

Phase 0 must establish which happens. The test is cheap: request the same
handle repeatedly and see whether every request appears in the raw table.

If the edge does cache, the trade is explicit and belongs to Marius: keep the
cache and accept an undercount described honestly as "at least N", or drop to
`no-store` on this path and pay for it in response time on the Built for
Shopify budget. Do not decide it silently in code.

## 3. Phase 0 — instrument, then look

Add raw logging to `proxy.$.tsx`. No UI, no aggregation, no claims.

Recorded per request: shop id, path, handle, response status, user agent,
timestamp. Nothing else.

Constraints on the proxy path (PRD §5.2 keeps it a single indexed read):
- The write must never block or fail the response. Wrap it; on error, serve
  the mirror anyway and drop the log line.
- Do not add a second query. One insert, no reads.
- Keep it to requests that matter: log all of them in Phase 0 precisely
  because we do not yet know what a bot request looks like here.

Before waiting a week, force the answer in five minutes: request the proxy
path directly with a declared agent and see what the table recorded.

```
curl -A "GPTBot/1.0" "https://<shop>/apps/ai-visibility/<handle>"
```

Then repeat it three times to test §2b. If the user agent arrives intact and
all three requests are logged, both unknowns are closed on the spot and the
week of real traffic becomes confirmation rather than discovery.

Let it run on the dev store and any live install for at least a week, then
read the table by hand. Three possible outcomes:

1. Real bot user agents appear (`GPTBot`, `ClaudeBot`, `PerplexityBot`,
   `OAI-SearchBot`, `Applebot`, `DeepSeekBot`) — build the rest.
   `Google-Extended` was in this list and should not have been: it is a
   robots.txt token, not a crawler, and no request ever arrives under that
   name. A request that claims it is something else borrowing the name.
   Corrected 28 August 2026, after the WordPress side verified it against
   Google's and Apple's own documentation. §5 already said this; this line
   contradicted it.
2. Only Shopify's own user agent appears — the feature dies here; document it
   and delete the table.
3. No requests at all — a finding in itself: the mirror is not being read,
   which is worse news and more urgent than the feature.

**No dashboard, no merchant-facing wording, and no promises in the listing
until outcome 1 is confirmed.**

## 4. Data model (Phase 1, only if Phase 0 succeeds)

Two tables, deliberately: raw for diagnosis, aggregate for display.

```
model CrawlerHit {            // raw, short retention
  id        BigInt   @id @default(autoincrement())
  shopId    String
  agent     String            // as sent, untrimmed
  handle    String?           // product handle, null for key files
  path      String
  status    Int
  at        DateTime @default(now())
  @@index([shopId, at])
}

model CrawlerHitDaily {       // aggregate, long retention
  id      String   @id @default(uuid())
  shopId  String
  day     DateTime @db.Date
  bot     String            // normalized: gptbot | claudebot | perplexitybot | ...
  handle  String?
  hits    Int      @default(0)
  misses  Int      @default(0)   // 404s: asked for something we do not have
  @@unique([shopId, day, bot, handle])
  @@index([shopId, day])
}
```

Retention: raw rows 30 days, aggregates 13 months. A daily worker task rolls
raw into aggregate and prunes. Both numbers go in `PRIVACY.md`.

## 5. Bot identification

Normalize the user agent to a known bot name; everything unrecognised is
grouped as `other` and never shown as an AI crawler.

**Verification.** A user agent is a claim, not a fact: anyone can send
`GPTBot`. Two options:

- Option A: user agent only. Simple, and wrong the day someone spoofs it.
  Acceptable only if the number is never shown to a merchant as proof.
- Option B: user agent plus verified source. Correct. Needs an IP on the
  request (confirm in Phase 0) and a periodic fetch of each vendor's list.

**Recommendation: B, or do not display the number.** The product's whole
argument is that we do not overstate. A dashboard whose number can be inflated
by anyone is the one feature that could undo that.

**Verification never happens on the request path.** Serve the mirror, write
the raw row with the agent and the IP, and let a scheduled worker task decide
afterwards whether the row was genuine. A network lookup while a crawler waits
would spend the proxy budget on bookkeeping.

### Source lists, checked 18 August 2026

Confirmed to return real JSON with `ipv4Prefix` / `ipv6Prefix` entries:

| Bot | List |
|---|---|
| GPTBot | `https://openai.com/gptbot.json` |
| OAI-SearchBot | `https://openai.com/searchbot.json` |
| ChatGPT-User | `https://openai.com/chatgpt-user.json` |
| PerplexityBot | `https://www.perplexity.ai/perplexitybot.json` |
| Applebot | `https://search.developer.apple.com/applebot.json` |
| Googlebot | `https://developers.google.com/static/search/apis/ipranges/googlebot.json` |
| Google special crawlers | `https://developers.google.com/static/search/apis/ipranges/special-crawlers.json` |

Traps found while checking, worth keeping:
- Perplexity's list is on **`perplexity.ai`**, not `perplexity.com`; the
  `.com` host answers 302 and leads nowhere useful.
- The Google URLs answer 301 first. The fetcher must follow redirects.
- `Google-Extended` is a robots.txt token, not a separate crawler with its
  own addresses. It cannot be verified as its own source; treat any Google
  agent as one group and say so.

**ClaudeBot has no equivalent JSON list.** `anthropic.com/claudebot.json` is
404, and `docs.claude.com` answers HTML for every path, so a 200 there means
nothing. Anthropic documents address ranges at
`platform.claude.com/docs/en/api/ip-addresses`, but those describe API
traffic and must not be assumed to cover the crawler. For ClaudeBot use
reverse DNS instead: the address must resolve to a hostname under
`anthropic.com`, and that hostname must resolve forward to the same address.
Two verification methods, per vendor, is the honest shape - not one loop
pretending all vendors are alike.

Fetch each list on a schedule, cache it, and keep serving the last good copy
when a fetch fails. A vendor's list being unreachable is not evidence that a
crawler was fake; such rows stay `unverified`, never `spoofed`.

## 6. What the merchant sees (Phase 2)

A card on the dashboard, and a section on the product page:

- "AI crawlers read your product text 342 times in the last 30 days"
- Per bot, with the last date seen: `GPTBot 210, ClaudeBot 98, PerplexityBot 34`
- Top products read, and — more useful — **products never read**
- A warning when a bot that used to appear has been absent for 14 days

Wording rules, non-negotiable:
- We say crawlers **requested** or **read** the text. We never say the store
  **appeared in** or **was cited by** an AI answer. We do not measure that.
- The card states what it counts, in one line, where the merchant reads it.

**Zero is a diagnosis, not a blank.** Read it together with the latest
`CrawlerCheck` for that shop and say which of the two it is:

- Crawler blocked: "No requests recorded. These bots are being refused before
  they reach your store - see Crawler check." Then the cause we already store
  (`password_page`, `bot_app`, `cloudflare`, `robots`).
- Path open, no visits: "The path is open and the text is published; these
  crawlers have not requested it yet." With the date the mirror was last
  rebuilt, so the merchant can see it is recent.

The distinction matters commercially: the first is a fault to fix, the second
is patience. Presenting them as the same number is how a real product becomes
a vanity metric.

### Misses are their own screen

A 404 from a crawler means one of two things, and both are actionable:

1. The bot has an address we no longer serve - the mirror was never built for
   that handle, or the cache entry is gone. Repeated misses on the same handle
   are the trigger to rebuild it, and worth surfacing as such.
2. The merchant deleted the product but it is still known to the crawler from
   an older pass. Nothing to fix; worth showing so the number is not mistaken
   for a fault.

Keep misses out of the headline count and on a diagnostics tab. A miss is not
a read.

## 7. Privacy

- No IP addresses stored. If Option B is chosen, the IP is used for the range
  check in memory and discarded; only the verified/unverified flag persists.
- No cookies, no visitor data. Crawler traffic only; human requests to the
  mirror are counted in a single anonymous total or not at all.
- `PRIVACY.md` and the listing privacy answers updated in the same change.

## 8. Phases and exit criteria

| Phase | Work | Done when |
|---|---|---|
| 0 | raw logging in the proxy, one migration | a week of real data read by hand; the UA question answered |
| 1 | normalization, verification, daily rollup, pruning | aggregates match raw counts on the dev store |
| 2 | dashboard card, product-level view, absence warning | wording reviewed against §6; screenshots for the listing |
| 3 | absence alerts in the weekly digest | merchant is told before they notice |

Phase 0 ships alone and can ship any time. Nothing after it ships without
its predecessor's exit criterion met.

## 9. Rules this change must not break

- GraphQL Admin API only; this feature touches no Admin API at all.
- The proxy stays a single indexed read plus one non-blocking insert.
- The storefront block ships zero JavaScript. This feature adds none.
- Tests stay green; new code gets tests, including the "unknown agent is not
  an AI crawler" case and the 404-counts-as-miss case.
- `_shopify/CHANGELOG.md` updated under Unreleased in the same commit.

## 10. Open questions

1. Does the proxy forward the original user agent? (Phase 0 answers, in five
   minutes, with the curl in §3.)
2. Is a usable client IP available on the request? (Phase 0 answers; decides
   §5 Option A vs B.)
3. Does Shopify's edge cache the proxy response, and if so, do we keep the
   cache and undercount honestly or drop it and pay in latency? (§2b; the
   trade is Marius's, not the code's.)
4. Does mirror traffic volume justify raw retention longer than 30 days?
5. Should the product page show its own hit count, or only the dashboard?
6. Does this become a listing bullet, and if so with what wording? (Only
   after Phase 2, and only if the numbers on real stores are not embarrassing.)
