# BILLING-SPEC — plans, enforcement and the upgrade path

Build brief. Written 2 August 2026. Companion to `PRD.md` §6.

---

## 1. The plans

| Handle | Name | Price | Limit | Trial |
|---|---|---|---|---|
| `standard` | Standard | $99.00 USD / year | up to 20,000 products | none — see §4 |
| `high_volume` | High volume | $149.00 USD / year | above 20,000 products | none — see §4 |

Same features on both. The second plan exists as a fair-use valve for the
rare large catalogue, not as a feature gate. Never describe it as "Pro" or
"Enterprise": it is not better, it is for bigger catalogues.

**Why annual, not monthly (decided 2 Aug 2026).** Three reasons, in order
of weight:

1. **It matches how the value arrives.** Most of the work lands in the
   first fifteen minutes, then the app maintains the catalogue quietly for
   a year. A monthly plan invites paying once, running the pass and
   cancelling — annual makes the commitment match the shape of the value.
2. **It reads cheaper while earning more.** A merchant mentally divides:
   $99 a year is about $8 a month, against Mento at $19 and Attributify at
   $49 *per month*. We look like the sensible choice and still collect more
   than a $29 monthly plan that churns after one cycle.
3. **It is the model the WordPress product already proves**, at €99/€199/€499
   a year. Same customer expectation, same renewal rhythm, one fewer thing
   to invent.

No free plan at launch. Free installs are the main source of one-star
reviews, and we have no review history to absorb them.

## 2. Shopify Billing API

- `appSubscriptionCreate` with `appRecurringPricingDetails`, **interval
  `ANNUAL`**, `test: true` on development stores. No `trialDays`.
- `returnUrl` comes back into the embedded app, never to an external page.
- Read the current subscription with `currentAppInstallation {
  activeSubscriptions { name status lineItems } }` — never trust a locally
  cached plan for access decisions.
- Store the plan handle on `Shop.plan` for display and for the limit check;
  treat Shopify as the source of truth on every load of the billing screen.
- Cancellation, refunds, renewal reminders and dunning are Shopify's job.
  Do not build them. In particular, do not email merchants about renewals:
  Shopify bills them and tells them.
- An annual charge appears on the merchant's Shopify invoice like any other
  app charge; there is nothing special to handle at renewal time. A renewed
  subscription keeps the same `id`.

## 3. Enforcement — deliberately gentle

The check is a product count, run when a bulk pass starts and once a day,
not on every request.

```
count <= 20,000                     → run normally
count > 20,000 and plan standard    → run, show the upgrade banner,
                                      start a 14-day grace period
grace expired and still standard    → refuse new full passes only
```

An upgrade mid-year uses `appSubscriptionCreate` for the new plan; Shopify
prorates the remainder of the old one. Never cancel first and re-charge —
that bills the merchant twice for the same year.

What we never do:

- Never stop webhook-driven extraction of individual products. A merchant
  who is over the limit still gets new products processed; only the
  expensive full pass is withheld.
- Never delete or hide data already written. It lives in the merchant's
  metafields and belongs to them (PRD §4.1).
- Never break silently. The banner names the number: "Your catalogue has
  grown to 23,410 products. Move to High volume to keep running full
  passes." A growing merchant surprised by a broken app leaves a one-star
  review that costs more than the price difference.

## 4. No trial, no free tier. Subscribe to use it.

**The rule (decided 2 Aug 2026).** A plan is required before the app does
anything. No seven-day trial, no free preview, no partially working state.

**Why.** The value is front-loaded — one full pass does most of the work a
catalogue will ever need — so a trial is an invitation to extract
everything and cancel on day two, keeping the metafields (which are
genuinely theirs) while we are paid nothing. A free tier would need
per-feature gating, upgrade prompts and a permanent stream of "why is this
locked" tickets. One gate at the entrance is a fraction of the code and
nothing to explain.

**Where the merchant sees proof before paying:** the App Store listing.
Screenshots and the video show real extraction on a real catalogue —
coverage numbers, worked examples, before and after. The listing does the
convincing; the app does the work. This is the one place where investing
in the assets genuinely replaces product complexity.

