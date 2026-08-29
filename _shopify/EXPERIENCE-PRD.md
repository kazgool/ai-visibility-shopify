# EXPERIENCE-PRD - the merchant experience, rebuilt to beat FoundGPT

Written 29 August 2026, after a full walkthrough of FoundGPT (competitor,
installed on the dev store the same day). This document is a build brief for
the app's surface: what the merchant sees, in what order, and what each screen
claims. The engine, billing and free tier are already specified elsewhere and
do not change here.

The one-line strategy: FoundGPT is a well-directed film about a thin product.
We are a real product with no direction. Take their direction, keep our
substance, and turn their every exaggeration into our proof point.

---

## 1. What the walkthrough found (evidence, dated 29 Aug 2026)

Observed on mrdigital-dev, a store whose storefront sits behind a password no
dev store can disable:

- **Their crawler check reported "14 of 14 AI crawlers can read your store -
  All clear."** It parses robots.txt and never makes a request, so it cannot
  see the password page. Ours makes one real request per crawler with the
  real user agent and correctly reports the password wall. This single
  screenshot pair is our sharpest sales asset.
- **"242 fixable issues across 50 products"** is five fields counted
  separately (Meta 50, Tags 50, Attributes 50, Category 49, Description 43).
  The real number is 50 products.
- **AI readiness score 34/100**, produced during install, with no visible
  denominator and no way for the merchant to check it.
- **AI Revenue screen**: $0, "Too early", "typically 4-6 weeks to first AI
  order" - an unfalsifiable promise that outlives the 30-day trial. "Work
  done so far" counts activity (checks run, articles drafted), not outcomes.
- **Monthly quotas** on near-free operations (100 auto-fixes, 20 checks,
  150 articles), reset on the 1st, countdown shown - retention mechanics
  dressed as capacity.
- **Auto-publish**: up to 40 AI-written articles a month pushed to the
  merchant's own blog, opt-out, preview by email 24h before.
- Review request banner shown before any result existed; upgrade banner on
  three screens of four.

And the things they do genuinely better than us, which this PRD adopts:

- An ordered ladder instead of a checklist: numbered steps, each unlocking
  the next, one yellow "this is the next step" row, a time estimate on the
  primary action.
- "This is the one step we can't run for you" - naming the single manual
  action honestly.
- Empty states that explain the pipeline instead of showing zeros.
- A scan that runs during install, so the merchant lands on results.
- "Preview what AI sees" as the name for the plain-text view.

## 2. The principle every screen answers to

**We publish only what we measured, and we show how we measured it.** Every
number on every screen must carry its denominator and its method within one
glance - a subtitle, not a tooltip. Any number that fails this test does not
ship. This is the inversion of FoundGPT's design and the whole positioning:
their numbers are chosen to alarm, ours are chosen to be checkable.

Corollaries, enforceable in review:

