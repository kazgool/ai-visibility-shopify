# MARKET-SCAN - the GEO / AI SEO category on the Shopify App Store

Scanned 29 August 2026. Search terms "AI SEO GEO", 5,335 results, first page
read in full; fifteen listings read end to end (two, SearchLift and Vizby,
would not load and are absent). Supersedes nothing in `COMPETITORS.md`, which
predates the category existing.

The category did not exist when this app was specified. It does now, it is
crowded, and almost all of it is built on the same four ideas.

---

## 1. The shape of the field

Fifteen listings, and the feature sets rhyme:

| Capability | Apps claiming it |
|---|---|
| Audit score / readiness number | 11 of 15 |
| Prompt or visibility tracking | 8 |
| Blog or article generation | 8 |
| Auto-publishing generated content | 8 |
| llms.txt / agents.md | 6 |
| Competitor tracking | 6 |
| Crawler or robots.txt check | 5 |
| **Real bot traffic logging** | **0** |

The last row is the finding. Not one app in the category logs the requests
AI crawlers actually make. Every "AI visibility" claim on this page is
either a sample of prompts or a parse of robots.txt. We have a `CrawlerHit`
table recording real requests to the app proxy, built three weeks ago and
currently invisible to the merchant. Nobody else has this.

Second finding: **five of fifteen have any reviews at all**, and of those
five, three are old general SEO apps that added "GEO" to their titles
(SEOWILL 1,732 reviews, BOOSTER 5,263, SEOLab 2,411). The apps built for
this category from scratch have 0, 1, 3, 5 and 27 reviews. The category is
new enough that nobody has won it.

## 2. Pricing - we are cheap, and we should stop being quiet about it

Monthly, at the tier a real catalogue needs:

| App | Entry | Realistic tier | Annual equivalent |
|---|---|---|---|
| **Ours** | - | **$99/year flat** | **$99** |
| RankEngine | $9.99 | $24.99 | $300 |
| Describely | $28 (50 products) | $138 (250 products) | $1,656 |
| GEOde | $29 | $59 | $708 |
| Cuebase | $29 | $79 | $948 |
| Scayla | $49 | $69 | $828 |
| GenAI Ranker | $39 | $39 | $468 |
| Kwik GEO | $50 | $79 | $948 |
| Sphen | $25 | $109 | $1,308 |
| BeeTopic | $99.95 | $399.95 | $4,799 |

We charge, for an unlimited catalogue up to 20,000 products, less than the
cheapest competitor's monthly-to-annual on the smallest tier. Describely
charges $138 a month for **250 products**; we do 20,000 for $99 a year.

This is not an accident to be defended, it is the headline nobody is using.
Every one of these prices exists because the app makes model calls per
product, per month, forever. Ours is deterministic regex over text the
merchant already wrote: the marginal cost of the 20,000th product is near
zero, which is exactly why we can price flat and they cannot. **"They meter
because they pay OpenAI per product. We don't call a model at all."**

## 3. What everyone sells that we deliberately do not

Both were settled in `EXPERIENCE-PRD.md` §9b. The scan confirms how
mainstream both are, which makes the refusal louder, not weaker:

**Prompt sampling sold as "your AI visibility".** Eight apps. The quotas
give the game away: Sphen sells 3 visibility tests a month at $25 and 15 at
$219; Kwik GEO 50 prompts weekly at $50; Cuebase 10 "Share of Voice"
queries at $29. A merchant paying $219 a month is buying fifteen
conversations. Sold as a percentage, refreshed daily, with drop alerts.

**Auto-publishing AI articles.** Eight apps, and the volumes are the story:
RankEngine 200 posts a month, BeeTopic 60, Kwik GEO 20 "auto-published",
LLM Rank auto-publishes by default on the *free* tier. BeeTopic calls it
"SEO Autopilot... hands-free". Three of the eight state no merchant review
step at all.

Two apps do say the right thing and deserve credit rather than a strawman:
Scayla states "Nothing publishes without your approval", and Sphen's own
tagline is "reviewed by you". If we claim nobody reviews, we are wrong and
someone will say so. The accurate claim is narrower and better: **we do not
generate the content in the first place.** Review is a safeguard against
content that should not exist under the merchant's name; not generating it
needs no safeguard.