**Implementation.** A single check in the `/app` route loader: no active
subscription redirects to the billing screen. Everything downstream can
assume a paying shop, which keeps the rest of the code free of plan
conditionals.

**The trade-off, stated plainly.** Conversion from install to paid will be
lower than an app with a trial, and some reviews will say they wanted to
try it first. That is accepted deliberately: fewer, better-qualified
customers, and no free-riders on a product whose value arrives in the first
ten minutes.

**Churn at renewal** remains possible and cannot be engineered away —
the data stays with the merchant by design (PRD §4.1). What is recurring
should be said on the listing rather than hidden: new products processed
automatically, alt text for new images, crawler access re-checked after
theme or app changes, the dictionary refined as the catalogue grows.
*Maintenance, not a one-off clean-up.*

## 5. Screens

**Billing** — two cards side by side, the merchant's own numbers in the
copy ("You have 355 products — Standard covers your catalogue"), the
current plan marked, and a single button per plan. Include one line on
what happens if they cancel: *your extracted attributes stay in your
Shopify metafields and keep working, with or without this app.* That
sentence is a selling point, not a disclaimer.

**Dashboard** — no pricing noise. At most one banner, and only when the
product limit is genuinely crossed. Nothing about renewal: Shopify handles
that, and a countdown on our screen would only create anxiety we cannot
resolve.

## 5.1 Comped access (our own stores, agencies, gifts)

Three ways to give the app away, in order of preference:

1. **Access code (`MASTER_KEY`).** A quiet "Have an access code?" link on the
   plans screen reveals one field. A correct code marks the shop comped in
   `Setting("comped")` and opens the gate permanently — no deploy, no
   Shopify involvement. The key lives only in `fly secrets`, is never shown
   anywhere in the interface, and is compared in constant time so the field
   cannot be used to guess it. Rotate by changing the secret; existing
   comps survive because they are recorded per shop.
2. ~~**`FREE_SHOPS` allowlist.**~~ Removed 3 Aug 2026: a second bypass is a
   second thing to forget when testing the paid funnel, and forgetting it
   makes the test meaningless. The master key covers every case. Historic
   description: comma-separated shop domains in the
   environment, for stores that should be open without anyone typing
   anything. Ours, mainly.
3. **100% discount through Shopify** (`startSubscription(..., freeYears)`).
   A real subscription that bills $0 for N years, then charges normally.
   Use this for "first year free" on a merchant we expect to keep — it
   shows correctly on their Shopify invoice and needs no mechanism of ours.

A comped shop skips the Shopify subscription check entirely; the plans
screen says so plainly rather than pretending a plan exists.

## 5.2 SEO unlock (`SEO_UNLOCK_KEY`, unrelated to billing)

A second, separate switch, same mechanism as the access code above but a
different secret and a different effect: it grants no plan and no comp, it
only lets the storefront block emit a few additional schema.org properties
(BreadcrumbList, WebSite/SearchAction, priceValidUntil, itemCondition - see
the theme block for detail). Turned on per shop, during a paid setup
engagement, by a "Have a setup code?" link on the plans screen next to the
access code one - deliberately as quiet, no badge, no explanation of what it
does. A correct code writes `Setting("seo_unlocked")` and mirrors it to the
`seo_unlocked` shop metafield so the Liquid block can read it. The key lives
only in `fly secrets` / `.env`, is never shown anywhere in the interface, and
is compared in constant time.

## 6. Data model

`Shop.plan` holds the handle (`none` | `standard` | `high_volume`), plus
`Setting` rows for `plan_checked_at` and `grace_started_at`. No new tables.

## 7. What not to build

- Usage metering or per-product charges. Our marginal cost is near zero
  because the engine calls no model; metering would add complexity that
  buys nothing.
- Monthly plans. The value is front-loaded and maintenance is the
  recurring part; a monthly option would only invite one-cycle churn.
- Coupons and partner discounts. Shopify's own mechanisms cover this.