- No score without a visible denominator and a list of what was counted.
- No aggregate that counts the same product twice ("242 issues" style).
- No promise with a horizon we cannot observe ("first AI order in 4-6
  weeks").
- No green verdict derived from a file when a request would tell the truth.
  If we did not fetch it, we do not say "readable".
- Counting activity as if it were outcome is forbidden. "4 checks run" is
  not progress; "2 products now readable that were not" is.

## 3. The ladder (replaces the dashboard checklist)

One card, at the top of the dashboard, four steps, strictly ordered. Each
step is either done (green, with the dated evidence), current (one primary
button, a time estimate, and nothing else highlighted anywhere on the
screen), or locked (visible, grey, one line saying what unlocks it). The
current step is the only primary action in the app; every other screen's
main button drops to secondary while a ladder step is open.

1. **Store scanned.** Runs during install, before first paint of the
   dashboard (§4). Done state: "352 of 355 products state something
   extractable. Checked today at 14:02."
2. **Crawlers verified.** The real crawler check. Done state names the
   verdict honestly, including the password wall on dev stores. This is the
   screen where the method line matters most: "We requested a product page
   once per crawler, with that crawler's exact user agent, from outside
   Shopify."
3. **App embed activated.** The one step we cannot do. Copy: "This is the
   only step that needs your hands: apps cannot switch a theme embed on.
   Two clicks in the theme editor - here is the deep link." Verified by the
   released-uid check, not by trust; the step does not go green until the
   check passes. This is the onboarding-refuses-success requirement from
   STATUS §7, folded into the ladder.
4. **Catalogue filled.** Free shops run their three products here and the
   step completes at 3/3 with the line "Your other N products are one
   subscription away - nothing else in this app is held back." Paid shops
   run the full pass.

The ladder never shows a step it cannot verify. Progress is read from
JobRun rows and metafields, per the existing rule that progress lives in
the database, not the browser.

## 4. Scan during install

Today the merchant lands on an empty dashboard and must press Fill
catalogue. FoundGPT lands them on results, and that is the correct call.

On the auth callback that creates the Shop row, queue a dry-run coverage
pass (writes nothing, needs no consent) and the crawler check. Both are
free-tier operations already. The dashboard's first paint shows real
numbers or the honest in-progress line "Reading your catalogue - N of M so
far", backed by the JobRun row as always. No fabricated score stands in
while it runs.

## 5. Numbers with denominators (replaces any temptation to score)

We do not ship a 0-100 score. A score is a number whose denominator was
chosen by marketing. What we ship instead, each with its method line:

- **Coverage**: "352 of 355 products state something extractable." Existing
  dry run, now permanent on the dashboard.
- **Crawler access**: "7 of 8 crawlers received the page. GPTBot got the
  password wall." Existing check, reframed as a fraction.
- **Readability**: the citation check's good/partial/weak verdicts as
  fractions of products checked, never blended into one number.
- **Attribute depth**, new and cheap: "Dimensions on 306 of 355. Material on
  273." Already computed by the coverage pass; currently discarded.

Where FoundGPT shows "AI readiness 34", we show four fractions the merchant
can verify by opening any product. A fraction with a method line cannot be
accused of being invented, which is exactly the accusation we will be
making about everyone else's scores.

## 6. Empty states that explain the pipeline

Adopt their pattern, keep our honesty. Every metric that has no data yet
states what has to happen for data to appear, and which step of the ladder
that is:

- Mirror column, no cache yet: "Not readable yet - runs when this product
  is processed (step 4)."
- Crawler hits, table empty: "First bot visits typically show within days
  of the embed going live (step 3). We log real requests; we do not
  estimate." (The CrawlerHit table exists; a count of real hits in the
  last 7 days becomes a dashboard line the moment there is one.)
- Citation check, no questions: "No buyer questions generated yet -
  processing writes them."

Never a bare zero, never a dash without a sentence.

## 7. Renames (cheap, do now)

- "Plain text" column and links become **"What AI reads"**, linking to the
  same mirror URL. Their name for the same idea is better than ours;
  theirs previews a simulation, ours serves the actual file, and the label
  should say so.
- The diagnostics crawler card gains the method line from §3 step 2,
  verbatim, as a subtitle.

## 8. llms.txt (new, small)

Serve `/llms.txt` through the existing app proxy alongside the mirror:
shop name, the Business screen's commercial facts, and the mirror index -
a link per processed product. Regenerated when mirrors regenerate, zero
JavaScript, zero theme changes. FoundGPT ships this and merchants ask for
it by name; for us it is one route reading tables we already maintain.
(Domain-root placement needs a theme template; proxy path first, template
instructions on Diagnostics as the follow-up.)

## 9. Visibility checks - the one real gap, scoped honestly

The only thing FoundGPT measures that we do not: ask the assistants real
buyer questions and record whether the store is named. It is also their
only expensive feature, hence their 20/month quota.

Not in this PRD's build scope. It needs per-check spend, API accounts, and
a prompt-honesty design of its own, and bolted on cheaply it becomes the
exact theatre this document exists to remove. It gets its own spec
(VISIBILITY-CHECKS-SPEC.md) with cost modelling before anything is built.
Until then we do not imitate it with anything synthetic, and the deck may
say plainly: "We do not query assistants yet. When we do, you will see the
prompts we asked and the answers we got, verbatim."

## 9b. Three refusals that are selling points, not fine print (Marius, 29 Aug 2026)

Two are below; the third, data access, is §9c. All three carry equal weight
and all three go on the listing, the landing page and the deck as headline
claims, professionally worded - not buried in a FAQ. Most apps in this
category ship all three of the things we refuse.

**We do not sample prompts and call it your visibility.** Asking an
assistant twenty questions and reporting how often a store was named
measures twenty conversations out of the millions that month, with answers
that vary by phrasing, by session, by user history and by the model's
mood on the day. Reported as "your AI visibility", a sample that thin is
not a measurement, it is a horoscope. When we build visibility checks
(§9), they will show the verbatim prompts and verbatim answers and claim
nothing beyond them. Until then the honest sentence is: nobody can tell
you how often AI recommends you, and anyone selling you that number is
sampling noise.

Suggested public wording: "We don't run a handful of prompts and call it
your AI visibility score. No one can measure that yet - so we measure
what can be measured: whether AI can read your store, and what it finds
when it does."