## 4. What is worth adding, ranked

**Take now, cheap, and we are behind on it:**

1. **llms.txt / agents.md** - six apps, one of them (Avada) with 351
   five-star reviews for doing *only* this, free. Already specified in
   `EXPERIENCE-PRD.md` §8. It is one proxy route over tables we maintain.
   Note the warning found in Avada's own reviews: a merchant reports
   Shopify's agentic changes moved the standard toward `agents.md` and
   made plain llms.txt partly redundant. Serve both; the marginal cost is
   a second route.
2. **Bot traffic, surfaced.** We already collect it. Nobody else has it.
   A dashboard line - "GPTBot requested 14 product pages in the last 7
   days" - is a fact none of the fifteen can print, and it is the honest
   answer to the question their prompt sampling pretends to answer. This
   is the single highest-value item on this list and it is mostly UI.
3. **Fix history and revert.** GEOde, NestScale and RankEngine all sell
   it. We have something stronger already built (nothing human-written is
   ever overwritten, state tracked per field) and we say it in prose
   nowhere near loudly enough. Not a build item; a copy item.

**Consider, with a real cost:**

4. **Verification after write.** RankEngine's pitch is "writes change,
   re-reads live value, marks verified", positioned explicitly against
   apps that mark things done without checking. Our embed-uid check does
   this for one thing; extending it to "we re-read the metafield after
   writing" is small and gives us the same claim with more substance.
5. **Competitor comparison** - six apps sell it. Ours would have to be
   built on something we can actually observe, which for us means the
   structured data on a competitor's public product page, not their AI
   share of voice. Narrow, honest, and nobody is doing that version.
   Needs its own spec.

**Do not:**

- A readiness score. Eleven of fifteen ship one, all with invented
  denominators. `EXPERIENCE-PRD.md` §5 is the replacement.
- Blog generation and auto-publishing (§9b).
- Prompt sampling sold as visibility (§9b).
- Image compression, speed optimisation, backlink exchange. Adjacent
  category, crowded by apps with thousands of reviews, and nothing to do
  with whether an assistant can read a product page.

## 5. The positioning this scan produces

Three sentences, all now defensible against a named field:

1. **We measure requests, not vibes.** Fifteen apps sell AI visibility;
   none of them logs a single real crawler request. We log every one.
2. **We publish what you wrote.** Eight apps write articles under the
   merchant's name; we extract and structure what is already theirs and
   never generate a word of content for their domain.
3. **We do not meter, because we do not pay per product.** Deterministic
   extraction has no marginal model cost. Everyone charging $29 to $400 a
   month is passing on a bill we do not have.

## 5b. Vizby, examined by hand (29 Aug 2026)

The listing would not fetch, so it was installed on the dev store instead.
Built for Shopify, 27 reviews, "Agentic Storefront: GEO & AEO for ChatGPT,
Gemini & Claude" - the most established app built for this category.

**It refuses to run on development stores.** The admin screen is gated, so
the product itself could not be examined. A smart defence against exactly
the kind of inspection being done here, and worth noting as a tactic rather
than resented.

Two things were learnt anyway, and both are more useful than a UI tour.

**The permissions.** On install it takes read access to **Orders** (the
activity log showed them read within a minute, not on demand),
**Customers**, and **Store analytics**. Shopify's Privacy panel spells out
the reach: customer name, email address, phone number, physical address,
geolocation, IP address, browser and operating system. For an app whose
stated job is making a storefront readable to assistants. Ours asks for
`read_products, write_products, read_themes` and nothing else. Written up
as a positioning point in `EXPERIENCE-PRD.md` §9c.

**The other two.** It also generates blog posts and ships a prompt-sampling
"AI check", so on both of §9b's refusals it is on the other side. The most
credentialed app in the category does all three of the things we decline.
That is the argument, and it needs no adjective.

## 6. Open questions

- SearchLift would not load and has not been examined.
- Shopify's own agentic surface keeps moving (`agents.md`, UCP, WebMCP -
  LLM Rank already sells "UCP/MCP and 100+ bot controls"). Whatever we
  ship for §8 should be re-checked against Shopify's docs on the day it
  is built, not against this scan.