**We do not publish blog posts to your store.** Two reasons, both stated
publicly. First, it is counterproductive: search and AI systems detect
and demote mass-produced AI text, so an app that auto-publishes dozens of
generated articles a month under your domain is spending your site's
reputation to inflate its own activity metrics. Second, it is dishonest:
those articles carry your name, and you did not write them or, past the
first week, even read them. Our entire product works on what the merchant
already wrote - we extract, structure and publish it where AI can read
it; we never generate content and pass it off as theirs.

Suggested public wording: "We will never auto-publish AI articles to your
blog. AI-generated filler gets your domain demoted, and it isn't yours.
We work with what you actually wrote - that's the only content AI should
ever attribute to you."

## 9c. The third refusal: we never ask for orders or customers (Marius, 29 Aug 2026)

This carries the same weight as the other two. It is not a footnote about
tidy scopes; it is the third headline, and it is the only one of the three
a merchant can verify without trusting anybody, in fifteen seconds, on a
screen Shopify controls.

**Both competitors examined on the dev store ask for order and customer
data.** FoundGPT and Vizby AI, tested the same day. Vizby - Built for
Shopify, 27 reviews, the most established purpose-built app in the category
- requests on install, for an app whose stated job is making a storefront
readable to assistants:

- **Orders**: read. Shopify's activity log showed "Just now" within a
  minute of install, so they are read immediately, not on demand.
- **Customers**: read.
- **Store analytics**: read.
- Under Privacy, Shopify lists what that reaches: customer **name, email
  address, phone number, physical address**, plus **geolocation, IP
  address, browser and operating system**.

FoundGPT asks for the same categories. Between them they are the two most
visible apps in the category, and neither can make a storefront one line
more readable with a customer's phone number.

Ours, from `shopify.app.toml`, unchanged since the first submission:
`read_products, write_products, read_themes`. No orders. No customers. No
analytics. Shopify's own permissions screen prints this side by side, which
makes it the rare competitive claim a merchant can verify in fifteen seconds
without taking anybody's word for it - including ours.

Why it matters beyond tidiness. Under the GDPR, a controller may collect
personal data only where it is adequate, relevant and limited to what is
necessary for the stated purpose (Art. 5(1)(c), data minimisation). A
merchant who installs an app that reads customer names, emails and IP
addresses becomes responsible for that processing: it needs a lawful basis,
it belongs in their processor register, and it widens the blast radius of
any breach at the vendor. Attributing revenue to AI referrals is the usual
justification, and it is the same feature we already declined in §10 on
accuracy grounds. The privacy argument and the honesty argument land on the
same answer.

The wording stays factual and names no competitor. State our own scopes and
let the merchant compare:

> This app asks for products and themes. Not your orders, not your
> customers, not your analytics. Shopify shows you exactly what any app can
> reach, on the app's own permissions screen - check ours, then check the
> others. We cannot see who bought what, because we never needed to.

Constraint this creates for us, worth writing down while it is cheap: any
future feature that would require `read_orders` or `read_customers` does not
get built without reopening this decision explicitly. That includes revenue
attribution, buyer segments, and anything described as "AI-driven sales".

## 10. What we refuse to build (so nobody relitigates it feature by feature)

- **Auto-publishing AI articles to the merchant's blog.** Their 40/month
  opt-out machine turns a store's blog into unreviewed AI output under the
  merchant's own name. Against the product's core promise that nothing a
  human did not approve gets written under their name at volume.
- **Monthly quotas on cheap operations.** Our caps are honest capacity
  (three free products, forever) or nothing.
- **A readiness score.** §5 is the replacement, not a gap.
- **Estimated or attributed AI revenue.** We log crawler hits because they
  are requests we actually served. Revenue attribution from AI referrals
  is a claim we cannot verify from where we stand, so it does not appear.
- **Review prompts ahead of results.** The review ask appears once, only
  after ladder step 4 completes.

## 11. Build order

1. §7 renames and §6 empty states - copy changes, one pass.
2. §5 dashboard fractions - the coverage pass already computes them.
3. §3 ladder replacing the checklist, including the embed verification gate.
4. §4 scan during install.
5. §8 llms.txt route.
6. §9 spec written separately; no code.
7. §9b and §9c wording onto the listing, the landing page and the deck -
   copy work, no app code, can ship independently of everything above. The
   three refusals travel together and in the same order everywhere: no
   prompt sampling, no generated content, no access to orders or customers.

Each lands under the usual rules: check.bat green plus npm run build,
CHANGELOG under Unreleased, no REST, engine untouched, plain characters in
every published string.
